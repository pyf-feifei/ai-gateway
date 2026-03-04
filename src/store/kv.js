const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MODEL_CACHE_KV_TTL = 3600; // 1 hour – auto-expire in KV so stale model lists don't persist forever
const DEFAULT_COOLDOWN_MS = 90 * 1000;

class KVStore {
  constructor(kv) {
    this.kv = kv;
    this.cache = new Map();
  }

  async get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.value;
    }
    const value = await this.kv.get(key, 'json');
    this.cache.set(key, { value, time: Date.now() });
    return value;
  }

  async set(key, value) {
    await this.kv.put(key, JSON.stringify(value));
    this.cache.set(key, { value, time: Date.now() });
  }

  invalidate(key) {
    this.cache.delete(key);
  }

  async getChannels() {
    return (await this.get('config:channels')) || [];
  }

  async saveChannels(channels) {
    await this.set('config:channels', channels);
  }

  async getApiKeys() {
    return (await this.get('config:apikeys')) || [];
  }

  async saveApiKeys(keys) {
    await this.set('config:apikeys', keys);
  }

  async getRRCounter(channelId) {
    const val = await this.kv.get(`lb:rr:${channelId}`);
    return parseInt(val) || 0;
  }

  async setRRCounter(channelId, value) {
    await this.kv.put(`lb:rr:${channelId}`, String(value));
  }

  // ── Per-key usage tracking (bypass cache for freshness) ──
  // Storage format: usage:{channelId}:{date} → { "keyId1": { total, models: { m: N } }, ... }

  _todayKey() {
    const now = new Date();
    const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return beijing.toISOString().slice(0, 10);
  }

  _keyId(apiKey) {
    return apiKey.slice(-8);
  }

  async getUsage(channelId, date) {
    const key = `usage:${channelId}:${date || this._todayKey()}`;
    try {
      return (await this.kv.get(key, 'json')) || {};
    } catch {
      return {};
    }
  }

  async incrementUsage(channelId, apiKey, model) {
    const date = this._todayKey();
    const kvKey = `usage:${channelId}:${date}`;
    const allUsage = await this.getUsage(channelId, date);
    const kid = this._keyId(apiKey);

    if (!allUsage[kid]) allUsage[kid] = { total: 0, models: {} };
    allUsage[kid].total += 1;
    if (model) {
      allUsage[kid].models[model] = (allUsage[kid].models[model] || 0) + 1;
    }
    await this.kv.put(kvKey, JSON.stringify(allUsage));
    return allUsage[kid];
  }

  // ── Per-client API key usage tracking ──
  // Storage: apikey-usage:{date} → { "keyId": { requests, prompt_tokens, completion_tokens, models: { m: { requests, prompt_tokens, completion_tokens } } } }

  async getApiKeyUsage(date) {
    const key = `apikey-usage:${date || this._todayKey()}`;
    try {
      return (await this.kv.get(key, 'json')) || {};
    } catch {
      return {};
    }
  }

  async incrementApiKeyUsage(apiKeyId, model, promptTokens = 0, completionTokens = 0) {
    const date = this._todayKey();
    const kvKey = `apikey-usage:${date}`;
    const allUsage = await this.getApiKeyUsage(date);

    if (!allUsage[apiKeyId]) {
      allUsage[apiKeyId] = { requests: 0, prompt_tokens: 0, completion_tokens: 0, models: {} };
    }
    const u = allUsage[apiKeyId];
    u.requests += 1;
    u.prompt_tokens += promptTokens;
    u.completion_tokens += completionTokens;

    if (model) {
      if (!u.models[model]) u.models[model] = { requests: 0, prompt_tokens: 0, completion_tokens: 0 };
      u.models[model].requests += 1;
      u.models[model].prompt_tokens += promptTokens;
      u.models[model].completion_tokens += completionTokens;
    }

    await this.kv.put(kvKey, JSON.stringify(allUsage));
    return u;
  }

  // ── Error logs (per-channel, per-day, last 100 entries) ──

  async appendError(channelId, entry) {
    const date = this._todayKey();
    const key = `errors:${channelId}:${date}`;
    let logs;
    try { logs = (await this.kv.get(key, 'json')) || []; } catch { logs = []; }
    logs.push({ ...entry, time: new Date().toISOString() });
    if (logs.length > 100) logs = logs.slice(-100);
    await this.kv.put(key, JSON.stringify(logs));
  }

  async getErrors(channelId, date) {
    const key = `errors:${channelId}:${date || this._todayKey()}`;
    try { return (await this.kv.get(key, 'json')) || []; } catch { return []; }
  }

  // ── Per-channel model cache (populated by /models and LoadBalancer) ──

  async getModelCache(channelId) {
    return await this.get(`model-cache:${channelId}`);
  }

  async setModelCache(channelId, modelIds) {
    const key = `model-cache:${channelId}`;
    await this.kv.put(key, JSON.stringify(modelIds), { expirationTtl: MODEL_CACHE_KV_TTL });
    this.cache.set(key, { value: modelIds, time: Date.now() });
  }

  invalidateModelCache(channelId) {
    this.invalidate(`model-cache:${channelId}`);
  }

  // ── Rate-limit state (per key+model, per day) ──
  // Storage: ratelimit:{channelId}:{date} →
  // {
  //   "keyId": {
  //     "daily_models": ["modelA"],              // exhausted for current day
  //     "cooldowns": { "modelB": 1770000000000 },// temporary cooldown until timestamp(ms)
  //     "header": {
  //       "user_limit": 2000,
  //       "user_remaining": 1500,
  //       "model_limits": { "modelA": { "limit": 100, "remaining": 12, "updated_at": 1770000000000 } },
  //       "updated_at": 1770000000000
  //     }
  //   }
  // }

  _normalizeRateLimitData(rawData) {
    const data = rawData && typeof rawData === 'object' ? rawData : {};
    const normalized = {};

    for (const [kid, entry] of Object.entries(data)) {
      // Backward compatibility: old format was { keyId: ["model1", ...] }
      if (Array.isArray(entry)) {
        normalized[kid] = {
          daily_models: [...new Set(entry.filter(Boolean))],
          cooldowns: {},
          header: { model_limits: {} },
        };
        continue;
      }

      const dailyModels = Array.isArray(entry?.daily_models)
        ? [...new Set(entry.daily_models.filter(Boolean))]
        : [];
      const cooldowns = (entry?.cooldowns && typeof entry.cooldowns === 'object')
        ? { ...entry.cooldowns }
        : {};
      const header = (entry?.header && typeof entry.header === 'object')
        ? { ...entry.header, model_limits: { ...(entry.header.model_limits || {}) } }
        : { model_limits: {} };

      normalized[kid] = { daily_models: dailyModels, cooldowns, header };
    }

    return normalized;
  }

  async _loadRateLimitData(channelId, date) {
    const kvKey = `ratelimit:${channelId}:${date || this._todayKey()}`;
    let data;
    try {
      data = (await this.kv.get(kvKey, 'json')) || {};
    } catch {
      data = {};
    }
    return { kvKey, data: this._normalizeRateLimitData(data) };
  }

  async _saveRateLimitData(kvKey, data) {
    await this.kv.put(kvKey, JSON.stringify(data));
    this.cache.set(kvKey, { value: data, time: Date.now() });
  }

  _ensureRateLimitEntry(data, kid) {
    if (!data[kid]) {
      data[kid] = {
        daily_models: [],
        cooldowns: {},
        header: { model_limits: {} },
      };
    }
    if (!Array.isArray(data[kid].daily_models)) data[kid].daily_models = [];
    if (!data[kid].cooldowns || typeof data[kid].cooldowns !== 'object') data[kid].cooldowns = {};
    if (!data[kid].header || typeof data[kid].header !== 'object') data[kid].header = { model_limits: {} };
    if (!data[kid].header.model_limits || typeof data[kid].header.model_limits !== 'object') {
      data[kid].header.model_limits = {};
    }
    return data[kid];
  }

  async markRateLimited(channelId, apiKey, model) {
    const date = this._todayKey();
    const { kvKey, data } = await this._loadRateLimitData(channelId, date);
    const kid = this._keyId(apiKey);
    const entry = this._ensureRateLimitEntry(data, kid);
    const modelKey = model || '*';
    if (!entry.daily_models.includes(modelKey)) {
      entry.daily_models.push(modelKey);
    }
    await this._saveRateLimitData(kvKey, data);
  }

  async markRateLimitedTemporary(channelId, apiKey, model, cooldownMs = DEFAULT_COOLDOWN_MS) {
    const date = this._todayKey();
    const { kvKey, data } = await this._loadRateLimitData(channelId, date);
    const kid = this._keyId(apiKey);
    const entry = this._ensureRateLimitEntry(data, kid);
    const modelKey = model || '*';
    const until = Date.now() + Math.max(1, cooldownMs);
    entry.cooldowns[modelKey] = Math.max(until, Number(entry.cooldowns[modelKey]) || 0);
    await this._saveRateLimitData(kvKey, data);
  }

  async clearRateLimitCooldown(channelId, apiKey, model) {
    const date = this._todayKey();
    const { kvKey, data } = await this._loadRateLimitData(channelId, date);
    const kid = this._keyId(apiKey);
    const entry = this._ensureRateLimitEntry(data, kid);
    const modelKey = model || '*';
    if (entry.cooldowns[modelKey] !== undefined) {
      delete entry.cooldowns[modelKey];
      await this._saveRateLimitData(kvKey, data);
    }
  }

  async updateRateLimitHeaders(channelId, apiKey, model, headerInfo) {
    if (!headerInfo) return;
    const date = this._todayKey();
    const { kvKey, data } = await this._loadRateLimitData(channelId, date);
    const kid = this._keyId(apiKey);
    const entry = this._ensureRateLimitEntry(data, kid);

    const now = Date.now();
    const userLimit = Number.isFinite(headerInfo.user_limit) ? headerInfo.user_limit : undefined;
    const userRemaining = Number.isFinite(headerInfo.user_remaining) ? headerInfo.user_remaining : undefined;
    const modelLimit = Number.isFinite(headerInfo.model_limit) ? headerInfo.model_limit : undefined;
    const modelRemaining = Number.isFinite(headerInfo.model_remaining) ? headerInfo.model_remaining : undefined;

    if (userLimit !== undefined) entry.header.user_limit = userLimit;
    if (userRemaining !== undefined) entry.header.user_remaining = userRemaining;
    entry.header.updated_at = now;

    if (model && (modelLimit !== undefined || modelRemaining !== undefined)) {
      const old = entry.header.model_limits[model] || {};
      entry.header.model_limits[model] = {
        limit: modelLimit !== undefined ? modelLimit : old.limit,
        remaining: modelRemaining !== undefined ? modelRemaining : old.remaining,
        updated_at: now,
      };
    }

    // If upstream now reports remaining > 0, clear stale daily-block mark.
    if (model && modelRemaining !== undefined && modelRemaining > 0) {
      entry.daily_models = entry.daily_models.filter(m => m !== model);
    }

    await this._saveRateLimitData(kvKey, data);
  }

  async getRateLimits(channelId, date) {
    const { data } = await this._loadRateLimitData(channelId, date);
    return data;
  }

  isRateLimitedWithData(apiKey, model, rateLimitData) {
    const kid = this._keyId(apiKey);
    const entry = this._normalizeRateLimitData(rateLimitData)[kid];
    if (!entry) return false;

    if (entry.daily_models.includes(model) || entry.daily_models.includes('*')) return true;

    const now = Date.now();
    const modelUntil = Number(entry.cooldowns?.[model]) || 0;
    const globalUntil = Number(entry.cooldowns?.['*']) || 0;
    return modelUntil > now || globalUntil > now;
  }

  getRateLimitInfoWithData(apiKey, rateLimitData) {
    const kid = this._keyId(apiKey);
    const entry = this._normalizeRateLimitData(rateLimitData)[kid];
    if (!entry) {
      return {
        daily_models: [],
        cooldowns: {},
        header: { model_limits: {} },
      };
    }
    return entry;
  }

  getModelHeaderLimitWithData(apiKey, model, rateLimitData) {
    const info = this.getRateLimitInfoWithData(apiKey, rateLimitData);
    const hit = info?.header?.model_limits?.[model];
    if (!hit || !Number.isFinite(hit.limit)) return 0;
    return hit.limit;
  }

  getUserHeaderLimitWithData(apiKey, rateLimitData) {
    const info = this.getRateLimitInfoWithData(apiKey, rateLimitData);
    const limit = info?.header?.user_limit;
    return Number.isFinite(limit) ? limit : 0;
  }

  checkQuotaWithData(channel, apiKey, model, usageData, rateLimitData = {}) {
    const kid = this._keyId(apiKey);
    const keyUsage = usageData[kid] || { total: 0, models: {} };

    // Priority 1: upstream live limits from response headers
    const upstreamTotalLimit = this.getUserHeaderLimitWithData(apiKey, rateLimitData);
    const upstreamModelLimit = model ? this.getModelHeaderLimitWithData(apiKey, model, rateLimitData) : 0;

    if (upstreamTotalLimit > 0 && keyUsage.total >= upstreamTotalLimit) {
      return { allowed: false, reason: 'daily_total' };
    }
    if (model && upstreamModelLimit > 0 && (keyUsage.models[model] || 0) >= upstreamModelLimit) {
      return { allowed: false, reason: 'model_limit' };
    }

    // Priority 2: local fallback limits from channel settings
    if (!channel.quota_enabled) return { allowed: true };

    if (channel.quota_daily_total > 0 && keyUsage.total >= channel.quota_daily_total) {
      return { allowed: false, reason: 'daily_total' };
    }
    if (model && channel.quota_daily_per_model > 0 &&
        (keyUsage.models[model] || 0) >= channel.quota_daily_per_model) {
      return { allowed: false, reason: 'model_limit' };
    }

    return { allowed: true };
  }
}

export function createStore(kv) {
  return new KVStore(kv);
}

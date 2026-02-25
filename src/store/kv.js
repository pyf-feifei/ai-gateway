const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    return new Date().toISOString().slice(0, 10);
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

  // ── Per-channel model cache (populated by /models and LoadBalancer) ──

  async getModelCache(channelId) {
    return await this.get(`model-cache:${channelId}`);
  }

  async setModelCache(channelId, modelIds) {
    await this.set(`model-cache:${channelId}`, modelIds);
  }

  invalidateModelCache(channelId) {
    this.invalidate(`model-cache:${channelId}`);
  }

  checkQuotaWithData(channel, apiKey, model, usageData) {
    if (!channel.quota_enabled) return { allowed: true };
    const kid = this._keyId(apiKey);
    const keyUsage = usageData[kid] || { total: 0, models: {} };

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

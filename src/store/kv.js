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

  // ── Usage tracking (bypass cache for freshness) ──

  _todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  async getUsage(channelId, date) {
    const key = `usage:${channelId}:${date || this._todayKey()}`;
    try {
      return (await this.kv.get(key, 'json')) || { total: 0, models: {} };
    } catch {
      return { total: 0, models: {} };
    }
  }

  async incrementUsage(channelId, model) {
    const date = this._todayKey();
    const key = `usage:${channelId}:${date}`;
    const usage = await this.getUsage(channelId, date);
    usage.total += 1;
    if (model) {
      usage.models[model] = (usage.models[model] || 0) + 1;
    }
    await this.kv.put(key, JSON.stringify(usage));
    return usage;
  }

  async checkQuota(channel, model) {
    if (!channel.quota_enabled) return { allowed: true };
    const usage = await this.getUsage(channel.id);

    if (channel.quota_daily_total > 0 && usage.total >= channel.quota_daily_total) {
      return { allowed: false, reason: 'daily_total', usage };
    }
    if (model && channel.quota_daily_per_model > 0 &&
        (usage.models[model] || 0) >= channel.quota_daily_per_model) {
      return { allowed: false, reason: 'model_limit', usage };
    }
    return { allowed: true, usage };
  }
}

export function createStore(kv) {
  return new KVStore(kv);
}

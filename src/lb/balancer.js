export class LoadBalancer {
  constructor(store) {
    this.store = store;
  }

  /**
   * Select ordered list of targets for a given model.
   * Targets are ordered by: priority group → weighted shuffle → round-robin keys.
   * The caller should try them in order (failover).
   * @param {string} model
   * @param {string[]|null} allowedChannelIds - if set, only these channels are used
   */
  async selectTarget(model, allowedChannelIds = null) {
    const channels = await this.store.getChannels();
    let enabled = channels.filter(ch => ch.enabled && ch.keys?.length > 0);

    if (allowedChannelIds && allowedChannelIds.length > 0) {
      enabled = enabled.filter(ch => allowedChannelIds.includes(ch.id));
    }

    // For channels without a configured model list, resolve their actual models
    // from the cache (populated by /v1/models) or by fetching upstream on demand.
    const discoveredModels = new Map();
    const needDiscovery = enabled.filter(ch => !ch.models || ch.models.length === 0);
    if (needDiscovery.length > 0) {
      await Promise.all(needDiscovery.map(async ch => {
        let cached = await this.store.getModelCache(ch.id);
        if (!cached) {
          cached = await this._fetchUpstreamModels(ch);
          if (cached && cached.length > 0) {
            await this.store.setModelCache(ch.id, cached).catch(() => {});
          }
        }
        if (cached && cached.length > 0) {
          discoveredModels.set(ch.id, cached);
        }
      }));
    }

    let compatible = enabled.filter(ch => {
      if (ch.models && ch.models.length > 0) {
        return ch.models.some(m => m === model || model.startsWith(m));
      }
      const cached = discoveredModels.get(ch.id);
      if (cached) {
        return cached.some(m => m === model || model.startsWith(m));
      }
      return true; // no info available yet, accept as fallback
    });

    // Stale model cache? Invalidate and re-discover from upstream, then retry.
    if (compatible.length === 0 && needDiscovery.length > 0) {
      for (const ch of needDiscovery) {
        this.store.invalidateModelCache(ch.id);
      }
      discoveredModels.clear();
      await Promise.all(needDiscovery.map(async ch => {
        const fresh = await this._fetchUpstreamModels(ch);
        if (fresh && fresh.length > 0) {
          await this.store.setModelCache(ch.id, fresh).catch(() => {});
          discoveredModels.set(ch.id, fresh);
        }
      }));
      compatible = enabled.filter(ch => {
        if (ch.models && ch.models.length > 0) {
          return ch.models.some(m => m === model || model.startsWith(m));
        }
        const cached = discoveredModels.get(ch.id);
        if (cached) {
          return cached.some(m => m === model || model.startsWith(m));
        }
        return true;
      });
    }

    if (compatible.length === 0) {
      return { targets: [], error: 'No available channel for model: ' + model };
    }

    // Pre-load usage data and rate-limit data in parallel
    const usageMap = new Map();
    const rateLimitMap = new Map();
    const preloadTasks = [];
    // Usage is needed for both upstream header-based limits and local fallback quota.
    for (const ch of compatible) {
      preloadTasks.push(
        this.store.getUsage(ch.id).then(d => usageMap.set(ch.id, d))
      );
    }
    for (const ch of compatible) {
      preloadTasks.push(
        this.store.getRateLimits(ch.id).then(d => rateLimitMap.set(ch.id, d))
      );
    }
    if (preloadTasks.length > 0) {
      await Promise.all(preloadTasks);
    }

    // Group by priority (lower number = higher priority)
    const groups = {};
    for (const ch of compatible) {
      const p = ch.priority ?? 0;
      if (!groups[p]) groups[p] = [];
      groups[p].push(ch);
    }

    const priorities = Object.keys(groups).map(Number).sort((a, b) => a - b);

    // Build ordered target list
    const allTargets = [];
    for (const p of priorities) {
      const group = groups[p];
      const sorted = this.weightedShuffle(group);
      for (const ch of sorted) {
        const keys = await this.getOrderedKeys(ch);
        for (const key of keys) {
          allTargets.push({ channel: ch, key });
        }
      }
    }

    // Filter targets by 429 rate-limit and per-key quota
    const targets = allTargets.filter(t => {
      const rlData = rateLimitMap.get(t.channel.id) || {};
      if (this.store.isRateLimitedWithData(t.key, model, rlData)) return false;
      const usageData = usageMap.get(t.channel.id) || {};
      return this.store.checkQuotaWithData(t.channel, t.key, model, usageData, rlData).allowed;
    });

    if (targets.length === 0 && allTargets.length > 0) {
      return { targets: [], error: 'All keys have exceeded their quota or rate limits for model: ' + model };
    }

    if (targets.length === 0) {
      return { targets: [], error: 'No available channel for model: ' + model };
    }

    return { targets };
  }

  /**
   * Weighted random shuffle: channels with higher weight
   * have proportionally higher chance of being picked first.
   */
  weightedShuffle(channels) {
    const items = channels.map(ch => ({ ch, w: ch.weight || 1 }));
    const result = [];
    while (items.length > 0) {
      const total = items.reduce((sum, i) => sum + i.w, 0);
      let rand = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < items.length; i++) {
        rand -= items[i].w;
        if (rand <= 0) { idx = i; break; }
      }
      result.push(items[idx].ch);
      items.splice(idx, 1);
    }
    return result;
  }

  /**
   * Fetch the model list from a channel's upstream /models endpoint.
   * Returns an array of model ID strings, or null on failure.
   */
  async _fetchUpstreamModels(ch) {
    if (!ch.keys?.length) return null;
    const baseUrl = ch.base_url.replace(/\/+$/, '');
    try {
      const resp = await fetch(baseUrl + '/models', {
        headers: { 'Authorization': `Bearer ${ch.keys[0]}` },
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data?.data && Array.isArray(data.data)) {
        return data.data.map(m => m.id);
      }
    } catch (e) {
      console.warn(`[lb] Failed to fetch models from ${ch.name}:`, e.message);
    }
    return null;
  }

  /**
   * Key order within a channel: random start then round-robin order.
   * Uses random start to avoid race on shared RR counter under concurrency;
   * still returns keys in a deterministic cyclic order for failover.
   */
  async getOrderedKeys(channel) {
    const keys = channel.keys || [];
    if (keys.length === 0) return [];

    // Random start index — concurrency-safe, no shared counter read-modify-write
    const start = Math.floor(Math.random() * keys.length);

    const ordered = [];
    for (let i = 0; i < keys.length; i++) {
      ordered.push(keys[(start + i) % keys.length]);
    }
    return ordered;
  }
}

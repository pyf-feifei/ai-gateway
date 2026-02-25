export class LoadBalancer {
  constructor(store) {
    this.store = store;
  }

  /**
   * Select ordered list of targets for a given model.
   * Targets are ordered by: priority group → weighted shuffle → round-robin keys.
   * The caller should try them in order (failover).
   */
  async selectTarget(model) {
    const channels = await this.store.getChannels();
    const enabled = channels.filter(ch => ch.enabled && ch.keys?.length > 0);

    // Filter channels that support this model
    const compatible = enabled.filter(ch => {
      if (!ch.models || ch.models.length === 0) return true; // accepts all
      return ch.models.some(m => m === model || model.startsWith(m));
    });

    if (compatible.length === 0) {
      return { targets: [], error: 'No available channel for model: ' + model };
    }

    // Pre-load usage data for quota-enabled channels (one KV read per channel)
    const usageMap = new Map();
    const quotaChannels = compatible.filter(ch => ch.quota_enabled);
    if (quotaChannels.length > 0) {
      await Promise.all(
        quotaChannels.map(async ch => {
          usageMap.set(ch.id, await this.store.getUsage(ch.id));
        })
      );
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

    // Filter targets by per-key quota
    const targets = allTargets.filter(t => {
      if (!t.channel.quota_enabled) return true;
      const usageData = usageMap.get(t.channel.id) || {};
      return this.store.checkQuotaWithData(t.channel, t.key, model, usageData).allowed;
    });

    if (targets.length === 0 && allTargets.length > 0) {
      return { targets: [], error: 'All keys have exceeded their quota limits for model: ' + model };
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

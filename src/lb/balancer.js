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

    // Filter out channels that exceeded their quota
    const quotaResults = await Promise.all(
      compatible.map(ch => this.store.checkQuota(ch, model))
    );
    const withinQuota = compatible.filter((_, i) => quotaResults[i].allowed);

    if (withinQuota.length === 0) {
      const overQuota = quotaResults.find(r => !r.allowed);
      const reason = overQuota?.reason === 'model_limit'
        ? `Model "${model}" has reached its daily per-model limit`
        : 'Daily total quota exceeded for all available channels';
      return { targets: [], error: reason };
    }

    // Group by priority (lower number = higher priority)
    const groups = {};
    for (const ch of withinQuota) {
      const p = ch.priority ?? 0;
      if (!groups[p]) groups[p] = [];
      groups[p].push(ch);
    }

    const priorities = Object.keys(groups).map(Number).sort((a, b) => a - b);

    // Build ordered target list
    const targets = [];
    for (const p of priorities) {
      const group = groups[p];
      const sorted = this.weightedShuffle(group);
      for (const ch of sorted) {
        const keys = await this.getOrderedKeys(ch);
        for (const key of keys) {
          targets.push({ channel: ch, key });
        }
      }
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

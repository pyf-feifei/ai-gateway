export async function handleAdminApi(request, env, store) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/admin/api', '');
  const method = request.method;

  try {
    // --- Channels ---
    if (path === '/channels' && method === 'GET') {
      return jsonRes(await store.getChannels());
    }

    if (path === '/channels' && method === 'POST') {
      const data = await request.json();
      if (!data.name || !data.base_url) {
        return jsonRes({ error: 'name and base_url are required' }, 400);
      }
      const channels = await store.getChannels();
      const channel = {
        id: crypto.randomUUID(),
        name: data.name.trim(),
        base_url: data.base_url.trim(),
        keys: Array.isArray(data.keys) ? data.keys.filter(Boolean) : [],
        models: Array.isArray(data.models) ? data.models.filter(Boolean) : [],
        enabled: data.enabled !== false,
        priority: parseInt(data.priority) || 0,
        weight: Math.max(1, parseInt(data.weight) || 1),
        quota_enabled: !!data.quota_enabled,
        quota_daily_total: Math.max(0, parseInt(data.quota_daily_total) || 0),
        quota_daily_per_model: Math.max(0, parseInt(data.quota_daily_per_model) || 0),
        created_at: new Date().toISOString(),
      };
      channels.push(channel);
      await store.saveChannels(channels);
      return jsonRes(channel, 201);
    }

    // Match /channels/:id
    const chMatch = path.match(/^\/channels\/([^/]+)$/);
    if (chMatch) {
      const id = chMatch[1];

      if (method === 'PUT') {
        const data = await request.json();
        const channels = await store.getChannels();
        const idx = channels.findIndex(ch => ch.id === id);
        if (idx === -1) return jsonRes({ error: 'Channel not found' }, 404);

        const ch = channels[idx];
        channels[idx] = {
          ...ch,
          name: data.name?.trim() ?? ch.name,
          base_url: data.base_url?.trim() ?? ch.base_url,
          keys: Array.isArray(data.keys) ? data.keys.filter(Boolean) : ch.keys,
          models: Array.isArray(data.models) ? data.models.filter(Boolean) : ch.models,
          enabled: data.enabled ?? ch.enabled,
          priority: data.priority !== undefined ? (parseInt(data.priority) || 0) : ch.priority,
          weight: data.weight !== undefined ? Math.max(1, parseInt(data.weight) || 1) : ch.weight,
          quota_enabled: data.quota_enabled !== undefined ? !!data.quota_enabled : (ch.quota_enabled || false),
          quota_daily_total: data.quota_daily_total !== undefined ? Math.max(0, parseInt(data.quota_daily_total) || 0) : (ch.quota_daily_total || 0),
          quota_daily_per_model: data.quota_daily_per_model !== undefined ? Math.max(0, parseInt(data.quota_daily_per_model) || 0) : (ch.quota_daily_per_model || 0),
          id,
        };
        await store.saveChannels(channels);
        store.invalidateModelCache(id);
        return jsonRes(channels[idx]);
      }

      if (method === 'DELETE') {
        const channels = await store.getChannels();
        const filtered = channels.filter(ch => ch.id !== id);
        if (filtered.length === channels.length) return jsonRes({ error: 'Channel not found' }, 404);
        await store.saveChannels(filtered);
        store.invalidateModelCache(id);
        return jsonRes({ success: true });
      }
    }

    // Match /channels/:id/toggle
    const toggleMatch = path.match(/^\/channels\/([^/]+)\/toggle$/);
    if (toggleMatch && method === 'PATCH') {
      const id = toggleMatch[1];
      const channels = await store.getChannels();
      const idx = channels.findIndex(ch => ch.id === id);
      if (idx === -1) return jsonRes({ error: 'Channel not found' }, 404);
      channels[idx].enabled = !channels[idx].enabled;
      await store.saveChannels(channels);
      return jsonRes(channels[idx]);
    }

    // --- Usage (所有渠道，不再限制仅 quota_enabled) ---
    if (path === '/usage' && method === 'GET') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const channels = await store.getChannels();
      const usageData = await Promise.all(
        channels.map(async ch => {
          const rawUsage = await store.getUsage(ch.id, date);
          const rawRate = await store.getRateLimits(ch.id, date);
          const keys = (ch.keys || []).map(k => {
            const kid = k.slice(-8);
            const usage = rawUsage[kid] || { total: 0, models: {} };
            const rateInfo = store.getRateLimitInfoWithData(k, rawRate);
            const upstreamTotalLimit = Number.isFinite(rateInfo?.header?.user_limit) ? rateInfo.header.user_limit : 0;
            const upstreamModelLimits = {};
            for (const [m, d] of Object.entries(rateInfo?.header?.model_limits || {})) {
              if (Number.isFinite(d?.limit) && d.limit > 0) upstreamModelLimits[m] = d.limit;
            }
            const fallbackTotalLimit = ch.quota_enabled ? (ch.quota_daily_total || 0) : 0;
            const fallbackModelLimit = ch.quota_enabled ? (ch.quota_daily_per_model || 0) : 0;
            return {
              key_id: kid,
              key_hint: k.length > 12 ? k.slice(0, 7) + '...' + k.slice(-4) : k,
              usage,
              limits: {
                total_limit: upstreamTotalLimit > 0 ? upstreamTotalLimit : fallbackTotalLimit,
                total_source: upstreamTotalLimit > 0 ? 'upstream' : (fallbackTotalLimit > 0 ? 'channel' : 'none'),
                default_model_limit: fallbackModelLimit,
                model_limits: upstreamModelLimits,
                model_source: Object.keys(upstreamModelLimits).length > 0 ? 'upstream' : (fallbackModelLimit > 0 ? 'channel' : 'none'),
              },
              rate_state: {
                daily_models: rateInfo?.daily_models || [],
                cooldowns: rateInfo?.cooldowns || {},
              },
            };
          });
          return {
            channel_id: ch.id,
            channel_name: ch.name,
            enabled: ch.enabled,
            quota_enabled: !!ch.quota_enabled,
            quota_daily_total: ch.quota_daily_total || 0,
            quota_daily_per_model: ch.quota_daily_per_model || 0,
            keys,
          };
        })
      );
      return jsonRes({ date, channels: usageData });
    }

    // --- API Key Usage (客户端密钥用量统计) ---
    if (path === '/apikeys/usage' && method === 'GET') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const rawUsage = await store.getApiKeyUsage(date);
      return jsonRes({ date, keys: rawUsage });
    }

    // --- Error Logs ---
    if (path === '/errors' && method === 'GET') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const channels = await store.getChannels();
      const errorData = await Promise.all(
        channels.map(async ch => ({
          channel_id: ch.id,
          channel_name: ch.name,
          errors: await store.getErrors(ch.id, date),
        }))
      );
      return jsonRes({ date, channels: errorData.filter(d => d.errors.length > 0) });
    }

    // --- API Keys ---
    if (path === '/apikeys' && method === 'GET') {
      return jsonRes(await store.getApiKeys());
    }

    if (path === '/apikeys' && method === 'POST') {
      const data = await request.json();
      const keys = await store.getApiKeys();
      const apiKey = {
        id: crypto.randomUUID(),
        name: data.name?.trim() || 'Unnamed',
        key: generateApiKeyString(),
        channel_ids: Array.isArray(data.channel_ids) ? data.channel_ids.filter(Boolean) : [],
        enabled: true,
        created_at: new Date().toISOString(),
      };
      keys.push(apiKey);
      await store.saveApiKeys(keys);
      return jsonRes(apiKey, 201);
    }

    // Match /apikeys/:id
    const keyMatch = path.match(/^\/apikeys\/([^/]+)$/);
    if (keyMatch) {
      const id = keyMatch[1];

      if (method === 'DELETE') {
        const keys = await store.getApiKeys();
        const filtered = keys.filter(k => k.id !== id);
        if (filtered.length === keys.length) return jsonRes({ error: 'API key not found' }, 404);
        await store.saveApiKeys(filtered);
        return jsonRes({ success: true });
      }

      if (method === 'PATCH') {
        const data = await request.json();
        const keys = await store.getApiKeys();
        const idx = keys.findIndex(k => k.id === id);
        if (idx === -1) return jsonRes({ error: 'API key not found' }, 404);
        if (data.enabled !== undefined) keys[idx].enabled = data.enabled;
        if (data.name !== undefined) keys[idx].name = data.name.trim();
        if (data.channel_ids !== undefined) keys[idx].channel_ids = Array.isArray(data.channel_ids) ? data.channel_ids.filter(Boolean) : [];
        await store.saveApiKeys(keys);
        return jsonRes(keys[idx]);
      }
    }

    return jsonRes({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('Admin API error:', err);
    return jsonRes({ error: err.message || 'Internal error' }, 500);
  }
}

function generateApiKeyString() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'sk-' + hex;
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

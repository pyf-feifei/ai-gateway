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
        return jsonRes(channels[idx]);
      }

      if (method === 'DELETE') {
        const channels = await store.getChannels();
        const filtered = channels.filter(ch => ch.id !== id);
        if (filtered.length === channels.length) return jsonRes({ error: 'Channel not found' }, 404);
        await store.saveChannels(filtered);
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

    // --- Usage ---
    if (path === '/usage' && method === 'GET') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const channels = await store.getChannels();
      const quotaChannels = channels.filter(ch => ch.quota_enabled);
      const usageData = await Promise.all(
        quotaChannels.map(async ch => {
          const usage = await store.getUsage(ch.id, date);
          return {
            channel_id: ch.id,
            channel_name: ch.name,
            enabled: ch.enabled,
            quota_daily_total: ch.quota_daily_total,
            quota_daily_per_model: ch.quota_daily_per_model,
            models: ch.models || [],
            usage,
          };
        })
      );
      return jsonRes({ date, channels: usageData });
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

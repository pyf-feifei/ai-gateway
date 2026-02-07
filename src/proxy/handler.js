import { verifyApiKey } from './auth.js';
import { LoadBalancer } from '../lb/balancer.js';
import { claudeToOpenAI, openAIToClaude, openAIStreamToClaudeStream } from './claude.js';

export async function handleProxy(request, env, store) {
  // Verify client API key
  const authResult = await verifyApiKey(request, store);
  if (!authResult.valid) {
    return jsonRes({
      error: { message: authResult.error, type: 'invalid_request_error' }
    }, 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // GET /v1/models
  if (path.endsWith('/models') && request.method === 'GET') {
    return handleModels(store);
  }

  // Only POST for completions / embeddings / messages
  if (request.method !== 'POST') {
    return jsonRes({ error: { message: 'Method not allowed' } }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: { message: 'Invalid JSON body' } }, 400);
  }

  // ---- Claude Messages API (/v1/messages) ----
  if (path.endsWith('/messages')) {
    return handleClaudeMessages(request, url, body, store);
  }

  // ---- OpenAI-compatible passthrough ----
  return handleOpenAIProxy(request, url, path, body, store);
}

// ─── Claude Messages API handler ───────────────────────────────────

async function handleClaudeMessages(request, url, claudeBody, store) {
  const model = claudeBody.model || '';
  const isStream = claudeBody.stream || false;

  // Convert Claude request to OpenAI format
  const openaiBody = claudeToOpenAI(claudeBody);

  const lb = new LoadBalancer(store);
  const { targets, error } = await lb.selectTarget(model);

  if (error || targets.length === 0) {
    // Return error in Claude format
    return claudeErrorRes(error || 'No available channel for model: ' + model, 503);
  }

  let lastError = null;
  for (const target of targets) {
    try {
      const baseUrl = target.channel.base_url.replace(/\/+$/, '');
      const targetUrl = baseUrl + '/chat/completions' + url.search;

      console.log(`[proxy][claude] -> ${target.channel.name} ${targetUrl}`);

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Authorization', `Bearer ${target.key}`);
      if (isStream) headers.set('Accept', 'text/event-stream');

      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(openaiBody),
      });

      if (resp.ok || resp.status < 500) {
        if (!resp.ok) {
          // 4xx from upstream — forward as Claude-shaped error
          const errBody = await resp.text();
          return claudeErrorRes(`Upstream error: ${errBody}`, resp.status);
        }

        // ---- Streaming ----
        if (isStream) {
          const claudeStream = openAIStreamToClaudeStream(resp.body, model);
          return new Response(claudeStream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        // ---- Non-streaming ----
        const openaiData = await resp.json();
        const claudeResponse = openAIToClaude(openaiData, model);
        return jsonRes(claudeResponse, 200);
      }

      // 5xx — try next target
      lastError = `${target.channel.name}: HTTP ${resp.status}`;
      console.error(`[proxy][claude] target failed: ${lastError}`);
    } catch (err) {
      lastError = `${target.channel.name}: ${err.message}`;
      console.error(`[proxy][claude] target error: ${lastError}`);
    }
  }

  return claudeErrorRes(`All targets failed. Last error: ${lastError}`, 502);
}

// ─── OpenAI passthrough handler ────────────────────────────────────

async function handleOpenAIProxy(request, url, path, body, store) {
  const model = body.model || '';
  const lb = new LoadBalancer(store);
  const { targets, error } = await lb.selectTarget(model);

  if (error || targets.length === 0) {
    return jsonRes({
      error: { message: error || 'No available channel', type: 'server_error' }
    }, 503);
  }

  // Strip /v1 prefix, keep the rest (e.g. /chat/completions)
  const upstreamPath = path.replace(/^\/v1/, '');

  // Try each target in order (failover on 5xx / network error)
  let lastError = null;
  for (const target of targets) {
    try {
      const baseUrl = target.channel.base_url.replace(/\/+$/, '');
      const targetUrl = baseUrl + upstreamPath + url.search;

      console.log(`[proxy] -> ${target.channel.name} ${targetUrl}`);

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Authorization', `Bearer ${target.key}`);

      // Forward Accept header (important for streaming)
      const accept = request.headers.get('Accept');
      if (accept) headers.set('Accept', accept);

      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      // Success or client-side error (4xx) — return immediately, don't retry
      if (resp.ok || resp.status < 500) {
        const respHeaders = new Headers();
        const ct = resp.headers.get('Content-Type');
        if (ct) respHeaders.set('Content-Type', ct);
        respHeaders.set('Access-Control-Allow-Origin', '*');

        if (body.stream) {
          respHeaders.set('Cache-Control', 'no-cache');
        }

        return new Response(resp.body, {
          status: resp.status,
          headers: respHeaders,
        });
      }

      // 5xx — try next target
      lastError = `${target.channel.name}: HTTP ${resp.status}`;
      console.error(`[proxy] target failed: ${lastError}`);
    } catch (err) {
      lastError = `${target.channel.name}: ${err.message}`;
      console.error(`[proxy] target error: ${lastError}`);
    }
  }

  return jsonRes({
    error: {
      message: `All targets failed. Last error: ${lastError}`,
      type: 'server_error',
    }
  }, 502);
}

async function handleModels(store) {
  const channels = await store.getChannels();
  const enabled = channels.filter(ch => ch.enabled);

  // Collect models: use configured list if available, otherwise fetch from upstream
  const allModels = []; // { id, owned_by }

  const fetchPromises = enabled.map(async (ch) => {
    if (ch.models?.length > 0) {
      // Use explicitly configured models
      return ch.models.map(m => ({ id: m, owned_by: ch.name }));
    }

    // Fetch from upstream /models endpoint
    if (!ch.keys?.length) return [];
    const baseUrl = ch.base_url.replace(/\/+$/, '');
    try {
      const resp = await fetch(baseUrl + '/models', {
        headers: { 'Authorization': `Bearer ${ch.keys[0]}` },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      if (data?.data && Array.isArray(data.data)) {
        return data.data.map(m => ({
          id: m.id,
          owned_by: m.owned_by || ch.name,
        }));
      }
      return [];
    } catch {
      console.error(`[models] Failed to fetch models from ${ch.name}`);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  const modelMap = new Map(); // deduplicate by model id
  for (const models of results) {
    for (const m of models) {
      if (!modelMap.has(m.id)) {
        modelMap.set(m.id, m);
      }
    }
  }

  return jsonRes({
    object: 'list',
    data: Array.from(modelMap.values()).map(m => ({
      id: m.id,
      object: 'model',
      created: 0,
      owned_by: m.owned_by,
    })),
  });
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function claudeErrorRes(message, status = 500) {
  return new Response(JSON.stringify({
    type: 'error',
    error: {
      type: 'api_error',
      message,
    },
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

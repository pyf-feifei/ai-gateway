/**
 * Node.js HTTP server entry point for running AI Gateway outside Cloudflare Workers.
 * Bridges Node.js HTTP to Web Standard Request/Response used by the worker handler.
 *
 * Usage:
 *   ADMIN_PASSWORD=your-password node server.js
 *
 * Environment variables:
 *   PORT           - Listen port (default: 7860, required by HF Spaces)
 *   ADMIN_PASSWORD - Admin panel password
 *   DATA_DIR       - Directory for persistent data (default: ./data)
 */

import { createServer } from 'node:http';
import worker from './src/index.js';
import { FileKV } from './src/store/file-kv.js';

const PORT = parseInt(process.env.PORT || '7860');

// Create file-based KV storage (drop-in replacement for Cloudflare KV)
const fileKV = new FileKV();

// Simulate the Cloudflare Worker `env` object
const env = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  KV: fileKV,
};

const server = createServer(async (req, res) => {
  try {
    // --- Build Web Standard Request from Node.js IncomingMessage ---
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `${protocol}://${host}${req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value != null) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      }
    }

    const method = req.method || 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

    let body = null;
    if (hasBody) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    const request = new Request(url, { method, headers, body });

    // --- Call the worker handler ---
    const response = await worker.fetch(request, env);

    // --- Convert Web Standard Response to Node.js ServerResponse ---
    const respHeaders = {};
    response.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });
    res.writeHead(response.status, respHeaders);

    if (response.body) {
      // Stream the response body (important for SSE)
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    res.end();
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

server.listen(PORT, () => {
  console.log(`AI Gateway running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  if (!env.ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD not set. Set it via environment variable.');
  }
});

/**
 * File-based KV storage that implements the same interface as Cloudflare KV.
 * Used when running outside Cloudflare Workers (e.g. Node.js / Docker / HF Spaces).
 *
 * Interface:
 *   await kv.get(key, 'json') -> parsed object or null
 *   await kv.get(key)         -> string or null
 *   await kv.put(key, value)  -> void
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class FileKV {
  constructor(dataDir) {
    this.dataDir = dataDir || process.env.DATA_DIR || './data';
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _filePath(key) {
    // Make key filesystem-safe
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dataDir, safe + '.json');
  }

  async get(key, format) {
    try {
      const raw = readFileSync(this._filePath(key), 'utf8');
      if (format === 'json') {
        return JSON.parse(raw);
      }
      return raw;
    } catch {
      return null;
    }
  }

  async put(key, value) {
    writeFileSync(this._filePath(key), String(value), 'utf8');
  }
}

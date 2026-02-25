/**
 * PostgreSQL-based KV storage that implements the same interface as Cloudflare KV / FileKV.
 * Used for persistent storage on platforms with ephemeral filesystems (e.g. HF Spaces).
 *
 * Interface:
 *   await kv.get(key, 'json') -> parsed object or null
 *   await kv.get(key)         -> string or null
 *   await kv.put(key, value)  -> void
 */

import pg from 'pg';
const { Pool } = pg;

export class PgKV {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30_000,
    });
    this._ready = this._init();
  }

  async _init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  async get(key, format) {
    await this._ready;
    const { rows } = await this.pool.query(
      'SELECT value FROM kv_store WHERE key = $1',
      [key],
    );
    if (rows.length === 0) return null;
    const raw = rows[0].value;
    if (format === 'json') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw;
  }

  async put(key, value) {
    await this._ready;
    await this.pool.query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value)],
    );
  }
}

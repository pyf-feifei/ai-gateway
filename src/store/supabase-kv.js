/**
 * Supabase REST API-based KV storage. Uses PostgREST over HTTPS,
 * avoiding IPv6/direct-connection issues on platforms like HF Spaces.
 *
 * Requires a `kv_store` table in Supabase (auto-created on first use via RPC).
 *
 * Interface (same as Cloudflare KV / FileKV):
 *   await kv.get(key, 'json') -> parsed object or null
 *   await kv.get(key)         -> string or null
 *   await kv.put(key, value)  -> void
 */

export class SupabaseKV {
  constructor(supabaseUrl, supabaseKey) {
    this.restUrl = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
    this.headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    };
    this._ready = this._ensureTable(supabaseUrl, supabaseKey);
  }

  async _ensureTable(supabaseUrl, key) {
    const rpcUrl = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/exec_sql`;

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        query: `CREATE TABLE IF NOT EXISTS kv_store (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
      }),
    });

    if (res.ok) return;

    // If the RPC function doesn't exist, try a test read instead.
    // Table might already exist — verify by querying it.
    const probe = await fetch(`${this.restUrl}/kv_store?select=key&limit=0`, {
      headers: this.headers,
    });

    if (probe.ok) return;

    console.error(
      'kv_store table does not exist. Please create it in Supabase SQL Editor:\n' +
        'CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());',
    );
  }

  async get(key, format) {
    await this._ready;
    const url = `${this.restUrl}/kv_store?key=eq.${encodeURIComponent(key)}&select=value`;
    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;

    const raw = rows[0].value;
    if (format === 'json') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw;
  }

  async put(key, value) {
    await this._ready;
    await fetch(`${this.restUrl}/kv_store`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        key,
        value: String(value),
        updated_at: new Date().toISOString(),
      }),
    });
  }
}

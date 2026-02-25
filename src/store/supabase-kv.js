/**
 * Supabase Storage-based KV. Stores each key as a JSON file in a private bucket.
 * Works entirely over HTTPS — no IPv6 / direct PG connection issues.
 *
 * Interface (same as Cloudflare KV / FileKV):
 *   await kv.get(key, 'json') -> parsed object or null
 *   await kv.get(key)         -> string or null
 *   await kv.put(key, value)  -> void
 */

const BUCKET = 'kv-store';

export class SupabaseKV {
  constructor(supabaseUrl, supabaseKey) {
    this.storageUrl = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1`;
    this.headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    };
    this._ready = this._ensureBucket();
  }

  async _ensureBucket() {
    const res = await fetch(`${this.storageUrl}/bucket/${BUCKET}`, {
      headers: this.headers,
    });
    if (res.ok) return;

    await fetch(`${this.storageUrl}/bucket`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    });
  }

  _objectUrl(key) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${this.storageUrl}/object/${BUCKET}/${safe}.json`;
  }

  async get(key, format) {
    await this._ready;
    const res = await fetch(this._objectUrl(key), { headers: this.headers });
    if (!res.ok) return null;

    const raw = await res.text();
    if (format === 'json') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw;
  }

  async put(key, value) {
    await this._ready;
    await fetch(this._objectUrl(key), {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: String(value),
    });
  }
}

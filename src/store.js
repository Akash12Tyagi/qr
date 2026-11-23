'use strict';
// Key/value storage shared by every tenant, behind one async API:
//   read(key)                 → document or null
//   mutate(key, fn, init)     → runs fn(doc) under a per-key lock, persists, returns fn's result
//   withLock(name, fn)        → exclusive section (used once, for first-boot bootstrap/migration)
//   readLegacy()              → the pre-SaaS single-restaurant state, if any (never modified)
//
// Keys: "platform" (tenants + accounts) and "t:<tenantId>" (one restaurant's state).
// Postgres: one row per key in kv_store; writes run in a transaction holding the row lock,
// so concurrent serverless instances can never overwrite each other's orders.
// Local: one JSON file per key under data/store (or pure memory for tests).

const fs = require('fs');
const path = require('path');

const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FileKV {
  constructor(dir, legacyFile) {
    this.dir = dir;               // null → in-memory (tests)
    this.legacyFile = legacyFile;
    this.mem = new Map();
    this.queues = new Map();
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  fileOf(key) { return path.join(this.dir, `${encodeURIComponent(key)}.json`); }

  load(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    let doc = null;
    if (this.dir) {
      try { doc = JSON.parse(fs.readFileSync(this.fileOf(key), 'utf8')); } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    if (doc !== null) this.mem.set(key, doc);
    return doc;
  }

  save(key, doc) {
    this.mem.set(key, doc);
    if (!this.dir) return;
    const file = this.fileOf(key);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
  }

  serial(name, task) {
    const prev = this.queues.get(name) || Promise.resolve();
    const run = prev.then(task);
    this.queues.set(name, run.catch(() => {}));
    return run;
  }

  async read(key) { return clone(this.load(key)); }

  mutate(key, fn, init) {
    return this.serial(`k:${key}`, async () => {
      let doc = clone(this.load(key));
      if (doc === null) {
        if (!init) throw Object.assign(new Error(`Missing document ${key}`), { status: 404 });
        doc = init();
      }
      const result = await fn(doc);
      this.save(key, doc);
      return result;
    });
  }

  withLock(name, fn) {
    return this.serial(`lock:${name}`, () => fn({
      get: async (key) => clone(this.load(key)),
      set: async (key, doc) => this.save(key, clone(doc)),
    }));
  }

  async readLegacy() {
    if (!this.legacyFile) return null;
    try { return JSON.parse(fs.readFileSync(this.legacyFile, 'utf8')); } catch { return null; }
  }

  async close() {}
}

class PgKV {
  constructor(connectionString) {
    const { Pool } = require('pg');
    // Neon URLs say sslmode=require; pg already treats that as verify-full, so say so explicitly.
    const url = connectionString.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
    this.pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
    this.pool.on('error', (err) => console.error('[store] idle client error', err.message));
    this.ready = null;
  }

  init() {
    if (!this.ready) {
      this.ready = this.pool.query(`CREATE TABLE IF NOT EXISTS kv_store (
          key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
        .catch((err) => { this.ready = null; throw err; });
    }
    return this.ready;
  }

  async read(key) {
    await this.init();
    const { rows } = await this.pool.query('SELECT data FROM kv_store WHERE key = $1', [key]);
    return rows[0] ? rows[0].data : null;
  }

  async tx(fn) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  mutate(key, fn, init) {
    return this.tx(async (client) => {
      const sel = () => client.query('SELECT data FROM kv_store WHERE key = $1 FOR UPDATE', [key]);
      let { rows } = await sel();
      if (!rows[0]) {
        if (!init) throw Object.assign(new Error(`Missing document ${key}`), { status: 404 });
        await client.query('INSERT INTO kv_store (key, data) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(init())]);
        ({ rows } = await sel());
      }
      const doc = rows[0].data;
      const result = await fn(doc);
      await client.query('UPDATE kv_store SET data = $2, updated_at = now() WHERE key = $1', [key, JSON.stringify(doc)]);
      return result;
    });
  }

  withLock(name, fn) {
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`qm:${name}`]);
      return fn({
        get: async (key) => {
          const { rows } = await client.query('SELECT data FROM kv_store WHERE key = $1', [key]);
          return rows[0] ? rows[0].data : null;
        },
        set: async (key, doc) => {
          await client.query(`INSERT INTO kv_store (key, data) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [key, JSON.stringify(doc)]);
        },
      });
    });
  }

  // The pre-SaaS deployment kept everything in app_state(id=1). Read it, never touch it.
  async readLegacy() {
    await this.init();
    const { rows: t } = await this.pool.query("SELECT to_regclass('public.app_state') AS t");
    if (!t[0].t) return null;
    const { rows } = await this.pool.query('SELECT data FROM app_state WHERE id = 1');
    return rows[0] ? rows[0].data : null;
  }

  close() { return this.pool.end(); }
}

function createKV({ dir, legacyFile, databaseUrl }) {
  return databaseUrl ? new PgKV(databaseUrl) : new FileKV(dir, legacyFile);
}

module.exports = { createKV, FileKV, PgKV };

'use strict';
// Datastore with two backends behind one async API:
//   - Postgres (Neon) when DATABASE_URL is set: the whole state is one JSONB row, and
//     every write runs in a transaction holding a row lock, so concurrent serverless
//     instances never overwrite each other's orders.
//   - A JSON file (or pure memory for tests) otherwise, for local development.

const fs = require('fs');
const path = require('path');

const clone = (v) => JSON.parse(JSON.stringify(v));

// Make older saved state forward-compatible with new seed keys.
function upgrade(data, seed) {
  for (const key of Object.keys(seed)) {
    if (data[key] === undefined) data[key] = clone(seed[key]);
  }
  for (const key of Object.keys(seed.restaurant)) {
    if (data.restaurant[key] === undefined) data.restaurant[key] = seed.restaurant[key];
  }
  return data;
}

class FileStore {
  constructor(file, seed) {
    this.file = file;
    this.seed = seed;
    this.queue = Promise.resolve();
    this.data = null;
    try {
      if (file && fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.warn(`[db] could not read ${file} (${err.message}); starting from seed`);
    }
    if (!this.data) { this.data = clone(seed); this.save(); }
    upgrade(this.data, seed);
  }

  save() {
    if (!this.file) return; // in-memory mode (tests)
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  async read() { return this.data; }

  // fn mutates the state in place and returns a result. Calls run one at a time.
  mutate(fn) {
    const run = this.queue.then(async () => {
      const result = await fn(this.data);
      this.save();
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async reset() { this.data = clone(this.seed); this.save(); }
  async close() {}
}

class PgStore {
  constructor(connectionString, seed) {
    const { Pool } = require('pg');
    this.seed = seed;
    // Neon URLs say sslmode=require; pg already treats that as verify-full, so say so explicitly.
    const url = connectionString.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
    this.pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
    this.pool.on('error', (err) => console.error('[db] idle client error', err.message));
    this.ready = null;
  }

  init() {
    if (!this.ready) {
      this.ready = (async () => {
        await this.pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
        await this.pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(this.seed)]);
      })().catch((err) => { this.ready = null; throw err; });
    }
    return this.ready;
  }

  async read() {
    await this.init();
    const { rows } = await this.pool.query('SELECT data FROM app_state WHERE id = 1');
    return upgrade(rows[0].data, this.seed);
  }

  async mutate(fn) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT data FROM app_state WHERE id = 1 FOR UPDATE');
      const data = upgrade(rows[0].data, this.seed);
      const result = await fn(data);
      await client.query('UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1', [JSON.stringify(data)]);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async reset() {
    await this.mutate((data) => {
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, clone(this.seed));
    });
  }

  close() { return this.pool.end(); }
}

function createStore({ file, seed, databaseUrl }) {
  return databaseUrl ? new PgStore(databaseUrl, seed) : new FileStore(file, seed);
}

module.exports = { createStore, FileStore, PgStore };

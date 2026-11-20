'use strict';
// Tiny JSON-file datastore with atomic writes. Good enough for a single restaurant;
// swap this module for Postgres/Mongo later without touching the routes.

const fs = require('fs');
const path = require('path');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

class Store {
  constructor(file, seed) {
    this.file = file;
    this.seed = seed;
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (this.file && fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      }
    } catch (err) {
      console.warn(`[db] could not read ${this.file} (${err.message}); starting from seed`);
      this.data = null;
    }
    if (!this.data) {
      this.data = clone(this.seed);
      this.save();
    }
    // Make older db files forward-compatible with new seed keys.
    for (const key of Object.keys(this.seed)) {
      if (this.data[key] === undefined) this.data[key] = clone(this.seed[key]);
    }
    for (const key of Object.keys(this.seed.restaurant)) {
      if (this.data.restaurant[key] === undefined) this.data.restaurant[key] = this.seed.restaurant[key];
    }
  }

  save() {
    if (!this.file) return; // in-memory mode (tests)
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  reset() {
    this.data = clone(this.seed);
    this.save();
  }
}

module.exports = { Store };

'use strict';
// Tenants (restaurants), their initial data, and first-boot bootstrap / migration.

const crypto = require('crypto');
const seed = require('../data/seed');
const { hashPassword, randomPassword, normEmail, validEmail, validSlug } = require('./security');

const clone = (v) => JSON.parse(JSON.stringify(v));
const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
const tenantKey = (id) => `t:${id}`;

// Make older saved state forward-compatible with new seed keys (never adds sample dishes
// to a restaurant that has its own menu: only keys that are missing entirely are filled).
function upgradeTenantData(data) {
  for (const key of Object.keys(seed)) {
    if (data[key] === undefined) data[key] = clone(seed[key]);
  }
  if (!data.restaurant || typeof data.restaurant !== 'object') data.restaurant = clone(seed.restaurant);
  for (const key of Object.keys(seed.restaurant)) {
    if (data.restaurant[key] === undefined) data.restaurant[key] = seed.restaurant[key];
  }
  return data;
}

function sampleTenantData(name) {
  const d = clone(seed);
  if (name) d.restaurant.name = name;
  d.restaurant.wifi = '';
  return d;
}

function blankTenantData(name) {
  return {
    restaurant: { ...clone(seed.restaurant), name, tagline: '', wifi: '', upiId: '', publicUrl: '', hours: '' },
    categories: [{ id: 'menu', name: 'Menu', icon: '🍽️' }],
    items: [],
    tables: Array.from({ length: 6 }, (_, i) => ({ id: `T${i + 1}`, label: `Table ${i + 1}`, seats: 4 })),
    orders: [],
    calls: [],
    payments: [],
    seq: 1000,
  };
}

// First boot: create the platform document and the first restaurant. If the deployment
// ran the single-restaurant version before, its data is copied (not moved) into it.
async function bootstrap(kv, { legacySlug, ownerEmail, ownerPassword }) {
  if (await kv.read('platform')) return null;
  return kv.withLock('bootstrap', async (tx) => {
    if (await tx.get('platform')) return null; // another instance won the race
    const legacy = await kv.readLegacy();
    const migrated = Boolean(legacy && typeof legacy === 'object' && legacy.restaurant);
    const data = upgradeTenantData(migrated ? clone(legacy) : clone(seed));
    const slug = validSlug(legacySlug) ? legacySlug : 'ember-saffron';
    const now = new Date().toISOString();
    const tenant = {
      id: newId('tn'), slug, name: String(data.restaurant.name || 'My restaurant').slice(0, 60),
      status: 'active', plan: 'standard', demo: true, createdAt: now,
    };
    const email = validEmail(ownerEmail) ? normEmail(ownerEmail) : `owner@${slug}.menu`;
    const generated = !ownerPassword;
    const password = ownerPassword || randomPassword();
    const owner = {
      id: newId('us'), email, name: 'Owner', role: 'owner', tenantId: tenant.id,
      hash: await hashPassword(password), tokenVersion: 1, mustChangePassword: generated, createdAt: now,
    };
    await tx.set(tenantKey(tenant.id), data);
    await tx.set('platform', { version: 1, defaultSlug: slug, tenants: [tenant], users: [owner], createdAt: now });
    return { slug, migrated, email, password: generated ? password : null };
  });
}

module.exports = { clone, newId, tenantKey, upgradeTenantData, sampleTenantData, blankTenantData, bootstrap, seed };

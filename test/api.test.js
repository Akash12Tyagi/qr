'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const PIN = '9999';
let server;
let base;

test.before(async () => {
  const app = createApp({ dbFile: null, databaseUrl: '', adminPin: PIN, rateLimit: false }); // in-memory store
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  server.on('close', () => app.locals.closeStreams());
});
test.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

async function req(path, { method = 'GET', body, pin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (pin) headers['x-admin-pin'] = pin;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
}

test('serves pages and the three.js vendor bundle', async () => {
  for (const p of ['/', '/menu', '/admin', '/print', '/vendor/three/build/three.module.min.js', '/vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js']) {
    const r = await req(p);
    assert.equal(r.status, 200, p);
  }
  const nf = await req('/nope');
  assert.equal(nf.status, 404);
  assert.match(nf.text, /plate is empty/);
  const redirect = await fetch(`${base}/m/T3`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/menu?t=T3');
});

test('public menu hides internal settings', async () => {
  const r = await req('/api/menu');
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 10);
  assert.ok(r.json.categories.length >= 3);
  assert.equal(r.json.restaurant.publicUrl, undefined);
});

test('QR codes encode the table URL (svg + png)', async () => {
  const svg = await req('/api/qr/T1');
  assert.equal(svg.status, 200);
  assert.match(svg.type, /svg/);
  assert.match(svg.text, /<svg/);
  const png = await fetch(`${base}/api/qr/T1?format=png&size=256`);
  assert.equal(png.status, 200);
  const buf = Buffer.from(await png.arrayBuffer());
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.equal((await req('/api/qr/NOPE')).status, 404);
});

test('order flow: prices computed on server, status updates, tracking', async () => {
  const menu = (await req('/api/menu')).json;
  const item = menu.items[0];
  const r = await req('/api/orders', { method: 'POST', body: { table: 'T2', items: [{ id: item.id, qty: 2, price: 1 }, { id: item.id, qty: 1 }], name: 'Asha' } });
  assert.equal(r.status, 201);
  const o = r.json;
  assert.equal(o.items.length, 1, 'same dish+note lines are merged');
  assert.equal(o.items[0].qty, 3);
  assert.equal(o.subtotal, item.price * 3, 'client-sent price is ignored');
  assert.equal(o.tax, Math.round(item.price * 3 * menu.restaurant.taxRate) / 100);
  assert.equal(o.status, 'placed');
  assert.equal(o.ip, undefined, 'never leaks IP');

  const unauth = await req(`/api/admin/orders/${o.id}`, { method: 'PATCH', body: { status: 'accepted' } });
  assert.equal(unauth.status, 401);
  const up = await req(`/api/admin/orders/${o.id}`, { method: 'PATCH', pin: PIN, body: { status: 'preparing' } });
  assert.equal(up.status, 200);
  assert.equal(up.json.status, 'preparing');
  const bad = await req(`/api/admin/orders/${o.id}`, { method: 'PATCH', pin: PIN, body: { status: 'eaten' } });
  assert.equal(bad.status, 400);
  const track = await req(`/api/orders/${o.id}`);
  assert.equal(track.json.status, 'preparing');
  assert.equal(track.json.history.length, 2);
});

test('order validation', async () => {
  const menu = (await req('/api/menu')).json;
  assert.equal((await req('/api/orders', { method: 'POST', body: { table: 'ZZ', items: [{ id: menu.items[0].id, qty: 1 }] } })).status, 400);
  assert.equal((await req('/api/orders', { method: 'POST', body: { table: 'T1', items: [] } })).status, 400);
  assert.equal((await req('/api/orders', { method: 'POST', body: { table: 'T1', items: [{ id: 'ghost', qty: 1 }] } })).status, 400);
  const malformed = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(malformed.status, 400);
});

test('sold-out dishes cannot be ordered', async () => {
  const menu = (await req('/api/menu')).json;
  const item = menu.items[1];
  const r = await req(`/api/admin/items/${item.id}`, { method: 'PUT', pin: PIN, body: { ...item, available: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json.available, false);
  const o = await req('/api/orders', { method: 'POST', body: { table: 'T1', items: [{ id: item.id, qty: 1 }] } });
  assert.equal(o.status, 400);
  assert.match(o.json.error, /sold out/);
});

test('admin CRUD: dishes, categories, tables, settings, stats', async () => {
  const created = await req('/api/admin/items', { method: 'POST', pin: PIN, body: { name: '<b>Test</b> Dosa', price: 120, category: 'mains', image: 'javascript:alert(1)', tags: 'a, b' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.image, '', 'non-http image urls are dropped');
  assert.deepEqual(created.json.tags, ['a', 'b']);
  assert.equal((await req('/api/admin/items', { method: 'POST', pin: PIN, body: { name: 'x', price: -1, category: 'mains' } })).status, 400);
  assert.equal((await req(`/api/admin/items/${created.json.id}`, { method: 'DELETE', pin: PIN })).status, 204);

  const cat = await req('/api/admin/categories', { method: 'POST', pin: PIN, body: { name: 'Brunch', icon: '🥞' } });
  assert.equal(cat.status, 201);
  assert.equal(cat.json.id, 'brunch');
  assert.equal((await req('/api/admin/categories/mains', { method: 'DELETE', pin: PIN })).status, 400, 'non-empty category is protected');
  assert.equal((await req('/api/admin/categories/brunch', { method: 'DELETE', pin: PIN })).status, 204);

  const t = await req('/api/admin/tables', { method: 'POST', pin: PIN, body: { label: 'Terrace', seats: 6 } });
  assert.equal(t.status, 201);
  assert.match(t.json.url, /\/menu\?t=T9$/);
  assert.equal((await req('/api/admin/tables', { method: 'POST', pin: PIN, body: { label: 'Dup', id: 'T9' } })).status, 400);

  const s = await req('/api/admin/restaurant', { method: 'PUT', pin: PIN, body: { name: 'New Name', accent: 'red', publicUrl: 'https://menu.example.in/' } });
  assert.equal(s.json.name, 'New Name');
  assert.equal(s.json.accent, '#F4A51C', 'invalid colours rejected');
  const st = await req('/api/admin/state', { pin: PIN });
  assert.equal(st.json.tables[0].url, 'https://menu.example.in/menu?t=T1');

  const stats = await req('/api/admin/stats', { pin: PIN });
  assert.equal(stats.status, 200);
  assert.ok(stats.json.orders >= 1);
  assert.equal(stats.json.hours.length, 24);
});

test('waiter calls are de-duplicated and resolvable', async () => {
  const a = await req('/api/calls', { method: 'POST', body: { table: 'T4', reason: 'water' } });
  assert.equal(a.status, 201);
  const b = await req('/api/calls', { method: 'POST', body: { table: 'T4', reason: 'water' } });
  assert.equal(b.status, 200);
  assert.equal(b.json.id, a.json.id);
  const r = await req(`/api/admin/calls/${a.json.id}`, { method: 'PATCH', pin: PIN });
  assert.equal(r.json.resolved, true);
});

test('live SSE stream delivers new orders to the kitchen', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/admin/stream?pin=${PIN}`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const menu = (await req('/api/menu')).json;
  const avail = menu.items.find((i) => i.available !== false);
  await req('/api/orders', { method: 'POST', body: { table: 'T5', items: [{ id: avail.id, qty: 1 }] } });
  let buf = '';
  const deadline = Date.now() + 3000;
  while (!buf.includes('event: order:new') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += Buffer.from(value).toString();
  }
  ctrl.abort();
  assert.match(buf, /event: order:new/);
  assert.match(buf, /"table":"T5"/);
});

test('polling mode (serverless) exposes a change feed instead of SSE', async () => {
  const app = createApp({ dbFile: null, adminPin: PIN, realtime: 'poll', databaseUrl: '' });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const menu = await (await fetch(`${b}/api/menu`)).json();
    assert.equal(menu.realtime, 'poll');
    const since = new Date(Date.now() - 1000).toISOString();
    const order = await (await fetch(`${b}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table: 'T2', items: [{ id: menu.items[0].id, qty: 1 }] }),
    })).json();
    const ch = await (await fetch(`${b}/api/admin/changes?since=${encodeURIComponent(since)}`, { headers: { 'x-admin-pin': PIN } })).json();
    assert.ok(ch.now);
    assert.ok(ch.orders.some((o) => o.id === order.id));
    assert.equal(ch.orders[0].ip, undefined);
    assert.equal((await fetch(`${b}/api/admin/stream?pin=${PIN}`)).status, 404);
    assert.equal((await fetch(`${b}/api/admin/changes`)).status, 401);
  } finally { srv.close(); }
});

test('brand assets, real photos and safe image paths', async () => {
  for (const p of ['/brand', '/credits', '/css/brand.css', '/fonts/Geist-Variable.woff2', '/fonts/poppins-latin-ext-600-normal.woff2', '/logo-mark.svg']) {
    assert.equal((await req(p)).status, 200, p);
  }
  const menu = (await req('/api/menu')).json;
  assert.ok(menu.items.filter((i) => /^\/img\/dishes\/i\d+\.jpg$/.test(i.image)).length >= 20, 'seed dishes carry their photo');

  const ok = await req('/api/admin/items', { method: 'POST', pin: PIN, body: { name: 'Photo test', price: 10, category: 'mains', image: '/img/dishes/i1.jpg' } });
  assert.equal(ok.json.image, '/img/dishes/i1.jpg', 'site-relative image paths are allowed');
  const evil = await req('/api/admin/items', { method: 'POST', pin: PIN, body: { name: 'Evil', price: 10, category: 'mains', image: '//evil.example/x.jpg' } });
  assert.equal(evil.json.image, '', 'protocol-relative URLs are rejected');
  const trav = await req('/api/admin/items', { method: 'POST', pin: PIN, body: { name: 'Trav', price: 10, category: 'mains', image: '/img/../../etc/passwd' } });
  assert.equal(trav.json.image, '', 'path traversal is rejected');
});

test('table bill: full, equal split and per-item payments, confirmation and settlement', async () => {
  const menu = (await req('/api/menu')).json;
  const avail = menu.items.filter((i) => i.available !== false);
  const [a, b2] = [avail[2], avail[3]];
  const T = 'T7';
  // two friends order separately at the same table
  const o1 = (await req('/api/orders', { method: 'POST', body: { table: T, name: 'Asha', items: [{ id: a.id, qty: 2 }] } })).json;
  const o2 = (await req('/api/orders', { method: 'POST', body: { table: T, name: 'Ravi', items: [{ id: b2.id, qty: 1 }] } })).json;
  let bill = (await req(`/api/tables/${T}/bill`)).json;
  assert.equal(bill.orders.length, 2);
  assert.equal(bill.total, Math.round((o1.total + o2.total) * 100) / 100);
  assert.equal(bill.remaining, bill.total);
  assert.equal(bill.lines.length, 2);

  // validation
  assert.equal((await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'full' } })).status, 400, 'method required');
  assert.equal((await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'items', method: 'cash', lines: [] } })).status, 400);
  assert.equal((await req('/api/tables/NOPE/payments', { method: 'POST', body: { mode: 'full', method: 'cash' } })).status, 404);

  // Asha pays for her own dishes (+ proportional tax), price is computed by the server
  const lineA = bill.lines.find((l) => l.name === a.name).key;
  const pA = await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'items', method: 'upi', name: 'Asha', lines: [lineA], amount: 1 } });
  assert.equal(pA.status, 201);
  assert.equal(pA.json.payment.amount, Math.round((bill.total * (a.price * 2)) / bill.subtotal * 100) / 100);
  assert.equal(pA.json.payment.status, 'pending');
  assert.equal(pA.json.payment.ip, undefined, 'never leaks IP');
  // her dish cannot be claimed twice
  const dup = await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'items', method: 'cash', lines: [lineA] } });
  assert.equal(dup.status, 400);
  bill = pA.json.bill;
  assert.equal(bill.lines.find((l) => l.key === lineA).claimedBy, 'Asha');
  assert.equal(bill.pending, pA.json.payment.amount);

  // equal split is capped at what is left
  const pEq = await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'equal', parts: 2, shares: 2, method: 'card', name: 'Ravi' } });
  assert.equal(pEq.status, 201);
  assert.equal(pEq.json.payment.amount, bill.remaining, 'capped at remaining');
  assert.equal(pEq.json.bill.remaining, 0);
  assert.equal((await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'full', method: 'cash' } })).status, 400, 'nothing left to claim');

  // the kitchen sees both payments and confirms them
  const state = (await req('/api/admin/state', { pin: PIN })).json;
  assert.equal(state.payments.filter((p) => p.table === T).length, 2);
  assert.equal((await req(`/api/admin/payments/${pA.json.payment.id}`, { method: 'PATCH', body: { status: 'confirmed' } })).status, 401);
  assert.equal((await req(`/api/admin/payments/${pA.json.payment.id}`, { method: 'PATCH', pin: PIN, body: { status: 'paid' } })).status, 400);
  const c1 = await req(`/api/admin/payments/${pA.json.payment.id}`, { method: 'PATCH', pin: PIN, body: { status: 'confirmed' } });
  assert.equal(c1.json.settled, false);
  const c2 = await req(`/api/admin/payments/${pEq.json.payment.id}`, { method: 'PATCH', pin: PIN, body: { status: 'confirmed' } });
  assert.equal(c2.json.settled, true, 'fully paid table settles automatically');

  // the table starts fresh; the orders are marked paid
  bill = (await req(`/api/tables/${T}/bill`)).json;
  assert.equal(bill.total, 0);
  assert.ok(bill.settledAt);
  assert.equal((await req(`/api/orders/${o1.id}`)).json.paid, true);
  assert.equal((await req(`/api/admin/payments/${pA.json.payment.id}`, { method: 'PATCH', pin: PIN, body: { status: 'rejected' } })).status, 400, 'closed bills are immutable');
});

test('rejected payments release their dishes; staff can settle a table manually', async () => {
  const menu = (await req('/api/menu')).json;
  const item = menu.items.find((i) => i.available !== false);
  const T = 'T8';
  await req('/api/orders', { method: 'POST', body: { table: T, items: [{ id: item.id, qty: 1 }] } });
  let bill = (await req(`/api/tables/${T}/bill`)).json;
  const p = (await req(`/api/tables/${T}/payments`, { method: 'POST', body: { mode: 'items', method: 'upi', lines: [bill.lines[0].key] } })).json.payment;
  await req(`/api/admin/payments/${p.id}`, { method: 'PATCH', pin: PIN, body: { status: 'rejected' } });
  bill = (await req(`/api/tables/${T}/bill`)).json;
  assert.equal(bill.lines[0].claimedBy, null, 'rejected payment frees the dish');
  assert.equal(bill.remaining, bill.total);
  const s = await req(`/api/admin/tables/${T}/settle`, { method: 'POST', pin: PIN });
  assert.equal(s.json.orders, 1);
  assert.equal((await req(`/api/tables/${T}/bill`)).json.total, 0);
  assert.equal((await req('/api/admin/restaurant', { method: 'PUT', pin: PIN, body: { upiId: 'not a vpa' } })).status, 400);
  assert.equal((await req('/api/admin/restaurant', { method: 'PUT', pin: PIN, body: { upiId: 'embersaffron@okaxis' } })).json.upiId, 'embersaffron@okaxis');
  assert.deepEqual((await req(`/api/tables/${T}/bill`)).json.upi, { id: 'embersaffron@okaxis', name: (await req('/api/menu')).json.restaurant.name });
});

test('rate limits still protect ordering in normal operation', async () => {
  const app = createApp({ dbFile: null, databaseUrl: '' });
  const srv = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const menu = await (await fetch(`${url}/api/menu`)).json();
  const body = JSON.stringify({ table: 'T1', items: [{ id: menu.items[0].id, qty: 1 }] });
  const codes = [];
  for (let k = 0; k < 9; k++) codes.push((await fetch(`${url}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status);
  srv.closeAllConnections?.(); await new Promise((r) => srv.close(r));
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(201));
  assert.equal(codes[8], 429);
});

test('serverless polling feed carries payments to the kitchen', async () => {
  const app = createApp({ dbFile: null, adminPin: PIN, realtime: 'poll', databaseUrl: '', rateLimit: false });
  const srv = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const j = (path, opts = {}) => fetch(url + path, { ...opts, headers: { 'content-type': 'application/json', 'x-admin-pin': PIN } }).then((r) => r.json());
  const since = new Date().toISOString();
  const menu = await j('/api/menu');
  await j('/api/orders', { method: 'POST', body: JSON.stringify({ table: 'T2', items: [{ id: menu.items[0].id, qty: 1 }] }) });
  const out = await j('/api/tables/T2/payments', { method: 'POST', body: JSON.stringify({ mode: 'full', method: 'cash', name: 'Mira' }) });
  const ch = await j(`/api/admin/changes?since=${encodeURIComponent(since)}`);
  srv.closeAllConnections?.(); await new Promise((r) => srv.close(r));
  assert.equal(ch.payments.length, 1);
  assert.equal(ch.payments[0].id, out.payment.id);
  assert.equal(ch.payments[0].name, 'Mira');
  assert.equal(ch.payments[0].ip, undefined);
});

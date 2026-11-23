'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

const OWNER = { email: 'owner@ember.test', password: 'owner-pass-1234' };
const PLATFORM = { email: 'root@platform.test', password: 'platform-pass-1234' };
const SLUG = 'ember-saffron';
const quiet = () => {};

async function startServer(extra = {}) {
  const app = createApp({
    dataDir: null, legacyFile: null, databaseUrl: '', rateLimit: false, log: quiet,
    sessionSecret: 'x'.repeat(48), ownerEmail: OWNER.email, ownerPassword: OWNER.password,
    platformAdmin: PLATFORM, production: false, ...extra,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  server.on('close', () => app.locals.closeStreams());
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return { app, base, close };
}

// A tiny browser: keeps the session cookie and sends the CSRF header like the real pages do.
function client(base) {
  let cookie = '';
  const call = async (p, { method = 'GET', body, csrf = true, headers = {}, raw = false } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (csrf) h['x-qm-csrf'] = '1';
    if (cookie) h.cookie = cookie;
    const res = await fetch(base + p, { method, headers: h, redirect: 'manual', body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/qm_session=([^;]*)/);
      if (m) cookie = m[1] ? `qm_session=${m[1]}` : '';
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, type: res.headers.get('content-type') || '', headers: res.headers };
  };
  call.login = async (email, password) => {
    const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r;
  };
  call.cookie = () => cookie;
  call.setCookie = (c) => { cookie = c; };
  return call;
}

let S; let guest; let owner;
const api = (p) => `/api/r/${SLUG}${p}`;
const adm = (p) => `/api/r/${SLUG}/admin${p}`;

test.before(async () => {
  S = await startServer();
  guest = client(S.base);
  owner = client(S.base);
  await owner.login(OWNER.email, OWNER.password);
});
test.after(() => S.close());

// ------------------------------------------------------------------ pages & security headers
test('pages, legacy links and security headers', async () => {
  for (const p of ['/', '/login', '/platform', `/r/${SLUG}`, `/r/${SLUG}/menu?t=T1`, `/r/${SLUG}/admin`, `/r/${SLUG}/print`, '/brand', '/credits',
    '/vendor/three/build/three.module.min.js', '/js/theme-boot.js']) {
    const r = await guest(p);
    assert.equal(r.status, 200, p);
  }
  const home = await guest('/');
  const csp = home.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('x-powered-by'), null);

  const nf = await guest('/nope');
  assert.equal(nf.status, 404);
  assert.match(nf.text, /plate is empty/);
  assert.equal((await guest('/r/no-such-place/menu')).status, 404);

  // printed QR codes from the single-restaurant version keep working
  const legacy = await guest('/menu?t=T3', { raw: true });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get('location'), `/r/${SLUG}/menu?t=T3`);
  const short = await guest('/m/T3', { raw: true });
  assert.equal(short.headers.get('location'), `/r/${SLUG}/menu?t=T3`);
  const oldAdmin = await guest('/admin', { raw: true });
  assert.equal(oldAdmin.headers.get('location'), '/login');
  assert.deepEqual((await guest('/api/default-tenant')).json, { slug: SLUG, name: 'Ember & Saffron' });
});

test('no page ships inline scripts or inline event handlers (CSP-safe)', () => {
  const dir = path.join(__dirname, '..', 'public');
  const files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f)),
    ...fs.readdirSync(path.join(dir, 'js')).map((f) => path.join(dir, 'js', f))];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(s, /<script(?![^>]*\bsrc=)[^>]*>/i, `${f} has an inline <script>`);
    assert.doesNotMatch(s, /\son(click|error|load|change|input|submit|keydown)\s*=\s*["']/i, `${f} has an inline handler`);
    assert.doesNotMatch(s, /x-admin-pin|qm:pin/i, `${f} still uses the old PIN`);
  }
});

// ------------------------------------------------------------------ guest API
test('public menu hides internal settings', async () => {
  const r = await guest(api('/menu'));
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 10);
  assert.ok(r.json.categories.length >= 3);
  assert.equal(r.json.restaurant.publicUrl, undefined);
  assert.equal(r.json.slug, SLUG);
  assert.equal((await guest('/api/r/nobody-here/menu')).status, 404);
  assert.equal((await guest('/api/r/..%2Fetc/menu')).status, 404);
  assert.equal((await guest('/api/menu')).status, 404, 'no global menu any more');
});

test('QR codes encode the restaurant + table URL (svg + png)', async () => {
  const svg = await guest(api('/qr/T1'));
  assert.equal(svg.status, 200);
  assert.match(svg.type, /svg/);
  assert.match(svg.text, /<svg/);
  const png = await fetch(`${S.base}${api('/qr/T1')}?format=png&size=256`);
  assert.equal(png.status, 200);
  assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  assert.equal((await guest(api('/qr/NOPE'))).status, 404);
  // the restaurant's own QR (shown on its home page) opens the menu without a table
  const home = await guest(api('/qr'));
  assert.equal(home.status, 200);
  assert.match(home.text, /<svg/);
  assert.notEqual(home.text, svg.text, 'differs from a table QR');
  const homePng = await fetch(`${S.base}${api('/qr')}?format=png&size=256`);
  assert.equal(Buffer.from(await homePng.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  assert.match((await guest(`/r/${SLUG}`)).text, /home\.js/, '/r/<slug> is the restaurant home page');
  assert.equal((await guest('/r/not-a-place')).status, 404);
  // home page first: a bare menu link lands on the restaurant's home page
  const bare = await guest(`/r/${SLUG}/menu`, { raw: true });
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.get('location'), `/r/${SLUG}`);
  for (const q of ['?t=T1', '?src=qr', '?src=home', '?ch=mains']) assert.equal((await guest(`/r/${SLUG}/menu${q}`)).status, 200, q);
  const qrWant = await require('qrcode').toString(`${S.base}/r/${SLUG}/menu?src=qr`, { errorCorrectionLevel: 'H', margin: 1, color: { dark: '#111111', light: '#ffffff' }, type: 'svg' });
  assert.equal((await guest(api('/qr?margin=1'))).text, qrWant, 'restaurant QR opens the menu');
  const st = await owner(adm('/state'));
  assert.equal(st.json.tables[0].url, `${S.base}/r/${SLUG}/menu?t=T1`);
  assert.equal(st.json.homeUrl, `${S.base}/r/${SLUG}`);
});

test('order flow: prices computed on server, status updates, tracking', async () => {
  const menu = (await guest(api('/menu'))).json;
  const item = menu.items[0];
  const r = await guest(api('/orders'), { method: 'POST', csrf: false, body: { table: 'T2', items: [{ id: item.id, qty: 2, price: 1 }, { id: item.id, qty: 1 }], name: 'Asha' } });
  assert.equal(r.status, 201);
  const o = r.json;
  assert.equal(o.items.length, 1, 'same dish+note lines are merged');
  assert.equal(o.items[0].qty, 3);
  assert.equal(o.subtotal, item.price * 3, 'client-sent price is ignored');
  assert.equal(o.tax, Math.round(item.price * 3 * menu.restaurant.taxRate) / 100);
  assert.equal(o.ip, undefined, 'never leaks IP');

  assert.equal((await guest(adm(`/orders/${o.id}`), { method: 'PATCH', body: { status: 'accepted' } })).status, 401);
  const up = await owner(adm(`/orders/${o.id}`), { method: 'PATCH', body: { status: 'preparing' } });
  assert.equal(up.status, 200);
  assert.equal(up.json.status, 'preparing');
  assert.equal((await owner(adm(`/orders/${o.id}`), { method: 'PATCH', body: { status: 'eaten' } })).status, 400);
  const track = await guest(api(`/orders/${o.id}`));
  assert.equal(track.json.status, 'preparing');
  assert.equal(track.json.history.length, 2);
});

test('order validation', async () => {
  const menu = (await guest(api('/menu'))).json;
  assert.equal((await guest(api('/orders'), { method: 'POST', body: { table: 'ZZ', items: [{ id: menu.items[0].id, qty: 1 }] } })).status, 400);
  assert.equal((await guest(api('/orders'), { method: 'POST', body: { table: 'T1', items: [] } })).status, 400);
  assert.equal((await guest(api('/orders'), { method: 'POST', body: { table: 'T1', items: [{ id: 'ghost', qty: 1 }] } })).status, 400);
  assert.equal((await guest(api('/orders'), { method: 'POST', body: '{bad' })).status, 400);
});

// ------------------------------------------------------------------ auth & sessions
test('login: cookie flags, generic errors, no secrets in responses', async () => {
  const c = client(S.base);
  const wrong = await c('/api/auth/login', { method: 'POST', body: { email: OWNER.email, password: 'nope-nope-nope' } });
  const nouser = await c('/api/auth/login', { method: 'POST', body: { email: 'ghost@nowhere.test', password: 'nope-nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(nouser.status, 401);
  assert.equal(wrong.json.error, nouser.json.error, 'same message for unknown user and wrong password');

  const noCsrf = await c('/api/auth/login', { method: 'POST', csrf: false, body: { email: OWNER.email, password: OWNER.password } });
  assert.equal(noCsrf.status, 403, 'login needs the same-origin header');
  const xsite = await c('/api/auth/login', { method: 'POST', headers: { origin: 'https://evil.example' }, body: { email: OWNER.email, password: OWNER.password } });
  assert.equal(xsite.status, 403, 'cross-site origin rejected');

  const ok = await c('/api/auth/login', { method: 'POST', body: { email: ` ${OWNER.email.toUpperCase()} `, password: OWNER.password } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.next, `/r/${SLUG}/admin`);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(ok.text, /hash|scrypt|"password"/i, 'no hashes in the response');
  assert.ok(!ok.text.includes(OWNER.password), 'password never echoed');

  const me = await c('/api/auth/me');
  assert.equal(me.json.role, 'owner');
  assert.equal(me.json.tenant.slug, SLUG);
  const team = await c(adm('/team'));
  assert.ok(team.json.length >= 1);
  assert.doesNotMatch(team.text, /hash|scrypt/, 'team list never contains password hashes');

  await c('/api/auth/logout', { method: 'POST' });
  assert.equal((await c('/api/auth/me')).status, 401);
});

test('forged, tampered and expired sessions are rejected', async () => {
  const c = client(S.base);
  c.setCookie(owner.cookie());
  assert.equal((await c(adm('/verify'))).status, 200);
  const [body, mac] = owner.cookie().replace('qm_session=', '').split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  // tamper: claim to be the platform owner, keep the old signature
  const forged = Buffer.from(JSON.stringify({ ...payload, r: 'platform', u: 'platform' })).toString('base64url');
  c.setCookie(`qm_session=${forged}.${mac}`);
  assert.equal((await c('/api/platform/tenants')).status, 401);
  assert.equal((await c(adm('/verify'))).status, 401);
  c.setCookie('qm_session=garbage');
  assert.equal((await c(adm('/state'))).status, 401);
  // a session signed with another secret
  const other = await startServer({ sessionSecret: 'y'.repeat(48) });
  const oc = client(other.base);
  await oc.login(OWNER.email, OWNER.password);
  c.setCookie(oc.cookie());
  assert.equal((await c(adm('/state'))).status, 401);
  await other.close();
});

test('admin writes need the CSRF header even with a valid session', async () => {
  const menu = (await guest(api('/menu'))).json;
  const r = await owner(adm(`/items/${menu.items[0].id}/availability`), { method: 'PATCH', csrf: false, body: { available: true } });
  assert.equal(r.status, 403);
  const ok = await owner(adm(`/items/${menu.items[0].id}/availability`), { method: 'PATCH', body: { available: true } });
  assert.equal(ok.status, 200);
});

// ------------------------------------------------------------------ menu management
test('sold-out dishes cannot be ordered', async () => {
  const menu = (await guest(api('/menu'))).json;
  const item = menu.items[1];
  const r = await owner(adm(`/items/${item.id}/availability`), { method: 'PATCH', body: { available: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json.available, false);
  const o = await guest(api('/orders'), { method: 'POST', body: { table: 'T1', items: [{ id: item.id, qty: 1 }] } });
  assert.equal(o.status, 400);
  assert.match(o.json.error, /sold out/);
});

test('owner CRUD: dishes, categories, tables, settings, stats', async () => {
  const created = await owner(adm('/items'), { method: 'POST', body: { name: '<b>Test</b> Dosa', price: 120, category: 'mains', image: 'javascript:alert(1)', tags: 'a, b' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.image, '', 'non-http image urls are dropped');
  assert.deepEqual(created.json.tags, ['a', 'b']);
  assert.equal((await owner(adm('/items'), { method: 'POST', body: { name: 'x', price: -1, category: 'mains' } })).status, 400);
  assert.equal((await owner(adm(`/items/${created.json.id}`), { method: 'DELETE' })).status, 204);

  const cat = await owner(adm('/categories'), { method: 'POST', body: { name: 'Brunch', icon: '🥞' } });
  assert.equal(cat.status, 201);
  assert.equal(cat.json.id, 'brunch');
  assert.equal((await owner(adm('/categories/mains'), { method: 'DELETE' })).status, 400, 'non-empty category is protected');
  assert.equal((await owner(adm('/categories/brunch'), { method: 'DELETE' })).status, 204);

  const t = await owner(adm('/tables'), { method: 'POST', body: { label: 'Terrace', seats: 6 } });
  assert.equal(t.status, 201);
  assert.match(t.json.url, new RegExp(`/r/${SLUG}/menu\\?t=T9$`));
  assert.equal((await owner(adm('/tables'), { method: 'POST', body: { label: 'Dup', id: 'T9' } })).status, 400);

  const s = await owner(adm('/restaurant'), { method: 'PUT', body: { name: 'New Name', accent: 'red', publicUrl: 'https://menu.example.in/' } });
  assert.equal(s.json.name, 'New Name');
  assert.equal(s.json.accent, '#F4A51C', 'invalid colours rejected');
  const st = await owner(adm('/state'));
  assert.equal(st.json.tables[0].url, `https://menu.example.in/r/${SLUG}/menu?t=T1`);
  assert.equal((await guest('/api/default-tenant')).json.name, 'New Name', 'platform listing follows the rename');
  await owner(adm('/restaurant'), { method: 'PUT', body: { name: 'Ember & Saffron', publicUrl: '' } });

  const stats = await owner(adm('/stats'));
  assert.equal(stats.status, 200);
  assert.ok(stats.json.orders >= 1);
  assert.equal(stats.json.hours.length, 24);
});

test('waiter calls are de-duplicated and resolvable', async () => {
  const a = await guest(api('/calls'), { method: 'POST', body: { table: 'T4', reason: 'water' } });
  assert.equal(a.status, 201);
  const b = await guest(api('/calls'), { method: 'POST', body: { table: 'T4', reason: 'water' } });
  assert.equal(b.status, 200);
  assert.equal(b.json.id, a.json.id);
  const r = await owner(adm(`/calls/${a.json.id}`), { method: 'PATCH' });
  assert.equal(r.json.resolved, true);
});

test('live SSE stream (cookie auth) delivers new orders to the kitchen', async () => {
  assert.equal((await fetch(`${S.base}${adm('/stream')}`)).status, 401, 'no session, no stream');
  const ctrl = new AbortController();
  const res = await fetch(`${S.base}${adm('/stream')}`, { signal: ctrl.signal, headers: { cookie: owner.cookie() } });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const menu = (await guest(api('/menu'))).json;
  const avail = menu.items.find((i) => i.available !== false);
  await guest(api('/orders'), { method: 'POST', body: { table: 'T5', items: [{ id: avail.id, qty: 1 }] } });
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

// ------------------------------------------------------------------ bills
test('table bill: full, equal split and per-item payments, confirmation and settlement', async () => {
  const menu = (await guest(api('/menu'))).json;
  const avail = menu.items.filter((i) => i.available !== false);
  const [a, b2] = [avail[2], avail[3]];
  const T = 'T7';
  const o1 = (await guest(api('/orders'), { method: 'POST', body: { table: T, name: 'Asha', items: [{ id: a.id, qty: 2 }] } })).json;
  const o2 = (await guest(api('/orders'), { method: 'POST', body: { table: T, name: 'Ravi', items: [{ id: b2.id, qty: 1 }] } })).json;
  let bill = (await guest(api(`/tables/${T}/bill`))).json;
  assert.equal(bill.orders.length, 2);
  assert.equal(bill.total, Math.round((o1.total + o2.total) * 100) / 100);
  assert.equal(bill.remaining, bill.total);

  assert.equal((await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'full' } })).status, 400, 'method required');
  assert.equal((await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'items', method: 'cash', lines: [] } })).status, 400);
  assert.equal((await guest(api('/tables/NOPE/payments'), { method: 'POST', body: { mode: 'full', method: 'cash' } })).status, 404);

  const lineA = bill.lines.find((l) => l.name === a.name).key;
  const pA = await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'items', method: 'upi', name: 'Asha', lines: [lineA], amount: 1 } });
  assert.equal(pA.status, 201);
  assert.equal(pA.json.payment.amount, Math.round((bill.total * (a.price * 2)) / bill.subtotal * 100) / 100);
  assert.equal(pA.json.payment.status, 'pending');
  assert.equal(pA.json.payment.ip, undefined);
  assert.equal((await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'items', method: 'cash', lines: [lineA] } })).status, 400);
  bill = pA.json.bill;
  assert.equal(bill.lines.find((l) => l.key === lineA).claimedBy, 'Asha');

  const pEq = await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'equal', parts: 2, shares: 2, method: 'card', name: 'Ravi' } });
  assert.equal(pEq.status, 201);
  assert.equal(pEq.json.payment.amount, bill.remaining, 'capped at remaining');
  assert.equal((await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'full', method: 'cash' } })).status, 400);

  const state = (await owner(adm('/state'))).json;
  assert.equal(state.payments.filter((p) => p.table === T).length, 2);
  assert.equal((await guest(adm(`/payments/${pA.json.payment.id}`), { method: 'PATCH', body: { status: 'confirmed' } })).status, 401);
  assert.equal((await owner(adm(`/payments/${pA.json.payment.id}`), { method: 'PATCH', body: { status: 'paid' } })).status, 400);
  assert.equal((await owner(adm(`/payments/${pA.json.payment.id}`), { method: 'PATCH', body: { status: 'confirmed' } })).json.settled, false);
  assert.equal((await owner(adm(`/payments/${pEq.json.payment.id}`), { method: 'PATCH', body: { status: 'confirmed' } })).json.settled, true);

  bill = (await guest(api(`/tables/${T}/bill`))).json;
  assert.equal(bill.total, 0);
  assert.ok(bill.settledAt);
  assert.equal((await guest(api(`/orders/${o1.id}`))).json.paid, true);
  assert.equal((await owner(adm(`/payments/${pA.json.payment.id}`), { method: 'PATCH', body: { status: 'rejected' } })).status, 400, 'closed bills are immutable');
});

test('rejected payments release their dishes; staff can settle a table manually', async () => {
  const menu = (await guest(api('/menu'))).json;
  const item = menu.items.find((i) => i.available !== false);
  const T = 'T8';
  await guest(api('/orders'), { method: 'POST', body: { table: T, items: [{ id: item.id, qty: 1 }] } });
  let bill = (await guest(api(`/tables/${T}/bill`))).json;
  const p = (await guest(api(`/tables/${T}/payments`), { method: 'POST', body: { mode: 'items', method: 'upi', lines: [bill.lines[0].key] } })).json.payment;
  await owner(adm(`/payments/${p.id}`), { method: 'PATCH', body: { status: 'rejected' } });
  bill = (await guest(api(`/tables/${T}/bill`))).json;
  assert.equal(bill.lines[0].claimedBy, null);
  assert.equal(bill.remaining, bill.total);
  assert.equal((await owner(adm(`/tables/${T}/settle`), { method: 'POST' })).json.orders, 1);
  assert.equal((await guest(api(`/tables/${T}/bill`))).json.total, 0);
  assert.equal((await owner(adm('/restaurant'), { method: 'PUT', body: { upiId: 'not a vpa' } })).status, 400);
  assert.equal((await owner(adm('/restaurant'), { method: 'PUT', body: { upiId: 'embersaffron@okaxis' } })).json.upiId, 'embersaffron@okaxis');
  assert.equal((await guest(api(`/tables/${T}/bill`))).json.upi.id, 'embersaffron@okaxis');
});

test('brand assets, real photos and safe image paths', async () => {
  for (const p of ['/css/brand.css', '/fonts/Geist-Variable.woff2', '/fonts/poppins-latin-ext-600-normal.woff2', '/logo-mark.svg']) {
    assert.equal((await guest(p)).status, 200, p);
  }
  const menu = (await guest(api('/menu'))).json;
  assert.ok(menu.items.filter((i) => /^\/img\/dishes\/i\d+\.jpg$/.test(i.image)).length >= 20);
  const mk = (image) => owner(adm('/items'), { method: 'POST', body: { name: 'Photo test', price: 10, category: 'mains', image } });
  assert.equal((await mk('/img/dishes/i1.jpg')).json.image, '/img/dishes/i1.jpg');
  assert.equal((await mk('//evil.example/x.jpg')).json.image, '');
  assert.equal((await mk('/img/../../etc/passwd')).json.image, '');
});

// ------------------------------------------------------------------ multi-tenant isolation
test('platform: create restaurants, isolation between them, suspension, owner reset', async () => {
  const plat = client(S.base);
  assert.equal((await plat('/api/platform/tenants')).status, 401);
  assert.equal((await owner('/api/platform/tenants')).status, 403, 'restaurant owners are not platform owners');
  const wrongPw = await plat('/api/auth/login', { method: 'POST', body: { email: PLATFORM.email, password: 'wrong-password-x' } });
  assert.equal(wrongPw.status, 401);
  assert.equal((await plat.login(PLATFORM.email, PLATFORM.password)).json.next, '/platform');

  // validation
  assert.equal((await plat('/api/platform/tenants', { method: 'POST', body: { name: 'X', slug: 'admin', ownerEmail: 'a@b.co' } })).status, 400, 'reserved slug');
  assert.equal((await plat('/api/platform/tenants', { method: 'POST', body: { name: 'X', slug: 'Bad Slug!', ownerEmail: 'a@b.co' } })).status, 400);
  assert.equal((await plat('/api/platform/tenants', { method: 'POST', body: { name: 'X', ownerEmail: 'nope' } })).status, 400);
  assert.equal((await plat('/api/platform/tenants', { method: 'POST', body: { name: 'X', ownerEmail: OWNER.email } })).status, 400, 'emails are unique');
  assert.equal((await plat('/api/platform/tenants', { method: 'POST', body: { name: 'X', slug: SLUG, ownerEmail: 'new@x.co' } })).status, 400, 'slugs are unique');

  const made = await plat('/api/platform/tenants', { method: 'POST', body: { name: 'Blue Lotus Café', ownerEmail: 'Priya@BlueLotus.test', ownerName: 'Priya' } });
  assert.equal(made.status, 201);
  assert.equal(made.json.tenant.slug, 'blue-lotus-cafe');
  assert.equal(made.json.owner.email, 'priya@bluelotus.test');
  const temp = made.json.owner.tempPassword;
  assert.ok(temp.length >= 12);
  const sample = await plat('/api/platform/tenants', { method: 'POST', body: { name: 'Spice Route', slug: 'spice-route', ownerEmail: 'raj@spice.test', sample: true } });
  assert.equal(sample.status, 201);

  const lotusApi = (p) => `/api/r/blue-lotus-cafe${p}`;
  const blank = (await guest(lotusApi('/menu'))).json;
  assert.equal(blank.restaurant.name, 'Blue Lotus Café');
  assert.equal(blank.items.length, 0, 'a new restaurant starts with an empty menu');
  assert.ok((await guest('/api/r/spice-route/menu')).json.items.length >= 10, 'or the sample menu if asked');

  // new owner must change the temporary password before using the console
  const lotus = client(S.base);
  const li = await lotus.login('priya@bluelotus.test', temp);
  assert.equal(li.json.mustChangePassword, true);
  const blocked = await lotus(lotusApi('/admin/state'));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'password_change_required');
  assert.equal((await lotus('/api/auth/password', { method: 'POST', body: { current: temp, next: 'short' } })).status, 400);
  assert.equal((await lotus('/api/auth/password', { method: 'POST', body: { current: 'wrong-current', next: 'lotus-new-pass-1' } })).status, 400);
  assert.equal((await lotus('/api/auth/password', { method: 'POST', body: { current: temp, next: 'lotus-new-pass-1' } })).status, 200);
  assert.equal((await lotus(lotusApi('/admin/state'))).status, 200);

  // isolation: same table ids, different restaurants, nothing crosses over
  const cat = (await lotus(lotusApi('/admin/categories'), { method: 'POST', body: { name: 'Teas' } })).json;
  const tea = (await lotus(lotusApi('/admin/items'), { method: 'POST', body: { name: 'Masala chai', price: 60, category: cat.id } })).json;
  const lotusOrder = (await guest(lotusApi('/orders'), { method: 'POST', body: { table: 'T1', items: [{ id: tea.id, qty: 2 }] } })).json;
  assert.equal(lotusOrder.total, 126);
  const emberMenu = (await guest(api('/menu'))).json;
  assert.ok(!emberMenu.items.some((i) => i.id === tea.id), 'dish only on its own menu');
  assert.equal((await guest(api('/orders'), { method: 'POST', body: { table: 'T1', items: [{ id: tea.id, qty: 1 }] } })).status, 400, 'cannot order another restaurant\'s dish');
  assert.equal((await guest(api(`/orders/${lotusOrder.id}`))).status, 404, 'orders are not visible across restaurants');
  const emberState = (await owner(adm('/state'))).json;
  assert.ok(!emberState.orders.some((o) => o.id === lotusOrder.id));
  // a signed-in owner of one restaurant gets nothing from another
  assert.equal((await owner(lotusApi('/admin/state'))).status, 403);
  assert.equal((await owner(lotusApi(`/admin/orders/${lotusOrder.id}`), { method: 'PATCH', body: { status: 'served' } })).status, 403);
  assert.equal((await lotus(adm('/state'))).status, 403);
  assert.equal((await lotus(adm('/reset'), { method: 'POST' })).status, 403);
  assert.equal((await lotus(lotusApi('/admin/reset'), { method: 'POST' })).status, 403, 'only the demo restaurant resets');

  // listing
  const list = (await plat('/api/platform/tenants')).json;
  assert.equal(list.tenants.length, 3);
  assert.doesNotMatch(JSON.stringify(list), /hash|scrypt|tempPassword/);
  const lotusId = made.json.tenant.id;

  // suspend: guests and staff are locked out, other restaurants unaffected
  assert.equal((await plat(`/api/platform/tenants/${lotusId}`, { method: 'PATCH', body: { status: 'closed' } })).status, 400);
  assert.equal((await plat(`/api/platform/tenants/${lotusId}`, { method: 'PATCH', body: { status: 'suspended' } })).status, 200);
  assert.equal((await guest(lotusApi('/menu'))).status, 403);
  assert.equal((await guest(lotusApi('/orders'), { method: 'POST', body: { table: 'T1', items: [{ id: tea.id, qty: 1 }] } })).status, 403);
  assert.equal((await lotus(lotusApi('/admin/state'))).status, 403);
  assert.equal((await lotus('/api/auth/login', { method: 'POST', body: { email: 'priya@bluelotus.test', password: 'lotus-new-pass-1' } })).status, 403);
  assert.equal((await guest(api('/menu'))).status, 200);
  await plat(`/api/platform/tenants/${lotusId}`, { method: 'PATCH', body: { status: 'active' } });
  assert.equal((await guest(lotusApi('/menu'))).status, 200);

  // platform resets a forgotten owner password: old sessions die, new temp works
  const old = client(S.base);
  await old.login('priya@bluelotus.test', 'lotus-new-pass-1');
  const reset = await plat(`/api/platform/tenants/${lotusId}/reset-owner`, { method: 'POST' });
  assert.equal(reset.status, 200);
  assert.equal((await old('/api/auth/me')).status, 401, 'reset signs out existing sessions');
  assert.equal((await client(S.base)('/api/auth/login', { method: 'POST', body: { email: 'priya@bluelotus.test', password: 'lotus-new-pass-1' } })).status, 401);
  await client(S.base).login('priya@bluelotus.test', reset.json.tempPassword);
});

test('team: owner adds staff; staff run the floor but cannot edit the menu or team', async () => {
  const add = await owner(adm('/team'), { method: 'POST', body: { email: 'waiter@ember.test', name: 'Sam', role: 'staff' } });
  assert.equal(add.status, 201);
  assert.equal((await owner(adm('/team'), { method: 'POST', body: { email: 'waiter@ember.test' } })).status, 400, 'duplicate email');
  const staff = client(S.base);
  await staff.login('waiter@ember.test', add.json.tempPassword);
  await staff('/api/auth/password', { method: 'POST', body: { current: add.json.tempPassword, next: 'waiter-pass-5678' } });
  const st = await staff(adm('/state'));
  assert.equal(st.status, 200);
  assert.equal(st.json.me.role, 'staff');
  const menu = (await guest(api('/menu'))).json;
  assert.equal((await staff(adm(`/items/${menu.items[0].id}/availability`), { method: 'PATCH', body: { available: true } })).status, 200, 'staff may mark sold out');
  assert.equal((await staff(adm('/items'), { method: 'POST', body: { name: 'x', price: 1, category: 'mains' } })).status, 403);
  assert.equal((await staff(adm(`/items/${menu.items[0].id}`), { method: 'DELETE' })).status, 403);
  assert.equal((await staff(adm('/restaurant'), { method: 'PUT', body: { name: 'Hacked' } })).status, 403);
  assert.equal((await staff(adm('/team'))).status, 403);
  assert.equal((await staff(adm('/tables'), { method: 'POST', body: { label: 'X' } })).status, 403);

  // the owner cannot remove themselves or the last owner; can remove staff (sessions end)
  const team = (await owner(adm('/team'))).json;
  const me = team.find((u) => u.you);
  assert.equal((await owner(adm(`/team/${me.id}`), { method: 'DELETE' })).status, 400);
  const sam = team.find((u) => u.email === 'waiter@ember.test');
  assert.equal((await owner(adm(`/team/${sam.id}`), { method: 'DELETE' })).status, 204);
  assert.equal((await staff(adm('/state'))).status, 401, 'removed staff are signed out immediately');
});

test('login is rate limited per account', async () => {
  const s = await startServer({ rateLimit: true });
  const c = client(s.base);
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await c('/api/auth/login', { method: 'POST', body: { email: OWNER.email, password: `bad-${i}-password` } })).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
  assert.equal(codes[8], 429);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: OWNER.email, password: OWNER.password } })).status, 429, 'even the right password waits');
  await s.close();
});

test('rate limits still protect ordering in normal operation', async () => {
  const s = await startServer({ rateLimit: true });
  const c = client(s.base);
  const menu = (await c(api('/menu'))).json;
  const codes = [];
  for (let k = 0; k < 9; k++) codes.push((await c(api('/orders'), { method: 'POST', body: { table: 'T1', items: [{ id: menu.items[0].id, qty: 1 }] } })).status);
  await s.close();
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(201));
  assert.equal(codes[8], 429);
});

test('serverless polling feed carries orders and payments; no SSE', async () => {
  const s = await startServer({ realtime: 'poll' });
  const g = client(s.base);
  const o = client(s.base);
  await o.login(OWNER.email, OWNER.password);
  const since = new Date(Date.now() - 1000).toISOString();
  const menu = (await g(api('/menu'))).json;
  assert.equal(menu.realtime, 'poll');
  const order = (await g(api('/orders'), { method: 'POST', body: { table: 'T2', items: [{ id: menu.items[0].id, qty: 1 }] } })).json;
  const pay = (await g(api('/tables/T2/payments'), { method: 'POST', body: { mode: 'full', method: 'cash', name: 'Mira' } })).json;
  const ch = (await o(adm(`/changes?since=${encodeURIComponent(since)}`))).json;
  assert.ok(ch.orders.some((x) => x.id === order.id));
  assert.equal(ch.orders[0].ip, undefined);
  assert.equal(ch.payments[0].id, pay.payment.id);
  assert.equal((await o(adm('/stream'))).status, 404);
  assert.equal((await g(adm('/changes'))).status, 401);
  await s.close();
});

// ------------------------------------------------------------------ boot, migration, config
test('first boot copies the old single-restaurant data into a tenant (and leaves it untouched)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
  const legacyFile = path.join(dir, 'db.json');
  const legacy = { ...require('../data/seed'), restaurant: { ...require('../data/seed').restaurant, name: 'Old Place' }, seq: 1234 };
  legacy.orders = [{ id: 'o-legacy', number: 1234, table: 'T1', tableLabel: 'Table 1', items: [], subtotal: 0, tax: 0, service: 0, total: 0, status: 'served', history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  const before = fs.readFileSync(legacyFile, 'utf8');
  const logs = [];
  const s = await startServer({ dataDir: path.join(dir, 'store'), legacyFile, legacySlug: 'old-place', ownerEmail: '', ownerPassword: '', log: (m) => logs.push(m) });
  const g = client(s.base);
  const menu = (await g('/api/r/old-place/menu')).json;
  assert.equal(menu.restaurant.name, 'Old Place');
  assert.equal((await g('/api/r/old-place/orders/o-legacy')).status, 200, 'old orders came along');
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), before, 'legacy file untouched');
  // generated owner password printed once on the server, never sent to a browser
  const line = logs.join('\n');
  const pw = line.match(/temporary password: (\S+)/)[1];
  const c = client(s.base);
  const li = await c.login('owner@old-place.menu', pw);
  assert.equal(li.json.mustChangePassword, true);
  await s.close();

  // restart on the same data: no second migration, data persisted on disk
  const logs2 = [];
  const s2 = await startServer({ dataDir: path.join(dir, 'store'), legacyFile, legacySlug: 'old-place', ownerEmail: '', ownerPassword: '', log: (m) => logs2.push(m) });
  assert.equal((await client(s2.base)('/api/r/old-place/menu')).json.restaurant.name, 'Old Place');
  assert.doesNotMatch(logs2.join('\n'), /temporary password/);
  await s2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('production refuses to run without a session secret; platform console needs env credentials', async () => {
  assert.throws(() => createApp({ dataDir: null, legacyFile: null, databaseUrl: '', production: true, sessionSecret: '', log: quiet }), /SESSION_SECRET/);
  assert.throws(() => createApp({ dataDir: null, legacyFile: null, databaseUrl: '', production: true, sessionSecret: 'short', log: quiet }), /32/);
  const logs = [];
  const s = await startServer({ production: true, platformAdmin: { email: 'p@x.co', password: '' }, log: (m) => logs.push(m) });
  assert.match(logs.join('\n'), /platform console is disabled/);
  const c = client(s.base);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'p@x.co', password: 'anything-at-all' } })).status, 401);
  await s.close();
});

'use strict';
// One deployment, many restaurants. Every tenant request resolves the restaurant from the
// URL (/api/r/<slug>/...), loads only that restaurant's document, and staff requests must
// carry a signed session for that same restaurant. No secret ever reaches the browser.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { createKV } = require('./store');
const sec = require('./security');
const T = require('./tenancy');

const { seed, tenantKey, clone } = T;
const SEED_PHOTOS = Object.fromEntries(seed.items.filter((i) => i.image).map((i) => [i.id, i.image]));
const ORDER_FLOW = ['placed', 'accepted', 'preparing', 'ready', 'served'];
const ORDER_STATUSES = [...ORDER_FLOW, 'cancelled'];
const CALL_REASONS = ['waiter', 'water', 'bill', 'cutlery'];
const PAY_METHODS = ['upi', 'card', 'cash'];
const SPLIT_MODES = ['full', 'equal', 'items'];
const PAY_STATUSES = ['confirmed', 'rejected'];
const UPI_ID = /^[\w.-]{2,64}@[A-Za-z][\w]{1,63}$/;
const MINUTE = 60_000;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}
const bad = (msg) => new HttpError(400, msg);

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const money = (n) => Math.round(n * 100) / 100;
const slug = (s) => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeUrl = (u) => {
  const s = str(u, 500);
  if (!s) return '';
  // site-relative asset paths (e.g. /img/dishes/i1.jpg) — but never protocol-relative //host
  if (/^\/(?!\/)[\w\-./]+$/.test(s) && !s.includes('..')) return s;
  try {
    const parsed = new URL(s);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch { return ''; }
};
const hexColor = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : fallback);
const queryOf = (req) => { const i = req.originalUrl.indexOf('?'); return i < 0 ? '' : req.originalUrl.slice(i); };

function createApp(options = {}) {
  const env = process.env;
  const production = options.production !== undefined ? options.production : (env.NODE_ENV === 'production' || Boolean(env.VERCEL));
  const log = options.log || ((...a) => console.log(...a));
  const databaseUrl = options.databaseUrl !== undefined ? options.databaseUrl : (env.DATABASE_URL || env.POSTGRES_URL || '');
  const root = path.join(__dirname, '..');
  const kv = createKV({
    databaseUrl,
    dir: options.dataDir !== undefined ? options.dataDir : (env.VERCEL ? '/tmp/qm-store' : path.join(root, 'data', 'store')),
    legacyFile: options.legacyFile !== undefined ? options.legacyFile : path.join(root, 'data', 'db.json'),
  });
  const secret = sec.resolveSecret({ sessionSecret: options.sessionSecret || env.SESSION_SECRET, databaseUrl, production });
  const publicUrlEnv = String(options.publicUrl || env.PUBLIC_URL || '').replace(/\/+$/, '');
  // Serverless hosts (Vercel) can't hold SSE connections or share memory between
  // instances, so clients poll instead. Locally we keep instant SSE push.
  const realtime = options.realtime || (env.VERCEL ? 'poll' : 'sse');
  const limitsOn = options.rateLimit !== false; // tests may switch limits off
  const limiter = new sec.RateLimiter();
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const hmac = (s) => crypto.createHmac('sha256', secret).update(s).digest();

  // ---------- platform owner (credentials only ever come from the server environment) ----------
  const platformAdmin = (() => {
    const cfg = options.platformAdmin || {};
    const email = sec.normEmail(cfg.email || env.PLATFORM_ADMIN_EMAIL || 'platform@admin.local');
    let password = cfg.password || env.PLATFORM_ADMIN_PASSWORD || '';
    if (!password) {
      if (production) { log('[platform] PLATFORM_ADMIN_PASSWORD is not set: the platform console is disabled.'); return null; }
      password = sec.randomPassword(16);
      log(`\n  Platform console (dev only, new password every start):\n    email:    ${email}\n    password: ${password}\n`);
    } else if (production && password.length < 12) {
      log('[platform] PLATFORM_ADMIN_PASSWORD must be at least 12 characters: the platform console is disabled.');
      return null;
    }
    const pwMac = hmac(`pw|${password}`);
    return {
      email,
      version: hmac(`platform|${email}|${password}`).toString('base64url').slice(0, 22),
      check: (pw) => crypto.timingSafeEqual(hmac(`pw|${pw}`), pwMac),
    };
  })();

  // ---------- first boot ----------
  let readyPromise = null;
  const ready = () => {
    if (!readyPromise) {
      readyPromise = T.bootstrap(kv, {
        legacySlug: options.legacySlug || env.LEGACY_TENANT_SLUG || 'ember-saffron',
        ownerEmail: options.ownerEmail || env.OWNER_EMAIL,
        ownerPassword: options.ownerPassword || env.OWNER_PASSWORD,
      }).then((info) => {
        if (info) {
          log(`\n  Created restaurant "${info.slug}"${info.migrated ? ' (copied from the previous single-restaurant data)' : ''}.`);
          log(`    owner login: ${info.email}${info.password ? `\n    temporary password: ${info.password}   (shown once — you will be asked to change it)` : ''}\n`);
        }
        return info;
      }).catch((err) => { readyPromise = null; throw err; });
    }
    return readyPromise;
  };

  const platformDoc = async () => {
    const p = await kv.read('platform');
    if (!p) throw new HttpError(503, 'Starting up, please retry.');
    return p;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy !== undefined ? options.trustProxy : (env.VERCEL ? true : 'loopback, linklocal, uniquelocal'));
  app.use(express.json({ limit: '100kb' }));

  // ---------- security headers ----------
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ---------- realtime (Server-Sent Events), always scoped to one restaurant ----------
  const streams = new Set(); // { res, tenantId, scope: 'admin' | orderId }
  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  function broadcast(tenantId, event, data, orderId) {
    for (const s of streams) {
      if (s.tenantId !== tenantId) continue;
      if (s.scope === 'admin' || (orderId && s.scope === orderId)) send(s.res, event, data);
    }
  }
  function openStream(req, res, tenantId, scope) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const entry = { res, tenantId, scope };
    streams.add(entry);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); streams.delete(entry); });
    return entry;
  }
  // Staff streams re-authenticate when they reconnect: close them after access changes.
  function closeAdminStreams(tenantId) {
    for (const s of streams) if (s.tenantId === tenantId && s.scope === 'admin') { s.res.end(); streams.delete(s); }
  }

  const rateLimit = (key, max, windowMs, msg = 'Too many requests, please wait a moment.') => {
    if (limitsOn && !limiter.check(key, max, windowMs)) throw new HttpError(429, msg);
  };

  // ---------- sessions ----------
  const setSession = (req, res, payload) => res.append('Set-Cookie', sec.sessionCookie(sec.signSession(secret, payload), { secure: req.secure }));
  const clearSession = (req, res) => res.append('Set-Cookie', sec.clearCookie({ secure: req.secure }));

  async function authenticate(req) {
    const token = sec.parseCookies(req.headers.cookie)[sec.COOKIE];
    if (!token) return null;
    const s = sec.readSession(secret, token);
    if (!s) return null;
    if (s.r === 'platform') {
      if (!platformAdmin || s.u !== 'platform' || s.v !== platformAdmin.version) return null;
      return { role: 'platform', email: platformAdmin.email, name: 'Platform owner', user: null, tenant: null };
    }
    const p = await platformDoc();
    const user = p.users.find((u) => u.id === s.u);
    if (!user || user.tokenVersion !== s.v || user.tenantId !== s.t) return null;
    const tenant = p.tenants.find((t) => t.id === user.tenantId);
    if (!tenant) return null;
    // role comes from the stored account, not the cookie, so changes apply immediately
    return { role: user.role, email: user.email, name: user.name, user, tenant };
  }

  const needAuth = (roles) => h(async (req, res, next) => {
    const a = await authenticate(req);
    if (!a) throw new HttpError(401, 'Please sign in.');
    if (!roles.includes(a.role)) throw new HttpError(403, 'You do not have access to this.');
    if (a.tenant && a.tenant.status !== 'active') throw new HttpError(403, 'This restaurant account is suspended. Please contact support.');
    req.auth = a;
    next();
  });

  // CSRF: browsers only let same-origin scripts set custom headers, and we serve no CORS.
  // Also reject any request whose Origin header names another site.
  function csrf(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.get('x-qm-csrf') !== '1') return next(new HttpError(403, 'Request blocked (missing security header).'));
    const origin = req.get('origin');
    if (origin && origin !== 'null') {
      let host = '';
      try { host = new URL(origin).host; } catch { /* invalid */ }
      if (host !== req.get('host')) return next(new HttpError(403, 'Request blocked (cross-site).'));
    }
    next();
  }

  const ownerOnly = (req, res, next) => (req.auth.role === 'owner' ? next() : next(new HttpError(403, 'Only the restaurant owner can change this.')));

  const baseUrl = (req, d) => (d.restaurant.publicUrl || publicUrlEnv || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const tableUrl = (req, d, tenant, tableId) => `${baseUrl(req, d)}/r/${tenant.slug}/menu?t=${encodeURIComponent(tableId)}`;
  const publicOrder = (o) => { const { ip, ...rest } = o; return rest; }; // never leak customer IPs
  const publicPayment = (p) => { const { ip, ...rest } = p; return rest; };
  const publicUser = (u, meId) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, mustChangePassword: Boolean(u.mustChangePassword), you: u.id === meId });
  const publicTenant = (t) => ({ id: t.id, slug: t.slug, name: t.name, status: t.status, plan: t.plan, demo: Boolean(t.demo), createdAt: t.createdAt });

  // Everything under /api waits for first-boot setup (a no-op after the first request).
  app.use('/api', h(async (req, res, next) => { await ready(); next(); }));

  // ======================= GLOBAL API =======================
  app.get('/api/health', h(async (req, res) => {
    await platformDoc();
    res.json({ ok: true, storage: databaseUrl ? 'postgres' : 'file', realtime });
  }));

  async function defaultTenant() {
    const p = await platformDoc();
    const active = p.tenants.filter((t) => t.status === 'active');
    return active.find((t) => t.slug === p.defaultSlug) || active[0] || null;
  }

  app.get('/api/default-tenant', h(async (req, res) => {
    const t = await defaultTenant();
    if (!t) throw new HttpError(404, 'No restaurant is set up yet.');
    res.json({ slug: t.slug, name: t.name });
  }));

  // ---------- auth ----------
  const auth = express.Router();
  auth.use(csrf);

  auth.post('/login', h(async (req, res) => {
    const b = req.body || {};
    const email = sec.normEmail(typeof b.email === 'string' ? b.email : '').slice(0, 120);
    const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
    if (!email || !password) throw bad('Enter your email and password.');
    const tooMany = 'Too many sign-in attempts. Please wait 15 minutes and try again.';
    rateLimit(`login-ip:${req.ip}`, 20, 15 * MINUTE, tooMany);
    rateLimit(`login-email:${email}`, 8, 15 * MINUTE, tooMany);
    const fail = () => new HttpError(401, 'Email or password is incorrect.');

    if (platformAdmin && email === platformAdmin.email) {
      await sec.dummyVerify(password); // same cost as a real account
      if (!platformAdmin.check(password)) throw fail();
      limiter.reset(`login-email:${email}`);
      setSession(req, res, { u: 'platform', r: 'platform', v: platformAdmin.version });
      return res.json({ role: 'platform', name: 'Platform owner', next: '/platform' });
    }

    const p = await platformDoc();
    const user = p.users.find((u) => u.email === email);
    if (!user) { await sec.dummyVerify(password); throw fail(); }
    if (!(await sec.verifyPassword(password, user.hash))) throw fail();
    const tenant = p.tenants.find((t) => t.id === user.tenantId);
    if (!tenant) throw fail();
    if (tenant.status !== 'active') throw new HttpError(403, 'This restaurant account is suspended. Please contact support.');
    limiter.reset(`login-email:${email}`);
    setSession(req, res, { u: user.id, t: tenant.id, r: user.role, v: user.tokenVersion });
    res.json({
      role: user.role, name: user.name, tenant: { slug: tenant.slug, name: tenant.name },
      mustChangePassword: Boolean(user.mustChangePassword), next: `/r/${tenant.slug}/admin`,
    });
  }));

  auth.post('/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });

  auth.get('/me', h(async (req, res) => {
    const a = await authenticate(req);
    if (!a) throw new HttpError(401, 'Please sign in.');
    res.json({
      email: a.email, name: a.name, role: a.role,
      tenant: a.tenant ? { slug: a.tenant.slug, name: a.tenant.name, status: a.tenant.status } : null,
      mustChangePassword: Boolean(a.user && a.user.mustChangePassword),
    });
  }));

  auth.post('/password', needAuth(['owner', 'staff', 'platform']), h(async (req, res) => {
    if (req.auth.role === 'platform') throw bad('The platform password is set in the server environment (PLATFORM_ADMIN_PASSWORD).');
    const b = req.body || {};
    const current = typeof b.current === 'string' ? b.current.slice(0, 200) : '';
    const next = typeof b.next === 'string' ? b.next : '';
    rateLimit(`pw:${req.auth.user.id}`, 10, 15 * MINUTE);
    const weak = sec.checkPasswordStrength(next);
    if (weak) throw bad(weak);
    if (next === current) throw bad('Choose a password different from the current one.');
    if (!(await sec.verifyPassword(current, req.auth.user.hash))) throw bad('Your current password is incorrect.');
    const hash = await sec.hashPassword(next);
    const user = await kv.mutate('platform', (p) => {
      const u = p.users.find((x) => x.id === req.auth.user.id);
      if (!u || u.tokenVersion !== req.auth.user.tokenVersion) throw new HttpError(401, 'Please sign in again.');
      u.hash = hash;
      u.tokenVersion += 1; // signs out every other device
      u.mustChangePassword = false;
      return u;
    });
    closeAdminStreams(user.tenantId);
    setSession(req, res, { u: user.id, t: user.tenantId, r: user.role, v: user.tokenVersion });
    res.json({ ok: true });
  }));

  app.use('/api/auth', auth);

  // ======================= PLATFORM API (SaaS owner) =======================
  const plat = express.Router();
  plat.use(csrf, needAuth(['platform']));

  plat.get('/tenants', h(async (req, res) => {
    const p = await platformDoc();
    res.json({
      defaultSlug: p.defaultSlug,
      tenants: p.tenants.map((t) => {
        const team = p.users.filter((u) => u.tenantId === t.id);
        return { ...publicTenant(t), owners: team.filter((u) => u.role === 'owner').map((u) => u.email), staff: team.filter((u) => u.role === 'staff').length };
      }),
    });
  }));

  plat.post('/tenants', h(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 60);
    if (!name) throw bad('Restaurant name is required.');
    const tslug = str(b.slug, 40).toLowerCase() || sec.slugify(name);
    if (!sec.validSlug(tslug)) throw bad('Web address must be 3–32 characters: lowercase letters, numbers and single hyphens (and not a reserved word).');
    const email = sec.normEmail(b.ownerEmail);
    if (!sec.validEmail(email) || (platformAdmin && email === platformAdmin.email)) throw bad('Enter a valid owner email address.');
    const ownerName = str(b.ownerName, 60) || 'Owner';
    const pre = await platformDoc();
    if (pre.tenants.some((t) => t.slug === tslug)) throw bad('That web address is already taken.');
    if (pre.users.some((u) => u.email === email)) throw bad('That email already has an account. Use a different one.');

    const temp = sec.randomPassword();
    const hash = await sec.hashPassword(temp);
    const now = new Date().toISOString();
    const tenant = { id: T.newId('tn'), slug: tslug, name, status: 'active', plan: str(b.plan, 20) || 'standard', demo: false, createdAt: now };
    const data = b.sample ? T.sampleTenantData(name) : T.blankTenantData(name);
    await kv.mutate(tenantKey(tenant.id), () => {}, () => data);
    await kv.mutate('platform', (p) => {
      if (p.tenants.some((t) => t.slug === tslug)) throw bad('That web address is already taken.');
      if (p.users.some((u) => u.email === email)) throw bad('That email already has an account. Use a different one.');
      p.tenants.push(tenant);
      p.users.push({ id: T.newId('us'), email, name: ownerName, role: 'owner', tenantId: tenant.id, hash, tokenVersion: 1, mustChangePassword: true, createdAt: now });
    });
    res.status(201).json({ tenant: publicTenant(tenant), owner: { email, tempPassword: temp } });
  }));

  plat.patch('/tenants/:id', h(async (req, res) => {
    const b = req.body || {};
    const t = await kv.mutate('platform', (p) => {
      const t = p.tenants.find((x) => x.id === req.params.id);
      if (!t) throw new HttpError(404, 'Restaurant not found');
      if (b.status !== undefined) {
        if (!['active', 'suspended'].includes(b.status)) throw bad('Status must be active or suspended.');
        t.status = b.status;
      }
      if (b.name !== undefined) { const n = str(b.name, 60); if (!n) throw bad('Name is required.'); t.name = n; }
      if (b.plan !== undefined) t.plan = str(b.plan, 20) || t.plan;
      return t;
    });
    if (t.status !== 'active') closeAdminStreams(t.id);
    res.json(publicTenant(t));
  }));

  plat.post('/tenants/:id/reset-owner', h(async (req, res) => {
    const temp = sec.randomPassword();
    const hash = await sec.hashPassword(temp);
    const out = await kv.mutate('platform', (p) => {
      const t = p.tenants.find((x) => x.id === req.params.id);
      if (!t) throw new HttpError(404, 'Restaurant not found');
      const owner = p.users.find((u) => u.tenantId === t.id && u.role === 'owner');
      if (!owner) throw new HttpError(404, 'This restaurant has no owner account.');
      owner.hash = hash;
      owner.tokenVersion += 1;
      owner.mustChangePassword = true;
      return { email: owner.email, tenantId: t.id };
    });
    closeAdminStreams(out.tenantId);
    res.json({ email: out.email, tempPassword: temp });
  }));

  plat.put('/default', h(async (req, res) => {
    const want = str(req.body && req.body.slug, 40);
    await kv.mutate('platform', (p) => {
      const t = p.tenants.find((x) => x.slug === want);
      if (!t) throw new HttpError(404, 'Restaurant not found');
      p.defaultSlug = t.slug;
    });
    res.json({ defaultSlug: want });
  }));

  app.use('/api/platform', plat);

  // ======================= RESTAURANT (TENANT) API =======================
  const tenantApi = express.Router({ mergeParams: true });

  tenantApi.use(h(async (req, res, next) => {
    const s = req.params.slug;
    if (!sec.validSlug(s)) throw new HttpError(404, 'Restaurant not found');
    const p = await platformDoc();
    const tenant = p.tenants.find((t) => t.slug === s);
    if (!tenant) throw new HttpError(404, 'Restaurant not found');
    if (tenant.status !== 'active') throw new HttpError(403, 'This restaurant’s menu is currently unavailable.');
    req.tenant = tenant;
    next();
  }));

  const db = async (req) => {
    const d = await kv.read(tenantKey(req.tenant.id));
    if (!d) throw new HttpError(404, 'Restaurant not found');
    return d;
  };
  const mutate = (req, fn) => kv.mutate(tenantKey(req.tenant.id), fn);

  // ---------- staff console (mounted before the public routes) ----------
  const admin = express.Router({ mergeParams: true });
  admin.use(csrf, needAuth(['owner', 'staff']), (req, res, next) => {
    if (req.auth.tenant.id !== req.tenant.id) return next(new HttpError(403, 'You do not have access to this restaurant.'));
    if (req.auth.user.mustChangePassword) return next(new HttpError(403, 'Please set a new password first.', 'password_change_required'));
    next();
  });
  tenantApi.use('/admin', admin);

  // ======================= PUBLIC (GUEST) API =======================
  tenantApi.get('/menu', h(async (req, res) => {
    const d = await db(req);
    const { publicUrl, ...restaurant } = d.restaurant;
    // Dishes from the original seed get their bundled photo even in databases created
    // before photos existed (no migration needed); an explicit image always wins.
    const items = d.items.map((i) => (i.image || !SEED_PHOTOS[i.id] ? i : { ...i, image: SEED_PHOTOS[i.id] }));
    res.json({ restaurant, categories: d.categories, items, realtime, slug: req.tenant.slug });
  }));

  tenantApi.get('/tables', h(async (req, res) => res.json((await db(req)).tables.map(({ id, label }) => ({ id, label })))));

  tenantApi.get('/tables/:id', h(async (req, res) => {
    const t = (await db(req)).tables.find((x) => x.id === req.params.id);
    if (!t) throw new HttpError(404, 'Unknown table');
    res.json(t);
  }));

  tenantApi.post('/orders', h(async (req, res) => {
    rateLimit(`order:${req.ip}`, 8, MINUTE);
    const order = await mutate(req, (d) => createOrder(d, req));
    broadcast(req.tenant.id, 'order:new', publicOrder(order));
    res.status(201).json(publicOrder(order));
  }));

  function createOrder(d, req) {
    const body = req.body || {};
    const table = d.tables.find((t) => t.id === str(body.table, 20));
    if (!table) throw bad('Please scan the QR code on your table again — table not recognised.');
    if (!Array.isArray(body.items) || body.items.length === 0) throw bad('Your cart is empty.');
    if (body.items.length > 50) throw bad('Too many different items in one order.');

    const merged = new Map();
    for (const line of body.items) {
      const item = d.items.find((i) => i.id === str(line && line.id, 40));
      if (!item) throw bad('One of the dishes no longer exists. Please refresh the menu.');
      if (item.available === false) throw bad(`Sorry, "${item.name}" just sold out.`);
      const qty = int(line.qty, 1, 20, 1);
      const note = str(line.note, 120);
      const key = `${item.id}|${note}`;
      const prev = merged.get(key);
      if (prev) prev.qty = Math.min(20, prev.qty + qty);
      else merged.set(key, { id: item.id, name: item.name, emoji: item.emoji, veg: item.veg, price: item.price, qty, note });
    }
    const lines = [...merged.values()];
    const subtotal = money(lines.reduce((s, l) => s + l.price * l.qty, 0));
    const tax = money((subtotal * (Number(d.restaurant.taxRate) || 0)) / 100);
    const service = money((subtotal * (Number(d.restaurant.serviceCharge) || 0)) / 100);
    const now = new Date().toISOString();
    const order = {
      id: crypto.randomUUID(),
      number: ++d.seq,
      table: table.id,
      tableLabel: table.label,
      name: str(body.name, 40),
      note: str(body.note, 200),
      items: lines,
      subtotal, tax, service,
      total: money(subtotal + tax + service),
      status: 'placed',
      paid: false,
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'placed', at: now }],
      ip: req.ip,
    };
    d.orders.push(order);
    if (d.orders.length > 2000) d.orders.splice(0, d.orders.length - 2000);
    return order;
  }

  tenantApi.get('/orders/:id', h(async (req, res) => {
    const o = (await db(req)).orders.find((x) => x.id === req.params.id);
    if (!o) throw new HttpError(404, 'Order not found');
    res.json(publicOrder(o));
  }));

  tenantApi.get('/orders/:id/events', h(async (req, res) => {
    if (realtime !== 'sse') throw new HttpError(404, 'Live stream not available here; poll the order instead');
    const o = (await db(req)).orders.find((x) => x.id === req.params.id);
    if (!o) throw new HttpError(404, 'Order not found');
    openStream(req, res, req.tenant.id, o.id);
    send(res, 'order:update', publicOrder(o));
  }));

  tenantApi.post('/calls', h(async (req, res) => {
    rateLimit(`call:${req.ip}`, 6, MINUTE);
    const result = await mutate(req, (d) => {
      const table = d.tables.find((t) => t.id === str(req.body && req.body.table, 20));
      if (!table) throw bad('Unknown table');
      const reason = CALL_REASONS.includes(req.body.reason) ? req.body.reason : 'waiter';
      const open = d.calls.find((c) => c.table === table.id && c.reason === reason && !c.resolved);
      if (open) return { call: open, created: false }; // idempotent — no spam on the floor
      const call = { id: crypto.randomUUID(), table: table.id, tableLabel: table.label, reason, resolved: false, createdAt: new Date().toISOString() };
      d.calls.push(call);
      if (d.calls.length > 500) d.calls.splice(0, d.calls.length - 500);
      return { call, created: true };
    });
    if (!result.created) return res.json(result.call);
    broadcast(req.tenant.id, 'call:new', result.call);
    res.status(201).json(result.call);
  }));

  // ---------- bills & payments ----------
  // A table's open bill = its non-cancelled, unsettled orders. Guests pay it in full, split
  // it equally, or pay for their own dishes. The SERVER computes every amount. There is no
  // card gateway, so each payment is "pending" until staff confirm the money arrived; when
  // confirmed payments cover the bill the table settles (orders marked paid, bill closed).
  const openOrders = (d, tableId) => d.orders.filter((o) => o.table === tableId && o.status !== 'cancelled' && !o.settled);
  const openPayments = (d, tableId) => d.payments.filter((p) => p.table === tableId && !p.settled);
  const sumOf = (list, f) => money(list.reduce((acc, x) => acc + (Number(f(x)) || 0), 0));

  function computeBill(d, table) {
    const orders = openOrders(d, table.id);
    const payments = openPayments(d, table.id);
    const live = payments.filter((p) => p.status !== 'rejected');
    const claimedBy = {};
    for (const p of live) for (const k of p.lines || []) claimedBy[k] = p.name || 'A guest';
    const lines = [];
    for (const o of orders) {
      o.items.forEach((l, idx) => {
        const key = `${o.id}:${idx}`;
        lines.push({ key, order: o.number, name: l.name, veg: l.veg, qty: l.qty, price: l.price, amount: money(l.price * l.qty), note: l.note || '', claimedBy: claimedBy[key] || null });
      });
    }
    const total = sumOf(orders, (o) => o.total);
    const paid = sumOf(live.filter((p) => p.status === 'confirmed'), (p) => p.amount);
    const pending = sumOf(live.filter((p) => p.status === 'pending'), (p) => p.amount);
    return {
      table: { id: table.id, label: table.label },
      currency: d.restaurant.currency || '₹',
      taxRate: Number(d.restaurant.taxRate) || 0,
      serviceCharge: Number(d.restaurant.serviceCharge) || 0,
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, name: o.name, total: o.total, createdAt: o.createdAt })),
      lines,
      subtotal: sumOf(orders, (o) => o.subtotal),
      tax: sumOf(orders, (o) => o.tax),
      service: sumOf(orders, (o) => o.service),
      total,
      paid,
      pending,
      remaining: money(Math.max(0, total - paid - pending)),
      payments: payments.map(publicPayment),
      settledAt: table.settledAt || null,
      upi: d.restaurant.upiId ? { id: d.restaurant.upiId, name: d.restaurant.name } : null,
    };
  }

  function createPayment(d, table, body, ip) {
    const bill = computeBill(d, table);
    if (bill.total <= 0) throw bad('There is nothing to pay yet — order something first.');
    if (bill.remaining < 0.5) throw bad('This bill is already covered. Our team is confirming the payments.');
    const method = PAY_METHODS.includes(body.method) ? body.method : null;
    if (!method) throw bad('Choose how you would like to pay.');
    const mode = SPLIT_MODES.includes(body.mode) ? body.mode : 'full';
    let amount = 0; let parts = 1; let shares = 1; let lines = [];
    if (mode === 'full') {
      amount = bill.remaining;
    } else if (mode === 'equal') {
      parts = int(body.parts, 2, 30, 2);
      shares = int(body.shares, 1, parts, 1);
      amount = money((bill.total * shares) / parts);
    } else {
      const keys = new Set((Array.isArray(body.lines) ? body.lines : []).slice(0, 300).map((k) => str(k, 80)));
      const chosen = bill.lines.filter((l) => keys.has(l.key));
      if (!chosen.length) throw bad('Pick the dishes you are paying for.');
      if (chosen.some((l) => l.claimedBy)) throw bad('Someone has already paid for one of those dishes. Refresh and try again.');
      lines = chosen.map((l) => l.key);
      // your dishes + their proportional share of GST and service
      amount = bill.subtotal > 0 ? money((bill.total * sumOf(chosen, (l) => l.amount)) / bill.subtotal) : 0;
    }
    amount = money(Math.min(amount, bill.remaining));
    if (amount <= 0) throw bad('Nothing left to pay for that selection.');
    const now = new Date().toISOString();
    const payment = {
      id: crypto.randomUUID(),
      table: table.id,
      tableLabel: table.label,
      mode, parts, shares, lines, amount, method,
      name: str(body.name, 40) || 'Guest',
      ref: str(body.ref, 40),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ip,
    };
    d.payments.push(payment);
    if (d.payments.length > 3000) d.payments.splice(0, d.payments.length - 3000);
    return payment;
  }

  // Close the table's bill: every open order is marked paid and settled, payments archived.
  function settleTable(d, table) {
    const now = new Date().toISOString();
    const orders = openOrders(d, table.id);
    for (const o of orders) { o.paid = true; o.settled = true; o.settledAt = now; o.updatedAt = now; }
    for (const p of openPayments(d, table.id)) { p.settled = true; p.updatedAt = now; }
    table.settledAt = now;
    return orders;
  }
  function settleIfCovered(d, table) {
    const bill = computeBill(d, table);
    return bill.total > 0 && bill.paid >= bill.total - 0.5 ? settleTable(d, table) : null;
  }
  const findTable = (d, id) => {
    const t = d.tables.find((x) => x.id === str(id, 20));
    if (!t) throw new HttpError(404, 'Unknown table');
    return t;
  };

  tenantApi.get('/tables/:id/bill', h(async (req, res) => {
    const d = await db(req);
    res.json(computeBill(d, findTable(d, req.params.id)));
  }));

  tenantApi.post('/tables/:id/payments', h(async (req, res) => {
    rateLimit(`pay:${req.ip}`, 10, MINUTE);
    const { payment, bill } = await mutate(req, (d) => {
      const table = findTable(d, req.params.id);
      const payment = createPayment(d, table, req.body || {}, req.ip);
      return { payment, bill: computeBill(d, table) };
    });
    broadcast(req.tenant.id, 'payment:new', publicPayment(payment));
    res.status(201).json({ payment: publicPayment(payment), bill });
  }));

  // QR codes (SVG by default, ?format=png for a download-ready image).
  //   /qr            → the restaurant's menu (for its home page, posters, the entrance)
  //   /qr/:tableId   → that table's menu (orders are tagged with the table)
  async function sendQr(req, res, url, name) {
    const opts = {
      errorCorrectionLevel: 'H', // high: survives the logo badge we overlay on print cards
      margin: int(req.query.margin, 0, 8, 1),
      color: { dark: hexColor(req.query.dark, '#111111'), light: hexColor(req.query.light, '#ffffff') },
    };
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (req.query.format === 'png' || /\.png$/i.test(req.path)) {
      const buf = await QRCode.toBuffer(url, { ...opts, width: int(req.query.size, 128, 2048, 1024) });
      res.type('png');
      if (req.query.download) res.attachment(`qr-${req.tenant.slug}${name ? `-${name}` : ''}.png`);
      return res.send(buf);
    }
    res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  }

  tenantApi.get(['/qr', '/qr.png', '/qr.svg'], h(async (req, res) => {
    const d = await db(req);
    await sendQr(req, res, `${baseUrl(req, d)}/r/${req.tenant.slug}/menu?src=qr`, '');
  }));

  tenantApi.get('/qr/:tableId', h(async (req, res) => {
    const id = req.params.tableId.replace(/\.(svg|png)$/i, '');
    const d = await db(req);
    const table = d.tables.find((t) => t.id === id);
    if (!table) throw new HttpError(404, 'Unknown table');
    await sendQr(req, res, tableUrl(req, d, req.tenant, table.id), table.id);
  }));

  // ======================= STAFF CONSOLE ROUTES =======================
  const sendHello = (res) => send(res, 'hello', { at: Date.now() });

  admin.get('/verify', (req, res) => res.json({ ok: true, role: req.auth.role }));

  admin.get('/stream', (req, res, next) => {
    if (realtime !== 'sse') return next(new HttpError(404, 'Live stream not available here; poll /changes'));
    openStream(req, res, req.tenant.id, 'admin');
    sendHello(res);
  });

  // Polling feed for serverless hosts: orders touched since `since`, plus all open calls.
  admin.get('/changes', h(async (req, res) => {
    const d = await db(req);
    const since = new Date(String(req.query.since || ''));
    const cutoff = Number.isNaN(since.getTime()) ? 0 : since.getTime() - 5000; // overlap for clock skew
    res.json({
      now: new Date().toISOString(),
      orders: d.orders.filter((o) => new Date(o.updatedAt).getTime() >= cutoff).map(publicOrder),
      calls: d.calls.filter((c) => !c.resolved),
      payments: d.payments.filter((p) => new Date(p.updatedAt).getTime() >= cutoff).map(publicPayment),
    });
  }));

  admin.get('/state', h(async (req, res) => {
    const d = await db(req);
    res.json({
      now: new Date().toISOString(),
      realtime,
      me: { email: req.auth.email, name: req.auth.name, role: req.auth.role },
      tenant: { slug: req.tenant.slug, name: req.tenant.name, demo: Boolean(req.tenant.demo) },
      restaurant: d.restaurant,
      categories: d.categories,
      items: d.items,
      tables: d.tables.map((t) => ({ ...t, url: tableUrl(req, d, req.tenant, t.id) })),
      homeUrl: `${baseUrl(req, d)}/r/${req.tenant.slug}`,
      orders: d.orders.slice(-300).map(publicOrder),
      calls: d.calls.filter((c) => !c.resolved),
      // open payments plus the last day's settled ones (for the Bills history)
      payments: d.payments.filter((p) => !p.settled || Date.now() - new Date(p.updatedAt).getTime() < 86_400_000).slice(-400).map(publicPayment),
      baseUrl: baseUrl(req, d),
    });
  }));

  admin.get('/stats', h(async (req, res) => {
    const d = await db(req);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = d.orders.filter((o) => new Date(o.createdAt) >= start && o.status !== 'cancelled');
    const revenue = money(today.reduce((s, o) => s + o.total, 0));
    const counts = {};
    for (const o of today) for (const l of o.items) counts[l.name] = (counts[l.name] || 0) + l.qty;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
    const hours = Array(24).fill(0);
    for (const o of today) hours[new Date(o.createdAt).getHours()] += o.total;
    res.json({
      orders: today.length,
      revenue,
      avgTicket: today.length ? money(revenue / today.length) : 0,
      active: d.orders.filter((o) => !['served', 'cancelled'].includes(o.status)).length,
      top,
      hours: hours.map(money),
    });
  }));

  admin.patch('/orders/:id', h(async (req, res) => {
    const o = await mutate(req, (d) => {
      const o = d.orders.find((x) => x.id === req.params.id);
      if (!o) throw new HttpError(404, 'Order not found');
      const { status, paid } = req.body || {};
      if (status !== undefined) {
        if (!ORDER_STATUSES.includes(status)) throw bad('Invalid status');
        if (o.status !== status) {
          o.status = status;
          o.history.push({ status, at: new Date().toISOString() });
        }
      }
      if (paid !== undefined) o.paid = Boolean(paid);
      o.updatedAt = new Date().toISOString();
      return o;
    });
    broadcast(req.tenant.id, 'order:update', publicOrder(o), o.id);
    res.json(publicOrder(o));
  }));

  admin.patch('/calls/:id', h(async (req, res) => {
    const c = await mutate(req, (d) => {
      const c = d.calls.find((x) => x.id === req.params.id);
      if (!c) throw new HttpError(404, 'Call not found');
      c.resolved = true;
      c.resolvedAt = new Date().toISOString();
      return c;
    });
    broadcast(req.tenant.id, 'call:resolved', c);
    res.json(c);
  }));

  admin.patch('/payments/:id', h(async (req, res) => {
    const out = await mutate(req, (d) => {
      const p = d.payments.find((x) => x.id === req.params.id);
      if (!p) throw new HttpError(404, 'Payment not found');
      if (p.settled) throw bad('That bill is already closed.');
      const status = str(req.body && req.body.status, 20);
      if (!PAY_STATUSES.includes(status)) throw bad('Status must be confirmed or rejected');
      p.status = status;
      p.updatedAt = new Date().toISOString();
      const table = d.tables.find((t) => t.id === p.table);
      const settled = table && status === 'confirmed' ? settleIfCovered(d, table) : null;
      return { p, settled, tableId: p.table };
    });
    broadcast(req.tenant.id, 'payment:update', publicPayment(out.p));
    if (out.settled) {
      for (const o of out.settled) broadcast(req.tenant.id, 'order:update', publicOrder(o), o.id);
      broadcast(req.tenant.id, 'bill:settled', { table: out.tableId });
    }
    res.json({ payment: publicPayment(out.p), settled: Boolean(out.settled) });
  }));

  admin.post('/tables/:id/settle', h(async (req, res) => {
    const out = await mutate(req, (d) => {
      const table = findTable(d, req.params.id);
      const orders = settleTable(d, table);
      return { tableId: table.id, orders, payments: d.payments.filter((p) => p.table === table.id && p.updatedAt === table.settledAt) };
    });
    for (const o of out.orders) broadcast(req.tenant.id, 'order:update', publicOrder(o), o.id);
    for (const p of out.payments) broadcast(req.tenant.id, 'payment:update', publicPayment(p));
    broadcast(req.tenant.id, 'bill:settled', { table: out.tableId });
    res.json({ ok: true, orders: out.orders.length });
  }));

  const menuChanged = (req) => broadcast(req.tenant.id, 'menu:update', { at: Date.now() });

  // Sold-out switch: the one menu change floor staff may make.
  admin.patch('/items/:id/availability', h(async (req, res) => {
    const item = await mutate(req, (d) => {
      const item = d.items.find((i) => i.id === req.params.id);
      if (!item) throw new HttpError(404, 'Dish not found');
      item.available = Boolean(req.body && req.body.available);
      return item;
    });
    menuChanged(req);
    res.json(item);
  }));

  function cleanItem(d, body, existing = {}) {
    const merged = { ...existing, ...body };
    const name = str(merged.name, 60);
    if (!name) throw bad('Dish name is required');
    const category = str(merged.category, 40);
    if (!d.categories.some((c) => c.id === category)) throw bad('Choose a valid category');
    const price = Number(merged.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw bad('Price must be a positive number');
    return {
      id: existing.id,
      category,
      name,
      price: money(price),
      veg: Boolean(merged.veg),
      spice: int(merged.spice, 0, 3, 0),
      emoji: str(merged.emoji, 8) || '🍽️',
      hue: int(merged.hue, 0, 360, 30),
      popular: Boolean(merged.popular),
      available: merged.available !== false,
      prep: int(merged.prep, 0, 180, 10),
      kcal: int(merged.kcal, 0, 5000, 0),
      desc: str(merged.desc, 300),
      image: safeUrl(merged.image),
      tags: (Array.isArray(merged.tags) ? merged.tags : String(merged.tags || '').split(','))
        .map((t) => str(t, 24)).filter(Boolean).slice(0, 6),
    };
  }

  admin.post('/items', ownerOnly, h(async (req, res) => {
    const item = await mutate(req, (d) => {
      if (d.items.length >= 500) throw bad('Menu is full (500 dishes).');
      const item = cleanItem(d, req.body || {});
      item.id = `i${crypto.randomBytes(4).toString('hex')}`;
      d.items.push(item);
      return item;
    });
    menuChanged(req);
    res.status(201).json(item);
  }));

  admin.put('/items/:id', ownerOnly, h(async (req, res) => {
    const item = await mutate(req, (d) => {
      const idx = d.items.findIndex((i) => i.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Dish not found');
      d.items[idx] = cleanItem(d, req.body || {}, d.items[idx]);
      return d.items[idx];
    });
    menuChanged(req);
    res.json(item);
  }));

  admin.delete('/items/:id', ownerOnly, h(async (req, res) => {
    await mutate(req, (d) => {
      const idx = d.items.findIndex((i) => i.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Dish not found');
      d.items.splice(idx, 1);
    });
    menuChanged(req);
    res.status(204).end();
  }));

  admin.post('/categories', ownerOnly, h(async (req, res) => {
    const cat = await mutate(req, (d) => {
      const name = str(req.body && req.body.name, 40);
      if (!name) throw bad('Category name is required');
      if (d.categories.length >= 40) throw bad('Too many categories (40).');
      let id = slug(name) || `c${Date.now()}`;
      while (d.categories.some((c) => c.id === id)) id += '-2';
      const cat = { id, name, icon: str(req.body.icon, 8) || '🍽️' };
      d.categories.push(cat);
      return cat;
    });
    menuChanged(req);
    res.status(201).json(cat);
  }));

  admin.delete('/categories/:id', ownerOnly, h(async (req, res) => {
    await mutate(req, (d) => {
      if (d.items.some((i) => i.category === req.params.id)) throw bad('Move or delete the dishes in this category first');
      const idx = d.categories.findIndex((c) => c.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Category not found');
      d.categories.splice(idx, 1);
    });
    menuChanged(req);
    res.status(204).end();
  }));

  admin.post('/tables', ownerOnly, h(async (req, res) => {
    const out = await mutate(req, (d) => {
      const label = str(req.body && req.body.label, 30);
      if (!label) throw bad('Table name is required');
      if (d.tables.length >= 300) throw bad('Too many tables (300).');
      let id = str(req.body.id, 12).toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (!id) {
        let n = d.tables.length + 1;
        while (d.tables.some((t) => t.id === `T${n}`)) n++;
        id = `T${n}`;
      }
      if (d.tables.some((t) => t.id === id)) throw bad('A table with that code already exists');
      const table = { id, label, seats: int(req.body.seats, 1, 30, 4) };
      d.tables.push(table);
      return { ...table, url: tableUrl(req, d, req.tenant, table.id) };
    });
    res.status(201).json(out);
  }));

  admin.delete('/tables/:id', ownerOnly, h(async (req, res) => {
    await mutate(req, (d) => {
      const idx = d.tables.findIndex((t) => t.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Table not found');
      d.tables.splice(idx, 1);
    });
    res.status(204).end();
  }));

  admin.put('/restaurant', ownerOnly, h(async (req, res) => {
    const r = await mutate(req, (d) => {
      const r = d.restaurant;
      const b = req.body || {};
      if (b.name !== undefined) { const n = str(b.name, 60); if (!n) throw bad('Name is required'); r.name = n; }
      if (b.tagline !== undefined) r.tagline = str(b.tagline, 120);
      if (b.currency !== undefined) r.currency = str(b.currency, 4) || '₹';
      if (b.taxRate !== undefined) r.taxRate = Math.min(50, Math.max(0, Number(b.taxRate) || 0));
      if (b.serviceCharge !== undefined) r.serviceCharge = Math.min(50, Math.max(0, Number(b.serviceCharge) || 0));
      if (b.accent !== undefined) r.accent = hexColor(b.accent, r.accent);
      if (b.publicUrl !== undefined) r.publicUrl = safeUrl(b.publicUrl).replace(/\/+$/, '');
      if (b.wifi !== undefined) r.wifi = str(b.wifi, 80);
      if (b.hours !== undefined) r.hours = str(b.hours, 60);
      if (b.upiId !== undefined) {
        const v = str(b.upiId, 100);
        if (v && !UPI_ID.test(v)) throw bad('That does not look like a UPI ID (name@bank).');
        r.upiId = v;
      }
      return r;
    });
    if (r.name !== req.tenant.name) {
      await kv.mutate('platform', (p) => { const t = p.tenants.find((x) => x.id === req.tenant.id); if (t) t.name = r.name; });
    }
    menuChanged(req);
    res.json(r);
  }));

  // Only the demo restaurant can be reset to the sample menu.
  admin.post('/reset', ownerOnly, h(async (req, res) => {
    if (!req.tenant.demo) throw new HttpError(403, 'Only the demo restaurant can be reset.');
    await mutate(req, (d) => {
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, clone(seed));
    });
    menuChanged(req);
    res.json({ ok: true });
  }));

  // ---------- team (owner) ----------
  admin.get('/team', ownerOnly, h(async (req, res) => {
    const p = await platformDoc();
    res.json(p.users.filter((u) => u.tenantId === req.tenant.id).map((u) => publicUser(u, req.auth.user.id)));
  }));

  admin.post('/team', ownerOnly, h(async (req, res) => {
    const b = req.body || {};
    const email = sec.normEmail(b.email);
    if (!sec.validEmail(email) || (platformAdmin && email === platformAdmin.email)) throw bad('Enter a valid email address.');
    const role = b.role === 'owner' ? 'owner' : 'staff';
    const name = str(b.name, 60) || email.split('@')[0];
    const temp = sec.randomPassword();
    const hash = await sec.hashPassword(temp);
    const user = await kv.mutate('platform', (p) => {
      if (p.users.some((u) => u.email === email)) throw bad('That email already has an account. Use a different one.');
      if (p.users.filter((u) => u.tenantId === req.tenant.id).length >= 50) throw bad('Team limit reached (50 accounts).');
      const u = { id: T.newId('us'), email, name, role, tenantId: req.tenant.id, hash, tokenVersion: 1, mustChangePassword: true, createdAt: new Date().toISOString() };
      p.users.push(u);
      return u;
    });
    res.status(201).json({ user: publicUser(user, req.auth.user.id), tempPassword: temp });
  }));

  const teamMember = (p, req) => {
    const u = p.users.find((x) => x.id === req.params.id && x.tenantId === req.tenant.id);
    if (!u) throw new HttpError(404, 'Team member not found');
    if (u.id === req.auth.user.id) throw bad('You cannot change your own account here.');
    return u;
  };
  const otherOwners = (p, req, u) => p.users.some((x) => x.tenantId === req.tenant.id && x.role === 'owner' && x.id !== u.id);

  admin.patch('/team/:id', ownerOnly, h(async (req, res) => {
    const role = req.body && req.body.role;
    if (!['owner', 'staff'].includes(role)) throw bad('Role must be owner or staff.');
    const u = await kv.mutate('platform', (p) => {
      const u = teamMember(p, req);
      if (u.role === 'owner' && role !== 'owner' && !otherOwners(p, req, u)) throw bad('A restaurant needs at least one owner.');
      u.role = role;
      return u;
    });
    closeAdminStreams(req.tenant.id);
    res.json(publicUser(u, req.auth.user.id));
  }));

  admin.post('/team/:id/reset-password', ownerOnly, h(async (req, res) => {
    const temp = sec.randomPassword();
    const hash = await sec.hashPassword(temp);
    const u = await kv.mutate('platform', (p) => {
      const u = teamMember(p, req);
      u.hash = hash;
      u.tokenVersion += 1;
      u.mustChangePassword = true;
      return u;
    });
    closeAdminStreams(req.tenant.id);
    res.json({ user: publicUser(u, req.auth.user.id), tempPassword: temp });
  }));

  admin.delete('/team/:id', ownerOnly, h(async (req, res) => {
    await kv.mutate('platform', (p) => {
      const u = teamMember(p, req);
      if (u.role === 'owner' && !otherOwners(p, req, u)) throw bad('A restaurant needs at least one owner.');
      p.users.splice(p.users.indexOf(u), 1);
    });
    closeAdminStreams(req.tenant.id);
    res.status(204).end();
  }));

  app.use('/api/r/:slug', tenantApi);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

  // ======================= PAGES =======================
  const pub = path.join(root, 'public');
  const page = (file) => path.join(pub, file);
  const goDefault = (build) => h(async (req, res) => {
    await ready();
    const t = await defaultTenant();
    if (!t) return res.redirect(302, '/login');
    res.redirect(302, build(t.slug, req));
  });

  // Restaurant pages: /r/<slug> (home), /r/<slug>/menu, /r/<slug>/admin, /r/<slug>/print
  const tenantPage = (file, redirectTo) => h(async (req, res, next) => {
    if (!sec.validSlug(req.params.slug)) return next();
    await ready();
    const p = await platformDoc();
    if (!p.tenants.some((t) => t.slug === req.params.slug)) return next();
    const to = redirectTo && redirectTo(req);
    if (to) return res.redirect(302, to);
    res.sendFile(page(file));
  });
  app.get('/r/:slug', tenantPage('home.html'));          // the restaurant's own home page
  app.get('/r/:slug/home', (req, res) => res.redirect(301, `/r/${req.params.slug}`));
  // The home page is the front door. The menu opens directly only from a QR scan or a
  // link that says where it came from: a table (?t=), a menu section (?ch=) or ?src=.
  // A bare /r/<slug>/menu link goes to the restaurant's home page first.
  app.get('/r/:slug/menu', tenantPage('menu.html', (req) => {
    const q = req.query;
    return q.t === undefined && q.ch === undefined && q.src === undefined ? `/r/${req.params.slug}` : null;
  }));
  app.get('/r/:slug/admin', tenantPage('admin.html'));
  app.get('/r/:slug/print', tenantPage('print.html'));

  // Old single-restaurant links (printed QR codes say /menu?t=T3) keep working.
  app.get(['/menu', '/menu.html'], goDefault((s, req) => `/r/${s}/menu${queryOf(req)}`));
  app.get('/m/:table', goDefault((s, req) => `/r/${s}/menu?t=${encodeURIComponent(req.params.table)}`));
  app.get(['/print', '/print.html'], goDefault((s, req) => `/r/${s}/print${queryOf(req)}`));
  app.get(['/admin', '/admin.html'], (req, res) => res.redirect(302, '/login'));

  app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three'), { maxAge: '7d' }));
  app.use(express.static(pub, { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(page('404.html')));

  // ---------- error handler ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    const body = { error: status >= 500 ? 'Something went wrong on our side.' : err.message };
    if (err.code && status < 500 && typeof err.code === 'string' && /^[a-z_]+$/.test(err.code)) body.code = err.code;
    res.status(status).json(body);
  });

  app.locals.kv = kv;
  app.locals.ready = ready;
  app.locals.closeStreams = () => { for (const s of streams) s.res.end(); streams.clear(); };
  return app;
}

module.exports = { createApp, ORDER_FLOW, ORDER_STATUSES };

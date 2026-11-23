'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { createStore } = require('./db');
const seed = require('../data/seed');

const SEED_PHOTOS = Object.fromEntries(seed.items.filter((i) => i.image).map((i) => [i.id, i.image]));
const ORDER_FLOW = ['placed', 'accepted', 'preparing', 'ready', 'served'];
const ORDER_STATUSES = [...ORDER_FLOW, 'cancelled'];
const CALL_REASONS = ['waiter', 'water', 'bill', 'cutlery'];
const PAY_METHODS = ['upi', 'card', 'cash'];
const SPLIT_MODES = ['full', 'equal', 'items'];
const PAY_STATUSES = ['confirmed', 'rejected'];
const UPI_ID = /^[\w.-]{2,64}@[A-Za-z][\w]{1,63}$/;

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function createApp(options = {}) {
  const adminPin = String(options.adminPin || process.env.ADMIN_PIN || '1234');
  const databaseUrl = options.databaseUrl !== undefined ? options.databaseUrl
    : (process.env.DATABASE_URL || process.env.POSTGRES_URL || '');
  const store = createStore({
    file: options.dbFile === undefined ? path.join(__dirname, '..', 'data', 'db.json') : options.dbFile,
    seed,
    databaseUrl,
  });
  // Serverless hosts (Vercel) can't hold SSE connections or share memory between
  // instances, so clients poll instead. Locally we keep instant SSE push.
  const realtime = options.realtime || (process.env.VERCEL ? 'poll' : 'sse');
  const db = () => store.read();
  const mutate = (fn) => store.mutate(fn);
  // Express 4 doesn't catch rejected promises: route them to the error handler.
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '100kb' }));

  // Basic security headers (no external origins needed: everything is self-hosted).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // ---------- realtime (Server-Sent Events) ----------
  const streams = new Set(); // { res, scope: 'admin' | orderId }
  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function broadcast(event, data, orderId) {
    for (const s of streams) {
      if (s.scope === 'admin' || (orderId && s.scope === orderId)) send(s.res, event, data);
    }
  }
  function openStream(req, res, scope) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const entry = { res, scope };
    streams.add(entry);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); streams.delete(entry); });
    return entry;
  }

  // ---------- tiny rate limiter ----------
  const hits = new Map();
  const limitsOn = options.rateLimit !== false; // tests may switch limits off
  function rateLimit(key, max, windowMs) {
    if (!limitsOn) return;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) throw new HttpError(429, 'Too many requests, please wait a moment.');
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
  }

  const requireAdmin = (req, res, next) => {
    const pin = req.get('x-admin-pin') || req.query.pin || '';
    if (!safeEqual(pin, adminPin)) return next(new HttpError(401, 'Invalid admin PIN'));
    next();
  };

  const baseUrl = (req, d) => (d.restaurant.publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const tableUrl = (req, d, tableId) => `${baseUrl(req, d)}/menu?t=${encodeURIComponent(tableId)}`;
  const publicOrder = (o) => {
    const { ip, ...rest } = o; // never leak customer IPs
    return rest;
  };

  // ======================= PUBLIC API =======================
  app.get('/api/health', h(async (req, res) => {
    await db();
    res.json({ ok: true, uptime: process.uptime(), storage: databaseUrl ? 'postgres' : 'file', realtime });
  }));

  app.get('/api/menu', h(async (req, res) => {
    const d = await db();
    const { publicUrl, ...restaurant } = d.restaurant;
    // Dishes from the original seed get their bundled photo even in databases created
    // before photos existed (no migration needed); an explicit image always wins.
    const items = d.items.map((i) => (i.image || !SEED_PHOTOS[i.id] ? i : { ...i, image: SEED_PHOTOS[i.id] }));
    res.json({ restaurant, categories: d.categories, items, realtime });
  }));

  app.get('/api/tables', h(async (req, res) => res.json((await db()).tables.map(({ id, label }) => ({ id, label })))));

  app.get('/api/tables/:id', h(async (req, res) => {
    const t = (await db()).tables.find((x) => x.id === req.params.id);
    if (!t) throw new HttpError(404, 'Unknown table');
    res.json(t);
  }));

  app.post('/api/orders', h(async (req, res) => {
    rateLimit(`order:${req.ip}`, 8, 60_000);
    const order = await mutate((d) => createOrder(d, req));
    broadcast('order:new', publicOrder(order));
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ status: 'placed', at: new Date().toISOString() }],
      ip: req.ip,
    };
    d.orders.push(order);
    if (d.orders.length > 2000) d.orders.splice(0, d.orders.length - 2000);
    return order;
  }

  app.get('/api/orders/:id', h(async (req, res) => {
    const o = (await db()).orders.find((x) => x.id === req.params.id);
    if (!o) throw new HttpError(404, 'Order not found');
    res.json(publicOrder(o));
  }));

  app.get('/api/orders/:id/events', h(async (req, res) => {
    if (realtime !== 'sse') throw new HttpError(404, 'Live stream not available here; poll /api/orders/:id');
    const o = (await db()).orders.find((x) => x.id === req.params.id);
    if (!o) throw new HttpError(404, 'Order not found');
    openStream(req, res, o.id);
    send(res, 'order:update', publicOrder(o));
  }));

  app.post('/api/calls', h(async (req, res) => {
    rateLimit(`call:${req.ip}`, 6, 60_000);
    const result = await mutate((d) => {
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
    broadcast('call:new', result.call);
    res.status(201).json(result.call);
  }));

  // ======================= BILLS & PAYMENTS =======================
  // A table's open bill = its non-cancelled, unsettled orders. Guests pay it in full, split
  // it equally, or pay for their own dishes. The SERVER computes every amount. There is no
  // card gateway, so each payment is "pending" until staff confirm the money arrived; when
  // confirmed payments cover the bill the table settles (orders marked paid, bill closed).
  const openOrders = (d, tableId) => d.orders.filter((o) => o.table === tableId && o.status !== 'cancelled' && !o.settled);
  const openPayments = (d, tableId) => d.payments.filter((p) => p.table === tableId && !p.settled);
  const publicPayment = (p) => { const { ip, ...rest } = p; return rest; };
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

  app.get('/api/tables/:id/bill', h(async (req, res) => {
    const d = await db();
    res.json(computeBill(d, findTable(d, req.params.id)));
  }));

  app.post('/api/tables/:id/payments', h(async (req, res) => {
    rateLimit(`pay:${req.ip}`, 10, 60_000);
    const { payment, bill } = await mutate((d) => {
      const table = findTable(d, req.params.id);
      const payment = createPayment(d, table, req.body || {}, req.ip);
      return { payment, bill: computeBill(d, table) };
    });
    broadcast('payment:new', publicPayment(payment));
    res.status(201).json({ payment: publicPayment(payment), bill });
  }));

  // QR code for a table (SVG by default, ?format=png for a download-ready image)
  app.get('/api/qr/:tableId', async (req, res, next) => {
    try {
      const id = req.params.tableId.replace(/\.(svg|png)$/i, '');
      const d = await db();
      const table = d.tables.find((t) => t.id === id);
      if (!table) throw new HttpError(404, 'Unknown table');
      const opts = {
        errorCorrectionLevel: 'H', // high: survives the logo badge we overlay on print cards
        margin: int(req.query.margin, 0, 8, 1),
        color: { dark: hexColor(req.query.dark, '#111111'), light: hexColor(req.query.light, '#ffffff') },
      };
      const url = tableUrl(req, d, table.id);
      const wantsPng = req.query.format === 'png' || /\.png$/i.test(req.params.tableId);
      if (wantsPng) {
        const buf = await QRCode.toBuffer(url, { ...opts, width: int(req.query.size, 128, 2048, 1024) });
        res.type('png');
        if (req.query.download) res.attachment(`qr-${table.id}.png`);
        return res.send(buf);
      }
      res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
    } catch (e) { next(e); }
  });

  // ======================= ADMIN API =======================
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/verify', (req, res) => res.json({ ok: true }));
  admin.get('/stream', (req, res, next) => {
    if (realtime !== 'sse') return next(new HttpError(404, 'Live stream not available here; poll /api/admin/changes'));
    openStream(req, res, 'admin');
    send(res, 'hello', { at: Date.now() });
  });

  // Polling feed for serverless hosts: orders touched since `since`, plus all open calls.
  admin.get('/changes', h(async (req, res) => {
    const d = await db();
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
    const d = await db();
    res.json({
      now: new Date().toISOString(),
      realtime,
      restaurant: d.restaurant,
      categories: d.categories,
      items: d.items,
      tables: d.tables.map((t) => ({ ...t, url: tableUrl(req, d, t.id) })),
      orders: d.orders.slice(-300).map(publicOrder),
      calls: d.calls.filter((c) => !c.resolved),
      // open payments plus the last day's settled ones (for the Bills history)
      payments: d.payments.filter((p) => !p.settled || Date.now() - new Date(p.updatedAt).getTime() < 86_400_000).slice(-400).map(publicPayment),
      baseUrl: baseUrl(req, d),
    });
  }));

  admin.get('/stats', h(async (req, res) => {
    const d = await db();
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
    const o = await mutate((d) => {
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
    broadcast('order:update', publicOrder(o), o.id);
    res.json(publicOrder(o));
  }));

  admin.patch('/calls/:id', h(async (req, res) => {
    const c = await mutate((d) => {
      const c = d.calls.find((x) => x.id === req.params.id);
      if (!c) throw new HttpError(404, 'Call not found');
      c.resolved = true;
      c.resolvedAt = new Date().toISOString();
      return c;
    });
    broadcast('call:resolved', c);
    res.json(c);
  }));

  admin.patch('/payments/:id', h(async (req, res) => {
    const out = await mutate((d) => {
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
    broadcast('payment:update', publicPayment(out.p));
    if (out.settled) {
      for (const o of out.settled) broadcast('order:update', publicOrder(o), o.id);
      broadcast('bill:settled', { table: out.tableId });
    }
    res.json({ payment: publicPayment(out.p), settled: Boolean(out.settled) });
  }));

  admin.post('/tables/:id/settle', h(async (req, res) => {
    const out = await mutate((d) => {
      const table = findTable(d, req.params.id);
      const orders = settleTable(d, table);
      return { orders, payments: d.payments.filter((p) => p.table === table.id && p.updatedAt === table.settledAt) };
    });
    for (const o of out.orders) broadcast('order:update', publicOrder(o), o.id);
    for (const p of out.payments) broadcast('payment:update', publicPayment(p));
    broadcast('bill:settled', { table: req.params.id });
    res.json({ ok: true, orders: out.orders.length });
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

  const menuChanged = () => broadcast('menu:update', { at: Date.now() });

  admin.post('/items', h(async (req, res) => {
    const item = await mutate((d) => {
      const item = cleanItem(d, req.body || {});
      item.id = `i${crypto.randomBytes(4).toString('hex')}`;
      d.items.push(item);
      return item;
    });
    menuChanged();
    res.status(201).json(item);
  }));

  admin.put('/items/:id', h(async (req, res) => {
    const item = await mutate((d) => {
      const idx = d.items.findIndex((i) => i.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Dish not found');
      d.items[idx] = cleanItem(d, req.body || {}, d.items[idx]);
      return d.items[idx];
    });
    menuChanged();
    res.json(item);
  }));

  admin.delete('/items/:id', h(async (req, res) => {
    await mutate((d) => {
      const idx = d.items.findIndex((i) => i.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Dish not found');
      d.items.splice(idx, 1);
    });
    menuChanged();
    res.status(204).end();
  }));

  admin.post('/categories', h(async (req, res) => {
    const cat = await mutate((d) => {
      const name = str(req.body && req.body.name, 40);
      if (!name) throw bad('Category name is required');
      let id = slug(name) || `c${Date.now()}`;
      while (d.categories.some((c) => c.id === id)) id += '-2';
      const cat = { id, name, icon: str(req.body.icon, 8) || '🍽️' };
      d.categories.push(cat);
      return cat;
    });
    menuChanged();
    res.status(201).json(cat);
  }));

  admin.delete('/categories/:id', h(async (req, res) => {
    await mutate((d) => {
      if (d.items.some((i) => i.category === req.params.id)) throw bad('Move or delete the dishes in this category first');
      const idx = d.categories.findIndex((c) => c.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Category not found');
      d.categories.splice(idx, 1);
    });
    menuChanged();
    res.status(204).end();
  }));

  admin.post('/tables', h(async (req, res) => {
    const out = await mutate((d) => {
      const label = str(req.body && req.body.label, 30);
      if (!label) throw bad('Table name is required');
      let id = str(req.body.id, 12).toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (!id) {
        let n = d.tables.length + 1;
        while (d.tables.some((t) => t.id === `T${n}`)) n++;
        id = `T${n}`;
      }
      if (d.tables.some((t) => t.id === id)) throw bad('A table with that code already exists');
      const table = { id, label, seats: int(req.body.seats, 1, 30, 4) };
      d.tables.push(table);
      return { ...table, url: tableUrl(req, d, table.id) };
    });
    res.status(201).json(out);
  }));

  admin.delete('/tables/:id', h(async (req, res) => {
    await mutate((d) => {
      const idx = d.tables.findIndex((t) => t.id === req.params.id);
      if (idx < 0) throw new HttpError(404, 'Table not found');
      d.tables.splice(idx, 1);
    });
    res.status(204).end();
  }));

  admin.put('/restaurant', h(async (req, res) => {
    const r = await mutate((d) => {
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
    menuChanged();
    res.json(r);
  }));

  admin.post('/reset', h(async (req, res) => {
    await store.reset(); menuChanged();
    res.json({ ok: true });
  }));

  app.use('/api/admin', admin);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

  // ======================= STATIC FRONTEND =======================
  const pub = path.join(__dirname, '..', 'public');
  app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three'), { maxAge: '7d' }));
  app.use(express.static(pub, { extensions: ['html'] }));
  app.get(['/menu', '/m/:table'], (req, res) => {
    if (req.params.table) return res.redirect(302, `/menu?t=${encodeURIComponent(req.params.table)}`);
    res.sendFile(path.join(pub, 'menu.html'));
  });
  app.use((req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

  // ---------- error handler ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side.' : err.message });
  });

  app.locals.store = store;
  app.locals.closeStreams = () => { for (const s of streams) s.res.end(); streams.clear(); };
  return app;
}

module.exports = { createApp, ORDER_FLOW, ORDER_STATUSES };

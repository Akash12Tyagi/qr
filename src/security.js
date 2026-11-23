'use strict';
// Passwords, signed session cookies, rate limits and input rules. Server-side only.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------- passwords
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const got = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// A real hash of a random string: verifying against it costs the same as a real account,
// so "no such user" and "wrong password" take the same time.
let dummyHash = null;
async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function randomPassword(len = 14) {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const PASSWORD_MIN = 10;
function checkPasswordStrength(pw) {
  const s = String(pw || '');
  if (s.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (s.length > 200) return 'That password is too long.';
  return null;
}

// ---------------------------------------------------------------- sessions (signed cookie)
const COOKIE = 'qm_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signSession(secret, payload) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + SESSION_TTL_MS }));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function readSession(secret, token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(body).digest('base64url'));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie value: skip */ }
    }
  }
  return out;
}

function sessionCookie(value, { secure, maxAgeMs = SESSION_TTL_MS }) {
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}
const clearCookie = ({ secure }) => sessionCookie('', { secure, maxAgeMs: 0 });

// Session secret: explicit SESSION_SECRET, else derived from DATABASE_URL (itself a
// server-only secret), else — in development only — a random per-process key.
function resolveSecret({ sessionSecret, databaseUrl, production }) {
  if (sessionSecret) {
    if (String(sessionSecret).length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
    return String(sessionSecret);
  }
  if (databaseUrl) return crypto.createHash('sha256').update(`qm-session|${databaseUrl}`).digest('hex');
  if (production) throw new Error('SESSION_SECRET is required in production.');
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------- rate limiting (per instance)
class RateLimiter {
  constructor() { this.hits = new Map(); }
  check(key, max, windowMs) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 20000) this.hits.clear();
    return true;
  }
  reset(key) { this.hits.delete(key); }
}

// ---------------------------------------------------------------- input rules
const RESERVED_SLUGS = new Set(['api', 'admin', 'platform', 'login', 'logout', 'r', 'm', 'menu', 'print', 'static', 'assets', 'img', 'css', 'js', 'fonts', 'vendor', 'brand', 'credits', 'www', 'app', 'help', 'support', 'status', 'docs']);
function validSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug) && !slug.includes('--');
}
function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 32).replace(/-+$/, '');
}
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => EMAIL.test(normEmail(e)) && normEmail(e).length <= 120;

// Only allow same-site relative redirects ("/r/x/admin"), never "//evil" or "https://evil".
const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])[\w\-./?=&%]*$/.test(next) ? next : '');

module.exports = {
  hashPassword, verifyPassword, dummyVerify, randomPassword, checkPasswordStrength,
  COOKIE, SESSION_TTL_MS, signSession, readSession, parseCookies, sessionCookie, clearCookie, resolveSecret,
  RateLimiter, validSlug, slugify, validEmail, normEmail, safeNext, RESERVED_SLUGS,
};

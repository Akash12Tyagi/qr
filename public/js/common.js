// Shared browser helpers (ES module)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any untrusted string before putting it into innerHTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtMoney(n, currency = '₹') {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${currency}${s}`;
}

export function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export async function api(path, { method = 'GET', body, pin, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (pin) headers['x-admin-pin'] = pin;
  let res;
  try {
    res = await fetch(path, { method, headers, signal, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Network error — check your connection.');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastHost;
export function toast(msg, { error = false, icon, ms = 2600 } = {}) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.innerHTML = `<span>${esc(icon || (error ? '⚠️' : '✨'))}</span><span>${esc(msg)}</span>`;
  toastHost.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

/** Returns the HTML for a dish visual: photo if available, otherwise a generated emoji plate. */
export function dishArt(item, cls = '') {
  const img = item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="dish-art ${cls}" style="--h:${Number(item.hue) || 30}"><span class="emo" aria-hidden="true">${esc(item.emoji || '🍽️')}</span>${img}</div>`;
}

export function dietIcon(veg) {
  return `<i class="diet${veg ? '' : ' nv'}" role="img" aria-label="${veg ? 'Vegetarian' : 'Non-vegetarian'}"></i>`;
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

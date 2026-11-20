import { $, $$, esc, api, toast, fmtMoney, timeAgo, storage, dishArt, dietIcon } from './common.js';

let pin = sessionStorage.getItem('qm:pin') || '';
let state = null;               // full admin state from /api/admin/state
let es = null;                  // EventSource
let sound = storage.get('qm:sound', true);
const fresh = new Set();        // order ids to highlight
const cur = () => state?.restaurant?.currency || '₹';
const call = (path, opts = {}) => api(path, { ...opts, pin });

// ============ auth ============
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  pin = $('#pin').value.trim();
  try {
    await call('/api/admin/verify');
    sessionStorage.setItem('qm:pin', pin);
    start();
  } catch (err) {
    const card = $('.login-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    toast(err.status === 401 ? 'Wrong PIN' : err.message, { error: true });
    $('#pin').select();
  }
});
$('#logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('qm:pin');
  if (es) es.close();
  location.reload();
});

if (pin) call('/api/admin/verify').then(start).catch(() => { sessionStorage.removeItem('qm:pin'); pin = ''; showLogin(); });
else showLogin();

function showLogin() { $('#login').classList.remove('hidden'); $('#shell').classList.add('hidden'); setTimeout(() => $('#pin').focus(), 50); }

async function start() {
  $('#login').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  await loadState();
  connect();
  const initial = (location.hash || '#live').slice(1);
  switchTab(['live', 'menu', 'tables', 'insights', 'settings'].includes(initial) ? initial : 'live');
  setInterval(() => { if (currentTab === 'live') renderBoard(); }, 30_000); // refresh "x min ago"
}

async function loadState() {
  try {
    state = await call('/api/admin/state');
    $('#sideName').textContent = state.restaurant.name;
    document.title = `${state.restaurant.name} · Kitchen Console`;
    if (state.restaurant.accent) document.documentElement.style.setProperty('--accent', state.restaurant.accent);
    renderAll();
  } catch (e) {
    if (e.status === 401) { sessionStorage.removeItem('qm:pin'); location.reload(); return; }
    toast(e.message, { error: true });
  }
}

function renderAll() { renderBoard(); renderCalls(); renderMenu(); renderTables(); fillSettings(); }

// ============ realtime ============
function setConn(kind, text) {
  const c = $('#conn');
  c.className = `conn ${kind}`;
  c.querySelector('span').textContent = text;
}
function connect() {
  if (!('EventSource' in window)) { setConn('off', 'Live updates unsupported'); return; }
  if (es) es.close();
  es = new EventSource(`/api/admin/stream?pin=${encodeURIComponent(pin)}`);
  es.addEventListener('open', () => setConn('on', 'Live'));
  es.addEventListener('error', () => setConn('off', 'Reconnecting…'));
  es.addEventListener('hello', () => { setConn('on', 'Live'); });
  es.addEventListener('order:new', (ev) => {
    const o = parse(ev); if (!o) return;
    if (!state.orders.some((x) => x.id === o.id)) state.orders.push(o);
    fresh.add(o.id);
    setTimeout(() => { fresh.delete(o.id); if (currentTab === 'live') renderBoard(); }, 15000);
    renderBoard();
    chime();
    toast(`New order #${o.number} · ${o.tableLabel}`, { icon: '🔔', ms: 4000 });
    if (document.hidden) document.title = `🔔 New order · ${state.restaurant.name}`;
  });
  es.addEventListener('order:update', (ev) => {
    const o = parse(ev); if (!o) return;
    const idx = state.orders.findIndex((x) => x.id === o.id);
    if (idx >= 0) state.orders[idx] = o; else state.orders.push(o);
    renderBoard();
  });
  es.addEventListener('call:new', (ev) => {
    const c = parse(ev); if (!c) return;
    state.calls.push(c);
    renderCalls();
    chime(2);
    toast(`${c.tableLabel} needs ${REASONS[c.reason] || 'help'}`, { icon: '🛎️', ms: 5000 });
  });
  es.addEventListener('call:resolved', (ev) => {
    const c = parse(ev); if (!c) return;
    state.calls = state.calls.filter((x) => x.id !== c.id);
    renderCalls();
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) document.title = `${state.restaurant.name} · Kitchen Console`; });
function parse(ev) { try { return JSON.parse(ev.data); } catch { return null; } }

// Two-tone chime via WebAudio (no audio files needed)
let actx;
function chime(times = 1) {
  if (!sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let r = 0; r < times; r++) {
      [880, 1320].forEach((f, k) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        const t = actx.currentTime + r * 0.45 + k * 0.14;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + 0.4);
      });
    }
  } catch { /* audio blocked */ }
}
function renderSoundBtn() {
  const b = $('#soundBtn');
  b.textContent = sound ? '🔔 Sound on' : '🔕 Sound off';
  b.setAttribute('aria-pressed', String(sound));
}
$('#soundBtn').addEventListener('click', () => { sound = !sound; storage.set('qm:sound', sound); renderSoundBtn(); if (sound) chime(); });
renderSoundBtn();

// ============ tabs ============
let currentTab = 'live';
function switchTab(tab) {
  currentTab = tab;
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  history.replaceState(null, '', `#${tab}`);
  if (tab === 'insights') loadStats();
  if (tab === 'live') renderBoard();
}
$$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ============ live board ============
const NEXT = { placed: ['accepted', 'Accept'], accepted: ['preparing', 'Start cooking'], preparing: ['ready', 'Mark ready'], ready: ['served', 'Served'] };
const STATUS_LABEL = { placed: 'New', accepted: 'Accepted', preparing: 'Cooking', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };
const REASONS = { waiter: 'a waiter', water: 'water', bill: 'the bill', cutlery: 'cutlery' };

function colOf(o) {
  if (o.status === 'placed') return 'placed';
  if (o.status === 'accepted' || o.status === 'preparing') return 'kitchen';
  if (o.status === 'ready') return 'ready';
  return 'done';
}

function orderCard(o) {
  const next = NEXT[o.status];
  return `<article class="ocard${fresh.has(o.id) ? ' fresh' : ''}" data-id="${esc(o.id)}">
    <div class="ocard-head"><strong>#${esc(o.number)}</strong><span class="otable">${esc(o.tableLabel)}</span></div>
    <div class="ometa">${esc(STATUS_LABEL[o.status])} · ${esc(timeAgo(o.createdAt))}${o.name ? ` · ${esc(o.name)}` : ''}</div>
    <ul class="olines">${o.items.map((l) => `<li><span class="q">${esc(l.qty)}×</span>${dietIcon(l.veg)}<span>${esc(l.name)}${l.note ? ` <small>— ${esc(l.note)}</small>` : ''}</span></li>`).join('')}</ul>
    ${o.note ? `<div class="onote">📝 ${esc(o.note)}</div>` : ''}
    <div class="ofoot">
      <span class="total">${fmtMoney(o.total, cur())} ${o.paid ? '<span class="paid">PAID</span>' : ''}</span>
      ${next ? `<button class="btn btn-sm btn-primary" data-act="status" data-to="${next[0]}">${next[1]} →</button>` : ''}
      ${o.status === 'served' && !o.paid ? '<button class="btn btn-sm" data-act="paid">Mark paid</button>' : ''}
      ${!['served', 'cancelled'].includes(o.status) ? '<button class="btn btn-sm btn-ghost btn-icon" data-act="cancel" title="Cancel order" aria-label="Cancel order">✕</button>' : ''}
    </div>
  </article>`;
}

function renderBoard() {
  if (!state) return;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const cols = { placed: [], kitchen: [], ready: [], done: [] };
  for (const o of state.orders) {
    const c = colOf(o);
    if (c === 'done' && new Date(o.updatedAt) < start) continue;
    cols[c].push(o);
  }
  cols.done.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  cols.done = cols.done.slice(0, 20);
  for (const [k, list] of Object.entries(cols)) {
    const col = $(`.col[data-col="${k}"]`);
    col.querySelector('.n').textContent = list.length || '';
    col.querySelector('.cards').innerHTML = list.length ? list.map(orderCard).join('') : `<div class="empty-col">${k === 'placed' ? 'Waiting for the next scan… 📱' : '—'}</div>`;
  }
  const active = cols.placed.length + cols.kitchen.length + cols.ready.length;
  $('#liveCount').textContent = active || '';
}

$('#board').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.ocard').dataset.id;
  const act = btn.dataset.act;
  if (act === 'cancel' && !confirm('Cancel this order?')) return;
  const body = act === 'status' ? { status: btn.dataset.to } : act === 'paid' ? { paid: true } : { status: 'cancelled' };
  btn.disabled = true;
  try {
    const o = await call(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    const idx = state.orders.findIndex((x) => x.id === o.id);
    if (idx >= 0) state.orders[idx] = o;
    fresh.delete(o.id);
    renderBoard();
  } catch (err) { toast(err.message, { error: true }); btn.disabled = false; }
});

function renderCalls() {
  $('#calls').innerHTML = state.calls.map((c) => `
    <div class="call" data-id="${esc(c.id)}">🛎️ <div><strong>${esc(c.tableLabel)}</strong> needs ${esc(REASONS[c.reason] || 'help')}<br><small>${esc(timeAgo(c.createdAt))}</small></div>
    <button class="btn btn-sm" data-resolve>Done</button></div>`).join('');
}
$('#calls').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-resolve]');
  if (!b) return;
  const id = b.closest('.call').dataset.id;
  try {
    await call(`/api/admin/calls/${encodeURIComponent(id)}`, { method: 'PATCH' });
    state.calls = state.calls.filter((c) => c.id !== id);
    renderCalls();
  } catch (err) { toast(err.message, { error: true }); }
});

// ============ menu ============
let menuFilter = '';
$('#menuSearch').addEventListener('input', (e) => { menuFilter = e.target.value.trim().toLowerCase(); renderMenu(); });

function renderMenu() {
  const html = state.categories.map((c) => {
    const items = state.items.filter((i) => i.category === c.id && (!menuFilter || i.name.toLowerCase().includes(menuFilter)));
    if (menuFilter && !items.length) return '';
    return `<section class="mcat">
      <div class="mcat-head"><h2 class="display">${esc(c.icon)} ${esc(c.name)} <small class="muted">(${items.length})</small></h2>
        ${items.length ? '' : `<button class="btn btn-sm btn-ghost" data-delcat="${esc(c.id)}">Delete category</button>`}</div>
      <div class="mrows">${items.map((i) => `
        <div class="mrow${i.available === false ? ' off' : ''}" data-id="${esc(i.id)}">
          ${dishArt(i)}
          <div><div class="mrow-name">${dietIcon(i.veg)} ${esc(i.name)} ${i.popular ? '<span class="chip">★ Popular</span>' : ''} ${i.available === false ? '<span class="chip">Sold out</span>' : ''}</div>
            <div class="mrow-desc">${esc(i.desc)}</div></div>
          <div class="mprice">${fmtMoney(i.price, cur())}</div>
          <div class="mrow-actions">
            <button class="switch" role="switch" aria-checked="${i.available !== false}" aria-label="Available" data-toggle title="In stock"></button>
            <button class="btn btn-sm" data-edit>Edit</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-del aria-label="Delete">🗑</button>
          </div>
        </div>`).join('') || '<p class="muted">No dishes yet.</p>'}</div>
    </section>`;
  }).join('');
  $('#menuList').innerHTML = html || '<p class="muted">Nothing matches.</p>';
}

$('#menuList').addEventListener('click', async (e) => {
  const delCat = e.target.closest('[data-delcat]');
  if (delCat) {
    try { await call(`/api/admin/categories/${encodeURIComponent(delCat.dataset.delcat)}`, { method: 'DELETE' }); state.categories = state.categories.filter((c) => c.id !== delCat.dataset.delcat); renderMenu(); toast('Category deleted'); }
    catch (err) { toast(err.message, { error: true }); }
    return;
  }
  const row = e.target.closest('.mrow');
  if (!row) return;
  const item = state.items.find((i) => i.id === row.dataset.id);
  if (!item) return;
  if (e.target.closest('[data-toggle]')) {
    try {
      const upd = await call(`/api/admin/items/${encodeURIComponent(item.id)}`, { method: 'PUT', body: { ...item, available: item.available === false } });
      Object.assign(item, upd); renderMenu();
      toast(upd.available ? `${upd.name} is back on` : `${upd.name} marked sold out`, { icon: upd.emoji });
    } catch (err) { toast(err.message, { error: true }); }
  } else if (e.target.closest('[data-edit]')) {
    itemDialog(item);
  } else if (e.target.closest('[data-del]')) {
    if (!confirm(`Delete “${item.name}” from the menu?`)) return;
    try { await call(`/api/admin/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); state.items = state.items.filter((i) => i.id !== item.id); renderMenu(); toast('Dish deleted'); }
    catch (err) { toast(err.message, { error: true }); }
  }
});

$('#addItemBtn').addEventListener('click', () => itemDialog(null));
$('#addCatBtn').addEventListener('click', () => {
  openDialog(`<h2 class="display">New category</h2>
    <div class="dlg-row"><label class="field"><span>Name</span><input class="input" name="name" required maxlength="40" placeholder="e.g. Brunch"></label>
    <label class="field"><span>Icon (emoji)</span><input class="input" name="icon" maxlength="8" placeholder="🥞"></label></div>`,
  async (fd) => {
    const cat = await call('/api/admin/categories', { method: 'POST', body: { name: fd.get('name'), icon: fd.get('icon') } });
    state.categories.push(cat); renderMenu(); toast('Category added');
  });
});

function itemDialog(item) {
  const i = item || { name: '', price: '', category: state.categories[0]?.id, veg: true, spice: 0, emoji: '🍽️', hue: 30, popular: false, prep: 10, kcal: 0, desc: '', tags: [], image: '' };
  openDialog(`<h2 class="display">${item ? 'Edit dish' : 'New dish'}</h2>
    <div class="emoji-preview"><span id="dlgArt">${dishArt(i)}</span><p class="muted" style="margin:0">No photo? We plate your emoji on a colour-matched dish — guests see it in 3D.</p></div>
    <label class="field"><span>Name</span><input class="input" name="name" required maxlength="60" value="${esc(i.name)}"></label>
    <div class="dlg-row">
      <label class="field"><span>Price (${esc(cur())})</span><input class="input" name="price" type="number" min="0" step="0.01" required value="${esc(i.price)}"></label>
      <label class="field"><span>Category</span><select class="input" name="category">${state.categories.map((c) => `<option value="${esc(c.id)}"${c.id === i.category ? ' selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Description</span><textarea class="input" name="desc" maxlength="300" rows="2">${esc(i.desc)}</textarea></label>
    <div class="dlg-row">
      <label class="field"><span>Emoji</span><input class="input" name="emoji" maxlength="8" value="${esc(i.emoji)}"></label>
      <label class="field"><span>Plate colour</span><input class="input" name="hue" type="range" min="0" max="360" value="${esc(i.hue)}"></label>
    </div>
    <div class="dlg-row">
      <label class="field"><span>Spice (0–3)</span><input class="input" name="spice" type="number" min="0" max="3" value="${esc(i.spice)}"></label>
      <label class="field"><span>Prep time (min)</span><input class="input" name="prep" type="number" min="0" max="180" value="${esc(i.prep)}"></label>
    </div>
    <div class="dlg-row">
      <label class="field"><span>Calories</span><input class="input" name="kcal" type="number" min="0" max="5000" value="${esc(i.kcal)}"></label>
      <label class="field"><span>Tags (comma separated)</span><input class="input" name="tags" value="${esc((i.tags || []).join(', '))}"></label>
    </div>
    <label class="field"><span>Photo URL (optional)</span><input class="input" name="image" type="url" placeholder="https://…" value="${esc(i.image || '')}"></label>
    <div class="dlg-row">
      <label class="check"><input type="checkbox" name="veg"${i.veg ? ' checked' : ''}> Vegetarian</label>
      <label class="check"><input type="checkbox" name="popular"${i.popular ? ' checked' : ''}> Chef’s pick / bestseller</label>
    </div>`,
  async (fd) => {
    const body = {
      name: fd.get('name'), price: Number(fd.get('price')), category: fd.get('category'), desc: fd.get('desc'),
      emoji: fd.get('emoji'), hue: Number(fd.get('hue')), spice: Number(fd.get('spice')), prep: Number(fd.get('prep')),
      kcal: Number(fd.get('kcal')), tags: fd.get('tags'), image: fd.get('image'), veg: fd.has('veg'), popular: fd.has('popular'),
      available: item ? item.available !== false : true,
    };
    if (item) {
      const upd = await call(`/api/admin/items/${encodeURIComponent(item.id)}`, { method: 'PUT', body });
      Object.assign(item, upd);
      toast('Dish updated', { icon: upd.emoji });
    } else {
      const created = await call('/api/admin/items', { method: 'POST', body });
      state.items.push(created);
      toast('Dish added to the menu', { icon: created.emoji });
    }
    renderMenu();
  },
  (form) => {
    const upd = () => {
      const art = $('#dlgArt', form);
      art.innerHTML = dishArt({ emoji: form.emoji.value || '🍽️', hue: form.hue.value, image: form.image.value });
    };
    form.emoji.addEventListener('input', upd);
    form.hue.addEventListener('input', upd);
    form.image.addEventListener('change', upd);
  });
}

// Generic dialog helper
function openDialog(inner, onSubmit, onMount) {
  const dlg = $('#dlg');
  const form = $('#dlgForm');
  form.innerHTML = `${inner}<p class="dlg-err muted hidden" role="alert" style="color:var(--danger)"></p>
    <div class="dlg-actions"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Save</button></div>`;
  onMount?.(form);
  form.onsubmit = async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return; // let dialog close
    e.preventDefault();
    const err = form.querySelector('.dlg-err');
    const btn = form.querySelector('[value="ok"]');
    btn.disabled = true;
    try {
      await onSubmit(new FormData(form));
      dlg.close();
    } catch (ex) {
      err.textContent = ex.message; err.classList.remove('hidden');
    } finally { btn.disabled = false; }
  };
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  setTimeout(() => form.querySelector('input, select, textarea')?.focus(), 30);
}

// ============ tables ============
function renderTables() {
  const base = state.baseUrl;
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(base);
  $('#baseNote').innerHTML = `QR codes point to <code>${esc(base)}</code>.${local ? ' ⚠️ <strong>localhost</strong> won’t open on guests’ phones — open this console via your network IP or set a Public URL in Settings.' : ''}`;
  const v = Date.now();
  $('#tablesGrid').innerHTML = state.tables.map((t) => `
    <article class="tcard" data-id="${esc(t.id)}">
      <div class="tcard-head"><strong class="display">${esc(t.label)}</strong><span class="chip">${esc(t.id)} · ${esc(t.seats)} seats</span></div>
      <div class="qr-frame"><img src="/api/qr/${encodeURIComponent(t.id)}?v=${v}" alt="QR code for ${esc(t.label)}" loading="lazy"></div>
      <a class="tlink" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.url)}</a>
      <div class="tactions">
        <button class="btn btn-sm" data-copy>Copy link</button>
        <a class="btn btn-sm" href="/api/qr/${encodeURIComponent(t.id)}?format=png&size=1200&download=1" download>PNG</a>
        <a class="btn btn-sm" href="/print?tables=${encodeURIComponent(t.id)}&style=${esc($('#printStyle').value)}" target="_blank" rel="noopener">Print</a>
        <button class="btn btn-sm btn-ghost btn-icon" data-deltable aria-label="Delete table">🗑</button>
      </div>
    </article>`).join('') || '<p class="muted">No tables yet — add one to generate its QR code.</p>';
}
$('#tablesGrid').addEventListener('click', async (e) => {
  const card = e.target.closest('.tcard');
  if (!card) return;
  const t = state.tables.find((x) => x.id === card.dataset.id);
  if (e.target.closest('[data-copy]')) {
    try { await navigator.clipboard.writeText(t.url); toast('Link copied'); } catch { prompt('Copy this link:', t.url); }
  }
  if (e.target.closest('[data-deltable]')) {
    if (!confirm(`Delete ${t.label}? Its printed QR code will stop working.`)) return;
    try { await call(`/api/admin/tables/${encodeURIComponent(t.id)}`, { method: 'DELETE' }); state.tables = state.tables.filter((x) => x.id !== t.id); renderTables(); toast('Table removed'); }
    catch (err) { toast(err.message, { error: true }); }
  }
});
$('#printStyle').addEventListener('change', renderTables);
$('#printAll').addEventListener('click', () => {
  window.open(`/print?tables=${state.tables.map((t) => encodeURIComponent(t.id)).join(',')}&style=${$('#printStyle').value}`, '_blank', 'noopener');
});
$('#addTableBtn').addEventListener('click', () => {
  openDialog(`<h2 class="display">New table</h2>
    <label class="field"><span>Display name</span><input class="input" name="label" required maxlength="30" placeholder="e.g. Terrace 2"></label>
    <div class="dlg-row"><label class="field"><span>Code (optional)</span><input class="input" name="id" maxlength="12" placeholder="auto e.g. T9"></label>
    <label class="field"><span>Seats</span><input class="input" name="seats" type="number" min="1" max="30" value="4"></label></div>`,
  async (fd) => {
    const t = await call('/api/admin/tables', { method: 'POST', body: { label: fd.get('label'), id: fd.get('id'), seats: Number(fd.get('seats')) } });
    state.tables.push(t); renderTables(); toast(`${t.label} ready — print its QR!`, { icon: '🔳' });
  });
});

// ============ insights ============
async function loadStats() {
  try {
    const s = await call('/api/admin/stats');
    $('#kpis').innerHTML = [
      ['Revenue today', fmtMoney(s.revenue, cur())], ['Orders', s.orders], ['Average ticket', fmtMoney(s.avgTicket, cur())], ['Active now', s.active],
    ].map(([k, v]) => `<div class="kpi"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
    $('#topList').innerHTML = s.top.length ? s.top.map((t) => `<li>${esc(t.name)} <span>${esc(t.qty)}</span></li>`).join('') : '<p class="muted">No orders yet today.</p>';
    drawHours(s.hours);
  } catch (e) { toast(e.message, { error: true }); }
}
$('#refreshStats').addEventListener('click', loadStats);

function drawHours(hours) {
  const W = 720, H = 220, pad = 24;
  const max = Math.max(1, ...hours);
  const bw = (W - pad) / 24;
  const bars = hours.map((v, h) => {
    const bh = (v / max) * (H - pad - 10);
    return `<rect class="bar" x="${pad + h * bw + 2}" y="${H - pad - bh}" width="${bw - 4}" height="${Math.max(bh, v ? 2 : 0)}" rx="4"><title>${h}:00 — ${esc(fmtMoney(v, cur()))}</title></rect>`;
  }).join('');
  const labels = [0, 6, 12, 18, 23].map((h) => `<text x="${pad + h * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${h}:00</text>`).join('');
  $('#hourChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue by hour"><line class="grid" x1="${pad}" x2="${W}" y1="${H - pad}" y2="${H - pad}"/>${bars}${labels}</svg>`;
}

// ============ settings ============
function fillSettings() {
  const f = $('#settingsForm');
  const r = state.restaurant;
  for (const k of ['name', 'tagline', 'currency', 'taxRate', 'serviceCharge', 'accent', 'hours', 'wifi', 'publicUrl']) {
    if (f.elements[k]) f.elements[k].value = r[k] ?? '';
  }
}
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await call('/api/admin/restaurant', { method: 'PUT', body: Object.fromEntries(fd.entries()) });
    toast('Settings saved');
    state.restaurant = r;
    await loadState();
  } catch (err) { toast(err.message, { error: true }); }
});
$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset everything (menu, tables, orders) back to the demo data?')) return;
  try { await call('/api/admin/reset', { method: 'POST' }); await loadState(); toast('Demo data restored'); }
  catch (err) { toast(err.message, { error: true }); }
});

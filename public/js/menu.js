import { $, $$, esc, api, toast, fmtMoney, storage, dishArt, dietIcon, prefersReducedMotion } from './common.js';
import { createBook } from './book.js';

// ---------------- state ----------------
const params = new URLSearchParams(location.search);
let tableId = (params.get('t') || '').toUpperCase().slice(0, 20);
let table = null;
let menu = { restaurant: {}, categories: [], items: [] };
const filters = { q: '', veg: false, popular: false, mild: false };
const cartKey = () => `qm:cart:${tableId || 'browse'}`;
let cart = [];            // [{ id, qty, note }]
let myOrders = storage.get('qm:orders', []); // [{ id, number, at }]
const cur = () => menu.restaurant.currency || '₹';
const byId = (id) => menu.items.find((i) => i.id === id);
let book = null;
let view = storage.get('qm:view', 'book') === 'list' ? 'list' : 'book';

// ---------------- boot ----------------
init().catch((e) => {
  console.error(e);
  $('#sections').innerHTML = `<div class="empty"><p class="display" style="font-size:22px">We couldn’t load the menu</p><p>${esc(e.message)}</p><button class="btn btn-sm" onclick="location.reload()">Retry</button></div>`;
});

async function init() {
  const [m, t] = await Promise.all([
    api('/api/menu'),
    tableId ? api(`/api/tables/${encodeURIComponent(tableId)}`).catch(() => null) : Promise.resolve(null),
  ]);
  menu = m;
  table = t;
  if (tableId && !table) {
    toast('That table code was not recognised — you can still browse.', { error: true, ms: 4000 });
    tableId = '';
  }
  cart = storage.get(cartKey(), []).filter((l) => byId(l.id));
  applyBranding();
  renderCats();
  renderPicks();
  renderSections();
  renderCart();
  wireUi();
  refreshOrdersPip();
  setupScrollSpy();
  setupBook();
  // Re-sync menu (e.g. sold-out items) when the guest comes back to the tab.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try { menu = await api('/api/menu'); renderPicks(); renderSections(); renderCart(); book?.update(menu); } catch { /* offline: keep old */ }
  });
}

// ---------------- the menu book ----------------
function setupBook() {
  $('#bkBrand').textContent = menu.restaurant.name;
  book = createBook({
    root: $('#bookRoot'),
    host: $('#bookView'),
    menu,
    table,
    reduced: prefersReducedMotion(),
    cur,
    money: (n) => fmtMoney(n, cur()),
    dietIcon,
    itemControl,
    onAction: (act) => {
      if (act === 'cart') $('#cartbar').click();
      if (act === 'waiter') callStaff('waiter');
    },
    onView: (v) => {
      const pg = v.pageData || {};
      let k = 'You are reading';
      let title = '';
      let sub = '';
      if (v.side === 'cover') { k = 'Welcome to'; title = menu.restaurant.name; sub = 'Swipe or tap → to open'; }
      else if (v.side === 'left' && v.page === 1) { k = 'Inside cover'; title = table ? `For ${table.label}` : 'Ex libris'; }
      else if (pg.kind === 'contents') title = 'Contents';
      else if (pg.kind === 'menu') { k = v.side === 'left' ? (pg.first ? 'Opening chapter' : 'Plate from') : 'You are reading'; title = pg.chapter.name; }
      else if (pg.kind === 'end') { k = v.side === 'left' ? 'A note from' : 'The end'; title = v.side === 'left' ? 'The kitchen' : 'Fin.'; }
      if (!sub) sub = `Page ${v.page} of ${v.total - 1}`;
      $('#bkKicker').textContent = k;
      $('#bkChapter').textContent = title;
      $('#bkFolio').textContent = sub;
      $('#bkPrev').disabled = v.stop <= 0;
      $('#bkNext').disabled = v.stop >= v.maxStop;
      $('#bkNext').classList.toggle('pulse', v.stop === 0);
    },
  });
  book.render();
  $('#bkPrev').addEventListener('click', () => book.prev());
  $('#bkNext').addEventListener('click', () => book.next());
  $('#bkCall').addEventListener('click', (e) => { e.stopPropagation(); toggleFab(); });
  setView(view, true);
  renderCart();
  // Deep link from the gallery: /menu?t=T1&ch=<chapter>
  const ch = params.get('ch');
  if (ch) {
    if (view === 'book') book.goToChapter(ch);
    else document.getElementById(`cat-${ch}`)?.scrollIntoView();
  }
}

function setView(v, first) {
  view = v === 'list' ? 'list' : 'book';
  storage.set('qm:view', view);
  document.documentElement.dataset.view = view;
  if (view === 'book') {
    book.activate();
    if (first) book.intro();
    if (!first) window.scrollTo(0, 0);
  } else {
    book.deactivate();
    window.scrollTo(0, 0);
    setupScrollSpy();
  }
}

async function callStaff(reason) {
  if (!table) { toast('Scan the QR on your table to call our staff.', { error: true }); return; }
  try {
    await api('/api/calls', { method: 'POST', body: { table: table.id, reason } });
    toast('Our team has been notified — someone will be right with you.', { icon: '✓', ms: 3500 });
  } catch (err) { toast(err.message, { error: true }); }
}

function applyBranding() {
  const r = menu.restaurant;
  document.title = `${r.name} — Menu`;
  $('#brandName').textContent = r.name;
  $('#tagline').textContent = r.tagline || '';
  const info = [];
  if (r.hours) info.push(`<span class="chip">Open ${esc(r.hours)}</span>`);
  if (r.wifi) info.push(`<span class="chip">Wi-Fi · ${esc(r.wifi)}</span>`);
  info.push(`<span class="chip">${dietIcon(true)} Veg marked</span>`);
  $('#infoRow').innerHTML = info.join('');
  const tb = $('#tableBadge');
  const bt = $('#bkTable');
  bt.lastElementChild.textContent = table ? table.label : 'Browsing';
  bt.classList.toggle('on', !!table);
  if (table) {
    tb.classList.add('on');
    $('#tableText').textContent = `${table.label} · ordering on`;
    document.body.classList.add('has-table');
  } else {
    $('#tableText').textContent = 'Browsing mode';
  }
  const tax = [];
  if (r.taxRate) tax.push(`${r.taxRate}% GST`);
  if (r.serviceCharge) tax.push(`${r.serviceCharge}% service`);
  $('#taxNote').textContent = tax.length ? `${tax.join(' + ')} added at checkout` : 'No extra charges';
}

// ---------------- filtering ----------------
function matches(item) {
  if (filters.veg && !item.veg) return false;
  if (filters.popular && !item.popular) return false;
  if (filters.mild && item.spice > 1) return false;
  if (filters.q) {
    const hay = `${item.name} ${item.desc} ${(item.tags || []).join(' ')}`.toLowerCase();
    return filters.q.split(/\s+/).every((w) => hay.includes(w));
  }
  return true;
}
function highlight(text) {
  const safe = esc(text);
  if (!filters.q) return safe;
  const words = filters.q.split(/\s+/).filter(Boolean).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return safe;
  return safe.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark class="hl">$1</mark>');
}

// ---------------- rendering ----------------
function renderCats() {
  $('#cats').innerHTML = menu.categories
    .filter((c) => menu.items.some((i) => i.category === c.id))
    .map((c) => `<button class="cat" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
}

function spice(n) { return n ? `<span class="spice" title="Spice level ${n}/3" aria-label="Spice level ${n} of 3">${['', 'Mild', 'Medium', 'Hot'][n]}</span>` : ''; }

function renderPicks() {
  const picks = menu.items.filter((i) => i.popular && i.available !== false);
  $('#picksSec').classList.toggle('hidden', !picks.length || !!filters.q);
  $('#picks').innerHTML = picks.map((i) => `
    <button class="pick" data-open="${esc(i.id)}">
      ${dishArt(i)}
      <div class="pick-body">
        <div class="pick-name">${dietIcon(i.veg)} ${esc(i.name)}</div>
        <div class="pick-price">${fmtMoney(i.price, cur())}</div>
      </div>
    </button>`).join('');
  if (!prefersReducedMotion()) attachTilt($$('.pick'));
}

function qtyOf(id) { return cart.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0); }

function itemControl(i) {
  if (i.available === false) return `<button class="add" disabled>SOLD OUT</button>`;
  const q = qtyOf(i.id);
  if (!q) return `<button class="add" data-add="${esc(i.id)}" aria-label="Add ${esc(i.name)}">ADD +</button>`;
  return `<div class="stepper-sm"><button data-dec="${esc(i.id)}" aria-label="Remove one">−</button><output>${q}</output><button data-add="${esc(i.id)}" aria-label="Add one">+</button></div>`;
}

function renderSections() {
  let shown = 0;
  const html = menu.categories.map((c) => {
    const items = menu.items.filter((i) => i.category === c.id && matches(i));
    if (!items.length) return '';
    shown += items.length;
    return `<section class="cat-sec" id="cat-${esc(c.id)}" data-cat="${esc(c.id)}">
      <h2 class="display">${esc(c.name)}</h2>
      <div class="count">${items.length} dish${items.length > 1 ? 'es' : ''}</div>
      <ul class="items">${items.map((i, n) => `
        <li class="item${i.available === false ? ' sold' : ''}" data-open="${esc(i.id)}" style="animation-delay:${Math.min(n, 8) * 40}ms">
          <div>
            <div class="item-top">${dietIcon(i.veg)}${i.popular ? '<span class="badge-pop">★ Bestseller</span>' : ''}${(i.tags || []).slice(0, 1).filter((t) => !/bestseller/i.test(t)).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
            <h3>${highlight(i.name)}</h3>
            <div class="price">${fmtMoney(i.price, cur())} ${spice(i.spice)}</div>
            <p>${highlight(i.desc || '')}</p>
          </div>
          <div class="item-media">${dishArt(i)}<span data-ctl="${esc(i.id)}">${itemControl(i)}</span></div>
        </li>`).join('')}</ul>
    </section>`;
  }).join('');
  $('#sections').innerHTML = html;
  $('#empty').classList.toggle('hidden', shown > 0);
  $('#picksSec').classList.toggle('hidden', !!filters.q || !menu.items.some((i) => i.popular && i.available !== false));
  setupScrollSpy();
}

function refreshControls(id) {
  const i = byId(id);
  if (!i) return;
  $$(`[data-ctl="${CSS.escape(id)}"]`).forEach((el) => { el.innerHTML = itemControl(i); });
}

// ---------------- cart ----------------
function saveCart() { storage.set(cartKey(), cart); }

function addToCart(id, qty = 1, note = '') {
  const item = byId(id);
  if (!item || item.available === false) return;
  const line = cart.find((l) => l.id === id && l.note === note);
  if (line) line.qty = Math.min(20, line.qty + qty);
  else cart.push({ id, qty: Math.min(20, qty), note });
  saveCart(); renderCart(); refreshControls(id);
  const bar = $('#cartbar');
  bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump');
  if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* ignore */ }
}

function decFromCart(id) {
  // remove from the most recently added line of that dish
  for (let k = cart.length - 1; k >= 0; k--) {
    if (cart[k].id === id) { cart[k].qty -= 1; if (cart[k].qty <= 0) cart.splice(k, 1); break; }
  }
  saveCart(); renderCart(); refreshControls(id);
}

function totals() {
  const r = menu.restaurant;
  const subtotal = cart.reduce((s, l) => s + (byId(l.id)?.price || 0) * l.qty, 0);
  const tax = Math.round(subtotal * (Number(r.taxRate) || 0)) / 100;
  const service = Math.round(subtotal * (Number(r.serviceCharge) || 0)) / 100;
  return { subtotal, tax, service, total: Math.round((subtotal + tax + service) * 100) / 100, count: cart.reduce((s, l) => s + l.qty, 0) };
}

function renderCart() {
  cart = cart.filter((l) => byId(l.id));
  const t = totals();
  $('#cbCount').textContent = t.count;
  $('#cbTotal').textContent = fmtMoney(t.subtotal, cur());
  $('#cbItems').textContent = `${t.count} item${t.count === 1 ? '' : 's'}${table ? '' : ' · browsing'}`;
  $('#cartbar').classList.toggle('show', t.count > 0);
  document.body.classList.toggle('has-cart', t.count > 0);
  book?.setReserve(0); // cart bar shares the arrow row in the book

  $('#cartLines').innerHTML = cart.length ? cart.map((l, idx) => {
    const i = byId(l.id);
    return `<li class="cl">
      ${dishArt(i)}
      <div><div class="cl-name">${dietIcon(i.veg)} ${esc(i.name)}</div>
        ${l.note ? `<div class="cl-note">“${esc(l.note)}”</div>` : ''}
        <div class="cl-price">${fmtMoney(i.price * l.qty, cur())}</div></div>
      <div class="stepper"><button data-line="${idx}" data-d="-1" aria-label="Decrease">−</button><output>${l.qty}</output><button data-line="${idx}" data-d="1" aria-label="Increase">+</button></div>
    </li>`;
  }).join('') : `<li class="empty"><p class="display" style="font-size:20px;margin:0 0 4px">Nothing here yet</p>Your order is empty — add something delicious.</li>`;

  const r = menu.restaurant;
  $('#bill').innerHTML = `
    <dt>Subtotal</dt><dd>${fmtMoney(t.subtotal, cur())}</dd>
    ${r.taxRate ? `<dt>GST (${esc(r.taxRate)}%)</dt><dd>${fmtMoney(t.tax, cur())}</dd>` : ''}
    ${r.serviceCharge ? `<dt>Service (${esc(r.serviceCharge)}%)</dt><dd>${fmtMoney(t.service, cur())}</dd>` : ''}
    <dt class="tot">To pay</dt><dd class="tot">${fmtMoney(t.total, cur())}</dd>`;

  $('#cartTable').textContent = table ? `Serving to ${table.label}` : 'Scan the QR on your table to order — or pick your table below.';
  $('#placeBtn').disabled = !cart.length;
  $('#placeBtn').textContent = `Place order · ${fmtMoney(t.total, cur())}`;
}

async function placeOrder() {
  let tid = table ? table.id : $('#tablePick').value;
  if (!tid) { toast('Please choose your table first.', { error: true }); return; }
  const btn = $('#placeBtn');
  btn.disabled = true; btn.textContent = 'Sending to kitchen…';
  try {
    const order = await api('/api/orders', {
      method: 'POST',
      body: { table: tid, name: $('#custName').value, note: $('#orderNote').value, items: cart.map(({ id, qty, note }) => ({ id, qty, note })) },
    });
    storage.set('qm:name', $('#custName').value);
    myOrders = [{ id: order.id, number: order.number, at: order.createdAt }, ...myOrders].slice(0, 10);
    storage.set('qm:orders', myOrders);
    cart = []; saveCart(); $('#orderNote').value = '';
    renderCart(); renderSections();
    burst();
    closeSheets();
    setTimeout(() => openTracker(order.id), 250);
    refreshOrdersPip();
  } catch (e) {
    toast(e.message, { error: true, ms: 4000 });
    if (e.status === 400) { try { menu = await api('/api/menu'); renderSections(); renderCart(); book?.update(menu); } catch { /* ignore */ } }
  } finally {
    btn.disabled = !cart.length;
    renderCart();
  }
}

// ---------------- sheets ----------------
let openSheet = null;
let lastFocus = null;
function showSheet(el) {
  closeSheets(true);
  lastFocus = document.activeElement;
  openSheet = el;
  el.classList.add('open');
  $('#scrim').classList.add('show');
  document.body.style.overflow = 'hidden';
  setTimeout(() => (el.querySelector('.sheet-close') || el).focus({ preventScroll: true }), 50);
}
function closeSheets(silent) {
  $$('.sheet.open').forEach((s) => s.classList.remove('open'));
  $('#scrim').classList.remove('show');
  document.body.style.overflow = '';
  if (trackStream) { trackStream.close(); trackStream = null; }
  openSheet = null;
  if (!silent && lastFocus) lastFocus.focus?.({ preventScroll: true });
}

// Item detail with 3D viewer
let sheetItem = null;
let sheetQty = 1;
async function openItem(id) {
  const i = byId(id);
  if (!i) return;
  sheetItem = i; sheetQty = 1;
  $('#isName').textContent = i.name;
  $('#isPrice').textContent = fmtMoney(i.price, cur());
  $('#isDesc').textContent = i.desc || '';
  $('#isNote').value = '';
  $('#isQty').textContent = '1';
  const meta = [`<span class="chip">${dietIcon(i.veg)} ${i.veg ? 'Veg' : 'Non-veg'}</span>`];
  if (i.spice) meta.push(`<span class="chip">${['', 'Mild', 'Medium', 'Hot'][i.spice]} spice</span>`);
  if (i.prep) meta.push(`<span class="chip">${esc(i.prep)} min</span>`);
  if (i.kcal) meta.push(`<span class="chip">${esc(i.kcal)} kcal</span>`);
  (i.tags || []).forEach((t) => meta.push(`<span class="chip">${esc(t)}</span>`));
  $('#isMeta').innerHTML = meta.join('');
  $('#isAdd').disabled = i.available === false;
  updateAddLabel();
  const stage = $('#isStage');
  stage.innerHTML = i.image
    ? `<img class="is-photo" src="${esc(i.image)}" alt="${esc(i.name)}" decoding="async">`
    : dishArt(i, '', 480);
  showSheet($('#itemSheet'));
}
function updateAddLabel() {
  const i = sheetItem;
  if (!i) return;
  $('#isAdd').textContent = i.available === false ? 'Sold out today' : `Add ${sheetQty} · ${fmtMoney(i.price * sheetQty, cur())}`;
}

// Order tracker (live via Server-Sent Events, polling fallback)
let trackStream = null;
const STEPS = [
  ['placed', '1', 'Placed'], ['accepted', '2', 'Accepted'], ['preparing', '3', 'Cooking'], ['ready', '4', 'Ready'], ['served', '5', 'Served'],
];
const STATUS_COPY = {
  placed: ['✓', 'Order sent', 'The kitchen will confirm in a moment.'],
  accepted: ['✓', 'Order accepted', 'Your dishes are queued for the fire.'],
  preparing: ['✓', 'Cooking now', 'Our chefs are on it.'],
  ready: ['✓', 'Almost there', 'Your food is on its way to your table.'],
  served: ['✓', 'Enjoy your meal', 'Need anything else? Tap the bell.'],
  cancelled: ['!', 'Order cancelled', 'Please speak to our staff for help.'],
};

function renderTracker(o) {
  const idx = STEPS.findIndex((s) => s[0] === o.status);
  const [emo, title, sub] = STATUS_COPY[o.status] || STATUS_COPY.placed;
  const tabs = myOrders.length > 1 ? `<div class="order-tabs">${myOrders.map((m) => `<button class="btn btn-sm" data-track="${esc(m.id)}" aria-current="${m.id === o.id}">#${esc(m.number)}</button>`).join('')}</div>` : '';
  $('#trackBody').innerHTML = `${tabs}
    <div class="track-hero">
      <div class="num">Order #${esc(o.number)} · ${esc(o.tableLabel)}</div>
      <div class="track-anim${o.status === 'cancelled' ? ' off' : ''}" aria-hidden="true"><span>${esc(emo)}</span></div>
      <h2 class="display">${esc(title)}</h2>
      <p class="muted">${esc(sub)}</p>
    </div>
    ${o.status === 'cancelled' ? '<p class="cancelled-note">This order was cancelled.</p>' : `
    <ol class="steps" style="--p:${Math.max(0, idx) * 20}">
      ${STEPS.map((s, k) => `<li class="${k <= idx ? 'done' : ''} ${k === idx ? 'now' : ''}"><i>${s[1]}</i>${s[2]}</li>`).join('')}
    </ol>`}
    <ul class="track-list">${o.items.map((l) => `<li><span>${l.qty} × ${esc(l.name)}${l.note ? ` <small class="muted">(${esc(l.note)})</small>` : ''}</span><span>${fmtMoney(l.price * l.qty, cur())}</span></li>`).join('')}</ul>
    <dl class="bill"><dt>Subtotal</dt><dd>${fmtMoney(o.subtotal, cur())}</dd>${o.tax ? `<dt>GST</dt><dd>${fmtMoney(o.tax, cur())}</dd>` : ''}${o.service ? `<dt>Service</dt><dd>${fmtMoney(o.service, cur())}</dd>` : ''}<dt class="tot">${o.paid ? 'Paid ✅' : 'Total (pay at table)'}</dt><dd class="tot">${fmtMoney(o.total, cur())}</dd></dl>`;
}

async function openTracker(orderId) {
  const id = orderId || myOrders[0]?.id;
  if (!id) return;
  try {
    const o = await api(`/api/orders/${encodeURIComponent(id)}`);
    renderTracker(o);
    if (!$('#trackSheet').classList.contains('open')) showSheet($('#trackSheet'));
    if (trackStream) trackStream.close();
    let last = o.status;
    const onUpdate = (upd) => {
      renderTracker(upd);
      if (upd.status !== last) {
        last = upd.status;
        toast(STATUS_COPY[upd.status]?.[1] || 'Order updated', { icon: STATUS_COPY[upd.status]?.[0] });
        if (navigator.vibrate) try { navigator.vibrate([20, 40, 20]); } catch { /* ignore */ }
      }
    };
    if (menu.realtime === 'poll' || !('EventSource' in window)) {
      // Serverless hosting: no push, so re-check the order every few seconds while the sheet is open.
      let stopped = false;
      let timer = null;
      const tick = async () => {
        if (stopped) return;
        try { onUpdate(await api(`/api/orders/${encodeURIComponent(id)}`)); } catch { /* retry next tick */ }
        if (!stopped && !['served', 'cancelled'].includes(last)) timer = setTimeout(tick, document.hidden ? 10000 : 4000);
      };
      timer = setTimeout(tick, 4000);
      trackStream = { close() { stopped = true; clearTimeout(timer); } };
    } else {
      trackStream = new EventSource(`/api/orders/${encodeURIComponent(id)}/events`);
      trackStream.addEventListener('order:update', (ev) => {
        try { onUpdate(JSON.parse(ev.data)); } catch { /* ignore malformed */ }
      });
    }
  } catch (e) {
    if (e.status === 404) {
      myOrders = myOrders.filter((m) => m.id !== id); storage.set('qm:orders', myOrders); refreshOrdersPip();
    }
    toast(e.message, { error: true });
  }
}

function refreshOrdersPip() {
  $('#ordersBtn').classList.toggle('hidden', !myOrders.length);
  $('#bkOrders').classList.toggle('hidden', !myOrders.length);
}

// ---------------- interactions ----------------
function wireUi() {
  $('#custName').value = storage.get('qm:name', '') || '';

  document.addEventListener('click', (e) => {
    const t = e.target;
    const add = t.closest('[data-add]');
    if (add) { e.stopPropagation(); addToCart(add.dataset.add); return; }
    const dec = t.closest('[data-dec]');
    if (dec) { e.stopPropagation(); decFromCart(dec.dataset.dec); return; }
    if (t.closest('.stepper-sm')) { e.stopPropagation(); return; }
    const open = t.closest('[data-open]');
    if (open) { openItem(open.dataset.open); return; }
    const cat = t.closest('.cat');
    if (cat) {
      const sec = document.getElementById(`cat-${cat.dataset.cat}`);
      if (sec) sec.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    const line = t.closest('[data-line]');
    if (line) {
      const l = cart[Number(line.dataset.line)];
      if (l) {
        l.qty = Math.min(20, l.qty + Number(line.dataset.d));
        if (l.qty <= 0) cart.splice(Number(line.dataset.line), 1);
        saveCart(); renderCart(); refreshControls(l.id);
      }
      return;
    }
    const tr = t.closest('[data-track]');
    if (tr) { openTracker(tr.dataset.track); return; }
    if (t.closest('[data-close]')) closeSheets();
  });

  $('#scrim').addEventListener('click', () => closeSheets());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheets(); toggleFab(false); }
    if (e.key === 'Enter' && e.target.matches?.('.item, .pick, .bk-row')) openItem(e.target.dataset.open);
  });

  // Search & filters
  let st;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(st);
    st = setTimeout(() => { filters.q = e.target.value.trim().toLowerCase(); renderSections(); }, 120);
  });
  $$('.filter').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.filter;
    filters[f] = !filters[f];
    b.setAttribute('aria-pressed', String(filters[f]));
    renderSections();
  }));
  $('#clearFilters').addEventListener('click', () => {
    Object.assign(filters, { q: '', veg: false, popular: false, mild: false });
    $('#search').value = '';
    $$('.filter').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    renderSections();
  });

  // Item sheet
  $('#isStepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    sheetQty = Math.max(1, Math.min(20, sheetQty + Number(b.dataset.step)));
    $('#isQty').textContent = sheetQty;
    updateAddLabel();
  });
  $('#isAdd').addEventListener('click', () => {
    if (!sheetItem || sheetItem.available === false) return;
    addToCart(sheetItem.id, sheetQty, $('#isNote').value.trim().slice(0, 120));
    toast(`${sheetItem.name} added to your order`, { icon: '✓' });
    closeSheets();
  });

  // Cart
  $('#cartbar').addEventListener('click', async () => {
    if (!table) {
      const wrap = $('#tablePickWrap');
      wrap.classList.remove('hidden');
      if (!$('#tablePick').options.length) {
        try {
          const tables = await api('/api/tables');
          $('#tablePick').innerHTML = `<option value="">Select your table…</option>${tables.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}`;
        } catch { /* ignore */ }
      }
    }
    showSheet($('#cartSheet'));
  });
  $('#placeBtn').addEventListener('click', placeOrder);

  // Orders + theme + view
  $('#ordersBtn').addEventListener('click', () => openTracker());
  $('#bkOrders').addEventListener('click', () => openTracker());
  $('#bkToc').addEventListener('click', () => book?.goTo(1));
  $('#toList').addEventListener('click', () => setView('list'));
  $('#toBook').addEventListener('click', () => setView('book'));
  $('#themeBtn').addEventListener('click', () => {
    const now = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = now;
    storage.set('qm:theme', now);
  });

  // Call waiter
  $('#fab').addEventListener('click', () => toggleFab());
  $('#fabMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-call]');
    if (!b || !table) return;
    toggleFab(false);
    callStaff(b.dataset.call);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.fab-wrap')) toggleFab(false); });
  // make list items keyboard reachable
  new MutationObserver(() => $$('.item:not([tabindex])').forEach((li) => li.setAttribute('tabindex', '0'))).observe($('#sections'), { childList: true });
  $$('.item').forEach((li) => li.setAttribute('tabindex', '0'));
}

function toggleFab(force) {
  const menuEl = $('#fabMenu');
  const open = force === undefined ? !menuEl.classList.contains('open') : force;
  menuEl.classList.toggle('open', open);
  $('#fab').setAttribute('aria-expanded', String(open));
}

// Category scrollspy
let spy;
function setupScrollSpy() {
  if (spy) spy.disconnect();
  if (!('IntersectionObserver' in window)) return;
  spy = new IntersectionObserver((entries) => {
    const vis = entries.filter((en) => en.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    const id = vis.target.dataset.cat;
    $$('.cat').forEach((c) => {
      const on = c.dataset.cat === id;
      c.classList.toggle('active', on);
      if (on) c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }, { rootMargin: '-130px 0px -60% 0px' });
  $$('.cat-sec').forEach((s) => spy.observe(s));
}

// 3D tilt for pick cards (pointer + subtle idle)
function attachTilt(cards) {
  cards.forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 16}deg) rotateX(${-y * 16}deg) translateZ(6px)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });
}

// Celebration burst after ordering
function burst() {
  if (prefersReducedMotion()) return;
  const colors = ['#e7c66f', '#f3d98b', '#ff7a3d', '#b23d17', '#f6f4ee'];
  for (let k = 0; k < 30; k++) {
    const s = document.createElement('span');
    Object.assign(s.style, { width: `${6 + Math.random() * 8}px`, height: `${3 + Math.random() * 5}px`, background: colors[k % colors.length], borderRadius: '1px' });
    const ang = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 180;
    Object.assign(s.style, { position: 'fixed', left: '50%', top: '70%', zIndex: 999, pointerEvents: 'none', transition: 'transform 1.2s cubic-bezier(.2,.8,.2,1), opacity 1.2s' });
    document.body.appendChild(s);
    requestAnimationFrame(() => {
      s.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist - 160}px) rotate(${Math.random() * 360}deg)`;
      s.style.opacity = '0';
    });
    setTimeout(() => s.remove(), 1100);
  }
}

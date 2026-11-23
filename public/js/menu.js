import { $, $$, esc, api, toast, fmtMoney, storage, dishArt, dietIcon, thumbOf, prefersReducedMotion } from './common.js';
// The page-turning menu book is switched off for now. To restore it, re-enable this import,
// the book markup in menu.html and createBook() wiring (git history, commit 9543a51).
// import { createBook } from './book.js';

// ============================================================ state
const params = new URLSearchParams(location.search);
let tableId = (params.get('t') || '').toUpperCase().slice(0, 20);
let table = null;
let menu = { restaurant: {}, categories: [], items: [] };
const filters = { q: '', veg: false, popular: false, mild: false };
const cartKey = () => `qm:cart:${tableId || 'browse'}`;
let cart = [];                                     // [{ id, qty, note }]
let myOrders = storage.get('qm:orders', []);       // [{ id, number, at }]
const cur = () => menu.restaurant.currency || '₹';
const money = (n) => fmtMoney(n, cur());
const byId = (id) => menu.items.find((i) => i.id === id);
const round2 = (n) => Math.round(n * 100) / 100;

// ============================================================ boot
init().catch((e) => {
  console.error(e);
  $('#sections').innerHTML = `<div class="empty"><p class="empty-t">We couldn’t load the menu</p><p>${esc(e.message)}</p><button class="btn btn-sm" onclick="location.reload()">Try again</button></div>`;
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
  if (table) { refreshBill(); setInterval(() => { if (!document.hidden && !billOpen()) refreshBill(); }, 20000); }
  const ch = params.get('ch'); // deep link to a category
  if (ch) document.getElementById(`cat-${ch}`)?.scrollIntoView();

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try { menu = await api('/api/menu'); renderPicks(); renderSections(); renderCart(); } catch { /* offline: keep old */ }
    if (table) refreshBill();
  });
}

function applyBranding() {
  const r = menu.restaurant;
  document.title = `${r.name} — Menu`;
  $('#abName').textContent = r.name;
  $('#brandName').innerHTML = esc(r.name).replace(/&amp;/, '<span class="amp">&amp;</span>');
  $('#tagline').textContent = r.tagline || '';
  const hero = menu.items.find((i) => i.popular && i.image) || menu.items.find((i) => i.image);
  if (hero) { $('#heroImg').src = hero.image; $('#heroImg').alt = hero.name; } else $('#heroImg').remove();
  const info = [];
  if (r.hours) info.push(`<span class="chip">Open ${esc(r.hours)}</span>`);
  if (r.wifi) info.push(`<span class="chip">Wi-Fi · ${esc(r.wifi)}</span>`);
  info.push(`<span class="chip">${dietIcon(true)} Veg marked</span>`);
  $('#infoRow').innerHTML = info.join('');
  if (table) {
    $('#tableChip').classList.add('on');
    $('#tableText').textContent = table.label;
    $('#heroKicker').textContent = `${table.label} · Dine-in`;
    document.body.classList.add('has-table');
  } else {
    $('#tableText').textContent = 'Browsing';
  }
  const tax = [];
  if (r.taxRate) tax.push(`${r.taxRate}% GST`);
  if (r.serviceCharge) tax.push(`${r.serviceCharge}% service`);
  $('#taxNote').textContent = tax.length ? `Prices exclude ${tax.join(' + ')}, added on the bill` : 'No extra charges on the bill';
}

// ============================================================ filtering
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

// ============================================================ rendering
const SPICE = ['', 'Mild', 'Medium', 'Hot'];
function photo(item, size = 320) {
  if (!item.image) return dishArt(item, '', 240);
  return `<div class="photo"><img src="${esc(thumbOf(item.image))}" alt="" loading="lazy" decoding="async" width="${size}" height="${size}"></div>`;
}
// bundled photos ship a 480×600 size — right for the 4:5 pick cards
const mdOf = (src) => (/^\/img\/dishes\/[\w-]+\.jpg$/.test(src || '') ? src.replace(/\.jpg$/, '-md.jpg') : src);

function renderCats() {
  $('#cats').innerHTML = menu.categories
    .filter((c) => menu.items.some((i) => i.category === c.id))
    .map((c) => `<button class="cat" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
}

function renderPicks() {
  const picks = menu.items.filter((i) => i.popular && i.available !== false);
  $('#picksSec').classList.toggle('hidden', !picks.length || !!filters.q);
  $('#picks').innerHTML = picks.map((i) => `
    <div class="pick" data-open="${esc(i.id)}" role="button" tabindex="0" aria-label="${esc(i.name)}, ${esc(money(i.price))}">
      <div class="pick-img">${i.image ? `<img src="${esc(mdOf(i.image))}" alt="" loading="lazy" decoding="async" width="480" height="600">` : dishArt(i, '', 300)}</div>
      <button class="quick" data-add="${esc(i.id)}" aria-label="Add ${esc(i.name)}">+</button>
      <div class="pick-name">${dietIcon(i.veg)} ${esc(i.name)}</div>
      <div class="pick-price">${esc(money(i.price))}</div>
    </div>`).join('');
}

function qtyOf(id) { return cart.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0); }

function itemControl(i) {
  if (i.available === false) return '<button class="add" disabled>SOLD OUT</button>';
  const q = qtyOf(i.id);
  if (!q) return `<button class="add" data-add="${esc(i.id)}" aria-label="Add ${esc(i.name)}">ADD</button>`;
  return `<div class="stepper-sm"><button data-dec="${esc(i.id)}" aria-label="Remove one">−</button><output>${q}</output><button data-add="${esc(i.id)}" aria-label="Add one">+</button></div>`;
}

function renderSections() {
  let shown = 0;
  $('#sections').innerHTML = menu.categories.map((c) => {
    const items = menu.items.filter((i) => i.category === c.id && matches(i));
    if (!items.length) return '';
    shown += items.length;
    return `<section class="cat-sec" id="cat-${esc(c.id)}" data-cat="${esc(c.id)}">
      <h2>${esc(c.name)}</h2>
      <div class="count">${items.length} dish${items.length > 1 ? 'es' : ''}</div>
      <ul class="items">${items.map((i) => `
        <li class="item${i.available === false ? ' sold' : ''}" data-open="${esc(i.id)}" tabindex="0">
          <div>
            <div class="item-top">${dietIcon(i.veg)}${i.popular ? '<span class="badge-pop">Bestseller</span>' : ''}</div>
            <h3>${highlight(i.name)}</h3>
            <div class="price">${esc(money(i.price))}${i.spice ? `<span class="spice">${SPICE[i.spice]}</span>` : ''}</div>
            <p>${highlight(i.desc || '')}</p>
          </div>
          <div class="item-media">${photo(i)}<span data-ctl="${esc(i.id)}">${itemControl(i)}</span></div>
        </li>`).join('')}</ul>
    </section>`;
  }).join('');
  $('#empty').classList.toggle('hidden', shown > 0);
  $('#picksSec').classList.toggle('hidden', !!filters.q || !menu.items.some((i) => i.popular && i.available !== false));
  setupScrollSpy();
}

function refreshControls(id) {
  const i = byId(id);
  if (!i) return;
  $$(`[data-ctl="${CSS.escape(id)}"]`).forEach((el) => { el.innerHTML = itemControl(i); });
}

// ============================================================ cart
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
  if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* ignore */ }
}

function decFromCart(id) {
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
  return { subtotal, tax, service, total: round2(subtotal + tax + service), count: cart.reduce((s, l) => s + l.qty, 0) };
}

function renderCart() {
  cart = cart.filter((l) => byId(l.id));
  const t = totals();
  $('#cbCount').textContent = t.count;
  $('#cbTotal').textContent = money(t.subtotal);
  $('#cbItems').textContent = `${t.count} item${t.count === 1 ? '' : 's'}${table ? '' : ' · browsing'}`;
  $('#cartbar').classList.toggle('empty-cart', t.count === 0);
  document.body.classList.toggle('has-cart', t.count > 0);

  $('#cartLines').innerHTML = cart.length ? cart.map((l, idx) => {
    const i = byId(l.id);
    return `<li class="cl">
      <div class="thumb">${i.image ? `<img src="${esc(thumbOf(i.image))}" alt="" width="108" height="108" decoding="async">` : dishArt(i, '', 120)}</div>
      <div><div class="cl-name">${dietIcon(i.veg)} ${esc(i.name)}</div>
        ${l.note ? `<div class="cl-note">“${esc(l.note)}”</div>` : ''}
        <div class="cl-price">${esc(money(i.price * l.qty))}</div></div>
      <div class="stepper"><button data-line="${idx}" data-d="-1" aria-label="Decrease">−</button><output>${l.qty}</output><button data-line="${idx}" data-d="1" aria-label="Increase">+</button></div>
    </li>`;
  }).join('') : '<li class="empty"><p class="empty-t">Nothing here yet</p>Add something delicious from the menu.</li>';

  const r = menu.restaurant;
  $('#bill').innerHTML = `
    <dt>Subtotal</dt><dd>${esc(money(t.subtotal))}</dd>
    ${r.taxRate ? `<dt>GST (${esc(r.taxRate)}%)</dt><dd>${esc(money(t.tax))}</dd>` : ''}
    ${r.serviceCharge ? `<dt>Service (${esc(r.serviceCharge)}%)</dt><dd>${esc(money(t.service))}</dd>` : ''}
    <dt class="tot">This order</dt><dd class="tot">${esc(money(t.total))}</dd>`;
  $('#cartTable').textContent = table ? `Sending to the kitchen for ${table.label}. You can pay or split the bill after you eat.` : 'Scan the QR on your table to order — or pick your table below.';
  $('#placeBtn').disabled = !cart.length;
  $('#placeBtn').textContent = `Place order · ${money(t.total)}`;
}

async function placeOrder() {
  const tid = table ? table.id : $('#tablePick').value;
  if (!tid) { toast('Please choose your table first.', { error: true }); return; }
  const btn = $('#placeBtn');
  btn.disabled = true; btn.textContent = 'Sending to the kitchen…';
  try {
    const order = await api('/api/orders', {
      method: 'POST',
      body: { table: tid, name: $('#custName').value, note: $('#orderNote').value, items: cart.map(({ id, qty, note }) => ({ id, qty, note })) },
    });
    storage.set('qm:name', $('#custName').value);
    myOrders = [{ id: order.id, number: order.number, at: order.createdAt }, ...myOrders].slice(0, 10);
    storage.set('qm:orders', myOrders);
    cart = []; saveCart(); $('#orderNote').value = '';
    renderCart(); renderSections(); renderPicks();
    confetti();
    closeSheets();
    setTimeout(() => openTracker(order.id), 250);
    refreshOrdersPip();
    if (table) refreshBill();
  } catch (e) {
    toast(e.message, { error: true, ms: 4000 });
    if (e.status === 400) { try { menu = await api('/api/menu'); renderSections(); renderCart(); } catch { /* ignore */ } }
  } finally {
    renderCart();
  }
}

// ============================================================ sheets
let lastFocus = null;
function showSheet(el) {
  closeSheets(true);
  lastFocus = document.activeElement;
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
  stopBillPoll();
  if (!silent && lastFocus) lastFocus.focus?.({ preventScroll: true });
}

// item detail
let sheetItem = null;
let sheetQty = 1;
function openItem(id) {
  const i = byId(id);
  if (!i) return;
  sheetItem = i; sheetQty = 1;
  $('#isName').textContent = i.name;
  $('#isPrice').textContent = money(i.price);
  $('#isDesc').textContent = i.desc || '';
  $('#isNote').value = '';
  $('#isQty').textContent = '1';
  const meta = [`<span class="chip">${dietIcon(i.veg)} ${i.veg ? 'Veg' : 'Non-veg'}</span>`];
  if (i.spice) meta.push(`<span class="chip">${SPICE[i.spice]} spice</span>`);
  if (i.prep) meta.push(`<span class="chip">${esc(i.prep)} min</span>`);
  if (i.kcal) meta.push(`<span class="chip">${esc(i.kcal)} kcal</span>`);
  (i.tags || []).forEach((t) => meta.push(`<span class="chip">${esc(t)}</span>`));
  $('#isMeta').innerHTML = meta.join('');
  $('#isAdd').disabled = i.available === false;
  updateAddLabel();
  $('#isStage').innerHTML = i.image
    ? `<img class="is-photo" src="${esc(i.image)}" alt="${esc(i.name)}" decoding="async">`
    : dishArt(i, '', 480);
  showSheet($('#itemSheet'));
}
function updateAddLabel() {
  if (!sheetItem) return;
  $('#isAdd').textContent = sheetItem.available === false ? 'Sold out today' : `Add ${sheetQty} · ${money(sheetItem.price * sheetQty)}`;
}

// ============================================================ order tracker (SSE locally, polling on serverless)
let trackStream = null;
const STEPS = [['placed', 'Placed'], ['accepted', 'Accepted'], ['preparing', 'Cooking'], ['ready', 'Ready'], ['served', 'Served']];
const STATUS_COPY = {
  placed: ['Order sent', 'The kitchen will confirm in a moment.'],
  accepted: ['Order accepted', 'Your dishes are queued for the fire.'],
  preparing: ['Cooking now', 'Our chefs are on it.'],
  ready: ['Almost there', 'Your food is on its way to your table.'],
  served: ['Enjoy your meal', 'When you’re ready, view the bill to pay or split it.'],
  cancelled: ['Order cancelled', 'Please speak to our staff for help.'],
};

function renderTracker(o) {
  const idx = STEPS.findIndex((s) => s[0] === o.status);
  const [title, sub] = STATUS_COPY[o.status] || STATUS_COPY.placed;
  const tabs = myOrders.length > 1 ? `<div class="order-tabs">${myOrders.map((m) => `<button class="btn btn-sm" data-track="${esc(m.id)}" aria-current="${m.id === o.id}">#${esc(m.number)}</button>`).join('')}</div>` : '';
  $('#trackBody').innerHTML = `${tabs}
    <div class="track-hero">
      <div class="num">Order #${esc(o.number)} · ${esc(o.tableLabel)}</div>
      <div class="track-anim${o.status === 'cancelled' ? ' off' : ''}" aria-hidden="true"><span>${o.status === 'cancelled' ? '!' : '✓'}</span></div>
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(sub)}</p>
    </div>
    ${o.status === 'cancelled' ? '<p class="cancelled-note">This order was cancelled.</p>' : `
    <ol class="steps" style="--p:${Math.max(0, idx) * 20}">
      ${STEPS.map((s, k) => `<li class="${k <= idx ? 'done' : ''}"><i>${k + 1}</i>${s[1]}</li>`).join('')}
    </ol>`}
    <ul class="track-list">${o.items.map((l) => `<li><span>${l.qty} × ${esc(l.name)}${l.note ? ` <small class="muted">(${esc(l.note)})</small>` : ''}</span><span>${esc(money(l.price * l.qty))}</span></li>`).join('')}</ul>
    <dl class="bill"><dt>Subtotal</dt><dd>${esc(money(o.subtotal))}</dd>${o.tax ? `<dt>GST</dt><dd>${esc(money(o.tax))}</dd>` : ''}${o.service ? `<dt>Service</dt><dd>${esc(money(o.service))}</dd>` : ''}<dt class="tot">${o.paid ? 'Paid' : 'Order total'}</dt><dd class="tot">${esc(money(o.total))}</dd></dl>`;
  $('#trackToBill').classList.toggle('hidden', !table || o.paid);
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
        toast(STATUS_COPY[upd.status]?.[0] || 'Order updated');
        if (navigator.vibrate) try { navigator.vibrate([20, 40, 20]); } catch { /* ignore */ }
      }
    };
    if (menu.realtime === 'poll' || !('EventSource' in window)) {
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
      trackStream.addEventListener('order:update', (ev) => { try { onUpdate(JSON.parse(ev.data)); } catch { /* ignore */ } });
    }
  } catch (e) {
    if (e.status === 404) { myOrders = myOrders.filter((m) => m.id !== id); storage.set('qm:orders', myOrders); refreshOrdersPip(); }
    toast(e.message, { error: true });
  }
}

function refreshOrdersPip() { $('#ordersBtn').classList.toggle('hidden', !myOrders.length); }

// ============================================================ the table bill: pay · split · pay for my items
let bill = null;
let billSig = '';
let billTimer = null;
const pay = { mode: 'full', parts: 2, shares: 1, lines: new Set(), method: '', name: storage.get('qm:name', '') || '', more: false };
const myPayKey = () => `qm:pay:${tableId}`;
const myPayments = () => storage.get(myPayKey(), []);
const billOpen = () => $('#payBillSheet').classList.contains('open');

async function refreshBill() {
  if (!table) return;
  try {
    const b = await api(`/api/tables/${encodeURIComponent(table.id)}/bill`);
    const sig = JSON.stringify(b);
    bill = b;
    renderDockBill();
    // don't rebuild the sheet under someone's fingers while they type their name
    if (billOpen() && sig !== billSig && document.activeElement?.id !== 'pbName') { billSig = sig; renderBillSheet(); }
  } catch { /* offline — keep the last bill */ }
}
function stopBillPoll() { clearInterval(billTimer); billTimer = null; }

function renderDockBill() {
  const btn = $('#billBtn');
  const show = Boolean(bill && (bill.total > 0 || bill.payments.length));
  btn.classList.toggle('hidden', !show);
  if (!show) return;
  const due = bill.remaining > 0.5 ? bill.remaining : bill.total;
  $('#billBtnAmt').textContent = money(due);
  btn.querySelector('.db-k').textContent = bill.remaining > 0.5 ? (bill.paid + bill.pending > 0 ? 'Left to pay' : 'Table bill') : 'Bill';
  btn.querySelector('.db-cta').textContent = bill.remaining > 0.5 ? 'Pay' : 'Status';
}

async function openBill() {
  if (!table) return;
  billSig = '';
  showSheet($('#payBillSheet'));
  $('#pbContent').innerHTML = '<div class="skeleton" style="height:220px"></div>';
  await refreshBill();
  if (!bill) { $('#pbContent').innerHTML = '<p class="muted">We couldn’t load the bill. Check your connection and try again.</p>'; return; }
  billSig = JSON.stringify(bill);
  renderBillSheet();
  stopBillPoll();
  billTimer = setInterval(() => { if (!document.hidden) refreshBill(); }, 4000);
}

// mirrors the server's maths exactly (the server still recomputes on submit)
function preview() {
  if (!bill) return 0;
  let amt = 0;
  if (pay.mode === 'full') amt = bill.remaining;
  else if (pay.mode === 'equal') amt = round2((bill.total * pay.shares) / pay.parts);
  else {
    const sel = bill.lines.filter((l) => pay.lines.has(l.key) && !l.claimedBy).reduce((s, l) => s + l.amount, 0);
    amt = bill.subtotal > 0 ? round2((bill.total * sel) / bill.subtotal) : 0;
  }
  return round2(Math.max(0, Math.min(amt, bill.remaining)));
}

const METHOD = {
  upi: ['UPI', 'Pay with UPI', 'Any UPI app — Google Pay, PhonePe, Paytm'],
  card: ['CARD', 'Card at the table', 'We’ll bring the card machine'],
  cash: ['CASH', 'Cash at the table', 'Your server will collect it'],
};
const MODE_LABEL = (p) => (p.mode === 'equal' ? `${p.shares} of ${p.parts} shares` : p.mode === 'items' ? `${p.lines.length} dish${p.lines.length === 1 ? '' : 'es'}` : 'Full bill');
const STATUS_LABEL = { pending: 'Waiting for staff', confirmed: 'Received', rejected: 'Not received' };

function upiLink(amount) {
  if (!bill?.upi) return '';
  const q = new URLSearchParams({ pa: bill.upi.id, pn: bill.upi.name, am: amount.toFixed(2), cu: 'INR', tn: `${bill.table.label} bill` });
  return `upi://pay?${q.toString()}`;
}

function renderBillSheet() {
  if (!bill) return;
  const mine = new Set(myPayments());
  const myPending = bill.payments.filter((p) => mine.has(p.id) && p.status === 'pending');
  const myConfirmed = bill.payments.filter((p) => mine.has(p.id) && p.status === 'confirmed');
  $('#pbTable').textContent = bill.table.label;
  const status = $('#pbStatus');
  const settledRecently = bill.total === 0 && bill.settledAt && Date.now() - new Date(bill.settledAt).getTime() < 3 * 3600_000;
  status.className = 'status-pill';
  if (bill.total === 0) { status.textContent = settledRecently ? 'Settled' : 'No orders'; if (settledRecently) status.classList.add('settled'); }
  else if (bill.remaining > 0.5) status.textContent = 'Open';
  else if (bill.pending > 0) status.textContent = 'Confirming';
  else { status.textContent = 'Paid'; status.classList.add('settled'); }

  // ---- empty / settled
  if (bill.total === 0) {
    $('#pbContent').innerHTML = settledRecently
      ? `<div class="pay-done"><div class="tick">✓</div><h3>All settled</h3><p>Thank you for dining with us. We hope to see you again soon.</p></div>`
      : `<div class="pay-done"><div class="tick wait">₹</div><h3>Nothing to pay yet</h3><p>Your table’s bill appears here as soon as you place an order.</p></div>`;
    setFoot('Back to the menu', false, () => closeSheets());
    return;
  }

  const r = menu.restaurant;
  const status1 = myPending.length
    ? `<div class="pay-done"><div class="tick wait">…</div><h3>${esc(money(myPending.reduce((s, p) => s + p.amount, 0)))} sent</h3>
        <p>${myPending.some((p) => p.method === 'upi') ? 'Finish in your UPI app if you haven’t yet.' : 'Your server is on the way.'} Staff will confirm the moment it’s received.</p>
        ${myPending.some((p) => p.method === 'upi') && bill.upi ? `<a class="btn btn-primary upi-btn" href="${esc(upiLink(myPending.find((p) => p.method === 'upi').amount))}">Open UPI app</a>` : ''}</div>`
    : myConfirmed.length ? `<div class="pay-done"><div class="tick">✓</div><h3>Payment received</h3><p>${bill.remaining > 0.5 ? 'Your share is done. The rest of the table can pay below.' : 'Thank you! The table is fully covered.'}</p></div>` : '';

  const canPay = bill.remaining > 0.5;
  // once you've paid your part, keep the sheet calm: status first, "pay more" on request
  const iPaid = myPending.length + myConfirmed.length > 0;
  const showSplit = canPay && (!iPaid || pay.more);
  const linesHtml = bill.lines.map((l) => {
    const checked = pay.lines.has(l.key) && !l.claimedBy;
    const pick = pay.mode === 'items' && showSplit
      ? `<input type="checkbox" data-line="${esc(l.key)}" ${checked ? 'checked' : ''} ${l.claimedBy ? 'disabled' : ''} aria-label="I’m paying for ${esc(l.name)}">`
      : dietIcon(l.veg);
    return `<li class="${l.claimedBy ? 'is-claimed' : ''}">${pick}
      <span class="nm">${esc(l.qty)} × ${esc(l.name)}<span class="sub">Order #${esc(l.order)}${l.note ? ` · ${esc(l.note)}` : ''}</span>${l.claimedBy ? `<span class="claimed">Paid by ${esc(l.claimedBy)}</span>` : ''}</span>
      <span class="amt">${esc(money(l.amount))}</span></li>`;
  }).join('');

  const paymentsHtml = bill.payments.length ? `<div class="pb-sec"><span class="label">Payments</span><ul class="pay-list">${bill.payments.map((p) => `
      <li class="${mine.has(p.id) ? 'mine' : ''}"><span><b>${esc(p.name)}</b>${mine.has(p.id) ? ' (you)' : ''} · ${esc(money(p.amount))}<br><small class="muted">${esc(METHOD[p.method][1])} · ${esc(MODE_LABEL(p))}</small></span>
      <span class="st ${esc(p.status)}">${esc(STATUS_LABEL[p.status])}</span></li>`).join('')}</ul></div>` : '';

  const splitHtml = canPay && !showSplit
    ? '<div class="pb-sec"><button class="btn btn-sm btn-ghost" data-more>Pay for someone else too</button></div>'
    : canPay ? `
    <div class="pb-sec"><span class="label">How are you paying?</span>
      <div class="seg" role="group" aria-label="Payment split">
        <button data-mode="full" aria-pressed="${pay.mode === 'full'}">Whole bill</button>
        <button data-mode="equal" aria-pressed="${pay.mode === 'equal'}">Split equally</button>
        <button data-mode="items" aria-pressed="${pay.mode === 'items'}">My items</button>
      </div>
      <div class="split-box">
        ${pay.mode === 'full' ? `<div class="split-row"><span>Everything that’s left<small>Covers the whole table</small></span></div>` : ''}
        ${pay.mode === 'equal' ? `
          <div class="split-row"><span>People at the table</span><div class="stepper" data-stepper="parts"><button data-d="-1" ${pay.parts <= 2 ? 'disabled' : ''} aria-label="Fewer people">−</button><output>${pay.parts}</output><button data-d="1" ${pay.parts >= 30 ? 'disabled' : ''} aria-label="More people">+</button></div></div>
          <div class="split-row"><span>I’m paying for<small>e.g. 2 for you and a guest</small></span><div class="stepper" data-stepper="shares"><button data-d="-1" ${pay.shares <= 1 ? 'disabled' : ''} aria-label="Fewer shares">−</button><output>${pay.shares}</output><button data-d="1" ${pay.shares >= pay.parts ? 'disabled' : ''} aria-label="More shares">+</button></div></div>` : ''}
        ${pay.mode === 'items' ? `<div class="split-row"><span>Tick your dishes above<small>GST &amp; service are shared in proportion</small></span></div>` : ''}
        <div class="you-pay"><span class="muted">You pay</span><b id="pbAmount">${esc(money(preview()))}</b></div>
      </div>
    </div>
    <div class="pb-sec"><label class="field"><span>Your name</span><input class="input" id="pbName" maxlength="40" autocomplete="given-name" placeholder="So the table knows who paid" value="${esc(pay.name)}"></label></div>
    <div class="pb-sec"><span class="label">Pay with</span>
      <div class="methods" role="radiogroup" aria-label="Payment method">${Object.entries(METHOD).map(([k, [ic, t, s]]) => `
        <button class="method" role="radio" data-method="${k}" aria-checked="${pay.method === k}"><span class="mi">${ic}</span><span><b>${esc(t)}</b><small>${esc(k === 'upi' && !bill.upi ? 'Scan the UPI QR at the counter, then tell us here' : s)}</small></span></button>`).join('')}
      </div>
      <p class="note-line">The restaurant confirms each payment as it arrives — you’ll see it update here.</p>
    </div>` : '';

  $('#pbContent').innerHTML = `${status1}
    <div class="pb-sec"><span class="label">${esc(bill.orders.length)} order${bill.orders.length === 1 ? '' : 's'} on this table</span><ul class="pb-lines">${linesHtml}</ul></div>
    <div class="pb-sec"><dl class="bill">
      <dt>Subtotal</dt><dd>${esc(money(bill.subtotal))}</dd>
      ${bill.tax ? `<dt>GST (${esc(r.taxRate)}%)</dt><dd>${esc(money(bill.tax))}</dd>` : ''}
      ${bill.service ? `<dt>Service (${esc(r.serviceCharge)}%)</dt><dd>${esc(money(bill.service))}</dd>` : ''}
      <dt class="tot">Total</dt><dd class="tot">${esc(money(bill.total))}</dd>
      ${bill.paid ? `<dt class="ok">Received</dt><dd class="ok">− ${esc(money(bill.paid))}</dd>` : ''}
      ${bill.pending ? `<dt class="wait">Waiting for staff</dt><dd class="wait">− ${esc(money(bill.pending))}</dd>` : ''}
      ${bill.paid || bill.pending ? `<dt><b>Left to pay</b></dt><dd><b>${esc(money(bill.remaining))}</b></dd>` : ''}
    </dl></div>
    ${paymentsHtml}
    ${splitHtml}`;

  if (showSplit) updatePayButton();
  else if (canPay) setFoot('Done', false, () => closeSheets());
  else setFoot(bill.pending > 0 ? 'Waiting for staff to confirm…' : 'Bill fully paid', true);
}

function setFoot(label, disabled, onClick) {
  const b = $('#payBtn');
  b.textContent = label;
  b.disabled = disabled;
  b.onclick = onClick || null;
}

function updatePayButton() {
  const amt = preview();
  const el = $('#pbAmount');
  if (el) el.textContent = money(amt);
  const ready = amt > 0 && pay.method;
  setFoot(!pay.method ? 'Choose how to pay' : amt <= 0 ? 'Pick what you’re paying for' : `Pay ${money(amt)}`, !ready, submitPayment);
}

async function submitPayment() {
  const amt = preview();
  if (!pay.method || amt <= 0) return;
  const btn = $('#payBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const out = await api(`/api/tables/${encodeURIComponent(table.id)}/payments`, {
      method: 'POST',
      body: { mode: pay.mode, parts: pay.parts, shares: pay.shares, lines: [...pay.lines], method: pay.method, name: pay.name },
    });
    storage.set(myPayKey(), [...myPayments(), out.payment.id].slice(-20));
    storage.set('qm:name', pay.name);
    bill = out.bill; billSig = JSON.stringify(bill);
    pay.lines.clear();
    pay.more = false; pay.method = ''; pay.mode = 'full';
    $('#pbBody').scrollTop = 0;
    renderDockBill(); renderBillSheet();
    toast(out.payment.method === 'upi' ? 'Payment noted — finish in your UPI app' : 'Your server is on the way', { ms: 3500 });
    if (out.payment.method === 'upi' && bill.upi && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      location.href = upiLink(out.payment.amount); // opens the guest's UPI app with the amount filled in
    }
  } catch (e) {
    toast(e.message, { error: true, ms: 4500 });
    await refreshBill(); renderBillSheet();
  }
}

function wireBill() {
  $('#billBtn').addEventListener('click', openBill);
  $('#trackToBill').addEventListener('click', openBill);
  const body = $('#pbBody');
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { pay.more = true; pay.mode = 'full'; renderBillSheet(); return; }
    const mode = e.target.closest('[data-mode]');
    if (mode) { pay.mode = mode.dataset.mode; renderBillSheet(); return; }
    const m = e.target.closest('[data-method]');
    if (m) {
      pay.method = m.dataset.method;
      $$('[data-method]', body).forEach((b) => b.setAttribute('aria-checked', String(b === m)));
      updatePayButton();
      return;
    }
    const st = e.target.closest('[data-stepper] [data-d]');
    if (st) {
      const which = st.closest('[data-stepper]').dataset.stepper;
      if (which === 'parts') { pay.parts = Math.max(2, Math.min(30, pay.parts + Number(st.dataset.d))); pay.shares = Math.min(pay.shares, pay.parts); }
      else pay.shares = Math.max(1, Math.min(pay.parts, pay.shares + Number(st.dataset.d)));
      renderBillSheet();
    }
  });
  body.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox][data-line]');
    if (!cb) return;
    if (cb.checked) pay.lines.add(cb.dataset.line); else pay.lines.delete(cb.dataset.line);
    updatePayButton();
  });
  body.addEventListener('input', (e) => { if (e.target.id === 'pbName') pay.name = e.target.value.slice(0, 40); });
}

// ============================================================ interactions
function wireUi() {
  $('#custName').value = pay.name;

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
    if (cat) { goToCategory(cat.dataset.cat); return; }
    const line = t.closest('#cartLines [data-line]');
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
    if (e.key === 'Escape') { closeSheets(); toggleCall(false); }
    if (e.key === 'Enter' && e.target.matches?.('.item, .pick')) openItem(e.target.dataset.open);
  });

  // search & filters (debounced)
  let st;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(st);
    st = setTimeout(() => { filters.q = e.target.value.trim().toLowerCase(); renderSections(); }, 150);
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

  // item sheet
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
    toast(`${sheetItem.name} added to your order`);
    closeSheets();
  });

  // cart
  $('#cartbar').addEventListener('click', async () => {
    if (!table) {
      $('#tablePickWrap').classList.remove('hidden');
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
  $('#custName').addEventListener('input', (e) => { pay.name = e.target.value.slice(0, 40); });

  $('#ordersBtn').addEventListener('click', () => openTracker());
  $('#themeBtn').addEventListener('click', () => {
    const now = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = now;
    storage.set('qm:theme', now);
    document.querySelector('meta[name="theme-color"]').content = now === 'light' ? '#F7F3EA' : '#14110F';
  });

  // call staff
  $('#fab').addEventListener('click', (e) => { e.stopPropagation(); toggleCall(); });
  $('#fabMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-call]');
    if (!b) return;
    e.stopPropagation();
    toggleCall(false);
    callStaff(b.dataset.call);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.call-wrap')) toggleCall(false); });

  wireBill();
}

async function callStaff(reason) {
  if (!table) { toast('Scan the QR on your table to call our staff.', { error: true }); return; }
  try {
    await api('/api/calls', { method: 'POST', body: { table: table.id, reason } });
    toast('Our team has been notified — someone will be right with you.', { ms: 3500 });
  } catch (err) { toast(err.message, { error: true }); }
}

function toggleCall(force) {
  const m = $('#fabMenu');
  const open = force === undefined ? !m.classList.contains('open') : force;
  m.classList.toggle('open', open);
  $('#fab').setAttribute('aria-expanded', String(open));
}

// ============================================================ category navigation + scroll-spy
// Root cause of the old scroll lag: the spy called tab.scrollIntoView({behavior:'smooth'})
// while the guest was scrolling, which also animates the PAGE and fights momentum scrolling.
// Now only the tab strip scrolls (horizontally), and only when the active category changes.
const toolbarH = () => $('#toolbar').getBoundingClientRect().height;
function goToCategory(id) {
  const sec = document.getElementById(`cat-${id}`);
  if (!sec) return;
  const y = sec.getBoundingClientRect().top + window.scrollY - toolbarH() - 6;
  window.scrollTo({ top: y, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  setActiveCat(id);
}
let activeCat = '';
function setActiveCat(id) {
  if (id === activeCat) return;
  activeCat = id;
  const strip = $('#cats');
  let btn = null;
  for (const c of strip.children) { const on = c.dataset.cat === id; c.classList.toggle('active', on); if (on) btn = c; }
  if (btn) strip.scrollTo({ left: btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' });
}
let spy;
function setupScrollSpy() {
  if (spy) spy.disconnect();
  if (!('IntersectionObserver' in window)) return;
  const visible = new Map();
  spy = new IntersectionObserver((entries) => {
    for (const en of entries) visible.set(en.target.dataset.cat, en.isIntersecting ? en.boundingClientRect.top : null);
    let best = null; let bestTop = Infinity;
    for (const [id, top] of visible) if (top !== null && top < bestTop) { best = id; bestTop = top; }
    if (best) setActiveCat(best);
  }, { rootMargin: '-160px 0px -55% 0px' });
  $$('.cat-sec').forEach((s) => spy.observe(s));
}

// ============================================================ small delight
function confetti() {
  if (prefersReducedMotion()) return;
  const colors = ['#F4A51C', '#FFD27A', '#14110F', '#F7F3EA'];
  for (let k = 0; k < 26; k++) {
    const s = document.createElement('span');
    const ang = Math.random() * Math.PI * 2;
    const dist = 110 + Math.random() * 170;
    Object.assign(s.style, {
      position: 'fixed', left: '50%', top: '72%', zIndex: 999, pointerEvents: 'none', width: `${6 + Math.random() * 7}px`, height: `${3 + Math.random() * 4}px`,
      background: colors[k % colors.length], borderRadius: '1px', transition: 'transform 1.1s cubic-bezier(.2,.8,.2,1), opacity 1.1s',
    });
    document.body.appendChild(s);
    requestAnimationFrame(() => { s.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist - 150}px) rotate(${Math.random() * 360}deg)`; s.style.opacity = '0'; });
    setTimeout(() => s.remove(), 1200);
  }
}

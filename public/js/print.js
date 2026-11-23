import { $, $$, esc, api, toast, tenantSlug, tenantApi } from './common.js';

const params = new URLSearchParams(location.search);
const SLUG = tenantSlug();
const API = tenantApi(SLUG);
let style = ['standee', 'tent', 'card'].includes(params.get('style')) ? params.get('style') : 'standee';
const PER_PAGE = { standee: 4, tent: 2, card: 9 };

let restaurant = {};
let tables = [];

function cardHtml(t) {
  const r = restaurant;
  const qr = `<div class="qrbox"><img src="${API}/qr/${encodeURIComponent(t.id)}?margin=0" alt="QR code for ${esc(t.label)}"><span class="badge" aria-hidden="true"></span></div>`;
  const brand = `<div class="brand">${esc(r.name).replace(/&amp;/, '<span class="amp">&amp;</span>')}</div><div class="tag">Digital menu</div>`;
  const scan = `<div class="scan">Scan to see the menu &amp; order</div><div class="steps"><span>1 · Scan</span><span>2 · Browse</span><span>3 · Order</span></div>`;
  const tbl = `<div class="table"><small>You are at</small>${esc(t.label)}</div>`;
  const wifi = r.wifi ? `<div class="wifi">Wi-Fi: ${esc(r.wifi)} · No app needed</div>` : '<div class="wifi">No app needed — just your camera</div>';
  if (style === 'tent') return `<div class="qc"><div class="col">${brand}${scan}${tbl}</div>${qr}${wifi}</div>`;
  return `<div class="qc">${brand}${qr}${scan}${tbl}${wifi}</div>`;
}

function render() {
  document.body.className = `style-${style}${$('#view3d').checked ? ' view3d' : ''}`;
  $$('.seg [data-style]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === style)));
  const per = PER_PAGE[style];
  const pages = [];
  for (let k = 0; k < tables.length; k += per) pages.push(tables.slice(k, k + per));
  $('#sheets').innerHTML = pages.map((group) => {
    const inner = style === 'tent'
      ? group.map((t) => `<div class="tent">${cardHtml(t)}${cardHtml(t)}</div>`).join('')
      : group.map(cardHtml).join('');
    return `<section class="page">${inner}</section>`;
  }).join('') || '<p class="muted" style="text-align:center">No tables selected.</p>';
  const u = new URL(location.href);
  u.searchParams.set('style', style);
  history.replaceState(null, '', u);
}

async function init() {
  try {
    const [menu, all] = await Promise.all([api(`${API}/menu`), api(`${API}/tables`)]);
    restaurant = menu.restaurant;
    const want = (params.get('tables') || '').split(',').map((s) => s.trim()).filter(Boolean);
    tables = want.length ? all.filter((t) => want.includes(t.id)) : all;
    document.title = `Print — ${restaurant.name}`;
    render();
  } catch (e) { toast(e.message, { error: true }); }
}

$$('.seg [data-style]').forEach((b) => b.addEventListener('click', () => { style = b.dataset.style; render(); }));
$('#view3d').addEventListener('change', render);
$('#printBtn').addEventListener('click', () => window.print());
$('#backLink').href = `/r/${SLUG}/admin#tables`;
if (SLUG) init();
else api('/api/default-tenant').then((t) => location.replace(`/r/${t.slug}/print${location.search}`)).catch((e) => toast(e.message, { error: true }));

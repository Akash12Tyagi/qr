// A restaurant's home page: /r/<slug>. Shows the restaurant's own QR code (it opens the
// menu on a phone), favourites, menu chapters and visit details.
import { $, esc, api, fmtMoney, tenantSlug, tenantApi, thumbOf } from './common.js';

const SLUG = tenantSlug();
const API = tenantApi(SLUG);
// Links into the menu always say where they came from (a bare menu link redirects here).
const menuUrl = (q = '?src=home') => `/r/${SLUG}/menu${q}`;

init().catch((e) => {
  document.querySelector('main').hidden = true;
  document.querySelector('.h-nav').hidden = true;
  $('#dockMenu').hidden = true;
  $('#error').hidden = false;
  $('#errorMsg').textContent = e.message;
});

async function init() {
  if (!SLUG) { location.replace('/'); return; }
  const m = await api(`${API}/menu`);
  const r = m.restaurant;
  const money = (n) => fmtMoney(n, r.currency);
  const nameHtml = esc(r.name).replace(/&amp;/, '<span class="amp">&amp;</span>');

  document.title = `${r.name}${r.tagline ? ` · ${r.tagline}` : ''}`;
  for (const id of ['navName', 'footName']) $(`#${id}`).innerHTML = nameHtml;
  $('#title').innerHTML = nameHtml;
  $('#visitName').textContent = r.name;
  $('#tagline').textContent = r.tagline || 'Scan, order and pay from your table.';
  for (const id of ['navMenu', 'heroMenu', 'footMenu', 'dockMenu']) $(`#${id}`).href = menuUrl();

  const meta = [];
  if (r.hours) meta.push(`<span class="h-chip"><i class="dot${openNow(r.hours) ? ' on' : ''}"></i>${esc(r.hours)}</span>`);
  meta.push(`<span class="h-chip">${m.items.filter((i) => i.available !== false).length} dishes</span>`);
  if (m.items.some((i) => i.veg)) meta.push('<span class="h-chip"><i class="veg"></i>Vegetarian options</span>');
  $('#meta').innerHTML = meta.join('');

  // The restaurant's own QR: always the server's address for this restaurant's menu.
  const absolute = `${location.origin}/r/${SLUG}/menu`;
  $('#qr').src = `${API}/qr?margin=1&dark=%2314110F`;
  $('#qrUrl').href = menuUrl('?src=qr');
  $('#qrUrl').textContent = absolute.replace(/^https?:\/\//, '');

  // favourites: chef's picks with photos first
  const picks = [...m.items.filter((i) => i.available !== false && i.popular), ...m.items.filter((i) => i.available !== false && !i.popular)]
    .filter((i) => i.image).slice(0, 6);
  if (picks.length) {
    $('#picks').hidden = false;
    $('#pickList').innerHTML = picks.map((i) => `
      <a class="h-pick" href="${menuUrl(`?ch=${encodeURIComponent(i.category)}`)}">
        <span class="ph"><img src="${esc(i.image.startsWith('/img/dishes/') ? i.image.replace(/\.jpg$/, '-md.jpg') : i.image)}" alt="" loading="lazy" decoding="async" width="480" height="600" data-fallback></span>
        <span class="nm">${esc(i.name)}</span>
        <span class="pr">${esc(money(i.price))}${i.veg ? ' · Veg' : ''}</span>
      </a>`).join('');
  }

  // menu chapters
  const cats = m.categories.map((c) => ({ ...c, items: m.items.filter((i) => i.category === c.id && i.available !== false) })).filter((c) => c.items.length);
  if (cats.length) {
    $('#menu').hidden = false;
    $('#catList').innerHTML = cats.map((c) => {
      const cover = c.items.find((i) => i.image);
      return `<a class="h-cat" href="${menuUrl(`?ch=${encodeURIComponent(c.id)}`)}">
        ${cover ? `<img src="${esc(thumbOf(cover.image))}" alt="" loading="lazy" width="64" height="64" data-fallback>` : '<span class="ph0"></span>'}
        <span><b>${esc(c.name)}</b><small>${c.items.length} dish${c.items.length === 1 ? '' : 'es'} · from ${esc(money(Math.min(...c.items.map((i) => i.price))))}</small></span>
        <span class="arr" aria-hidden="true">→</span></a>`;
    }).join('');
  }

  const facts = [];
  if (r.hours) facts.push(['Open', esc(r.hours)]);
  if (r.wifi) facts.push(['Guest Wi-Fi', esc(r.wifi)]);
  facts.push(['Ordering', 'Scan the QR code on your table — no app needed']);
  facts.push(['Paying', `UPI, card or cash${Number(r.taxRate) ? ` · GST ${esc(r.taxRate)}% included in your bill` : ''}`]);
  $('#facts').innerHTML = facts.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`).join('');
}

// "12:00 – 23:30" → is it open right now (local time)? Unknown formats → false.
function openNow(hours) {
  const t = String(hours).match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!t) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const a = +t[1] * 60 + +t[2];
  const b = +t[3] * 60 + +t[4];
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
}

import { $, $$, api, esc, fmtMoney, webglAvailable, prefersReducedMotion } from './common.js';
import { posterUrl } from './dishart.js';

const reduced = prefersReducedMotion();
const section = $('#gallery');
let gallery = null;
let menu = null;
let step = 1;           // scroll px per exhibit
let count = 0;

$('#demoQr').src = '/api/qr/T1?margin=1';
if (/localhost|127\.0\.0\.1/.test(location.hostname)) {
  $('#lanHint').textContent = 'You’re on localhost — open this page via your computer’s network address so a phone can reach it.';
}

init().catch((e) => { console.warn(e); fallback(); });

async function init() {
  menu = await api('/api/menu');
  const r = menu.restaurant;
  const initials = r.name.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  const mark = initials.length > 1 ? `${initials[0][0]}&${initials[initials.length - 1][0]}` : r.name.slice(0, 2);
  $('#brandName').textContent = r.name;
  $('#brandMark').textContent = mark;
  $('#bookMono').textContent = mark;
  $('#bookTitle').textContent = r.name;
  $('#footName').textContent = `${r.name} · ${r.hours || ''}`;
  document.title = `${r.name} · The Menu`;

  if (!webglAvailable()) { fallback(); return; }
  const { mountGallery } = await import('./gallery3d.js');
  gallery = await mountGallery($('#gCanvas'), {
    menu,
    reduced,
    money: (n) => fmtMoney(n, r.currency),
    onCaption: caption,
    onHover: hover,
    onFocus: showDetail,
    onBlur: hideDetail,
    onChapter: (cat) => { location.href = chapterUrl(cat.id); },
  });
  count = gallery.count;
  sizeSection();
  onScroll();
  wire();
}

const chapterUrl = (id) => `/menu?t=T1&ch=${encodeURIComponent(id)}`;

// ---------------------------------------------------------------- scroll → walk
function sizeSection() {
  const vh = window.innerHeight;
  step = Math.round(vh * (window.innerWidth < 640 ? 0.5 : 0.42));
  section.style.height = `${(count - 1) * step + vh}px`;
}
function walkProgress() { return (window.scrollY - section.offsetTop) / step; }
function onScroll() {
  if (!gallery) return;
  const u = Math.max(0, Math.min(count - 1, walkProgress()));
  gallery.setProgress(u);
  $('#gIntro').classList.toggle('gone', u > 0.35);
  $('#gCaption').classList.toggle('waiting', u < 0.35);
  $('#gBar').style.transform = `scaleX(${(u / Math.max(1, count - 1)).toFixed(4)})`;
  $('#gPrev').disabled = u < 0.5;
  $('#gNext').disabled = u > count - 1.5;
  if (gallery.focused && Math.abs(u - focusAt) > 0.35) gallery.blur();
}
function goExhibit(k) {
  const kk = Math.max(0, Math.min(count - 1, Math.round(k)));
  window.scrollTo({ top: section.offsetTop + kk * step, behavior: reduced ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------- overlays
let lastChapter = null;
function caption(ex) {
  const title = $('#gTitle');
  if (ex.cat.id === lastChapter) return;
  lastChapter = ex.cat.id;
  title.classList.add('swap');
  setTimeout(() => {
    title.textContent = ex.cat.name;
    $('#gEnter').href = chapterUrl(ex.cat.id);
    title.classList.remove('swap');
  }, reduced ? 0 : 180);
}

const cursor = $('#gCursor');
function hover(ex, x, y) {
  if (!ex) { cursor.classList.remove('on'); return; }
  cursor.textContent = ex.kind === 'chapter' ? 'Open the chapter' : 'Look closer';
  cursor.style.transform = `translate(${x + 18}px, ${y + 14}px)`;
  cursor.classList.add('on');
}

let focusAt = 0;
function showDetail(ex) {
  focusAt = walkProgress();
  const it = ex.item;
  const cur = menu.restaurant.currency;
  $('#dKicker').textContent = `Plate Nº ${String(ex.n).padStart(2, '0')} · ${ex.cat.name}`;
  $('#dName').textContent = it.name;
  $('#dPrice').textContent = fmtMoney(it.price, cur);
  $('#dDesc').textContent = it.desc || '';
  const facts = [it.veg ? 'Vegetarian' : 'Non-veg'];
  if (it.spice) facts.push(`${['', 'Mild', 'Medium', 'Hot'][it.spice]} spice`);
  if (it.prep) facts.push(`${it.prep} min`);
  if (it.kcal) facts.push(`${it.kcal} kcal`);
  if (window.innerWidth >= 640) (it.tags || []).slice(0, 2).forEach((t) => facts.push(t));
  if (it.available === false) facts.unshift('Sold out tonight');
  $('#dFacts').innerHTML = facts.map((f) => `<li>${esc(f)}</li>`).join('');
  $('#dOpen').href = chapterUrl(ex.cat.id);
  const d = $('#gDetail');
  $('.g-stage').classList.add('focused');
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  $('#gCaption').classList.add('hidden');
  $('#gHint1').textContent = 'Esc or click away';
  $('#gHint2').textContent = 'to step back';
  setTimeout(() => $('#dBack').focus({ preventScroll: true }), 300);
}
function hideDetail() {
  const d = $('#gDetail');
  $('.g-stage').classList.remove('focused');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  $('#gCaption').classList.remove('hidden');
  $('#gHint1').textContent = 'Scroll or drag to walk round';
  $('#gHint2').textContent = 'Click a plate to look closer';
}

// ---------------------------------------------------------------- input
function wire() {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { const u = walkProgress(); sizeSection(); window.scrollTo(0, section.offsetTop + u * step); onScroll(); });
  $('#gNext').addEventListener('click', () => goExhibit(walkProgress() + 1));
  $('#gPrev').addEventListener('click', () => goExhibit(walkProgress() - 1));
  $('#startWalk').addEventListener('click', () => goExhibit(1));
  $('#dBack').addEventListener('click', () => gallery.blur());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gallery.focused) { gallery.blur(); return; }
    const r = section.getBoundingClientRect();
    if (r.top > 10 || r.bottom < window.innerHeight - 10) return; // only while the gallery is pinned
    if (e.key === 'ArrowRight') { e.preventDefault(); goExhibit(walkProgress() + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goExhibit(walkProgress() - 1); }
  });

  // Drag (mouse or horizontal swipe) to walk: a quarter of the screen ≈ one exhibit.
  const canvas = $('#gCanvas canvas');
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, sy: window.scrollY, h: null }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (drag.h === null && Math.hypot(dx, dy) > 6) drag.h = Math.abs(dx) > Math.abs(dy);
    if (drag.h) window.scrollTo(0, drag.sy - dx * (step / (window.innerWidth * 0.25)));
  });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointercancel', () => { drag = null; });
}

// ---------------------------------------------------------------- no-WebGL fallback: a quiet strip of prints
function fallback() {
  document.documentElement.classList.add('no-webgl');
  const fb = $('#gFallback');
  fb.hidden = false;
  if (menu) {
    fb.innerHTML = menu.items.slice(0, 12).map((it) => `<figure><img src="${posterUrl(it, 360, 450)}" alt=""><figcaption>${esc(it.name)}</figcaption></figure>`).join('');
  }
  $('#gCaption').classList.add('hidden');
  document.querySelector('.g-controls').hidden = true;
}

// ---------------------------------------------------------------- section reveals
if ('IntersectionObserver' in window && !reduced) {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.15 });
  $$('.sec .copy, .sec-head, .steps li, .qr-card, .book-demo').forEach((el, i) => { el.classList.add('reveal'); el.style.transitionDelay = `${(i % 4) * 90}ms`; io.observe(el); });
}
// open the CSS book when it scrolls into view on touch devices (no hover)
if ('IntersectionObserver' in window && matchMedia('(hover: none)').matches) {
  new IntersectionObserver(([en]) => $('.b3d').classList.toggle('open', en.isIntersecting), { threshold: 0.6 }).observe($('.book-demo'));
}

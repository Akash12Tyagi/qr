// The Menu Book — a scroll-driven, page-turning menu.
//
// Structure: a stack of "leaves" hinged on the spine. Each leaf has a FRONT (a right-hand
// page) and a BACK (the left-hand page you see after turning it). back(i) always
// illustrates front(i+1), so every spread reads as [framed plate print | menu page].
//
// Navigation works in STOPS:
//   • desktop / tablet: one stop per spread (the whole spread is on screen)
//   • phone: two stops per spread — the camera follows a turning page to the LEFT page,
//     then glides across to the RIGHT page. Going back reveals the left page again.
// The document scrolls a tall invisible track (one viewport-ish per stop, with scroll-snap);
// the book itself lives in a fixed full-screen stage.

import { esc } from './common.js';
import { posterUrl, platedUrl } from './dishart.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const PER_PAGE = 4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: soft lift, soft set-down
const lerp = (a, b, t) => a + (b - a) * t;
const roman = (i) => ROMAN[i] || String(i + 1);

const CHILI = '<svg class="chili-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3.5c.8.6 1 1.6.6 2.4 2.3.7 3.9 2.9 3.4 5.6-.8 4.6-6.4 9-12.5 9-1.6 0-3-.6-3.5-1.4-.3-.6.1-1.2.8-1.3 4.9-.7 8.3-4 9.5-7.4.3-.9.1-1.8-.4-2.4.6-.9 1.6-1.4 2.6-1.2.1-.9-.2-1.8-.9-2.4l.4-.9z"/></svg>';
const chilies = (n) => (n ? `<span class="chili" role="img" aria-label="Spice ${n} of 3">${CHILI.repeat(n)}</span>` : '');

function initials(name) {
  const words = String(name).replace(/&/g, ' ').split(/\s+/).filter((w) => /^[\p{L}]/u.test(w));
  return (words.length > 1 ? `${words[0][0]}&${words[words.length - 1][0]}` : (words[0] || 'M').slice(0, 2)).toUpperCase();
}

export function createBook(opts) {
  const { root, reduced } = opts;
  const host = opts.host || root; // receives state classes + size variables
  let menu = opts.menu;
  let pages = [];
  let leaves = [];
  let step = 0;            // scroll px per stop
  let target = 0;          // stop progress from scroll
  let s = 0;               // smoothed stop progress
  let raf = 0;
  let active = false;
  let single = false;
  let lastW = 0;
  let lastH = 0;
  let reserveBottom = 0;   // extra space for the cart bar
  let tiltAmt = 1;         // pointer-parallax strength (cover only)
  let lastReport = '';

  root.innerHTML = `
    <div class="bk-track" id="bkTrack"></div>
    <div class="bk-stage" id="bkStage">
      <canvas class="bk-dust" aria-hidden="true"></canvas>
      <div class="bk-grain" aria-hidden="true"></div>
      <div class="bk-scene">
        <div class="bk-rise">
          <div class="bk-tilt">
            <div class="bk-shadow" aria-hidden="true"></div>
            <div class="book" id="book" aria-roledescription="menu book"><i class="ribbon" aria-hidden="true"></i></div>
          </div>
        </div>
      </div>
      <div class="bk-progress" aria-hidden="true"><i id="bkBar"></i></div>
    </div>
    <div class="bk-titlecard" id="bkTitle" aria-hidden="true"></div>`;

  const track = root.querySelector('#bkTrack');
  const stage = root.querySelector('#bkStage');
  const bookEl = root.querySelector('#book');
  const tilt = root.querySelector('.bk-tilt');
  const bar = root.querySelector('#bkBar');

  // ------------------------------------------------------------------ pages
  function paginate() {
    const chapters = menu.categories
      .map((c) => ({ ...c, items: menu.items.filter((i) => i.category === c.id) }))
      .filter((c) => c.items.length);
    const out = [{ kind: 'cover' }, { kind: 'contents', chapters: [] }];
    chapters.forEach((c, ci) => {
      for (let k = 0; k < c.items.length; k += PER_PAGE) {
        out.push({ kind: 'menu', chapter: c, ci, first: k === 0, items: c.items.slice(k, k + PER_PAGE) });
      }
    });
    out.push({ kind: 'end' });
    out[1].chapters = chapters.map((c, ci) => ({ ...c, ci, leaf: out.findIndex((pg) => pg.kind === 'menu' && pg.ci === ci) }));
    return out;
  }

  const folio = (i) => (i <= 0 ? '' : `<div class="pg-folio">— ${i} —</div>`);
  const ornament = '<div class="pg-folio" aria-hidden="true">❦</div>';
  const head = (left, right) => `<header class="pg-head"><span>${left}</span><span>${right}</span></header>`;
  const featured = (items) => items.find((i) => i.popular && i.available !== false) || items.find((i) => i.available !== false) || items[0];

  function plate(item, n) {
    const art = item.image
      ? `<img class="print-img" src="${esc(item.image)}" alt="" loading="lazy">`
      : `<img class="print-img" src="${posterUrl(item)}" alt="" loading="lazy">`;
    return `<figure class="print">
      <button class="print-frame" data-open="${esc(item.id)}" aria-label="Look closer at ${esc(item.name)}"><div class="print-mat">${art}</div></button>
      <figcaption><span class="mono">Plate Nº ${String(n).padStart(2, '0')}</span><em>${esc(item.name)}</em></figcaption>
    </figure>`;
  }

  // Sparse pages get a printer's tailpiece: a fleuron and a pairing suggestion.
  function tailpiece(pg) {
    const drinks = menu.categories.find((c) => /drink|bev|bar|cocktail|tea|coffee/i.test(`${c.id} ${c.name}`));
    const pool = menu.items.filter((it) => it.available !== false && it.category !== pg.chapter.id && (!drinks || it.category === drinks.id));
    const pair = pool.find((it) => it.popular) || pool[0];
    return `<aside class="tailpiece">
      <div class="fleuron" aria-hidden="true">❦</div>
      ${pair ? `<p class="kicker">Chef’s pairing</p>
      <button class="pairing" data-open="${esc(pair.id)}"><em>${esc(pair.name)}</em><span>${esc(opts.money(pair.price))}</span></button>
      <p class="pair-note">${esc(pair.desc || '')}</p>` : ''}
    </aside>`;
  }

  function row(it) {
    const cur = opts.cur();
    const thumb = it.image ? esc(it.image) : platedUrl(it, 160);
    return `<article class="bk-row${it.available === false ? ' sold' : ''}" data-open="${esc(it.id)}" tabindex="0" aria-label="${esc(it.name)}, ${esc(cur)}${esc(it.price)}">
      <img class="bk-thumb" src="${thumb}" alt="" loading="lazy">
      <div class="bk-main">
        <div class="bk-line"><span class="bk-name">${esc(it.name)}</span><span class="dots"></span><span class="bk-price">${esc(opts.money(it.price))}</span></div>
        <p class="bk-desc">${esc(it.desc || '')}</p>
        <div class="bk-meta">
          ${opts.dietIcon(it.veg)}
          ${it.popular ? '<span class="bk-pick">Chef’s pick</span>' : ''}
          ${chilies(it.spice)}
          ${it.prep ? `<span class="mono">${esc(it.prep)} min</span>` : ''}
          <span class="bk-ctl" data-ctl="${esc(it.id)}">${opts.itemControl(it)}</span>
        </div>
      </div>
      ${it.available === false ? '<span class="stamp" aria-hidden="true">Sold out</span>' : ''}
    </article>`;
  }

  function frontHtml(pg, i) {
    const r = menu.restaurant;
    if (pg.kind === 'cover') {
      return `<div class="pg cover">
        <div class="cv-inner">
          <div class="cv-mono"><span>${esc(initials(r.name))}</span></div>
          <div class="cv-kicker">Carte du jour</div>
          <h1 class="cv-title foil">${esc(r.name)}</h1>
          <div class="cv-rule"><i></i><b>✦</b><i></i></div>
          <p class="cv-tag">${esc(r.tagline || '')}</p>
          <div class="cv-foot">${opts.table ? esc(opts.table.label) : 'Our menu'}${r.hours ? ` · ${esc(r.hours)}` : ''}</div>
        </div>
        <div class="cv-spine" aria-hidden="true"></div>
      </div>`;
    }
    if (pg.kind === 'contents') {
      return `<div class="pg paper">
        ${head(esc(r.name), 'Contents')}
        <div class="pg-body">
          <p class="kicker">Tonight’s menu</p>
          <h2 class="pg-title">Contents</h2>
          <ol class="toc">${pg.chapters.map((c) => `
            <li><button data-goto="${c.leaf}"><span class="toc-n">${roman(c.ci)}</span><span class="toc-name">${esc(c.name)}</span><span class="dots"></span><span class="toc-p">${c.leaf}</span></button></li>`).join('')}
          </ol>
          <div class="legend">
            <span>${opts.dietIcon(true)} Vegetarian</span><span>${opts.dietIcon(false)} Non-veg</span><span>${CHILI} Spice</span><span class="bk-pick">Chef’s pick</span>
          </div>
          <p class="howto"><b>How to order.</b> Tap any dish to see it plated in 3D, add it to your order, then send it straight to our kitchen.</p>
        </div>
        ${folio(i)}
      </div>`;
    }
    if (pg.kind === 'menu') {
      const c = pg.chapter;
      return `<div class="pg paper">
        ${head(`${roman(pg.ci)} · ${esc(c.name)}`, esc(r.name))}
        <div class="pg-body">
          ${pg.first ? `<p class="kicker">Chapter ${roman(pg.ci)}</p><h2 class="pg-title">${esc(c.name)}</h2>` : `<p class="kicker">${esc(c.name)} · continued</p>`}
          <div class="rows">${pg.items.map(row).join('')}</div>
          ${pg.items.length <= 2 ? tailpiece(pg) : ''}
        </div>
        ${folio(i)}
      </div>`;
    }
    const tax = [];
    if (r.taxRate) tax.push(`${esc(r.taxRate)}% GST`);
    if (r.serviceCharge) tax.push(`${esc(r.serviceCharge)}% service`);
    return `<div class="pg paper end">
      ${head(esc(r.name), 'Fin.')}
      <div class="pg-body center">
        <p class="kicker">Thank you</p>
        <h2 class="pg-title big">Fin.</h2>
        <p class="endnote">We hope something here made you hungry. Your order goes straight to our kitchen — we’ll bring it to ${opts.table ? esc(opts.table.label) : 'your table'}.</p>
        <div class="end-actions">
          <button class="ink-btn solid" data-act="cart">Review my order</button>
          ${opts.table ? '<button class="ink-btn" data-act="waiter">Call the waiter</button>' : ''}
          <button class="ink-btn ghost" data-goto="1">Back to contents</button>
        </div>
        <p class="fine">${tax.length ? `${tax.join(' + ')} added at checkout.` : 'No extra charges.'}${r.wifi ? ` Wi-Fi · ${esc(r.wifi)}` : ''}</p>
      </div>
      ${folio(i)}
    </div>`;
  }

  function backHtml(i) {
    const r = menu.restaurant;
    const next = pages[i + 1];
    if (i === 0) {
      return `<div class="pg endpaper">
        <div class="bookplate">
          <p class="mono">Ex libris</p>
          <div class="bp-mono">${esc(initials(r.name))}</div>
          <p class="bp-line">This menu belongs to</p>
          <p class="bp-table">${opts.table ? esc(opts.table.label) : 'our guests'}</p>
          <p class="bp-small">Please turn the pages gently.</p>
        </div>
      </div>`;
    }
    if (!next) return '<div class="pg paper"></div>';
    if (next.kind === 'menu') {
      const it = featured(next.items);
      const n = menu.items.indexOf(it) + 1;
      if (next.first) {
        return `<div class="pg paper opener">
          ${head(esc(r.name), `Chapter ${roman(next.ci)}`)}
          <div class="pg-body center">
            <div class="roman">${roman(next.ci)}</div>
            <h3 class="op-title">${esc(next.chapter.name)}</h3>
            ${plate(it, n)}
          </div>
          ${ornament}
        </div>`;
      }
      return `<div class="pg paper opener">
        ${head(esc(next.chapter.name), esc(r.name))}
        <div class="pg-body center">
          ${plate(it, n)}
          <blockquote>“${esc(it.desc || it.name)}”</blockquote>
        </div>
        ${ornament}
      </div>`;
    }
    return `<div class="pg paper opener">
      ${head(esc(r.name), 'From the kitchen')}
      <div class="pg-body center">
        <p class="kicker">A note from the kitchen</p>
        <p class="letter">Everything on these pages is cooked to order over oak and charcoal. Tell us about allergies, spice tolerance or a celebration — we love a reason to make something special.</p>
        <p class="sign">— The Chef</p>
      </div>
    </div>`;
  }

  function build() {
    pages = paginate();
    bookEl.querySelectorAll('.leaf').forEach((l) => l.remove());
    bookEl.insertAdjacentHTML('beforeend', pages.map((pg, i) => `
      <section class="leaf${i === 0 ? ' is-cover' : ''}" data-leaf="${i}">
        <div class="face front">${frontHtml(pg, i)}<i class="shade" aria-hidden="true"></i></div>
        <div class="face back">${i < pages.length - 1 ? backHtml(i) : ''}<i class="shade" aria-hidden="true"></i></div>
      </section>`).join(''));
    leaves = [...bookEl.querySelectorAll('.leaf')];
    lastReport = '';
    layout(true);
    paint(s);
  }

  // ------------------------------------------------------------------ stops ⇄ pages
  const turns = () => Math.max(1, pages.length - 1);
  const maxStop = () => (single ? turns() * 2 : turns());
  const stopForPage = (i) => (single ? i * 2 : i);

  // Map stop progress → page-turn progress + horizontal pan (in page widths).
  function spread(st) {
    if (!single) {
      const open = smooth(clamp(st, 0, 1));
      return { prog: st, shift: -0.5 * (1 - open) };
    }
    const seg = Math.min(Math.floor(st), maxStop() - 1);
    const f = clamp(st - seg, 0, 1);
    const e = smooth(f);
    if (seg % 2 === 0) return { prog: seg / 2 + f, shift: lerp(-0.5, 0.5, e) };   // turning; camera follows the page left
    return { prog: (seg + 1) / 2, shift: lerp(0.5, -0.5, e) };                      // glide to the right-hand page
  }

  // What is the reader looking at? (for the caption + accessibility)
  function viewing(st) {
    const k = Math.round(st);
    if (!single) return { page: k, side: k === 0 ? 'cover' : 'spread', leaf: k };
    if (k % 2 === 0) return { page: k / 2, side: k === 0 ? 'cover' : 'right', leaf: k / 2 };
    return { page: (k + 1) / 2, side: 'left', leaf: (k - 1) / 2 };
  }

  // ------------------------------------------------------------------ layout
  function layout(force) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!force && Math.abs(W - lastW) < 2 && Math.abs(H - lastH) < 140) return; // ignore mobile URL-bar jiggle
    const wasSingle = single;
    const keepPage = viewing(target).page;
    lastW = W; lastH = H;
    single = W < 900;
    const top = single ? 60 : 76;
    const bottom = (single ? 92 : 96) + reserveBottom;
    const availH = Math.max(260, H - top - bottom);
    let pw = single ? Math.min(W * 0.88, availH / 1.42, 520) : Math.min((W * 0.84) / 2, availH / 1.42, 560);
    pw = Math.max(220, Math.floor(pw));
    host.style.setProperty('--pw', `${pw}px`);
    host.style.setProperty('--ph', `${Math.floor(pw * 1.42)}px`);
    host.style.setProperty('--bk-offset', `${(top - bottom) / 2}px`);
    host.classList.toggle('single', single);
    step = Math.round(H * (single ? 0.62 : 0.8));
    const n = maxStop();
    track.style.height = `${n * step + H}px`;
    track.innerHTML = Array.from({ length: n + 1 }, (_, k) => `<i class="snap" style="top:${k * step}px"></i>`).join('');
    if (active) {
      if (wasSingle !== single) { const st = stopForPage(keepPage); window.scrollTo(0, st * step); target = s = st; }
      else { target = clamp(window.scrollY / step, 0, n); s = target; }
      paint(s);
    }
  }

  // ------------------------------------------------------------------ render
  function paint(st) {
    const n = leaves.length;
    const { prog, shift } = spread(st);
    const view = viewing(st);
    for (let i = 0; i < n; i++) {
      const leaf = leaves[i];
      let t = i < n - 1 ? clamp(prog - i, 0, 1) : 0;
      if (t > 0.996) t = 1; else if (t < 0.004) t = 0; // settle cleanly at rest
      const e = smooth(t);
      const ang = -180 * e;
      const lift = Math.sin(Math.PI * e);
      // Only the page in motion leaves the stack; resting pages stay at z=0 so type stays crisp.
      const depth = t > 0 && t < 1 ? 2 : 0;
      leaf.style.transform = `translateZ(${depth}px) rotateY(${ang}deg) translateZ(${(lift * 14).toFixed(2)}px) skewY(${(lift * (single ? -1.2 : -1.6)).toFixed(3)}deg)`;
      leaf.style.setProperty('--s', lift.toFixed(3));
      leaf.style.zIndex = t > 0 && t < 1 ? 3 * n : (t >= 1 ? n + i : n - i);
      leaf.classList.toggle('turned', t >= 1);
      // Only the visible page(s) are focusable; hidden ones are inert.
      const visible = single
        ? i === view.leaf
        : (i === Math.round(prog) || i === Math.round(prog) - 1);
      leaf.inert = !visible;
    }
    bookEl.style.setProperty('--shift', shift.toFixed(4));
    bookEl.style.setProperty('--left', clamp(prog / turns(), 0, 1).toFixed(3));
    bookEl.style.setProperty('--right', clamp(1 - prog / turns(), 0, 1).toFixed(3));
    bookEl.classList.toggle('closed', prog < 0.02);
    bar.style.transform = `scaleX(${(st / maxStop()).toFixed(4)})`;
    // Pointer parallax is a cover-only flourish; open pages lie flat so text stays razor sharp.
    tiltAmt = clamp(1 - st * 2, 0, 1);
    if (tiltAmt === 0 && tilt.style.transform) tilt.style.transform = '';
    const key = `${view.page}:${view.side}`;
    if (key !== lastReport) {
      lastReport = key;
      opts.onView?.({ ...view, pageData: pages[view.page], total: pages.length, stop: Math.round(st), maxStop: maxStop() });
    }
  }

  function frame() {
    raf = 0;
    if (reduced) s = target;
    else s += (target - s) * 0.14;
    if (Math.abs(target - s) < 0.0008) s = target;
    paint(s);
    if (s !== target) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function onScroll() {
    if (!active) return;
    target = clamp(window.scrollY / step, 0, maxStop());
    kick();
  }

  function goStop(k) {
    const st = clamp(Math.round(k), 0, maxStop());
    window.scrollTo({ top: st * step, behavior: reduced ? 'auto' : 'smooth' });
  }
  const goTo = (pageIndex) => goStop(stopForPage(pageIndex));
  const next = () => goStop(Math.round(target) + 1);
  const prev = () => goStop(Math.round(target) - 1);

  // ------------------------------------------------------------------ input
  function onClick(e) {
    const g = e.target.closest('[data-goto]');
    if (g) { e.stopPropagation(); goTo(Number(g.dataset.goto)); return; }
    const a = e.target.closest('[data-act]');
    if (a) { e.stopPropagation(); opts.onAction?.(a.dataset.act); return; }
    if (e.target.closest('button, a, input, [data-open], .bk-ctl')) return;
    if (single) { // phone: left half of the screen goes back, right half goes forward
      if (e.clientX < window.innerWidth * 0.5) prev(); else next();
      return;
    }
    const r = bookEl.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return;
    const spine = r.left + r.width / 2;
    if (e.clientX >= spine && e.clientX <= r.right) next();
    else if (e.clientX < spine && e.clientX >= r.left - 40) prev();
  }

  let tx = 0; let ty = 0; let tt = 0;
  const onTouchStart = (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now(); };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - tt < 900) {
      if (dx < 0) next(); else prev();
    }
  };
  function onKey(e) {
    if (!active || e.target.closest?.('input, textarea, select') || document.querySelector('.sheet.open')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    if (e.key === 'Home') { e.preventDefault(); goStop(0); }
    if (e.key === 'End') { e.preventDefault(); goStop(maxStop()); }
  }
  function onPointer(e) {
    if (reduced || e.pointerType !== 'mouse') return;
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    if (tiltAmt > 0) tilt.style.transform = `rotateX(${(-y * 5 * tiltAmt).toFixed(2)}deg) rotateY(${(x * 6 * tiltAmt).toFixed(2)}deg)`;
    stage.style.setProperty('--lx', `${(50 + x * 18).toFixed(1)}%`);
  }
  const onResize = () => layout(false);

  // ------------------------------------------------------------------ dust motes in the spotlight
  let dustRaf = 0;
  function startDust() {
    if (reduced) return;
    const c = stage.querySelector('.bk-dust');
    const ctx = c.getContext('2d');
    const motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, v: Math.random() * 0.00025 + 0.00008, ph: Math.random() * 6.28 }));
    const draw = (now) => {
      dustRaf = requestAnimationFrame(draw);
      if (!active || document.hidden) return;
      const dpr = Math.min(devicePixelRatio, 1.5);
      const w = Math.round(c.clientWidth * dpr); const h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.y -= m.v; m.x += Math.sin(now / 2400 + m.ph) * 0.0002;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        const a = Math.max(0, 0.55 - Math.abs(m.x - 0.5) * 1.4) * (0.6 + 0.4 * Math.sin(now / 900 + m.ph));
        ctx.fillStyle = `rgba(255,214,160,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x * w, m.y * h, m.r * dpr, 0, 6.283); ctx.fill();
      }
    };
    dustRaf = requestAnimationFrame(draw);
  }

  // ------------------------------------------------------------------ title sequence
  function intro() {
    const card = root.querySelector('#bkTitle');
    let seen = false;
    try { seen = sessionStorage.getItem('qm:intro') === '1'; sessionStorage.setItem('qm:intro', '1'); } catch { /* ignore */ }
    if (reduced || seen) { card.remove(); host.classList.add('settled'); return; }
    const name = menu.restaurant.name || 'Menu';
    card.innerHTML = `<div class="tc-inner"><p class="tc-kicker">${opts.table ? esc(opts.table.label) : 'Welcome'} · tonight</p>
      <h1 class="tc-name">${[...name].map((ch, k) => `<span style="animation-delay:${(0.25 + k * 0.045).toFixed(3)}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}</h1>
      <p class="tc-sub">presents its menu</p></div>`;
    host.classList.add('intro');
    const done = () => {
      card.classList.add('out');
      host.classList.remove('intro');
      host.classList.add('entering');
      setTimeout(() => { card.remove(); host.classList.remove('entering'); host.classList.add('settled'); }, 1700);
    };
    const t = setTimeout(done, 2300);
    card.addEventListener('click', () => { clearTimeout(t); done(); }, { once: true });
  }

  // ------------------------------------------------------------------ public API
  return {
    activate() {
      if (active) return;
      active = true;
      document.documentElement.classList.add('book-mode');
      layout(true);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize);
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointermove', onPointer, { passive: true });
      stage.addEventListener('click', onClick);
      stage.addEventListener('touchstart', onTouchStart, { passive: true });
      stage.addEventListener('touchend', onTouchEnd, { passive: true });
      onScroll();
      if (!dustRaf) startDust();
    },
    deactivate() {
      active = false;
      document.documentElement.classList.remove('book-mode');
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointer);
      stage.removeEventListener('click', onClick);
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchend', onTouchEnd);
    },
    render() { build(); },
    update(m) { menu = m; const keep = viewing(target).page; build(); if (active) goTo(Math.min(keep, pages.length - 1)); },
    /** Reserve extra space at the bottom (e.g. while the cart bar is showing). */
    setReserve(px) { if (px !== reserveBottom) { reserveBottom = px; layout(true); } },
    intro,
    goTo,
    /** Jump (instantly) to a chapter — its opener page on phones, its spread on desktop. */
    goToChapter(id) {
      const i = pages.findIndex((pg) => pg.kind === 'menu' && pg.first && pg.chapter.id === id);
      if (i < 0) return false;
      const st = single ? Math.max(0, i * 2 - 1) : i;
      window.scrollTo(0, st * step);
      target = st; s = st;
      paint(s);
      return true;
    },
    next,
    prev,
    get pageCount() { return pages.length; },
  };
}

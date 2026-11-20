// The Menu Book — a scroll-driven, page-turning menu.
//
// Structure: a stack of "leaves" hinged on the spine. Each leaf has a FRONT (a right-hand
// page) and a BACK (the left-hand page you see after turning it). Scrolling maps to a
// progress value p; leaf i turns as p goes from i → i+1. The document only scrolls a tall,
// invisible track; the book itself sits in a sticky, full-screen stage.
//
// Content rule: back(i) always illustrates front(i+1), so every spread reads as
// [framed plate print | menu page], like a gallery catalogue.

import { esc } from './common.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const PER_PAGE = 4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: soft lift, soft set-down

function initials(name) {
  const words = String(name).replace(/&/g, ' ').split(/\s+/).filter((w) => /^[\p{L}]/u.test(w));
  return (words.length > 1 ? `${words[0][0]}&${words[words.length - 1][0]}` : (words[0] || 'M').slice(0, 2)).toUpperCase();
}

export function createBook(opts) {
  const { root, reduced } = opts;
  const host = opts.host || root; // receives state classes + size variables
  let menu = opts.menu;
  let pages = [];          // [{ kind, ... }]
  let leaves = [];         // DOM leaves
  let step = 0;            // scroll px per page turn
  let target = 0;          // progress from scroll
  let p = 0;               // smoothed progress
  let raf = 0;
  let active = false;
  let single = false;
  let lastW = 0;
  let lastH = 0;
  let tiltAmt = 1;          // pointer-parallax strength (cover only)

  root.innerHTML = `
    <div class="bk-track" id="bkTrack"></div>
    <div class="bk-stage" id="bkStage">
      <canvas class="bk-dust" aria-hidden="true"></canvas>
      <div class="bk-grain" aria-hidden="true"></div>
      <div class="bk-scene">
        <div class="bk-rise">
          <div class="bk-tilt">
            <div class="bk-shadow" aria-hidden="true"></div>
            <div class="book" id="book" aria-roledescription="menu book"></div>
          </div>
        </div>
      </div>
      <div class="bk-hint" id="bkHint" aria-hidden="true"><span class="mouse"><i></i></span><span>Scroll to open the menu</span></div>
      <div class="bk-progress" aria-hidden="true"><i id="bkBar"></i></div>
    </div>
    <div class="bk-titlecard" id="bkTitle" aria-hidden="true"></div>`;

  const track = root.querySelector('#bkTrack');
  const stage = root.querySelector('#bkStage');
  const bookEl = root.querySelector('#book');
  const tilt = root.querySelector('.bk-tilt');
  const hint = root.querySelector('#bkHint');
  const bar = root.querySelector('#bkBar');

  // ------------------------------------------------------------------ pages
  function paginate() {
    const r = menu.restaurant;
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
    // contents: page number of each chapter's first page (cover = no number, contents = 1)
    out[1].chapters = chapters.map((c, ci) => ({ ...c, ci, leaf: out.findIndex((pg) => pg.kind === 'menu' && pg.ci === ci) }));
    out.restaurant = r;
    return out;
  }

  const folio = (i) => (i <= 0 ? '' : `<div class="pg-folio">— ${i} —</div>`);
  const head = (left, right) => `<header class="pg-head"><span>${left}</span><span>${right}</span></header>`;
  const featured = (items) => items.find((i) => i.popular && i.available !== false) || items.find((i) => i.available !== false) || items[0];

  function plate(item, n) {
    return `<figure class="print">
      <div class="print-frame"><div class="print-mat">${opts.dishArt(item, 'print-art')}</div></div>
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

  function frontHtml(pg, i) {
    const r = menu.restaurant;
    const cur = opts.cur();
    if (pg.kind === 'cover') {
      return `<div class="pg cover">
        <div class="cv-inner">
          <div class="cv-mono"><span>${esc(initials(r.name))}</span></div>
          <div class="cv-kicker">Carte du jour</div>
          <h1 class="cv-title foil">${esc(r.name)}</h1>
          <div class="cv-rule"><i></i><b>✦</b><i></i></div>
          <p class="cv-tag">${esc(r.tagline || '')}</p>
          <div class="cv-foot">${opts.table ? esc(opts.table.label) : 'Our menu'} · ${esc(r.hours || '')}</div>
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
            <li><button data-goto="${c.leaf}"><span class="toc-n">${ROMAN[c.ci] || c.ci + 1}</span><span class="toc-name">${esc(c.name)}</span><span class="dots"></span><span class="toc-p">${c.leaf}</span></button></li>`).join('')}
          </ol>
          <div class="legend">
            <span>${opts.dietIcon(true)} Vegetarian</span><span>${opts.dietIcon(false)} Non-veg</span><span>🌶 Spice level</span><span class="bk-pick">✦ Chef’s pick</span>
          </div>
          <p class="howto"><b>How to order.</b> Tap a dish to see it plated in 3D, add it to your order, then send it straight to our kitchen — no waiting.</p>
        </div>
        ${folio(i)}
      </div>`;
    }
    if (pg.kind === 'menu') {
      const c = pg.chapter;
      return `<div class="pg paper">
        ${head(`${ROMAN[pg.ci] || pg.ci + 1} · ${esc(c.name)}`, esc(r.name))}
        <div class="pg-body">
          ${pg.first ? `<p class="kicker">Chapter ${ROMAN[pg.ci] || pg.ci + 1}</p><h2 class="pg-title">${esc(c.name)}</h2>` : `<p class="kicker">${esc(c.name)} · continued</p>`}
          <div class="rows">${pg.items.map((it) => `
            <article class="bk-row${it.available === false ? ' sold' : ''}" data-open="${esc(it.id)}" tabindex="0" aria-label="${esc(it.name)}, ${esc(cur)}${esc(it.price)}">
              <div class="bk-line">${opts.dietIcon(it.veg)}<span class="bk-name">${esc(it.name)}</span><span class="dots"></span><span class="bk-price">${esc(opts.money(it.price))}</span></div>
              <p class="bk-desc">${esc(it.desc || '')}</p>
              <div class="bk-meta">
                ${it.popular ? '<span class="bk-pick">✦ Chef’s pick</span>' : ''}
                ${it.spice ? `<span class="chili" aria-label="Spice ${it.spice} of 3">${'🌶'.repeat(it.spice)}</span>` : ''}
                ${it.prep ? `<span class="mono">${esc(it.prep)} min</span>` : ''}
                <span class="bk-ctl" data-ctl="${esc(it.id)}">${opts.itemControl(it)}</span>
              </div>
              ${it.available === false ? '<span class="stamp" aria-hidden="true">Sold out</span>' : ''}
            </article>`).join('')}
          </div>
          ${pg.items.length <= 2 ? tailpiece(pg) : ''}
        </div>
        ${folio(i)}
      </div>`;
    }
    // end / colophon
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
        <p class="fine">${tax.length ? `${tax.join(' + ')} added at checkout.` : 'No extra charges.'} ${r.wifi ? `Wi-Fi · ${esc(r.wifi)}` : ''}</p>
      </div>
      ${folio(i)}
    </div>`;
  }

  // back(i) illustrates front(i+1)
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
          ${head(esc(r.name), `Chapter ${ROMAN[next.ci] || next.ci + 1}`)}
          <div class="pg-body center">
            <div class="roman">${ROMAN[next.ci] || next.ci + 1}</div>
            <h3 class="op-title">${esc(next.chapter.icon || '')} ${esc(next.chapter.name)}</h3>
            ${plate(it, n)}
          </div>
          <div class="pg-folio" aria-hidden="true">❦</div>
        </div>`;
      }
      return `<div class="pg paper opener">
        ${head(esc(next.chapter.name), esc(r.name))}
        <div class="pg-body center">
          ${plate(it, n)}
          <blockquote>“${esc(it.desc || it.name)}”</blockquote>
        </div>
        <div class="pg-folio" aria-hidden="true">❦</div>
      </div>`;
    }
    // before the colophon: a note from the kitchen
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
    bookEl.innerHTML = pages.map((pg, i) => `
      <section class="leaf${i === 0 ? ' is-cover' : ''}" data-leaf="${i}">
        <div class="face front">${frontHtml(pg, i)}<i class="shade" aria-hidden="true"></i></div>
        <div class="face back" aria-hidden="true">${i < pages.length - 1 ? backHtml(i) : ''}<i class="shade" aria-hidden="true"></i></div>
      </section>`).join('');
    leaves = [...bookEl.querySelectorAll('.leaf')];
    layout(true);
    paint(p);
  }

  // ------------------------------------------------------------------ layout
  function layout(force) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!force && Math.abs(W - lastW) < 2 && Math.abs(H - lastH) < 140) return; // ignore mobile URL-bar jiggle
    lastW = W; lastH = H;
    single = W < 900;
    // Reserve the top bar and a bottom strip (call button / cart bar / hint).
    const top = single ? 58 : 72;
    const bottom = single ? 84 : 70;
    const availH = H - top - bottom;
    host.style.setProperty('--bk-offset', `${(top - bottom) / 2}px`);
    let pw = single ? Math.min(W * 0.86, availH / 1.42, 520) : Math.min((W * 0.86) / 2, availH / 1.42, 560);
    pw = Math.max(240, Math.floor(pw));
    host.style.setProperty('--pw', `${pw}px`);
    host.style.setProperty('--ph', `${Math.floor(pw * 1.42)}px`);
    host.classList.toggle('single', single);
    step = Math.round(H * 0.8);
    const turns = Math.max(1, pages.length - 1);
    track.style.height = `${turns * step + H}px`;
    track.innerHTML = Array.from({ length: turns + 1 }, (_, k) => `<i class="snap" style="top:${k * step}px"></i>`).join('');
    if (active) { target = clamp(window.scrollY / step, 0, turns); p = target; paint(p); }
  }

  // ------------------------------------------------------------------ render loop
  function paint(prog) {
    const n = leaves.length;
    const turns = n - 1;
    for (let i = 0; i < n; i++) {
      const leaf = leaves[i];
      let t = i < turns ? clamp(prog - i, 0, 1) : 0;
      if (t > 0.996) t = 1; else if (t < 0.004) t = 0; // settle cleanly at rest
      const e = smooth(t);
      const ang = -180 * e;
      const lift = Math.sin(Math.PI * e);
      // Only the page in motion is lifted off the stack. Resting pages stay exactly at z=0:
      // any fractional depth would scale them through the perspective and blur the type.
      const depth = t > 0 && t < 1 ? 2 : 0;
      // A turning page bows slightly toward the reader: tiny Z lift + skew sells the paper bend.
      leaf.style.transform = `translateZ(${depth.toFixed(2)}px) rotateY(${ang}deg) translateZ(${lift * 14}px) skewY(${lift * (single ? -1.2 : -1.6)}deg)`;
      leaf.style.setProperty('--s', lift.toFixed(3));
      leaf.style.setProperty('--e', e.toFixed(3));
      leaf.style.zIndex = t > 0 && t < 1 ? 3 * n : (t >= 1 ? n + i : n - i);
      leaf.classList.toggle('turned', t >= 1);
      // Only the visible right-hand page is focusable/clickable; hidden pages are inert.
      leaf.inert = Math.round(prog) !== i;
    }
    // Closed book centres the cover; opening slides it so the spread is centred.
    const open = smooth(clamp(prog, 0, 1));
    const shift = single ? -0.5 : -0.5 * (1 - open);
    bookEl.style.setProperty('--shift', shift.toFixed(4));
    bookEl.style.setProperty('--left', clamp(prog / Math.max(1, turns), 0, 1).toFixed(3));
    bookEl.style.setProperty('--right', clamp(1 - prog / Math.max(1, turns), 0, 1).toFixed(3));
    bookEl.classList.toggle('closed', prog < 0.02);
    // Pointer parallax is a cover-only flourish; open pages lie flat so text stays razor sharp.
    tiltAmt = clamp(1 - prog * 2, 0, 1);
    if (tiltAmt === 0 && tilt.style.transform) tilt.style.transform = '';
    bar.style.transform = `scaleX(${turns ? prog / turns : 0})`;
    hint.classList.toggle('gone', prog > 0.15);
    opts.onPage?.(Math.round(prog), pages[Math.round(prog)], pages.length);
  }

  function frame() {
    raf = 0;
    if (reduced) p = target;
    else p += (target - p) * 0.14;
    if (Math.abs(target - p) < 0.0008) p = target;
    paint(p);
    if (p !== target) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function onScroll() {
    if (!active) return;
    target = clamp(window.scrollY / step, 0, Math.max(0, pages.length - 1));
    kick();
  }

  function goTo(i) {
    const turns = pages.length - 1;
    const k = clamp(Math.round(i), 0, turns);
    window.scrollTo({ top: k * step, behavior: reduced ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------------ input
  function onClick(e) {
    const g = e.target.closest('[data-goto]');
    if (g) { e.stopPropagation(); goTo(Number(g.dataset.goto)); return; }
    const a = e.target.closest('[data-act]');
    if (a) { e.stopPropagation(); opts.onAction?.(a.dataset.act); return; }
    if (e.target.closest('button, a, input, [data-open], .bk-ctl')) return;
    // Tap on the book: right of the spine turns forward, left of it turns back.
    const r = bookEl.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return;
    const spine = r.left + r.width / 2;
    if (e.clientX >= spine && e.clientX <= r.right) goTo(Math.round(target) + 1);
    else if (e.clientX < spine && e.clientX >= r.left - 40) goTo(Math.round(target) - 1);
  }

  let tx = 0; let ty = 0;
  const onTouchStart = (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(Math.round(target) + (dx < 0 ? 1 : -1));
  };
  function onKey(e) {
    if (!active || e.target.closest?.('input, textarea, select') || document.querySelector('.sheet.open')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goTo(Math.round(target) + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(Math.round(target) - 1); }
    if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    if (e.key === 'End') { e.preventDefault(); goTo(pages.length - 1); }
  }
  function onFocus(e) {
    const leaf = e.target.closest?.('.leaf');
    if (leaf && e.target.closest('.front')) {
      const i = Number(leaf.dataset.leaf);
      if (Math.round(target) !== i) goTo(i);
    }
  }
  // Gentle parallax tilt toward the pointer (desktop)
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
      const w = (c.width = c.clientWidth * Math.min(devicePixelRatio, 1.5));
      const h = (c.height = c.clientHeight * Math.min(devicePixelRatio, 1.5));
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.y -= m.v; m.x += Math.sin(now / 2400 + m.ph) * 0.0002;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        const cx = Math.abs(m.x - 0.5);
        const a = Math.max(0, 0.55 - cx * 1.4) * (0.6 + 0.4 * Math.sin(now / 900 + m.ph));
        ctx.fillStyle = `rgba(255,214,160,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x * w, m.y * h, m.r * Math.min(devicePixelRatio, 1.5), 0, 6.283); ctx.fill();
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
      bookEl.addEventListener('focusin', onFocus);
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
      bookEl.removeEventListener('focusin', onFocus);
    },
    render() { build(); },
    update(m) { menu = m; const keep = Math.round(target); build(); if (active) goTo(Math.min(keep, pages.length - 1)); },
    intro,
    goTo,
    get pageCount() { return pages.length; },
  };
}

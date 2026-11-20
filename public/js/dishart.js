// Procedural dish illustrations — flat, bold, poster-style food art drawn on <canvas>.
// No photos, no emoji: every dish gets a deterministic illustration seeded by its id,
// styled by its category/name (curry, tikka, prawns, drumsticks, bhel, bread, rice,
// dessert, hot drink, cold drink). Used by the menu book, the 3D viewer and the gallery.

const PALETTE = ['#2b3fd1', '#d8432f', '#1f7a55', '#e3a72f', '#6b3fb0', '#d9577f', '#0f6f8f', '#ef6a2a', '#22303f', '#b8325a'];
const cache = new Map();

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

export function kindOf(item) {
  const n = `${item.name || ''} ${item.category || ''}`.toLowerCase();
  if (/prawn|shrimp|fish|lobster/.test(n)) return 'prawns';
  if (/lollipop|wing|drumstick|65/.test(n)) return 'drumsticks';
  if (/bhel|chaat|corn/.test(n)) return 'bhel';
  if (/chai|coffee|tea|latte/.test(n)) return 'hotdrink';
  if (/drink|lassi|cooler|tonic|juice|soda|mocktail|cocktail|shake/.test(n)) return 'colddrink';
  if (/naan|kulcha|paratha|roti|bread/.test(n)) return 'bread';
  if (/biryani|rice|pulao|bowl/.test(n)) return 'rice';
  if (/jamun|kulfi|falooda|dessert|brûlée|brulee|ice|halwa|kheer|cake/.test(n)) return 'dessert';
  if (/tikka|kebab|paneer|starter|tandoori/.test(n)) return 'tikka';
  return 'curry';
}

// ---------------------------------------------------------------- primitives
function blob(ctx, cx, cy, r, rnd, wobble = 0.12, pts = 9) {
  const p = [];
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + rnd() * wobble);
    p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % pts];
    const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2;
    if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(x0, y0, mx, my);
  }
  const [x0, y0] = p[0]; const [x1, y1] = p[1];
  ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  ctx.closePath();
}
function circle(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
function leaf(ctx, x, y, s, ang, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.7, s, 0); ctx.quadraticCurveTo(0, s * 0.7, -s, 0);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(-s * 0.8, 0); ctx.lineTo(s * 0.8, 0); ctx.stroke();
  ctx.restore();
}
function herbs(ctx, cx, cy, r, rnd, n = 9) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2; const d = rnd() * r;
    leaf(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.06 + rnd() * 0.05), rnd() * 6.28, hsl(105 + rnd() * 30, 55, 30 + rnd() * 12));
  }
}
function flecks(ctx, cx, cy, r, rnd, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2; const d = Math.sqrt(rnd()) * r;
    circle(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.008 + rnd() * 0.014), color(rnd));
  }
}
function gloss(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 0.9);
  g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}

// ---------------------------------------------------------------- dishes (drawn inside a plate well of radius r)
const DRAW = {
  curry(ctx, cx, cy, r, h, rnd) {
    circle(ctx, cx, cy, r * 0.92, '#2a2522');               // kadai rim
    circle(ctx, cx, cy, r * 0.84, '#4a3a30');
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r * 0.8);
    const green = h > 70 && h < 170; // spinach/herb gravies: deep and earthy, never neon
    g.addColorStop(0, hsl(h + 8, green ? 45 : 78, green ? 40 : 50)); g.addColorStop(1, hsl(h, green ? 50 : 76, green ? 22 : 32));
    circle(ctx, cx, cy, r * 0.78, g);
    for (let i = 0; i < 8; i++) {                            // chunks
      const a = rnd() * 6.28; const d = rnd() * r * 0.55;
      ctx.fillStyle = hsl(h + 15, 55, 62 + rnd() * 10);
      blob(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.08 + rnd() * 0.06), rnd, 0.3, 6); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,248,235,.9)'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round';
    ctx.beginPath();                                          // cream swirl
    for (let t = 0; t < 5.5; t += 0.1) { const rr = r * 0.05 + t * r * 0.075; const x = cx + Math.cos(t * 1.6) * rr; const y = cy + Math.sin(t * 1.6) * rr; if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    flecks(ctx, cx, cy, r * 0.7, rnd, 40, () => 'rgba(120,30,10,.55)');
    herbs(ctx, cx, cy, r * 0.6, rnd, 7);
    gloss(ctx, cx, cy, r * 0.78);
  },
  tikka(ctx, cx, cy, r, h, rnd) {
    // mint chutney + onion rings + lemon
    circle(ctx, cx + r * 0.5, cy + r * 0.45, r * 0.2, hsl(115, 45, 42));
    circle(ctx, cx + r * 0.5, cy + r * 0.45, r * 0.12, hsl(110, 50, 52));
    ctx.strokeStyle = hsl(330, 45, 70); ctx.lineWidth = r * 0.035;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx - r * 0.45 + i * r * 0.1, cy + r * 0.5, r * (0.1 + i * 0.03), 0, 6.28); ctx.stroke(); }
    ctx.fillStyle = '#f4d23c'; ctx.beginPath(); ctx.arc(cx - r * 0.5, cy - r * 0.45, r * 0.16, 0.3, 0.3 + Math.PI); ctx.fill();
    for (const off of [-0.18, 0.18]) {                       // two skewers
      ctx.save(); ctx.translate(cx, cy + off * r); ctx.rotate(-0.5);
      ctx.strokeStyle = '#8a5a2c'; ctx.lineWidth = r * 0.025; ctx.beginPath(); ctx.moveTo(-r * 0.85, 0); ctx.lineTo(r * 0.85, 0); ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        const x = i * r * 0.27; const s = r * 0.12;
        const pep = i % 2 === 0;
        ctx.fillStyle = pep ? hsl(h, 75, 52) : hsl(i < 0 ? 120 : 0, 55, 40);
        ctx.beginPath(); ctx.roundRect(x - s, -s, s * 2, s * 2, s * 0.45); ctx.fill();
        ctx.strokeStyle = 'rgba(40,15,5,.55)'; ctx.lineWidth = s * 0.16;
        for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x - s * 0.7, k * s * 0.6 - s * 0.2); ctx.lineTo(x + s * 0.7, k * s * 0.6 + s * 0.2); ctx.stroke(); }
      }
      ctx.restore();
    }
    herbs(ctx, cx, cy, r * 0.7, rnd, 6);
  },
  prawns(ctx, cx, cy, r, h, rnd) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.28 + rnd() * 0.3; const x = cx + Math.cos(a) * r * 0.42; const y = cy + Math.sin(a) * r * 0.42;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + 1.2);
      for (let k = 0; k < 6; k++) {
        const t = k / 5; const ang = t * 3.4; const rr = r * 0.2;
        ctx.fillStyle = hsl(14 + k * 3, 85, 58 - k * 3);
        ctx.beginPath(); ctx.ellipse(Math.cos(ang) * rr, Math.sin(ang) * rr, r * (0.1 - t * 0.05), r * 0.07, ang + 1.57, 0, 6.28); ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = '#f4d23c'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.17, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#fff7c2'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.13, 0, 6.28); ctx.fill();
    ctx.strokeStyle = '#f4d23c'; ctx.lineWidth = r * 0.015;
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(i * 0.785) * r * 0.13, cy + Math.sin(i * 0.785) * r * 0.13); ctx.stroke(); }
    herbs(ctx, cx, cy, r * 0.75, rnd, 8);
  },
  drumsticks(ctx, cx, cy, r, h, rnd) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.28 + 0.4;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.fillStyle = '#efe6d2'; ctx.beginPath(); ctx.roundRect(r * 0.06, -r * 0.04, r * 0.32, r * 0.08, r * 0.04); ctx.fill();
      circle(ctx, r * 0.4, -r * 0.05, r * 0.05, '#efe6d2'); circle(ctx, r * 0.4, r * 0.05, r * 0.05, '#efe6d2');
      ctx.fillStyle = hsl(h + 2, 80, 40); blob(ctx, r * 0.62, 0, r * 0.2, rnd, 0.25, 8); ctx.fill();
      flecks(ctx, r * 0.62, 0, r * 0.17, rnd, 18, () => 'rgba(60,10,0,.5)');
      ctx.restore();
    }
    circle(ctx, cx, cy, r * 0.16, '#f7efe0'); circle(ctx, cx, cy, r * 0.11, '#efe1c4');
    herbs(ctx, cx, cy, r * 0.8, rnd, 7);
  },
  bhel(ctx, cx, cy, r, h, rnd) {
    ctx.fillStyle = '#e9d6a8'; blob(ctx, cx, cy, r * 0.7, rnd, 0.18, 12); ctx.fill();
    const cols = ['#f4c542', '#fbe7b5', '#d2462d', '#3f8f3a', '#f7f0de', '#e07a2a'];
    for (let i = 0; i < 180; i++) {
      const a = rnd() * 6.28; const d = Math.sqrt(rnd()) * r * 0.66;
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.save(); ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d); ctx.rotate(rnd() * 6.28);
      ctx.beginPath(); ctx.ellipse(0, 0, r * (0.018 + rnd() * 0.02), r * 0.014, 0, 0, 6.28); ctx.fill(); ctx.restore();
    }
    ctx.strokeStyle = 'rgba(120,50,20,.7)'; ctx.lineWidth = r * 0.025; ctx.lineCap = 'round';
    ctx.beginPath(); for (let t = 0; t < 6.28 * 2; t += 0.2) { const rr = r * 0.12 + t * r * 0.04; ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr); } ctx.stroke();
    herbs(ctx, cx, cy, r * 0.6, rnd, 6);
  },
  bread(ctx, cx, cy, r, h, rnd) {
    for (let k = 1; k >= 0; k--) {
      const ox = k ? r * 0.18 : -r * 0.08; const oy = k ? -r * 0.12 : r * 0.06;
      ctx.save(); ctx.translate(cx + ox, cy + oy); ctx.rotate(k ? 0.5 : -0.25); ctx.scale(1, 0.72);
      const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.8);
      g.addColorStop(0, '#f3d79c'); g.addColorStop(1, '#d9a75c');
      ctx.fillStyle = g; blob(ctx, 0, 0, r * 0.72, rnd, 0.16, 10); ctx.fill();
      for (let i = 0; i < 26; i++) {
        const a = rnd() * 6.28; const d = Math.sqrt(rnd()) * r * 0.6;
        ctx.fillStyle = `rgba(${70 + rnd() * 40},${35 + rnd() * 20},10,${0.35 + rnd() * 0.45})`;
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * (0.02 + rnd() * 0.05), r * (0.015 + rnd() * 0.03), rnd() * 3, 0, 6.28); ctx.fill();
      }
      ctx.restore();
    }
    flecks(ctx, cx, cy, r * 0.6, rnd, 30, () => hsl(110, 45, 35, 0.8));
    gloss(ctx, cx, cy, r * 0.7);
  },
  rice(ctx, cx, cy, r, h, rnd) {
    circle(ctx, cx + r * 0.52, cy - r * 0.5, r * 0.22, '#d7d2c4');          // raita
    circle(ctx, cx + r * 0.52, cy - r * 0.5, r * 0.18, '#f6f3ea');
    flecks(ctx, cx + r * 0.52, cy - r * 0.5, r * 0.15, rnd, 12, () => hsl(110, 40, 40));
    ctx.fillStyle = '#efe4c8'; blob(ctx, cx - r * 0.06, cy + r * 0.05, r * 0.66, rnd, 0.14, 11); ctx.fill();
    for (let i = 0; i < 420; i++) {
      const a = rnd() * 6.28; const d = Math.sqrt(rnd()) * r * 0.6;
      const saffron = rnd() < 0.22;
      ctx.fillStyle = saffron ? hsl(32 + rnd() * 10, 92, 55) : (rnd() < 0.5 ? '#fffaf0' : '#e6d6b1');
      ctx.save(); ctx.translate(cx - r * 0.06 + Math.cos(a) * d, cy + r * 0.05 + Math.sin(a) * d); ctx.rotate(rnd() * 6.28);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.03, r * 0.009, 0, 0, 6.28); ctx.fill(); ctx.restore();
    }
    ctx.strokeStyle = '#7a3f17'; ctx.lineWidth = r * 0.016; ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) { const a = rnd() * 6.28; const d = rnd() * r * 0.5; const x = cx + Math.cos(a) * d; const y = cy + Math.sin(a) * d; ctx.beginPath(); ctx.arc(x, y, r * 0.04, rnd() * 3, rnd() * 3 + 2.4); ctx.stroke(); }
    herbs(ctx, cx, cy, r * 0.5, rnd, 7);
  },
  dessert(ctx, cx, cy, r, h, rnd) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 0.8);
    g.addColorStop(0, hsl(38, 90, 62, 0.95)); g.addColorStop(1, hsl(28, 85, 45, 0.95));
    circle(ctx, cx, cy, r * 0.76, g);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 - 0.5; const x = cx + Math.cos(a) * r * 0.3; const y = cy + Math.sin(a) * r * 0.3;
      const bg = ctx.createRadialGradient(x - r * 0.08, y - r * 0.09, r * 0.02, x, y, r * 0.24);
      bg.addColorStop(0, hsl(h + 10, 60, 45)); bg.addColorStop(1, hsl(h - 5, 70, 18));
      circle(ctx, x, y, r * 0.23, bg);
      circle(ctx, x - r * 0.08, y - r * 0.09, r * 0.05, 'rgba(255,255,255,.55)');
    }
    for (let i = 0; i < 14; i++) {                         // pistachio + rose
      const a = rnd() * 6.28; const d = rnd() * r * 0.65;
      ctx.fillStyle = i % 3 ? hsl(85, 50, 52) : hsl(340, 70, 70);
      ctx.save(); ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d); ctx.rotate(rnd() * 6);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.045, r * 0.018, 0, 0, 6.28); ctx.fill(); ctx.restore();
    }
    gloss(ctx, cx, cy, r * 0.76);
  },
  hotdrink(ctx, cx, cy, r, h, rnd) {
    circle(ctx, cx, cy, r * 0.9, '#efe8da'); circle(ctx, cx, cy, r * 0.84, '#f8f3ea');                 // saucer
    ctx.fillStyle = '#efe8da'; ctx.beginPath(); ctx.roundRect(cx + r * 0.42, cy - r * 0.08, r * 0.3, r * 0.16, r * 0.08); ctx.fill(); // handle
    circle(ctx, cx, cy, r * 0.52, '#f2ece0'); circle(ctx, cx, cy, r * 0.45, hsl(h, 55, 42));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.45);
    g.addColorStop(0, 'rgba(255,240,215,.75)'); g.addColorStop(0.6, 'rgba(255,240,215,.25)'); g.addColorStop(1, 'rgba(255,240,215,0)');
    circle(ctx, cx, cy, r * 0.45, g);
    ctx.fillStyle = 'rgba(255,248,236,.85)'; ctx.beginPath();                                      // latte-art leaf
    ctx.moveTo(cx, cy - r * 0.26); ctx.bezierCurveTo(cx + r * 0.22, cy - r * 0.1, cx + r * 0.16, cy + r * 0.18, cx, cy + r * 0.26);
    ctx.bezierCurveTo(cx - r * 0.16, cy + r * 0.18, cx - r * 0.22, cy - r * 0.1, cx, cy - r * 0.26); ctx.fill();
    ctx.strokeStyle = hsl(h, 55, 42); ctx.lineWidth = r * 0.015; ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.24); ctx.lineTo(cx, cy + r * 0.24); ctx.stroke();
    for (let i = 0; i < 4; i++) circle(ctx, cx - r * 0.62 + i * r * 0.07, cy + r * 0.55, r * 0.035, hsl(30, 40, 30)); // cardamom pods
  },
  colddrink(ctx, cx, cy, r, h, rnd) {
    circle(ctx, cx + r * 0.08, cy + r * 0.08, r * 0.6, 'rgba(0,0,0,.12)');
    circle(ctx, cx, cy, r * 0.6, 'rgba(255,255,255,.55)');
    const g = ctx.createRadialGradient(cx - r * 0.1, cy - r * 0.1, r * 0.05, cx, cy, r * 0.55);
    g.addColorStop(0, hsl(h, 85, 70)); g.addColorStop(1, hsl(h, 80, 45));
    circle(ctx, cx, cy, r * 0.54, g);
    for (let i = 0; i < 5; i++) {                                   // ice
      const a = rnd() * 6.28; const d = rnd() * r * 0.3;
      ctx.save(); ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d); ctx.rotate(rnd() * 3);
      ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.beginPath(); ctx.roundRect(-r * 0.09, -r * 0.09, r * 0.18, r * 0.18, r * 0.04); ctx.fill();
      ctx.restore();
    }
    ctx.save(); ctx.translate(cx + r * 0.3, cy - r * 0.32);                   // citrus wheel
    circle(ctx, 0, 0, r * 0.2, '#f6e27a'); circle(ctx, 0, 0, r * 0.17, '#fbf1b0');
    ctx.strokeStyle = '#f2d24a'; ctx.lineWidth = r * 0.012;
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(i * 0.785) * r * 0.17, Math.sin(i * 0.785) * r * 0.17); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round';      // straw
    ctx.beginPath(); ctx.moveTo(cx - r * 0.1, cy + r * 0.05); ctx.lineTo(cx - r * 0.75, cy + r * 0.62); ctx.stroke();
    leaf(ctx, cx - r * 0.25, cy - r * 0.25, r * 0.11, 0.6, hsl(120, 50, 35));
    gloss(ctx, cx, cy, r * 0.54);
  },
};

function grain(ctx, w, h, rnd, amt = 0.07) {
  const n = Math.round((w * h) / 90);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${amt * rnd()})` : `rgba(255,255,255,${amt * rnd()})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1.2, 1.2);
  }
}

function plate(ctx, cx, cy, r) {
  circle(ctx, cx + r * 0.06, cy + r * 0.08, r, 'rgba(0,0,0,.22)');                    // flat poster shadow
  circle(ctx, cx, cy, r, '#f7f3ea');
  ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = r * 0.012; ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, 6.28); ctx.stroke();
  ctx.strokeStyle = 'rgba(190,150,70,.6)'; ctx.lineWidth = r * 0.012; ctx.beginPath(); ctx.arc(cx, cy, r * 0.96, 0, 6.28); ctx.stroke();
}

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Full poster (4:5): bold backdrop, sun disc, plated dish from above, grain. */
export function drawPoster(item, w = 640, h = 800) {
  const c = makeCanvas(w, h); const ctx = c.getContext('2d');
  const rnd = rng(hashStr(String(item.id || item.name || item.emoji || 'dish')));
  const bg = PALETTE[Math.floor(rnd() * PALETTE.length)];
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  // sun / arch shape behind the plate
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.beginPath(); ctx.arc(w * (0.3 + rnd() * 0.4), h * (0.28 + rnd() * 0.1), w * 0.42, 0, 6.28); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, h * 0.78, w, h * 0.22);
  // scattered spices on the "table"
  for (let i = 0; i < 7; i++) leaf(ctx, rnd() * w, h * 0.1 + rnd() * h * 0.8, w * (0.02 + rnd() * 0.02), rnd() * 6, 'rgba(255,255,255,.22)');
  const r = w * 0.41;
  const cx = w / 2; const cy = h * 0.5;
  plate(ctx, cx, cy, r);
  DRAW[kindOf(item)](ctx, cx, cy, r * 0.78, Number(item.hue) || 30, rnd);
  grain(ctx, w, h, rnd);
  return c;
}

/** Plated dish on transparent background (square) — thumbnails, 3D decal. */
export function drawPlated(item, size = 256, { withPlate = true } = {}) {
  const c = makeCanvas(size, size); const ctx = c.getContext('2d');
  const rnd = rng(hashStr(String(item.id || item.name || item.emoji || 'dish')));
  rnd();
  const cx = size / 2; const cy = size / 2; const r = size * 0.46;
  if (withPlate) plate(ctx, cx, cy, r);
  DRAW[kindOf(item)](ctx, cx, cy, withPlate ? r * 0.78 : r, Number(item.hue) || 30, rnd);
  return c;
}

/** Cached data-URLs for use in <img>. */
export function posterUrl(item, w = 480, h = 600) {
  const k = `p:${item.id}:${item.hue}:${item.name}:${item.category}:${w}`;
  if (!cache.has(k)) cache.set(k, drawPoster(item, w, h).toDataURL('image/jpeg', 0.86));
  return cache.get(k);
}
export function platedUrl(item, size = 160) {
  const k = `t:${item.id}:${item.hue}:${item.name}:${item.category}:${size}`;
  if (!cache.has(k)) cache.set(k, drawPlated(item, size).toDataURL('image/png'));
  return cache.get(k);
}

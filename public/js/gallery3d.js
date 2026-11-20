// The Gallery — a walkable rotunda where every dish hangs as a framed print.
//
// The camera stands inside a circular, softly lit gallery and walks around the wall.
// Each menu chapter opens with a title card, followed by its dishes as illustrated prints
// with museum labels, set in glowing arched niches. Progress (in "exhibits") is driven by
// the page scroll / drag / arrows from landing.js; clicking a print dollies in to look closer.
import * as THREE from 'three';
import { drawPoster } from './dishart.js';

const R = 16;            // wall radius
const WALL_H = 11;
const EYE = 3.05;        // camera height
const ART_Y = 3.35;      // centre of the prints
const PAPER = '#f4f2ec';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// soft glowing arch painted on the wall behind each exhibit
function archTexture() {
  return canvasTex(512, 768, (ctx, w, h) => {
    const r = w * 0.42;
    const cx = w / 2;
    const top = h * 0.12 + r;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(cx - r, h);
      ctx.lineTo(cx - r, top);
      ctx.arc(cx, top, r, Math.PI, 0);
      ctx.lineTo(cx + r, h);
      ctx.closePath();
    };
    ctx.filter = 'blur(26px)';
    const g = ctx.createRadialGradient(cx, h * 0.45, r * 0.2, cx, h * 0.45, h * 0.62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,.55)');
    ctx.fillStyle = g; path(); ctx.fill();
    ctx.filter = 'blur(6px)';
    ctx.strokeStyle = 'rgba(120,110,95,.10)'; ctx.lineWidth = 10; path(); ctx.stroke();
  });
}

function shadowTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.filter = 'blur(18px)';
    ctx.fillStyle = 'rgba(40,30,20,.55)';
    ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
  });
}

function wallTexture() {
  return canvasTex(64, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0); // bottom → top (texture v is flipped by flipY)
    g.addColorStop(0, '#d9d6cf');
    g.addColorStop(0.18, '#ebe9e3');
    g.addColorStop(0.5, '#f6f5f1');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

function floorTexture() {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.05, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#e9e7e2');
    g.addColorStop(0.75, '#d6d3cc');
    g.addColorStop(0.97, '#c3bfb7');
    g.addColorStop(1, '#b9b5ad');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { // terrazzo-ish speckle
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '90,80,70'},${Math.random() * 0.07})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

function labelTexture(item, n, money) {
  return canvasTex(640, 240, (ctx, w, h) => {
    ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111110';
    ctx.font = '600 50px Fraunces, Georgia, serif';
    let name = item.name;
    while (ctx.measureText(name).width > w - 60 && name.length > 4) name = `${name.slice(0, -2)}…`;
    ctx.fillText(name, 30, 78);
    ctx.font = 'italic 34px Newsreader, Georgia, serif';
    ctx.fillStyle = '#5f5e5a';
    ctx.fillText(`${item.veg ? 'Vegetarian' : 'Non-veg'}${item.spice ? ` · ${['', 'mild', 'medium', 'hot'][item.spice]}` : ''}`, 30, 128);
    ctx.font = '600 26px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#5f5e5a';
    ctx.fillText(`PLATE Nº ${String(n).padStart(2, '0')}`, 30, 196);
    ctx.fillStyle = '#b23d17';
    ctx.font = '600 40px Fraunces, Georgia, serif';
    const p = money(item.price);
    ctx.fillText(p, w - 30 - ctx.measureText(p).width, 196);
  });
}

function titleTexture(cat, count, idx) {
  return canvasTex(640, 860, (ctx, w, h) => {
    ctx.fillStyle = '#e7e5df'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111110';
    ctx.font = '600 30px ui-monospace, Menlo, monospace';
    ctx.fillText(`CHAPTER ${idx + 1}`, 56, 96);
    ctx.font = '600 104px Oswald, "Arial Narrow", sans-serif';
    const words = cat.name.toUpperCase().split(/\s+/);
    let y = 230; let line = '';
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(test).width > w - 112 && line) { ctx.fillText(line, 56, y); y += 108; line = wd; } else line = test;
    }
    ctx.fillText(line, 56, y);
    ctx.font = '600 30px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#5f5e5a';
    ctx.fillText(`${count} DISH${count === 1 ? '' : 'ES'}`, 56, y + 70);
    ctx.fillStyle = 'rgba(17,17,16,.5)';
    ctx.fillRect(56, h - 120, 80, 3);
    ctx.font = 'italic 34px Newsreader, Georgia, serif';
    ctx.fillText('Open the chapter →', 56, h - 64);
  });
}

export async function mountGallery(container, opts) {
  const { menu, reduced } = opts;
  const money = opts.money || ((n) => `₹${n}`);

  // Wait (briefly) for the web fonts the textures are typeset in.
  try {
    await Promise.race([
      Promise.all(['600 64px Oswald', '600 48px Fraunces', 'italic 32px Newsreader'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 1800)),
    ]);
  } catch { /* fonts optional */ }

  const lite = Math.min(window.innerWidth, window.innerHeight) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: lite ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // A bright, mostly unlit room: no filmic tone mapping (it would grey out pure whites).
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  scene.fog = new THREE.Fog(new THREE.Color(PAPER), 18, 36);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 1.35));
  const sun = new THREE.DirectionalLight(0xfff6ea, 0.9);
  sun.position.set(0, 20, 0);
  scene.add(sun);

  // Room
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, WALL_H, 160, 1, true),
    new THREE.MeshBasicMaterial({ map: wallTexture(), side: THREE.BackSide }),
  );
  wall.position.y = WALL_H / 2;
  scene.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 128), new THREE.MeshBasicMaterial({ map: floorTexture() }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // skylight: a bright disc overhead
  const sky = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sky.rotation.x = Math.PI / 2;
  sky.position.y = WALL_H;
  scene.add(sky);

  // Exhibits — a quiet lobby wall first (so the opening headline sits on clean wall),
  // then each chapter's title card and its plates, then a little empty wall before we loop.
  const exhibits = [{ kind: 'lobby' }]; // { kind, item|cat, angle, group, base, normal, hit, lift }
  menu.categories.forEach((c, ci) => {
    const items = menu.items.filter((i) => i.category === c.id);
    if (!items.length) return;
    exhibits.push({ kind: 'chapter', cat: c, ci, count: items.length });
    items.forEach((item) => exhibits.push({ kind: 'dish', item, cat: c, ci, n: menu.items.indexOf(item) + 1 }));
  });
  const WALKABLE = exhibits.length;          // the walk ends at the last plate
  exhibits.push({ kind: 'blank' }, { kind: 'blank' });
  const N = exhibits.length;
  const STEP = (Math.PI * 2) / N;
  const archTex = archTexture();
  const shadowTex = shadowTexture();
  const archGeo = new THREE.PlaneGeometry(3.5, 5.6);
  const archMat = new THREE.MeshBasicMaterial({ map: archTex, transparent: true, depthWrite: false });
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x151514, roughness: 0.5, metalness: 0.2 });
  const matMat = new THREE.MeshBasicMaterial({ color: 0xfdfcf8 });
  const cardMat = new THREE.MeshBasicMaterial({ color: 0xe4e2dc });
  const hits = [];

  exhibits.forEach((ex, k) => {
    ex.angle = k * STEP;
    const g = new THREE.Group();
    const dir = new THREE.Vector3(Math.cos(ex.angle), 0, Math.sin(ex.angle));
    ex.base = dir.clone().multiplyScalar(R - 0.02);
    ex.normal = dir.clone().negate();
    g.position.copy(ex.base);
    g.lookAt(0, 0, 0);
    scene.add(g);
    ex.group = g;
    ex.lift = 0; ex.liftTarget = 0;

    if (ex.kind === 'blank') return;
    if (ex.kind === 'lobby') return; // clean wall behind the opening headline
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(0, 3.4, 0.01);
    g.add(arch);

    const art = new THREE.Group();
    art.position.set(0, ART_Y, 0.06);
    g.add(art);
    ex.art = art;

    if (ex.kind === 'dish') {
      const W = 1.95; const H = W * 1.25; const M = 0.2; const F = 0.07;
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.9, H + 0.9), shadowMat);
      sh.position.set(0.12, -0.18, -0.03);
      art.add(sh);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(W + M * 2 + F * 2, H + M * 2 + F * 2, 0.08), frameMat);
      art.add(frame);
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(W + M * 2, H + M * 2), matMat);
      mat.position.z = 0.041;
      art.add(mat);
      const poster = new THREE.CanvasTexture(drawPoster(ex.item, 512, 640));
      poster.colorSpace = THREE.SRGBColorSpace;
      poster.anisotropy = 8;
      const print = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: poster }));
      print.position.z = 0.043;
      art.add(print);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.47), new THREE.MeshBasicMaterial({ map: labelTexture(ex.item, ex.n, money) }));
      label.position.set(W / 2 + 0.05, -(H / 2) - 0.72, 0.02);
      art.add(label);
      frame.userData.ex = ex; print.userData.ex = ex; mat.userData.ex = ex;
      hits.push(frame, print, mat);
    } else {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 3.1, 0.06),
        [cardMat, cardMat, cardMat, cardMat, new THREE.MeshBasicMaterial({ map: titleTexture(ex.cat, ex.count, ex.ci) }), cardMat],
      );
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 3.9), shadowMat);
      sh.position.set(0.1, -0.15, -0.04);
      art.add(sh);
      art.add(card);
      card.rotation.y = -0.08;
      card.userData.ex = ex;
      hits.push(card);
    }
  });

  // ------------------------------------------------------------------ camera rig
  let target = 0;        // walking progress, in exhibits (0..N-1)
  let u = 0;             // smoothed
  let focusEx = null;    // exhibit being looked at closely
  let focusT = 0;        // 0 = walking, 1 = up close
  let aspect = 1;

  function walkPose(uu) {
    const portrait = aspect < 0.9;
    const a = uu * STEP;
    const back = portrait ? 0.34 : 0.46;     // stand a little "behind" the exhibit, looking ahead
    const rc = portrait ? 9.6 : 7.8;
    const camA = a - back;
    const pos = new THREE.Vector3(Math.cos(camA) * rc, EYE, Math.sin(camA) * rc);
    const look = new THREE.Vector3(Math.cos(a) * (R - 0.1), ART_Y - 0.2, Math.sin(a) * (R - 0.1)); // the exhibit itself, centred
    return { pos, look };
  }
  function focusPose(ex) {
    const portrait = aspect < 0.9;
    const p = ex.base.clone().add(new THREE.Vector3(0, ART_Y, 0));
    const dist = portrait ? 7.4 : 6.2;
    // Desktop: frame the print left of centre (detail card on the right).
    // Phone: frame it in the upper half (detail sheet at the bottom).
    const side = portrait ? 0 : -1.45;
    const drop = portrait ? -1.75 : 0;
    const tangent = new THREE.Vector3(-ex.normal.z, 0, ex.normal.x).multiplyScalar(side);
    const pos = p.clone().add(ex.normal.clone().multiplyScalar(dist)).add(tangent);
    pos.y = ART_Y + drop * 0.35;
    const look = p.clone().add(tangent).add(new THREE.Vector3(0, drop, 0));
    return { pos, look };
  }

  function resize() {
    const w = container.clientWidth; const h = container.clientHeight;
    renderer.setSize(w, h, false);
    aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    camera.fov = aspect < 0.9 ? 60 : 50;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // ------------------------------------------------------------------ hover + click
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverEx = null;
  let pointer = null;
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hits, false)[0];
    return hit && hit.distance < 22 ? hit.object.userData.ex : null;
  }
  function onMove(e) {
    pointer = { x: e.clientX, y: e.clientY, type: e.pointerType };
    if (e.pointerType !== 'mouse') return;
    const ex = focusEx ? null : pick(e.clientX, e.clientY);
    if (ex !== hoverEx) {
      if (hoverEx) hoverEx.liftTarget = 0;
      hoverEx = ex;
      if (ex) ex.liftTarget = 1;
      renderer.domElement.style.cursor = ex ? 'pointer' : (focusEx ? 'zoom-out' : 'grab');
      dirty = true;
    }
    opts.onHover?.(ex, e.clientX, e.clientY);
  }
  function onLeave() { if (hoverEx) { hoverEx.liftTarget = 0; hoverEx = null; } opts.onHover?.(null); dirty = true; }

  let downAt = null;
  function onDown(e) { downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; }
  function onUp(e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 8) return; // that was a drag
    const ex = pick(e.clientX, e.clientY);
    if (focusEx) { if (!ex || ex !== focusEx) api.blur(); return; }
    if (!ex) return;
    if (ex.kind === 'chapter') opts.onChapter?.(ex.cat);
    else api.focus(ex);
  }
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  // ------------------------------------------------------------------ loop
  let dirty = true;
  let running = false;
  let visible = true;
  let lastCaption = -1;
  const clock = new THREE.Clock();
  const tmpPos = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();

  function tick() {
    if (!visible || document.hidden) { running = false; return; }
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const k = reduced ? 1 : 1 - Math.pow(0.0009, dt); // frame-rate independent smoothing
    const du = target - u;
    u += du * k;
    if (Math.abs(target - u) < 0.0005) u = target;
    const fT = focusEx ? 1 : 0;
    focusT += (fT - focusT) * (reduced ? 1 : 1 - Math.pow(0.004, dt));
    if (Math.abs(fT - focusT) < 0.001) focusT = fT;

    let moving = u !== target || (focusT !== 0 && focusT !== 1) || dirty;
    for (const ex of exhibits) {
      if (ex.lift !== ex.liftTarget) {
        ex.lift += (ex.liftTarget - ex.lift) * (reduced ? 1 : 1 - Math.pow(0.002, dt));
        if (Math.abs(ex.lift - ex.liftTarget) < 0.002) ex.lift = ex.liftTarget;
        ex.art.position.z = 0.06 + ease(ex.lift) * 0.22;
        ex.art.scale.setScalar(1 + ease(ex.lift) * 0.025);
        moving = true;
      }
    }
    if (!moving) return; // nothing changed: skip the GPU work

    const w = walkPose(u);
    if (focusT > 0 && (focusEx || lastFocus)) {
      const f = focusPose(focusEx || lastFocus);
      const e = ease(focusT);
      tmpPos.lerpVectors(w.pos, f.pos, e);
      tmpLook.lerpVectors(w.look, f.look, e);
    } else { tmpPos.copy(w.pos); tmpLook.copy(w.look); }
    camera.position.copy(tmpPos);
    camera.lookAt(tmpLook);
    renderer.render(scene, camera);
    dirty = false;

    const idx = Math.round(clamp(u, 0, N - 1));
    if (idx !== lastCaption && exhibits[idx].cat) { lastCaption = idx; opts.onCaption?.(exhibits[idx], idx, N); }
  }
  let lastFocus = null;
  function loop() { if (!running) { running = true; clock.getDelta(); requestAnimationFrame(tick); } }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) { dirty = true; loop(); } }).observe(container);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { dirty = true; loop(); } });
  window.addEventListener('resize', resize);
  resize();
  loop();

  const api = {
    count: WALKABLE,
    exhibits,
    setProgress(v) { target = clamp(v, 0, WALKABLE - 1); loop(); },
    get progress() { return u; },
    focus(ex) {
      if (hoverEx) { hoverEx.liftTarget = 0; hoverEx = null; }
      focusEx = ex; lastFocus = ex;
      opts.onHover?.(null);
      opts.onFocus?.(ex);
      dirty = true; loop();
    },
    blur() {
      if (!focusEx) return;
      focusEx = null;
      opts.onBlur?.();
      dirty = true; loop();
    },
    get focused() { return focusEx; },
    indexOfChapter(id) { return exhibits.findIndex((e) => e.kind === 'chapter' && e.cat.id === id); },
  };
  return api;
}

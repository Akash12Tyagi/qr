// Landing hero: a wooden table with an acrylic QR standee (showing the REAL table-1 QR),
// a floating phone with the menu on screen scanning it, drifting ingredients and rising embers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, ctx, canvas: c };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function woodTexture() {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#5a3720'); g.addColorStop(1, '#3a2213');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = `rgba(${20 + Math.random() * 30},${10 + Math.random() * 15},0,${0.08 + Math.random() * 0.15})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 64) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 8 + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
  }).tex;
}

function cardTexture(name, qrUrl) {
  const W = 600, H = 860;
  const { tex, ctx } = canvasTex(W, H, () => {});
  const paint = (qrImg) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a1a10'); g.addColorStop(1, '#0d0907');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, 0, 10, W / 2, 0, 520);
    glow.addColorStop(0, 'rgba(255,122,61,.55)'); glow.addColorStop(1, 'rgba(255,122,61,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,220,190,.25)'; ctx.lineWidth = 3;
    roundRect(ctx, 18, 18, W - 36, H - 36, 26); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff3e6';
    let size = 58;
    ctx.font = `700 ${size}px Fraunces, Georgia, serif`;
    while (ctx.measureText(name).width > W - 90 && size > 28) { size -= 2; ctx.font = `700 ${size}px Fraunces, Georgia, serif`; }
    ctx.fillText(name, W / 2, 110);
    ctx.fillStyle = '#ffb547'; ctx.font = '700 20px Inter, sans-serif';
    ctx.fillText('D I G I T A L   M E N U', W / 2, 150);
    // QR plate
    ctx.fillStyle = '#fff';
    roundRect(ctx, 110, 190, 380, 380, 26); ctx.fill();
    if (qrImg) ctx.drawImage(qrImg, 128, 208, 344, 344);
    else { ctx.fillStyle = '#ddd'; ctx.fillRect(128, 208, 344, 344); }
    // centre badge
    const bg = ctx.createLinearGradient(260, 340, 340, 420);
    bg.addColorStop(0, '#ff7a3d'); bg.addColorStop(1, '#ffb547');
    ctx.fillStyle = '#fff'; roundRect(ctx, 252, 332, 96, 96, 24); ctx.fill();
    ctx.fillStyle = bg; roundRect(ctx, 260, 340, 80, 80, 20); ctx.fill();
    ctx.font = `44px ${EMOJI_FONT}`; ctx.textBaseline = 'middle'; ctx.fillText('🔥', 300, 384); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff3e6'; ctx.font = '700 30px Inter, sans-serif';
    ctx.fillText('📱 Scan to order', W / 2, 640);
    ctx.fillStyle = 'rgba(255,240,225,.6)'; ctx.font = '600 18px Inter, sans-serif';
    ctx.fillText('Y O U   A R E   A T', W / 2, 720);
    ctx.fillStyle = '#fff3e6'; ctx.font = '700 54px Fraunces, Georgia, serif';
    ctx.fillText('Table 1', W / 2, 780);
    tex.needsUpdate = true;
  };
  paint(null);
  const img = new Image();
  img.onload = () => paint(img);
  img.src = qrUrl;
  // Repaint once web fonts are ready so the serif renders correctly.
  document.fonts?.ready?.then(() => paint(img.complete && img.naturalWidth ? img : null));
  return tex;
}

function phoneScreenTexture(name) {
  const W = 390, H = 820;
  return canvasTex(W, H, (ctx) => {
    ctx.fillStyle = '#120d0a'; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(80, 0, 10, 80, 0, 360);
    glow.addColorStop(0, 'rgba(255,122,61,.45)'); glow.addColorStop(1, 'rgba(255,122,61,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3fbf6b'; ctx.beginPath(); ctx.arc(34, 70, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#b3a597'; ctx.font = '600 15px Inter, sans-serif'; ctx.fillText('Table 1 · ordering on', 48, 75);
    ctx.fillStyle = '#ffd7b0'; ctx.font = '700 34px Fraunces, Georgia, serif';
    ctx.fillText(name.length > 16 ? `${name.slice(0, 15)}…` : name, 24, 128);
    ctx.fillStyle = '#1d1714'; roundRect(ctx, 20, 150, W - 40, 44, 22); ctx.fill();
    ctx.fillStyle = '#7c6f63'; ctx.font = '500 15px Inter, sans-serif'; ctx.fillText('🔍  Search dishes…', 38, 178);
    const chips = ['🔥 Small', '🍛 Big', '🫓 Breads'];
    chips.forEach((c, i) => {
      const x = 20 + i * 118;
      if (i === 0) { const g = ctx.createLinearGradient(x, 0, x + 110, 0); g.addColorStop(0, '#ff7a3d'); g.addColorStop(1, '#ffb547'); ctx.fillStyle = g; }
      else ctx.fillStyle = '#1d1714';
      roundRect(ctx, x, 210, 108, 36, 18); ctx.fill();
      ctx.fillStyle = i === 0 ? '#1a0d05' : '#b3a597'; ctx.font = '600 14px Inter, sans-serif'; ctx.fillText(c, x + 16, 233);
    });
    const rows = [['🧀', 'Paneer Tikka', '₹329', 28], ['🦐', 'Tandoori Prawns', '₹549', 12], ['🍲', 'Butter Chicken', '₹489', 18], ['🍛', 'Dum Biryani', '₹459', 30], ['🍮', 'Jamun Brûlée', '₹249', 25]];
    rows.forEach(([e, n, p, h], i) => {
      const y = 270 + i * 100;
      ctx.fillStyle = '#f6ece2'; ctx.font = '700 18px Inter, sans-serif'; ctx.fillText(n, 24, y + 30);
      ctx.fillStyle = '#ffb547'; ctx.font = '700 16px Inter, sans-serif'; ctx.fillText(p, 24, y + 56);
      const g = ctx.createLinearGradient(W - 110, y, W - 24, y + 80);
      g.addColorStop(0, `hsl(${h} 45% 30%)`); g.addColorStop(1, `hsl(${h + 20} 40% 14%)`);
      ctx.fillStyle = g; roundRect(ctx, W - 112, y + 4, 88, 76, 16); ctx.fill();
      ctx.font = `40px ${EMOJI_FONT}`; ctx.fillText(e, W - 90, y + 58);
      ctx.strokeStyle = 'rgba(255,236,214,.12)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(24, y + 94); ctx.lineTo(W - 24, y + 94); ctx.stroke(); ctx.setLineDash([]);
    });
    const g = ctx.createLinearGradient(0, H - 100, W, H);
    g.addColorStop(0, '#ff7a3d'); g.addColorStop(1, '#ffb547');
    ctx.fillStyle = g; roundRect(ctx, 20, H - 96, W - 40, 64, 20); ctx.fill();
    ctx.fillStyle = '#1a0d05'; ctx.font = '800 19px Inter, sans-serif'; ctx.fillText('3 items · ₹1,367      View cart →', 40, H - 56);
  }).tex;
}

function emojiSprite(emoji, scale) {
  const { tex } = canvasTex(128, 128, (ctx) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `100px ${EMOJI_FONT}`; ctx.fillText(emoji, 64, 70);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.setScalar(scale);
  return s;
}

export function mountHero(container, { qrUrl, name, reduced }) {
  // Quality tier: phones / low-core devices skip the costly transmission pass and use smaller buffers.
  const lite = Math.min(window.innerWidth, window.innerHeight) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ antialias: !lite, alpha: true, powerPreference: lite ? 'low-power' : 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.fog = new THREE.Fog(0x0e0b09, 14, 26);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

  // Lights
  scene.add(new THREE.AmbientLight(0xffe8d0, 0.25));
  const key = new THREE.SpotLight(0xffd2a0, 260, 30, 0.55, 0.6, 1.6);
  key.position.set(4, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  scene.add(key);
  const ember = new THREE.PointLight(0xff6a2a, 30, 14, 1.6);
  ember.position.set(-3.5, 2.2, 2);
  scene.add(ember);
  const rim = new THREE.DirectionalLight(0xffa860, 1.6);
  rim.position.set(-5, 4, -6);
  scene.add(rim);

  const world = new THREE.Group();
  scene.add(world);

  // Table
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7, 0.4, 96),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 }),
  );
  table.position.y = -0.2;
  table.receiveShadow = true;
  world.add(table);

  // Acrylic standee
  const standee = new THREE.Group();
  world.add(standee);
  const acrylic = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.04, transmission: lite ? 0 : 0.95, thickness: 0.4, ior: 1.49,
    transparent: true, opacity: lite ? 0.28 : 0.55, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4,
  });
  const base = new THREE.Mesh(new RoundedBoxGeometry(2.9, 0.38, 1.25, 4, 0.12), acrylic);
  base.position.y = 0.19;
  base.castShadow = true;
  standee.add(base);
  const panelGroup = new THREE.Group();
  panelGroup.position.set(0, 0.36, 0.05);
  panelGroup.rotation.x = -0.14;
  standee.add(panelGroup);
  const panel = new THREE.Mesh(new RoundedBoxGeometry(2.6, 3.7, 0.1, 4, 0.04), acrylic);
  panel.position.y = 1.85;
  panel.castShadow = true;
  panelGroup.add(panel);
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(2.36, 3.38),
    new THREE.MeshStandardMaterial({ map: cardTexture(name, qrUrl), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.08, emissiveMap: null }),
  );
  card.material.emissiveMap = card.material.map;
  card.position.set(0, 1.85, 0.056);
  card.castShadow = true;
  panelGroup.add(card);

  // Scan line sweeping over the QR area
  const scanMat = new THREE.MeshBasicMaterial({ color: 0xff8a4a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.025), scanMat);
  scan.position.set(0, 2.2, 0.07);
  panelGroup.add(scan);
  const scanGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  scan.add(scanGlow);

  // Phone
  const phone = new THREE.Group();
  world.add(phone);
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(1.42, 2.95, 0.13, 6, 0.16),
    new THREE.MeshPhysicalMaterial({ color: 0x1a1512, metalness: 0.85, roughness: 0.28, clearcoat: 1 }),
  );
  body.castShadow = true;
  phone.add(body);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.78), new THREE.MeshBasicMaterial({ map: phoneScreenTexture(name), toneMapped: false }));
  screen.position.z = 0.067;
  phone.add(screen);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.78), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.12, roughness: 0, metalness: 0, clearcoat: 1, envMapIntensity: 2 }));
  glass.position.z = 0.069;
  phone.add(glass);
  const notch = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.1, 0.02, 2, 0.05), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  notch.position.set(0, 1.27, 0.07);
  phone.add(notch);

  // Beam from phone to standee
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff8a4a, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1, 32, 1, true), beamMat);
  world.add(beam);

  // Plates of food on the table
  const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xf5efe6, roughness: 0.3, clearcoat: 1 });
  const plates = [[2.6, 2.4, '🍛'], [3.4, -1.2, '🫓'], [-0.9, -2.9, '🍹']].map(([x, z, e]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.6, 0.12, 48), plateMat);
    p.position.set(x, 0.06, z);
    p.castShadow = true; p.receiveShadow = true;
    world.add(p);
    const s = emojiSprite(e, 1.1);
    s.position.set(x, 0.62, z);
    world.add(s);
    return s;
  });

  // Floating ingredients
  const floaters = ['🌶️', '🧄', '🍋', '🌿', '🧅', '🍅', '⭐', '🫚'].map((e, i) => {
    const s = emojiSprite(e, 0.45 + (i % 3) * 0.12);
    s.userData = { r: 2.6 + (i % 3) * 0.6, a: (i / 8) * Math.PI * 2, y: 1.2 + (i % 4) * 0.8, sp: 0.08 + (i % 3) * 0.03 };
    world.add(s);
    return s;
  });

  // Embers
  const N = lite ? 70 : 160;
  const egeo = new THREE.BufferGeometry();
  const epos = new Float32Array(N * 3);
  const espd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    epos[i * 3] = (Math.random() - 0.5) * 14;
    epos[i * 3 + 1] = Math.random() * 8;
    epos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    espd[i] = 0.2 + Math.random() * 0.6;
  }
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  const dot = canvasTex(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,220,160,1)'); g.addColorStop(0.3, 'rgba(255,140,60,.8)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  }).tex;
  const embers = new THREE.Points(egeo, new THREE.PointsMaterial({ size: 0.12, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(embers);

  // Layout: desktop → objects on the right; mobile → objects up top
  let mobile = false;
  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    mobile = camera.aspect < 0.9;
    camera.fov = mobile ? 40 : 32;
    camera.updateProjectionMatrix();
    world.position.set(mobile ? -1.1 : 3.4, 0, 0);
    world.scale.setScalar(mobile ? 0.8 : 1);
  }
  layout();
  const ro = 'ResizeObserver' in window ? new ResizeObserver(layout) : null;
  ro?.observe(container);
  window.addEventListener('resize', layout);

  // Pointer parallax
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // Pause when off-screen / hidden
  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); }).observe(container);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  let running = false;
  function loop() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }
  function tick() {
    if (!visible || document.hidden) { running = false; return; }
    requestAnimationFrame(tick);
    const rawDt = clock.getDelta(); // must be read before elapsedTime
    const t = reduced ? 2 : clock.elapsedTime;
    const dt = reduced ? 0 : Math.min(rawDt, 0.05);
    const scrollK = Math.min(1, window.scrollY / (window.innerHeight || 1));

    cur.x += (target.x - cur.x) * 0.05;
    cur.y += (target.y - cur.y) * 0.05;
    const camR = 13.5;
    const ang = -0.35 + cur.x * 0.18 + scrollK * 0.6;
    camera.position.set(Math.sin(ang) * camR + world.position.x * 0.4, 5.4 + cur.y * 0.6 + scrollK * 2, Math.cos(ang) * camR);
    camera.lookAt(world.position.x * 0.55, world.position.y + 1.7, 0);

    standee.rotation.y = Math.sin(t * 0.4) * 0.12 - 0.2;
    // Phone floats in front-right of the standee, gently bobbing, angled toward the card
    phone.position.set(1.9 + Math.sin(t * 0.7) * 0.08, 2.6 + Math.sin(t * 1.1) * 0.15, 2.4);
    phone.rotation.set(-0.15 + Math.sin(t * 0.9) * 0.04, -0.55 + Math.sin(t * 0.6) * 0.06, 0.12);

    // Scan line sweeps the QR (top 2.85 → bottom 1.55 in panel space)
    const sweep = (Math.sin(t * 1.6) + 1) / 2;
    scan.position.y = 1.55 + sweep * 1.3;
    scanMat.opacity = 0.55 + Math.sin(t * 8) * 0.25;

    // Beam: from phone back to card centre
    phone.getWorldPosition(tmp);
    card.getWorldPosition(tmp2);
    world.worldToLocal(tmp); world.worldToLocal(tmp2);
    const mid = tmp.clone().add(tmp2).multiplyScalar(0.5);
    const len = tmp.distanceTo(tmp2);
    beam.position.copy(mid);
    beam.scale.set(1, len, 1);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmp2.clone().sub(tmp).normalize());
    beamMat.opacity = 0.06 + sweep * 0.08;

    floaters.forEach((s, i) => {
      const u = s.userData;
      const a = u.a + t * u.sp;
      s.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.8 + i) * 0.25, Math.sin(a) * u.r * 0.7);
      s.material.rotation = Math.sin(t + i) * 0.3;
    });
    plates.forEach((s, i) => { s.position.y = 0.62 + Math.sin(t * 1.3 + i * 2) * 0.05; });

    for (let i = 0; i < N; i++) {
      epos[i * 3 + 1] += espd[i] * dt;
      epos[i * 3] += Math.sin(t + i) * 0.002;
      if (epos[i * 3 + 1] > 8) { epos[i * 3 + 1] = 0; epos[i * 3] = (Math.random() - 0.5) * 14; }
    }
    egeo.attributes.position.needsUpdate = true;
    ember.intensity = 26 + Math.sin(t * 7) * 4 + Math.sin(t * 13) * 2;

    renderer.render(scene, camera);
    if (reduced) { running = false; visible = false; } // render a single still frame
  }
  loop();
  container.classList.add('ready');
}

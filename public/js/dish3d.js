// Interactive 3D "plated dish" viewer for the item sheet.
// Procedural: a ceramic plate (lathe geometry) with the dish's illustration laid in the well, rising steam and a warm rim light. Drag to spin, auto-rotates.
import * as THREE from 'three';
import { drawPlated } from './dishart.js';

function softDot(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function mountDish(container, item) {
  const w = () => container.clientWidth || 360;
  const h = () => container.clientHeight || 270;
  const hue = (Number(item.hue) || 30) / 360;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w(), h());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, w() / h(), 0.1, 100);
  camera.position.set(0, 3.1, 5.6);
  camera.lookAt(0, 0.35, 0);

  // Lights
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a160c, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new THREE.PointLight(new THREE.Color().setHSL(hue, 1, 0.6), 18, 12);
  rim.position.set(-3, 2, -2.5);
  scene.add(rim);

  // Table surface (receives shadow)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const group = new THREE.Group();
  scene.add(group);

  // Plate: lathe profile (foot → well → rim)
  const pts = [
    [0, 0.02], [0.9, 0.02], [0.95, 0.06], [1.05, 0.1], [1.35, 0.14], [1.7, 0.26], [1.82, 0.3], [1.85, 0.27], [1.72, 0.2], [1.3, 0.1], [0, 0.08],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const plate = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 96),
    new THREE.MeshPhysicalMaterial({ color: 0xf7f2ea, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide }),
  );
  plate.castShadow = true;
  plate.receiveShadow = true;
  group.add(plate);

  // Gold rim band
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(1.8, 0.018, 12, 128),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.25 }),
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.29;
  group.add(band);

  // Sauce swoosh (coloured disc) in the well
  const sauce = new THREE.Mesh(
    new THREE.CircleGeometry(1.36, 64),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.35, 0.82), roughness: 0.35, metalness: 0.05 }),
  );
  sauce.rotation.x = -Math.PI / 2;
  sauce.position.y = 0.105;
  sauce.receiveShadow = true;
  group.add(sauce);

  // The dish itself: the illustrated food laid into the plate's well as a decal, with a
  // soft occlusion ring so it sits in the sauce rather than floating on it.
  const foodTex = new THREE.CanvasTexture(drawPlated(item, 1024, { withPlate: false }));
  foodTex.colorSpace = THREE.SRGBColorSpace;
  foodTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const food = new THREE.Mesh(
    new THREE.CircleGeometry(1.32, 96),
    new THREE.MeshStandardMaterial({ map: foodTex, transparent: true, roughness: 0.42, metalness: 0, alphaTest: 0.02 }),
  );
  food.rotation.x = -Math.PI / 2;
  food.position.y = 0.118;
  food.receiveShadow = true;
  group.add(food);

  // Steam
  const STEAM = 40;
  const steamGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(STEAM * 3);
  const life = new Float32Array(STEAM);
  for (let k = 0; k < STEAM; k++) { life[k] = Math.random(); }
  steamGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
    size: 0.5, map: softDot(), transparent: true, opacity: 0.18, depthWrite: false, color: 0xffffff,
  }));
  scene.add(steam);

  // Interaction: drag to spin with inertia
  let rotY = 0;
  let vel = 0.004;
  let dragging = false;
  let lastX = 0;
  const el = renderer.domElement;
  const down = (e) => { dragging = true; lastX = e.clientX; el.style.cursor = 'grabbing'; };
  const move = (e) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; vel = dx * 0.0035; rotY += dx * 0.01; };
  const up = () => { dragging = false; el.style.cursor = 'grab'; };
  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);

  const onResize = () => { renderer.setSize(w(), h()); camera.aspect = w() / h(); camera.updateProjectionMatrix(); };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
  ro?.observe(container);

  const clock = new THREE.Clock();
  let raf = 0;
  let alive = true;
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!dragging) { vel += (0.004 - vel) * 0.02; rotY += vel; }
    group.rotation.y = rotY;
    rim.intensity = 16 + Math.sin(t * 3) * 3;
    for (let k = 0; k < STEAM; k++) {
      life[k] += dt * (0.25 + (k % 5) * 0.04);
      if (life[k] > 1) life[k] = 0;
      const a = k * 2.399;
      const r = 0.25 + (k % 7) * 0.06;
      pos[k * 3] = Math.cos(a + t * 0.3) * r + Math.sin(t + k) * 0.05;
      pos[k * 3 + 1] = 1.3 + life[k] * 1.6;
      pos[k * 3 + 2] = Math.sin(a + t * 0.3) * r;
    }
    steamGeo.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
  }
  // Pop-in animation
  group.scale.setScalar(0.01);
  const start = performance.now();
  (function grow() {
    const k = Math.min(1, (performance.now() - start) / 650);
    const e = 1 - Math.pow(1 - k, 3);
    group.scale.setScalar(0.01 + e * 0.99);
    if (k < 1 && alive) requestAnimationFrame(grow);
  })();
  frame();

  return {
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((mm) => { mm.map?.dispose?.(); mm.dispose?.(); });
      });
      renderer.dispose();
      renderer.forceContextLoss?.();
      el.remove();
    },
  };
}

import { $, $$, api, webglAvailable, prefersReducedMotion } from './common.js';

const qrPng = '/api/qr/T1?format=png&size=600&margin=1';
$('#demoQr').src = '/api/qr/T1?margin=1';
$('#fallbackQr').src = '/api/qr/T1?margin=1';

api('/api/menu').then((m) => {
  $('#restName').textContent = m.restaurant.name;
  if (m.restaurant.accent) document.documentElement.style.setProperty('--accent', m.restaurant.accent);
  boot3d(m.restaurant);
}).catch(() => boot3d({ name: 'Ember & Saffron' }));

if (/localhost|127\.0\.0\.1/.test(location.hostname)) {
  $('#lanHint').textContent = 'You are on localhost — open this page via your computer’s network IP (shown in the server console) so the QR works from a phone.';
}

async function boot3d(restaurant) {
  const host = $('#heroCanvas');
  if (!webglAvailable()) { document.body.classList.add('no-webgl'); return; }
  try {
    const { mountHero } = await import('./hero3d.js');
    mountHero(host, { qrUrl: qrPng, name: restaurant.name || 'Our Kitchen', reduced: prefersReducedMotion() });
  } catch (e) {
    console.warn('3D hero failed, using fallback', e);
    document.body.classList.add('no-webgl');
  }
}

// Scroll reveal
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
}, { threshold: 0.15 }) : null;
$$('.steps li, .f, .demo-card, .sec-h').forEach((el, i) => {
  if (!io) return;
  el.classList.add('reveal');
  el.style.transitionDelay = `${(i % 4) * 80}ms`;
  io.observe(el);
});

// 3D tilt on feature cards
if (!prefersReducedMotion()) {
  $$('.f').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });
}

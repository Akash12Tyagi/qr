import { $, api } from './common.js';

// Where to go after signing in: the server decides by account (owner/staff → their
// restaurant's console, platform → /platform). A ?next= link is honoured only when it
// points inside that same area, so it can never send anyone off-site.
const next = new URLSearchParams(location.search).get('next') || '';
const safeNext = (dest) => {
  if (!/^\/(?![/\\])[\w\-./#?=&%]*$/.test(next)) return dest;
  const area = dest.replace(/#.*$/, '');
  return next === area || next.startsWith(`${area}#`) || next.startsWith(`${area}?`) ? next : dest;
};

// Already signed in? Skip the form.
api('/api/auth/me').then((me) => {
  if (me.role === 'platform') location.replace('/platform');
  else if (me.tenant) location.replace(safeNext(`/r/${me.tenant.slug}/admin`));
}).catch(() => { /* not signed in */ });

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#err');
  const btn = $('#submit');
  err.classList.add('hidden');
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || !password) { show('Enter your email and password.'); return; }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const out = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    location.replace(safeNext(out.next));
  } catch (ex) {
    show(ex.message);
    $('#password').select();
    const card = $('.login-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
  function show(msg) { err.textContent = msg; err.classList.remove('hidden'); }
});

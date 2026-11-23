import { $, esc, api, toast } from './common.js';

let data = { tenants: [], defaultSlug: '' };

async function call(path, opts) {
  try { return await api(path, opts); } catch (e) {
    if (e.status === 401 || e.status === 403) location.replace('/login?next=/platform');
    throw e;
  }
}

boot();
async function boot() {
  try {
    const me = await api('/api/auth/me');
    if (me.role !== 'platform') { location.replace(me.tenant ? `/r/${me.tenant.slug}/admin` : '/login'); return; }
  } catch { location.replace('/login?next=/platform'); return; }
  $('#app').classList.remove('hidden');
  await load();
}

async function load() {
  try { data = await call('/api/platform/tenants'); render(); } catch (e) { toast(e.message, { error: true }); }
}

function render() {
  const n = data.tenants.length;
  const active = data.tenants.filter((t) => t.status === 'active').length;
  $('#summary').textContent = `${n} restaurant${n === 1 ? '' : 's'} · ${active} active. Each has its own menu, QR codes, kitchen console and team.`;
  $('#tenants').innerHTML = data.tenants.map((t) => `
    <article class="card-box tenant${t.status !== 'active' ? ' suspended' : ''}" data-id="${esc(t.id)}">
      <div>
        <h3>${esc(t.name)} ${t.status !== 'active' ? '<span class="chip warn">Suspended</span>' : ''} ${t.slug === data.defaultSlug ? '<span class="chip">Home page demo</span>' : ''}</h3>
        <div class="muted">/${esc(t.slug)} · owner ${esc(t.owners.join(', ') || '—')} · ${esc(t.staff)} staff · since ${esc(new Date(t.createdAt).toLocaleDateString())}</div>
        <div class="links"><a href="/r/${esc(t.slug)}/menu?t=T1" target="_blank" rel="noopener">Guest menu ↗</a><a href="/r/${esc(t.slug)}/print" target="_blank" rel="noopener">Print QR cards ↗</a></div>
      </div>
      <div class="acts">
        <button class="btn btn-sm btn-ghost" type="button" data-act="reset">Reset owner password</button>
        ${t.slug !== data.defaultSlug && t.status === 'active' ? '<button class="btn btn-sm btn-ghost" type="button" data-act="default">Use on home page</button>' : ''}
        <button class="btn btn-sm ${t.status === 'active' ? 'btn-danger' : 'btn-primary'}" type="button" data-act="status">${t.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
      </div>
    </article>`).join('') || '<p class="muted">No restaurants yet.</p>';
}

$('#tenants').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const t = data.tenants.find((x) => x.id === btn.closest('.tenant').dataset.id);
  if (!t) return;
  const id = encodeURIComponent(t.id);
  btn.disabled = true;
  try {
    if (btn.dataset.act === 'status') {
      const to = t.status === 'active' ? 'suspended' : 'active';
      if (to === 'suspended' && !confirm(`Suspend ${t.name}? Its menu, ordering and kitchen console stop working until you reactivate it. No data is deleted.`)) return;
      await call(`/api/platform/tenants/${id}`, { method: 'PATCH', body: { status: to } });
      toast(to === 'active' ? `${t.name} is live again` : `${t.name} suspended`);
    } else if (btn.dataset.act === 'default') {
      await call('/api/platform/default', { method: 'PUT', body: { slug: t.slug } });
      toast(`${t.name} now shows on the home page`);
    } else {
      if (!confirm(`Give the owner of ${t.name} a new temporary password? They are signed out everywhere.`)) return;
      const out = await call(`/api/platform/tenants/${id}/reset-owner`, { method: 'POST' });
      showCreds(t.name, t.slug, out.email, out.tempPassword);
    }
    await load();
  } catch (err) { toast(err.message, { error: true }); } finally { btn.disabled = false; }
});

$('#newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#newErr');
  err.classList.add('hidden');
  const fd = new FormData(f);
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const out = await call('/api/platform/tenants', { method: 'POST', body: {
      name: fd.get('name'), slug: String(fd.get('slug') || '').trim().toLowerCase(), ownerEmail: fd.get('ownerEmail'),
      ownerName: fd.get('ownerName'), sample: fd.has('sample'),
    } });
    f.reset();
    await load();
    showCreds(out.tenant.name, out.tenant.slug, out.owner.email, out.owner.tempPassword);
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

// The temporary password exists only in this response: shown once, never stored.
function showCreds(name, slug, email, pw) {
  const form = $('#dlgForm');
  form.innerHTML = `<h2 class="display">${esc(name)}: owner sign-in</h2>
    <p class="muted">Send these to the owner privately. They’ll choose their own password at first sign-in. This password is not shown again.</p>
    <div class="cred"><span>Sign in at</span><code>${esc(location.origin)}/login</code><span>Email</span><code>${esc(email)}</code><span>Temporary password</span><code class="pw">${esc(pw)}</code><span>Guest menu</span><code>${esc(location.origin)}/r/${esc(slug)}/menu</code></div>
    <div class="dlg-actions"><button class="btn btn-primary" value="ok">Done</button></div>`;
  $('#dlg').showModal();
}

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.replace('/login');
});

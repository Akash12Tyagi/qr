// Photo strip on /brand (illustrative only), from the default restaurant's menu.
import { api, esc } from './common.js';

try {
  const t = await api('/api/default-tenant');
  const { items } = await api(`/api/r/${encodeURIComponent(t.slug)}/menu`);
  const pick = ['i5', 'i12', 'i1', 'i15', 'i3', 'i17', 'i9', 'i19'];
  const list = pick.map((id) => items.find((i) => i.id === id)).filter((i) => i && i.image);
  document.getElementById('photos').innerHTML = list.map((i) => `<figure><img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy" decoding="async" width="400" height="500"><figcaption>${esc(i.name)}</figcaption></figure>`).join('');
} catch { /* photos are illustrative only */ }

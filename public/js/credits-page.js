// /credits: photographer attributions for the bundled dish photos.
import { esc } from './common.js';
import seedNames from './seed-names.js';

const safe = (u) => (/^https?:\/\//.test(u || '') ? esc(u) : '#');
try {
  const credits = await fetch('/img/dishes/credits.json').then((r) => r.json());
  const name = (id) => seedNames[id] || id;
  document.getElementById('list').innerHTML = credits.map((c) => `
    <li><img src="/img/dishes/${esc(c.id)}-sq.jpg" alt="" loading="lazy" width="72" height="72">
      <div><b>${esc(name(c.id))}</b>
        <span>“${esc(c.title || 'Untitled')}” by <a href="${safe(c.creatorUrl)}" rel="noopener">${esc(c.creator || 'unknown')}</a></span>
        <span><a href="${safe(c.licenseUrl)}" rel="noopener">${esc(c.license)}</a> · <a href="${safe(c.source)}" rel="noopener">source</a></span></div></li>`).join('');
} catch { document.getElementById('list').innerHTML = '<li>Credits unavailable.</li>'; }

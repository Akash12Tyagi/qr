'use strict';
// Copies the few three.js files the pages import into public/vendor/three so a static
// host (Vercel's CDN) can serve them. Locally, Express serves them from node_modules.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'three');
const dest = path.join(root, 'public', 'vendor', 'three');
const files = [
  'build/three.module.min.js',
];
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
console.log(`vendored ${files.length} three.js files -> public/vendor/three`);

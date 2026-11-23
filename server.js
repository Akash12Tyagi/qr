'use strict';

const os = require('os');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

const server = app.listen(PORT, async () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log('\n  QR Menu (multi-restaurant) running');
  console.log(`  ➜ Local:    http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  ➜ Network:  http://${ip}:${PORT}   (scan QR codes from your phone on the same Wi-Fi)`);
  console.log(`  ➜ Sign in:  http://localhost:${PORT}/login   (restaurant owners & staff, and the platform owner)`);
  try { await app.locals.ready(); } catch (err) { console.error('  ✗ Storage not ready:', err.message); }
});

function shutdown() {
  app.locals.closeStreams();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

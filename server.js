'use strict';

const os = require('os');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

const server = app.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`\n  🔥 QR Menu running`);
  console.log(`  ➜ Local:    http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  ➜ Network:  http://${ip}:${PORT}   (scan QR codes from your phone on the same Wi-Fi)`);
  console.log(`  ➜ Admin:    http://localhost:${PORT}/admin   (PIN: ${process.env.ADMIN_PIN ? '••••' : '1234'})\n`);
});

function shutdown() {
  app.locals.closeStreams();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

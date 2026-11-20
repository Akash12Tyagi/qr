'use strict';
// Vercel serverless entry: every /api/* request is routed here (see vercel.json).
// Static pages are served from /public by Vercel's CDN.
const { createApp } = require('../src/app');

module.exports = createApp();

# 🔥 QR Menu Cards

Printed table standees with a QR code that open a **live, orderable menu in the phone's browser**. No app to download. Orders go straight to a real-time kitchen console.

```
 Table standee (QR: /menu?t=T3) ──scan──▶ Guest menu (browser) ──order──▶ Kitchen console (live)
                                              ▲                                  │
                                              └───── live status updates ◀───────┘
```

## Features

**Guest menu** (`/menu?t=T1`, mobile first)
- Brand header with table badge, hours and Wi‑Fi
- Search with highlighting, Veg / Popular / Mild filters, sticky category tabs with scroll-spy
- "Chef's picks" carousel with 3D tilt cards
- Dish sheet with an **interactive 3D plated dish** (Three.js: ceramic plate, garnish, steam, drag to spin)
- Cart with per-dish notes, GST/service breakdown, kitchen note, name
- **Live order tracker** (Server-Sent Events): Placed → Accepted → Cooking → Ready → Served
- Call staff button (waiter / water / cutlery / bill)
- Light & dark theme, cart saved per table, works in "browsing mode" without a table

**Kitchen console** (`/admin`, PIN protected)
- Live kanban board with chime + flashing new orders, one-tap status, mark paid, cancel
- Waiter-call alerts
- Menu manager: add / edit / delete dishes and categories, **sold-out toggle** that updates every phone
- Tables & QR: generate a QR per table, copy link, download PNG (1200px), print
- Insights: revenue today, orders, avg ticket, revenue by hour, top dishes
- Settings: name, tagline, currency, GST %, service %, accent colour, hours, Wi‑Fi, public URL for QR codes

**Print studio** (`/print`): A6 acrylic standee inserts (4 per A4), fold-over table tents, or 3×3 card grid — with a 3D on-screen preview and high error-correction QR codes carrying your brand badge.

**Landing page** (`/`): 3D hero scene — wooden table, acrylic standee showing the real Table 1 QR, a floating phone scanning it, drifting ingredients and embers. Lighter render tier on phones; static fallback without WebGL.

## Quick start

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000 — the console is at `/admin` (demo PIN **1234**).

To scan the QR codes from a real phone, open the console using the **Network** address printed in the terminal (same Wi‑Fi), or set **Settings → Public URL** to your deployed domain. QR codes encode that base URL.

## Configuration

| Env var     | Default | Purpose                         |
|-------------|---------|---------------------------------|
| `PORT`      | `3000`  | HTTP port                       |
| `ADMIN_PIN` | `1234`  | Staff PIN for the console & API |

Data lives in `data/db.json` (created from `data/seed.js` on first run; delete it to reset, or use **Settings → Reset demo data**).

## API (summary)

Public: `GET /api/menu`, `GET /api/tables`, `GET /api/tables/:id`, `POST /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/events` (SSE), `POST /api/calls`, `GET /api/qr/:tableId[?format=png&size=…]`

Admin (header `x-admin-pin`): `GET /api/admin/state|stats|stream`, `PATCH /api/admin/orders/:id`, `PATCH /api/admin/calls/:id`, `POST|PUT|DELETE /api/admin/items`, `POST|DELETE /api/admin/categories`, `POST|DELETE /api/admin/tables`, `PUT /api/admin/restaurant`, `POST /api/admin/reset`

Security notes: order totals are always recomputed on the server from the stored menu (client prices are ignored); sold-out dishes are rejected; inputs are length-limited and sanitised; all user text is HTML-escaped in the UI; customer IPs are never returned; basic per-IP rate limits on ordering and staff calls; PIN compared in constant time.

## Tests

```bash
npm test
```

Covers pages & assets, QR generation, the order flow, validation, sold-out handling, admin CRUD, waiter calls, and the live SSE stream.

## Stack

Node 18+ · Express · `qrcode` · Three.js (served locally, no CDN) · vanilla ES modules (no build step) · JSON-file store with atomic writes (swap `src/db.js` for a database when you scale).

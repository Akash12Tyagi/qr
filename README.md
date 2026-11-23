# 🔥 QR Menu Cards

Printed table standees with a QR code that open a **live, orderable menu in the phone's browser**. No app to download. Orders go straight to a real-time kitchen console.

```
 Table standee (QR: /menu?t=T3) ──scan──▶ Guest menu (browser) ──order──▶ Kitchen console (live)
                                              ▲                                  │
                                              └───── live status updates ◀───────┘
```

## Brand — “Ink & Saffron”

One brand direction runs through every surface (landing, menu book, list view, kitchen console, printed standees). The full guide lives at **`/brand`**; tokens are in `public/css/brand.css`.

| | |
|---|---|
| **Saffron** `#F4A51C` | the spice and the flame — primary actions, price markers, the highlighter stroke, large type on ink |
| **Ink** `#14110F` | the night kitchen — type, frames, the menu-book cover, dark rooms |
| Cream `#F7F3EA` | the neutral (paper, plates, daylight) |
| **Poppins** 500–700 | display: headlines, prices, the wordmark |
| **Geist** / Geist Mono | text and interface / small uppercase labels |

Rules: saffron is a fill or large-type colour (small saffron text on cream uses `--saffron-text`); no gradients on type, no italics, no emoji. Fonts are self-hosted from `public/fonts` (OFL licences included) — no third-party font requests. Dish photography is real food under Creative Commons licences via Openverse; attributions are listed at **`/credits`** (`public/img/dishes/credits.json`). Each dish ships a 4:5 photo and a 1:1 thumbnail.

## Features

**Guest menu** (`/menu?t=T1`) — a modern dine-in list, light by default (dark theme one tap away)
- Photo hero, sticky search + Veg / Chef's picks / Mild filters, category tabs that follow your scroll
- "Chef's picks" photo carousel with quick add; dish rows with real photos, veg marks, spice and prep time
- Dish sheet opens on the full photo; cart with per-dish notes, GST/service breakdown and your name
- **Live order tracker** (SSE locally, polling on serverless): Placed → Accepted → Cooking → Ready → Served
- Bottom dock: call staff (waiter / water / cutlery / bill) · **Bill · Pay** · View order
- Smooth scrolling: no scroll listeners or smooth-scroll fights, lazy async images, `content-visibility` on long sections

**Pay & split the bill** (from the dock or the order tracker)
- One table bill for everyone who ordered at that table, with every dish and who ordered it
- **Whole bill**, **Split equally** (people at the table + how many shares you’re covering) or **My items** (tick your dishes; GST and service shared in proportion). Dishes someone has paid for show “Paid by …” and can’t be claimed twice
- Pay with **UPI** (opens the guest’s UPI app with the amount when a UPI ID is set in Settings), **card** or **cash** at the table
- Amounts are always computed by the server; each payment waits for staff to confirm it arrived, then updates live on every phone at the table. When confirmed payments cover the bill, the table **settles automatically** (orders marked paid, next guests start fresh)

> The page-turning **menu book** (`public/js/book.js`, `public/css/book.css`) is kept in the repo but switched off — its markup and wiring are commented out in `menu.html` / `menu.js` (see commit 9543a51 to restore).

**Kitchen console** (`/admin`, PIN protected)
- **Bills** tab: every open table bill with received / waiting / left to pay, each payment (who, how much, UPI/card/cash, whole bill / equal share / own dishes) with one-tap *Received* or *Not received*, manual *Settle table*, and today’s settled payments. New payments chime and toast live
- Live kanban board with chime + flashing new orders, one-tap status, mark paid, cancel
- Waiter-call alerts
- Menu manager: add / edit / delete dishes and categories, **sold-out toggle** that updates every phone
- Tables & QR: generate a QR per table, copy link, download PNG (1200px), print
- Insights: revenue today, orders, avg ticket, revenue by hour, top dishes
- Settings: name, tagline, currency, GST %, service %, accent colour, hours, Wi‑Fi, public URL for QR codes

**Print studio** (`/print`): A6 acrylic standee inserts (4 per A4), fold-over table tents, or 3×3 card grid — with a 3D on-screen preview and high error-correction QR codes carrying your brand badge.

**Landing page** (`/`) — a walkable 3D gallery (Three.js), in the spirit of a gallery-site rotunda: you stand in a bright, curved room and **scroll or drag to walk round**. Each menu chapter opens with a title card; every dish hangs as a framed photograph with a museum label in a glowing arched niche. Hover shows a "Look closer" pill; click dollies the camera up to the print and opens a detail card ("Find it in the menu book" deep-links to that chapter). Below: the menu-as-a-book, how it works, and the kitchen features with the live QR. Light editorial design on the brand palette; renders only when something moves; static fallback without WebGL.

## Quick start

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000 — the console is at `/admin` (demo PIN **1234**).

To scan the QR codes from a real phone, open the console using the **Network** address printed in the terminal (same Wi‑Fi), or set **Settings → Public URL** to your deployed domain. QR codes encode that base URL.

## Deploy to Vercel (with Neon Postgres)

The app runs unchanged on Vercel: static pages come from `public/` via the CDN and `/api/*` runs as a serverless function (`api/index.js`).

- **Storage:** set `DATABASE_URL` (added automatically by the Neon integration: `vercel integration add neon`) and all state lives in one Postgres row, written in row-locked transactions so concurrent orders never clash. Without it, the app uses `data/db.json`.
- **Live updates:** serverless functions can't hold Server-Sent Events, so on Vercel the kitchen console and order tracker poll every 3–4 s instead (`GET /api/admin/changes?since=…`). Locally you still get instant SSE.
- `npm run build` copies the three.js files the pages need into `public/vendor/three`.

```bash
vercel deploy --prod
```

Set `ADMIN_PIN` in the Vercel project's environment variables before real use.

## Configuration

| Env var     | Default | Purpose                         |
|-------------|---------|---------------------------------|
| `PORT`      | `3000`  | HTTP port                       |
| `ADMIN_PIN` | `1234`  | Staff PIN for the console & API |
| `DATABASE_URL` | — | Postgres (Neon) connection string; uses `data/db.json` when unset |

Data lives in `data/db.json` (created from `data/seed.js` on first run; delete it to reset, or use **Settings → Reset demo data**).

## API (summary)

Public: `GET /api/menu`, `GET /api/tables`, `GET /api/tables/:id`, `GET /api/tables/:id/bill`, `POST /api/tables/:id/payments`, `POST /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/events` (SSE), `POST /api/calls`, `GET /api/qr/:tableId[?format=png&size=…]`

Admin (header `x-admin-pin`): `GET /api/admin/state|stats|stream`, `PATCH /api/admin/orders/:id`, `PATCH /api/admin/calls/:id`, `PATCH /api/admin/payments/:id`, `POST /api/admin/tables/:id/settle`, `POST|PUT|DELETE /api/admin/items`, `POST|DELETE /api/admin/categories`, `POST|DELETE /api/admin/tables`, `PUT /api/admin/restaurant`, `POST /api/admin/reset`

Security notes: order totals are always recomputed on the server from the stored menu (client prices are ignored); sold-out dishes are rejected; inputs are length-limited and sanitised; all user text is HTML-escaped in the UI; customer IPs are never returned; basic per-IP rate limits on ordering and staff calls; PIN compared in constant time.

## Tests

```bash
npm test
```

Covers pages & assets, QR generation, the order flow, validation, sold-out handling, admin CRUD, waiter calls, and the live SSE stream.

## Stack

Node 18+ · Express · `qrcode` · Three.js (served locally, no CDN) · vanilla ES modules (no build step) · JSON-file store with atomic writes (swap `src/db.js` for a database when you scale).

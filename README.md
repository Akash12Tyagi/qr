# 🔥 QR Menu Cards

Printed table standees with a QR code that open a **live, orderable menu in the phone's browser**. No app to download. Orders go straight to a real-time kitchen console.

```
 Table standee (QR: /menu?t=T3) ──scan──▶ Guest menu (browser) ──order──▶ Kitchen console (live)
                                              ▲                                  │
                                              └───── live status updates ◀───────┘
```

## Features

**The Menu Book** (`/menu?t=T1`, default view) — the menu as a cinematic, page-turning book:
- Title sequence: the restaurant's name writes itself in, then the book rises off a walnut table into a warm spotlight (once per visit; skipped with reduced motion)
- Oxblood book-cloth cover with animated gold foil and a monogram; an endpaper bookplate ("This menu belongs to Table 3")
- **Scroll to turn pages** (also swipe, the ← / → buttons, arrow keys, or tap a page edge). On phones the camera visits the **left page, then the right page** of every spread, so going back always reveals the left side Pages bend and catch the light as they lift; the page stack thins as you read
- Every dish is drawn as an original flat illustration (procedural, `public/js/dishart.js` — no photos or emoji needed); rows show a plated thumbnail, and every spread pairs a framed "plate print" (gallery-style frame and mat) with an editorial menu page: chapter numerals, dotted price leaders, chef's picks, spice and prep time, a "Sold out" stamp
- Contents page with page numbers, chef's pairing tailpieces on short pages, and a "Fin." colophon to review the order or call the waiter
- Film grain, dust motes in the light, a gold reading-progress line; text stays razor-sharp at rest
- Design language follows the reference brief: paper `#f6f4ee`, ink `#111110`, frame `#191917`, small-caps monospace labels, physical easing

**List view** (one tap from the book) — the fast, searchable version
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

**Landing page** (`/`) — a walkable 3D gallery (Three.js), in the spirit of a gallery-site rotunda: you stand in a bright, curved room and **scroll or drag to walk round**. Each menu chapter opens with a title card; every dish hangs as a framed illustrated print with a museum label in a glowing arched niche. Hover shows a "Look closer" pill; click dollies the camera up to the print and opens a detail card ("Find it in the menu book" deep-links to that chapter). Below: the menu-as-a-book, how it works, and the kitchen features with the live QR. Light editorial design, no emoji; static fallback without WebGL.

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

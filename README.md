# 🔥 QR Menu Cards — multi-restaurant SaaS

Printed table standees with a QR code that open a **live, orderable menu in the phone's browser**. No app to download. Orders go straight to a real-time kitchen console.

**One deployment serves any number of restaurants.** Each restaurant has its own web address (`/r/<restaurant>/…`), menu, tables and QR codes, kitchen console, bills and team — and can never see another restaurant's data. You (the platform owner) add restaurants from `/platform`. Architecture and security design: [`docs/SAAS_ARCHITECTURE.md`](docs/SAAS_ARCHITECTURE.md).

```
 Table standee (QR: /r/blue-lotus/menu?t=T3) ──scan──▶ Guest menu (browser) ──order──▶ That restaurant's kitchen console (live)
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

**Restaurant home page** (`/r/<restaurant>`) — the link you give each restaurant
- Its name, tagline, opening hours (with an open-now dot), guests' favourites with photos, menu chapters, how ordering works, and visit details (hours, Wi‑Fi, payment)
- **The restaurant's own QR code**: scanning it with a phone opens that restaurant's menu (`/r/<restaurant>/menu`). Table QR codes still open the menu for that table, so orders are tagged with it
- On phones a fixed "Open the menu" button keeps the menu one tap away
- **Home page first**: a plain `/r/<restaurant>/menu` link redirects to `/r/<restaurant>`. The menu opens directly only from the restaurant QR (`?src=qr`), a table QR (`?t=T3`), a home-page button (`?src=home`) or a menu-section link (`?ch=…`)

**Guest menu** (`/r/<restaurant>/menu?t=T1`) — a modern dine-in list, light by default (dark theme one tap away)
- Photo hero, sticky search + Veg / Chef's picks / Mild filters, category tabs that follow your scroll
- "Chef's picks" photo carousel with quick add; dish rows with real photos, veg marks, spice and prep time
- Dish sheet opens on the full photo; cart with per-dish notes, GST/service breakdown and your name
- **Live order tracker** (SSE locally, polling on serverless): Placed → Accepted → Cooking → Ready → Served
- Bottom dock: call staff (waiter / water / cutlery / bill) · **Bill · Pay** · View order
- Smooth scrolling: no scroll listeners or smooth-scroll fights, lazy async images, `content-visibility` on long sections

**Pay & split the bill** (from the dock or the order tracker)
- **Bill · Pay is always in the dock** — guests who came in through the restaurant QR (no table in the link) pick their table once; it's remembered for a few hours, and Call staff works the same way
- One table bill for everyone who ordered at that table, with every dish and who ordered it
- **Whole bill**, **Split equally** (people at the table + how many shares you’re covering) or **My items** (tick your dishes; GST and service shared in proportion). Dishes someone has paid for show “Paid by …” and can’t be claimed twice
- Pay with **UPI** (opens the guest’s UPI app with the amount when a UPI ID is set in Settings), **card** or **cash** at the table
- Amounts are always computed by the server; each payment waits for staff to confirm it arrived, then updates live on every phone at the table. When confirmed payments cover the bill, the table **settles automatically** (orders marked paid, next guests start fresh)

> The page-turning **menu book** (`public/js/book.js`, `public/css/book.css`) is kept in the repo but switched off — its markup and wiring are commented out in `menu.html` / `menu.js` (see commit 9543a51 to restore).

**Kitchen console** (`/r/<restaurant>/admin`, sign in at `/login`)
- **Bills** tab: every open table bill with received / waiting / left to pay, each payment (who, how much, UPI/card/cash, whole bill / equal share / own dishes) with one-tap *Received* or *Not received*, manual *Settle table*, and today’s settled payments. New payments chime and toast live
- Live kanban board with chime + flashing new orders, one-tap status, mark paid, cancel
- Waiter-call alerts
- Menu manager: add / edit / delete dishes and categories, **sold-out toggle** that updates every phone
- Tables & QR: generate a QR per table, copy link, download PNG (1200px), print
- Insights: revenue today, orders, avg ticket, revenue by hour, top dishes
- Settings: name, tagline, currency, GST %, service %, hours, Wi‑Fi, UPI ID, public URL for QR codes
- **Order only from inside the restaurant** (optional, off by default): the guest's phone shares its location when ordering and the server accepts the order only within the distance you set. Coordinates are checked, never stored. Details: [`docs/LOCATION_CHECK.md`](docs/LOCATION_CHECK.md)
- **Team**: owners add staff by email (a temporary password is shown once; they set their own at first sign-in), reset passwords, change roles, remove people (signed out instantly). **Staff** run orders, bills, waiter calls and the sold-out switch; only **owners** edit the menu, tables, settings and team

**Platform console** (`/platform`, platform owner only)
- Add a restaurant: name, web address, owner email, empty or sample menu → the owner's temporary password is shown once
- See every restaurant with its owners and team size; suspend / reactivate (suspended menus, ordering and consoles stop; no data is deleted); reset an owner's password; choose which restaurant the home page showcases

**Print studio** (`/r/<restaurant>/print`): A6 acrylic standee inserts (4 per A4), fold-over table tents, or 3×3 card grid — with a 3D on-screen preview and high error-correction QR codes carrying your brand badge.

**Landing page** (`/`) — a walkable 3D gallery (Three.js), in the spirit of a gallery-site rotunda: you stand in a bright, curved room and **scroll or drag to walk round**. Each menu chapter opens with a title card; every dish hangs as a framed photograph with a museum label in a glowing arched niche. Hover shows a "Look closer" pill; click dollies the camera up to the print and opens a detail card ("Find it in the menu book" deep-links to that chapter). Below: the menu-as-a-book, how it works, and the kitchen features with the live QR. Light editorial design on the brand palette; renders only when something moves; static fallback without WebGL.

## Quick start

```bash
npm install
```

```bash
npm start
```

On first start the server creates the first restaurant (**Ember & Saffron**, `/r/ember-saffron/…`) and prints to the terminal, once:

- the restaurant owner's email and a **temporary password** (you choose a new one at first sign-in), and
- in development, a **platform owner** password (new every start unless you set `PLATFORM_ADMIN_PASSWORD`).

Sign in at http://localhost:3000/login. Owners land in their kitchen console; the platform owner lands in `/platform`, where you add more restaurants. If you ran the earlier single-restaurant version, its data (`data/db.json` or the Postgres `app_state` row) is **copied** into that first restaurant and the original is left untouched; old QR codes (`/menu?t=T3`) keep working.

To scan the QR codes from a real phone, open the console using the **Network** address printed in the terminal (same Wi‑Fi), or set `PUBLIC_URL` / **Settings → Public URL** to your deployed domain.

## Security model

- **No credentials in the browser.** Sign-in sets an `HttpOnly; SameSite=Lax` (and `Secure` on HTTPS) signed session cookie that page scripts cannot read. Nothing is kept in `localStorage`/`sessionStorage`, and no secret is ever put in a URL.
- **Passwords** are hashed with scrypt; temporary passwords are generated by the server, shown once, and must be replaced at first sign-in (enforced by the API). Changing or resetting a password signs that account out everywhere.
- **Every request is scoped to one restaurant** by its URL; staff sessions only work for their own restaurant (403 otherwise), and roles are read from the stored account on every request.
- **CSRF**: every state-changing staff/platform call needs a same-origin custom header and a matching `Origin`; the cookie is `SameSite=Lax`.
- **Brute force**: sign-in is rate limited per IP and per account, with one generic error message and equal timing for unknown accounts.
- **Content-Security-Policy** `script-src 'self'` (no inline scripts or handlers anywhere), `frame-ancestors 'none'`, HSTS on HTTPS, `nosniff`, strict referrer policy.
- The **platform owner** exists only in server environment variables. Prices, taxes, splits and payments are always computed by the server; customer IPs are never returned.

## Deploy to Vercel (with Neon Postgres)

Static pages come from `public/` via the CDN and `/api/*` runs as a serverless function (`api/index.js`).

- **Storage:** set `DATABASE_URL` (added by the Neon integration: `vercel integration add neon`). Each restaurant is one row in `kv_store`, written in row-locked transactions so concurrent orders never clash. Required on Vercel.
- **Live updates:** serverless functions can't hold Server-Sent Events, so on Vercel the console and order tracker poll every 3–4 s. Locally you get instant SSE.
- Set these in the Vercel project before going live: `SESSION_SECRET` (32+ random characters), `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` (12+ characters), and optionally `OWNER_EMAIL` / `OWNER_PASSWORD` for the first restaurant (otherwise its temporary password is in the function log of the first request; you can also reset it from `/platform`).

```bash
vercel deploy --prod
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | — | Postgres (Neon). Without it, data lives in `data/store/*.json` |
| `SESSION_SECRET` | derived from `DATABASE_URL`; random in dev | Signs session cookies (≥ 32 chars). Production refuses to start without it or `DATABASE_URL` |
| `PLATFORM_ADMIN_EMAIL` | `platform@admin.local` | Platform owner sign-in |
| `PLATFORM_ADMIN_PASSWORD` | random in dev; **console disabled in production if unset** | Platform owner password (≥ 12 chars in production) |
| `PUBLIC_URL` | request host | Base URL encoded in QR codes (a restaurant's own Public URL setting wins) |
| `LEGACY_TENANT_SLUG` | `ember-saffron` | Web address of the first restaurant |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | `owner@<slug>.menu`, generated | First restaurant's owner |

Delete `data/store/` to start over locally.

## API (summary)

Pages: `/r/<slug>` (restaurant home with its QR), `/r/<slug>/menu`, `/r/<slug>/admin`, `/r/<slug>/print`, `/login`, `/platform`

Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`

Guest (per restaurant, `/api/r/<slug>`): `GET /menu`, `GET /tables`, `GET /tables/:id`, `GET /tables/:id/bill`, `POST /tables/:id/payments`, `POST /orders`, `GET /orders/:id`, `GET /orders/:id/events` (SSE), `POST /calls`, `GET /qr` (restaurant QR → menu), `GET /qr/:tableId[?format=png&size=…]`

Staff console (`/api/r/<slug>/admin`, session cookie + `X-QM-CSRF: 1`): `GET /state|stats|changes|stream`, `PATCH /orders/:id`, `PATCH /calls/:id`, `PATCH /payments/:id`, `POST /tables/:id/settle`, `PATCH /items/:id/availability` — owner only: `POST|PUT|DELETE /items`, `POST|DELETE /categories`, `POST|DELETE /tables`, `PUT /restaurant`, `GET|POST|PATCH|DELETE /team`, `POST /team/:id/reset-password`, `POST /reset` (demo restaurant only)

Platform (`/api/platform`): `GET|POST /tenants`, `PATCH /tenants/:id`, `POST /tenants/:id/reset-owner`, `PUT /default`

## Tests

```bash
npm test
```

Covers restaurant isolation (menus, orders, consoles), roles, sign-in and cookie flags, CSRF, forged/foreign-key sessions, forced password change, suspension, owner resets, team management, login and order rate limits, first-boot migration, CSP-safe pages, QR codes, the order flow, bills and split payments, and the live SSE / polling feeds.

## Stack

Node 18+ · Express · `qrcode` · Three.js (served locally, no CDN) · vanilla ES modules (no build step) · Postgres or JSON-file key/value store with per-key locking (`src/store.js`).

# Multi-restaurant SaaS — architecture & security plan

One codebase, one deployment, any number of restaurants ("tenants"). Each restaurant
gets its own menu, tables, QR codes, kitchen console, bills and staff accounts, and
can never see another restaurant's data.

## 1. Tenancy model

| Concept | Shape |
|---|---|
| Tenant | `{ id: "tn_…", slug, name, status: active \| suspended, plan, createdAt }` |
| Tenant URL | `/r/<slug>/menu?t=T1` (guests) · `/r/<slug>/admin` (staff) · `/r/<slug>/print` |
| Tenant API | `/api/r/<slug>/…` (public) and `/api/r/<slug>/admin/…` (staff, authenticated) |
| Platform | `/platform` console + `/api/platform/…` (platform owner only) |
| Auth | `/login`, `/api/auth/login · logout · me · password` |

* **Slug is permanent** once created — it is printed inside every QR code. Format
  `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$`, minus a reserved list (`api`, `admin`,
  `platform`, `login`, …).
* Path-based tenancy works on Vercel and localhost with no DNS work; custom domains
  can be layered on later by mapping `Host → slug`.

## 2. Data isolation — by construction

Storage is a small key/value layer with two keys families:

* `platform` → tenants, users (password hashes), default tenant.
* `t:<tenantId>` → that restaurant's whole state (menu, tables, orders, calls,
  payments, order sequence).

Postgres: table `kv_store(key text pk, data jsonb, updated_at)`; every write is a
transaction holding a row lock (`SELECT … FOR UPDATE`) so concurrent serverless
instances never lose an order. Locally: one JSON file per key under `data/store/`.

Every tenant request first resolves the tenant **from the URL**, then loads **only**
`t:<tenantId>`. Handlers never see a global list, so a bug cannot leak another
restaurant's orders; IDs like table `T1` exist independently per tenant.

## 3. Identity, sessions and roles

* **Accounts**: email + password, hashed with **scrypt** (random salt, constant-time
  compare). Temporary passwords are generated **on the server** and shown once.
* **Session**: signed cookie `qm_session` (HMAC-SHA256 with `SESSION_SECRET`, or a key
  derived from `DATABASE_URL` when only that is set),
  `HttpOnly; SameSite=Lax; Path=/; Secure` (on HTTPS), 12-hour lifetime. Payload holds
  user id, tenant id, role and a `tokenVersion` — changing a password bumps the
  version and signs the user out everywhere.
* **Nothing secret in the browser**: no PIN in `sessionStorage`, no credentials in
  URLs (the old `?pin=` on the live stream is gone — EventSource sends the cookie).
* **CSRF**: unsafe methods on authenticated routes require the custom header
  `X-QM-CSRF: 1` (HTML forms on other sites cannot send custom headers; we serve no
  CORS) **and** the cookie is `SameSite=Lax`.
* **Tenant check on every admin request**: session tenant must equal URL tenant → 403.
* **Roles**

  | Action | owner | staff | platform |
  |---|---|---|---|
  | Orders, bills, payments, staff calls, sold-out toggle, stats | ✓ | ✓ | – |
  | Menu items & categories, tables, settings, team | ✓ | – | – |
  | Create / suspend restaurants, reset owner passwords | – | – | ✓ |

* **Platform owner** credentials live only in env (`PLATFORM_ADMIN_EMAIL`,
  `PLATFORM_ADMIN_PASSWORD`). In local development, if unset, a random password is
  generated and printed to the server console once.
* **Brute force**: login limited per IP (20 / 15 min) and per email (8 / 15 min),
  generic "email or password is incorrect" message.

## 4. Hardening

* Content-Security-Policy: `script-src 'self'`; no inline scripts or inline event
  handlers anywhere (theme boot script moved to a file, import maps removed).
* `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS on HTTPS.
* Server computes every price, tax, split and payment; IPs never leave the server.
* Suspended tenants: public menu, ordering and payments return 403.
* Production refuses to start without a signing key: `SESSION_SECRET` (≥ 32 chars), or
  `DATABASE_URL` from which one is derived (prevents forgeable sessions).
* Temporary passwords (new owner, new staff, resets) must be replaced at first sign-in;
  the server blocks the console API until they are.

## 5. Migration (existing deployment keeps working)

On first boot with the new code:

1. If `kv_store` has no `platform` row, take a Postgres advisory lock (only one
   instance migrates), read the legacy `app_state` row (or `data/db.json` locally)
   and copy it into a new tenant (`LEGACY_TENANT_SLUG`, default `ember-saffron`).
   The legacy row is **not modified or deleted**.
2. Create its owner account: `OWNER_EMAIL` / `OWNER_PASSWORD` from env, otherwise a
   generated password printed to the server log once (reset any time from `/platform`).
3. Old URLs redirect: `/menu?t=T3` → `/r/<default>/menu?t=T3` (printed QR codes keep
   working), `/admin` → `/login`.

## 6. Environment variables

| Var | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | production (recommended) | ≥ 32 random chars; signs session cookies (derived from `DATABASE_URL` if unset) |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` | production | platform owner login |
| `DATABASE_URL` | Vercel | Neon/Postgres |
| `PUBLIC_URL` | optional | base URL encoded in QR codes |
| `LEGACY_TENANT_SLUG`, `OWNER_EMAIL`, `OWNER_PASSWORD` | optional | first-tenant migration |

## 7. Known limits / next steps

* Card/UPI gateway (automatic payment confirmation) — today staff confirm receipt.
* Subscription billing per tenant (the `plan` field is ready for it).
* Image uploads (menus currently take image URLs or bundled photos).
* Very large tenants: state is one JSON document per tenant (fine for a restaurant's
  live orders; archive or normalise orders when volumes grow).

## 8. What was built (implementation map)

| Piece | Where |
|---|---|
| Key/value storage (Postgres `kv_store` / JSON files), locks, legacy read | `src/store.js` |
| Passwords (scrypt), signed cookies, rate limiter, slug/email rules | `src/security.js` |
| Tenant data templates, first-boot bootstrap + migration | `src/tenancy.js` |
| Routes: auth, platform, tenant guest API, staff console API, pages, CSP | `src/app.js` |
| Sign-in page | `public/login.html`, `public/js/login.js` |
| Platform console | `public/platform.html`, `public/js/platform.js` |
| Restaurant console (roles, team, forced password change) | `public/admin.html`, `public/js/admin.js` |
| Tests: isolation, roles, CSRF, forged cookies, suspension, migration, CSP-safe pages | `test/api.test.js` |

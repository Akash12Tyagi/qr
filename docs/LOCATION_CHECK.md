# Location check ("order only when you're at the restaurant")

## Problem
A QR code can be photographed and shared. Without a check, someone at home could send
orders to a restaurant's kitchen.

## Approach (implemented, off by default)

| Step | Where | What happens |
|---|---|---|
| 1. Owner switches it on | Kitchen console → Settings → *Order only from inside the restaurant* | Owner stands in the restaurant and taps **Use this device's location** (or pastes coordinates from Google Maps), sets the allowed distance (30–2000 m, default 150 m), saves. The server refuses to enable it without valid coordinates. |
| 2. Guest places an order | Phone, menu → *Place order* | The browser asks for location permission (only now, only for ordering). The reading `{lat, lng, accuracy}` is sent with the order. |
| 3. Server decides | `POST /api/r/<slug>/orders` | Haversine distance to the restaurant. Accepted if `distance − min(accuracy, 100 m) ≤ radius`. Rejected with a clear message if location is missing (`location_required`), too vague (> 1 km, `location_imprecise`) or outside (`location_outside`). The browser never decides. |
| 4. Kitchen sees it | Order card | "📍 At the restaurant · 35 m away". |

## What does not change
- With the setting off (the default), everything works exactly as before.
- Browsing the menu, calling staff and paying the bill never need location.
- Existing orders, tables, QR codes and URLs are untouched.

## Privacy
- The restaurant's coordinates are never sent to guests; the public menu only says
  `geoCheck: true`.
- The guest's coordinates are used for one distance check and are **not stored**; the
  order keeps only the rounded distance and accuracy.
- The browser only allows location on HTTPS (Vercel is HTTPS). The site's
  `Permissions-Policy` allows geolocation for our own pages only (`geolocation=(self)`).

## Limits (honest)
- Phone GPS indoors is often 10–50 m off; that is why the radius has a sensible default
  and the phone's own accuracy is partly forgiven.
- A determined person can fake a browser location with developer tools. This check
  stops casual remote/prank orders, not a technical attacker. Staff still accept every
  order (it arrives as *New*), and a guest who can't share location can call a waiter.
- Stronger options for later: a rotating table code shown on a small screen at each
  table, restaurant Wi-Fi network check, or "first order needs staff approval".

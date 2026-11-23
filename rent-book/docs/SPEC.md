# Rent Book — build spec

A tenant tracker for one independent landlord with 27 rental tenants (maybe a partner). One operator,
used daily around the 1st–10th of the month and weekly otherwise, on a phone and a laptop.
It ships as a single hosted page (a claude.ai Artifact) backed by the page's `db` capability.

The bar: calm, dense-but-readable, obviously hand-designed. Nothing decorative, nothing generic.
Every screen answers a real question the landlord has. Fewest possible steps to record a payment.

## 1. Platform constraints (hard rules)

- Output is ONE html file, `dist/rent-book.html`, with NO `<!doctype>`, `<html>`, `<head>` or `<body>` tags.
  It starts with `<title>Rent Book</title>`, `<meta name="claude:viewport-fit-sides" content="cover">`,
  the Google Fonts `<link>`, one `<style>`, then markup, then one `<script>`. The host wraps it in a skeleton whose
  head has charset + `viewport-fit=cover` viewport, `:root` padded top/bottom by safe-area insets (keep that),
  zero body margin, `[hidden]{display:none!important}` (toggle with `el.hidden`).
- `build.mjs` also writes `dist/preview.html` = the same content wrapped in that skeleton, for local testing.
- No external requests except Google Fonts CSS. No libraries. No images except inline SVG / data URIs.
- `alert/confirm/prompt` do nothing. `window.print()` does nothing. `<a download>` is inert — files are saved
  only through the `downloads` capability. `mailto:`/`tel:` links are unreliable: always show the number/address
  as selectable text with a copy button (tel/mailto may be offered as an extra convenience).
- Clipboard: `navigator.clipboard.writeText` inside the click handler, catch rejection, fall back to selecting text.
- Routing: only plain `#name` hashes (ASCII letters, digits, hyphens). Never `#/x`, `#a=b`, query strings, pushState.
  Reserved, do not use: `settings`, `sidebar`, `customize`, `upgrade`, `downloads`, `comment-*`.
  Routes: `#today` (default), `#rent`, `#tenants`, `#leases`, `#upkeep`, `#reports`, `#setup`, and `#t-<tenantId>`
  (tenant detail open over the Tenants view).
- localStorage only for per-viewer conveniences (last filter, density, sort); every access in try/catch.
- Layout: side gutter `padding-left:max(16px, env(safe-area-inset-left,0px))` (and right) on the outer wrapper;
  page body never scrolls horizontally at 380px wide; `html,body{height:100%}` not `100vh`; anything fixed to an edge
  adds that edge's `env(safe-area-inset-*)` to its own padding; sticky header uses `top: env(safe-area-inset-top,0px)`.
- Theme: every colour is a token defined on bare `:root` (light), redefined under
  `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){…; color-scheme:dark} }` and again under
  `:root[data-theme="dark"]{…; color-scheme:dark}`. No literal colours in component rules. `body` sets an explicit
  token background.
- Untrusted data: every value from the store is escaped (`RB.esc`) before joining an HTML string, or set with
  `textContent`. Only link to URLs starting with `https://`.
- Every form control has a stable `id`. Visible keyboard focus. Respect `prefers-reduced-motion`.
- Capabilities: `const db = await claude.use("db")` etc. `window.claude` may not exist at all (local preview) and
  `use()` may resolve `null` (takes up to 10 s). Never read `window.claude.db`. Render first, light up later.
  Subscribe once per collection, never inside render. One write at a time per document (queue writes per doc).
  Never write on load, in render, or in a snapshot callback — only on a user action.

## 2. Source layout

```
rent-book/
  build.mjs                 concatenates src → dist/rent-book.html + dist/preview.html
  src/index.html            shell markup with <!--CSS--> and <!--JS--> placeholders
  src/css/NN-*.css          tokens, base, components, then one file per view (concatenated in name order)
  src/js/NN-*.js            classic scripts, concatenated in name order, each attaching to window.RB
  src/js/views/*.js         one file per view (loaded after core, before 99-boot.js)
  test/*.test.mjs           node --test for the pure model
  tools/shots.mjs           Playwright: loads dist/preview.html, loads sample data, screenshots every view
  docs/SPEC.md, docs/CONTRACT.md
```
Playwright + Chromium are pre-installed (`require('playwright')`, `chromium.launch()` with no options; do NOT install).

## 3. Data model (documents in the artifact db)

All dates are `YYYY-MM-DD` strings (local calendar dates, never Date-with-timezone maths on UTC). Money is integer
cents. Ids: `RB.id()` (12 url-safe chars).

`meta/settings`
```
{ portfolioName, currency:"USD", dueDay:1, graceDays:5,
  lateFee:{ type:"flat"|"percent"|"none", amount },      // flat = cents, percent = % of monthly rent
  depositReturnDays:30, leaseNoticeDays:60, methods:["Check","Cash","Zelle","Venmo","ACH","Money order"],
  hasSample:false }
```
`tenants/{id}`
```
{ name, phone, email, coTenants:[{name,phone,email}], emergency:{name,phone},
  property, unit,                       // free text, e.g. "Alder Court", "2B"
  status:"active"|"notice"|"past",
  lease:{ start, end|null (null = month-to-month), moveIn, noticeDate|null, moveOut|null, dueDay|null, graceDays|null },
  rent:[{ from:"YYYY-MM-DD", amount }], // schedule; later rows are rent changes, never rewrite history
  recurring:[{ id, label, amount, from, to|null }],   // pet rent, parking…
  trackFrom,                            // first date this book generates charges for (≥ lease.moveIn)
  opening:{ amount }|null,              // balance owed (+) or credit (−) carried in as of trackFrom
  deposit:{ amount, received|null, heldAt, returned:{ date, refund, deductions:[{reason,amount}] }|null },
  insurance:{ carrier, policy, expires|null }|null,
  links:[{ id, label, url }],           // lease PDF etc. — https links only
  about,                                // free text: pets, vehicles, quirks
  log:{ [id]:{ at:ISO datetime, kind:"note"|"call"|"text"|"email"|"visit"|"notice", text, followUp|null, done:false } },
  sample:true?, createdAt, updatedAt }
```
`ledgers/{tenantId}`
```
{ entries:{ [id]:{ type:"payment"|"charge"|"credit", date, amount (positive cents),
                   method?, ref?, category?:"late_fee"|"utility"|"damage"|"fee"|"other", period?:"YYYY-MM",
                   memo?, void:false, createdAt } } }
```
Entries are a MAP so adding one is `update({entries:{[id]:entry}})` (nested merge). Entries are never deleted from
page code; "delete" sets `void:true` (and Undo sets it back).

`tickets/{id}`
```
{ tenantId|null, property, unit, title, detail, priority:"urgent"|"normal"|"low",
  status:"open"|"scheduled"|"done", reported, scheduled|null, completed|null, vendor, cost|null,
  paidBy:"owner"|"tenant", sample:true?, createdAt, updatedAt }
```

### The ledger is derived, not stored
Rent charges are NOT stored. `RB.model.buildLedger(tenant, entries, settings, today)` generates them:
- One rent charge per calendar month from `trackFrom` through the current month (stop at `lease.moveOut`),
  dated on the due day, amount from the `rent` schedule in force that day, plus each active `recurring` item as its
  own charge row. A charge exists once its month has started (posted on the 1st even if due on the 5th) — so "this month" is
  visible immediately; it only becomes *late* after due date + grace days.
- First month prorated by actual days when `trackFrom === lease.moveIn` and it is not the 1st; last month prorated to
  `moveOut`. Expose the proration maths (`days`, `ofDays`) on the row so the UI can show it.
- `opening` becomes a first row ("Balance brought forward").
- Stored entries (non-void) are merged in: payments and credits reduce the balance, manual charges increase it.
- Rows sorted by date (charges before payments on the same date), each with a running balance.
- Allocation is FIFO: payments/credits pay the oldest open charge first. Each charge row gets `paid`, `open`,
  `paidOn` (date it became fully paid). Overpayment is credit on account and applies to the next charge automatically.
Returned summary:
```
{ rows, balance (>0 owed, <0 credit), months:{ "YYYY-MM":{ charged, paid, open, status, paidOn, daysLate } },
  current:{ period, status, due, open, daysLate }, aging:{ d0_30, d31_60, d61_90, d90 },
  oldestOpenDate, lastPayment:{date,amount}|null, suggestedLateFee:{ period, amount }|null }
```
Month status (one vocabulary, used everywhere): `paid` (in full by due+grace), `paid_late` (in full, after grace),
`partial` (some paid, still open, not past grace), `due` (nothing paid, not past grace), `late` (open past grace),
`none` (not tracked / before move-in / after move-out). A tenant is **delinquent** when any open amount is older than
30 days. `suggestedLateFee` is set when a rent month is `late` and no non-void `late_fee` charge has that `period`;
fees are never posted automatically — the landlord confirms with one click.

## 4. Views

Navigation: desktop = slim left sidebar (dimmed, 208px, collapses to icons under 1100px); phone (<760px) = bottom
bar with Today · Rent · Tenants · Upkeep · More (More opens a sheet: Leases, Reports, Setup). Top bar: view title,
global search field (`/` focuses), `⌘K`/`Ctrl-K` command palette, "+" quick-add menu.

**Today** (`#today`) — one screen, in order: (1) this month's collection — "$X of $Y collected", a bullet-style
progress bar, "21 of 27 paid", days until/after grace ends; (2) Needs attention — one prioritised list, each row a
tenant/thing + why + a single primary action: late rent (with "Record payment" and "Add late fee $50"), partial
payments, delinquent balances, urgent/open upkeep, leases ending within `leaseNoticeDays` with no decision, upcoming
move-ins/outs, deposits due back (countdown from moveOut + depositReturnDays), follow-ups due from the log,
insurance expiring; empty → a quiet "Nothing needs you today."; (3) the month at a glance — all tenants as a compact
grid of door plates coloured/shaped by this month's status, click opens the tenant; (4) recent activity (last 8
ledger/log events). No KPI tiles, no deltas, no pies.

**Rent** (`#rent`) — the monthly collection sheet; the heart of the app. Month stepper (‹ November 2026 ›).
One row per tenant with a charge that month: plate, name, due amount, paid, open, status, and an inline quick action:
"Mark paid" (records full open amount, today, tenant's last-used method → Undo toast) with a caret to open the full
payment sheet (amount, date, method, reference, memo). Filter chips with counts: All · Unpaid · Late · Partial · Paid.
Bulk mode: tick rows → "Record 6 payments" bar. Keyboard: `j/k` move, `p` mark paid, `Enter` open sheet.
Footer totals: charged / collected / outstanding. Phone: stacked cards, same actions, 44px touch targets.

**Tenants** (`#tenants`) — table on desktop (44px rows, 13.5px text), cards on phone. Columns: plate + name
(+ co-tenants muted), property, rent (right), this month status pill, 12-month payment strip, balance (right, only
when non-zero, owed in danger colour, credit muted with "cr"), lease end (relative: "in 43 d", "month-to-month",
"ended"). Search, filter chips (All · Owing · Lease ending · Notice · Past), sort by clicking headers (default:
urgency), group-by-property toggle. "Add tenant" button.
**Tenant detail** (`#t-<id>`) — right drawer (520px) on desktop, full-screen page on phone; `Esc` closes,
`↑/↓`/`j/k` step through the list. Sections: header (plate, name, status, balance, primary "Record payment",
overflow: add charge, add credit, edit, give notice, move out, delete); Contact (copyable phone/email, co-tenants,
emergency); Lease (dates, a thin progress bar through the term, rent with change history and "Change rent" which
adds a schedule row with an effective date, recurring charges, deposit, insurance, links); Ledger (bank-statement
table: Date | Description | Charge | Payment | Balance, newest first, month dividers, voided rows struck through,
row menu: edit, void, copy receipt; "Copy statement" and "Download CSV"); Notes & timeline (add note with kind and
optional follow-up date; follow-ups can be ticked done). Edit happens in a sheet form with grouped fields.
Move-out flow: set move-out date → final prorated month → deposit settlement (deductions list, refund auto-computed,
deadline shown) → status `past`.

**Leases** (`#leases`) — a 12-month horizontal timeline (today marked, the notice window shaded), one row per tenant
sorted by end date, bar from max(start, window start) to end, month-to-month drawn as an open-ended dashed bar.
Row action: "Renew" (new end date + optional new rent effective date) or "Going month-to-month" or "Notice given".
Phone: a list grouped by "Ending in 30 / 60 / 90 days / Later / Month-to-month".

**Upkeep** (`#upkeep`) — maintenance requests in three columns on desktop (Open · Scheduled · Done-last-30-days),
a segmented list on phone. Card: title, plate, age ("9 d open"), priority mark, vendor, cost. Add/edit in a sheet.
Status changes by one click (Schedule → Done) with Undo.

**Reports** (`#reports`) — four reports, each a clean table with a "Download CSV" and "Copy" action:
Rent roll (unit, tenant, rent, lease start/end, deposit, balance, status; totals; occupancy line), Aging
(0–30 / 31–60 / 61–90 / 90+ per tenant with totals), Collection by month (last 12 months: charged, collected, rate —
drawn as a small bar chart drawn to scale with the table beneath), Income by year (per tenant totals for tax time).

**Setup** (`#setup`) — portfolio name, due day, grace days, late-fee rule, deposit return days, lease notice window,
payment methods; Import tenants (paste from a spreadsheet or choose a CSV; auto-map columns: name, unit, property,
phone, email, rent, lease start, lease end, deposit, balance owed; preview table with per-row problems before
"Import 27 tenants"); Backup (download everything as JSON; restore from JSON); Sample data (load / remove);
theme follows the viewer, no toggle needed; keyboard shortcuts list (`?` opens it anywhere).

Empty state (no tenants): a designed first-run panel — "Add your first tenant", "Import from a spreadsheet",
"Explore with sample data" — never a misleading "No tenants" while data is still loading (show a skeleton/loading
line until the first snapshot or the 10 s timeout).
Sample data: when any tenant has `sample:true`, show a slim persistent strip: "You're looking at sample tenants."
with "Remove sample data" and "Import my tenants".

## 5. Interaction rules

- Undo, not confirm: every routine action (record payment, void, status change, note) applies immediately and shows a
  toast with Undo for 7 s. Only irreversible bulk actions (delete tenant, remove sample data, restore backup) use an
  in-page confirm sheet that names exactly what will be removed.
- Buttons say what happens ("Record $1,450", "Add late fee $50"). Toasts confirm in past tense ("Recorded $1,450 from
  Unit 2B").
- Receipts: "Copy receipt" puts a plain-text receipt on the clipboard (portfolio name, tenant, unit, amount, date,
  method, balance after) ready to paste into a text or email.
- Money: `$1,450` (no `.00` on whole dollars, cents shown when present), negatives as `−$120`, tabular figures,
  right-aligned in columns, currency symbol slightly muted in large figures.
- Dates: "Nov 3" within the current year, "Nov 3, 2025" otherwise; relative for deadlines ("in 12 d", "9 d late").
- Status is never colour alone: pill = icon shape + word. paid ✓ check; paid_late ✓ with clock tick; partial
  half-filled circle; due hollow circle; late filled triangle + "9 d late"; none em-rule.
- Offline / no db: the app works fully in memory (persisted to localStorage) and shows a small "Not syncing — saved
  on this device only" note in the sidebar footer. This is also how local preview and tests run.
- Read-only viewers (writes rejected): disable editing controls and say "View only".

## 6. Visual system

Concept: a modern rent book. Cool paper, ink-blue accent, ruled ledger lines, mono "door plates" for units.
Layout concept: dimmed rail + one calm work column; hairlines instead of boxes; shadows only on floating layers.

Fonts (Google Fonts): **Newsreader** (display: view titles, large sums, tenant name in the drawer; weights 400/500,
optical size on), **IBM Plex Sans** (all UI text; 400/500/600), **IBM Plex Mono** (door plates, ledger dates,
references; 400/500). Real fallback stacks. `font-variant-numeric: tabular-nums` on every number.
Type scale (px): 12 / 13.5 / 15 / 18 / 24 / 34. UI body 13.5 desktop, 15 on phone. Uppercase micro-labels 11px with
0.06em tracking, used sparingly.

Tokens (light → dark):
```
--paper      #F5F6F9 → #0E1116      page ground
--surface    #FFFFFF → #151920      panels, drawer, sheets
--sunk       #ECEEF3 → #0A0C10      wells, table header, inputs at rest
--ink        #131A26 → #E7EAF0      primary text
--ink-2      #485163 → #A8B0BE      secondary text
--ink-3      #6F7889 → #7E8797      tertiary / labels   (must stay ≥ 4.5:1 on paper/surface)
--line       #E0E4EB → #232933      hairlines
--line-2     #C9CFDA → #343C49      stronger rules, input borders
--accent     #2A47C4 → #8FA4FF      ink blue: primary buttons, links, focus, selection
--accent-ink #FFFFFF → #0E1116      text on accent
--accent-soft#E7EBFA → #1A2244      selected rows, soft buttons
--ok         #1B7448 → #5BC08C   --ok-soft   #E2F2E9 → #11301F
--warn       #9A5D07 → #E2AA4C   --warn-soft #FAEFD9 → #33260D
--bad        #B4362E → #F0857D   --bad-soft  #FAE6E4 → #3A1715
```
Semantic colours are for status only, never decoration. One accent. Dark greys stay cool and near-neutral.
Spacing scale 4/8/12/16/24/32/48. Radius: 6 controls, 10 panels/sheets, 3 door plates. 1px hairlines.
Shadows only on drawer, sheet, menu, palette, toast. Motion: 140–180ms ease-out on drawer/sheet/toast only.

Signature components
- **Door plate**: unit label in Plex Mono 500, 12px, in a 3px-radius 1px-bordered plate, min-width 34px, centred.
  In the Today grid the plates are larger (44px) and carry status by fill + a corner glyph.
- **Payment strip**: 12 cells (oldest→current), each ~7×14px with 2px gaps: paid = solid ok; paid_late = solid ok with
  a notch/dot in warn; partial = half-height warn; late = solid bad; due = hollow outline; none = faint dot.
  Title/aria-label per cell ("Aug 2026 — paid Aug 3").
- **Ledger table**: ruled rows, mono dates, charge and payment in separate right-aligned columns, running balance in
  the last column, month divider rows in small caps.
- **Status pill**: text on soft tint with 1px border, icon shape leading. Never solid saturated fills.

Avoid: KPI tile rows, gradients, emoji, pies/donuts/gauges, nested cards, everything-rounded, accent side-bars on
cards, centred numbers, hamburger menus, horizontally scrolling tables on phones, confirm dialogs for routine actions.

## 7. Sample data

`RB.sample.generate(today)` returns `{settings, tenants, ledgers, tickets}`, deterministic (seeded PRNG), every
tenant and ticket flagged `sample:true`. 27 tenants over three properties — Alder Court (12 units: 1A–3D),
418 Marlow Street (9 units: 101–303), Fenwick Row (6 houses: No. 2–12) — rents $1,150–$2,400, 12 months of history,
and a realistic spread *relative to today*: most paid on time this month, 3 unpaid within grace or late, 2 partial,
1 delinquent two months, 1 with credit on account, 2 leases ending inside 60 days, 3 month-to-month, 1 notice given
with move-out next month, 1 moved out last month with a deposit due back, a few rent increases, late-payers with
`paid_late` history, 6 upkeep tickets across statuses, some log notes with one follow-up due. Invented, varied names.

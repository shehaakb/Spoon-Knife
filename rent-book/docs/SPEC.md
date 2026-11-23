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

## 8. Ease of use — the core of the product (added in v2; overrides anything above that conflicts)

The person using this is 50+, not technical, and may be on a phone with reading glasses off. They must never
feel lost, never need a manual, and never fear breaking something. If a screen needs explaining, it is wrong.
Every screen must pass: "Could my mother record a rent payment here, first try, without asking anyone?"

**Rules**
1. **Big and readable.** Body text 16px on desktop, 17px on phone; nothing a person must read is under 14px.
   Secondary text uses `--ink-2`, not `--ink-3`, wherever it carries meaning. Line height ≥ 1.45. Table rows ≥ 52px.
   Every tappable thing is ≥ 48px tall on phone, ≥ 40px on desktop, with ≥ 8px between neighbours.
2. **Text size control.** "Text size: Normal · Large · Extra large" (100% / 112% / 125%), visible in the sidebar
   footer and in Settings and in the phone More sheet, remembered per device. Everything scales (type, controls,
   spacing) and nothing overflows at 390px on Extra large.
3. **Words, not symbols.** No icon-only buttons anywhere a person must act: every button has a word ("More",
   "Close", "Copy", "Call", "Edit", "Back"). Icons may accompany words. No abbreviations: "22 days late", "in 128
   days", "credit" not "cr", "per month" not "/mo". Dates always include the month name.
4. **Plain language glossary — use exactly these words everywhere (UI, toasts, CSV headings, help):**
   - Upkeep / maintenance / ticket / request → **Repairs** / **repair** (nav label "Repairs")
   - Setup → **Settings** (nav label; the route stays `#setup`)
   - Ledger → **Payment history**; ledger entry → **entry**; statement stays **statement**
   - Charge → **charge** ("Add a charge"); Credit → **money off** in buttons ("Take money off what they owe"),
     "credit" only as the label for money a tenant has paid ahead ("$250 paid ahead")
   - Void → **Remove** ("Remove this payment — it was a mistake"), restored with Undo / "Put back"
   - Delinquent → **Behind on rent**; Aging report → **Who owes, and for how long**
   - Rent roll → **Rent roll** with the subtitle "Every unit, tenant and rent on one page"
   - Balance owed → **Owes $X**; zero → **All paid up**; negative → **$X paid ahead**
   - Partial → **Part paid**; Due → **Not paid yet**; Paid late → **Paid late**; Late → **Late**
   - Month-to-month stays; "Notice given" → **Moving out**; Past tenant → **Moved out**
   - Opening balance → **What they already owed**; "Start tracking rent from" → **Start counting rent from**
   - Recurring charges → **Other monthly charges** (pet, parking); Prorated → show the sum in words
     ("15 of 31 days")
   - Command palette / search → **Find** ("Find a tenant or do something…")
   - Import → **Bring in my tenants**; Backup → **Save a copy** / **Restore from a copy**; CSV download →
     **Download for Excel**
5. **Start from what they want to do.** Today opens with three large, labelled action buttons before anything
   else: **Record a rent payment**, **Log a repair**, **Add a tenant** (each ≥ 64px tall, icon + words, one line of
   help beneath: "Someone paid you — write it down"). Each starts a short guided flow that first asks "Which
   tenant?" with a big searchable list (name + unit), then shows one simple form.
6. **One thing at a time.** Forms are single-column with large fields, a plain question as the label ("How much did
   they pay?"), an example in the hint, and at most ~5 fields visible; everything optional sits behind one clearly
   worded "Add more details (optional)". Long forms (Add a tenant) are a 3-step guide with "Step 2 of 3", Back and
   Next, and a summary sentence before saving ("Maya Okafor, Unit 1A at Alder Court, $1,325 a month from March 1").
7. **Nothing hidden.** No action reachable only by hover, right-click, keyboard, swipe or a bare "⋯". Row menus
   become a labelled "More" button. Keyboard shortcuts stay for those who want them but are never the only way and
   are not advertised in the main UI (only in Settings → "Keyboard shortcuts").
8. **Safe to try.** Every change says what happened in a large, plain confirmation that stays 10 seconds with a big
   **Undo** button ("Recorded $1,385 from Claire Dubois. Undo"). Destructive actions explain consequences in a
   sentence and require typing nothing — just a clearly labelled red button and a larger "Keep it" button.
9. **Always a way home and a way out.** Every sheet/drawer has a visible "Close" or "Back" with a word. The app name
   in the corner returns to Today. A visible **Help** button (sidebar + More sheet) opens "How do I…?" — eight plain
   answers, each with a button that starts that task (record a payment, fix a mistake, add a tenant, log a repair,
   see who owes, raise the rent, a tenant is moving out, see a property's repair history).
10. **Explain numbers where they appear.** Short plain captions under figures and charts ("Green = paid on time").
    The 12-month strip always has a caption on first appearance in a view. Status pills use the glossary words.
11. **Calm, not clever.** Keep the visual identity (paper, ink blue, door plates, ledger rules) but with more air:
    fewer columns on screen (move detail into the tenant page), generous spacing, strong contrast (text ≥ 7:1 for
    primary, ≥ 4.5:1 for everything else), focus rings obvious. Compact density is removed from the main UI.

## 9. Repairs and repair history by property (added in v2)

"Upkeep" becomes **Repairs** (`#repairs`; keep `#upkeep` working as an alias). Two tabs with words:
**To do** (the existing Open / Scheduled / Done board, relabelled per §8) and **History by property**.

Data: a repair (ticket doc) gains `category` — one of `plumbing`, `electrical`, `heating` (Heating & cooling),
`appliance`, `roof` (Roof & outside), `doors` (Doors, windows & locks), `pest`, `painting` (Painting & floors),
`other` — suggested automatically from the title while typing ("leak" → Plumbing) and changeable with one tap;
plus optional `warrantyUntil` (date) and `notes` (what was done). `unit` may be empty with `scope:"building"` for
whole-building work (roof, boiler, gutters), shown as "Whole building". Missing `category` on old docs reads as
`other`. All maths lives in `RB.model` (pure, tested): `repairHistory(state, property, filters)`,
`repairTotals(...)` (by year, by category, by unit), `repeatProblems(...)`, CSV builder.

**History by property — landing**: one large card per property (from tenants' and repairs' `property` values):
name, number of units, repairs this year and what they cost, the most recent repair in words ("Last: smoke
detector, Unit 101, Nov 17"), and anything still open. Tapping a card opens that property's history
(`#p-<slug>`, slug from the property name; unknown slug → a tidy "not found").

**A property's repair history** (the page):
- Header: property name, "42 repairs since 2023 · $18,460 spent", and two buttons: **Log a repair** (new or still to
  do) and **Add a past repair** (a 4-field quick form — What was fixed? When? Which unit? What did it cost? — plus
  optional who fixed it / category / notes — built for typing in years of old history quickly: after saving it
  stays open with "Saved. Add another?" and keeps the date).
- "Spending by year" — a small bar chart drawn to scale with the amount written on each bar and a plain caption.
- "What the money went on" — categories as labelled horizontal bars with amounts and counts, largest first.
- "Keep an eye on" — repeat problems in plain sentences: "Unit 2B has had 3 plumbing repairs in the last 12
  months ($640)". Rule: ≥ 3 repairs of the same category in the same unit within 12 months, or ≥ 2 within 90 days.
  Also warranties: "The dishwasher in 3A is under warranty until March 2027".
- The history itself: a timeline, newest first, grouped by year with a year heading and year total. Each entry in
  large plain text: date, what was fixed, door plate (or "Whole building"), category, who fixed it, cost, who paid,
  and the notes. Tapping an entry opens it to edit. Simple filters with words: "Which unit?" (All units / each
  unit / Whole building), "What kind?" (categories), "Which year?", and a find box. A line states what is shown:
  "Showing 9 plumbing repairs in Unit 2B — $1,940".
- **Download for Excel** and **Copy** for the filtered list (for insurance, tax, or selling the building).
- By-unit view toggle: "Show by unit" lists each unit with its count, total and last repair, largest first.

Also: the tenant page gets a short "Repairs in this unit" section (last 3 + "See all repairs for Unit 2B", which
opens the property history filtered to that unit). Today's "Log a repair" action and the Help answers link here.

Sample data: add ~45 completed past repairs across the three sample properties over the last three years, with
realistic categories, vendors, costs and notes, including one clear repeat problem (plumbing in Alder Court 2B),
some whole-building work (roof, gutters, boiler service) and one item under warranty. Generate them with a SEPARATE
seeded PRNG, appended after everything else, so the ids and contents of the existing sample tenants, ledgers and
six tickets do not change; the existing six tickets just gain a `category`.

# Rent Book — foundation contract

What view authors code against. SPEC.md is the product spec; this file is the API. If the two disagree about
*behaviour*, SPEC wins; if they disagree about a *function name or shape*, this file wins (it describes what exists).

- Build: `node build.mjs` → `dist/rent-book.html` + `dist/preview.html`. Open `dist/preview.html` directly (file://).
- Tests: `node --test test/*.test.mjs` (pure model + sample data).
- Screens: `node tools/shots.mjs [--only rent,kit] [--size desktop|phone] [--theme light|dark] [--no-build]` → `shots/*.png`.
  Fails on console errors and on horizontal overflow at 390 px.
- Interaction smoke test: `node tools/smoke.mjs`. Cloud-path simulation: `node tools/cloud-sim.mjs` (fake db, see §11).
- Component review page: open `dist/preview.html#kit` (not in the nav). Every class below is rendered there.

## 0. Files

| File | What |
|---|---|
| `src/index.html` | shell markup; `<!--CSS-->` / `<!--JS-->` placeholders |
| `src/css/00-tokens.css` | colour tokens (light, dark ×2), type, spacing, radius, sizes, breakpoints vars |
| `src/css/10-base.css` | element defaults, utilities |
| `src/css/20-components.css` | the component library (§8) |
| `src/css/30-shell.css` | rail / tab bar / top bar / work column, help sheet, kit |
| `src/css/40-*.css` … | **one file per view** if you need view CSS (e.g. `40-today.css`, `41-rent.css`, `42-tenants.css`, `43-leases.css`, `44-upkeep.css`, `45-reports.css`, `46-setup.css`) — concatenated in name order after the shell |
| `src/js/00-util.js` | `RB.esc/html/raw/id`, `RB.date`, `RB.money`, prefs, clipboard, bus |
| `src/js/10-model.js` | `RB.model` — pure ledger + reports (node-loadable) |
| `src/js/20-store.js` | `RB.store` — state, cloud/local persistence, mutations, memoised selectors |
| `src/js/25-sample.js` | `RB.sample.generate(today)` |
| `src/js/30-ui.js` | `RB.ui` — renderers (SafeHTML) and primitives (toast, sheet, confirm, menu, drawer, palette, forms) |
| `src/js/35-actions.js` | `RB.actions` — shared flows (record payment, charges, notes, downloads, sample data…) |
| `src/js/40-shell.js` | `RB.views`, `RB.shell`, `RB.commands`, router, keyboard, palette, chrome |
| `src/js/views/today.js` | **Today** view (placeholder — replace wholesale) |
| `src/js/views/rent.js` | **Rent** view (placeholder) |
| `src/js/views/tenants.js` | **Tenants** view + `#t-<id>` drawer (placeholder) |
| `src/js/views/leases.js` | **Leases** view (placeholder) |
| `src/js/views/upkeep.js` | **Upkeep** view (placeholder) |
| `src/js/views/reports.js` | **Reports** view (placeholder) |
| `src/js/views/setup.js` | **Setup** view (placeholder; sample-data buttons work) |
| `src/js/views/kit.js` | `#kit` developer route (foundation-owned; keep) |
| `src/js/99-boot.js` | `RB.shell.start(); RB.store.start(); RB.actions.warmDownloads()` |

Each JS file is a classic script wrapped by the build in its own IIFE (`'use strict'`). Share things only via
`window.RB`. Top-level `const` in your file is private to it. Start view files with
`const RB = globalThis.RB; const { html: h, ui, date: D, money: M } = RB;`.
The build fails if any JS contains `</script` or `<!--` (split the string: `'<' + '/script'`).

## 1. Conventions (non-negotiable)

- **Escaping.** Build markup with the `RB.html` tagged template (alias `h`). Every `${}` is escaped unless it is
  SafeHTML (produced by `RB.html`, `RB.raw`, and every `RB.ui.*` renderer). Arrays are flattened — pass arrays,
  **never `.join('')`** them (a joined string is plain text and gets escaped). Assign with
  `el.innerHTML = String(h`...`)` (or `= h`...`` — `toString` works). Use `RB.raw(str)` only for markup you built.
  Links from data: `RB.safeUrl(u)` returns the URL only if it starts with `https://`, else `null`.
- **Ids.** Every form control needs a stable `id` (`ui.field` gives `f-<name>` unless you pass `id`). Prefix ids with
  your view (`rent-…`, `tn-…`). Stable ids are also how re-render restores focus/caret (§5).
- **Money** is integer cents everywhere. Display with `ui.money()` / `RB.money.fmt()` (`$1,450`, `$1,450.50`,
  `−$120`). Parse user input with `RB.money.parse()` → cents or `null`. Numbers in columns: class `num`.
- **Dates** are `'YYYY-MM-DD'` strings; months are `'YYYY-MM'` keys. Never `new Date(str)`. "Today" is
  `ctx.today` / `RB.store.today()` (not `RB.date.today()` in views — the store's today is what the ledger used).
  Display: `D.fmt(d, today)` → "Nov 3" / "Nov 3, 2025"; deadlines `D.rel(d, today)` → "in 12 d" / "9 d ago" / `{style:'late'}` → "9 d late".
- **Status vocabulary** (month status): `paid | paid_late | partial | due | late | none`. Always render with
  `ui.pill()` / `ui.plate()` / `ui.strip()` (icon shape + word, never colour alone).
- **Writes** only on user actions, through `RB.store` mutations or `RB.actions`. Never write in render.
  Never mutate objects you read from the store (snapshot data is frozen in cloud mode) — copy, then call a mutation.
- **Undo, not confirm.** Routine actions apply immediately and toast with Undo (`ui.toast(msg, {undo})`).
  `ui.confirm` only for irreversible bulk actions (delete tenant, remove sample data, restore backup).
- **Read-only.** When `state.readOnly`, mutations reject with a toast. Mark editing controls with the attribute
  `data-write` — the shell adds `.is-readonly` to `<html>` and CSS disables them. Or check `RB.store.canWrite()`.
- **No literal colours** in CSS — use tokens (§8.0). Phone breakpoint: `@media (max-width: 759.98px)`;
  icon rail: `@media (max-width: 1099.98px)`. Never horizontally scroll a table on phone: use `.hide-phone` columns
  and/or the `.clist` card list (`.show-phone`).
- **localStorage** only via `RB.prefs.get/set` (namespaced, try/catch inside) and only for conveniences.
- `alert/confirm/prompt/print`, `<a download>`, `pushState` do nothing in the host. Use `ui.confirm`, `RB.actions.downloadFile`.

## 2. Registering a view

```js
RB.views.register('rent', {
  title: 'Rent',                       // top-bar title (string, or fn(ctx) → string)
  render(el, ctx) { … },               // REQUIRED — fill `el` (a fresh <div class="view-root view-rent"> per mount)
  update(el, ctx) { … },               // optional — called INSTEAD of render on store changes (finer-grained updates)
  onKey(e, ctx) { return true },       // optional — keys not handled globally; return true if you handled it
  destroy() { … },                     // optional — leaving the view (close your drawer silently, clear timers)
  shortcuts: [['j / k', 'Move'], ['p', 'Mark paid']],   // listed in the ? help sheet
  firstRun: false,                     // optional — render even when there are no tenants (default: shell shows ui.firstRun())
  loading: true,                       // optional — render while the store is still loading (default: shell shows a skeleton)
});
```

`ctx` = `{ route, view, param, tenantId, state, store, today, reason, intent, phone }`
- `route`: the hash without `#` (`'rent'`, `'t-abc123'`). `view`: registered view name. `param`/`tenantId`: the id
  for `#t-<id>` (view `'tenants'`), else `null`.
- `state`: `RB.store.state` (§4). `store`: `RB.store`. `today`: `'YYYY-MM-DD'`.
- `reason`: `'mount'` (view entered; scroll reset to top) | `'route'` (same view, hash param changed, e.g. drawer
  opened/stepped) | `'store'` (data changed) | `'refresh'` (you called `RB.shell.refresh()`) | `'today'`.
- `intent`: one-shot value passed by `RB.shell.go(route, intent)` (e.g. Setup receives `'import'`). `null` otherwise.
- `phone`: true under 760 px (at render time; layout should still be CSS-driven).

Routes and files: `#today` → today.js, `#rent` → rent.js, `#tenants` and `#t-<id>` → tenants.js (detail drawer
open when `ctx.param`), `#leases`, `#upkeep`, `#reports`, `#setup`, `#kit`. Unknown hash → Today.

Before your view gets `render`, the shell handles: loading (skeleton until `state.ready`) and no-tenants (first-run
panel) unless you opt out with `loading:true` / `firstRun:false`. Upkeep and Setup currently opt out of first-run.

## 3. Re-render contract (read this)

1. **Mount**: entering a view calls `destroy()` on the old view, closes any drawer silently, creates a fresh root
   `el`, scrolls to top, calls `render(el, {reason:'mount'})`.
2. **Route** (same view, e.g. `#tenants` → `#t-x` → `#t-y`): `render(el, {reason:'route'})`; scroll kept.
3. **Store change** (any data change, batched to ≤1 per animation frame):
   - if your view defines `update`, the shell calls `update(el, ctx)` and does nothing else — you own DOM patching;
   - else, if a text input/textarea/select **inside your root** has focus, the re-render is **deferred until it
     loses focus** (typing is never clobbered);
   - else `render(el, {reason:'store'})` with window scroll restored and focus restored to the element with the same
     `id` (caret/selection restored for inputs).
4. **Your own UI state** (filters, sort, selected month, bulk selection) lives in module-level variables in your
   view file (persist conveniences with `RB.prefs`). After changing it call `RB.shell.refresh()` → synchronous
   `render(el, {reason:'refresh'})` with scroll + focus-by-id restored.
5. Event handlers: use `ui.bind(el, handlers)` (delegated; binds once per element, safe to call in every render).
   `data-act="name"` → click, `data-change="name"` → change, `data-input="name"` → input, `<form data-submit="name">` →
   submit (preventDefault done). Handler signature `(targetEl, event)`.
6. Search-as-you-type: give the input a stable id; on `data-input` update your variable and call
   `RB.shell.refresh()` — focus and caret come back. For heavy views, debounce (`RB.debounce`) or patch only the
   result list.
7. Drawers/sheets live outside `el` (in `#rb-layer`) and are not re-rendered by the shell. A drawer owner re-renders
   it itself (e.g. `ui.currentDrawer().rerender()` from `render` when `reason === 'store'`).

## 4. RB.store

`RB.store.state` (live object; do not mutate):
```
{ settings,            // settings with defaults filled (RB.model.settingsWithDefaults)
  tenants: {id: doc},  ledgers: {id: {entries:{id: entry}}},  tickets: {id: doc},   // raw docs (no id field inside)
  ready,               // false until first data (or 10 s timeout/error); shell shows skeleton meanwhile
  mode,                // null (resolving) | 'cloud' | 'local'
  readOnly,            // writes rejected for this viewer → "View only"
  loadIssue,           // null | 'timeout' (no answer after 10 s; banner shown) | 'error' (listener died)
  synced, saving,      // cloud: server confirmed all collections; number of writes in flight/queued
  today }
```

Selectors (memoised; cheap to call in render):

| Call | Returns |
|---|---|
| `today()` | `'YYYY-MM-DD'` used by every derived value |
| `settings()` | settings with defaults |
| `tenant(id)` | tenant doc **with `id`**, or null |
| `tenantsList({includePast=true})` | array of tenants with `id`, sorted property → unit (natural) → name |
| `entries(tenantId)` | raw entries map `{id: entry}` (may be `{}`) |
| `ledger(tenantId)` | `buildLedger` result (§6.1), cached until tenant/ledger/settings/today change; null if no tenant |
| `summary(tenantId)` | `RB.model.tenantSummary` (§6.8) |
| `ticket(id)`, `ticketsList()` | ticket(s) with `id` (unsorted) |
| `attention()` | `RB.model.attention` items (§6.4) |
| `portfolio(period?)` | §6.5 (default this month) |
| `rentRoll()`, `aging()`, `collectionByMonth(n=12)`, `incomeByYear(year)` | §6.6 |
| `hasSample()` | any tenant has `sample:true` |
| `canWrite()` | `mode` set and not `readOnly` |
| `subscribe(fn)` | `fn(state)` after changes (≤1/frame); returns unsubscribe. Views don't need this (the shell re-renders). |
| `version` | increments on every change |

Mutations — all return Promises, apply **optimistically** (state changes before the promise settles), write one at a
time per document, toast on failure (and roll the optimistic change back). Pass your own `id` when you need it
synchronously (`RB.id()`).

| Call | Effect |
|---|---|
| `saveSettings(patch)` | deep-merge into `meta/settings` (creates it with defaults first time) |
| `addTenant(data)` → id | `set` a full tenant doc (defaults for missing fields; `createdAt/updatedAt`; `trackFrom` defaults to moveIn/start) |
| `updateTenant(id, patch)` | deep merge (nested objects merge; **arrays replace wholesale**; `null` clears a field) |
| `deleteTenant(id)` | deletes tenant + its ledger (use only after `ui.confirm`) |
| `addEntry(tenantId, entry)` → id | adds `{type, date, amount(+cents), method?, ref?, category?, period?, memo?}`; creates the ledger doc with `set` on first entry |
| `updateEntry(tenantId, entryId, patch)` | merge into an entry |
| `voidEntry(t, e)` / `unvoidEntry(t, e)` | `void:true` / `void:false` |
| `undoEntry(t, e)` | `void:true, undone:true` — **for Undo of a just-added entry**; hidden from the ledger entirely |
| `addLog(tenantId, {kind,text,followUp?,done?})` → id | timeline entry (`at` = now) |
| `updateLog(tenantId, logId, patch)` | e.g. `{done:true}` |
| `deleteLog(tenantId, logId)` | stores `null` (no field delete exists); model and UIs must skip null log entries |
| `addTicket(data)` → id, `updateTicket(id, patch)`, `deleteTicket(id)` | upkeep tickets |
| `importAll({settings?, tenants?, ledgers?, tickets?}, {replace?})` → `{written, deleted}` | bulk write (maps id→doc or arrays with `id`); `replace:true` deletes everything not in the import (restore backup) |
| `removeSample()` → `{tenants, tickets}` | deletes all `sample:true` tenants/ledgers/tickets; `hasSample:false` |
| `exportAll()` | `{format:'rent-book-backup', version:1, exportedAt, settings, tenants, ledgers, tickets}` |

Data shapes are exactly SPEC §3. Additions: entry `undone:true` (Undo), entry `updatedAt`, log entries may be `null`.

## 5. RB.shell, RB.commands, keyboard

- `RB.shell.go(route, intent?)` — navigate (`'rent'`, `'t-' + id`); `intent` arrives once as `ctx.intent`.
- `RB.shell.refresh(reason='refresh')` — re-render the mounted view now (§3.4).
- `RB.shell.current()` → `{route, view, param}`; `RB.shell.root()` → mounted root el.
- `RB.shell.setTitle(text|null)` — override the top-bar title until the next navigation.
- `RB.shell.openPalette(query?)`, `RB.shell.quickAdd(anchorEl)`, `RB.shell.helpSheet()`.
- `RB.commands.register({id, label, group?, icon?, hint?, keywords?, run, when?, quickAdd?, write?})` → unregister fn.
  Shows in the ⌘K palette (`group` heading, default "Actions"); `quickAdd: n` also puts it in the "+" menu at order n;
  `write: true` hides/blocks it when read-only; `when()` → false hides it. `RB.commands.run(id)`.
  **Any element with `data-cmd="<id>"` runs that command on click** (used by first-run, banner, Setup).
- Built-in command ids: `go:today|rent|tenants|leases|upkeep|reports|setup`, `payment:record`, `charge:add`,
  `credit:add`, `note:add`, `tenant:add`, `ticket:add`, `setup:import` (→ `go('setup','import')`),
  `backup:download`, `sample:load`, `sample:remove`, `help:keys`.
- Global keys (ignored while typing in a field): `/` search (opens palette), `⌘K`/`Ctrl-K` palette (works in fields
  too), `n` or `+` quick-add menu, `?` help, `g d` Today, `g r` Rent, `g t` Tenants, `g l` Leases, `g u` Upkeep,
  `g p` Reports, `g s` Setup, `Esc` closes the top layer. Everything else goes to your `onKey(e, ctx)` (only when
  your view is in `ready` state and no sheet/menu/palette is open; **your drawer being open does not block it** —
  that's how `j/k` stepping in the tenant drawer works).
- Palette search covers tenant name, unit, property, phone, email, co-tenants; ≤3 matches add "Record payment / Add
  note / Add charge — <name>" actions.
- Chrome the shell maintains: rail (counts: Today = high-severity attention items, Rent = tenants late this
  month), phone tab bar (Today · Rent · Tenants · Upkeep · More), sample-data banner / load-issue banner, sync note
  ("Saved", "Saving…", "Not syncing — saved on this device only", "View only"), "View only" tag in the top bar.

## 6. RB.model (pure; node-loadable)

`settings` arguments always go through `settingsWithDefaults`. `today` is always passed in.

### 6.1 `buildLedger(tenant, entries, settings, today)` → Ledger
`entries`: entries map, a ledger doc `{entries}`, or an array.
```
{ tenantId,
  rows: [Row],                 // chronological (oldest first). Reverse for "newest first" display.
  balance,                     // cents; >0 owed, <0 credit
  credit,                      // max(0, -balance)
  months: { 'YYYY-MM': Month },
  current: { period, status, due, graceEnd, charged, paid, open, daysLate, paidOn },   // this month (status 'none' if no charge)
  aging: { d0_30, d31_60, d61_90, d90 },   // open charge amounts by age (today − charge date)
  oldestOpenDate, delinquent,  // delinquent = some open charge older than 30 days
  lastPayment: {date, amount, method, id} | null,
  suggestedLateFee: {period, amount} | null,   // most recent 'late' month with no non-void late_fee charge for that period
  dueDay, graceDays, trackFrom, rent /* rent in force today */, today }
```
Row (every row): `{ id, kind:'rent'|'recurring'|'opening'|'entry', type:'charge'|'payment'|'credit', date, period, amount, label, balance, generated?:true }`
- generated rent/recurring rows: id `rent-YYYY-MM` / `rec-<recurringId>-YYYY-MM`, `prorate: {days, ofDays, full, from, to} | null`, `recurringId`.
- opening row: id `'opening'`, label "Balance brought forward", dated `trackFrom`.
- stored entries: `kind:'entry'`, `entry` (raw), `method`, `ref`, `memo`, `category`, `void`, `createdAt`. Labels:
  payments "Payment · Zelle"; credits memo or "Credit"; charges memo or "Late fee — November".
- charges additionally: `paid`, `open`, `paidOn` (date fully paid, else null).
- payments/credits additionally: `applied: [{id (charge row id), amount}]`, `unapplied` (went to credit).
- **void rows are included** (`void:true`) with `balance` equal to the previous row's — render struck through.
  Rows with `entry.undone` are omitted entirely.
- Sort: date, then opening < charge < credit < payment, rent before recurring, then createdAt, then id.

Month: `{ period, charged, paid, open /* all charges with that period, incl. manual */, rentCharged, rentPaid, rentOpen /* rent+recurring only */,
rent, prorate, due, graceEnd, status, paidOn, daysLate, scheduled /* has rent/recurring */, lateFee /* a late_fee charge exists */ }`.
Status uses rent+recurring only: open=0 → `paid` (paidOn ≤ graceEnd) / `paid_late`; open>0 → `late` if today > graceEnd,
else `partial` (something paid) / `due`. `daysLate` = days from due date to today (late) or to paidOn (paid_late).
Months without rent/recurring (`scheduled:false`, e.g. after move-out with a manual charge) have status `'none'`.

Rules worth knowing: a month's charges exist from the 1st of that month (dated on the due day). First month is
prorated when `trackFrom === lease.moveIn` and not the 1st (dated on move-in if the due day is earlier). If
`trackFrom` is later than that month's due date and not the move-in date, that month is assumed to be inside
`opening` (no charge). Last month is prorated to `moveOut`; nothing is charged after it. `lease.dueDay/graceDays`
override settings; the due day clamps to month end. FIFO: payments/credits pay the oldest open charge; overpayment
becomes credit applied to the next charge (paidOn = date of that money).

### 6.2 Smaller helpers
- `rentOn(tenant, date)` → cents. `lateFeeAmount(tenant, settings, period)` → cents.
- `termsOf(tenant, settings)` → `{dueDay, graceDays}`.
- `monthsBack(ledger, endKey, n)` → n cells oldest→newest `{period, status, charged, paid, open, paidOn, daysLate, due}` (gaps = `'none'`) — feed to `ui.strip`.
- `monthStatus(ledger, key)` → status (`'none'` if untracked).
- `STATUS_LABEL`, `CATEGORY_LABEL`, `DEFAULT_SETTINGS`, `unitLabel(t)` ("Alder Court 2B"), `sortTenants(arr)`, `tenantsArr(state)`, `ticketsArr(state)`.

### 6.3 `leaseState(tenant, settings, today)`
`{ kind:'fixed'|'mtm'|'ended'|'upcoming', start, end, moveIn, moveOut, noticeDate, noticeGiven, daysLeft, inNoticeWindow,
progress /* 0..1 through the term, fixed only */, holdover /* end passed, still there */, label, daysToMoveOut }`
`label`: "in 43 d" · "ends today" · "month-to-month" · "ended" · "moving out in 22 d" · "moves in in 5 d".
`depositDue(tenant, settings, today)` → `{amount, moveOut, dueDate, daysLeft, overdue} | null` (after move-out, not returned).

### 6.4 `attention(state, today, getLedger?)` → Item[] (sorted: severity, then urgency)
```
{ id, kind, severity:'high'|'medium'|'low', rank, tenantId?, ticketId?, logId?, unit, title, detail, amount?, date?,
  action:{type, label, …args}, secondary?:{type, label, …args} }
```
kinds: `delinquent` (high), `late` (high), `partial` (medium), `ticket` (urgent → high, open normal → low), `lease`
(ending inside the notice window, no notice), `moveout`/`movein` (≤30 d), `deposit` (high ≤7 d), `followup`
(due, not done), `insurance` (≤30 d). Action types: `recordPayment {tenantId}`, `addLateFee {tenantId, period,
amount}` (label "Add late fee $50"), `openTenant`, `openTicket {ticketId}`, `followupDone {tenantId, logId}`,
`settleDeposit`, `renewLease`. Run any of them with **`RB.actions.run(item.action)`**.

### 6.5 `portfolio(state, today, period?, getLedger?)`
`{ period, charged, collected, outstanding /* all charges of the period */, received /* payments dated in the period */,
tenants /* with a charge */, counts:{paid, paid_late, partial, due, late, none}, paidCount, dueDate, graceEnd }`

### 6.6 Reports
- `rentRoll` → `{rows:[{tenantId, property, unit, name, status, rent, leaseStart, leaseEnd, moveOut, deposit, balance, monthStatus}], totals:{rent /* current tenants */, deposit, balance}, occupancy:{occupied, units, rate}}`
- `aging` → `{rows:[{tenantId, name, property, unit, d0_30, d31_60, d61_90, d90, total}], totals}` (only owing tenants)
- `collectionByMonth(state, today, n=12)` → `[{period, charged, collected, outstanding, rate /* 0..1 | null */}]` oldest→newest
- `incomeByYear(state, year, getLedger?, today?)` → `{year, rows:[{tenantId, name, property, unit, payments, credits, count, byMonth[12]}], totals:{payments, credits, byMonth}}` (cash basis)
(Store versions take fewer args: `RB.store.rentRoll()` etc.)

### 6.7 Text & CSV
- `receiptText({tenant, ledger, entryId, settings})`, `statementText({tenant, ledger, settings, from?, to?})` → plain text.
- `csv(rows, [{label, key | get(row), money?:true}])` → CRLF CSV (money as `1450.00`; formula-injection guarded).
- `ledgerCsv(ledger)`, `rentRollCsv(rr)`, `agingCsv(ag)`, `collectionCsv(rows)`, `incomeCsv(inc)`.
- `parseDelimited(text)` → `string[][]` (auto-detects comma/tab/semicolon; quotes; BOM) — for Setup import.

### 6.8 `tenantSummary(tenant, ledger, settings, today)`
`{tenantId, name, unit, property, rent, status, monthStatus, balance, delinquent, lease /* leaseState */, daysLate,
urgency /* lower = more urgent; default Tenants sort */}`

## 7. RB.actions (shared flows)

All return Promises; all guard read-only/loading with a toast.

| Call | Does |
|---|---|
| `recordPayment(tenantId, {quick?, amount?, date?, method?})` → entryId\|null | `quick:true`: records the full open balance today with the tenant's last-used method, toast "Recorded $1,450 from Unit 2B" + Undo (falls back to the sheet if nothing is owed). Otherwise the payment sheet (amount prefilled to `amount` ?? balance ?? rent, date, method, reference, memo, live "Balance after", button "Record $X"). |
| `recordPayments(tenantIds)` | bulk quick-pay; one toast "Recorded 6 payments · $8,400" + Undo |
| `addCharge(tenantId, preset?)`, `addCredit(tenantId, preset?)` | sheets; Undo toast |
| `addLateFee(tenantId, period?)` | one click; uses the ledger suggestion; Undo toast |
| `voidEntry(tenantId, entryId)` | Undo toast ("Voided $1,450 payment") |
| `editEntry(tenantId, entryId)` | sheet; Undo toast restores previous values |
| `copyReceipt(tenantId, entryId)`, `copyStatement(tenantId, {from,to}?)` | clipboard (call inside a click handler) |
| `downloadLedgerCsv(tenantId)` | via `downloadFile` |
| `addNote(tenantId, preset?)` | sheet (kind seg, text, follow-up date); Undo |
| `followupDone(tenantId, logId, done=true)` | Undo toast |
| `downloadFile(filename, text, mime)` → bool | `claude.use('downloads').save({filename, data})` (viewer confirms); on unavailable/refused shows a sheet with the text + Copy. Allowed extensions include csv, json, txt, md. |
| `openTenant(id)` | `location.hash = 't-' + id` |
| `loadSample({quiet}?)`, `removeSample()` (confirm sheet naming counts), `backup()`, `restore(parsedJson)` (confirm) | |
| `run(actionObj)` | dispatches attention actions (§6.4) |
| `who(tenant)` | "Unit 2B" / "No. 4" — for toasts |
| `lastMethod(tenantId)`, `monthOptions(today, back, fwd, sel)`, `LOG_KINDS`, `CATEGORIES` | helpers |

**Hooks views replace** (assign at load: `RB.actions.addTenant = myFullForm;`):
`addTenant(preset?)` (default: minimal working sheet), `editTenant(id)` (default: opens tenant), `addTicket()` (default:
`#upkeep` + `RB.emit('ticket:add')`), `openTicket(id)` (default: `#upkeep` + `RB.emit('ticket:open', id)`),
`settleDeposit(id)`, `renewLease(id)` (default: open tenant). The built-in commands call through `RB.actions.*`, so
replacing a hook also updates the palette, "+" menu, Today actions and first-run.

## 8. RB.ui

### 8.1 Renderers (return SafeHTML — interpolate directly into `h`)
| Call | Output |
|---|---|
| `icon(name, {size=16, label, cls})` | inline SVG. Names: today rent tenants leases upkeep wrench reports setup more more-v plus search check check-late clock triangle half circle dash chevron-left/right/down/up arrow-up arrow-right copy download upload phone mail note calendar key undo x filter sort trash edit external home user alert cash keyboard door sample grid link dot sync |
| `pill(status, {daysLate, label, size:'sm', title})` | status pill; late → "9 d late"; none → dash only |
| `tag(text, tone?, icon?)` | tones: '' accent ok warn bad quiet. `tenantTag(status)` for active/notice/past |
| `plate(unit, {size:'sm'\|'lg', status, button, title, property, attrs})` | door plate; lg = 44 px status plate with corner glyph; `button:true` + `attrs:{'data-act':'open','data-id':id}` for clickable |
| `strip(cells, {lg, today})` | 12-month payment strip from `RB.model.monthsBack(...)`; per-cell titles + aria-label |
| `money(cents, {size:'lg'\|'md', tone:'owed'\|'credit', sign, cents, cls})` | money with muted currency symbol |
| `balance(cents, {zero})` | owed red / credit muted "cr" / zero → em-rule (or `zero` text; `zero:''` renders nothing visible) |
| `date(d, {mono})` | `<time>` "Nov 3" |
| `kbd(...keys)`, `copyline(text, what, {href, hrefLabel, hrefIcon})` | `copyline` = selectable text + copy button (global handler, toast "Copied phone number") |
| `button({label, kind, size, icon, iconOnly, cmd, act, id, attrs, disabled, write})` | `.btn` markup |
| `empty({icon, title, body, actions:[button opts], quiet})` | empty state; `quiet:true` → one muted line ("Nothing needs you today.") |
| `skeleton({rows, title, plates})`, `loadingNote(text)`, `firstRun()` | loading / first run |
| `field(opts)` | form field (§8.3) |
| `attrs(obj)` | escaped attribute string |
| `highlight(text, query)`, `match(hay, query)` → score\|-1 | search helpers |
| `drawerClose()` | the standard drawer ✕ button |

### 8.2 Primitives
- `toast(message, {undo: fn, action:{label, run}, tone:'bad', icon, duration=7000 (0 sticky)})` → `{close}`. Past tense: "Recorded $1,450 from Unit 2B".
- `sheet({title, sub, body, size:'wide'|'xwide', actions:[{id, label, kind, onClick(handle)}], cancel='Cancel'|false, note, initialFocus, onClose(result)})` → handle `{el, body, form, close(result), action(id), setAction(id,{label,disabled}), setNote(html), setTitle(text)}`.
  `body` may be SafeHTML or `(bodyEl, handle) => {}`. The first `primary`/`danger` action is the submit (Enter in a
  field triggers it). `onClick` may return `false` (or a Promise of false) to keep the sheet open — the pattern is
  `const v = ui.form(handle.body, {validate}); if (!v) return false; …`. Centred modal on desktop, bottom sheet on phone.
- `confirm({title, body, confirmLabel, cancelLabel, danger})` → `Promise<boolean>`.
- `menu(anchorEl, items, {align:'start'|'end'})` — items `{label, icon, hint, danger, disabled, write, onSelect}` | `{sep:true}` | `{heading}`. Arrow keys, Esc, outside click; same anchor toggles.
- `drawer({label, render(el, handle), onClose, scrim=true})` → `{el, rerender(), close({silent}), isOpen()}`. One at a time; calling again replaces the content. Fill `el` with `.drawer-head` / `.drawer-body` / `.drawer-foot`. Esc/scrim/`[data-drawer-close]` close it and call `onClose` (the Tenants view sets `location.hash='tenants'` there). `ui.currentDrawer()`.
- `palette({placeholder, query, source(q) → [{group, items:[{id,label,sub,hint,icon,plate,run}]}], onClose(picked)})`, `pickTenant({title, filter, includePast})` → `Promise<id|null>`.
- `copy(text, what)` (toast or selectable fallback sheet), `showText({title, text, note, filename})`.
- `bind(el, handlers)` (§3.5). `isPhone()`. `closeAll()`. `hasModal()`. `topLayer()`.
- Focus: every layer traps Tab, closes on Esc, and restores focus to the opener.

### 8.3 Forms
`ui.field({name, id?, label, type, value, options, placeholder, hint, required, optional, span:2, attrs, rows, min, max, step, write})`
types: `text email tel number search money date select textarea checkbox seg`.
- `money`: value in cents; input shows `1,450.50`; reformatted on blur; read as cents.
- `seg`: segmented single choice (hidden input + buttons; dispatches `change`). Options `[{value,label,icon?}]` or strings.
- `ui.readForm(root, {validate(values) → {name: msg}})` → `{values, errors, ok}` (money → cents|null, date → string|null, checkbox → bool, number → Number|null, `required` → "Required").
- `ui.showErrors(root, errors, {focus=true})`; `ui.form(root, opts)` = read + show → values or null.
- `ui.setValue(root, name, value)`.

## 9. CSS component library

### 9.0 Tokens (colours: only these)
`--paper --surface --sunk --ink --ink-2 --ink-3 --line --line-2 --accent --accent-ink --accent-soft --ok --ok-soft
--warn --warn-soft --bad --bad-soft` (spec) plus derived: `--hover --accent-line --accent-hover --ok-line --warn-line
--bad-line --bad-ink --faint --scrim --toast-bg --toast-ink --toast-accent --toast-hover --shadow-float --shadow-modal --focus-ring`.
Type: `--f-display` (Newsreader) `--f-ui` (Plex Sans) `--f-mono` (Plex Mono); sizes `--t-12 --t-13 --t-15 --t-18 --t-24 --t-34 --t-body --t-micro`.
Space `--s1..--s7` (4 8 12 16 24 32 48). Radius `--r-ctl:6 --r-panel:10 --r-plate:3`. Sizes `--ctl-h` (32 → 44 phone)
`--ctl-h-sm` `--ctl-h-lg` `--row-h` (44 → 52 phone) `--gutter` `--rail-w` `--top-h` `--tab-h` `--sticky-top` (use for sticky things under the top bar).
New tokens go in 00-tokens.css in all three places (light, dark media, `[data-theme="dark"]`).

### 9.1 Utilities
`.row` (flex, centred, gap 8) `.row-wrap .row-top .row-base .gap-1/3/4/5` · `.stack` (column, gap 8) `.stack-1/3/4/5/6` ·
`.spacer .grow` · `.mt-2/4/5/6 .mb-2/4` · `.muted` (ink-2) `.faint` (ink-3) `.tone-ok/warn/bad/accent` ·
`.num` (tabular, right) `.mono .micro .display .h-view .t-12/13/15/18/24/34 .strong .medium .nowrap .truncate .prewrap` ·
`.vh` (visually hidden) · `.hide-phone .show-phone` · `.panel` (surface + hairline + radius 10; don't nest) · `.rule` (top hairline).

### 9.2 Components (markup)
```html
<!-- buttons: kinds btn-primary | btn-soft | btn-ghost | btn-danger | btn-danger-soft | (default bordered); sizes btn-sm | btn-lg; btn-icon; btn-block -->
<button class="btn btn-primary" type="button">Record $1,450</button>
<button class="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Copy"><svg…/></button>
<span class="btn-group"><button class="btn btn-sm btn-primary">Mark paid</button><button class="btn btn-sm btn-primary btn-caret" aria-label="Payment details"><svg chevron-down/></button></span>
<button class="linkbtn">Undo</button>  <button class="linkbtn linkbtn-muted">…</button>

<!-- inputs (prefer ui.field) -->
<input class="input" id="x"> <textarea class="input textarea"></textarea>
<span class="select"><select class="input">…</select></span>
<span class="money-input"><span class="money-sym">$</span><input class="input" data-kind="money" inputmode="decimal"></span>
<input class="input" type="date" data-kind="date">
<label class="search"><span class="search-icon"><svg/></span><input class="input" type="search"><kbd class="kbd search-kbd">/</kbd></label>
<label class="check"><input type="checkbox"> Label</label>

<!-- field layout -->
<div class="form-grid">   <!-- 2 cols (form-grid-3: 3), 1 col on phone; children .span-2 = full width -->
  <div class="field [is-invalid]"><label class="field-label" for="x">Amount <span class="opt">optional</span></label>…control…
    <div class="field-hint">…</div><div class="field-error">…</div></div>
</div>
<fieldset class="fieldset"><legend class="fieldset-title">Lease</legend>…</fieldset>   <!-- consecutive fieldsets get a rule -->
<div class="form-note">…</div>  <div class="form-sum"><span>Balance after</span><strong>$0</strong></div>

<div class="seg"><button aria-pressed="true">Comfortable</button><button aria-pressed="false">Compact</button></div>
<div class="chips [chips-scroll]"><button class="chip" aria-pressed="true">All<span class="chip-count">27</span></button>
  <button class="chip" aria-pressed="false">Late<span class="chip-count is-bad">3</span></button></div>   <!-- chips-scroll: one scrolling line on phone -->

<span class="pill pill-late">…</span>   <!-- pill-paid|paid_late|partial|due|late|none, pill-sm — use ui.pill -->
<span class="tag tag-warn">Notice given</span>   <!-- tag-accent|ok|warn|bad|quiet -->
<span class="plate plate-sm">2B</span>  <span class="plate plate-lg plate-late">…</span>  <!-- use ui.plate; .plate-fixed = equal width in columns; .plates = wrapping grid -->
<span class="pstrip [pstrip-lg]"><i class="pc pc-paid"></i>…</span>   <!-- use ui.strip -->
<span class="money [money-lg|money-md] [amt-owed|amt-credit]"><span class="cur">$</span>1,450</span>

<!-- data table: sticky header under the top bar, 44px rows -->
<div class="tbl-wrap"><table class="tbl [tbl-compact]">
  <thead><tr><th class="tbl-check"><input type="checkbox"></th>
    <th aria-sort="ascending"><button class="th-sort">Tenant<svg class="sort-ind" arrow-up/></button></th>
    <th class="num">Rent</th><th class="shrink"></th></tr></thead>
  <tbody><tr class="is-link | is-selected | is-focused | is-muted"><td><span class="cell-name">Name</span><span class="cell-sub">co-tenant</span></td><td class="num">…</td></tr>
    <tr class="tbl-group"><td colspan="9">Alder Court</td></tr></tbody>
  <tfoot><tr><td>Total</td><td class="num">…</td></tr></tfoot></table></div>
<div class="totals"><div><span class="micro">Charged</span><span class="money">…</span></div>…</div>

<!-- phone card list: same row as a card -->
<div class="clist"><div class="crow [is-link] [is-selected]"><span class="crow-lead">plate</span>
  <div class="crow-main"><div class="crow-title">Name</div><div class="crow-sub">detail</div></div>
  <div class="crow-aside">pill + amount</div><div class="crow-actions">buttons (full width; btn-group supported)</div></div></div>

<!-- ledger -->
<table class="ledger"><thead><tr><th>Date</th><th>Description</th><th class="l-amt">Charge</th><th class="l-amt">Payment</th><th class="l-bal">Balance</th><th class="l-act"></th></tr></thead>
  <tbody><tr class="ledger-month"><td colspan="6">November 2026</td></tr>
  <tr class="[is-void]"><td class="l-date">Nov 03</td><td class="l-desc"><span class="l-desc-text">Payment · Zelle</span><span class="l-sub">Ref 4481</span></td>
    <td class="l-amt"></td><td class="l-amt l-pay">$1,450</td><td class="l-bal">$0</td><td class="l-act">⋯ button</td></tr></tbody></table>
<!-- dates: D.fmtNum(date, {mon:true}) → "Nov 03" -->

<div class="sec [sec-sm]"><h2 class="sec-title">Needs attention</h2><span class="sec-meta">14</span><div class="sec-actions">…</div></div>
<dl class="kv [kv-plain]"><dt>Phone</dt><dd>…</dd></dl>
<div class="lrow"><span class="lrow-lead">plate</span><div><div class="lrow-title"><span class="lrow-sev sev-high"></span> Name</div><div class="lrow-detail">…</div></div><div class="lrow-actions">…</div></div>
<div class="tl"><div class="tl-item [is-done]"><span class="tl-when">Nov 17</span><div class="tl-body">… <div class="tl-meta">…</div></div><input type="checkbox"></div></div>
<div class="empty">…</div> (ui.empty)   <div class="skeleton">…</div> (ui.skeleton)   <section class="firstrun"> (ui.firstRun)
<div class="bar [bar-lg|bar-thin]"><span class="bar-seg bar-seg-ok" style="width:68%"></span><span class="bar-seg bar-seg-warn" style="width:6%"></span><span class="bar-mark" style="left:84%"></span></div>
<div class="bar-legend"><span class="bar-key bar-key-ok">Collected</span>…</div>
<div class="stepper"><button class="btn btn-ghost btn-icon">‹</button><span class="stepper-label">November 2026</span><button …>›</button></div>
<div class="actionbar">6 selected <button class="btn btn-primary">Record 6 payments</button></div>   <!-- fixed bottom bar for bulk mode -->
<div class="view-head">…</div>   <!-- top-of-view toolbar row -->
<kbd class="kbd">⌘K</kbd>  <span class="dot dot-ok|warn|bad|accent [dot-pulse]"></span>  <div class="code-block">…</div>
<div class="banner [banner-warn]"><div class="banner-text">…</div><div class="banner-actions">…</div></div>
```
Floating layers (`.menu .menu-item .menu-sep .menu-label .popover .drawer .drawer-head/-title/-body/-foot/-close .sheet-wrap .sheet .sheet-* .toast .palette*`)
are produced by `RB.ui` — don't hand-build them; style tweaks go through those classes.

## 10. Other globals
`RB.esc(v)`, `RB.html`, `RB.html.join(items, sep)`, `RB.raw(s)`, `RB.isSafe(v)`, `RB.safeUrl(u)`, `RB.id(n=12)` (letters+digits — valid in `#t-<id>`),
`RB.clone(v)`, `RB.isObj(v)`, `RB.debounce(fn, ms)` (`.cancel()`, `.flush()`), `RB.natCmp(a,b)`, `RB.plural(n, one, many?)`,
`RB.copyText(text)` → Promise<bool>, `RB.prefs.get(key, default)` / `.set(key, val)` / `.remove(key)`,
`RB.on(name, fn)` → off / `RB.emit(name, data)` (events: `store:writeError`, `ticket:add`, `ticket:open`), `RB.$(sel, root)`, `RB.$$(sel, root)`.

`RB.date`: `today() nowIso() valid(s) isDate(s) isMonth(k) parts(s) make(y,m,d) toDays(s) fromDays(n) addDays(s,n) addMonths(s,n)
diffDays(a,b) /* b−a */ cmp min max monthKey(s) addMonthKey(k,n) diffMonths(a,b) monthStart(k) monthEnd(k) daysInMonth(k | y,m)
dayIn(k, day) weekday(s) fmt(s, today) fmtLong(s) fmtNum(s, {mon}) fmtMonth(k) fmtMonthShort(k, today, {year}) monthName(k)
rel(s, today, {style:'late'}) days(n) parseLoose(text, today) MONTHS MON`.

`RB.money`: `fmt(cents, {sign, cents:'auto'|'always'|'never'}) digits(cents, opts) plain(cents) /* "1450.00" */ input(cents) /* "1,450.50" */
parse(text) → cents|null round(x) symbol setCurrency(code)`.

## 11. Platform notes (cloud vs local)

- Boot renders immediately; `RB.store.start()` awaits `window.claude?.use('db')` (may take 10 s or resolve null).
  null/absent → **local mode**: everything in memory, persisted to localStorage key `rb:data:v1`, sync note "Not
  syncing — saved on this device only". This is how preview, tests and screenshots run.
- Cloud: one `collection(...).onSnapshot(next, error)` each for `meta`, `tenants`, `ledgers`, `tickets`; a 10 s timer
  sets `loadIssue:'timeout'` (banner) if the server hasn't answered; `state.ready` waits for the server's answer on
  tenants (no empty-state flash from an empty cache). Writes: one at a time per document, ≤4 in flight overall,
  transient `unavailable` retried once, `invalid_argument`/`revoked`/`not_granted` → `readOnly` ("View only"),
  `quota_exceeded`/`resource_exhausted` → toast. Optimistic ops are folded over snapshot data until the next
  snapshot after the write resolves. The publishing step must declare `capabilities: {db: {}, downloads: true}`
  (optionally `user: {}`, used only to learn `can('data.write') === false` up front).
- `tools/cloud-sim.mjs` drives the cloud path against a fake db that follows the documented API; it is a simulation,
  not the platform.

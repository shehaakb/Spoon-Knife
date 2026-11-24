# Rent Book — foundation contract

What view authors code against. SPEC.md is the product spec; this file is the API. If the two disagree about
*behaviour*, SPEC wins; if they disagree about a *function name or shape*, this file wins (it describes what exists).

- Build: `node build.mjs` → `dist/rent-book.html` + `dist/preview.html`. Open `dist/preview.html` directly (file://).
- Tests: `node --test test/*.test.mjs` (pure model + sample data).
- Screens: `node tools/shots.mjs [--only rent,kit] [--size desktop,phone,rail,wide] [--theme light|dark] [--no-build]` → `shots/*.png`.
  Default sizes are desktop (1360) and phone (390); `rail` (900, icon rail) and `wide` (1600) run only when named.
  Fails on console errors and on horizontal page overflow at any non-desktop size.
- Interaction smoke tests (run `node build.mjs` first): `node tools/smoke.mjs` (core), `tools/smoke-today-rent.mjs`,
  `tools/smoke-tenants.mjs`, `tools/smoke-other.mjs` (Leases, Upkeep, Reports, Setup). Cloud-path simulation:
  `node tools/cloud-sim.mjs` (fake db, see §11).
- Component review page: open `dist/preview.html#kit` (not in the nav). Every class below is rendered there.
- Screens at a text size: `node tools/shots.mjs --text xl` (or `lg`) → `shots/<name>-<size>-<theme>-xl.png`; overflow of any element past the screen edge fails the run.

## What changed in v2 for view authors (read first)

v2 makes the whole app easy for a non-technical 50+ user (SPEC §8 — the eleven rules and the **glossary** are the
wording authority; use its words exactly in UI, toasts, CSV headings and help). Most of it arrives automatically through
tokens and `RB.ui`; these are the things **you** must do to stay consistent:

1. **Sizes come from tokens, which scale.** Every size token multiplies by `--text-scale` (Text size control:
   Normal 1 · Large 1.12 · Extra large 1.25, `data-text="lg|xl"` on the root element). Never write literal `px` for type, control heights
   or row heights in view CSS — use `var(--t-*)`, `var(--ctl-h*)`, `var(--row-h)`, `var(--s*)`, or `calc(Npx * var(--text-scale))`.
   Token *names* are unchanged but values went up: `--t-12` 14px · `--t-13` 15 · `--t-15` 17 · `--t-18` 20 · `--t-24` 27 ·
   `--t-34` 38 · `--t-body` 16 desktop / 17 phone · `--t-micro` 14. `--ctl-h` 44 desktop / 48 phone, `--ctl-h-sm` 40 / 48,
   `--ctl-h-lg` 52 / 56, new `--ctl-h-xl` 64, `--row-h` 56 / 60, `--icon` 18. Nothing on phone may be tappable below 48px
   (`.linkbtn` is inline text — for a standalone quiet action use the new **`.btn-link`**). Check your view at 390px with
   `node tools/shots.mjs --size phone --text xl` — the run fails on any element wider than the screen.
2. **Secondary text is `--ink-2` (`.muted`) wherever it means something.** `--ink-3` (`.faint`) is decoration only.
3. **No icon-only buttons.** `ui.button({iconOnly})` now always shows its label; `ui.copyline` renders a worded "Copy"
   (and "Call" etc. via `hrefLabel`); `ui.drawerClose()` reads "Close" (desktop) / "Back" (phone full-screen page); sheet
   close reads "Close". Replace any hand-built `btn-icon` with words (row menus: a "More" button with the `more` icon + word).
4. **Shared words changed** (see the table below). If your smoke script matches old strings, update it.
5. **Forms:** use `.form-col` (one column), question labels ("How much is the rent each month?"), `type:'choice'` instead
   of `select` for ≤ 6 options, put optional fields in `ui.moreDetails(...)`, state the action on the primary button,
   and set a plain live sentence with `handle.setNote(...)`. Long flows (Add a tenant) use **`ui.steps`** (§8.4).
6. **Confirm** (`ui.confirm`) now renders a plain sentence, a large "Keep it" (focused) and a red worded button —
   pass `confirmLabel` that says the action ("Delete Maya Okafor"), and a `body` that says the consequence.
7. **Status:** render month status with `ui.monthPill(month)` (or `ui.pill(status, {daysLate, paid})`) so a late month
   with money paid reads **"Part paid — rest is 22 days late"**, never just "Late". Plain text: `ui.statusWords(month)`.
8. **Routes/nav:** nav label "Repairs" (`#repairs`; `#upkeep` is an alias — `RB.views.get('repairs')` finds a view
   registered as either name), "Settings" (route stays `#setup`). `#p-<slug>` routes to the Repairs view with
   `ctx.param = slug`. Keyboard shortcuts are not advertised anywhere in the main UI; Settings links to them with
   `data-cmd="help:keys"` (still works, also `?`).
9. **Compact density is gone.** `.tbl-compact` is a no-op (rows stay ≥ 52px); remove density toggles from your view.
10. **Text size control:** `ui.textSizeControl({id})` — the Settings engineer places one on the Settings page
    (the shell already shows it in the sidebar footer and the phone More sheet).

### Shared-helper output: old → new
| Helper | Old | New |
|---|---|---|
| `RB.date.rel` | "in 12 d", "9 d ago", "9 d late", "1 d late" | "in 12 days", "9 days ago", "9 days late", "1 day late" (today / tomorrow / yesterday unchanged) |
| `RB.date.days(n)` | "9 d" | "9 days" / "1 day" |
| `ui.pill` | partial "Partial", due "Due", late "9 d late", none = dash only | "Part paid", "Not paid yet", "9 days late", late with `paid>0` → "Part paid — rest is 9 days late" (class `pill-partial_late`), none = dash + "No rent this month" |
| `RB.model.STATUS_LABEL` | Partial / Due | Part paid / Not paid yet (tiny model change) |
| `ui.balance(c)` | owed "$1,225" red · credit "$250 cr" · zero "—" | "Owes $1,225" · "$250 paid ahead" · "All paid up" (`{plain:true}` → "$1,225" / "$250 ahead" / "—"; `{zero:''}` still works). Classes `.bal .bal-owed .bal-ahead .bal-zero`; `.cr` no longer rendered |
| `ui.tenantTag` | "Notice given", "Past" | "Moving out", "Moved out" |
| `ui.strip` titles | "partly paid", "due", "no charge", "9 d late" | "part paid", "not paid yet", "no rent", "9 days late" |
| `ui.copyline` | icon-only copy button | `<button class="btn btn-sm btn-worded">` Copy icon + "Copy"; link button shows `hrefLabel` text; empty → "Not given" |
| `ui.button` | `iconOnly` → `.btn-icon` + aria-label | label always visible in `<span class="btn-label">`; `iconOnly` adds `.btn-worded` |
| `ui.drawerClose` | ✕ icon only | ✕ "Close" (desktop) / ‹ "Back" (phone) |
| `ui.toast` | 7 s, small "Undo" link, ✕ | **10 s** (`ui.TOAST_MS`), large filled Undo button (with icon), worded "Close" (`.toast-x` is now a text button) |
| `ui.sheet` | ✕ close | ✕ "Close"; foot note is a full-width sentence; actions accept `hidden`; `handle.setAction(id,{hidden})`, `handle.setSub(text)` |
| `ui.confirm` | Cancel + Confirm | red `confirmLabel` + large **"Keep it"** (`kind:'keep'`, `.btn-keep`, focused); `cancelLabel` overrides "Keep it" |
| `ui.palette` | placeholder "Search…", kbd hints footer | "Find…", footer is a "Close" button |
| `ui.pickTenant` | palette list | a sheet: find box + large rows (plate, name, property, "Owes $X"/"All paid up", "N days late"); `prefer:'owes'`, `skip` |
| `ui.firstRun` | "Import from a spreadsheet", "Explore with sample data" | "Bring in my tenants", "Try it with sample tenants first" |
| `ui.copy` toast | "Copied phone number" | "Copied the phone number. You can paste it into a text message or email." |
| actions toasts | "Recorded $1,450 from Unit 2B" · "Added $40 charge to Unit 2B" · "Credited $40 to …" · "Added late fee $50 to …" · "Voided $1,450 payment" · "Note added" · "Follow-up done" | "Recorded $1,450 from Maya Okafor. All paid up." / "… Still owes $550." · "Added a $40 charge for Maya Okafor." · "Took $40 off what Maya Okafor owes." · "Added a $50 late fee for Maya Okafor (November)." · "Removed the $1,450 payment for Maya Okafor." · "Saved your note for Maya Okafor." · "Marked the reminder done." |
| action sheets | "Record payment", "Add charge", "Add credit", "Add note", "Edit payment" | "Record a payment", "Add a charge", "Take money off what they owe", "Write a note", "Change this payment" (field ids unchanged: `pay-amount`, `pay-date`, `pay-method` (now radio cards `pay-method-0…`), `pay-ref`, `pay-memo`, `chg-*`, `cr-*`, `note-*`, `ed-*`; new `pay-how-0/1`) |
| `removeSample` / `restore` confirm | "Remove sample data" | "Remove sample tenants" / "Replace with the copy" |
| commands | "Record payment…", "Add charge…", "Add credit…", "Add note…", "Add tenant", "New upkeep request", "Import tenants…", "Download backup (JSON)", "Load/Remove sample data" | "Record a rent payment", "Add a charge", "Take money off what someone owes", "Write a note", "Add a tenant", "Log a repair", "Bring in my tenants", "Save a copy of everything", "Load/Remove sample tenants"; new `payment:part`, `help:howto`, `textsize`; `help:keys` hidden from Find but still runs |
| shell | nav "Upkeep", "Setup"; "Shortcuts ?" in sidebar; ⌕ / + icon buttons; banner "Remove sample data" / "Import my tenants" | "Repairs", "Settings"; Help + Text size in sidebar; "Find" / "Add" worded; banner "Remove sample tenants" / "Bring in my tenants"; sync "Everything is saved" |
| CSS removed/renamed | `.rail-help-label` kbd, `.search-kbd` in the top bar, `.tbl-compact` heights, `.stepper` in Rent, Rent `.rent-tbl`, `.rent-card`, `#rent-f-*` chips, `#rent-sheet-*`, `#rent-all`, `#rent-select` | Rent now `.rent-list > .rent-row` with `#rent-pay-<id>`, `#rent-part-<id>`, `#rent-more-<id>`, tabs `#rent-tab-owes|paid|all`, `#rent-bulkmode`, `#rent-chk-<id>`, `#rent-bulk`. Today: `.td-task`, `#td-say`, `.td-row`, `.td-sentence` (`.lrow` kept in the library) |


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
| `src/js/views/today.js` | **Today** view (three task buttons, rent sentence, What needs you, month at a glance, activity) |
| `src/js/views/rent.js` | **Rent** view (Still owes / Paid, two-tap payment, part payments, "Record several at once") |
| `src/js/views/tenants.js` | **Tenants** list; hosts the `#t-<id>` drawer; shares state with the two files below via `RB._tn` |
| `src/js/views/tenant-detail.js` | tenant drawer (header, contact, lease, ledger, notes & timeline) |
| `src/js/views/tenant-forms.js` | tenant sheets; assigns hooks `addTenant`, `editTenant`, `changeRent`, `giveNotice`, `moveOut`, `settleDeposit` |
| `src/js/views/leases.js` | **Leases** view; assigns hook `renewLease` |
| `src/js/views/repairs.js` | **Repairs** view (formerly Upkeep; `#repairs`, `#upkeep`, `#p-<slug>`); assigns hooks `addTicket`, `openTicket` |
| `src/js/views/reports.js` | **Reports** view (rent roll, aging, collection, income) |
| `src/js/views/setup.js` | **Setup** view (settings, import, backup, sample data) |
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
  Display: `D.fmt(d, today)` → "Nov 3" / "Nov 3, 2025"; deadlines `D.rel(d, today)` → "in 12 days" / "9 days ago" / `{style:'late'}` → "9 days late"; `D.days(n)` → "1 day" / "9 days". Never abbreviate.
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
open when `ctx.param`), `#leases`, `#repairs` (alias `#upkeep`) and `#p-<slug>` → repairs.js (registered as `repairs` or `upkeep`; `ctx.view` is `'repairs'`), `#reports`, `#setup` (labelled Settings), `#kit`. Unknown hash → Today.
Parameterised routes live in `PATTERNS` in 40-shell.js (`[regex, view]`, first capture → `ctx.param`). Intents in use: `go('rent','owes')`, `go('repairs','history')`, `go('setup','import')`.

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
- `RB.shell.openPalette(query?)` (Find), `RB.shell.quickAdd(anchorEl)` (the "Add" menu), `RB.shell.helpSheet()` → **"How do I…?"** (nine answers,
  each with a button that starts the task; `RB.shell.HELP` lists them), `RB.shell.keysSheet()` → keyboard shortcuts,
  `RB.shell.textSizeSheet()`, `RB.shell.lateTenants()` → tenants with any month in status `late` (the Rent badge).
- `RB.commands.register({id, label, group?, icon?, hint?, keywords?, run, when?, quickAdd?, write?})` → unregister fn.
  Shows in the ⌘K palette (`group` heading, default "Actions"); `quickAdd: n` also puts it in the "+" menu at order n;
  `write: true` hides/blocks it when read-only; `when()` → false hides it. `RB.commands.run(id)`.
  **Any element with `data-cmd="<id>"` runs that command on click** (used by first-run, banner, Setup).
- Built-in command ids: `go:today|rent|tenants|leases|repairs|reports|setup` (`go:upkeep` kept, hidden), `payment:record`
  ("Who paid you?" chooser, owing tenants first), `payment:part`, `charge:add`, `credit:add` ("Take money off…"), `note:add`,
  `tenant:add`, `ticket:add` ("Log a repair"), `setup:import` (→ `go('setup','import')`), `backup:download`, `sample:load`,
  `sample:remove`, `help:howto` (Help), `help:keys` (shortcuts; hidden from Find), `textsize`.
- Global keys (ignored while typing in a **text-entry** control — text-like `input`s, `textarea`, `select`,
  `contenteditable`; checkboxes, radios and buttons do *not* swallow shortcuts, so `j/k/p` keep working after a click on a tick box): `/` search (opens palette), `⌘K`/`Ctrl-K` palette (works in fields
  too), `n` or `+` quick-add menu, `?` help, `g d` Today, `g r` Rent, `g t` Tenants, `g l` Leases, `g u` Upkeep,
  `g p` Reports, `g s` Setup, `Esc` closes the top layer. Everything else goes to your `onKey(e, ctx)` (only when
  your view is in `ready` state and no sheet/menu/palette is open; **your drawer being open does not block it** —
  that's how `j/k` stepping in the tenant drawer works).
- Palette search covers tenant name, unit, property, phone, email, co-tenants; ≤3 matches add "Record payment / Add
  note / Add charge — <name>" actions.
- Chrome the shell maintains: rail and tab-bar counts (Today = number of "What needs you" items, i.e.
  `RB.store.attention().length`; Rent = tenants with rent past grace in *any* month, `RB.shell.lateTenants()`), phone tab bar
  (Today · Rent · Tenants · Repairs · More, labels always shown), More sheet (Leases, Reports, Settings, Help, Text size),
  sidebar footer (Help, Text size, sync note), sample-data banner / load-issue banner, sync note ("Everything is saved",
  "Saving…", "Not syncing — saved on this device only", "View only"), "View only" tag in the top bar. The app name
  (sidebar, and the "RB" plate in the phone top bar) returns to Today. Top bar: view title, "Find" field/button, "Add" menu.
  Ids: `#rb-nav-<route>`, `#rb-tab-<route>`, `#rb-more`, `#rb-help`, `#rb-ts-normal|lg|xl`, `#rb-find`, `#rb-add`, `#rb-brand`, `#rb-brand-phone`.

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
(due, not done), `insurance` (≤30 d). `moveout`: a future move-out ≤30 d away → `openTenant` "Plan move-out"; a tenant
still on `notice` on/after their move-out date → `moveOut` "Complete move-out". Action types: `recordPayment {tenantId}`,
`addLateFee {tenantId, period, amount}` (label "Add late fee $50"), `openTenant`, `openTicket {ticketId}`,
`followupDone {tenantId, logId}`, `settleDeposit`, `renewLease`, `moveOut {tenantId}`. Run any of them with **`RB.actions.run(item.action)`**.

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

### 6.8a Move-out and deposit (pure)
- `moveOutPreview(tenant, entries, settings, today, moveOut)` → `{moveOut, period, finalRows /* generated rent+recurring rows of
  the final month, with prorate */, finalTotal, balance /* at move-out if nothing more is paid; <0 credit */, balanceNow, depositDueDate}`.
  Builds the ledger as it will stand on max(today, moveOut) with `lease.moveOut` set.
- `depositSettlement({deposit, deductions:[{reason, amount}], balance, applyToBalance})` → `{deposit, deducted, available,
  applied /* deposit used against what is owed */, creditRefunded /* credit on account paid back with the deposit */, refund,
  shortfall /* deductions beyond the deposit */, balanceAfter, lines}`.

### 6.8 `tenantSummary(tenant, ledger, settings, today)`
`{tenantId, name, unit, property, rent, status, monthStatus, balance, delinquent, lease /* leaseState */, daysLate,
urgency /* lower = more urgent; default Tenants sort */}`

## 7. RB.actions (shared flows)

All return Promises; all guard read-only/loading with a toast.

| Call | Does |
|---|---|
| `recordPayment(tenantId, {quick?, amount?, part?, date?, method?})` → entryId\|null | `quick:true`: records `amount` ?? the full balance today with the last-used method, toast "Recorded $1,450 from Maya Okafor. All paid up." + Undo (falls back to the sheet if nothing is owed). Otherwise the sheet: when they owe, **"Did they pay all of it?"** — "Yes, all $X" (preselected; X = `amount` ?? balance) / "Only part of it" (`part:true` preselects it; reveals an empty, focused "How much did they pay?" with hint "They owe $X…"); "When did you get it?"; "How did they pay?" as large choices (last method preselected); reference + note behind "Add more details (optional)"; live sentence (`afterSentence`): "After this, Imogen will still owe $550 for November." / "…will be all paid up." / "That is $50 more than they owe — it will count toward next month."; button "Record $X". Blank/zero → "Type how much they paid, like 800". |
| `recordPayments(tenantIds, opts?)` | bulk quick-pay; one toast "Recorded 6 payments · $8,400" + Undo. Each records the tenant's whole balance unless `opts.amounts = {tenantId: cents}` names an amount (capped at the balance), e.g. one past month's open amount. |
| `addCharge(tenantId, preset?)`, `addCredit(tenantId, preset?)` | "Add a charge" / "Take money off what they owe" sheets (question labels, kind as choices, date/month behind "more details"); Undo toast |
| `afterSentence(tenant, ledger, cents)` | the plain "After this, …" sentence used by the payment sheet |
| `addLateFee(tenantId, period?)` | one click; uses the ledger suggestion; Undo toast |
| `voidEntry(tenantId, entryId)` (alias `removeEntry`) | "Remove" in the UI; Undo toast ("Removed the $1,450 payment for Maya Okafor.") |
| `editEntry(tenantId, entryId)` | sheet; Undo toast restores previous values |
| `copyReceipt(tenantId, entryId)`, `copyStatement(tenantId, {from,to}?)` | clipboard (call inside a click handler). A part payment's receipt adds "Part payment received: $800." / "Still owed for November: $675."; statements list part-paid months at the end |
| `downloadLedgerCsv(tenantId)` | via `downloadFile` |
| `addNote(tenantId, preset?)` | sheet (kind seg, text, follow-up date); Undo |
| `followupDone(tenantId, logId, done=true)` | Undo toast |
| `downloadFile(filename, text, mime)` → bool | `claude.use('downloads').save({filename, data})` (viewer confirms); on unavailable/refused shows a sheet with the text + Copy. Allowed extensions include csv, json, txt, md. |
| `openTenant(id)` | `location.hash = 't-' + id` |
| `loadSample({quiet}?)`, `removeSample()` (confirm sheet naming counts), `backup()`, `restore(parsedJson)` (confirm) | |
| `run(actionObj)` | dispatches attention actions (§6.4) |
| `who(tenant)` | "Unit 2B" / "No. 4" — for toasts |
| `lastMethod(tenantId)`, `monthOptions(today, back, fwd, sel)`, `LOG_KINDS`, `CATEGORIES` | helpers |

**Hooks views replace** (assign at load: `RB.actions.addTenant = myFullForm;`). Core defaults in brackets; the file that
replaces each is listed in §0.

| Hook | Does (as implemented) |
|---|---|
| `addTenant(preset?)` | full tenant sheet [minimal working sheet] |
| `editTenant(id, section?)` | edit sheet focused on `section` (`who contact cotenants emergency lease terms money recurring deposit insurance links about`) [opens the tenant] |
| `changeRent(id)` | sheet: new amount + effective date, appended to the `rent` schedule (history never rewritten); Undo |
| `giveNotice(id)` | sheet: notice date + move-out date → status `notice`, a `notice` log entry; Undo |
| `moveOut(id)` | sheet: move-out date with final-month preview. Date ≤ today → status `past`, then `settleDeposit` if a deposit is held. **Date in the future → recorded as notice** (status `notice`, `lease.moveOut` set, sheet says so); Today and the drawer offer "Complete move-out" once the date arrives |
| `settleDeposit(id, opts?)` | deductions list, apply-to-balance, refund auto-computed, deadline shown; Undo [opens the tenant] |
| `renewLease(id)` | sheet: new end date + optional new rent from a date [opens the tenant] |
| `addTicket(prefill?)` | repair sheet (Today's "Log a repair" passes `{tenantId}` or nothing) [`#repairs` + `RB.emit('ticket:add')`] |
| `openTicket(id)` | repair sheet for that ticket [`#repairs` + `RB.emit('ticket:open', id)`] |

Help answers and Today call `changeRent`, `giveNotice`, `moveOut` **only if defined**, otherwise they open the tenant page.

The built-in commands call through `RB.actions.*`, so replacing a hook also updates the palette, "+" menu, Today actions
and first-run. `run(action)` dispatches every action type in §6.4, including `moveOut`.

## 8. RB.ui

### 8.1 Renderers (return SafeHTML — interpolate directly into `h`)
| Call | Output |
|---|---|
| `icon(name, {size=16, label, cls})` | inline SVG. Names: today rent tenants leases upkeep wrench reports setup more more-v plus search check check-late clock triangle half circle dash chevron-left/right/down/up arrow-up arrow-right copy download upload phone mail note calendar key undo x filter sort trash edit external home user alert cash keyboard door sample grid link dot sync |
| `pill(status, {daysLate, paid, label, size:'sm', title})` | status pill in glossary words: Paid · Paid late · Part paid · Not paid yet · "9 days late"; `late` with `paid > 0` (or status `'partial_late'`) → "Part paid — rest is 9 days late"; none → dash + "No rent this month" |
| `monthPill(month, opts)` | the pill for a `RB.model` Month (passes `daysLate` and `rentPaid`) — **use this** |
| `statusWords(month, today?)` | plain text: "Paid Nov 3", "Part paid — $800 of $1,475", "Not paid yet — due Dec 1", "22 days late", "Part paid — rest is 22 days late" |
| `balanceWords(cents)` | plain text: "Owes $1,225" / "All paid up" / "$250 paid ahead" |
| `splitBar(paid, total, {label})` | thin two-tone bar (`.splitbar > .splitbar-paid`), paid share drawn to scale |
| `tag(text, tone?, icon?)` | tones: '' accent ok warn bad quiet. `tenantTag(status)` for active/notice/past |
| `plate(unit, {size:'sm'\|'lg', status, button, title, property, attrs})` | door plate; lg = 44 px status plate with corner glyph; `button:true` + `attrs:{'data-act':'open','data-id':id}` for clickable |
| `strip(cells, {lg, today})` | 12-month payment strip from `RB.model.monthsBack(...)`; per-cell titles + aria-label |
| `money(cents, {size:'lg'\|'md', tone:'owed'\|'credit', sign, cents, cls})` | money with muted currency symbol |
| `balance(cents, {zero, plain})` | worded: "Owes $1,225" (red) / "$250 paid ahead" (green) / "All paid up"; `zero` text overrides zero (`''` renders nothing visible); `plain:true` → figures only |
| `date(d, {mono})` | `<time>` "Nov 3" |
| `kbd(...keys)`, `copyline(text, what, {href, hrefLabel, hrefIcon})` | `copyline` = selectable text + a worded **Copy** button (global handler) + optional worded link button (`hrefLabel`, e.g. "Call") |
| `button({label, kind, size, icon, iconOnly, cmd, act, id, attrs, disabled, write})` | `.btn` markup; the label is always visible (`iconOnly` is ignored apart from tighter padding) |
| `textSizeControl({id, compact})` | "Text size: Normal · Large · Extra large" (buttons `#<id>-normal|lg|xl`, `data-textsize`); every copy stays in sync; remembered per device (`RB.textSize.get/set`, pref `textSize`) |
| `moreDetails(body, {id, label, open})` | `<details class="more-details">` "Add more details (optional)" disclosure for optional fields |
| `empty({icon, title, body, actions:[button opts], quiet})` | empty state; `quiet:true` → one muted line ("Nothing needs you today.") |
| `skeleton({rows, title, plates})`, `loadingNote(text)`, `firstRun()` | loading / first run |
| `field(opts)` | form field (§8.3) |
| `attrs(obj)` | escaped attribute string |
| `highlight(text, query)`, `match(hay, query)` → score\|-1 | search helpers |
| `drawerClose()` | the standard drawer close: "Close" on desktop, "Back" on phone |

### 8.2 Primitives
- `toast(message, {undo: fn, action:{label, run}, tone:'bad', icon, duration=10000 (0 sticky)})` → `{close}`. Large, plain, full
  sentence in past tense with the person's name: "Recorded $1,385 from Claire Dubois. All paid up." On phone it sits above the tab bar.
- `sheet({title, sub, body, size:'wide'|'xwide', actions:[{id, label, kind, onClick(handle)}], cancel='Cancel'|false, note, initialFocus, onClose(result)})` → handle `{el, body, form, close(result), action(id), setAction(id,{label,disabled}), setNote(html), setTitle(text)}`.
  `body` may be SafeHTML or `(bodyEl, handle) => {}`. The first `primary`/`danger` action is the submit (Enter in a
  field triggers it). `onClick` may return `false` (or a Promise of false) to keep the sheet open — the pattern is
  `const v = ui.form(handle.body, {validate}); if (!v) return false; …`. Centred modal on desktop, bottom sheet on phone.
- `confirm({title, body, confirmLabel, cancelLabel='Keep it', danger})` → `Promise<boolean>`. Body = one plain consequence
  sentence; red worded button + larger focused "Keep it" (first on phone). Nothing to type.
- `menu(anchorEl, items, {align:'start'|'end'})` — items `{label, icon, hint, danger, disabled, write, onSelect}` | `{sep:true}` | `{heading}`. Arrow keys, Esc, outside click; same anchor toggles.
- `drawer({label, render(el, handle), onClose, scrim=true})` → `{el, rerender(), close({silent}), isOpen()}`. One at a time; calling again replaces the content. Fill `el` with `.drawer-head` / `.drawer-body` / `.drawer-foot`. Esc/scrim/`[data-drawer-close]` close it and call `onClose` (the Tenants view sets `location.hash='tenants'` there). `ui.currentDrawer()`.
- `palette({placeholder, query, source(q) → [{group, items:[{id,label,sub,hint,icon,plate,run}]}], onClose(picked)})` (shown to people as **Find**).
- `pickTenant({title='Which tenant?', sub, filter, includePast, prefer:'owes', skip})` → `Promise<id | '' | null>`: a sheet with a
  big find box and large rows (door plate, name, property, "Owes $X" / "All paid up", "N days late"). `prefer:'owes'` puts
  owing tenants first, most owed first (use for payments). `skip: 'It’s for a whole building'` adds a button that resolves `''`.
  `null` = cancelled. Row buttons: `#pick-<id>`, find box `#pick-q`.
- **`steps({title, steps:[{title, body(el, data), validate(values, data)}], summary(data), onDone(data), doneLabel='Save', data, size})`** —
  step-by-step guide in a sheet: "Step 2 of 3", Back / Next (Enter = Next), each step's named fields are read with
  `ui.readForm` and merged into `data`; after the last step, "Is this right?" shows `summary(data)` (one sentence, e.g.
  "Maya Okafor, Unit 1A at Alder Court, $1,325 a month from March 1") and the `doneLabel` button calls `onDone(data)`
  (return `false` to stay open). Returns the sheet handle (`handle.steps.go(i)`). Example in `#kit` → "Step-by-step guide".
- `copy(text, what)` (toast or selectable fallback sheet), `showText({title, text, note, filename})`.
- `bind(el, handlers)` (§3.5). `isPhone()`. `closeAll()`. `hasModal()`. `topLayer()`.
- Focus: every layer traps Tab, closes on Esc, and restores focus to the opener.

### 8.3 Forms
`ui.field({name, id?, label, type, value, options, placeholder, hint, required, optional, span:2, attrs, rows, min, max, step, write})`
types: `text email tel number search money date select textarea checkbox seg choice`.
- `choice`: large tappable radio cards (`.choices > label.choice`), options `[{value, label, sub?, icon?}]` or strings,
  `cols: 2|3`. Ids `<id>-0`, `<id>-1`… Prefer it over `select` for up to ~6 options. Read back like any field.
- `money` with `big:true` → larger input (`.money-input-lg`).
- v2 form layout: `<div class="form-col">` (one column), labels as questions, an example in the hint, optional fields inside
  `ui.moreDetails(...)`, at most ~5 visible questions.
- `money`: value in cents; input shows `1,450.50`; reformatted on blur; read as cents.
- `seg`: segmented single choice (hidden input + buttons; dispatches `change`). Options `[{value,label,icon?}]` or strings.
- `ui.readForm(root, {validate(values) → {name: msg}})` → `{values, errors, ok}` (money → cents|null, date → string|null, checkbox → bool, number → Number|null).
  An empty `required` field gets a message built from its label: text → "Enter a name", money → "Enter the monthly rent",
  date → "Choose a lease start date" / "Choose the date received", select/seg → "Choose a …". When the label doesn't read
  as a noun, pass `ui.field({…, requiredMsg: 'Describe what happened'})` (stored as `data-required-msg`). `ui.requiredMessage(el, root)`.
- `ui.showErrors(root, errors, {focus=true})`; `ui.form(root, opts)` = read + show → values or null.
- `ui.setValue(root, name, value)`.

## 9. CSS component library

### 9.0 Tokens (colours: only these)
`--paper --surface --sunk --ink --ink-2 --ink-3 --line --line-2 --accent --accent-ink --accent-soft --ok --ok-soft
--warn --warn-soft --bad --bad-soft` (spec) plus derived: `--hover --accent-line --accent-hover --ok-line --warn-line
--bad-line --bad-ink --faint --scrim --toast-bg --toast-ink --toast-accent --toast-hover --shadow-float --shadow-modal --focus-ring`.
Type: `--f-display` (Newsreader) `--f-ui` (Plex Sans) `--f-mono` (Plex Mono); sizes `--t-12` (14) `--t-13` (15) `--t-15` (17) `--t-18` (20)
`--t-24` (27) `--t-34` (38) `--t-body` (16 / 17 phone) `--t-micro` (14), `--lh` 1.5 — all × `--text-scale`.
Space `--s1..--s7` (4 8 12 16 24 32 48, × scale). Radius `--r-ctl:8 --r-panel:12 --r-plate:3`. Sizes `--ctl-h` (44 → 48 phone)
`--ctl-h-sm` (40 → 48) `--ctl-h-lg` (52 → 56) `--ctl-h-xl` (64) `--row-h` (56 → 60 phone) `--icon` (18) `--gutter` `--rail-w` `--top-h` `--tab-h` `--sticky-top`.
`--text-scale` is 1 / 1.12 / 1.25 from `data-text` on the root element; a subtree with `class="text-scope" data-scale="lg"` recomputes every size
token at its own scale (the kit uses this). Colour tokens go in 00-tokens.css in all three places (light, dark media, `[data-theme="dark"]`).
Contrast (WCAG): light ink 16.2 / 17.5 / 15.0 on paper / surface / sunk; ink-2 8.8 / 9.5 / 8.2; ink-3 5.9 / 6.3 / 5.5; accent 7.8 / 8.4 / 7.2
(white on accent 8.4); ok 6.5, warn 6.2, bad 6.5 on paper (≥5.8 on their soft tints). Dark ink 15.7 / 14.6 / 16.2; ink-2 9.5 / 8.8 / 9.8;
ink-3 6.4 / 6.0 / 6.7; accent 8.0 / 7.5; ok 8.4, warn 9.1, bad 7.5. Focus ring: 3px accent outside a 2px surface gap.

### 9.1 Utilities
`.row` (flex, centred, gap 8) `.row-wrap .row-top .row-base .gap-1/3/4/5` · `.stack` (column, gap 8) `.stack-1/3/4/5/6` ·
`.spacer .grow` · `.mt-2/4/5/6 .mb-2/4` · `.muted` (ink-2) `.faint` (ink-3) `.tone-ok/warn/bad/accent` ·
`.num` (tabular, right) `.mono .micro .display .h-view .t-12/13/15/18/24/34 .strong .medium .nowrap .truncate .prewrap` ·
`.vh` (visually hidden) · `.hide-phone .show-phone` · `.panel` (surface + hairline + radius 10; don't nest) · `.rule` (top hairline).

### 9.2 Components (markup)
```html
<!-- buttons: kinds btn-primary | btn-soft | btn-ghost | btn-danger | btn-danger-soft | btn-keep | (default bordered); sizes btn-sm | btn-lg | btn-xl; btn-block;
     btn-icon is legacy — every button needs a visible word. Quiet worded action: <button class="btn-link">They paid part of it</button> (≥48px on phone) -->
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

<!-- data table: sticky header under the top bar, 44px rows. Inside anything that scrolls by itself use .tbl-scroll
     (always a scroll box) or .tbl-scroll-phone (scrolls sideways only under 760px): the header then sticks to that box
     (--tbl-sticky-top: 0px; sheets and drawers set it too). Cells are position:relative so a .vh label in a scrolled
     table is clipped with it. No per-view `top:` overrides needed. -->
<div class="tbl-scroll-phone"><table class="tbl">…</table></div>
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
<div class="view-head"><p class="view-summary"><strong>26</strong> tenants · …</p><span class="spacer"></span>controls / one primary</div>
<!-- top-of-view toolbar: summary line left (figures in <strong>), controls right; at most one btn-primary per screen
     (the top-bar "+" is btn-soft so a view's own primary stands alone) -->
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
  snapshot after the write resolves. The publishing step must declare `capabilities: {db: {}, downloads: true, user: {}}`
  (`user` is used only to learn `can('data.write') === false` up front; the page works without it).
- `tools/cloud-sim.mjs` drives the cloud path against a fake db that follows the documented API; it is a simulation,
  not the platform.

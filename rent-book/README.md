# Rent Book

A tenant tracker for one independent landlord (about 27 rental units, maybe a partner): who owes what this month,
whose lease is ending, what needs fixing. Built first of all to be easy for a non-technical person of 50+: big text
(with a Normal · Large · Extra large control), words on every button, plain sentences instead of jargon, a "How do I…?"
help page, and Undo on everything. Record a payment in two taps, see each tenant's payment history, settle deposits,
export reports. Vanilla JS, no libraries, no build dependencies.

## Build and test

```sh
node build.mjs                    # src/ → dist/rent-book.html (the published page) + dist/preview.html (open locally)
node --test test/*.test.mjs       # pure ledger model, reports, sample data
node tools/smoke.mjs              # core interactions (Playwright, local mode)
node tools/smoke-today-rent.mjs   # Today + Rent
node tools/smoke-tenants.mjs      # Tenants list, drawer, tenant sheets
node tools/smoke-other.mjs        # Leases, Repairs, Reports, Settings
node tools/shots.mjs              # screenshots of every view → shots/ (--only/--size/--theme/--text xl; see the file header)
node tools/audit.mjs              # the v3 acceptance test (SPEC §10): every screen at 390×844, Normal + Extra large
```

**`tools/audit.mjs` is the acceptance test for the v3 design laws** (SPEC §10): page height per screen against its budget,
one filled button, no buttons on rows (except the one allowed soft button), five type sizes and two weights, nothing under
14px, red/amber/green only on status markers, radii 6/10/16, no overflow or truncation, no wrapped controls, the pay and edit
verbs, toasts never over a sheet, sheets never stacked, and the same "N tenants owe…" sentence everywhere. It builds first
(`--no-build` to skip), prints a table, names the offending element for each breach, and exits 1 on any. Use
`--only today,rent` (screen names are listed in the file header and in docs/CONTRACT.md), `--text xl`, `--size desktop`.

Smoke tests and screenshots read `dist/preview.html`, so build first. Playwright and Chromium must already be
installed; nothing else is needed. `dist/preview.html` opens straight from disk and runs in local mode (data kept
in this browser only).

## How it is published

`dist/rent-book.html` is a single page — markup, one `<style>`, one `<script>`, no `<html>/<head>/<body>` — published
as a claude.ai Artifact. Declare these capabilities when publishing:

| Capability | Used for |
|---|---|
| `db` | the shared data: `meta/settings`, `tenants/*`, `ledgers/*`, `tickets/*` (one snapshot listener per collection) |
| `downloads` | CSV exports, the JSON backup and the import template (`<a download>` is inert in the host) |
| `user` | only to learn up front that a viewer can't write, so editing controls show "View only" |

Without `db` (local preview, tests) the app runs in memory and persists to `localStorage`, and Settings (Who can see
this) says "Not syncing — saved on this device only".

## Where things are

- `docs/SPEC.md` — the product and visual spec. §8 (ease of use: eleven rules + the plain-language glossary) overrides
  everything before it.
- `docs/CONTRACT.md` — the internal API: store, model, actions, UI primitives, CSS components, re-render rules. Start with
  "What changed in v2 for view authors".
- `src/css/` — tokens, base, components, shell, then one file per view (concatenated in name order).
- `src/js/` — core modules (`RB.*`), `src/js/views/` — one file per view, `99-boot.js` last.
- `#kit` (not in the nav) renders every component for review.

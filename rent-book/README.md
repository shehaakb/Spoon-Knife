# Rent Book

A tenant tracker for one independent landlord (about 27 rental units, maybe a partner): who owes what this month,
whose lease is ending, what needs fixing. Record a payment in one click, see each tenant's ledger, settle deposits,
export reports. Vanilla JS, no libraries, no build dependencies.

## Build and test

```sh
node build.mjs                    # src/ → dist/rent-book.html (the published page) + dist/preview.html (open locally)
node --test test/*.test.mjs       # pure ledger model, reports, sample data
node tools/smoke.mjs              # core interactions (Playwright, local mode)
node tools/smoke-today-rent.mjs   # Today + Rent
node tools/smoke-tenants.mjs      # Tenants list, drawer, tenant sheets
node tools/smoke-other.mjs        # Leases, Upkeep, Reports, Setup
node tools/shots.mjs              # screenshots of every view → shots/ (see the file header for --only/--size/--theme)
```

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

Without `db` (local preview, tests) the app runs in memory and persists to `localStorage`, and the sidebar says
"Not syncing — saved on this device only".

## Where things are

- `docs/SPEC.md` — the product and visual spec (what each screen must do, tokens, type, interaction rules).
- `docs/CONTRACT.md` — the internal API: store, model, actions, UI primitives, CSS components, re-render rules.
- `src/css/` — tokens, base, components, shell, then one file per view (concatenated in name order).
- `src/js/` — core modules (`RB.*`), `src/js/views/` — one file per view, `99-boot.js` last.
- `#kit` (not in the nav) renders every component for review.

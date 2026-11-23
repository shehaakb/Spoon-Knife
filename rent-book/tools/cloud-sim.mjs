#!/usr/bin/env node
// Exercises the CLOUD store path against a simulated `claude.use('db')` that follows the documented API
// (frozen snapshots, update() rejects missing docs with invalid_argument, collection onSnapshot with docs/metadata).
// It is a simulation — the real platform db is not reachable locally. Usage: node tools/cloud-sim.mjs (after build)
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(ROOT, 'dist', 'preview.html')).href;

const FAKE = `(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const docs = new Map(); const subs = {}; const inflight = new Set();
  const sim = window.__sim = { writes: 0, overlaps: [], readOnly: false, docs, maxConcurrent: 0, cur: 0 };
  const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => { const o = Object.assign({}, a); for (const k of Object.keys(b)) o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k]; return o; };
  const snapOf = col => { const list = [...docs.entries()].filter(([p]) => p.split('/')[0] === col).sort(([a], [b]) => a < b ? -1 : 1)
    .map(([p, d]) => ({ id: p.split('/')[1], exists: true, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } }));
    return { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
  const notify = col => (subs[col] || []).forEach(fn => setTimeout(() => fn(snapOf(col)), 5));
  const write = async (path, fn) => {
    if (inflight.has(path)) sim.overlaps.push(path);
    inflight.add(path); sim.cur++; sim.maxConcurrent = Math.max(sim.maxConcurrent, sim.cur);
    try { await sleep(20 + Math.random() * 40); if (sim.readOnly) throw { code: 'invalid_argument', message: 'below minimum' }; fn(); sim.writes++; notify(path.split('/')[0]); }
    finally { inflight.delete(path); sim.cur--; }
  };
  const db = {
    collection(col) { return { onSnapshot(next, err) { (subs[col] = subs[col] || []).push(next); setTimeout(() => next(snapOf(col)), 200); return () => {}; } }; },
    doc(path) { return {
      set: data => write(path, () => docs.set(path, freeze(JSON.parse(JSON.stringify(data))))),
      update: data => write(path, () => { if (!docs.has(path)) throw { code: 'invalid_argument', message: 'update on missing doc' }; docs.set(path, freeze(merge(docs.get(path), JSON.parse(JSON.stringify(data))))); }),
      delete: () => write(path, () => docs.delete(path)),
    }; },
  };
  window.claude = { use: async name => { await sleep(150); return name === 'db' ? db : null; } };
})();`;

const results = [];
const check = (name, ok, extra) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!ok) process.exitCode = 1; };
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
await ctx.addInitScript(FAKE);
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.goto(url + '#today');
check('renders loading skeleton before db resolves', await page.locator('.skeleton').count() === 1);
await page.waitForFunction(() => RB.store.state.ready);
check('cloud mode', await page.evaluate(() => RB.store.state.mode === 'cloud'));
check('no writes on load', await page.evaluate(() => __sim.writes === 0));
await page.click('[data-cmd="sample:load"]');
await page.waitForFunction(() => RB.store.state.saving === 0 && __sim.writes >= 61, null, { timeout: 20000 });
const s = await page.evaluate(() => ({ writes: __sim.writes, overlaps: __sim.overlaps, max: __sim.maxConcurrent, docs: __sim.docs.size }));
check('sample import written to db', s.docs === 61, JSON.stringify(s));
check('never two writes in flight to one document', s.overlaps.length === 0);
check('global write concurrency bounded (≤4)', s.max <= 4, 'max ' + s.max);
await page.waitForTimeout(300);
check('state from snapshots matches', await page.evaluate(() => RB.store.tenantsList().length === 27));

// new tenant → first entry uses set(), second uses update(), quickly back-to-back
await page.evaluate(() => RB.store.addTenant({ id: 'newT1', name: 'New Person', unit: '9Z', property: 'Q', rent: [{ from: '2026-01-01', amount: 100000 }], lease: { start: '2026-01-01', moveIn: '2026-01-01' } }));
await page.evaluate(() => { RB.store.addEntry('newT1', { id: 'e1', type: 'payment', date: RB.store.today(), amount: 1000 }); RB.store.addEntry('newT1', { id: 'e2', type: 'payment', date: RB.store.today(), amount: 2000 }); });
await page.waitForFunction(() => RB.store.state.saving === 0);
await page.waitForTimeout(200);
const lg = await page.evaluate(() => Object.keys(__sim.docs.get('ledgers/newT1').entries).sort().join(','));
check('ledger doc created by set then merged by update', lg === 'e1,e2', lg);
check('optimistic state settled to server state', await page.evaluate(() => Object.keys(RB.store.entries('newT1')).length === 2));

// quick pay + undo round trip
const tid = await page.evaluate(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).balance > 0 && !RB.store.ledger(t.id).delinquent).id);
const bal = await page.evaluate(id => RB.store.ledger(id).balance, tid);
await page.evaluate(id => { RB.actions.recordPayment(id, { quick: true }); }, tid);
check('optimistic: balance zero immediately', await page.evaluate(id => RB.store.ledger(id).balance === 0, tid));
await page.click('.toast-action');
await page.waitForFunction(() => RB.store.state.saving === 0);
await page.waitForTimeout(200);
check('undo persisted (void+undone in db)', await page.evaluate(id => Object.values(__sim.docs.get('ledgers/' + id).entries).some(e => e.undone), tid));
check('balance restored', await page.evaluate(a => RB.store.ledger(a.id).balance === a.b, { id: tid, b: bal }));

// write rejected invalid_argument → view only, rollback
await page.evaluate(() => { __sim.readOnly = true; });
const before = await page.evaluate(id => RB.store.ledger(id).balance, tid);
await page.evaluate(id => { RB.store.addEntry(id, { type: 'payment', date: RB.store.today(), amount: 5000 }).catch(() => {}); }, tid);
await page.waitForTimeout(400);
check('rejected write rolled back', await page.evaluate(a => RB.store.ledger(a.id).balance === a.b, { id: tid, b: before }));
check('readOnly set after invalid_argument', await page.evaluate(() => RB.store.state.readOnly === true));
check('"View only" shown', (await page.textContent('#rb-sync')).includes('View only'));

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

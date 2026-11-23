#!/usr/bin/env node
// Interaction smoke test for Leases, Upkeep, Reports and Setup against dist/preview.html (local mode).
// Usage: node tools/smoke-other.mjs   (run build.mjs first)
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(ROOT, 'dist', 'preview.html')).href;

const errors = [];
const results = [];
const check = (name, ok, extra) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!ok) process.exitCode = 1; };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (threw)', false, String(e && e.message || e).split('\n')[0]); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
const go = async h => { await page.evaluate(x => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); location.hash = x; }, h); await page.waitForTimeout(120); };
const toastUndo = async () => { await page.locator('.toast .toast-action').last().click(); await page.waitForTimeout(80); };
const settle = () => page.waitForTimeout(120);

await page.goto(url + '#today');
await page.waitForFunction(() => RB.store.state.ready);
await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
await page.waitForFunction(() => RB.store.tenantsList().length === 27);
const today = await page.evaluate(() => RB.store.today());

// ---------------------------------------------------------------- Leases: scale
await step('leases timeline', async () => {
  await go('leases');
  if (await page.locator('#lz-mode-timeline[aria-pressed="false"]').count()) await page.click('#lz-mode-timeline');
  const geo = await page.evaluate(() => {
    const D = RB.date, today = RB.store.today();
    const w0 = D.monthStart(D.monthKey(today)), w1 = D.monthStart(D.addMonthKey(D.monthKey(today), 12)), span = D.diffDays(w0, w1);
    const out = [];
    document.querySelectorAll('.lz-row').forEach(row => {
      const bar = row.querySelector('.lz-bar'), track = row.querySelector('.lz-track');
      const tr = track.getBoundingClientRect(), br = bar.getBoundingClientRect();
      const s = bar.dataset.start, e = bar.dataset.end;
      const expL = D.diffDays(w0, s) / span * tr.width;
      const expR = e && e < w1 ? D.diffDays(w0, D.addDays(e, 1)) / span * tr.width : tr.width;
      out.push({ id: row.dataset.tenant, dl: Math.abs(br.left - tr.left - expL), dr: Math.abs(br.right - tr.left - expR) });
    });
    const t = document.querySelector('.lz-today'), g = document.querySelector('.lz-grid').getBoundingClientRect();
    const todayErr = Math.abs(t.getBoundingClientRect().left + 1 - g.left - D.diffDays(w0, today) / span * g.width);
    return { out, todayErr, rows: out.length, expected: RB.store.tenantsList({ includePast: false }).length };
  });
  check('timeline has one row per current tenant', geo.rows === geo.expected, geo.rows + ' vs ' + geo.expected);
  const worst = Math.max(...geo.out.map(o => Math.max(o.dl, o.dr)));
  check('bars drawn to scale (≤1.5px off)', worst <= 1.5, 'worst ' + worst.toFixed(2) + 'px');
  check('today rule at today', geo.todayErr <= 1.5, geo.todayErr.toFixed(2) + 'px');
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('.lz-row .lz-bar')).map(b => b.dataset.end || '9999'));
  check('rows sorted by end date', order.every((e, i) => i === 0 || order[i - 1] <= e));
  check('summary line', /lease.*end.*in the next \d+ days · \d+ month-to-month · \d+ moving out/.test(await page.textContent('.lz-summary')));
});

// ---------------------------------------------------------------- Leases: renew
await step('renew lease', async () => {
  const id = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Rosa Delgado').id);
  const before = await page.evaluate(id => RB.store.tenant(id), id);
  await page.click(`.lz-row[data-tenant="${id}"] [data-act="renew"]`);
  await page.waitForSelector('#lz-renew-end');
  const defEnd = await page.inputValue('#lz-renew-end');
  check('renew defaults to +12 months', defEnd === await page.evaluate(e => RB.date.addMonths(e, 12), before.lease.end), defEnd);
  await page.fill('#lz-renew-rent', '1,800');
  await page.waitForTimeout(50);
  check('renew summary names the change', (await page.textContent('#lz-renew-sum')).includes('$1,800'));
  check('renew button says what happens', (await page.textContent('[data-action="save"]')).trim() === 'Renew at $1,800');
  await page.click('[data-action="save"]');
  await settle();
  const after = await page.evaluate(id => RB.store.tenant(id), id);
  const from = await page.evaluate(e => RB.date.addDays(e, 1), before.lease.end);
  check('lease end moved', after.lease.end === defEnd);
  check('rent schedule appended', after.rent.length === before.rent.length + 1 && after.rent[after.rent.length - 1].amount === 180000 && after.rent[after.rent.length - 1].from === from);
  const bar = await page.evaluate(id => { const b = document.querySelector(`.lz-row[data-tenant="${id}"] .lz-bar`); return { end: b.dataset.end, off: b.classList.contains('lz-bar-off') }; }, id);
  check('bar moved to the new end (runs off the window)', bar.end === defEnd && bar.off);
  check('rent in force unchanged until the new term', await page.evaluate(id => RB.model.rentOn(RB.store.tenant(id), RB.store.today()), id) === 172500);
  await toastUndo();
  const undone = await page.evaluate(id => RB.store.tenant(id), id);
  check('undo renew restores end + schedule', undone.lease.end === before.lease.end && undone.rent.length === before.rent.length);
});

// ---------------------------------------------------------------- Leases: month-to-month + undo
await step('month-to-month', async () => {
  const id = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Theo Lindqvist').id);
  const end = await page.evaluate(id => RB.store.tenant(id).lease.end, id);
  await page.click(`.lz-row[data-tenant="${id}"] [data-act="decide"]`);
  await page.click('.menu-item:has-text("Go month-to-month")');
  await settle();
  check('went month-to-month', await page.evaluate(id => RB.store.tenant(id).lease.end === null, id));
  check('bar is open-ended dashed', await page.evaluate(id => document.querySelector(`.lz-row[data-tenant="${id}"] .lz-bar`).classList.contains('lz-bar-mtm'), id));
  await toastUndo();
  check('undo restores end date', await page.evaluate(([id, end]) => RB.store.tenant(id).lease.end === end, [id, end]));
  // list mode groups
  await page.click('#lz-mode-list');
  await settle();
  const groups = await page.$$eval('.lz-group .sec-title', els => els.map(e => e.textContent));
  check('list mode groups', groups.includes('Ending in 30 days') && groups.includes('Month-to-month') && groups.includes('Moving out'), groups.join(', '));
  await page.click('#lz-mode-timeline');
  // renewLease hook is wired for Today / palette
  check('renewLease hook replaced', await page.evaluate(() => !/openTenant/.test(String(RB.actions.renewLease))));
});

// ---------------------------------------------------------------- Upkeep: add → schedule → done (+ charge) → undo
let tkId = null, tkTenant = null;
await step('upkeep flow', async () => {
  await go('upkeep');
  tkTenant = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Maya Okafor').id);
  await page.evaluate(() => { RB.actions.addTicket(); });
  await page.waitForSelector('#uk-title');
  await page.fill('#uk-title', 'Broken blind');
  await page.selectOption('#uk-tenant', tkTenant);
  check('tenant picker fills property + unit', (await page.inputValue('#uk-property')) === 'Alder Court' && (await page.inputValue('#uk-unit')) === '1A');
  await page.click('[data-seg-for="uk-paidby"] [data-value="tenant"]');
  await page.click('[data-action="save"]');
  await settle();
  tkId = await page.evaluate(() => RB.store.ticketsList().find(k => k.title === 'Broken blind').id);
  check('ticket added as open', await page.evaluate(id => RB.store.ticket(id).status === 'open', tkId));
  check('card in Open column', await page.locator(`section[aria-labelledby="uk-col-open"] [data-ticket="${tkId}"]`).count() === 1);
  // schedule inline
  await page.click(`[data-ticket="${tkId}"] [data-act="sched"]`);
  const d = await page.evaluate(() => RB.date.addDays(RB.store.today(), 3));
  await page.fill('#uk-in-date', d);
  await page.press('#uk-in-date', 'Enter');
  await settle();
  check('scheduled with date', await page.evaluate(([id, d]) => { const k = RB.store.ticket(id); return k.status === 'scheduled' && k.scheduled === d; }, [tkId, d]));
  check('card moved to Scheduled', await page.locator(`section[aria-labelledby="uk-col-scheduled"] [data-ticket="${tkId}"]`).count() === 1);
  // done with cost + tenant charge
  const bal0 = await page.evaluate(id => RB.store.ledger(id).balance, tkTenant);
  await page.click(`[data-ticket="${tkId}"] [data-act="done"]`);
  await page.fill('#uk-in-cost', '120');
  check('offers tenant charge', (await page.textContent('#uk-in-charge-label')).includes('Add $120 charge to Maya Okafor'));
  await page.press('#uk-in-cost', 'Enter');
  await settle();
  const k = await page.evaluate(id => RB.store.ticket(id), tkId);
  check('marked done with cost', k.status === 'done' && k.cost === 12000 && k.completed === today);
  const chg = await page.evaluate(([t, c]) => RB.store.entries(t)[c], [tkTenant, k.chargeId]);
  check('tenant-pays charge posted as damage', chg && chg.category === 'damage' && chg.amount === 12000 && chg.type === 'charge');
  check('balance went up by $120', await page.evaluate(id => RB.store.ledger(id).balance, tkTenant) === bal0 + 12000);
  await toastUndo();
  check('undo done → scheduled again', await page.evaluate(id => RB.store.ticket(id).status === 'scheduled', tkId));
  check('undo removed the charge', await page.evaluate(id => RB.store.ledger(id).balance, tkTenant) === bal0);
  // done via the sheet → charge checkbox
  await page.evaluate(id => { RB.actions.openTicket(id); }, tkId);
  await page.waitForSelector('#uk-title');
  await page.click('[data-seg-for="uk-status"] [data-value="done"]');
  await page.fill('#uk-cost', '99');
  await page.waitForTimeout(50);
  check('sheet offers charge checkbox', await page.locator('#uk-charge').isChecked());
  await page.click('[data-action="save"]');
  await settle();
  check('sheet: done + $99 charge', await page.evaluate(([id, t]) => { const k = RB.store.ticket(id); const e = k.chargeId && RB.store.entries(t)[k.chargeId]; return k.status === 'done' && e && e.amount === 9900; }, [tkId, tkTenant]));
  const count = await page.textContent('#uk-count');
  check('count line', /\d+ open.*oldest \d+ d/.test(count), count);
  // property filter
  await page.click('.uk-filter [data-prop="Fenwick Row"]');
  await settle();
  check('property filter', await page.evaluate(() => Array.from(document.querySelectorAll('.uk-card')).every(c => RB.store.ticket(c.dataset.ticket).property === 'Fenwick Row')));
  await page.click('.uk-filter [data-prop=""]');
  check('hooks replaced', await page.evaluate(() => !/emit/.test(String(RB.actions.addTicket)) && !/emit/.test(String(RB.actions.openTicket))));
});

// ---------------------------------------------------------------- Reports
await step('reports', async () => {
  await go('reports');
  const fmt = (c) => page.evaluate(c => RB.money.fmt(c), c);
  await page.click('#rp-tab-roll'); await settle();
  const rr = await page.evaluate(() => RB.store.rentRoll().totals);
  const roll = await page.evaluate(() => ['rent', 'deposit', 'balance'].map(k => document.querySelector(`#rp-roll [data-total="${k}"]`).textContent.trim()));
  check('rent roll totals match model', roll[0] === await fmt(rr.rent) && roll[1] === await fmt(rr.deposit) && roll[2] === await fmt(rr.balance), roll.join(' '));
  check('rent roll grouped with subtotals', await page.locator('#rp-roll .rp-subtotal').count() === 3);
  check('occupancy line', /\d+ of \d+ units occupied/.test(await page.textContent('#rp-meta')));
  // CSV fallback sheet
  await page.click('#rp-csv');
  await page.waitForSelector('#rb-showtext');
  check('CSV fallback sheet opens', (await page.inputValue('#rb-showtext')).startsWith('Property,Unit,Tenant'));
  await page.keyboard.press('Escape'); await settle();

  await page.click('#rp-tab-aging'); await settle();
  const ag = await page.evaluate(() => RB.store.aging());
  const agT = await page.evaluate(() => ['d0_30', 'd31_60', 'd61_90', 'd90', 'total'].map(k => document.querySelector(`#rp-aging [data-total="${k}"]`).textContent.trim()));
  const agE = []; for (const k of ['d0_30', 'd31_60', 'd61_90', 'd90', 'total']) agE.push(await fmt(ag.totals[k]));
  check('aging totals match model', agT.join() === agE.join(), agT.join(' '));
  check('aging rows = owing tenants', await page.locator('#rp-aging tbody tr').count() === ag.rows.length);
  check('aging counts tenants owing nothing', (await page.textContent('#rp-meta')).includes((await page.evaluate(n => RB.store.tenantsList().length - n, ag.rows.length)) + ' tenants owe nothing'));

  await page.click('#rp-tab-collection'); await settle();
  const col = await page.evaluate(() => RB.store.collectionByMonth(12));
  const sumC = col.reduce((s, r) => s + r.charged, 0), sumP = col.reduce((s, r) => s + r.collected, 0);
  check('collection totals match model', (await page.textContent('#rp-collection [data-total="charged"]')).trim() === await fmt(sumC) && (await page.textContent('#rp-collection [data-total="collected"]')).trim() === await fmt(sumP));
  const chart = await page.evaluate(() => {
    const plot = document.querySelector('.rp-chart-plot'); const max = +plot.dataset.axisMax; const H = plot.getBoundingClientRect().height;
    return Array.from(document.querySelectorAll('.rp-charged, .rp-collected')).map(b => Math.abs(b.getBoundingClientRect().height - (+b.dataset.v / max) * H));
  });
  check('chart bars to scale (≤1px)', chart.length === 24 && Math.max(...chart) <= 1, Math.max(...chart).toFixed(2));

  await page.click('#rp-tab-income'); await settle();
  const yr = +today.slice(0, 4);
  const inc = await page.evaluate(y => RB.store.incomeByYear(y).totals, yr);
  check('income total matches model', (await page.textContent('#rp-income [data-total="payments"]')).trim() === await fmt(inc.payments));
  await page.click('#rp-year-prev'); await settle();
  check('year stepper', (await page.textContent('#rp-year-label')).trim() === String(yr - 1));
  await page.click('#rp-year-next'); await settle();
  await page.click('#rp-copy');
  await page.waitForTimeout(150);
  check('copy gives feedback', await page.locator('.toast, #rb-showtext').count() >= 1);
  await page.evaluate(() => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); });
});

// ---------------------------------------------------------------- Setup: settings save + persist, drafts survive
await step('settings', async () => {
  await go('setup');
  await page.fill('#st-graceDays', '7');
  await page.press('#st-graceDays', 'Tab');
  await settle();
  check('grace days saved', await page.evaluate(() => RB.store.settings().graceDays === 7));
  check('"Saved" confirmation shows', await page.locator('#st-saved-graceDays.is-on').count() === 1);
  check('rule sentence updates', (await page.textContent('#st-rule-sentence')).includes('After the 8th, suggest a $50 late fee'));
  await page.fill('#st-graceDays', '99'); await page.press('#st-graceDays', 'Tab'); await settle();
  check('invalid value rejected with message', await page.evaluate(() => RB.store.settings().graceDays === 7) && (await page.textContent('[data-row="graceDays"] .field-error')).length > 0);
  await page.fill('#st-graceDays', '7'); await page.press('#st-graceDays', 'Tab'); await settle();
  await page.click('#st-lf-percent'); await settle();
  check('late fee rule switched to percent', await page.evaluate(() => { const l = RB.store.settings().lateFee; return l.type === 'percent' && l.amount === 5; }));
  await page.fill('#st-portfolioName', 'Harbour Lane Homes'); await page.press('#st-portfolioName', 'Tab'); await settle();
  // methods
  await page.fill('#st-method-new', 'PayPal'); await page.press('#st-method-new', 'Enter'); await settle();
  check('method added', await page.evaluate(() => RB.store.settings().methods.includes('PayPal')));
  // half-typed field survives a store change
  await page.focus('#st-leaseNoticeDays'); await page.fill('#st-leaseNoticeDays', '9');
  await page.evaluate(() => RB.store.addLog(RB.store.tenantsList()[0].id, { text: 'store change' }));
  await page.waitForTimeout(120);
  check('half-typed field survives store change', await page.inputValue('#st-leaseNoticeDays') === '9' && await page.evaluate(() => document.activeElement.id === 'st-leaseNoticeDays'));
  await page.fill('#st-leaseNoticeDays', '60'); await page.press('#st-leaseNoticeDays', 'Tab'); await settle();
  await page.reload();
  await page.waitForFunction(() => RB.store.state.ready);
  check('settings persist across reload', await page.evaluate(() => { const s = RB.store.settings(); return s.graceDays === 7 && s.lateFee.type === 'percent' && s.portfolioName === 'Harbour Lane Homes' && s.methods.includes('PayPal'); }));
});

// ---------------------------------------------------------------- Setup: import
await step('import', async () => {
  await go('setup');
  const paste = ['Tenant\tApt\tBuilding\tMonthly rent\tLease start\tLease end\tDeposit\tBalance owed',
    'Anna Berg\t4A\tElm House\t1200\t1/15/2026\t1/14/2027\t1200\t0',
    'Bo Chen\t4B\tElm House\t$1,350.00\t2026-02-01\t2027-01-31\t1350\t150',
    '\t4C\tElm House\t1100\tJan 15 2026\t\t\t',
    'Dara Ito\t4D\tElm House\t1,025\tMar 3 2026\t\t\t',
    'Eli Ford\t5A\tElm House\t1500\t2026-03-01\t\t\t-50'].join('\n');
  await page.fill('#st-import-text', paste);
  await page.waitForTimeout(350);
  check('auto-mapped columns', await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7].map(i => document.getElementById('st-map-' + i).value).join() === 'name,unit,property,rent,start,end,deposit,balance'));
  check('bad row flagged', (await page.textContent('#st-import-table')).includes('Missing name'));
  // pasted import survives a store change while the textarea has focus, and after it loses focus
  await page.evaluate(() => RB.store.addLog(RB.store.tenantsList()[0].id, { text: 'store change 2' }));
  await page.waitForTimeout(100);
  await page.focus('#st-keys');
  await page.waitForTimeout(100);
  check('pasted import survives store change', (await page.inputValue('#st-import-text')) === paste);
  check('button counts good rows', (await page.textContent('#st-import-go')).trim() === 'Import 4 tenants');
  if (await page.locator('#st-import-rmsample').count()) await page.uncheck('#st-import-rmsample');
  const n0 = await page.evaluate(() => RB.store.tenantsList().length);
  await page.click('#st-import-go');
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => { const l = RB.store.tenantsList(); const b = l.find(t => t.name === 'Bo Chen'); const e = l.find(t => t.name === 'Eli Ford'); return { n: l.length, b, e, lb: RB.store.ledger(b.id) }; });
  check('imported 4 tenants', res.n === n0 + 4);
  const first = today.slice(0, 8) + '01';
  check('trackFrom = first of month, opening from balance', res.b.trackFrom === first && res.b.opening.amount === 15000 && res.e.opening.amount === -5000);
  check('dates + money parsed', res.b.lease.start === '2026-02-01' && res.b.lease.end === '2027-01-31' && res.b.rent[0].amount === 135000 && res.b.deposit.amount === 135000);
  check('ledger starts cleanly (opening + this month)', res.lb.rows.filter(r => r.kind === 'rent').length === 1 && res.lb.balance === 15000 + 135000);
  check('success note shown', await page.locator('.st-done').count() === 1);
});

// ---------------------------------------------------------------- Backup → wipe → restore
await step('backup round trip', async () => {
  await go('setup');
  const snap = await page.evaluate(() => ({ n: RB.store.tenantsList().length, k: RB.store.ticketsList().length, bal: RB.store.tenantsList().map(t => RB.store.ledger(t.id).balance).join() }));
  await page.click('#st-backup');
  await page.waitForSelector('#rb-showtext');
  const json = await page.inputValue('#rb-showtext');
  check('backup is JSON of everything', JSON.parse(json).format === 'rent-book-backup');
  await page.keyboard.press('Escape'); await settle();
  await page.evaluate(() => RB.store._resetLocal());
  await page.waitForTimeout(100);
  check('wiped', await page.evaluate(() => RB.store.tenantsList().length === 0));
  await go('setup');
  await page.setInputFiles('#st-restore-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.waitForSelector('#st-restore-summary');
  check('restore shows summary', (await page.textContent('#st-restore-summary')).includes(snap.n + ' tenants'));
  await page.click('#st-restore-go');
  await page.waitForSelector('[data-action="confirm"]');
  check('confirm says it replaces everything', /replaced/.test(await page.textContent('.sheet-body')));
  await page.click('[data-action="confirm"]');
  await page.waitForTimeout(300);
  check('restore round trip', await page.evaluate(s => RB.store.tenantsList().length === s.n && RB.store.ticketsList().length === s.k && RB.store.tenantsList().map(t => RB.store.ledger(t.id).balance).join() === s.bal, snap));
  await page.setInputFiles('#st-restore-file', { name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.waitForSelector('.st-restore.is-bad');
  check('non-backup file refused', (await page.textContent('.st-restore.is-bad')).includes('isn’t a Rent Book backup'));
});

// ---------------------------------------------------------------- Hostile strings
await step('escaping', async () => {
  const evil = '<img src=x onerror="window.__x=1"><b>x</b>';
  await page.evaluate(e => {
    RB.store.addTenant({ id: 'evil1', name: e, unit: e, property: e, rent: [{ from: '2026-01-01', amount: 100000 }], lease: { start: '2026-01-01', moveIn: '2026-01-01', end: RB.date.addDays(RB.store.today(), 20) } });
    RB.store.addTicket({ id: 'evilk', tenantId: 'evil1', title: e, property: e, unit: e, vendor: e, detail: e, cost: 500 });
    RB.store.saveSettings({ methods: RB.store.settings().methods.concat([e]), portfolioName: e });
  }, evil);
  await page.waitForTimeout(100);
  for (const r of ['leases', 'upkeep', 'reports', 'setup']) await go(r);
  await go('leases'); await page.click('#lz-mode-list'); await settle(); await page.click('#lz-mode-timeline');
  await go('reports');
  for (const t of ['roll', 'aging', 'collection', 'income']) { await page.click('#rp-tab-' + t); await settle(); }
  await go('setup');
  await page.fill('#st-import-text', 'Name,Unit,Rent\n' + '"' + evil.replace(/"/g, '""') + '",1,abc');
  await page.waitForTimeout(350);
  await page.evaluate(() => { RB.actions.openTicket('evilk'); }); await settle();
  await page.evaluate(() => { RB.ui.closeAll(); RB.actions.renewLease('evil1'); }); await settle();
  check('hostile strings stay escaped', await page.evaluate(() => !window.__x && !document.querySelector('#rb-view img, #rb-view b, #rb-layer img, #rb-layer b')));
  await page.evaluate(() => RB.ui.closeAll());
  await page.fill('#st-import-text', '');
});

// ---------------------------------------------------------------- Phone width: no horizontal overflow
await step('phone overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bad = [];
  const probe = async name => { await page.waitForTimeout(150); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 0) bad.push(name + ' +' + o + 'px'); };
  await go('leases'); await probe('leases');
  await go('upkeep'); await probe('upkeep');
  for (const t of ['scheduled', 'done']) { await page.click(`.uk-tabs [data-tab="${t}"]`); await probe('upkeep ' + t); }
  await go('reports');
  for (const t of ['roll', 'aging', 'collection', 'income']) { await page.click('#rp-tab-' + t); await probe('reports ' + t); }
  await go('setup');
  await page.fill('#st-import-text', 'Name\tUnit\tProperty\tRent\tLease start\tLease end\tDeposit\tBalance\nA very long tenant name indeed\t4A\tA very long property name here\t1200\t1/15/2026\t1/14/2027\t1200\t0');
  await page.waitForTimeout(300);
  await probe('setup + import preview');
  check('no horizontal page overflow at 390px', !bad.length, bad.join(', '));
  await page.setViewportSize({ width: 1360, height: 900 });
});

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

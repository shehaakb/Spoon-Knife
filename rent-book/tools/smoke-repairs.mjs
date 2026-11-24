#!/usr/bin/env node
// Interaction smoke test for Repairs history (SPEC §9) against dist/preview.html (local mode).
// Usage: node tools/smoke-repairs.mjs   (run build.mjs first)
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
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (threw)', false, String(e && e.message || e).split('\n').slice(0, process.env.SMOKE_DEBUG ? 12 : 1).join(' | ')); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
const go = async h => { await page.evaluate(x => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); location.hash = x; }, h); await page.waitForTimeout(150); };
const settle = () => page.waitForTimeout(150);
const text = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const openFilter = async () => { if (await page.locator('#pp-filters').isHidden()) { await page.click('#pp-filter'); await settle(); } };
const sheets = () => page.evaluate(() => RB.ui.layers.filter(l => l.kind === 'sheet').length);
/** v3 laws on the current screen: no buttons/links inside rows, at most one filled button (exactly one when `one`). */
const lawCheck = async (name, one) => {
  const r = await page.evaluate(() => ({
    inRow: document.querySelectorAll('#rb-view .row button, #rb-view .row a, #rb-view .row .btn').length,
    filled: Array.from(document.querySelectorAll('#rb-view .btn-primary')).filter(b => b.offsetParent).length,
  }));
  check(name + ': no buttons inside rows', r.inRow === 0, r.inRow + ' found');
  check(name + ': ' + (one ? 'exactly one' : 'at most one') + ' filled button', one ? r.filled === 1 : r.filled <= 1, r.filled + ' filled');
};

await page.goto(url + '#today');
await page.waitForFunction(() => RB.store.state.ready);
await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
await page.waitForFunction(() => RB.store.tenantsList().length === 27);
// capture downloads and clipboard
await page.evaluate(() => {
  window.__dl = []; window.__clip = [];
  RB.actions.downloadFile = (name, t) => { window.__dl.push({ name, text: t }); return Promise.resolve(true); };
  RB.copyText = t => { window.__clip.push(t); return Promise.resolve(true); };
});

// ---------------------------------------------------------------- routes + tabs + landing
await step('repairs tabs and landing', async () => {
  await go('upkeep');
  check('#upkeep shows Repairs with a one-row switch "To do · History"', await page.locator('#rp-tab-todo').count() === 1 && (await text('#rp-tab-history')) === 'History'
    && await page.evaluate(() => { const a = document.getElementById('rp-tab-todo').getBoundingClientRect(), b = document.getElementById('rp-tab-history').getBoundingClientRect(); return Math.abs(a.top - b.top) < 1; }));
  await page.click('#rp-tab-todo'); await settle();
  await lawCheck('repairs to do', true);
  await page.click('#rp-tab-history'); await settle();
  await lawCheck('repairs history', true);
  const cards = await page.$$eval('.rp-props .row', a => a.map(x => x.getAttribute('href')));
  check('one row per property', cards.join(' ') === '#p-418-marlow-street #p-alder-court #p-fenwick-row', cards.join(' '));
  const alder = await text('.rp-props [data-slug="alder-court"]');
  const ay = await page.evaluate(() => { const p = RB.model.repairProperties(RB.store.state, RB.store.today()).find(x => x.slug === 'alder-court'); return { n: p.thisYear.count, t: RB.money.fmt(p.thisYear.total), y: RB.store.today().slice(0, 4) }; });
  check('row says units, repairs this year, the year’s cost as the amount, still to do', /12 units/.test(alder) && alder.includes(ay.n + ' repairs in ' + ay.y) && (await text('.rp-props [data-slug="alder-court"] .row-amt')) === ay.t && /2 still to do/.test(alder), alder);
  await page.click('.rp-props [data-slug="alder-court"]'); await settle();
  check('card opens #p-alder-court', await page.evaluate(() => location.hash) === '#p-alder-court' && (await text('#pp-title')) === 'Alder Court');
  check('nav highlights Repairs', await page.evaluate(() => !!document.querySelector('[aria-current="page"][href="#repairs"]')));
  await page.click('[data-act="back"]'); await settle();
  check('"All properties" goes back to History by property', await page.evaluate(() => location.hash) === '#repairs' && await page.locator('#rp-tab-history[aria-selected="true"]').count() === 1);
  await go('p-no-such-place');
  check('unknown slug → tidy not found', /couldn’t find that property/.test(await text('#rb-view')));
});

// ---------------------------------------------------------------- header + charts to scale
async function chartScale(phone) {
  return page.evaluate(ph => {
    const bars = Array.from(document.querySelectorAll('.pp-yr-bar'));
    const vals = bars.map(b => +b.dataset.total), max = Math.max(...vals);
    const size = b => (ph ? b.getBoundingClientRect().width : b.getBoundingClientRect().height);
    const big = Math.max(...bars.map(size));
    // full scale: the largest bar is the full plot (height) or the full row (width)
    const plot = ph ? bars[0].closest('.pp-yr-btn') : bars[0].parentElement;
    const full = ph ? plot.getBoundingClientRect().width - parseFloat(getComputedStyle(plot).paddingLeft) - parseFloat(getComputedStyle(plot).paddingRight)
      : plot.getBoundingClientRect().height - parseFloat(getComputedStyle(plot).borderBottomWidth) - plot.querySelector('.pp-yr-amt').getBoundingClientRect().height;
    const yErr = Math.max(...bars.map((b, i) => Math.abs(size(b) - vals[i] / max * big)));
    const cats = Array.from(document.querySelectorAll('.pp-cat-bar'));
    const cv = cats.map(b => +b.dataset.total), cmax = Math.max(...cv);
    const cErr = Math.max(...cats.map((b, i) => Math.abs(b.getBoundingClientRect().width - cv[i] / cmax * b.parentElement.getBoundingClientRect().width)));
    const amounts = Array.from(document.querySelectorAll('.pp-yr-amt')).map(a => a.textContent);
    const written = amounts.every((a, i) => a === RB.money.fmt(vals[i]));
    const catOrder = cv.every((v, i) => i === 0 || cv[i - 1] >= v);
    return { yErr, cErr, big, full, written, catOrder, n: bars.length };
  }, phone);
}
await step('property page: header and charts', async () => {
  await go('p-alder-court');
  const m = await page.evaluate(() => { const h = RB.model.repairHistory(RB.store.state, 'Alder Court'); return { n: h.all.length, total: h.all.reduce((s, k) => s + k.cost, 0), first: h.firstDate.slice(0, 4) }; });
  const sum = await text('#pp-sum');
  check('header sentence: count, since, spent', sum.startsWith(`${m.n} repairs since ${m.first} · ${(await page.evaluate(t => RB.money.fmt(t), m.total))} spent`), sum);
  const s = await chartScale(false);
  check('year bars drawn to scale (≤1px)', s.yErr <= 1, s.yErr.toFixed(2) + 'px over ' + s.n + ' bars');
  check('largest year bar fills the plot height', Math.abs(s.big - s.full) <= 1, s.big + ' vs ' + s.full);
  check('amount written on every year bar', s.written);
  check('category bars to scale (≤1px), largest first', s.cErr <= 1 && s.catOrder, s.cErr.toFixed(2) + 'px');
  check('plain captions under both charts', await page.locator('.pp-charts .pp-caption').count() === 2);
  check('header has Log a repair (outline) + Add a past repair (the one filled button)', await page.locator('#pp-log.btn-outline').count() === 1 && await page.locator('#pp-past.btn-primary').count() === 1);
  const yr = await page.evaluate(() => { const y = RB.store.today().slice(0, 4); const h = RB.model.repairHistory(RB.store.state, 'Alder Court'); return { y, t: RB.money.fmt(h.all.filter(k => k.year === y).reduce((s, k) => s + k.cost, 0)) }; });
  check('display element = this year’s cost in a sentence', (await text('#pp-yearcost')).startsWith(yr.t + ' spent on repairs in ' + yr.y) && await page.locator('#rb-view .t-display').count() === 1, await text('#pp-yearcost'));
  await lawCheck('property history', true);
});

// ---------------------------------------------------------------- keep an eye on + filters
await step('keep an eye on → filters → showing sentence', async () => {
  await go('p-alder-court');
  const watch = await text('.pp-watch');
  check('repeat problem in a sentence', /Unit 2B has had 3 plumbing repairs in the last 12 months \(\$[\d,]+\)/.test(watch), watch.slice(0, 120));
  check('warranty in a sentence', /“New dishwasher installed” in Unit 1C is under warranty until \w+ \d+, \d{4}/.test(watch));
  await page.click('.pp-watch [data-kind="repeat"]'); await settle();
  const showing = await text('#pp-showing');
  const n2b = await page.evaluate(() => RB.model.repairHistory(RB.store.state, 'Alder Court', { unit: '2B', category: 'plumbing' }).count);
  check('"See these repairs" filters to Unit 2B plumbing (its whole history)', n2b >= 3 && new RegExp('^Showing ' + n2b + ' plumbing repairs in Unit 2B — \\$[\\d,]+$').test(showing), showing);
  check('list shows exactly those', await page.locator('.pp-entries .row').count() === n2b && (await page.inputValue('#pp-unit')) === '2B' && (await page.inputValue('#pp-cat')) === 'plumbing');
  await page.click('#pp-clear'); await settle();
  check('"Show all repairs" clears', /^Showing all \d+ repairs/.test(await text('#pp-showing')));
  // this year open (first few + "Show all"), earlier years folded to one row each that expands in place
  const cur = await page.evaluate(() => RB.store.today().slice(0, 4));
  const fold = await page.evaluate(() => ({ heads: Array.from(document.querySelectorAll('.pp-yhead-year')).map(x => x.textContent), folded: Array.from(document.querySelectorAll('.pp-yrows [data-year]')).map(x => x.dataset.year) }));
  check('this year open, earlier years folded', fold.heads.join() === cur && fold.folded.length >= 2 && fold.folded.every(y => y < cur), JSON.stringify(fold));
  const order = fold.heads.concat(fold.folded);
  check('years newest first', order.join() === order.slice().sort().reverse().join(), order.join());
  const y1 = fold.folded[0];
  const n1 = await page.evaluate(y => RB.model.repairHistory(RB.store.state, 'Alder Court').years.find(x => x.year === y).count, y1);
  await page.click('.pp-yrows [data-year="' + y1 + '"]'); await settle();
  check('a folded year expands in place', await page.locator('#pp-y-' + y1).count() === 1 && await page.locator('#pp-y-' + y1 + ' ~ .pp-entries .row').count() === n1);
  await page.click('.pp-yfold[data-year="' + y1 + '"]'); await settle();
  check('…and folds away again', await page.locator('#pp-y-' + y1).count() === 0 && await page.locator('.pp-yrows [data-year="' + y1 + '"]').count() === 1);
  if (await page.locator('#pp-cur-more').count()) { await page.click('#pp-cur-more'); await settle(); }
  const curN = await page.evaluate(y => RB.model.repairHistory(RB.store.state, 'Alder Court').years.find(x => x.year === y).count, cur);
  check('"Show all" lists the whole year', await page.locator('#pp-y-' + cur + ' ~ .pp-entries .row').count() === curN);
  const yb = await page.$eval('.pp-yr-btn', b => b.dataset.year);
  await page.click('.pp-yr-btn'); await settle();
  check('tapping a year bar filters to that year', (await page.inputValue('#pp-year')) === yb && (await page.$$eval('.pp-yhead-year', a => a.map(x => x.textContent))).join() === yb);
  await page.click('#pp-clear'); await settle();
  check('filters sit behind one "Filter" control', await page.locator('#pp-filters').isHidden() && (await text('#pp-filter')) === 'Filter');
  await openFilter();
  await page.fill('#pp-q', 'boiler'); await page.waitForTimeout(450);
  const q = await text('#pp-showing');
  check('find box', /^Showing 3 repairs matching “boiler” — \$/.test(q) && (await page.$$eval('.pp-entries .row-title', a => a.length === 3 && a.every(x => /boiler/i.test(x.textContent)))), q);
  check('find box keeps focus while typing', await page.evaluate(() => document.activeElement && document.activeElement.id === 'pp-q'));
  await page.click('#pp-clear'); await settle();
  // by unit
  await openFilter();
  await page.click('#pp-mode-unit'); await settle();
  const units = await page.evaluate(() => {
    const t = RB.model.repairTotals(RB.model.repairHistory(RB.store.state, 'Alder Court').items);
    return { rows: document.querySelectorAll('.pp-units .row').length, expect: t.byUnit.length, first: document.querySelector('.pp-units .row-sub').textContent.replace(/\s+/g, ' '), top: t.byUnit[0] };
  });
  check('Show by unit: one row per unit, largest first', units.rows === units.expect && units.first.includes(units.top.count + ' repair'), units.first);
  await page.click('.pp-units [data-unit="2B"]'); await settle();
  check('unit row → that unit’s repairs by date', (await page.inputValue('#pp-unit')) === '2B' && await page.locator('.pp-entries .row').count() > 0);
  await page.click('#pp-clear'); await settle();
  await lawCheck('property history (filtered, by unit)', true);
});

// ---------------------------------------------------------------- Download for Excel + Copy
await step('download + copy the filtered list', async () => {
  await go('p-alder-court');
  await openFilter();
  await page.selectOption('#pp-cat', 'plumbing'); await settle();
  const n = await page.locator('.pp-entries .row').count();
  check('Download/Copy are text links at the end of the list', await page.evaluate(() => ['pp-csv', 'pp-copy'].every(id => { const b = document.getElementById(id); return b.classList.contains('btn-link') && !b.closest('.row'); })));
  await page.click('#pp-csv'); await settle();
  const dl = await page.evaluate(() => window.__dl[window.__dl.length - 1]);
  check('Download for Excel: header + one line per shown repair', dl && dl.name === 'alder-court-repairs.csv' && dl.text.startsWith('Date,Property,Unit,What was fixed,Kind of repair') && dl.text.trim().split('\r\n').length === n + 1, dl && dl.name);
  await page.click('#pp-copy'); await settle();
  const clip = await page.evaluate(() => window.__clip[window.__clip.length - 1]);
  check('Copy: title + showing sentence + lines', clip && clip.startsWith('Alder Court — repairs\nShowing ' + n + ' plumbing repairs') && (clip.match(/ · Plumbing · /g) || []).length === n);
  await page.click('#pp-clear'); await settle();
});

// ---------------------------------------------------------------- old docs, charging, delete/undo
await step('old repair without category reads as Other', async () => {
  await page.evaluate(() => RB.store.addTicket({ id: 'oldk1', property: 'Alder Court', unit: '3B', title: 'Legacy job', status: 'done', reported: '2025-01-05', completed: '2025-01-06', cost: 4200, paidBy: 'owner', priority: 'normal' }));
  await go('p-alder-court');
  await page.evaluate(() => RB.repairs.openRepair('oldk1')); await settle();
  const sub = await text('.sheet .sheet-sub');
  check('renders "Other"', / · Other( · |\.)/.test(sub), sub);
  await page.evaluate(() => RB.ui.closeAll()); await settle();
  check('counted under Other in the money chart', /Other/.test(await text('.pp-cats')));
});
await step('tenant-paid repair can be charged to the tenant from history', async () => {
  await go('p-alder-court');
  const k = await page.evaluate(() => RB.store.ticketsList().find(x => x.title === 'Kitchen sink clogged'));
  const bal0 = await page.evaluate(id => RB.store.ledger(id).balance, k.tenantId);
  await page.click(`.pp-entries [data-ticket="${k.id}"]`); await settle();
  const btn = page.locator('#rp-c-charge');
  check('tap → sheet with details and Change / Delete / "Charge $185 to …"', await btn.count() === 1 && /Charge \$185 to Hannah Becker/.test(await btn.textContent()) && await page.locator('#rp-c-change').count() === 1 && await page.locator('#rp-c-delete').count() === 1 && /Rooter|Unit 1C/.test(await text('.sheet .sheet-sub')));
  await btn.click(); await settle();
  check('no sheet left open after a choice', await sheets() === 0);
  check('charge posted to the tenant', await page.evaluate(([id, t]) => { const x = RB.store.ticket(id); const e = RB.store.entries(t)[x.chargeId]; return e && e.amount === 18500 && e.type === 'charge'; }, [k.id, k.tenantId]) && await page.evaluate(id => RB.store.ledger(id).balance, k.tenantId) === bal0 + 18500);
  await page.locator('.toast .toast-action').last().click(); await settle();
  check('Undo takes the charge back', await page.evaluate(id => RB.store.ledger(id).balance, k.tenantId) === bal0 && await page.evaluate(id => !RB.store.ticket(id).chargeId, k.id));
  await page.click(`.pp-entries [data-ticket="${k.id}"]`); await page.click('#rp-c-charge'); await settle();
  await page.click(`.pp-entries [data-ticket="${k.id}"]`); await settle();
  check('once charged: the choice is gone, the details say so', await btn.count() === 0 && /charged to them/.test(await text('.sheet .sheet-sub')));
  await page.click('.sheet [data-action="close"]'); await settle();
  await page.evaluate(id => { const x = RB.store.ticket(id); RB.store.undoEntry(x.tenantId, x.chargeId); RB.store.updateTicket(id, { chargeId: null }); }, k.id); await settle();
});
await step('delete and undo from the history page', async () => {
  await go('p-alder-court');
  await page.click('.pp-yrows [data-year="2025"]'); await settle();
  const before = await page.locator('#pp-y-2025 ~ .pp-entries .row').count();
  await page.click('.pp-entries [data-ticket="oldk1"]');
  await page.waitForSelector('#rp-c-delete');
  await page.click('#rp-c-delete'); await settle();
  check('deleted: gone from the list', await page.locator('[data-ticket="oldk1"]').count() === 0 && await page.locator('#pp-y-2025 ~ .pp-entries .row').count() === before - 1);
  await page.locator('.toast .toast-action').last().click(); await settle();
  check('Undo puts it back', await page.locator('[data-ticket="oldk1"]').count() === 1 && await page.evaluate(() => !!RB.store.ticket('oldk1')));
  // Change from history: the form opens filled in; change the kind
  await page.click('.pp-entries [data-ticket="oldk1"]');
  await page.waitForSelector('#rp-c-change');
  await page.click('#rp-c-change');
  await page.waitForSelector('#uk-title');
  check('Change opens the form filled in, one sheet at a time', (await page.inputValue('#uk-title')) === 'Legacy job' && (await page.inputValue('#uk-category')) === 'other' && await sheets() === 1);
  check('the place is shown once, not asked again', /For Unit 3B at Alder Court — Change/.test(await text('#uk-for')) && await page.locator('#uk-place').isHidden());
  await page.selectOption('#uk-category', 'electrical');
  await page.click('[data-action="save"]'); await settle();
  check('category changed with one tap', await page.evaluate(() => RB.store.ticket('oldk1').category === 'electrical'));
});

// ---------------------------------------------------------------- Add a past repair (fast form)
await step('add past repairs quickly', async () => {
  await go('p-alder-court');
  const n0 = await page.evaluate(() => RB.store.ticketsList().length);
  await page.click('#pp-past');
  await page.waitForSelector('#pr-title');
  check('four fields visible, the rest tucked away', await page.locator('.sheet .rp-form > .field:visible').count() === 4 && !(await page.$eval('#pr-more', d => d.open)));
  check('date field writes the date out', await page.locator('#pr-date-words').count() === 1);
  await page.fill('#pr-title', 'Boiler service');
  check('category guessed while typing', (await page.inputValue('#pr-category')) === 'heating' && /Filed under Heating & cooling/.test(await text('#pr-title-hint')));
  await page.fill('#pr-date', '2023-10-12');
  await page.selectOption('#pr-unit', '*building');
  await page.fill('#pr-cost', '240');
  await page.press('#pr-cost', 'Enter'); await settle();
  const k1 = await page.evaluate(() => RB.store.ticketsList().find(k => k.title === 'Boiler service' && k.completed === '2023-10-12'));
  check('saved as a done repair for the whole building', k1 && k1.status === 'done' && k1.scope === 'building' && k1.unit === '' && k1.cost === 24000 && k1.category === 'heating' && k1.property === 'Alder Court');
  check('form stays open: "Saved. Add another?"', await page.locator('#pr-title').count() === 1 && /Saved\..*Add another\?/.test(await text('#pr-saved')));
  check('keeps the date, clears the rest', (await page.inputValue('#pr-date')) === '2023-10-12' && (await page.inputValue('#pr-title')) === '' && (await page.inputValue('#pr-cost')) === '' && (await page.inputValue('#pr-unit')) === '');
  check('title focused for the next one', await page.evaluate(() => document.activeElement.id === 'pr-title'));
  // second one, with details
  await page.fill('#pr-title', 'Ants in the kitchen');
  await page.selectOption('#pr-unit', '2B');
  await page.click('#pr-more summary');
  await page.fill('#pr-vendor', 'Brightside Pest Control');
  await page.click('label[for="pr-paidby-1"]');
  await page.click('[data-action="save"]'); await settle();
  const k2 = await page.evaluate(() => RB.store.ticketsList().find(k => k.title === 'Ants in the kitchen' && k.completed === '2023-10-12'));
  check('second saved: pest, 2B, vendor, tenant paid', k2 && k2.category === 'pest' && k2.unit === '2B' && k2.vendor === 'Brightside Pest Control' && k2.paidBy === 'tenant');
  check('says how many so far', /2 saved so far/.test(await text('#pr-saved')));
  await page.click('#pr-undo'); await settle();
  check('Undo in the form takes the last one back', await page.evaluate(id => !RB.store.ticket(id), k2.id) && /Took back/.test(await text('#pr-saved')));
  check('validation speaks plainly', await (async () => { await page.click('[data-action="save"]'); await settle(); return /Say what was fixed/.test(await text('.sheet [data-field="title"] .field-error')); })());
  await page.click('.sheet-foot [data-close]'); await settle();
  check('one net repair added', await page.evaluate(() => RB.store.ticketsList().length) === n0 + 1);
  check('history shows it under 2023', await page.locator('.pp-yrows [data-year="2023"], #pp-y-2023').count() === 1);
});

// ---------------------------------------------------------------- Log a repair: category chooser, Whole building
await step('log a repair from the property page', async () => {
  await go('p-alder-court');
  await page.click('#pp-log'); await page.waitForSelector('#uk-title');
  check('property is fixed, not asked', await page.locator('#uk-property').count() === 0);
  await page.fill('#uk-title', 'Leaking tap');
  check('suggested Plumbing as you type', (await page.inputValue('#uk-category')) === 'plumbing' && /Guessed/.test(await text('#uk-category-hint')));
  await page.selectOption('#uk-category', 'appliance');
  await page.fill('#uk-title', 'Leaking tap in the kitchen');
  check('choosing a kind wins over the guess', (await page.inputValue('#uk-category')) === 'appliance');
  check('form: what, kind (select), one "This is urgent" checkbox, the rest under "Add more details"', await page.locator('select#uk-category').count() === 1 && await page.locator('#uk-urgent[type="checkbox"]').count() === 1 && !(await page.$eval('#uk-more', d => d.open)) && await page.locator('.sheet .btn-primary').count() === 1);
  await page.selectOption('#uk-unit', '3C');
  await page.click('[data-action="save"]'); await settle();
  check('logged as to do at Alder Court 3C', await page.evaluate(() => { const k = RB.store.ticketsList().find(x => x.title === 'Leaking tap in the kitchen'); return k && k.status === 'open' && k.unit === '3C' && k.property === 'Alder Court' && k.category === 'appliance'; }));
  check('header counts it as still to do', /3 repairs still to do/.test(await text('.pp-sub')));
});

// ---------------------------------------------------------------- empty property + tenant unit section
await step('empty property teaches', async () => {
  await page.evaluate(() => RB.store.addTenant({ id: 'gable1', name: 'Gwen Park', property: 'Gable House', unit: '1', rent: [{ from: '2026-01-01', amount: 100000 }], lease: { start: '2026-01-01', moveIn: '2026-01-01', end: null } }));
  await go('p-gable-house');
  const t = await text('#rb-view');
  check('“No repairs written down for Gable House yet” + why', /No repairs written down for Gable House yet/.test(t) && /worth doing/.test(t));
  check('both add buttons', await page.locator('.pp-empty [data-act="log"]').count() === 1 && await page.locator('.pp-empty [data-act="past"]').count() === 1);
});
await step('RB.repairs.unitSection for the tenant page', async () => {
  const id = await page.evaluate(() => RB.store.tenantsList().find(t => t.unit === '2B').id);
  await go('t-' + id); await settle();
  await page.evaluate(id => { const d = document.createElement('div'); d.id = 'rp-test-host'; d.innerHTML = String(RB.repairs.unitSection(RB.store.tenant(id))); (document.querySelector('.drawer-body') || document.getElementById('rb-view')).appendChild(d); }, id);
  const s = await text('#rp-test-host');
  check('one heading, last 3 repairs as rows, one text link', await page.locator('#rp-test-host h3').count() === 1 && await page.locator('#rp-test-host .rows .row').count() === 3 && /See all \d+ repairs for Unit 2B/.test(s), s.slice(0, 160));
  check('no buttons or cards: rows + at most one text link', await page.locator('#rp-test-host .row button, #rp-test-host .row a, #rp-test-host .btn').count() === 0 && await page.locator('#rp-test-host .btn-link').count() === 1);
  await page.click('#rp-test-host .rows .row'); await settle();
  check('a unit row opens "What would you like to do?"', await page.locator('#rp-c-change').count() === 1);
  await page.evaluate(() => RB.ui.closeAll()); await settle();
  await page.click('#rp-test-host [data-rp-history]'); await settle();
  check('opens the property history filtered to that unit', await page.evaluate(() => location.hash) === '#p-alder-court' && /in Unit 2B/.test(await text('#pp-showing')) && (await page.inputValue('#pp-unit')) === '2B');
  check('hooks exposed', await page.evaluate(() => typeof RB.actions.openProperty === 'function' && typeof RB.actions.addPastRepair === 'function' && typeof RB.repairs.unitSection === 'function'));
});

// ---------------------------------------------------------------- escaping
await step('hostile strings stay escaped', async () => {
  const evil = '<img src=x onerror="window.__x=1"><b>x</b>';
  await page.evaluate(e => RB.store.addTicket({ id: 'evilr', property: e, unit: e, title: e, vendor: e, notes: e, status: 'done', completed: '2026-02-02', reported: '2026-02-01', cost: 100, category: 'nope', warrantyUntil: '2099-01-01' }), evil);
  await go('repairs'); await page.click('#rp-tab-history'); await settle();
  await page.click('#rp-tab-todo'); await settle();
  const slug = await page.evaluate(() => RB.model.repairProperties(RB.store.state, RB.store.today()).find(p => p.name.startsWith('<img')).slug);
  await go('p-' + slug);
  await openFilter();
  await page.click('#pp-mode-unit'); await settle(); await page.click('#pp-mode-date'); await settle();
  await page.evaluate(() => { RB.actions.openTicket('evilr'); }); await settle();
  await page.click('#rp-c-change'); await settle();
  check('no injected markup', await page.evaluate(() => !window.__x && !document.querySelector('#rb-view img, #rb-view b, #rb-layer img, #rb-layer b')));
  await page.evaluate(() => { RB.ui.closeAll(); RB.store.deleteTicket('evilr'); });
});

// ---------------------------------------------------------------- phone: no sideways scroll, also at 125%; dark theme bars
await step('phone 390px, normal and extra-large text', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bad = [];
  const probe = async name => { await page.waitForTimeout(150); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 0) bad.push(name + ' +' + o + 'px'); };
  for (const size of ['normal', 'xl']) {
    await page.evaluate(s => RB.textSize ? RB.textSize.set(s) : document.documentElement.setAttribute('data-text', s), size);
    await go('repairs'); await page.click('#rp-tab-todo'); await probe(size + ' to do');
    if (await page.locator('#uk-done-more').count()) { await page.click('#uk-done-more'); await probe(size + ' to do, all done'); await page.click('#uk-done-more'); }
    await page.click('#rp-tab-history'); await probe(size + ' history');
    await go('p-alder-court'); await probe(size + ' property');
    await openFilter();
    await page.click('#pp-mode-unit'); await probe(size + ' by unit'); await page.click('#pp-mode-date');
    const s = await chartScale(true);
    check(size + ': phone year bars to scale (widths ≤1px)', s.yErr <= 1 && s.cErr <= 1, s.yErr.toFixed(2) + ' / ' + s.cErr.toFixed(2));
    const tall = await page.$$eval('#rb-view button:not(.linkbtn), #rb-view a.row, #rb-view select, #rb-view input', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 47.5).map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)));
    check(size + ': tappable things ≥48px on phone', !tall.length, tall.slice(0, 5).join(', '));
    await page.click('#pp-past'); await page.waitForSelector('#pr-title'); await page.click('#pr-more summary');
    const sheetOver = await page.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth - s.clientWidth; });
    if (sheetOver > 0) bad.push(size + ' past-repair sheet +' + sheetOver + 'px');
    await page.evaluate(() => RB.ui.closeAll());
  }
  await page.evaluate(() => RB.textSize ? RB.textSize.set('normal') : document.documentElement.removeAttribute('data-text'));
  check('no horizontal scroll at 390px (normal + extra large)', !bad.length, bad.join(', '));
  await page.setViewportSize({ width: 1360, height: 900 });
});
await step('dark theme: bars stand out from their track and the page', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await go('p-alder-court');
  const c = await page.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.pp-cat-bar')).backgroundColor, track: getComputedStyle(document.querySelector('.pp-cat-track')).backgroundColor, page: getComputedStyle(document.body).backgroundColor, ybar: getComputedStyle(document.querySelector('.pp-yr-bar')).backgroundColor }));
  check('dark: bar colour differs from track and page', c.bar !== c.track && c.bar !== c.page && c.ybar !== c.page, JSON.stringify(c));
  await page.emulateMedia({ colorScheme: 'light' });
});

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

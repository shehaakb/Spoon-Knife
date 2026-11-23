#!/usr/bin/env node
// Interaction tests for the Today and Rent views against dist/preview.html (local mode).
// Usage: node build.mjs && node tools/smoke-today-rent.mjs
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
const tick = (p, ms = 80) => p.waitForTimeout(ms);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.goto(url + '#today');
await page.waitForFunction(() => RB.store.state.ready);
await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
await page.waitForFunction(() => RB.store.tenantsList().length === 27);

// helpers evaluated in the page
const month = (id, k) => page.evaluate(([id, k]) => { const lg = RB.store.ledger(id); const m = lg.months[k || lg.current.period]; return m ? { open: m.open, paid: m.paid, status: m.status, balance: lg.balance } : null; }, [id, k]);
const thisMonth = await page.evaluate(() => RB.store.today().slice(0, 7));
const unpaidIds = () => page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.scheduled && m.open > 0; }).map(t => t.id), thisMonth);
const closeToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

// ================================================================= Rent
await page.evaluate(() => { location.hash = 'rent'; });
await tick(page, 150);
const rowCount = () => page.locator('.rent-tbl tbody tr.rent-row').count();
const expectAll = await page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.scheduled; }).length, thisMonth);
check('rent: one row per tenant charged this month', await rowCount() === expectAll, `${await rowCount()} vs ${expectAll}`);
const unpaid0 = await unpaidIds();
check('rent: unpaid rows come first', await page.evaluate(n => Array.from(document.querySelectorAll('.rent-tbl tbody tr.rent-row')).slice(0, n).every(tr => tr.querySelector('[data-act="pay"]')), unpaid0.length));

// filter chips with live counts
const chipCount = k => page.evaluate(k => +document.querySelector('#rent-f-' + k + ' .chip-count').textContent, k);
check('chips: Unpaid count matches model', await chipCount('unpaid') === unpaid0.length);
await page.click('#rent-f-late');
const lateN = await page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.status === 'late'; }).length, thisMonth);
check('chips: Late filter shows only late rows', await rowCount() === lateN && await chipCount('late') === lateN, `${await rowCount()} rows, ${lateN} late`);
await page.click('#rent-f-paid');
check('chips: Paid filter has no Mark paid buttons', await page.locator('.rent-tbl [data-act="pay"]').count() === 0 && await rowCount() === await chipCount('paid'));
await page.click('#rent-f-all');
check('chips: All restores every row', await rowCount() === expectAll);

// honest quick-pay amounts (item: a tenant who also owes for earlier months)
const fmt = c => page.evaluate(c => RB.money.fmt(c), c);
const owesMore = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && lg.balance > m.open; }); return t && t.id; }, thisMonth);
const ordinary = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && lg.balance === m.open; }); return t && t.id; }, thisMonth);
if (owesMore && ordinary) {
  const om = await month(owesMore);
  const earlier = om.balance - om.open;
  check('honest pay: button names the amount it records', (await page.textContent('#rent-pay-' + owesMore)).trim() === 'Pay ' + await fmt(om.balance), await page.textContent('#rent-pay-' + owesMore));
  check('honest pay: muted "+ $X earlier" under Open', (await page.textContent('tr[data-row="' + owesMore + '"] .rent-earlier')).trim() === '+ ' + await fmt(earlier) + ' earlier');
  check('honest pay: ordinary rows keep "Mark paid", no earlier line', (await page.textContent('#rent-pay-' + ordinary)).trim() === 'Mark paid' && await page.locator('tr[data-row="' + ordinary + '"] .rent-earlier').count() === 0);
  await page.check('#rent-chk-' + owesMore);
  await page.check('#rent-chk-' + ordinary);
  await tick(page);
  const ob = await month(ordinary);
  const bt = (await page.textContent('#rent-bulk')) || '';
  check('honest pay: bulk total includes earlier months and says so', bt.includes(await fmt(om.balance + ob.balance)) && (await page.textContent('.rent-bar-n')).includes('incl. ' + await fmt(earlier) + ' from earlier months'), bt);
  await page.click('#rent-clear');
  await tick(page);
  await page.click('#rent-pay-' + owesMore);
  await tick(page);
  check('honest pay: toast states the full amount recorded', ((await page.textContent('.toast-msg')) || '').startsWith('Recorded ' + await fmt(om.balance) + ' from'), await page.textContent('.toast-msg'));
  check('honest pay: balance cleared', (await month(owesMore)).balance === 0);
  await page.click('.toast-action'); await tick(page); await closeToasts();
} else check('honest pay: sample has a tenant owing earlier months and an ordinary one', false);

// rail badges: Today = attention items; Rent = tenants with rent past grace in any month
const badge = r => page.evaluate(r => document.querySelector('.rail-link[href="#' + r + '"] .rail-count').textContent.trim(), r);
const lateAny = () => page.evaluate(() => RB.store.tenantsList().filter(t => Object.values(RB.store.ledger(t.id).months).some(m => m.status === 'late')).length);
check('badge: Today = number of attention items', +(await badge('today')) === await page.evaluate(() => RB.store.attention().length), await badge('today'));
check('badge: Rent = tenants late in any month', +(await badge('rent')) === await lateAny(), await badge('rent'));
const rentBadge0 = +(await badge('rent'));
// a moved-out tenant whose last months are unpaid: late, but not this month
await page.evaluate(() => RB.store.addTenant({ id: 'smkLateOld', name: 'Old Debt', property: 'Alder Court', unit: '9Z', status: 'past', rent: [{ from: '2026-08-01', amount: 100000 }], lease: { start: '2026-08-01', moveIn: '2026-08-01', moveOut: '2026-10-31' } }));
await tick(page);
check('badge: counts a tenant late only in an earlier month', +(await badge('rent')) === rentBadge0 + 1, await badge('rent'));
await page.evaluate(() => RB.store.deleteTenant('smkLateOld'));
await tick(page);

// quick pay + undo
const q = unpaid0[0];
const before = await month(q);
await page.click('#rent-pay-' + q);
await tick(page);
check('quick pay: month fully paid', (await month(q)).open === 0 && (await month(q)).balance === 0);
check('quick pay: toast says what was recorded', /^Recorded \$[\d,]+ from /.test((await page.textContent('.toast-msg')) || ''));
check('quick pay: row moved to the paid section', await page.locator('#rent-pay-' + q).count() === 0);
await page.click('.toast-action');
await tick(page);
check('quick pay: Undo restores the balance', (await month(q)).balance === before.balance && (await month(q)).open === before.open);
await closeToasts();

// payment sheet, partial
const s = unpaid0[1];
const sBefore = await month(s);
await page.click('#rent-sheet-' + s);
await page.waitForSelector('#pay-amount');
await page.fill('#pay-amount', '100');
await page.press('#pay-amount', 'Enter');
await tick(page, 300);
const sAfter = await month(s);
check('sheet: partial $100 recorded', sAfter.paid === sBefore.paid + 10000 && sAfter.open === sBefore.open - 10000);
check('sheet: still unpaid row with Mark paid', await page.locator('#rent-pay-' + s).count() === 1);
await closeToasts();

// bulk pay + one undo
const [b1, b2] = (await unpaidIds()).slice(0, 2);
await page.check('#rent-chk-' + b1);
await page.check('#rent-chk-' + b2);
await tick(page);
const barText = (await page.textContent('#rent-bulk')) || '';
const expectTotal = await page.evaluate(ids => ids.reduce((a, id) => a + RB.store.ledger(id).balance, 0), [b1, b2]);
check('bulk: action bar names count and total', barText.includes('Record 2 payments') && barText.includes(await page.evaluate(c => RB.money.fmt(c), expectTotal)), barText);
const bb = [await month(b1), await month(b2)];
await page.click('#rent-bulk');
await tick(page);
check('bulk: both rows paid', (await month(b1)).open === 0 && (await month(b2)).open === 0);
check('bulk: bar gone, selection cleared', await page.locator('#rent-bulk').count() === 0);
check('bulk: single toast', (await page.textContent('.toast-msg')).startsWith('Recorded 2 payments'));
await page.click('.toast-action');
await tick(page);
check('bulk: one Undo restores both', (await month(b1)).balance === bb[0].balance && (await month(b2)).balance === bb[1].balance);
await closeToasts();

// select all unpaid
await page.check('#rent-all');
await tick(page);
check('bulk: select-all ticks every unpaid row', (await page.textContent('.rent-bar-n')).startsWith((await unpaidIds()).length + ' selected'));
await page.click('#rent-clear');
await tick(page);

// late fee link
const feeId = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); return lg.months[k] && lg.months[k].status === 'late' && lg.suggestedLateFee && lg.suggestedLateFee.period === k; }); return t && t.id; }, thisMonth);
if (feeId) {
  await page.click('#rent-fee-' + feeId);
  await tick(page);
  check('late fee: charge added for the month', await page.evaluate(([id, k]) => RB.store.ledger(id).rows.some(r => r.category === 'late_fee' && r.period === k && !r.void), [feeId, thisMonth]));
  check('late fee: suggestion link disappears', await page.locator('#rent-fee-' + feeId).count() === 0);
  await page.click('.toast-action'); await tick(page); await closeToasts();
} else check('late fee: a late tenant with a suggestion exists', false);

// month stepping (past month status + editable)
await page.click('#rent-prev');
await tick(page);
const prevKey = await page.evaluate(k => RB.date.addMonthKey(k, -1), thisMonth);
check('stepper: previous month shown', (await page.textContent('.stepper-label')).trim() === await page.evaluate(k => RB.date.fmtMonth(k), prevKey));
check('stepper: "This month" jump appears', await page.locator('#rent-today').count() === 1);
const pastOpen = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.open > 0; }); return t && t.id; }, prevKey);
if (pastOpen) {
  const pm = await month(pastOpen, prevKey);
  check('stepper: past month shows that month status', await page.evaluate(([id]) => !!document.querySelector('tr[data-row="' + id + '"] .pill-late'), [pastOpen]) && pm.status === 'late');
  const balBefore = pm.balance;
  await page.click('#rent-pay-' + pastOpen);
  await tick(page);
  const pa = await month(pastOpen, prevKey);
  const curOpen = (await month(pastOpen)).open;
  check('past month: Mark paid clears that month, leaves this month open', pa.open === 0 && curOpen > 0 && pa.balance === curOpen, `open ${pa.open}, balance ${pa.balance} (was ${balBefore}, month open ${pm.open})`);
  await page.click('.toast-action'); await tick(page); await closeToasts();
} else check('past month: someone owes for last month', false);
await page.click('#rent-today');
await tick(page);
check('stepper: back to this month, next disabled', await page.locator('#rent-today').count() === 0 && await page.isDisabled('#rent-next'));

// keyboard cursor
await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
await page.keyboard.press('j');
await tick(page);
const firstId = await page.evaluate(() => document.querySelector('.rent-tbl tbody tr.rent-row').dataset.row);
check('keys: j puts the cursor on the first row', await page.evaluate(id => document.querySelector('tr[data-row="' + id + '"]').classList.contains('is-focused'), firstId));
await page.keyboard.press('j');
await tick(page);
const secondId = await page.evaluate(() => document.querySelectorAll('.rent-tbl tbody tr.rent-row')[1].dataset.row);
check('keys: j moves down', await page.evaluate(id => document.querySelector('tr.is-focused').dataset.row === id, secondId));
await page.keyboard.press('k');
await tick(page);
check('keys: k moves up', await page.evaluate(id => document.querySelector('tr.is-focused').dataset.row === id, firstId));
const uBefore = await unpaidIds();
await page.keyboard.press('p');
await tick(page, 120);
check('keys: p marks the cursor row paid', (await month(firstId)).open === 0);
const cur = await page.evaluate(() => { const tr = document.querySelector('tr.is-focused'); return tr && tr.dataset.row; });
check('keys: cursor lands on the next unpaid row', cur && cur !== firstId && uBefore.includes(cur) && !!(await page.$('tr[data-row="' + cur + '"] [data-act="pay"]')), cur);
await page.keyboard.press('x');
await tick(page);
check('keys: x selects the cursor row', await page.evaluate(id => document.querySelector('tr[data-row="' + id + '"]').classList.contains('is-selected'), cur));
await page.keyboard.press('Escape');
await tick(page);
check('keys: Esc clears the selection', await page.locator('#rent-bulk').count() === 0);
await page.keyboard.press('Enter');
await page.waitForSelector('#pay-amount', { timeout: 2000 }).catch(() => {});
check('keys: Enter opens the payment sheet', await page.locator('.sheet #pay-amount').count() === 1);
await page.keyboard.press('Escape');
await tick(page, 250);
await page.keyboard.press('o');
await tick(page, 150);
check('keys: o opens the tenant', await page.evaluate(id => location.hash === '#t-' + id, cur));
await page.keyboard.press('Escape');
await tick(page, 250);
await page.evaluate(() => { RB.ui.closeAll(); location.hash = 'rent'; });
await tick(page, 150);
// shortcuts keep working while a tick box has focus (the core no longer treats checkboxes as typing)
const ck = (await unpaidIds())[0];
await page.click('#rent-chk-' + ck);
await tick(page);
check('keys: a ticked checkbox keeps focus', await page.evaluate(id => document.activeElement && document.activeElement.id === 'rent-chk-' + id, ck));
await page.keyboard.press('j');
await tick(page);
check('keys: j works with a checkbox focused', await page.evaluate(id => { const tr = document.querySelector('tr.is-focused'); return !!tr && tr.dataset.row !== id; }, ck));
await page.keyboard.press('Escape');
await tick(page);
await page.focus('#rent-group');
await page.keyboard.press('?');
await tick(page, 100);
check('keys: ? opens help from the group-by checkbox', ((await page.textContent('.sheet-title').catch(() => '')) || '') === 'Keyboard shortcuts');
await page.keyboard.press('Escape');
await tick(page, 250);
await page.evaluate(() => { RB.ui.closeAll(); location.hash = 'rent'; });
await tick(page, 150);
await closeToasts();

// group by property (remembered)
await page.check('#rent-group');
await tick(page);
check('group: property rows shown and remembered', await page.locator('.rent-tbl tr.tbl-group').count() === 3 && await page.evaluate(() => RB.prefs.get('rent.group')) === true);
await page.uncheck('#rent-group');
await tick(page);

// ================================================================= Today
await page.evaluate(() => { location.hash = 'today'; });
await tick(page, 150);
check('today: collection header links to Rent', await page.getAttribute('.td-collect', 'href') === '#rent');
check('today: attention grouped with labels', await page.locator('.td-group-label').count() >= 2);
const att = await page.evaluate(() => RB.store.attention().map(a => ({ id: a.id, kind: a.kind, act: a.action.type, sec: a.secondary && a.secondary.type })));
check('today: every attention item rendered (or behind Show more)', await page.evaluate(n => document.querySelectorAll('.td-row').length + Array.from(document.querySelectorAll('.td-more')).reduce((a, b) => a + (+(b.textContent.match(/\d+/) || [0])[0]), 0) === n, att.length));
check('today: at most one secondary per row', await page.evaluate(() => Array.from(document.querySelectorAll('.td-row')).every(r => r.querySelectorAll('.lrow-actions .btn').length === 1 && r.querySelectorAll('.td-second').length <= 1)));
const feeItem = att.find(a => a.sec === 'addLateFee' && a.kind === 'late');
if (feeItem) {
  await page.click('#td-2-' + feeItem.id);
  await tick(page);
  check('today: late-fee suggestion disappears once added', await page.locator('#td-2-' + feeItem.id).count() === 0);
  await page.click('.toast-action'); await tick(page); await closeToasts();
}
const payItem = att.find(a => a.act === 'recordPayment');
await page.click('#td-1-' + payItem.id);
await page.waitForSelector('#pay-amount', { timeout: 2000 }).catch(() => {});
check('today: Record payment opens the payment sheet', await page.locator('.sheet #pay-amount').count() === 1);
await page.keyboard.press('Escape');
await tick(page, 250);
const fu = att.find(a => a.act === 'followupDone');
if (fu) {
  await page.click('#td-1-' + fu.id);
  await tick(page);
  check('today: Mark done removes the follow-up', await page.locator('[data-item="' + fu.id + '"]').count() === 0);
  await page.click('.toast-action'); await tick(page); await closeToasts();
}
// Show more: add enough upkeep to exceed 6 in a group
await page.evaluate(() => { for (let i = 0; i < 6; i++) RB.store.addTicket({ id: 'smk' + i, title: 'Smoke leak ' + i, property: 'Alder Court', unit: '1A', priority: 'urgent', status: 'open', reported: RB.store.today() }); });
await tick(page);
const more = page.locator('#td-more-upkeep');
check('today: long group shows 6 and a Show n more control', await more.count() === 1 && /Show \d+ more/.test(await more.textContent()) && await page.locator('[aria-labelledby="td-g-upkeep"] .td-row').count() === 6);
await more.click();
await tick(page);
check('today: Show more expands the group', await page.locator('[aria-labelledby="td-g-upkeep"] .td-row').count() > 6 && (await page.textContent('#td-more-upkeep')).includes('Show fewer'));
await page.evaluate(() => { for (let i = 0; i < 6; i++) RB.store.deleteTicket('smk' + i); });
await tick(page);
// plates
const plate = page.locator('.td-plates button.plate').first();
const label = await plate.getAttribute('aria-label');
check('today: door plates have a spoken label', /^.+, .+, (paid|paid late|partly paid|due|\d+ days? late|no charge)/.test(label || ''), label);
await plate.click();
await tick(page, 150);
check('today: plate opens the tenant', await page.evaluate(() => /^#t-/.test(location.hash)));
await page.keyboard.press('Escape');
await tick(page, 250);
await page.evaluate(() => { location.hash = 'today'; });
await tick(page, 150);
check('today: recent activity lists 8 events', await page.locator('.td-ev').count() === 8);

// empty state
await page.evaluate(() => { const st = RB.store.state; window.__att = RB.store.attention; RB.store.attention = () => []; RB.shell.refresh(); });
check('today: empty attention says so quietly', (await page.textContent('.td-attention')).includes('Nothing needs you today.'));
await page.evaluate(() => { RB.store.attention = window.__att; RB.shell.refresh(); });

// ================================================================= phone: no sideways scroll, bulk on phone, 44px targets
await page.setViewportSize({ width: 390, height: 844 });
for (const r of ['today', 'rent']) {
  await page.evaluate(h => { location.hash = h; window.scrollTo(0, 0); }, r);
  await tick(page, 150);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone: no horizontal overflow on ${r}`, ov <= 0, ov + 'px');
}
const small = await page.evaluate(() => Array.from(document.querySelectorAll('.rent-cards [data-act="pay"], .rent-cards [data-act="sheet"], .rent-cards .rent-fee, .rent-cards .rent-menu')).filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).length);
check('phone: card actions are 44px tall', small === 0, small + ' small');
if (owesMore) {
  const om = await month(owesMore);
  check('phone: card button names the amount, earlier line shown', (await page.textContent('#rent-cpay-' + owesMore)).trim() === 'Pay ' + await fmt(om.balance) && (await page.textContent('.rent-card[data-row="' + owesMore + '"] .rent-earlier')).includes(await fmt(om.balance - om.open)));
}
await page.click('#rent-select');
await tick(page);
const pu = (await unpaidIds()).slice(0, 2);
await page.click('#rent-cchk-' + pu[0]);
await page.click('#rent-cchk-' + pu[1]);
await tick(page);
check('phone: bulk bar shows on phone', (await page.textContent('#rent-bulk')).includes('Record 2 payments'));
check('phone: no overflow in bulk mode', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.click('#rent-bulk');
await tick(page);
check('phone: bulk payment recorded', (await month(pu[0])).open === 0 && (await month(pu[1])).open === 0);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

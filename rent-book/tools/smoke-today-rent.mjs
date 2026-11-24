#!/usr/bin/env node
// Interaction tests for the Today and Rent views (v2 wording and flows) against dist/preview.html (local mode).
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
const check = (name, ok, extra) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined && !ok ? ' — ' + extra : '')); if (!ok) process.exitCode = 1; };
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
await page.evaluate(() => { RB.prefs.set('rent.tab', 'owes'); window.__copied = null; RB.copyText = t => { window.__copied = t; return Promise.resolve(true); }; });

const thisMonth = await page.evaluate(() => RB.store.today().slice(0, 7));
const month = (id, k) => page.evaluate(([id, k]) => { const lg = RB.store.ledger(id); const m = lg.months[k || lg.current.period]; return m ? { open: m.open, paid: m.paid, rentPaid: m.rentPaid, charged: m.rentCharged, status: m.status, balance: lg.balance } : null; }, [id, k]);
const unpaidIds = () => page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.scheduled && m.open > 0; }).map(t => t.id), thisMonth);
const fmt = c => page.evaluate(c => RB.money.fmt(c), c);
const closeToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
const note = async () => ((await page.textContent('.sheet-foot-note')) || '').trim();
const saveLabel = async () => ((await page.textContent('[data-action="save"]')) || '').trim();
const go = async h => { await page.evaluate(h => { RB.ui.closeAll(); location.hash = h; }, h); await tick(page, 150); };

// ================================================================= Rent
await go('rent');
const rows = () => page.locator('.rent-list > li.rent-row').count();
const charged = await page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.scheduled; }).length, thisMonth);
const unpaid0 = await unpaidIds();
check('rent: opens on "Still owes" with one row per tenant who owes', await rows() === unpaid0.length, `${await rows()} vs ${unpaid0.length}`);
check('rent: tab says "Still owes (N)"', ((await page.textContent('#rent-tab-owes')) || '').replace(/\s+/g, ' ').trim() === `Still owes (${unpaid0.length})`);
const p0 = await page.evaluate(() => RB.store.portfolio());
const owed0 = await page.evaluate(k => RB.store.tenantsList().reduce((a, t) => { const m = RB.store.ledger(t.id).months[k]; return a + (m && m.scheduled ? m.open : 0); }, 0), thisMonth);
const monName = await page.evaluate(k => RB.date.monthName(k), thisMonth);
const sum = ((await page.textContent('#rent-summary')) || '').replace(/\s+/g, ' ').trim();
check('rent: sentence at the top', sum === `${monName} rent: ${charged - unpaid0.length} of ${charged} tenants have paid. ${unpaid0.length} still owe ${await fmt(owed0)}.`, sum);
check('rent: month buttons are worded', ((await page.textContent('#rent-prev')) || '').includes('Earlier month') && ((await page.textContent('#rent-next')) || '').includes('Later month'));
await page.click('#rent-tab-paid'); await tick(page);
check('rent: Paid tab has no Record payment buttons', await page.locator('.rent-list [data-act="pay"]').count() === 0 && await rows() === charged - unpaid0.length);
check('rent: paid rows read as sentences', /^Paid \$[\d,]+ (on [A-Z][a-z]{2} \d+ by |in \d+ parts)/.test(((await page.textContent('.rent-row.is-paid .rent-say')) || '').trim()), await page.textContent('.rent-row.is-paid .rent-say'));
await page.click('#rent-tab-all'); await tick(page);
check('rent: Everyone tab shows every tenant charged', await rows() === charged);
await page.click('#rent-tab-owes'); await tick(page);
const totals = ((await page.textContent('#rent-totals')) || '').replace(/\s+/g, ' ');
check('rent: totals in words', totals.includes(await fmt(p0.charged) + ' of rent and charges was due') && totals.includes(await fmt(p0.collected) + ' has come in') && totals.includes(await fmt(p0.outstanding) + ' is still owed'), totals);

// --- the two-tap path: Record payment → Record $X
const ordinary = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && !m.rentPaid && lg.balance === m.open; }); return t && t.id; }, thisMonth);
const ordName = await page.evaluate(id => RB.store.tenant(id).name, ordinary);
const ob = await month(ordinary);
await page.click('#rent-pay-' + ordinary);
await page.waitForSelector('[data-action="save"]');
check('two taps: sheet asks "Did they pay all of it?" with "Yes, all $X" preselected', await page.isChecked('#pay-how-0') && ((await page.textContent('label[for="pay-how-0"]')) || '').includes('Yes, all ' + await fmt(ob.open)));
check('two taps: button states the amount', await saveLabel() === 'Record ' + await fmt(ob.open), await saveLabel());
check('two taps: live sentence says all paid up', (await note()) === `After this, ${ordName.split(' ')[0]} will be all paid up.`, await note());
check('two taps: How did they pay? is large choices with last method preselected', await page.locator('[data-field="method"] .choice').count() >= 3 && await page.evaluate(id => document.querySelector('[name="method"]:checked').value === RB.actions.lastMethod(id), ordinary));
await page.click('[data-action="save"]'); await tick(page, 250);
check('two taps: balance cleared', (await month(ordinary)).balance === 0);
const tmsg = ((await page.textContent('.toast-msg')) || '').trim();
check('two taps: plain toast', tmsg === `Recorded ${await fmt(ob.open)} from ${ordName}. All paid up.`, tmsg);
check('two taps: row left "Still owes"', await page.locator('#rent-pay-' + ordinary).count() === 0);
await page.click('.toast-action'); await tick(page); await closeToasts();
check('two taps: Undo restores', (await month(ordinary)).balance === ob.balance);

// --- someone who also owes for earlier months
const owesMore = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && lg.balance > m.open; }); return t && t.id; }, thisMonth);
if (owesMore) {
  const om = await month(owesMore);
  check('earlier months: row says "plus $X from earlier months"', ((await page.textContent(`[data-row="${owesMore}"] .rent-earlier`)) || '').trim() === `plus ${await fmt(om.balance - om.open)} from earlier months`);
  await page.click('#rent-pay-' + owesMore); await page.waitForSelector('#pay-how-0');
  check('earlier months: "Yes, all" names the whole amount and says it includes earlier months', ((await page.textContent('label[for="pay-how-0"]')) || '').includes('Yes, all ' + await fmt(om.balance)) && ((await page.textContent('label[for="pay-how-0"]')) || '').includes('Includes ' + await fmt(om.balance - om.open) + ' from earlier months'));
  await page.keyboard.press('Escape'); await tick(page, 200);
} else check('earlier months: sample has such a tenant', false);

// --- part payment: first-class choice
const pt = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open >= 120000 && !m.rentPaid && lg.balance === m.open; }); return t && t.id; }, thisMonth);
const ptName = await page.evaluate(id => RB.store.tenant(id).name, pt);
const pm0 = await month(pt);
check('part: row offers "They paid part of it" in words', ((await page.textContent('#rent-part-' + pt)) || '').trim() === 'They paid part of it');
await page.click('#rent-part-' + pt); await page.waitForSelector('#pay-amount');
check('part: "Only part of it" chosen, amount empty and focused', await page.isChecked('#pay-how-1') && (await page.inputValue('#pay-amount')) === '' && await page.evaluate(() => document.activeElement.id === 'pay-amount'));
check('part: hint says what they owe', ((await page.textContent('#pay-amount-hint')) || '').startsWith('They owe ' + await fmt(pm0.open)));
await page.click('[data-action="save"]'); await tick(page);
check('part: blank amount rejected with a plain message', ((await page.textContent('#pay-amount-err')) || '').startsWith('Type how much they paid'), await page.textContent('#pay-amount-err'));
await page.fill('#pay-amount', String((pm0.open + 5000) / 100));
check('part: overpayment sentence', (await note()) === 'That is $50 more than they owe — it will count toward next month.', await note());
const partAmt = 100000;
await page.fill('#pay-amount', '1000');
check('part: live sentence says what is still owed', (await note()) === `After this, ${ptName.split(' ')[0]} will still owe ${await fmt(pm0.open - partAmt)} for ${monName}.`, await note());
check('part: button states the amount', await saveLabel() === 'Record $1,000');
await page.click('[data-action="save"]'); await tick(page, 250);
const pm1 = await month(pt);
check('part: recorded $1,000', pm1.open === pm0.open - partAmt && pm1.rentPaid === partAmt);
const partToast = ((await page.textContent('.toast-msg')) || '').trim();
check('part: toast says what is still owed', partToast === `Recorded $1,000 from ${ptName}. Still owes ${await fmt(pm0.open - partAmt)}.`, partToast);
await closeToasts();
const partLine = ((await page.textContent(`[data-row="${pt}"] .rent-say`)) || '').replace(/\s+/g, ' ').trim();
check('part: row reads "Part paid — $X of $Y. Still owes $Z"', partLine.startsWith(`Part paid — $1,000 of ${await fmt(pm0.charged)}. Still owes ${await fmt(pm0.open - partAmt)}`), partLine);
check('part: stays under "Still owes"', await page.locator(`.rent-list [data-row="${pt}"]`).count() === 1);
const bar = await page.evaluate(id => { const b = document.querySelector(`[data-row="${id}"] .splitbar`); const p = b && b.querySelector('.splitbar-paid'); return b && p ? { w: b.getBoundingClientRect().width, p: p.getBoundingClientRect().width } : null; }, pt);
check('part: paid-share bar drawn to scale (±1px)', bar && Math.abs(bar.p - bar.w * partAmt / pm0.charged) <= 1, JSON.stringify(bar));
check('part: buttons "Record the rest ($X)" and "Another part payment"', ((await page.textContent('#rent-pay-' + pt)) || '').trim() === `Record the rest (${await fmt(pm0.open - partAmt)})` && ((await page.textContent('#rent-part-' + pt)) || '').trim() === 'Another part payment');
check('part: pill helper says "Part paid — rest is N days late" when late', pm1.status !== 'late' || await page.evaluate(id => { const m = RB.store.ledger(id).current; const s = String(RB.ui.monthPill(RB.store.ledger(id).months[m.period])); return s.includes('Part paid — rest is ' + RB.date.days(m.daysLate) + ' late') && s.includes('pill-partial_late'); }, pt));
// receipt for the part payment says so
const partEntry = await page.evaluate(id => { const e = RB.store.entries(id); return Object.keys(e).find(k => e[k].amount === 100000 && !e[k].undone); }, pt);
await page.evaluate(([id, e]) => RB.actions.copyReceipt(id, e), [pt, partEntry]); await tick(page);
const rc = await page.evaluate(() => window.__copied || '');
check('part: receipt says "Part payment received" and what is still owed', rc.includes('Part payment received: $1,000.') && rc.includes(`Still owed for ${monName}: ${await fmt(pm0.open - partAmt)}.`), rc);
await closeToasts();
await page.click('#rent-pay-' + pt); await page.waitForSelector('[data-action="save"]');
check('part: "Record the rest" opens with the rest preselected', await saveLabel() === 'Record ' + await fmt(pm0.open - partAmt));
await page.click('[data-action="save"]'); await tick(page, 250);
check('part: the rest clears the month', (await month(pt)).open === 0);
await page.click('.toast-action'); await tick(page); await closeToasts();
check('part: Undo puts the part-paid state back', (await month(pt)).open === pm0.open - partAmt);
await page.evaluate(([id, e]) => RB.store.undoEntry(id, e), [pt, partEntry]); await tick(page);

// --- bulk: an explained mode
check('bulk: no tick boxes until asked', await page.locator('.rent-list input[type="checkbox"]').count() === 0);
await page.click('#rent-bulkmode'); await tick(page);
check('bulk: explains itself', ((await page.textContent('#rent-bulkhelp')) || '').includes('Tick everyone who paid in full'));
const [b1, b2] = await unpaidIds();
const bb = [await month(b1), await month(b2)];
await page.check('#rent-chk-' + b1); await page.check('#rent-chk-' + b2); await tick(page);
const bt = ((await page.textContent('#rent-bulk')) || '').trim();
check('bulk: button names count and total', bt === `Record 2 payments — ${await fmt(bb[0].balance + bb[1].balance)}`, bt);
await page.click('#rent-bulk'); await tick(page, 200);
check('bulk: both paid, mode ends', (await month(b1)).balance === 0 && (await month(b2)).balance === 0 && await page.locator('#rent-bulkhelp').count() === 0);
check('bulk: one toast', ((await page.textContent('.toast-msg')) || '').startsWith('Recorded 2 payments'));
await page.click('.toast-action'); await tick(page); await closeToasts();
check('bulk: one Undo restores both', (await month(b1)).balance === bb[0].balance && (await month(b2)).balance === bb[1].balance);

// --- More menu (worded), late fee, remove a mistaken payment
const feeId = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); return lg.suggestedLateFee && lg.suggestedLateFee.period === k; }); return t && t.id; }, thisMonth);
if (feeId) {
  await page.click('#rent-more-' + feeId); await tick(page);
  const items = await page.$$eval('.menu-item', els => els.map(e => e.textContent.trim()));
  check('more: worded menu with part payment and late fee', (items.includes('They paid part of it') || items.includes('Another part payment')) && items.some(t => t.startsWith('Add a late fee of $')), items.join(' | '));
  await page.click('.menu-item:has-text("Add a late fee")'); await tick(page);
  check('more: late fee added', await page.evaluate(([id, k]) => RB.store.ledger(id).rows.some(r => r.category === 'late_fee' && r.period === k && !r.void), [feeId, thisMonth]));
  check('more: late fee toast in words', /^Added a \$[\d,]+ late fee for .+ \(.+\)\.$/.test(((await page.textContent('.toast-msg')) || '').trim()));
  await page.click('.toast-action'); await tick(page); await closeToasts();
} else check('more: a late tenant with a fee suggestion exists', false);
await page.click('#rent-tab-paid'); await tick(page);
const paidId = await page.evaluate(() => document.querySelector('.rent-row.is-paid').dataset.row);
const pb = await month(paidId);
await page.click('#rent-more-' + paidId); await tick(page);
const pitems = await page.$$eval('.menu-item', els => els.map(e => e.textContent.trim()));
check('more (paid): Copy a receipt and Remove this payment', pitems.includes('Copy a receipt') && pitems.includes('Remove this payment — it was a mistake'), pitems.join(' | '));
await page.click('.menu-item:has-text("Remove this payment")'); await tick(page);
check('remove: payment removed, toast uses the glossary', (await month(paidId)).balance > pb.balance && ((await page.textContent('.toast-msg')) || '').startsWith('Removed the $'));
await page.click('.toast-action'); await tick(page); await closeToasts();
check('remove: Undo puts it back', (await month(paidId)).balance === pb.balance);
await page.click('#rent-tab-owes'); await tick(page);

// --- months
const prevKey = await page.evaluate(k => RB.date.addMonthKey(k, -1), thisMonth);
await page.click('#rent-prev'); await tick(page);
check('month: earlier month shown in words with a way back', ((await page.textContent('.rent-month-name')) || '').trim() === await page.evaluate(k => RB.date.fmtMonth(k), prevKey) && ((await page.textContent('#rent-today')) || '').includes('Back to ' + monName));
await page.click('#rent-today'); await tick(page);
check('month: back to this month', ((await page.textContent('.rent-month-name')) || '').trim() === await page.evaluate(k => RB.date.fmtMonth(k), thisMonth));

// rail badges
const badge = r => page.evaluate(r => { const e = document.querySelector('#rb-nav-' + r + ' .rail-count [aria-hidden]'); return e ? e.textContent.trim() : ''; }, r);
check('badge: Today = number of things that need you', +(await badge('today')) === await page.evaluate(() => RB.store.attention().length));
check('badge: Rent = tenants late in any month', +(await badge('rent')) === await page.evaluate(() => RB.shell.lateTenants().length));

// ================================================================= Today
await go('today');
const taskLabels = await page.$$eval('.td-task', els => els.map(e => e.querySelector('.td-task-label').textContent.trim() + ' / ' + e.querySelector('.td-task-help').textContent.trim()));
check('today: three task buttons with one line of help', taskLabels.length === 3 && taskLabels[0].startsWith('Record a rent payment / Someone paid you') && taskLabels[1].startsWith('Log a repair') && taskLabels[2].startsWith('Add a tenant'), taskLabels.join(' | '));
check('today: task buttons ≥ 64px tall', await page.$$eval('.td-task', els => els.every(e => e.getBoundingClientRect().height >= 64)));
const pp = await page.evaluate(() => RB.store.portfolio());
const owesN = await page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.scheduled && m.open > 0; }).length, thisMonth);
const say = ((await page.textContent('#td-say')) || '').replace(/\s+/g, ' ').trim();
check('today: collection as a sentence', say === `${await fmt(pp.collected)} of ${await fmt(pp.charged)} collected for ${monName}. ${owesN} tenants still owe.`, say);
check('today: bar keeps a separate "Part paid" key', ((await page.textContent('.td-legend')) || '').includes('Part paid'));
// guided flow
await page.click('#td-task-pay'); await page.waitForSelector('#pick-q');
check('flow: "Who paid you?" chooser opens', ((await page.textContent('.sheet-title')) || '').trim() === 'Who paid you?');
check('flow: people who owe come first', await page.evaluate(() => document.querySelector('.pick-row .pick-owes').classList.contains('is-owed')));
check('flow: rows are large (≥ 56px)', await page.$$eval('.pick-row', els => els.slice(0, 5).every(e => e.getBoundingClientRect().height >= 56)));
await page.fill('#pick-q', 'okafor'); await tick(page);
check('flow: find box filters', await page.locator('.pick-row').count() === 1);
await page.click('.pick-row'); await page.waitForSelector('#pay-date');
check('flow: then the simple payment sheet', ((await page.textContent('.sheet-title')) || '').trim() === 'Record a payment' && ((await page.textContent('.sheet-sub')) || '').includes('Okafor'));
await page.keyboard.press('Escape'); await tick(page, 200);
// what needs you
await page.evaluate(() => document.querySelectorAll('.td-more[aria-expanded="false"]').forEach(b => b.click())); await tick(page);
check('today: "What needs you" lists every item', await page.locator('.td-row').count() === await page.evaluate(() => RB.store.attention().length));
check('today: every item has one worded button', await page.$$eval('.td-row', els => els.every(r => { const b = r.querySelector('.td-actions .btn'); return b && b.textContent.trim().length > 3; })));
const lp = await page.evaluate(() => { const t = RB.store.tenantsList().find(t => { const m = RB.store.ledger(t.id).current; return m.status === 'late' && m.paid > 0; }); return t && { id: t.id, name: t.name }; });
if (lp) {
  const m = await month(lp.id);
  const dl = await page.evaluate(id => RB.date.days(RB.store.ledger(id).current.daysLate), lp.id);
  const line = ((await page.textContent(`[data-item="late-${lp.id}"] .td-sentence`)) || '').replace(/\s+/g, ' ').trim();
  check('today: part-paid late tenant in a sentence', line.endsWith(`${lp.name} has paid ${await fmt(m.rentPaid)} of ${await fmt(m.charged)} for ${monName}. Still owes ${await fmt(m.open)}, ${dl} late.`), line);
} else check('today: a late part-paid tenant exists', false);
// glance + activity
check('today: one plate per current tenant', await page.locator('.td-plates .plate').count() === await page.evaluate(() => RB.store.tenantsList({ includePast: false }).length));
check('today: the grid has a plain caption and key', ((await page.textContent('.td-glance-cap')) || '').includes('Each box is one home') && ((await page.textContent('.td-keys')) || '').includes('Red = late'));
check('today: activity in sentences', await page.$$eval('.td-ev-text', els => els.some(e => / paid \$[\d,]+ by .+ on [A-Z][a-z]{2} \d+\./.test(e.textContent))));
await page.locator('.td-plates .plate').first().click(); await tick(page, 150);
check('today: plate opens the tenant', await page.evaluate(() => /^#t-/.test(location.hash)));

// ================================================================= phone: sizes, words, two taps
const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', deviceScaleFactor: 2 });
await ph.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const pg = await ph.newPage();
pg.on('pageerror', e => errors.push('phone: ' + e.message));
await pg.goto(url + '#today');
await pg.waitForFunction(() => RB.store.state.ready);
await pg.evaluate(() => RB.actions.loadSample({ quiet: true }));
await pg.waitForFunction(() => RB.store.tenantsList().length === 27);
const small = () => pg.evaluate(() => {
  const sel = '#rb-view button, #rb-view a, #rb-view input:not([type=checkbox]):not([type=radio]), #rb-view select, #rb-view label.rent-tick, #rb-topbar button, #rb-topbar a, #rb-tabbar a, #rb-tabbar button, #rb-banner button';
  return Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 47.5).map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)).slice(0, 8);
});
const unnamed = () => pg.evaluate(() => Array.from(document.querySelectorAll('#rb-view button, #rb-topbar button, #rb-tabbar button, #rb-tabbar a, #rb-rail button, #rb-rail a')).filter(e => e.offsetParent !== null || e.closest('#rb-rail')).filter(e => !e.textContent.trim() || !(e.innerText || e.textContent).trim()).map(e => e.id || e.className).slice(0, 8));
for (const r of ['today', 'rent']) {
  await pg.evaluate(h => { location.hash = h; }, r); await tick(pg, 150);
  const s = await small();
  check(`phone ${r}: every control ≥ 48px tall`, !s.length, s.join(', '));
  const u = await unnamed();
  check(`phone ${r}: every button has visible words`, !u.length, u.join(', '));
  check(`phone ${r}: tab labels ≥ 12px`, await pg.$$eval('#rb-tabbar .tab-label', els => els.length === 5 && els.every(e => parseFloat(getComputedStyle(e).fontSize) >= 12)));
}
const pid = await pg.evaluate(k => RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && lg.balance === m.open; }).id, thisMonth);
await pg.click('#rent-pay-' + pid); await pg.waitForSelector('[data-action="save"]');
await pg.click('[data-action="save"]'); await tick(pg, 250);
check('phone: two taps record a payment', await pg.evaluate(id => RB.store.ledger(id).balance === 0, pid));
check('phone: toast sits above the tab bar', await pg.evaluate(() => document.querySelector('.toast').getBoundingClientRect().bottom <= document.getElementById('rb-tabbar').getBoundingClientRect().top));
// Extra large text: nothing overflows
await pg.evaluate(() => RB.textSize.set('xl'));
for (const r of ['today', 'rent']) {
  await pg.evaluate(h => { RB.ui.closeAll(); location.hash = h; }, r); await tick(pg, 200);
  const ov = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, wide: Array.from(document.querySelectorAll('#rb-view *, #rb-topbar *, #rb-tabbar *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.id || e.className).slice(0, 4) }));
  check(`phone XL ${r}: no horizontal overflow`, ov.doc <= 390 && !ov.wide.length, JSON.stringify(ov));
}
await pg.evaluate(() => RB.textSize.set('normal'));
await ph.close();

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

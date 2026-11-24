#!/usr/bin/env node
// Interaction tests for the Today and Rent views (v3, SPEC §10.3) against dist/preview.html (local mode).
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
const rows = () => page.locator('.rent-list > li[data-row]').count();
const charged = await page.evaluate(k => RB.store.tenantsList().filter(t => { const m = RB.store.ledger(t.id).months[k]; return m && m.scheduled; }).length, thisMonth);
const unpaid0 = await unpaidIds();
check('rent: opens on "Still owes" with one row per tenant who owes', await rows() === unpaid0.length, `${await rows()} vs ${unpaid0.length}`);
check('rent: one-row segment "Still owes N · Paid N · All N"', ((await page.textContent('#rent-tab-owes')) || '').replace(/\s+/g, ' ').trim() === `Still owes ${unpaid0.length}` && await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.segment > button')); return b.length === 3 && new Set(b.map(x => Math.round(x.getBoundingClientRect().top))).size === 1; }));
const owedSentence = await page.evaluate(() => RB.ui.owedSentence());
const monName = await page.evaluate(k => RB.date.monthName(k), thisMonth);
check('rent: the owed sentence at the top (law 7)', ((await page.textContent('#rent-summary')) || '').trim() === owedSentence, owedSentence);
check('rent: owed sentence matches the model', owedSentence === await page.evaluate(() => RB.model.owedSentence(RB.model.owed(RB.store.state, RB.store.today()), RB.store.today())));
check('rent: month is the display element, stepped by text links', await page.evaluate(() => document.getElementById('rent-month-name').classList.contains('t-display') && document.getElementById('rent-prev').classList.contains('btn-link') && /Earlier month/.test(document.getElementById('rent-prev').textContent) && /Later month/.test(document.getElementById('rent-next').textContent)));
const order = await page.evaluate(() => Array.from(document.querySelectorAll('.rent-list > li[data-row]')).map(li => li.dataset.row));
check('rent: same order as everywhere (RB.model.attentionOrder)', JSON.stringify(order) === JSON.stringify(await page.evaluate(() => RB.model.attentionOrder(RB.store.state, RB.store.today()).filter(id => { const m = RB.store.ledger(id).months[RB.store.today().slice(0, 7)]; return m && m.open > 0; }))), order.join(','));
check('rent: each still-owes row has exactly one soft button', await page.$$eval('.rent-list > li[data-row]', lis => lis.every(li => li.querySelectorAll('button:not(.row-hit), a').length === 1 && li.querySelector('.row-btn.btn-soft'))));
check('rent: no filled button on the page', await page.locator('#rb-view .btn-primary:visible').count() === 0);
await page.click('#rent-tab-paid'); await tick(page);
check('rent: Paid rows are plain (no buttons)', await page.locator('.rent-list button:not(.row)').count() === 0 && await rows() === charged - unpaid0.length);
check('rent: paid rows read "Paid $X on November 3 by check"', /^Paid \$[\d,]+ (on [A-Z][a-z]+ \d+ by |in \d+ parts)/.test(((await page.textContent('.rent-list > li.is-paid .row-sub')) || '').trim()), await page.textContent('.rent-list > li.is-paid .row-sub'));
await page.click('#rent-tab-all'); await tick(page);
check('rent: All shows every tenant charged', await rows() === charged);
await page.click('#rent-tab-owes'); await tick(page);
const p0 = await page.evaluate(() => RB.store.portfolio());
const totals = ((await page.textContent('#rent-totals')) || '').replace(/\s+/g, ' ');
check('rent: totals as one sentence', totals.includes(await fmt(p0.charged) + ' of rent and charges was due') && totals.includes(await fmt(p0.collected) + ' has come in') && totals.includes(await fmt(p0.outstanding) + ' is still owed'), totals);
check('rent: month at a glance on desktop (one plate per tenant charged)', await page.locator('.rent-glance .plate').count() === charged);

// --- the two-tap path: Record a payment → Record $X
const ordinary = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && !m.rentPaid && lg.balance === m.open; }); return t && t.id; }, thisMonth);
const ordName = await page.evaluate(id => RB.store.tenant(id).name, ordinary);
const ob = await month(ordinary);
check('row: button says "Record a payment"', ((await page.textContent('#rent-pay-' + ordinary)) || '').trim() === 'Record a payment');
await page.evaluate(() => RB.ui.toast('A message from before', { undo: () => {} }));
await page.click('#rent-pay-' + ordinary);
await page.waitForSelector('[data-action="save"]');
check('toast: dismissed the moment the payment sheet opens', await page.evaluate(() => !Array.from(document.querySelectorAll('.toast')).some(t => !t.classList.contains('is-closing'))));
check('two taps: "Did they pay all of it?" with "Yes, all $X" preselected', await page.isChecked('#pay-how-0') && ((await page.textContent('label[for="pay-how-0"]')) || '').includes('Yes, all ' + await fmt(ob.open)));
check('two taps: button states the amount', await saveLabel() === 'Record ' + await fmt(ob.open), await saveLabel());
check('two taps: live sentence says all paid up', (await note()) === `After this, ${ordName.split(' ')[0]} will be all paid up.`, await note());
check('payment sheet: one filled button', await page.locator('.sheet .btn-primary').count() === 1);
check('payment sheet: the date written out beside the field', ((await page.textContent('#pay-date-words')) || '').trim() === await page.evaluate(() => RB.ui.dateWords(RB.store.today())) && /^[A-Z][a-z]+day, [A-Z][a-z]+ \d+$/.test(((await page.textContent('#pay-date-words')) || '').trim()));
check('payment sheet: how they paid preselected to the last way (select for 5+ ways)', await page.evaluate(id => document.querySelector('[name="method"]').value === RB.actions.lastMethod(id), ordinary));
check('payment sheet: amount field sized to the answer', await page.evaluate(() => document.querySelector('#pay-amount-wrap .money-input').getBoundingClientRect().width < 260));
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
  check('earlier months: row says "and $X from earlier months"', ((await page.textContent(`[data-row="${owesMore}"] .row-sub`)) || '').trim().endsWith(`and ${await fmt(om.balance - om.open)} from earlier months`));
  await page.click('#rent-pay-' + owesMore); await page.waitForSelector('#pay-how-0');
  check('earlier months: "Yes, all" names the whole amount and says it includes earlier months', ((await page.textContent('label[for="pay-how-0"]')) || '').includes('Yes, all ' + await fmt(om.balance)) && ((await page.textContent('label[for="pay-how-0"]')) || '').includes('Includes ' + await fmt(om.balance - om.open) + ' from earlier months'));
  await page.keyboard.press('Escape'); await tick(page, 250);
} else check('earlier months: sample has such a tenant', false);

// --- part payment: from the row's "What would you like to do?"
const pt = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open >= 120000 && !m.rentPaid && lg.balance === m.open; }); return t && t.id; }, thisMonth);
const ptName = await page.evaluate(id => RB.store.tenant(id).name, pt);
const pm0 = await month(pt);
await page.click('#rent-row-' + pt); await page.waitForSelector('#rent-c-part');
const choiceLabels = await page.$$eval('.choices-list .row-title', els => els.map(e => e.textContent.trim()));
check('row tap: "What would you like to do?" with part payment and their page', choiceLabels[0] === 'They paid part of it' && choiceLabels.includes('See their page'), choiceLabels.join(' | '));
check('choices sheet: no filled button', await page.locator('.sheet .btn-primary').count() === 0);
await page.click('#rent-c-part'); await page.waitForSelector('#pay-amount'); await tick(page, 300);
check('no sheet on sheet: the choices sheet closed before the payment sheet opened', await page.locator('.sheet-wrap:not(.is-closing)').count() === 1);
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
const partSub = ((await page.textContent(`[data-row="${pt}"] .row-sub`)) || '').trim();
check('part: row reads "Owes $Z of November’s $Y"', partSub === `Owes ${await fmt(pm0.open - partAmt)} of ${monName}’s ${await fmt(pm0.charged)}`, partSub);
check('part: status marker says part paid', /^Part paid/.test(((await page.textContent(`[data-row="${pt}"] .status`)) || '').trim()));
const bar = await page.evaluate(id => { const b = document.querySelector(`[data-row="${id}"] .splitbar`); const p = b && b.querySelector('.splitbar-paid'); return b && p ? { w: b.getBoundingClientRect().width, p: p.getBoundingClientRect().width } : null; }, pt);
check('part: paid-share bar drawn to scale (±1px)', bar && Math.abs(bar.p - bar.w * partAmt / pm0.charged) <= 1, JSON.stringify(bar));
check('part: the one button now says "Record the rest ($X)"', ((await page.textContent('#rent-pay-' + pt)) || '').trim() === `Record the rest (${await fmt(pm0.open - partAmt)})`);
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

// --- bulk: a text link that starts an explained mode
check('bulk: no tick boxes until asked', await page.locator('.rent-list input[type="checkbox"]').count() === 0);
check('bulk: "Record several at once" is a text link', await page.evaluate(() => document.getElementById('rent-bulkmode').classList.contains('btn-link')));
await page.click('#rent-bulkmode'); await tick(page);
check('bulk: explains itself', ((await page.textContent('#rent-bulkhelp')) || '').includes('Tick everyone who paid in full'));
const [b1, b2] = await unpaidIds();
const bb = [await month(b1), await month(b2)];
await page.check('#rent-chk-' + b1); await page.check('#rent-chk-' + b2); await tick(page);
const bt = ((await page.textContent('#rent-bulk')) || '').trim();
check('bulk: the one filled button names count and total', bt === `Record 2 payments — ${await fmt(bb[0].balance + bb[1].balance)}` && await page.locator('#rb-view .btn-primary:visible').count() === 1, bt);
await page.click('#rent-bulk'); await tick(page, 200);
check('bulk: both paid, mode ends', (await month(b1)).balance === 0 && (await month(b2)).balance === 0 && await page.locator('#rent-bulkhelp').count() === 0);
check('bulk: one toast', ((await page.textContent('.toast-msg')) || '').startsWith('Recorded 2 payments'));
await page.click('.toast-action'); await tick(page); await closeToasts();
check('bulk: one Undo restores both', (await month(b1)).balance === bb[0].balance && (await month(b2)).balance === bb[1].balance);

// --- late fee from the row's choices; remove a mistaken payment
const feeId = await page.evaluate(k => { const t = RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); return lg.suggestedLateFee && lg.suggestedLateFee.period === k && lg.months[k].open > 0; }); return t && t.id; }, thisMonth);
if (feeId) {
  await page.click('#rent-row-' + feeId); await page.waitForSelector('#rent-c-fee');
  check('late fee: offered as "Add a $50 late fee"', /^Add a \$[\d,]+ late fee$/.test(((await page.textContent('#rent-c-fee .row-title')) || '').trim()));
  await page.click('#rent-c-fee'); await tick(page, 250);
  check('late fee: added', await page.evaluate(([id, k]) => RB.store.ledger(id).rows.some(r => r.category === 'late_fee' && r.period === k && !r.void), [feeId, thisMonth]));
  check('late fee: toast in words', /^Added a \$[\d,]+ late fee for .+ \(.+\)\.$/.test(((await page.textContent('.toast-msg')) || '').trim()));
  await page.click('.toast-action'); await tick(page); await closeToasts();
} else check('late fee: a late tenant with a fee suggestion exists', false);
await page.click('#rent-tab-paid'); await tick(page);
const paidId = await page.evaluate(() => document.querySelector('.rent-list > li.is-paid').dataset.row);
const pb = await month(paidId);
await page.click('#rent-row-' + paidId); await page.waitForSelector('.choices-list');
const pitems = await page.$$eval('.choices-list .row-title', els => els.map(e => e.textContent.trim()));
check('paid row tap: Copy a receipt and Remove this payment', pitems.includes('Copy a receipt') && pitems.includes('Remove this payment — it was a mistake'), pitems.join(' | '));
await page.click('#rent-c-remove'); await tick(page, 250);
check('remove: payment removed, toast uses the glossary', (await month(paidId)).balance > pb.balance && ((await page.textContent('.toast-msg')) || '').startsWith('Removed the $'));
await page.click('.toast-action'); await tick(page); await closeToasts();
check('remove: Undo puts it back', (await month(paidId)).balance === pb.balance);
await page.click('#rent-tab-owes'); await tick(page);

// --- months
const prevKey = await page.evaluate(k => RB.date.addMonthKey(k, -1), thisMonth);
await page.click('#rent-prev'); await tick(page);
check('month: earlier month shown in words with a way back', ((await page.textContent('#rent-month-name')) || '').trim() === await page.evaluate(k => RB.date.fmtMonth(k), prevKey) && ((await page.textContent('#rent-today')) || '').includes('Back to ' + monName));
await page.click('#rent-today'); await tick(page);
check('month: back to this month', ((await page.textContent('#rent-month-name')) || '').trim() === await page.evaluate(k => RB.date.fmtMonth(k), thisMonth));

// rail badge: only Today
const badge = r => page.evaluate(r => { const e = document.querySelector('#rb-nav-' + r + ' .rail-count [aria-hidden]'); return e ? e.textContent.trim() : ''; }, r);
check('badge: Today = number of things that need you', +(await badge('today')) === await page.evaluate(() => RB.store.attention().length));
check('badge: Rent has none', (await badge('rent')) === '');

// ================================================================= Today
await go('today');
check('today: one display figure (this month’s collected rent)', ((await page.textContent('#td-figure')) || '').trim() === await fmt((await page.evaluate(() => RB.store.portfolio())).collected) && await page.locator('#rb-view .t-display').count() === 1);
check('today: the owed sentence, word for word (law 7)', ((await page.textContent('#td-owed')) || '').trim() === owedSentence);
check('today: the money block opens Rent', await page.evaluate(() => document.getElementById('td-money').getAttribute('href') === '#rent'));
check('today: one filled action and two outline ones', await page.locator('#rb-view .btn-primary').count() === 1 && ((await page.textContent('#td-task-pay')) || '').trim() === 'Record a rent payment' && await page.evaluate(() => ['td-task-repair', 'td-task-tenant'].every(id => document.getElementById(id).classList.contains('btn-outline'))));
const attN = await page.evaluate(() => RB.store.attention().length);
check('today: "Needs you" shows the top 5 as rows', await page.locator('.td-rows > li').count() === Math.min(5, attN));
check('today: then "Show all N"', ((await page.textContent('#td-more')) || '').trim() === `Show all ${attN}`);
const tdOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.td-rows > li')).map(li => li.dataset.item));
check('today: same order as RB.store.attention()', JSON.stringify(tdOrder) === JSON.stringify(await page.evaluate(() => RB.store.attention().slice(0, 5).map(a => a.id))));
check('today: only rent rows carry a button, one soft "Record a payment"', await page.$$eval('.td-rows > li', lis => lis.every(li => { const b = li.querySelectorAll('button:not(.row-hit):not(.row)'); return /^(delinquent|late|partial)-/.test(li.dataset.item) ? b.length === 1 && b[0].classList.contains('btn-soft') : b.length === 0; })));
await page.click('#td-more'); await tick(page);
check('today: "Show all" expands in place, grouped by kind', await page.locator('.td-rows > li').count() === attN && await page.locator('.td-side .rows-head').count() >= 2);
await page.click('#td-more'); await tick(page);
// rent row tap → choices; pay button → payment sheet
const firstRent = await page.evaluate(() => (document.querySelector('.td-rows > li[data-item^="late-"], .td-rows > li[data-item^="delinquent-"]') || {}).dataset.item);
await page.click('#td-row-' + firstRent); await page.waitForSelector('.choices-list');
check('today: rent row tap → "They paid part of it · late fee · See their page"', (await page.$$eval('.choices-list .row-title', els => els.map(e => e.textContent.trim()))).join(' | ').startsWith('They paid part of it'));
await page.keyboard.press('Escape'); await tick(page, 250);
await page.click('#td-pay-' + firstRent); await page.waitForSelector('[data-action="save"]');
check('today: the row button opens the payment sheet', ((await page.textContent('.sheet-title')) || '').trim() === 'Record a payment');
await page.keyboard.press('Escape'); await tick(page, 250);
// guided flow
await page.click('#td-task-pay'); await page.waitForSelector('#pick-q');
check('flow: "Who paid you?" chooser opens', ((await page.textContent('.sheet-title')) || '').trim() === 'Who paid you?');
check('flow: people who owe come first, with what they owe', await page.evaluate(() => /^\$[\d,]+$/.test((document.querySelector('.pick-row .row-amt') || {}).textContent || '')));
check('flow: rows are large (≥ 56px)', await page.$$eval('.pick-row', els => els.slice(0, 5).every(e => e.getBoundingClientRect().height >= 56)));
await page.fill('#pick-q', 'okafor'); await tick(page);
check('flow: find box filters', await page.locator('.pick-row').count() === 1);
await page.click('.pick-row'); await page.waitForSelector('#pay-date');
check('flow: then the simple payment sheet (one sheet at a time)', ((await page.textContent('.sheet-wrap:not(.is-closing) .sheet-title')) || '').trim() === 'Record a payment' && ((await page.textContent('.sheet-wrap:not(.is-closing) .sheet-sub')) || '').includes('Okafor') && await page.locator('.sheet-wrap:not(.is-closing)').count() === 1);
await page.keyboard.press('Escape'); await tick(page, 250);
await page.click('#td-task-repair'); await page.waitForSelector('#pick-q');
check('flow: the repair picker shows where they live, not money (law 9)', await page.evaluate(() => { const r = document.querySelector('.pick-row'); return !r.querySelector('.row-amt') && / at /.test(r.querySelector('.row-sub').textContent) && !/\$/.test(r.textContent); }));
await page.keyboard.press('Escape'); await tick(page, 250);
// recently
await page.click('#td-recent'); await page.waitForSelector('.choices-list, .sheet .rows');
check('recent: a page-like sheet of what you did', ((await page.textContent('.sheet-title')) || '').trim() === 'What you did recently' && await page.locator('.sheet .rows .row').count() > 3);
check('recent: payments in words', await page.$$eval('.sheet .row-sub', els => els.some(e => /^Paid \$[\d,]+ by /.test(e.textContent))));
await page.locator('.sheet .rows .row').first().click(); await tick(page, 300);
check('recent: a row opens the tenant (sheet closed first)', await page.evaluate(() => /^#t-/.test(location.hash)) && await page.locator('.sheet-wrap:not(.is-closing)').count() === 0);

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
  // a .row-hit is stretched over its whole row (::after), so the row's box is its tap target
  const box = e => (e.classList.contains('row-hit') ? e.closest('.row') : e).getBoundingClientRect();
  return Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null && box(e).height < 47.5).map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)).slice(0, 8);
});
const unnamed = () => pg.evaluate(() => Array.from(document.querySelectorAll('#rb-view button, #rb-topbar button, #rb-tabbar button, #rb-tabbar a, #rb-rail button, #rb-rail a')).filter(e => e.offsetParent !== null || e.closest('#rb-rail')).filter(e => !e.textContent.trim() || !(e.innerText || e.textContent).trim()).map(e => e.id || e.className).slice(0, 8));
for (const r of ['today', 'rent']) {
  await pg.evaluate(h => { location.hash = h; }, r); await tick(pg, 150);
  const s = await small();
  check(`phone ${r}: every control ≥ 48px tall`, !s.length, s.join(', '));
  const u = await unnamed();
  check(`phone ${r}: every button has visible words`, !u.length, u.join(', '));
  check(`phone ${r}: tab labels 14px`, await pg.$$eval('#rb-tabbar .tab-label', els => els.length === 5 && els.every(e => parseFloat(getComputedStyle(e).fontSize) >= 14)));
}
const pid = await pg.evaluate(k => RB.store.tenantsList().find(t => { const lg = RB.store.ledger(t.id); const m = lg.months[k]; return m && m.open > 0 && lg.balance === m.open; }).id, thisMonth);
await pg.evaluate(h => { location.hash = h; }, 'rent'); await tick(pg, 150);
await pg.click('#rent-pay-' + pid); await pg.waitForSelector('[data-action="save"]');
await pg.click('[data-action="save"]'); await tick(pg, 250);
check('phone: two taps record a payment', await pg.evaluate(id => RB.store.ledger(id).balance === 0, pid));
check('phone: toast sits above the tab bar', await pg.evaluate(() => document.querySelector('.toast').getBoundingClientRect().bottom <= document.getElementById('rb-tabbar').getBoundingClientRect().top));
await pg.evaluate(id => { RB.actions.recordPayment(id); }, pid); await tick(pg, 300);
await pg.evaluate(() => RB.ui.toast('Copied the receipt.')); await tick(pg, 200);
check('phone: no toast over the bottom sheet or its button', await pg.evaluate(() => { const t = document.querySelector('.toast:not(.is-closing)'); if (!t) return true; const a = t.getBoundingClientRect(); return Array.from(document.querySelectorAll('.sheet-wrap:not(.is-closing) .sheet, .sheet-wrap:not(.is-closing) .btn-primary')).every(s => { const b = s.getBoundingClientRect(); return !(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top); }); }));
await pg.evaluate(() => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); }); await tick(pg, 250);
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

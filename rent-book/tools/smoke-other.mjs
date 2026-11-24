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
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (threw)', false, String(e && e.message || e).split('\n').slice(0, process.env.SMOKE_DEBUG ? 12 : 1).join(' | ')); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
const go = async h => { await page.evaluate(x => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); location.hash = x; }, h); await page.waitForTimeout(120); };
const toastUndo = async () => { await page.locator('.toast .toast-action').last().click(); await page.waitForTimeout(80); };
const settle = () => page.waitForTimeout(120);
const sheets = () => page.evaluate(() => RB.ui.layers.filter(l => l.kind === 'sheet').length);
/** v3 laws on the current screen: no buttons/links inside rows; at most one filled button (exactly one when `one`). */
const lawCheck = async (name, one) => {
  const r = await page.evaluate(() => ({
    inRow: document.querySelectorAll('#rb-view .row button, #rb-view .row a, #rb-view .row .btn').length,
    filled: Array.from(document.querySelectorAll('#rb-view .btn-primary')).filter(b => b.offsetParent).length,
  }));
  check(name + ': no buttons inside rows', r.inRow === 0, r.inRow + ' found');
  check(name + ': ' + (one ? 'exactly one' : 'at most one') + ' filled button', one ? r.filled === 1 : r.filled <= 1, r.filled + ' filled');
};
const sheetFilled = async name => { const n = await page.evaluate(() => Array.from(document.querySelectorAll('.sheet .btn-primary, .sheet .btn-danger')).filter(b => b.offsetParent).length); check(name + ': at most one filled button in the sheet', n <= 1, n + ' filled'); };
const rowOf = id => `#rb-view .row[data-tenant="${id}"]`;

await page.goto(url + '#today');
await page.waitForFunction(() => RB.store.state.ready);
await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
await page.waitForFunction(() => RB.store.tenantsList().length === 27);
const today = await page.evaluate(() => RB.store.today());

// ---------------------------------------------------------------- Leases: plain list first
const FORBIDDEN = /\b(upkeep|ticket|request|ledger|void(ed)?|delinquent|aging|cr|prorat\w*|import|backup|csv|setup|palette)\b|\b\d+ d\b|\/mo\b/i;
const forbiddenIn = text => { const m = String(text).match(FORBIDDEN); return m ? m[0] + ' … ' + String(text).slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ') : ''; };
const viewText = () => page.evaluate(() => [document.getElementById('rb-view'), ...document.querySelectorAll('.sheet')].filter(Boolean).map(e => e.innerText).join('\n'));
const audit = minH => page.evaluate(minH => {
  const roots = [document.getElementById('rb-view'), ...document.querySelectorAll('.sheet')].filter(Boolean);
  const els = roots.flatMap(r => Array.from(r.querySelectorAll('button, a[href], label.btn, select, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea'))).filter(e => e.offsetParent !== null && !e.closest('.vh'));
  const noText = els.filter(e => e.tagName === 'BUTTON' && !e.innerText.trim()).map(e => (e.className || e.tagName) + ' ' + (e.getAttribute('aria-label') || ''));
  const small = els.filter(e => { if (e.matches('.lz-name, .rp-name, .linkbtn')) return false; const r = e.getBoundingClientRect(); return r.height && r.height < minH - 0.5; }).map(e => (e.innerText || e.id || e.className).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px');
  return { noText: noText.slice(0, 5), small: small.slice(0, 6) };
}, minH);
await step('leases list', async () => {
  await go('leases');
  if (await page.locator('#lz-cal:checked').count()) { await page.click('#lz-cal'); await settle(); }
  const titles = await page.$$eval('.lz-sec .rows-head', els => els.map(e => e.textContent.replace(/\s*\d+\s*$/, '').trim()));
  check('list leads, in plain sections', titles[0] === 'Ending soon' && titles.includes('Month-to-month') && titles.includes('Moving out'), titles.join(', '));
  const rosa = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Rosa Delgado').id);
  const line = [' .row-title', ' .row-sub', ' .row-status'].map(x => '').length && await page.evaluate(sel => ['.row-title', '.row-sub', '.row-status'].map(c => document.querySelector(sel + ' ' + c).innerText.trim()).join(' / '), rowOf(rosa));
  check('ending-soon row in words', /^Rosa Delgado \/ Unit 301 at [^·]+ · ends [A-Z][a-z]+day, [A-Z][a-z]+ \d+ \/ In \d+ days$/.test(line), line);
  await lawCheck('leases', false);
  await page.click(rowOf(rosa)); await settle();
  const acts = (await page.locator('.sheet .choices-list .row-title').allTextContents()).map(s => s.trim());
  check('tap → "What would you like to do?" with the three choices', acts.slice(0, 3).join('|') === 'Renew the lease|They are moving out|Leave it month-to-month', acts.join('|'));
  await sheetFilled('lease choices');
  await page.evaluate(() => RB.ui.closeAll()); await settle();
  // Later: one control that expands in place
  const nLater = await page.evaluate(() => { const nd = RB.store.settings().leaseNoticeDays, t = RB.store.today(); return RB.store.tenantsList({ includePast: false }).filter(x => { const l = x.lease || {}; const ls = RB.model.leaseState(x, RB.store.settings(), t); return !(ls.noticeGiven || x.status === 'notice' || (l.moveOut && ls.kind !== 'upcoming')) && ls.kind !== 'mtm' && l.end && RB.date.diffDays(t, l.end) > nd; }).length; });
  check('"Later" folded into one control', (await page.textContent('#lz-later')).trim() === nLater + ' leases end later — Show them' && await page.locator('#lz-sec-later .row').count() === 0, (await page.textContent('#lz-later')).trim());
  await page.click('#lz-later'); await settle();
  check('…expands in place', await page.locator('#lz-sec-later .row').count() === nLater && (await page.getAttribute('#lz-later', 'aria-expanded')) === 'true');
  await page.click('#lz-later'); await settle();
  check('…and collapses', await page.locator('#lz-sec-later .row').count() === 0);
  check('summary sentence', /in the next \d+ days\. \d+ tenants? (is|are) month-to-month\. \d+ tenants? (is|are) moving out\./.test(await page.textContent('#lz-summary')), await page.textContent('#lz-summary'));
  const w = forbiddenIn(await viewText());
  check('leases: no forbidden words', !w, w);
  const au = await audit(40);
  check('leases: every button has words', !au.noText.length, au.noText.join(', '));
});

// ---------------------------------------------------------------- Leases: calendar behind a switch, drawn to scale
await step('leases calendar', async () => {
  await page.click('#lz-cal'); await settle();
  check('calendar has a caption', /Each bar is one lease/.test(await page.textContent('.lz-cal-cap')));
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
      out.push({ dl: Math.abs(br.left - tr.left - expL), dr: Math.abs(br.right - tr.left - expR) });
    });
    const t = document.querySelector('.lz-today'), g = document.querySelector('.lz-grid').getBoundingClientRect();
    const todayErr = Math.abs(t.getBoundingClientRect().left + 1 - g.left - D.diffDays(w0, today) / span * g.width);
    return { out, todayErr, rows: out.length, expected: RB.store.tenantsList({ includePast: false }).length };
  });
  check('calendar has one row per current tenant', geo.rows === geo.expected, geo.rows + ' vs ' + geo.expected);
  const worst = Math.max(...geo.out.map(o => Math.max(o.dl, o.dr)));
  check('bars drawn to scale (≤1.5px off)', worst <= 1.5, 'worst ' + worst.toFixed(2) + 'px');
  check('today line at today', geo.todayErr <= 1.5, geo.todayErr.toFixed(2) + 'px');
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('.lz-row .lz-bar')).map(b => b.dataset.end || '9999'));
  check('rows sorted by end date', order.every((e, i) => i === 0 || order[i - 1] <= e));
  await page.click('#lz-cal'); await settle();
});

// ---------------------------------------------------------------- Leases: renew (plain questions)
await step('renew lease', async () => {
  const id = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Rosa Delgado').id);
  const before = await page.evaluate(id => RB.store.tenant(id), id);
  await page.click(rowOf(id)); await page.waitForSelector('#lz-c-renew');
  await page.click('#lz-c-renew');
  await page.waitForSelector('#lz-renew-end');
  check('one sheet at a time (choices closed first)', await sheets() === 1);
  check('date written out beside the field', /^[A-Z][a-z]+day, [A-Z][a-z]+ \d+/.test((await page.textContent('#lz-renew-end-words')).trim()));
  check('renew asks plain questions', (await page.textContent('label[for="lz-renew-end"]')).trim() === 'New end date?' && /Is the rent changing\?/.test(await page.textContent('.sheet')));
  const defEnd = await page.inputValue('#lz-renew-end');
  check('renew defaults to +12 months', defEnd === await page.evaluate(e => RB.date.addMonths(e, 12), before.lease.end), defEnd);
  check('rent questions hidden until "Yes"', await page.isHidden('#lz-renew-rent'));
  await page.click('label[for="lz-renew-change-1"]');
  await page.fill('#lz-renew-rent', '1,800');
  await page.waitForTimeout(50);
  check('renew ends with a summary sentence', /lease will end on .* The rent goes from \$1,725 to \$1,800 a month on/.test(await page.textContent('#lz-renew-sum')), await page.textContent('#lz-renew-sum'));
  check('renew button says what happens', (await page.textContent('[data-action="save"]')).trim() === 'Renew at $1,800');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.click('[data-action="save"]');
  await settle();
  const after = await page.evaluate(id => RB.store.tenant(id), id);
  const from = await page.evaluate(e => RB.date.addDays(e, 1), before.lease.end);
  check('lease end moved', after.lease.end === defEnd);
  check('rent schedule appended', after.rent.length === before.rent.length + 1 && after.rent[after.rent.length - 1].amount === 180000 && after.rent[after.rent.length - 1].from === from);
  check('renewed lease leaves "ending soon"', await page.locator(`#lz-sec-soon [data-tenant="${id}"]`).count() === 0);
  check('toast in words with Undo', /^Renewed Rosa Delgado’s lease to/.test(await page.locator('.toast .toast-msg').last().textContent()));
  await toastUndo();
  const undone = await page.evaluate(id => RB.store.tenant(id), id);
  check('Undo renew restores end + schedule', undone.lease.end === before.lease.end && undone.rent.length === before.rent.length);
});

// ---------------------------------------------------------------- Leases: leave it month-to-month + undo; moving-out entry point
await step('month-to-month', async () => {
  const id = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Rosa Delgado').id);
  const end = await page.evaluate(id => RB.store.tenant(id).lease.end, id);
  await page.click(rowOf(id)); await page.waitForSelector('#lz-c-mtm');
  await page.click('#lz-c-mtm');
  await settle();
  check('left month-to-month', await page.evaluate(id => RB.store.tenant(id).lease.end === null, id));
  check('now listed under Month-to-month', await page.locator(`#lz-sec-mtm [data-tenant="${id}"]`).count() === 1);
  await toastUndo();
  check('Undo restores the end date', await page.evaluate(([id, end]) => RB.store.tenant(id).lease.end === end, [id, end]));
  await page.click(rowOf(id)); await page.waitForSelector('#lz-c-moveout');
  await page.click('#lz-c-moveout');
  await page.waitForSelector('#mo-date');
  check('"They are moving out" opens the move-out guide', /When are they moving out\?/.test(await page.textContent('.sheet')));
  await page.evaluate(() => RB.ui.closeAll());
  check('renewLease hook replaced', await page.evaluate(() => !/openTenant/.test(String(RB.actions.renewLease))));
});

// ---------------------------------------------------------------- Upkeep: add → schedule → done (+ charge) → undo
let tkId = null, tkTenant = null;
await step('repairs flow', async () => {
  await go('upkeep');
  if (await page.locator('#rp-tab-todo[aria-pressed="false"]').count()) await page.click('#rp-tab-todo');
  await lawCheck('repairs to do', true);
  check('the one filled button is "Log a repair"', (await page.textContent('#rb-view .btn-primary')).trim() === 'Log a repair');
  tkTenant = await page.evaluate(() => RB.store.tenantsList().find(t => t.name === 'Maya Okafor').id);
  await page.evaluate(() => { RB.actions.addTicket(); });
  await page.waitForSelector('#uk-title');
  await page.fill('#uk-title', 'Broken blind');
  check('category guessed from the title', (await page.inputValue('#uk-category')) === 'doors');
  await page.selectOption('#uk-property', 'Alder Court');
  await page.selectOption('#uk-unit', '1A');
  check('unit fills in the tenant', (await page.inputValue('#uk-tenant')) === tkTenant);
  await page.click('#uk-more summary');
  await page.click('label[for="uk-paidby-1"]');
  await sheetFilled('log a repair');
  await page.click('[data-action="save"]');
  await settle();
  tkId = await page.evaluate(() => RB.store.ticketsList().find(k => k.title === 'Broken blind').id);
  check('repair added as to do', await page.evaluate(id => RB.store.ticket(id).status === 'open', tkId));
  check('row under "Needs doing"', await page.locator(`section[aria-labelledby="uk-col-open"] [data-ticket="${tkId}"]`).count() === 1);
  // tap → choices → Book a day (one short sheet)
  await page.click(`#rb-view .row[data-ticket="${tkId}"]`);
  await page.waitForSelector('#rp-c-book');
  check('choices: Book a day · Mark it done · Change · Delete', (await page.locator('.sheet .choices-list .row-title').allTextContents()).map(x => x.trim()).join('|') === 'Book a day|Mark it done|Change|Delete');
  await page.click('#rp-c-book');
  await page.waitForSelector('#uk-in-date');
  check('Book a day: one sheet, not a sheet on a sheet', await sheets() === 1);
  const d = await page.evaluate(() => RB.date.addDays(RB.store.today(), 3));
  await page.fill('#uk-in-date', d);
  await page.press('#uk-in-date', 'Enter');
  await settle();
  check('booked with date', await page.evaluate(([id, d]) => { const k = RB.store.ticket(id); return k.status === 'scheduled' && k.scheduled === d; }, [tkId, d]));
  check('row moved to "Booked in"', await page.locator(`section[aria-labelledby="uk-col-scheduled"] [data-ticket="${tkId}"]`).count() === 1);
  // done with cost + tenant charge
  const bal0 = await page.evaluate(id => RB.store.ledger(id).balance, tkTenant);
  await page.click(`#rb-view .row[data-ticket="${tkId}"]`);
  await page.waitForSelector('#rp-c-done');
  await page.click('#rp-c-done');
  await page.waitForSelector('#uk-in-cost');
  check('Mark it done: one sheet', await sheets() === 1);
  await page.fill('#uk-in-cost', '120');
  check('offers tenant charge', (await page.textContent('#uk-in-charge-label')).includes('Add a $120 charge to Maya Okafor'));
  await page.press('#uk-in-cost', 'Enter');
  await settle();
  const k = await page.evaluate(id => RB.store.ticket(id), tkId);
  check('marked done with cost', k.status === 'done' && k.cost === 12000 && k.completed === today);
  const chg = await page.evaluate(([t, c]) => RB.store.entries(t)[c], [tkTenant, k.chargeId]);
  check('tenant-pays charge posted as damage', chg && chg.category === 'damage' && chg.amount === 12000 && chg.type === 'charge');
  check('balance went up by $120', await page.evaluate(id => RB.store.ledger(id).balance, tkTenant) === bal0 + 12000);
  await toastUndo();
  check('undo done → booked again', await page.evaluate(id => RB.store.ticket(id).status === 'scheduled', tkId));
  check('undo removed the charge', await page.evaluate(id => RB.store.ledger(id).balance, tkTenant) === bal0);
  // done via Change → the form's charge checkbox
  await page.click(`#rb-view .row[data-ticket="${tkId}"]`);
  await page.waitForSelector('#rp-c-change');
  await page.click('#rp-c-change');
  await page.waitForSelector('#uk-title');
  check('Change: the place is shown once', /For Unit 1A at Alder Court — Change/.test((await page.textContent('#uk-for')).replace(/\s+/g, ' ')));
  await page.click('label[for="uk-status-2"]');
  await page.fill('#uk-cost', '99');
  await page.waitForTimeout(50);
  check('form offers charge checkbox', await page.locator('#uk-charge').isChecked());
  await page.click('[data-action="save"]');
  await settle();
  check('form: done + $99 charge', await page.evaluate(([id, t]) => { const k = RB.store.ticket(id); const e = k.chargeId && RB.store.entries(t)[k.chargeId]; return k.status === 'done' && e && e.amount === 9900; }, [tkId, tkTenant]));
  const count = await page.textContent('#uk-count');
  check('count sentence', /\d+ repairs? to do.*waited \d+ days?/.test(count), count);
  check('saved with category + tenant', await page.evaluate(id => { const k = RB.store.ticket(id); return k.category === 'doors' && k.property === 'Alder Court' && k.unit === '1A' && k.scope === 'unit'; }, tkId));
  // delete + undo from the choices
  await page.click(`#rb-view .row[data-ticket="${tkId}"]`); await page.waitForSelector('#rp-c-delete');
  await page.click('#rp-c-delete'); await settle();
  check('Delete removes it', await page.evaluate(id => !RB.store.ticket(id), tkId));
  await toastUndo();
  check('Undo puts it back', await page.evaluate(id => !!RB.store.ticket(id), tkId));
  // property select (not chips)
  await page.selectOption('#uk-prop', 'Fenwick Row');
  await settle();
  check('property select', await page.evaluate(() => Array.from(document.querySelectorAll('#rb-view .row[data-ticket]')).every(c => RB.store.ticket(c.dataset.ticket).property === 'Fenwick Row')));
  await page.selectOption('#uk-prop', ''); await settle();
  check('hooks replaced', await page.evaluate(() => !/emit/.test(String(RB.actions.addTicket)) && !/emit/.test(String(RB.actions.openTicket))));
});

// ---------------------------------------------------------------- Reports
await step('reports', async () => {
  await go('reports');
  const fmt = (c) => page.evaluate(c => RB.money.fmt(c), c);
  const choices = (await page.locator('.rp-choice .row-title').allTextContents()).join('|');
  check('four worded choices as rows', choices === 'Rent roll|Who owes, and for how long|Money collected each month|Income for the year', choices);
  check('each choice explains itself', await page.locator('.rp-choice .row-sub').count() === 4 && (await page.textContent('#rp-tab-roll')).includes('Every unit, tenant and rent on one page'));
  await page.click('#rp-tab-roll'); await settle();
  const rr = await page.evaluate(() => RB.store.rentRoll().totals);
  const roll = await page.evaluate(() => ['rent', 'deposit'].map(k => document.querySelector(`#rp-roll [data-total="${k}"]`).textContent.trim()));
  check('rent roll totals match model', roll[0] === await fmt(rr.rent) && roll[1] === await fmt(rr.deposit), roll.join(' '));
  check('rent roll grouped with subtotals', await page.locator('#rp-roll .rp-subtotal').count() === 3);
  check('rent roll opens with the answer', /\d+ of \d+ units have a tenant/.test(await page.textContent('#rp-meta')), await page.textContent('#rp-meta'));
  // law 7: one number — the sentence, the total row and RB.model.owed() agree; money paid ahead is never netted
  const one = await page.evaluate(() => {
    const o = RB.ui.owed(), rows = RB.store.rentRoll().rows;
    const pos = rows.reduce((s, r) => s + Math.max(0, r.balance), 0), ahead = rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);
    return { total: RB.money.fmt(o.total), pos: RB.money.fmt(pos), ahead: RB.money.fmt(ahead), nAhead: rows.filter(r => r.balance < 0).length, sentence: RB.ui.owedSentence(),
      said: document.getElementById('rp-owed').textContent.trim(), row: document.querySelector('#rp-roll [data-total="owed"]').textContent.trim(),
      rowAhead: (document.querySelector('#rp-roll [data-total="ahead"]') || { textContent: '' }).textContent.trim(),
      phone: document.querySelector('#rp-roll-total [data-total="owed"]').textContent.trim() };
  });
  check('rent roll: sentence = total row = RB.model.owed().total', one.total === one.pos && one.row === one.total && one.phone === one.total && one.said.startsWith(one.sentence) && one.sentence.includes(one.total), JSON.stringify(one));
  check('rent roll: paid-ahead stated separately, the same in sentence and total row', !one.nAhead || (one.said.includes(' paid ' + one.ahead + ' ahead.') && one.rowAhead.startsWith(one.ahead)), JSON.stringify(one));
  check('rent roll: one display figure', await page.locator('#rb-view .t-display').count() === 1);
  await lawCheck('rent roll', false);
  check('rent roll: part paid in words', /Part paid — rest is \d+ days late/.test(await page.textContent('#rp-roll')));
  check('download explained in a line', /saves this table as a file that opens in Excel/.test(await page.textContent('.rp-actions-note')));
  await page.click('#rp-csv');
  await page.waitForSelector('#rb-showtext');
  const csvRoll = await page.inputValue('#rb-showtext');
  check('Download for Excel: plain column headings', csvRoll.startsWith('Property,Unit,Tenant,Status,Rent each month,Lease started,Lease ends,Deposit,Owes,Paid ahead,This month'), csvRoll.split('\n')[0]);
  await page.keyboard.press('Escape'); await settle();

  await page.click('#rp-tab-aging'); await settle();
  const ag = await page.evaluate(() => RB.store.aging());
  const agT = await page.evaluate(() => ['d0_30', 'd31_60', 'd61_90', 'd90', 'total'].map(k => document.querySelector(`#rp-aging [data-total="${k}"]`).textContent.trim()));
  const agE = []; for (const k of ['d0_30', 'd31_60', 'd61_90', 'd90', 'total']) agE.push(await fmt(ag.totals[k]));
  check('who-owes totals match model', agT.join() === agE.join(), agT.join(' '));
  check('who-owes rows = owing tenants', await page.locator('#rp-aging tbody tr').count() === ag.rows.length);
  check('who-owes columns in plain words', (await page.locator('#rp-aging thead th').allTextContents()).join('|') === 'Tenant|Under a month|1 to 2 months|2 to 3 months|Over 3 months|Total owed');
  const meta = (await page.textContent('#rp-meta')).replace(/\s+/g, ' ');
  check('who-owes answer sentences', meta.includes(await page.evaluate(() => RB.ui.owedSentence())) && /Tomasz Wolski owes the most: \$3,300, going back to September\./.test(meta), meta);
  check('who-owes total = RB.model.owed().total', agT[4] === await page.evaluate(() => RB.money.fmt(RB.ui.owed().total)), agT[4]);
  await lawCheck('who owes', false);
  await page.click('#rp-csv');
  await page.waitForSelector('#rb-showtext');
  check('who-owes download headings', (await page.inputValue('#rb-showtext')).startsWith('Tenant,Property,Unit,Under a month,1 to 2 months,2 to 3 months,Over 3 months,Total owed'));
  await page.keyboard.press('Escape'); await settle();

  await page.click('#rp-tab-collection'); await settle();
  const col = await page.evaluate(() => RB.store.collectionByMonth(12));
  const sumC = col.reduce((s, r) => s + r.charged, 0), sumP = col.reduce((s, r) => s + r.collected, 0);
  check('collection totals match model', (await page.textContent('#rp-collection [data-total="charged"]')).trim() === await fmt(sumC) && (await page.textContent('#rp-collection [data-total="collected"]')).trim() === await fmt(sumP));
  await lawCheck('collection', false);
  check('collection answer sentence', /Over the last 12 months you collected \$[\d,.]+ of the \$[\d,.]+ charged — \d+%\./.test(await page.textContent('#rp-meta')));
  check('chart has a caption', /how much of that month’s rent came in/.test(await page.textContent('.rp-legend')));
  const chart = await page.evaluate(() => {
    const plot = document.querySelector('.rp-chart-plot'); const max = +plot.dataset.axisMax; const H = plot.getBoundingClientRect().height;
    return Array.from(document.querySelectorAll('.rp-charged, .rp-collected')).map(b => Math.abs(b.getBoundingClientRect().height - (+b.dataset.v / max) * H));
  });
  check('chart bars to scale (≤1px)', chart.length === 24 && Math.max(...chart) <= 1, Math.max(...chart).toFixed(2));

  await page.click('#rp-tab-income'); await settle();
  const yr = +today.slice(0, 4);
  const inc = await page.evaluate(y => RB.store.incomeByYear(y).totals, yr);
  check('income total matches model', (await page.textContent('#rp-income [data-total="payments"]')).trim() === await fmt(inc.payments));
  check('year buttons are worded', (await page.textContent('#rp-year-prev')).trim() === 'Previous year' && (await page.textContent('#rp-year-next')).trim() === 'Next year');
  await page.click('#rp-year-prev'); await settle();
  check('Previous year', (await page.textContent('#rp-year-label')).trim() === String(yr - 1));
  await page.click('#rp-year-next'); await settle();
  await page.click('#rp-copy');
  await page.waitForTimeout(150);
  check('Copy gives feedback', await page.locator('.toast, #rb-showtext').count() >= 1);
  await page.evaluate(() => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); });
  for (const t of ['roll', 'aging', 'collection', 'income']) {
    await page.click('#rp-tab-' + t); await settle();
    const w = forbiddenIn(await viewText());
    check('reports ' + t + ': no forbidden words', !w, w);
    const au = await audit(40);
    check('reports ' + t + ': every button has words', !au.noText.length, au.noText.join(', '));
  }
});

// ---------------------------------------------------------------- Settings: sentences that save on change, drafts survive
await step('settings', async () => {
  await go('setup');
  check('Text size is at the very top', await page.evaluate(() => { const s = document.querySelector('.st-sec'); return s && s.id === 'st-sec-text' && !!s.querySelector('[data-textsize]'); }));
  check('rules read as sentences', /Give tenants\s+days before it counts as late\./.test((await page.textContent('[data-row="graceDays"] .st-sentence-text')).replace(/Saved/, '')) && /Rent is due on the/.test(await page.textContent('[data-row="dueDay"]')));
  await lawCheck('settings', false);
  check('three rows open their own flows', (await page.locator('#st-copies .row-title').allTextContents()).join('|') === 'Bring in my tenants|Save a copy|Restore from a copy' && await page.locator('#st-import-text').count() === 0);
  await page.fill('#st-graceDays', '7');
  await page.press('#st-graceDays', 'Tab');
  await settle();
  check('grace days saved', await page.evaluate(() => RB.store.settings().graceDays === 7));
  check('clear "Saved"', await page.locator('#st-saved-graceDays.is-on').count() === 1 && (await page.textContent('#st-saved-graceDays')).trim() === 'Saved');
  check('rules paragraph updates', (await page.textContent('#st-rule-sentence')).includes('It counts as late after the 8th. Then a $50 late fee is suggested'), await page.textContent('#st-rule-sentence'));
  await page.fill('#st-graceDays', '99'); await page.press('#st-graceDays', 'Tab'); await settle();
  check('bad value explained', await page.evaluate(() => RB.store.settings().graceDays === 7) && /Use a number from 0 to 27/.test(await page.textContent('[data-row="graceDays"] .field-error')));
  await page.fill('#st-graceDays', '7'); await page.press('#st-graceDays', 'Tab'); await settle();
  await page.click('label[for="st-lf-2"]'); await settle();
  check('late fee rule switched to percent', await page.evaluate(() => { const l = RB.store.settings().lateFee; return l.type === 'percent' && l.amount === 5; }));
  check('late fee sentence', /Suggest a late fee of\s+percent of that month’s rent\./.test((await page.textContent('[data-row="lateFeeAmount"] .st-sentence-text')).replace(/Saved/, '')));
  await page.fill('#st-portfolioName', 'Harbour Lane Homes'); await page.press('#st-portfolioName', 'Tab'); await settle();
  await page.click('#st-methods-change'); await page.waitForSelector('#st-method-new');
  await page.fill('#st-method-new', 'PayPal'); await page.press('#st-method-new', 'Enter'); await settle();
  check('payment way added', await page.evaluate(() => RB.store.settings().methods.includes('PayPal')) && /PayPal/.test(await page.textContent('#st-methods')));
  check('ways have worded Remove links', (await page.locator('#st-methods [data-rm]').first().textContent()).trim() === 'Remove');
  await page.click('.sheet [data-close]:not(.sheet-close)'); await settle();
  check('compact list on the page', /PayPal/.test(await page.textContent('#st-methods-list')));
  await page.focus('#st-leaseNoticeDays'); await page.fill('#st-leaseNoticeDays', '9');
  await page.evaluate(() => RB.store.addLog(RB.store.tenantsList()[0].id, { text: 'store change' }));
  await page.waitForTimeout(120);
  check('half-typed field survives a store change', await page.inputValue('#st-leaseNoticeDays') === '9' && await page.evaluate(() => document.activeElement.id === 'st-leaseNoticeDays'));
  await page.fill('#st-leaseNoticeDays', '60'); await page.press('#st-leaseNoticeDays', 'Tab'); await settle();
  check('keyboard shortcuts tucked at the bottom', await page.evaluate(() => { const s = Array.from(document.querySelectorAll('.st-sec')); return s[s.length - 1].id === 'st-sec-keys'; }));
  check('who can see this', /Who can see this\?/.test(await page.textContent('#st-sec-about')));
  const w = forbiddenIn(await viewText());
  check('settings: no forbidden words', !w, w);
  const au = await audit(40);
  check('settings: every button has words', !au.noText.length, au.noText.join(', '));
  await page.reload();
  await page.waitForFunction(() => RB.store.state.ready);
  check('settings persist across reload', await page.evaluate(() => { const s = RB.store.settings(); return s.graceDays === 7 && s.lateFee.type === 'percent' && s.portfolioName === 'Harbour Lane Homes' && s.methods.includes('PayPal'); }));
});

// ---------------------------------------------------------------- Settings: bring in my tenants (3 steps, one bad row)
await step('import', async () => {
  await go('setup');
  await page.click('#st-import-open'); await page.waitForSelector('#st-import-text');
  const stepTxt = () => page.evaluate(() => document.querySelector('.sheet .steps-count').textContent.trim() + ' ' + document.querySelector('.sheet .steps-title').textContent.trim());
  check('its own guided flow, step 1 in plain words', /^Step 1 of 3 Paste your list or choose a file$/.test(await stepTxt()) && /Download an example for Excel/.test(await page.textContent('.sheet')) && await page.locator('.st-eg table').count() === 1, await stepTxt());
  await page.click('[data-action="next"]'); await settle();
  check('Next waits for a list', /^Step 1 of 3/.test(await stepTxt()) && /Paste your list first/.test(await page.textContent('[data-field="list"] .field-error')));
  const paste = ['Tenant\tApt\tBuilding\tMonthly rent\tLease start\tLease end\tDeposit\tBalance owed',
    'Anna Berg\t4A\tElm House\t1200\t1/15/2026\t1/14/2027\t1200\t0',
    'Bo Chen\t4B\tElm House\t$1,350.00\t2026-02-01\t2027-01-31\t1350\t150',
    '\t4C\tElm House\t1100\tJan 15 2026\t\t\t',
    'Dara Ito\t4D\tElm House\t1,025\tMar 3 2026\t\t\t',
    'Eli Ford\t5A\tElm House\t1500\t2026-03-01\t\t\t-50'].join('\n');
  await page.fill('#st-import-text', paste);
  await page.waitForTimeout(150);
  check('rows counted while pasting', (await page.textContent('#st-imp-count')).trim() === 'We found 5 tenant rows.');
  await page.evaluate(() => RB.store.addLog(RB.store.tenantsList()[0].id, { text: 'store change 2' }));
  await page.waitForTimeout(150);
  check('pasted list survives a store change', (await page.inputValue('#st-import-text')) === paste);
  await page.click('[data-action="next"]'); await settle();
  check('step 2: check the columns', /^Step 2 of 3 Check we understood your columns$/.test(await stepTxt()));
  check('columns matched by heading', await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7].map(i => document.getElementById('st-map-' + i).value).join() === 'name,unit,property,rent,start,end,deposit,balance'));
  check('each column shows examples', /For example: Anna Berg, Bo Chen/.test(await page.textContent('.st-cols')));
  await page.selectOption('#st-map-0', ''); await settle();
  check('missing name explained', /which column holds the name/.test(await page.textContent('[data-field="cols"] .field-error')));
  await page.click('[data-action="next"]'); await settle();
  check('…and Next stays on step 2', /^Step 2 of 3/.test(await stepTxt()));
  await page.selectOption('#st-map-0', 'name'); await settle();
  await page.click('[data-action="next"]'); await settle();
  const s3 = (await page.textContent('.sheet .sheet-body')).replace(/\s+/g, ' ');
  check('the check-and-save screen is counted: "Step 3 of 3"', /^Step 3 of 3/.test(await stepTxt()), await stepTxt());
  check('look it over, problem in plain words', /4 tenants are ready to bring in\./.test(s3) && /1 row has a problem and will be left out\./.test(s3) && /Row 3 \(4C\): There is no name\./.test(s3) && /change it in your spreadsheet and paste the list again/.test(s3), s3.slice(0, 300));
  check('button counts good rows', (await page.textContent('[data-action="next"]')).trim() === 'Bring in 4 tenants');
  await sheetFilled('import guide');
  await page.click('[data-action="back"]'); await settle();
  await page.click('[data-action="back"]'); await settle();
  check('Back keeps the pasted list', (await page.inputValue('#st-import-text')) === paste);
  await page.click('[data-action="next"]'); await settle();
  await page.click('[data-action="next"]'); await settle();
  if (await page.locator('#st-import-rmsample').count()) await page.uncheck('#st-import-rmsample');
  const n0 = await page.evaluate(() => RB.store.tenantsList().length);
  await page.click('[data-action="next"]');
  await page.waitForTimeout(400);
  check('the guide closed', await sheets() === 0);
  const res = await page.evaluate(() => { const l = RB.store.tenantsList(); const b = l.find(t => t.name === 'Bo Chen'); const e = l.find(t => t.name === 'Eli Ford'); return { n: l.length, b, e, lb: RB.store.ledger(b.id) }; });
  check('brought in 4 tenants', res.n === n0 + 4);
  const first = today.slice(0, 8) + '01';
  check('rent counted from the 1st, what they owed carried in', res.b.trackFrom === first && res.b.opening.amount === 15000 && res.e.opening.amount === -5000);
  check('dates + money understood', res.b.lease.start === '2026-02-01' && res.b.lease.end === '2027-01-31' && res.b.rent[0].amount === 135000 && res.b.deposit.amount === 135000);
  check('payment history starts cleanly', res.lb.rows.filter(r => r.kind === 'rent').length === 1 && res.lb.balance === 15000 + 135000);
  check('done note in words', /Brought in 4 tenants\. 1 row with a problem was left out\./.test((await page.textContent('.st-done')).replace(/\s+/g, ' ')));
  check('toast in words', /^Brought in 4 tenants\./.test(await page.locator('.toast .toast-msg').last().textContent()));
});

// ---------------------------------------------------------------- Save a copy → wipe → restore from a copy
await step('backup round trip', async () => {
  await go('setup');
  check('copy rows in words', (await page.textContent('#st-backup .row-title')).trim() === 'Save a copy' && (await page.textContent('#st-restore-open .row-title')).trim() === 'Restore from a copy');
  const snap = await page.evaluate(() => ({ n: RB.store.tenantsList().length, k: RB.store.ticketsList().length, bal: RB.store.tenantsList().map(t => RB.store.ledger(t.id).balance).join() }));
  await page.click('#st-backup');
  await page.waitForSelector('#rb-showtext');
  const json = await page.inputValue('#rb-showtext');
  check('the copy has everything', JSON.parse(json).format === 'rent-book-backup');
  await page.keyboard.press('Escape'); await settle();
  await page.evaluate(() => RB.store._resetLocal());
  await page.waitForTimeout(100);
  check('wiped', await page.evaluate(() => RB.store.tenantsList().length === 0));
  await go('setup');
  await page.click('#st-restore-open'); await page.waitForSelector('#st-restore-file', { state: 'attached' });
  check('restore has its own short flow; Replace hidden until a copy is chosen', await page.locator('.sheet [data-action="go"]').isHidden());
  await page.setInputFiles('#st-restore-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.waitForSelector('#st-restore-summary');
  check('restore explains what is in the copy and the consequence', (await page.textContent('#st-restore-summary')).includes(snap.n + ' tenants') && /everything in this rent book now is replaced/.test(await page.textContent('#st-restore-summary')));
  await sheetFilled('restore');
  await page.click('.sheet [data-action="go"]');
  await page.waitForSelector('[data-action="confirm"]');
  await page.waitForTimeout(250);
  check('the confirm is not a sheet on a sheet', await sheets() === 1);
  check('confirm says it replaces everything', /replace/i.test(await page.textContent('.sheet-body')));
  await page.click('[data-action="confirm"]');
  await page.waitForTimeout(300);
  check('restore round trip', await page.evaluate(s => RB.store.tenantsList().length === s.n && RB.store.ticketsList().length === s.k && RB.store.tenantsList().map(t => RB.store.ledger(t.id).balance).join() === s.bal, snap));
  await go('setup');
  await page.click('#st-restore-open'); await page.waitForSelector('#st-restore-file', { state: 'attached' });
  await page.setInputFiles('#st-restore-file', { name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.waitForSelector('.st-restore.is-bad');
  check('a file that is not a copy is refused in words', (await page.textContent('.st-restore.is-bad')).includes('isn’t a copy saved from Rent Book') && await page.locator('.sheet [data-action="go"]').isHidden());
  await page.evaluate(() => RB.ui.closeAll()); await settle();
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
  await go('leases'); await page.click('#lz-cal'); await settle(); await page.click('#lz-cal'); await settle();
  await go('reports');
  for (const t of ['roll', 'aging', 'collection', 'income']) { await page.click('#rp-tab-' + t); await settle(); }
  await go('setup');
  await page.click('#st-import-open'); await page.waitForSelector('#st-import-text');
  await page.fill('#st-import-text', 'Name,Unit,Rent\n' + '"' + evil.replace(/"/g, '""') + '",1,abc');
  await page.waitForTimeout(150);
  await page.click('[data-action="next"]'); await settle(); await page.click('[data-action="next"]'); await settle();
  check('hostile strings stay escaped in the import guide', await page.evaluate(() => !window.__x && !document.querySelector('#rb-layer img, #rb-layer b')));
  await page.evaluate(() => RB.ui.closeAll()); await settle();
  await page.evaluate(() => { RB.actions.openTicket('evilk'); }); await settle();
  await page.evaluate(() => { RB.ui.closeAll(); RB.actions.renewLease('evil1'); }); await settle();
  check('hostile strings stay escaped', await page.evaluate(() => !window.__x && !document.querySelector('#rb-view img, #rb-view b, #rb-layer img, #rb-layer b')));
  await page.evaluate(() => RB.ui.closeAll());
});

// ---------------------------------------------------------------- Phone width: no horizontal overflow
await step('phone overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bad = [];
  const probe = async name => { await page.waitForTimeout(150); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 0) bad.push(name + ' +' + o + 'px'); };
  await go('leases'); await probe('leases');
  await go('upkeep'); await probe('upkeep');
  await lawCheck('phone: repairs', true);
  await go('reports');
  for (const t of ['roll', 'aging', 'collection', 'income']) { await page.click('#rp-tab-' + t); await probe('reports ' + t); await lawCheck('phone: report ' + t, false); }
  // rent roll on phone: two-line rows, property groups that expand and collapse in place; total line agrees
  await page.click('#rp-tab-roll'); await settle();
  const grp = await page.evaluate(() => RB.store.rentRoll().rows.filter(r => r.property === 'Alder Court').length);
  await page.click('#rp-roll-rows [data-act="group"][data-group="Alder Court"]'); await settle();
  check('phone roll: a property group expands in place', await page.locator('#rp-roll-rows .rp-group[data-group="Alder Court"] .rows .row').count() === grp);
  await page.click('#rp-roll-rows .rp-group [data-act="group"][data-group="Alder Court"]'); await settle();
  check('…and collapses', await page.locator('#rp-roll-rows .rp-group').count() === 0);
  await page.click('#rp-roll-all'); await settle();
  check('"Show every unit" opens them all', await page.locator('#rp-roll-rows .rp-group .rows .row').count() === await page.evaluate(() => RB.store.rentRoll().rows.length));
  await page.click('#rp-roll-all'); await settle();
  check('phone roll total = RB.model.owed().total', (await page.textContent('#rp-roll-total [data-total="owed"]')).trim() === await page.evaluate(() => RB.money.fmt(RB.ui.owed().total)));
  await go('setup');
  await page.click('#st-import-open'); await page.waitForSelector('#st-import-text');
  await page.fill('#st-import-text', 'Name\tUnit\tProperty\tRent\tLease start\tLease end\tDeposit\tBalance\nA very long tenant name indeed\t4A\tA very long property name here\t1200\t1/15/2026\t1/14/2027\t1200\t0');
  await page.waitForTimeout(300);
  const sheetOver = async name => { await page.waitForTimeout(150); const o = await page.evaluate(() => { const s = document.querySelector('.sheet'); return s ? s.scrollWidth - s.clientWidth : 0; }); if (o > 0) bad.push(name + ' sheet +' + o + 'px'); };
  await sheetOver('import step 1');
  await page.click('[data-action="next"]'); await sheetOver('import step 2');
  await page.click('[data-action="next"]'); await sheetOver('import step 3');
  await page.evaluate(() => RB.ui.closeAll()); await settle();
  check('no horizontal page overflow at 390px', !bad.length, bad.join(', '));
  // Extra large text: Leases, Reports, Settings — no sideways scroll, every tappable thing ≥ 48px, words on buttons
  await page.evaluate(() => RB.textSize && RB.textSize.set('xl'));
  const badXL = [], smallXL = [], wordless = [];
  const probeXL = async name => {
    await page.waitForTimeout(150);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 0) badXL.push(name + ' +' + o + 'px');
    const au = await audit(48); if (au.small.length) smallXL.push(name + ': ' + au.small.join(', ')); if (au.noText.length) wordless.push(name + ': ' + au.noText.join(', '));
  };
  await go('leases'); await probeXL('leases');
  await page.click('#lz-sec-soon .row'); await page.waitForSelector('#lz-c-renew'); await page.click('#lz-c-renew'); await page.waitForSelector('#lz-renew-end'); await probeXL('renew sheet'); await page.evaluate(() => RB.ui.closeAll());
  await go('reports');
  for (const t of ['roll', 'aging', 'collection', 'income']) { await page.click('#rp-tab-' + t); await probeXL('reports ' + t); }
  await go('setup'); await probeXL('settings');
  check('phone XL: no horizontal overflow (Leases, Reports, Settings)', !badXL.length, badXL.join(', '));
  check('phone XL: tappable things ≥ 48px', !smallXL.length, smallXL.join(' | '));
  check('phone XL: every button has words', !wordless.length, wordless.join(' | '));
  await page.evaluate(() => RB.textSize && RB.textSize.set('normal'));
  await page.setViewportSize({ width: 1360, height: 900 });
});

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

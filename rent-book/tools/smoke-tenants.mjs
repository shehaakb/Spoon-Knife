#!/usr/bin/env node
// Interaction smoke test for the Tenants list + tenant page + tenant sheets (local mode). v3 (SPEC §10): canonical rows,
// one filled button per screen, payment history by month, truthful step counts. Words: SPEC §8.
// Usage: node tools/smoke-tenants.mjs   (run build.mjs first)
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(ROOT, 'dist', 'preview.html')).href;

const errors = [];
const results = [];
const check = (name, ok, extra) => { const line = (ok ? 'ok   ' : 'FAIL ') + name + (extra && !ok ? ' — ' + extra : ''); results.push(line); if (process.env.VERBOSE) console.log(line); if (!ok) process.exitCode = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
// Toasts can sit near a sheet's buttons for 10 s; clear them before pressing sheet buttons.
const clearToasts = pg => pg.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
// SPEC §8 rule 4: words that must not appear in what a person reads.
const FORBIDDEN = /\b(upkeep|ticket|request|ledger|void(ed)?|delinquent|aging|cr|prorat\w*|import|backup|csv|setup|palette)\b|\b\d+ d\b|\/mo\b/i;
const forbiddenIn = text => { const m = String(text).match(FORBIDDEN); return m ? m[0] + ' … ' + String(text).slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ') : ''; };

const browser = await chromium.launch();
async function open(viewport, hash, textSize) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + '#today');
  await page.waitForFunction(() => RB.store.state.ready);
  await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
  await page.waitForFunction(() => RB.store.tenantsList().length === 27);
  if (textSize) await page.evaluate(v => RB.textSize && RB.textSize.set(v), textSize);
  if (hash) { await page.evaluate(h => { location.hash = h; }, hash); await wait(150); }
  return { ctx, page };
}
/** Visible text of the view + open layers, minus the shared chrome. */
const readText = page => page.evaluate(() => [document.getElementById('rb-view'), ...document.querySelectorAll('.drawer, .sheet')].filter(Boolean).map(e => e.innerText).join('\n'));
/** Buttons without visible words, and tappable things under the minimum height. */
const auditControls = (page, minH) => page.evaluate(minH => {
  const roots = [document.getElementById('rb-view'), ...document.querySelectorAll('.drawer, .sheet')].filter(Boolean);
  const els = roots.flatMap(r => Array.from(r.querySelectorAll('button, a[href], [role="tab"], label.btn, label.choice, .row'))).filter(e => e.offsetParent !== null && !e.closest('.vh'));
  const noText = els.filter(e => e.tagName === 'BUTTON' && !e.innerText.trim()).map(e => (e.className || e.tagName) + ' ' + (e.getAttribute('aria-label') || ''));
  const small = els.filter(e => { if (e.closest('.toast, .pstrip')) return false; if (e.matches('.lz-name, .rp-name, .tn-link')) return false; const r = e.getBoundingClientRect(); return r.height && r.height < minH - 0.5; }).map(e => (e.innerText || e.className).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px');
  return { noText: noText.slice(0, 5), small: small.slice(0, 6) };
}, minH);
/** Visible filled buttons inside a root (law 1). */
const filled = (page, sel) => page.evaluate(sel => Array.from(document.querySelectorAll(sel + ' .btn-primary')).filter(b => b.offsetParent !== null).map(b => b.innerText.trim()), sel);
/** Buttons (or links styled as buttons) inside any tenant row (law 2). */
const buttonsInRows = (page, sel) => page.evaluate(sel => Array.from(document.querySelectorAll(sel + ' .row')).reduce((n, r) => n + r.querySelectorAll('button, .btn, a').length, 0), sel);
/** Payment-history headings checked against RB.store.ledger: each month's due / paid / still owed. */
const historyCheck = (page, id) => page.evaluate(id => {
  const lg = RB.store.ledger(id);
  const $ = c => RB.money.fmt(c);
  const bad = [];
  const heads = Array.from(document.querySelectorAll('.drawer .tn-month'));
  heads.forEach(hd => {
    const key = hd.dataset.month;
    const rows = lg.rows.filter(r => RB.date.monthKey(r.date) === key);
    const live = rows.filter(r => !r.void);
    const due = live.filter(r => r.type === 'charge').reduce((s, r) => s + r.amount, 0);
    const paid = live.filter(r => r.type !== 'charge').reduce((s, r) => s + r.amount, 0);
    const owed = live.filter(r => r.type === 'charge').reduce((s, r) => s + r.open, 0);
    const text = hd.textContent.trim();
    if (!text.startsWith(RB.date.fmtMonth(key) + ' — ')) bad.push(key + ': heading ' + text);
    if (due > 0 && !text.includes($(due) + ' due')) bad.push(key + ': due ' + $(due) + ' not in ' + text);
    if (paid > 0 && !text.includes($(paid) + ' paid')) bad.push(key + ': paid ' + $(paid) + ' not in ' + text);
    if (due > 0 && owed === 0 && !text.endsWith('paid in full')) bad.push(key + ': should be paid in full: ' + text);
    if (owed > 0 && !(text.includes($(owed) + ' still owed') || (paid === 0 && owed === due && text.endsWith('not paid yet')))) bad.push(key + ': owed ' + $(owed) + ' not in ' + text);
    // that month's lines, in the order they happened
    const ul = hd.nextElementSibling;
    const shown = Array.from(ul.querySelectorAll('[data-row]')).map(e => e.dataset.row);
    const expect = rows.map(r => r.id);
    if (shown.join(',') !== expect.join(',')) bad.push(key + ': lines ' + shown.join(',') + ' ≠ ' + expect.join(','));
  });
  const keys = heads.map(h => h.dataset.month);
  if (keys.slice().sort().reverse().join() !== keys.join()) bad.push('months not newest first');
  return { n: heads.length, bad };
}, id);

try {
  const { ctx, page } = await open({ width: 1360, height: 900 }, 'tenants');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const today = await ev(() => RB.store.today());
  const monthStart = today.slice(0, 7) + '-01';
  const rows = () => page.locator('.tn-list .row[data-id]');

  // ---- list basics
  check('list shows a row per current tenant', await rows().count() === 26);
  check('find box comes first (nothing above it in the view)', await ev(() => { const v = document.getElementById('rb-view'); const f = document.getElementById('tn-q'); return f.getBoundingClientRect().top - v.getBoundingClientRect().top < 48; }));
  check('find box is labelled in words', (await page.textContent('label[for="tn-q"]')).trim() === 'Find a tenant by name or unit');
  check('one-row segment with counts', (await page.locator('#tn-seg button').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim()).join('|') === 'Everyone 26|Owes money 6|Moved out 1' && await ev(() => { const b = Array.from(document.querySelectorAll('#tn-seg button')).map(x => x.getBoundingClientRect().top); return b.every(t => Math.abs(t - b[0]) < 2); }));
  const owedText = (await page.textContent('#tn-owed')).trim();
  check('owed sentence in words (law 7)', /^6 tenants owe \$[\d,]+ in total — \$[\d,]+ of it is [A-Z][a-z]+[’']s rent\.$/.test(owedText), owedText);
  check('owed sentence from the shared helper when it exists', await ev(t => !(RB.ui.owedSentence && RB.model.owed && RB.model.owedSentence) || RB.ui.owedSentence() === t, owedText));
  check('exactly one filled button on the list: Add a tenant', (await filled(page, '#rb-view')).join('|') === 'Add a tenant', (await filled(page, '#rb-view')).join('|'));
  check('no button inside any tenant row', await buttonsInRows(page, '#rb-view') === 0);
  check('rows carry no Open, no lease text, end in a chevron', await ev(() => Array.from(document.querySelectorAll('.tn-list .row')).every(r => !/\bOpen\b|Lease ends/.test(r.innerText) && r.querySelector('.row-chev') && r.getBoundingClientRect().height >= 52)));
  check('no banner, no sort or group controls', await page.locator('.tn-ending, #tn-group, .tn-sortseg').count() === 0);
  const heads = (await page.locator('.tn-list .rows-head').allTextContents()).map(s => s.replace(/\s+\d+$/, '').trim());
  check('groups: Needs attention first, then each property', heads.join('|') === 'Needs attention|418 Marlow Street|Alder Court|Fenwick Row', heads.join('|'));
  const attn = await ev(() => Array.from(document.querySelectorAll('.tn-list .rows-head[data-group="attention"] + .rows .row')).map(r => r.dataset.id));
  check('Needs attention = everyone who owes, in the shared order', await ev(ids => {
    const owing = RB.store.tenantsList({ includePast: false }).filter(t => RB.store.ledger(t.id).balance > 0).map(t => t.id);
    if (ids.length !== owing.length || !ids.every(i => owing.includes(i))) return false;
    if (RB.model.attentionOrder) { const ord = RB.model.attentionOrder(RB.store.state, RB.store.today(), id => RB.store.ledger(id)).map(x => (typeof x === 'string' ? x : x.tenantId || x.id)).filter(i => ids.includes(i)); return ord.join() === ids.join(); }
    const u = ids.map(i => RB.store.summary(i).urgency); return u.every((x, i) => i === 0 || u[i - 1] <= x);
  }, attn), attn.join(','));
  check('property groups alphabetical by unit', await ev(() => Array.from(document.querySelectorAll('.tn-list .rows-head[data-group^="p-"]')).every(hd => { const u = Array.from(hd.nextElementSibling.querySelectorAll('.row')).map(r => RB.store.tenant(r.dataset.id).unit); return u.every((x, i) => i === 0 || RB.natCmp(u[i - 1], x) <= 0); })));
  const del = await ev(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).delinquent));
  const delRow = `.tn-list .row[data-id="${del.id}"]`;
  check('row: name / place / marker + amount in ink', (await page.textContent(delRow + ' .row-title')).trim() === del.name && /^Unit 1B at Alder Court$/.test((await page.textContent(delRow + ' .row-sub')).trim()) && /^Behind since [A-Z][a-z]+/.test((await page.textContent(delRow + ' .row-status')).trim()) && /^\$[\d,]+$/.test((await page.textContent(delRow + ' .row-amt')).trim()));
  check('amount is ink, colour only on the marker', await ev(sel => { const a = getComputedStyle(document.querySelector(sel + ' .row-amt')).color; const ink = getComputedStyle(document.querySelector(sel + ' .row-title')).color; return a === ink; }, delRow));
  const nadia = await ev(() => RB.store.tenantsList().find(t => t.name === 'Nadia Haddad').id);
  check('part-paid row says so', /^Part paid — \d+ days late$/.test((await page.textContent(`.tn-list .row[data-id="${nadia}"] .row-status`)).trim()) && (await page.textContent(`.tn-list .row[data-id="${nadia}"] .row-amt`)).trim() === '$675');
  check('paid rows are quiet (no marker)', await ev(() => Array.from(document.querySelectorAll('.tn-list .row')).filter(r => RB.store.ledger(r.dataset.id).balance === 0 && RB.store.tenant(r.dataset.id).status === 'active').every(r => !r.querySelector('.status'))));

  // ---- deep link to a moved-out tenant while "Everyone" is chosen
  const pastId = await ev(() => RB.store.tenantsList().find(t => t.status === 'past').id);
  await ev(id => { location.hash = 't-' + id; }, pastId);
  await wait(200);
  check('deep link to a moved-out tenant switches to Moved out', await ev(() => document.querySelector('#tn-seg button[aria-pressed="true"]').dataset.k) === 'past');
  check('deep-linked row highlighted', await page.locator(`.tn-list .row.is-selected[data-id="${pastId}"]`).count() === 1);
  await page.keyboard.press('Escape');
  await wait(250);
  check('deep link did not change the remembered choice', await ev(() => RB.prefs.get('tn:filter', 'all')) !== 'past');
  await page.click('#tn-seg [data-k="all"]');
  await wait(60);

  // ---- segment, find
  const owingCount = await ev(() => RB.store.tenantsList().filter(t => RB.store.ledger(t.id).balance > 0).length);
  await page.click('#tn-seg [data-k="owing"]');
  await wait(60);
  const owingRows = await ev(() => Array.from(document.querySelectorAll('.tn-list .row[data-id]')).map(r => RB.store.ledger(r.dataset.id).balance));
  check('Owes money shows only owing tenants', owingRows.length === owingCount && owingRows.every(b => b > 0));
  await page.click('#tn-seg [data-k="past"]');
  await wait(60);
  check('Moved out shows moved-out tenants', await rows().count() === 1 && /^Moved out/.test((await page.textContent('.tn-list .row .row-status')).trim()));
  await page.click('#tn-seg [data-k="all"]');
  await wait(60);
  await page.fill('#tn-q', 'okafor');
  await wait(200);
  check('find matches a name', await rows().count() === 1 && (await page.textContent('.tn-list')).includes('Maya Okafor'));
  check('find box keeps focus while typing', await ev(() => document.activeElement && document.activeElement.id === 'tn-q'));
  check('worded Clear button', (await page.textContent('.tn-q-clear')).trim() === 'Clear');
  await page.fill('#tn-q', '2b');
  await wait(200);
  check('find matches a unit', (await page.textContent('.tn-list')).includes('Owen Gallagher'));
  await page.fill('#tn-q', 'zzzz-nothing');
  await wait(200);
  check('nothing found: one sentence + one action', await page.locator('.tn-empty [data-act="clearq"]').count() === 1);
  await page.click('.tn-empty [data-act="clearq"]');
  await wait(80);

  // ---- keyboard still works for those who want it
  await ev(() => document.activeElement && document.activeElement.blur());
  const order = await ev(() => RB._tn.order.slice());
  await page.keyboard.press('j');
  await wait(40);
  check('j moves the row cursor', await page.locator('.tn-list .row.is-focused').getAttribute('data-id') === order[0]);
  await page.keyboard.press('Enter');
  await wait(150);
  check('Enter opens the tenant page', await ev(() => location.hash) === '#t-' + order[0] && await page.locator('.drawer').count() === 1);
  check('desktop: list stays beside the page, open row highlighted', await page.locator(`.tn-list .row.is-selected[data-id="${order[0]}"]`).count() === 1 && await ev(() => document.getElementById('rb-view').querySelector('.view-tenants, .view-root').classList.contains('tn-split') || !!document.querySelector('.view-tenants.tn-split')));
  await page.click('.drawer .tn-steps [data-d="1"]');
  await wait(150);
  check('"Next tenant" steps in list order', await ev(() => location.hash) === '#t-' + order[1]);
  check('exactly one way out on desktop (Close)', await ev(() => Array.from(document.querySelectorAll('.drawer [data-drawer-close]')).filter(b => b.offsetParent).length === 1 && Array.from(document.querySelectorAll('.drawer [data-drawer-close] span')).filter(s => s.offsetParent && s.children.length).map(s => s.innerText.trim()).join('|') === 'Close'));
  await page.click('.drawer .tn-exit');
  await wait(220);
  check('Close goes back to #tenants', await ev(() => location.hash) === '#tenants' && await page.locator('.drawer').count() === 0);

  // ---- tenant page: order, one filled button, history by month
  await ev(id => { location.hash = 't-' + id; }, del.id);
  await wait(200);
  check('name is the display element', (await page.textContent('.drawer .tn-name')).trim() === del.name && await ev(() => getComputedStyle(document.querySelector('.drawer .tn-name')).fontFamily.includes('Newsreader')));
  check('status sentence: behind on rent since', /^Owes \$[\d,]+ — behind on rent since [A-Z]/.test((await page.textContent('#tn-dstatus')).trim()));
  check('actions: filled Record a payment, outline Add a note and More', (await page.locator('.tn-dacts .btn').allInnerTexts()).map(s => s.trim()).join('|') === 'Record a payment|Add a note|More' && await page.locator('.tn-dacts .btn-outline').count() === 2);
  check('exactly one filled button on the tenant page', (await filled(page, '.drawer')).length === 1, (await filled(page, '.drawer')).join('|'));
  check('one "Record a payment" on the page', await ev(() => Array.from(document.querySelectorAll('.drawer button, .drawer a')).filter(b => b.offsetParent && /^Record a payment$/.test(b.innerText.trim())).length === 1));
  const secs = (await page.locator('.drawer .tn-sec-title').allTextContents()).map(s => s.trim());
  check('sections in order', secs.join('|') === 'Payment history|Notes|Lease and rent|Contact', secs.join('|'));
  check('"Repairs in this unit" appears once', await ev(() => Array.from(document.querySelectorAll('.drawer h2, .drawer h3, .drawer h4')).filter(e => e.textContent.trim() === 'Repairs in this unit').length) === 1);
  check('no buttons inside rows on the tenant page', await buttonsInRows(page, '.drawer') === 0);
  let hc = await historyCheck(page, del.id);
  check('payment history: last 3 months, headings sum against the ledger, lines in order', hc.n === 3 && !hc.bad.length, hc.bad.join(' ; '));
  check('no running-balance column', await page.locator('.drawer .tn-ledger, .drawer .tn-l-bal').count() === 0 && !/Still owed\n/.test(await page.textContent('.drawer #tn-history')));
  await page.click('.drawer [data-act="earlier"]');
  await wait(100);
  hc = await historyCheck(page, del.id);
  check('"Show earlier months" shows every month, still summing', hc.n > 3 && !hc.bad.length, hc.n + ' ' + hc.bad.join(' ; '));
  await page.click('.drawer [data-act="earlier"]');
  await wait(80);
  check('lease and rent: label/value rows with one Change link', await page.locator('.drawer .tn-kv dt').count() >= 3 && await page.locator('.drawer section:has(#tn-h-lease) button, .drawer section:has(#tn-h-lease) a').count() === 1 && (await page.textContent('.drawer [data-sec="lease"]')).trim() === 'Change');
  check('contact: the number and address are the tap targets', /^Call \(555\)/.test((await page.textContent('.drawer a[data-contact="phone"] .row-title')).trim()) && (await page.getAttribute('.drawer a[data-contact="phone"]', 'href')).startsWith('tel:') && /^Email /.test((await page.textContent('.drawer a[data-contact="email"] .row-title')).trim()));
  check('no Copy buttons on the page (Copy is in More)', await ev(() => !Array.from(document.querySelectorAll('.drawer button')).some(b => /^Copy\b/.test(b.innerText.trim()))));
  let words = forbiddenIn(await readText(page));
  check('tenant page: no forbidden words', !words, words);
  check('the edit verb is always Change', !/\bEdit\b|Change these details|Change the details/.test(await readText(page)));
  let au = await auditControls(page, 40);
  check('tenant page: every button has words', !au.noText.length, au.noText.join(', '));
  check('tenant page: controls ≥ 40px on desktop', !au.small.length, au.small.join(', '));
  await page.click('.tn-dacts [data-act="more"]');
  await page.waitForSelector('.choices-list');
  const more = (await page.locator('.choices-list .row-title').allTextContents()).join('|');
  check('More lists everything with words', ['Add a $50 late fee', 'Add a charge', 'Take money off what they owe', 'Change the rent', 'Renew the lease', 'They are moving out', 'Copy a statement', 'Download for Excel', 'Copy their phone number', 'Change their details', 'Remove this tenant'].every(x => more.includes(x)), more);
  check('More items each have a one-line hint', await page.locator('.choices-list .row-sub').count() === await page.locator('.choices-list .row').count());
  check('More sheet: no filled button', (await filled(page, '.sheet')).length === 0);
  await page.keyboard.press('Escape');
  await wait(200);

  // ---- part payment from the tenant page → wording → "Record the rest" clears it
  await ev(id => { location.hash = 't-' + id; }, nadia);
  await wait(200);
  check('part paid: status sentence', /^Has paid \$800 of \$1,475 for [A-Z][a-z]+\. Still owes \$675 — \d+ days late\.$/.test((await page.textContent('#tn-dstatus')).trim()), await page.textContent('#tn-dstatus'));
  check('part paid: primary says Record the rest ($675)', (await page.textContent('.tn-dacts .btn-primary')).trim() === 'Record the rest ($675)');
  check('part paid: history says "Part payment" and "paid so far"', /Part payment/.test(await page.textContent('#tn-history')) && /\$800 paid so far, \$675 still owed/.test(await page.textContent('#tn-history')));
  check('part paid: month heading says what is still owed', /— \$1,475 due, \$800 paid, \$675 still owed$/.test((await page.textContent('.drawer .tn-month')).trim()), await page.textContent('.drawer .tn-month'));
  await page.click('.tn-dacts [data-act="more"]');
  await page.waitForSelector('#tn-more-part');
  check('part paid: More offers "Record another part payment"', (await page.textContent('.choices-list')).includes('Record another part payment'));
  await page.click('#tn-more-part');
  await page.waitForSelector('#pay-amount');
  await wait(80);
  check('More closed before the payment sheet opened (no sheet on a sheet)', await page.locator('.sheet').count() === 1);
  check('part payment sheet starts on "Only part of it"', await page.isVisible('#pay-amount'));
  await page.fill('#pay-amount', '300');
  await page.press('#pay-amount', 'Enter');
  await wait(250);
  check('another part payment: still says what is left', /^Has paid \$1,100 of \$1,475 for [A-Z][a-z]+\. Still owes \$375/.test((await page.textContent('#tn-dstatus')).trim()), await page.textContent('#tn-dstatus'));
  check('another part payment: button follows', (await page.textContent('.tn-dacts .btn-primary')).trim() === 'Record the rest ($375)');
  await page.click('.tn-dacts .btn-primary');
  await page.waitForSelector('.sheet [data-action="save"]');
  await wait(80);
  check('"Record the rest" offers the rest', (await page.textContent('.sheet')).includes('Yes, all $375'));
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(250);
  check('"Record the rest" clears it', (await page.textContent('#tn-dstatus')).trim() === 'All paid up' && (await page.textContent('.tn-dacts .btn-primary')).trim() === 'Record a payment');
  check('history marks the final payment as "the rest"', /Payment — the rest/.test(await page.textContent('#tn-history')));
  hc = await historyCheck(page, nadia);
  check('after paying: headings still sum, month paid in full', !hc.bad.length && /paid in full$/.test((await page.textContent('.drawer .tn-month')).trim()), hc.bad.join(' ; '));

  // ---- Add a tenant: truthful steps, radio cards, checked when a field is left
  await ev(() => { location.hash = 'tenants'; });
  await wait(150);
  await clearToasts(page);
  await page.click('.tn-add-btn');
  await page.waitForSelector('#tf-name');
  const stepCount = () => page.evaluate(() => { const m = (document.querySelector('.sheet .steps-count') || {}).textContent || ''; const r = m.match(/Step (\d+) of (\d+)/); return r ? [+r[1], +r[2]] : null; });
  const seen = [];
  seen.push(await stepCount());
  check('guide says Step 1 of 4', JSON.stringify(seen[0]) === '[1,4]' && /Who is it\?/.test(await page.textContent('.sheet')), JSON.stringify(seen[0]));
  check('add sheet: one filled button', (await filled(page, '.sheet')).length === 1);
  await page.fill('#tf-email', 'nope');
  await wait(40);
  check('not checked per keystroke', (await page.textContent('[data-field="email"] .field-error')).trim() === '');
  await page.focus('#tf-phone');
  await wait(60);
  check('checked when the field is left', /doesn’t look like an email/.test(await page.textContent('[data-field="email"] .field-error')));
  check('the message sits above the field', await ev(() => { const f = document.querySelector('[data-field="email"]'); return f.querySelector('.field-error').getBoundingClientRect().top < f.querySelector('input').getBoundingClientRect().top; }));
  await page.fill('#tf-email', '');
  await page.focus('#tf-name');
  await page.focus('#tf-phone');
  await wait(40);
  check('fixing it clears the message on leaving', (await page.textContent('[data-field="email"] .field-error')).trim() === '');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(60);
  check('step 1 asks for the name (again on Next)', (await page.textContent('[data-field="name"] .field-error')).trim() === 'Write their name');
  await page.fill('#tf-name', 'Test Person');
  await page.fill('#tf-phone', '(555) 0199-1234');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#tf-proppick-0');
  seen.push(await stepCount());
  const propLabels = (await page.locator('[data-field="propPick"] .choice-label').allTextContents()).join('|');
  check('step 2: properties as radio cards with marks', propLabels.includes('Alder Court') && propLabels.includes('A different property') && await ev(() => getComputedStyle(document.querySelector('[data-field="propPick"] .choice-body'), '::before').content !== 'none'), propLabels);
  await page.click('[data-field="propPick"] label:has-text("Alder Court")');
  await page.fill('#tf-unit', '1A');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(60);
  check('step 2: a taken unit is explained', /already lives in Unit 1A at Alder Court/.test(await page.textContent('[data-field="unit"] .field-error')));
  await page.fill('#tf-unit', '9Z');
  await clearToasts(page);
  await page.click('.sheet [data-action="back"]');
  await page.waitForSelector('#tf-name');
  check('Back keeps what was typed', await page.inputValue('#tf-name') === 'Test Person' && await page.inputValue('#tf-phone') === '(555) 0199-1234');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#tf-unit');
  check('Back and forward keeps step 2 too', await page.inputValue('#tf-unit') === '9Z' && await ev(() => document.querySelector('[name="propPick"]:checked').value) === 'Alder Court');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#tf-rent');
  seen.push(await stepCount());
  check('amount field sized to the answer', await ev(() => document.querySelector('#tf-rent').getBoundingClientRect().width < document.querySelector('.sheet .steps-body').getBoundingClientRect().width * 0.7));
  await page.fill('#tf-rent', '1500');
  await page.click('[data-field="hasEnd"] label:has-text("Yes")');
  await page.fill('#tf-movein', monthStart);
  await page.fill('#tf-end', await ev(d => RB.date.addDays(RB.date.addMonths(d, 12), -1), monthStart));
  await page.fill('#tf-deposit', '1000');
  await wait(40);
  check('dates are written out beside the field', /^[A-Z][a-z]+day, [A-Z][a-z]+ 1\b/.test((await page.textContent('#tf-movein-words')).trim()), await page.textContent('#tf-movein-words'));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(100);
  seen.push(await stepCount());
  check('step counters match the screens shown (1, 2, 3, 4 of 4)', JSON.stringify(seen) === '[[1,4],[2,4],[3,4],[4,4]]', JSON.stringify(seen));
  const summary = (await page.textContent('#tf-summary')).trim();
  const expect = await ev(d => 'Test Person, Unit 9Z at Alder Court, $1,500 a month from ' + RB._tn.day(d) + '.', monthStart);
  check('summary sentence before saving', summary === expect, summary);
  check('button says "Add Test Person"', (await page.textContent('.sheet [data-action="next"]')).trim() === 'Add Test Person');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(300);
  const nid = await ev(() => (location.hash.match(/^#t-(.+)$/) || [])[1]);
  check('saving opens the new tenant', !!nid && (await page.textContent('.drawer .tn-name')).trim() === 'Test Person');
  const t0 = await ev(id => RB.store.tenant(id), nid);
  check('tenant saved with defaults (no extra questions)', t0.property === 'Alder Court' && t0.unit === '9Z' && t0.rent[0].amount === 150000 && t0.deposit.amount === 100000 && t0.trackFrom === monthStart && t0.opening === null && t0.phone === '(555) 0199-1234');
  check('page states the balance in words', (await page.textContent('#tn-dstatus')).trim().startsWith('Owes $1,500'));

  // ---- Change their details: optional extras behind "Add more details (optional)"
  await ev(id => { RB.actions.editTenant(id); }, nid);
  await page.waitForSelector('#tf-more');
  check('edit sheet is called "Change their details"', /Change their details/.test(await page.textContent('.sheet')));
  check('extras are hidden behind a worded toggle', (await page.textContent('#tf-more')).trim() === 'Add more details (optional)' && await page.isHidden('#tf-opening'));
  await page.click('#tf-more');
  check('each extra explains itself', await ev(() => Array.from(document.querySelectorAll('#tf-more-body > .field')).filter(f => !f.querySelector('[name="insPolicy"], [name="insExpires"], [name="emPhone"]')).every(f => f.querySelector('.field-hint'))));
  check('glossary labels for extras', /Start counting rent from/.test(await page.textContent('#tf-more-body')) && /What they already owed/.test(await page.textContent('#tf-more-body')) && /Other monthly charges/.test(await page.textContent('#tf-more-body')));
  check('edit sheet: one filled button', (await filled(page, '.sheet')).length === 1);
  await page.fill('#tf-opening', '200');
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(200);
  check('edit saved: what they already owed', await ev(id => RB.store.ledger(id).balance, nid) === 170000);
  await page.click('.drawer [data-act="edit"][data-sec="contact"]');
  await page.waitForSelector('#tf-phone');
  await wait(80);
  check('Contact "Change" opens at that section', await ev(() => document.activeElement && document.activeElement.id === 'tf-phone'));
  await page.keyboard.press('Escape');
  await wait(200);

  // ---- Change the rent
  await ev(id => { RB.actions.changeRent(id); }, nid);
  await page.waitForSelector('#cr-amount');
  check('change-rent asks a plain question', (await page.textContent('label[for="cr-amount"]')).trim() === 'What will the new rent be?' && /Change the rent/.test(await page.textContent('.sheet')));
  await page.fill('#cr-amount', '1600');
  await wait(50);
  check('change-rent sentence', /Rent changes from \$1,500 to \$1,600 on [A-Z][a-z]+day/.test(await page.textContent('#cr-sum')) && (await page.textContent('[data-action="save"]')).trim() === 'Change the rent to $1,600');
  await clearToasts(page);
  await page.click('[data-action="save"]');
  await wait(150);
  check('change rent appends to the schedule', (await ev(id => RB.store.tenant(id).rent, nid)).length === 2);

  // ---- payment, tap the line → remove (it was a mistake), Undo
  await page.click('.drawer .tn-dacts [data-act="pay"]');
  await page.waitForSelector('.sheet [data-action="save"]');
  await wait(80);
  check('payment sheet offers all of it', (await page.textContent('.sheet')).includes('Yes, all $1,700'));
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(250);
  check('payment clears the balance', await ev(id => RB.store.ledger(id).balance, nid) === 0 && (await page.textContent('#tn-dstatus')).trim() === 'All paid up');
  const payId = await ev(id => RB.store.ledger(id).rows.find(r => r.type === 'payment').id, nid);
  const line = page.locator(`.drawer .row[data-eid="${payId}"]`);
  check('a payment line is one tap target', await line.count() === 1 && await ev(id => document.querySelector(`.drawer .row[data-eid="${id}"]`).tagName === 'BUTTON', payId));
  await line.click();
  await page.waitForSelector('.choices-list');
  const items = (await page.locator('.choices-list .row-title').allTextContents()).map(s => s.trim());
  check('line → Change / Remove this payment / Copy a receipt', items.join('|') === 'Change|Remove this payment — it was a mistake|Copy a receipt', items.join(' | '));
  await page.click('#tn-line-remove');
  await wait(150);
  check('removing restores what they owe', await ev(id => RB.store.ledger(id).balance, nid) === 170000);
  check('removed line is struck through and says why', await page.locator(`.drawer li.is-void .row[data-row="${payId}"]`).count() === 1 && /Removed — it was a mistake/.test(await page.textContent(`.drawer .row[data-row="${payId}"]`)));
  hc = await historyCheck(page, nid);
  check('headings leave a removed payment out', !hc.bad.length, hc.bad.join(' ; '));
  check('toast says what happened, with Undo', /^Removed the \$1,700 payment/.test(await page.textContent('.toast:last-child .toast-msg')) && (await page.textContent('.toast:last-child .toast-action')).trim() === 'Undo');
  await page.click('.toast:last-child .toast-action');
  await wait(150);
  check('Undo puts it back', await ev(id => RB.store.ledger(id).balance, nid) === 0);

  // ---- notes: "Add a note" → simple sheet; tap a note → followed up
  await page.click('#tn-add-note');
  await page.waitForSelector('#tn-note-text');
  check('note sheet asks plain questions', /What happened\?/.test(await page.textContent('.sheet')) && /Remind me to follow up on/.test(await page.textContent('.sheet')) && (await page.locator('#tn-note-kind option').allTextContents()).join('|') === 'Note|Phone call|Text|Email|Visit');
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(60);
  check('empty note explained', (await page.textContent('[data-field="text"] .field-error')).trim() === 'Write what happened first');
  await page.fill('#tn-note-text', 'Called about the key');
  await page.selectOption('#tn-note-kind', 'call');
  await page.fill('#tn-note-follow', today);
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(200);
  const log = await ev(id => Object.values(RB.store.tenant(id).log).filter(Boolean), nid);
  check('note added with kind + follow-up', log.length === 1 && log[0].kind === 'call' && log[0].followUp === today && log[0].text === 'Called about the key');
  check('follow-up shows on Today', await ev(id => RB.store.attention().some(a => a.kind === 'followup' && a.tenantId === id), nid));
  await page.click('.drawer .tn-notes .row');
  await page.waitForSelector('#tn-note-done');
  await page.click('#tn-note-done');
  await wait(150);
  check('"Mark as followed up" ticks it done', await ev(id => Object.values(RB.store.tenant(id).log).filter(Boolean)[0].done, nid) === true);
  for (let i = 0; i < 4; i++) await ev(([id, i]) => RB.store.addLog(id, { kind: 'note', text: 'Extra note ' + i, followUp: null, done: false }), [nid, i]);
  await wait(150);
  check('notes: latest 3, then "Show all"', await page.locator('.drawer .tn-notes > li').count() === 3 && /Show all 5 notes/.test(await page.textContent('.drawer [data-act="allnotes"]')));
  await page.click('.drawer [data-act="allnotes"]');
  await wait(80);
  check('"Show all" shows every note', await page.locator('.drawer .tn-notes > li').count() === 5);
  const scrolled = await ev(() => { const b = document.querySelector('.drawer-body'); b.scrollTop = 400; return b.scrollTop; });
  await ev(id => RB.store.addEntry(id, { type: 'charge', date: RB.store.today(), amount: 1000, memo: 'Key copy', category: 'fee' }), nid);
  await wait(150);
  check('page scroll survives a store change', await ev(() => document.querySelector('.drawer-body').scrollTop) === scrolled);
  await ev(id => RB.store.addEntry(id, { type: 'payment', date: RB.store.today(), amount: 1000, method: 'Cash' }), nid);
  await wait(100);

  // ---- They are moving out: when → what they owe + the deposit → check and save
  const future = await ev(t => RB.date.addDays(t, 20), today);
  await ev(id => { RB.actions.moveOut(id); }, nid);
  await page.waitForSelector('#mo-date');
  const mseen = [await stepCount()];
  check('move-out flow: step 1 of 3 asks when', JSON.stringify(mseen[0]) === '[1,3]' && /When are they moving out\?/.test(await page.textContent('.sheet')));
  await page.fill('#mo-date', future);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#mo-owed');
  mseen.push(await stepCount());
  check('move-out flow: step 2 says what they owe and the deposit on one screen', /What they owe, and the deposit/.test(await page.textContent('.sheet')) && /when they leave/.test(await page.textContent('#mo-owed')) && /after they leave/.test(await page.textContent('#mo-dep')));
  check('final month part shown as a plain sum', /\d+ of \d+ days, so \$[\d,.]+ instead of \$[\d,]+/.test(await page.textContent('#mo-sum')) || /the whole month/.test(await page.textContent('#mo-sum')), await page.textContent('#mo-sum'));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(80);
  mseen.push(await stepCount());
  check('move-out step counters match the screens (1, 2, 3 of 3)', JSON.stringify(mseen) === '[[1,3],[2,3],[3,3]]', JSON.stringify(mseen));
  check('future date: summary + button', /is moving out on/.test(await page.textContent('#mo-summary')) && /^Save — moving out /.test((await page.textContent('.sheet [data-action="next"]')).trim()));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(300);
  const tf = await ev(id => { const t = RB.store.tenant(id); return { status: t.status, mo: t.lease.moveOut }; }, nid);
  check('future date: moving out (not moved out yet)', tf.status === 'notice' && tf.mo === future, JSON.stringify(tf));
  check('the page says Moving out', /^Moving out /.test((await page.textContent('.tn-dlease')).trim()));
  await ev(d => RB.store.setToday(d), future);
  await wait(150);
  const it = await ev(id => RB.store.attention().find(a => a.kind === 'moveout' && a.tenantId === id), nid);
  check('on the day: Today offers to finish the move-out', !!it && it.action.type === 'moveOut', JSON.stringify(it && it.action));
  check('on the day: the page offers "Finish the move-out"', (await page.textContent('.tn-alerts').catch(() => '')).includes('Finish the move-out'));
  await ev(d => RB.store.setToday(d), today);
  await wait(150);
  await clearToasts(page);

  await ev(id => { RB.actions.moveOut(id); }, nid);
  await page.waitForSelector('#mo-date');
  await page.fill('#mo-date', today);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#mo-owed');
  const owedAtMove = await ev(([id, d]) => RB.model.moveOutPreview(RB.store.tenant(id), RB.store.entries(id), RB.store.settings(), RB.store.today(), d).balance, [nid, today]);
  check('deposit asked on the same screen as what they owe', await page.isVisible('[data-field="keep"]') && /Do you need to keep any of it\?/.test(await page.textContent('.sheet')));
  await page.click('[data-field="keep"] label:has-text("Yes, some of it")');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(60);
  check('keeping nothing written is explained', /Write what you are keeping/.test(await page.textContent('#sd-ded-wrap')));
  await page.fill('[data-rep="ded"] [data-k="reason"]', 'Cleaning');
  await page.fill('[data-rep="ded"] [data-k="amount"]', '120');
  await wait(80);
  const dueBy = await ev(d => RB._tn.day(RB.date.addDays(d, RB.store.settings().depositReturnDays)), today);
  const refund = 100000 - 12000 - Math.max(0, owedAtMove) + Math.max(0, -owedAtMove);
  const sumText = (await page.textContent('#sd-sum')).trim();
  const fm = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const expectSum = 'Deposit $1,000 − cleaning $120' + (owedAtMove > 0 ? ' − unpaid rent ' + fm(owedAtMove) : '') + (owedAtMove < 0 ? ' + money they paid ahead ' + fm(-owedAtMove) : '') + ' = ' + fm(refund) + ' to give back, due by ' + dueBy + '.';
  check('deposit sums in plain words', sumText === expectSum, sumText + ' ≠ ' + expectSum);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(80);
  check('check screen repeats the sums (Step 3 of 3)', (await page.textContent('#mo-deposit')).trim() === expectSum && (await page.textContent('.sheet [data-action="next"]')).trim() === 'Finish the move-out' && JSON.stringify(await stepCount()) === '[3,3]');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(300);
  const after = await ev(id => ({ status: RB.store.tenant(id).status, ret: RB.store.tenant(id).deposit.returned, bal: RB.store.ledger(id).balance }), nid);
  check('moved out + deposit settled', after.status === 'past' && after.ret && after.ret.refund === refund && after.ret.deductions[0].reason === 'Cleaning' && after.bal === 0, JSON.stringify(after));
  check('toast with Undo', /moved out on/.test(await page.textContent('.toast:last-child .toast-msg')));

  // ---- Remove this tenant: rule-8 confirm with "Keep it"
  await page.click('.drawer .tn-dacts [data-act="more"]');
  await page.click('#tn-more-delete');
  await page.waitForSelector('[data-action="confirm"]');
  check('remove confirm names the tenant and offers "Keep it"', (await page.textContent('.sheet-body')).includes('Test Person') && /Keep it/.test(await page.textContent('.sheet-foot')) && (await page.textContent('[data-action="confirm"]')).trim() === 'Remove Test Person');
  await clearToasts(page);
  await page.click('[data-action="confirm"]');
  await wait(250);
  check('tenant removed, back on #tenants', !(await ev(id => !!RB.store.tenant(id), nid)) && await ev(() => location.hash) === '#tenants');

  // ---- forbidden words + words on buttons, list view
  words = forbiddenIn(await readText(page));
  check('list: no forbidden words', !words, words);
  au = await auditControls(page, 40);
  check('list: every button has words', !au.noText.length, au.noText.join(', '));

  // ---- hostile strings stay escaped
  await ev(() => RB.store.addTenant({ id: 'xssT1', name: '<img src=x onerror="window.__x=1">', unit: '<b>9</b>', property: '"><svg onload="window.__x=2">', phone: '<i>1</i>', email: 'a@b.co"><script>window.__x=3<' + '/script>', about: '<iframe src="javascript:window.__x=4">', coTenants: [{ name: '<u>co</u>' }], links: [{ id: 'l1', label: '<b>bad</b>', url: 'javascript:window.__x=5' }, { id: 'l2', label: 'ok', url: 'https://example.com/"onmouseover="window.__x=6' }], rent: [{ from: '2026-01-01', amount: 100000 }], lease: { start: '2026-01-01', moveIn: '2026-01-01' }, log: { a: { at: new Date().toISOString(), kind: '<b>x</b>', text: '<img src=x onerror="window.__x=7">', followUp: null, done: false } } }));
  await page.fill('#tn-q', 'img');
  await wait(150);
  await ev(() => { location.hash = 't-xssT1'; });
  await wait(200);
  check('hostile strings stay escaped', await ev(() => !window.__x && !document.querySelector('#rb-view img, #rb-view b, #rb-view svg[onload], .drawer img, .drawer b, .drawer iframe, .drawer u, .drawer script')));
  check('non-https links are not linked', await ev(() => !document.querySelector('.drawer a[href^="javascript"]') && Array.from(document.querySelectorAll('.drawer a.tn-link')).every(a => a.href.startsWith('https://'))));
  await ev(() => { RB.actions.editTenant('xssT1'); });
  await wait(150);
  check('hostile strings escaped in the edit form', await ev(() => !window.__x && document.getElementById('tf-name').value.startsWith('<img')));
  await page.keyboard.press('Escape');
  await wait(200);

  // ---- deep links
  const { ctx: c2, page: p2 } = await open({ width: 1360, height: 900 });
  const someId = await p2.evaluate(() => RB.store.tenantsList()[5].id);
  await p2.goto(url + '#t-' + someId);
  await p2.waitForFunction(() => RB.store.state.ready);
  await wait(200);
  check('deep link opens the tenant page', (await p2.textContent('.drawer .tn-name')).trim() === await p2.evaluate(id => RB.store.tenant(id).name, someId));
  await p2.evaluate(() => { location.hash = 't-doesNotExist'; });
  await wait(200);
  check('unknown id: tidy not-found', (await p2.textContent('.drawer')).includes('Tenant not found'));
  await p2.click('.drawer [data-act="back"]');
  await wait(200);
  check('not-found → back to tenants', await p2.evaluate(() => location.hash) === '#tenants');
  await c2.close();

  // ---- phone at Extra large text: no sideways overflow, 48px targets, words on every button
  const { ctx: c3, page: p3 } = await open({ width: 390, height: 844 }, 'tenants', 'xl');
  const overflow = () => p3.evaluate(() => {
    const W = window.innerWidth;
    const bad = Array.from(document.querySelectorAll('#rb-view *, .drawer *, .sheet *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1 && !e.closest('.hide-phone'); });
    return document.documentElement.scrollWidth > W || bad.length ? (document.documentElement.scrollWidth + ' ' + bad.slice(0, 3).map(e => e.tagName + '.' + e.className).join(' ')) : '';
  });
  check('phone XL: text size is Extra large', await p3.evaluate(() => document.documentElement.getAttribute('data-text')) === 'xl');
  check('phone XL list: no overflow', !(await overflow()), await overflow());
  check('phone list: Add a tenant is a text link, no filled button', (await filled(p3, '#rb-view')).length === 0 && await p3.isVisible('.tn-add-link'));
  check('phone list: segment on one row', await p3.evaluate(() => { const b = Array.from(document.querySelectorAll('#tn-seg button')).map(x => x.getBoundingClientRect()); return b.every(r => Math.abs(r.top - b[0].top) < 2) && b[b.length - 1].right <= innerWidth; }));
  check('phone list: properties fold to one row each', await p3.locator('.tn-list [data-act="group"]').count() === 3);
  await p3.click('.tn-list [data-act="group"][data-g="p-Alder Court"]');
  await wait(100);
  check('phone list: a property opens in place', await p3.locator('.tn-list .rows-head[data-group="p-Alder Court"] + .rows .row').count() === 8);
  au = await auditControls(p3, 48);
  check('phone XL list: tappable things ≥ 48px', !au.small.length, au.small.join(', '));
  check('phone list: no button inside any tenant row', await buttonsInRows(p3, '#rb-view') === 0);
  const did = await p3.evaluate(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).delinquent).id);
  await p3.evaluate(id => { location.hash = 't-' + id; }, did);
  await wait(250);
  check('phone XL tenant page: one way out, "Back to tenants"', await p3.evaluate(() => Array.from(document.querySelectorAll('.drawer [data-drawer-close]')).filter(b => b.offsetParent).length === 1) && /Back to tenants/.test(await p3.innerText('.drawer .tn-exit')) && !(await overflow()), await overflow());
  au = await auditControls(p3, 48);
  check('phone XL tenant page: tappable things ≥ 48px', !au.small.length, au.small.join(', '));
  check('phone XL tenant page: every button has words', !au.noText.length, au.noText.join(', '));
  check('phone tenant page: exactly one filled button', (await filled(p3, '.drawer')).length === 1);
  for (const fn of ['editTenant', 'moveOut', 'changeRent', 'addTenant', 'settleDeposit']) {
    await p3.evaluate(([f, id]) => { RB.actions[f](f === 'addTenant' ? undefined : id); }, [fn, did]);
    await wait(250);
    if (!(await p3.locator('.sheet').count())) { await p3.keyboard.press('Escape'); continue; }
    check('phone XL ' + fn + ' sheet: no overflow', !(await overflow()), await overflow());
    au = await auditControls(p3, 48);
    check('phone XL ' + fn + ' sheet: targets ≥ 48px', !au.small.length, au.small.join(', '));
    check('phone XL ' + fn + ' sheet: one filled button', (await filled(p3, '.sheet')).length === 1, (await filled(p3, '.sheet')).join('|'));
    await p3.keyboard.press('Escape');
    await wait(200);
  }
  await p3.click('.drawer .tn-exit');
  await wait(200);
  check('phone Back returns to the list', await p3.evaluate(() => location.hash) === '#tenants');
  await c3.close();
  await ctx.close();
} catch (e) {
  check('smoke run completed', false, process.env.VERBOSE ? e.message : e.message.split('\n')[0]);
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

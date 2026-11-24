#!/usr/bin/env node
// Interaction smoke test for the Tenants list + tenant page + tenant sheets (local mode), plain-language edition (SPEC §8).
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
const check = (name, ok, extra) => { const line = (ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''); results.push(line); if (process.env.VERBOSE) console.log(line); if (!ok) process.exitCode = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
// Toasts sit over the bottom-right of a sheet for 10 s; clear them before pressing sheet buttons.
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
  const els = roots.flatMap(r => Array.from(r.querySelectorAll('button, a[href], [role="tab"], label.btn, .tn-row'))).filter(e => e.offsetParent !== null && !e.closest('.vh'));
  const noText = els.filter(e => e.tagName === 'BUTTON' && !e.innerText.trim()).map(e => (e.className || e.tagName) + ' ' + (e.getAttribute('aria-label') || ''));
  const small = els.filter(e => { if (e.closest('.toast, .pstrip, .tn-l-month')) return false; if (e.matches('.lz-name, .rp-name, .tn-link') ) return false; const r = e.getBoundingClientRect(); return r.height && r.height < minH - 0.5; }).map(e => (e.innerText || e.className).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px');
  return { noText: noText.slice(0, 5), small: small.slice(0, 6) };
}, minH);

try {
  const { ctx, page } = await open({ width: 1360, height: 900 }, 'tenants');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const today = await ev(() => RB.store.today());
  const monthStart = today.slice(0, 7) + '-01';
  const rows = () => page.locator('.tn-list .tn-row[data-id]');

  // ---- list basics
  check('list shows a row per current tenant', await rows().count() === 26);
  check('summary in words', /26 tenants in 3 properties\. Rent each month: \$[\d,]+\. 6 tenants owe a total of \$[\d,]+\./.test(await page.textContent('.tn-summary')), await page.textContent('.tn-summary'));
  check('three worded choices with counts', (await page.locator('.tn-show .tn-choice').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim()).join('|') === 'Everyone (26)|Owes money (6)|Moved out (1)');
  check('find box is labelled in words', (await page.textContent('label[for="tn-q"]')).trim() === 'Find a tenant by name or unit');
  check('no Compact density', await page.locator('[data-act="density"]').count() === 0);
  check('default sort = who needs attention', await ev(() => { const id = document.querySelector('.tn-row[data-id]').dataset.id; const all = RB.store.tenantsList({ includePast: false }).map(t => RB.store.summary(t.id).urgency); return RB.store.summary(id).urgency === Math.min(...all); }));
  const del = await ev(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).delinquent));
  check('row money line in words (behind on rent)', /^Owes \$[\d,]+ — behind on rent since [A-Z][a-z]+/.test((await page.textContent(`.tn-row[data-id="${del.id}"] .tn-row-money`)).trim()));
  check('row lease line in words', /^Lease ends [A-Z][a-z]{2} \d+(, \d{4})? — in \d+ days$/.test((await page.textContent(`.tn-row[data-id="${del.id}"] .tn-row-lease`)).trim()), await page.textContent(`.tn-row[data-id="${del.id}"] .tn-row-lease`));
  const nadia = await ev(() => RB.store.tenantsList().find(t => t.name === 'Nadia Haddad').id);
  check('part-paid row says what was paid', /^Has paid \$800 of \$1,475 for [A-Z][a-z]+\. Still owes \$675 — \d+ days late\.$/.test((await page.textContent(`.tn-row[data-id="${nadia}"] .tn-row-money`)).trim()), await page.textContent(`.tn-row[data-id="${nadia}"] .tn-row-money`));
  check('rows are ≥ 52px with an Open affordance', await ev(() => Array.from(document.querySelectorAll('.tn-row')).every(r => r.getBoundingClientRect().height >= 52 && /Open/.test(r.innerText))));
  check('lease-ending line shown with a worded link', /leases end soon/.test(await page.textContent('.tn-ending')) && (await page.textContent('.tn-ending .btn')).trim() === 'Show them');
  await page.click('.tn-ending .btn');
  await wait(80);
  check('"Show them" lists the leases ending soon', await rows().count() === 2 && (await page.textContent('#tn-count')).includes('Leases ending soon'));
  await page.click('.tn-ending .btn');
  await wait(80);

  // ---- deep link to a moved-out tenant while "Everyone" is chosen
  const pastId = await ev(() => RB.store.tenantsList().find(t => t.status === 'past').id);
  await ev(id => { location.hash = 't-' + id; }, pastId);
  await wait(200);
  check('deep link to a moved-out tenant switches to Moved out', await ev(() => document.querySelector('.tn-choice[aria-pressed="true"]').dataset.k) === 'past');
  check('deep-linked row highlighted', await page.locator(`.tn-row.is-selected[data-id="${pastId}"]`).count() === 1);
  await page.keyboard.press('Escape');
  await wait(250);
  check('deep link did not change the remembered choice', await ev(() => RB.prefs.get('tn:filter', 'all')) !== 'past');
  await page.click('.tn-choice[data-k="all"]');
  await wait(60);

  // ---- choices, find, sort, group
  const owingCount = await ev(() => RB.store.tenantsList().filter(t => RB.store.ledger(t.id).balance > 0).length);
  await page.click('.tn-choice[data-k="owing"]');
  await wait(60);
  const owingRows = await ev(() => Array.from(document.querySelectorAll('.tn-row[data-id]')).map(r => RB.store.ledger(r.dataset.id).balance));
  check('Owes money shows only owing tenants', owingRows.length === owingCount && owingRows.every(b => b > 0));
  await page.click('.tn-choice[data-k="past"]');
  await wait(60);
  check('Moved out shows moved-out tenants', await rows().count() === 1 && /^Moved out/.test((await page.textContent('.tn-row .tn-row-money')).trim()));
  await page.click('.tn-choice[data-k="all"]');
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
  check('nothing found offers to clear', await page.locator('.empty [data-act="clearq"]').count() === 1);
  await page.click('.empty [data-act="clearq"]');
  await wait(80);
  await page.click('.tn-sortseg [data-k="name"]');
  await wait(60);
  const names = await ev(() => Array.from(document.querySelectorAll('.tn-row-name')).map(e => e.textContent));
  check('Sort by: Name', names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0) && await ev(() => RB.prefs.get('tn:sort') === 'name'));
  await page.click('#tn-group');
  await wait(60);
  check('Group by property adds headings', await page.locator('.tn-list .tn-group').count() === 3);
  await page.click('#tn-group');
  await page.click('.tn-sortseg [data-k="urgency"]');
  await wait(60);

  // ---- keyboard still works for those who want it
  await ev(() => document.activeElement && document.activeElement.blur());
  const order = await ev(() => RB._tn.order.slice());
  await page.keyboard.press('j');
  await wait(40);
  check('j moves the row cursor', await page.locator('.tn-row.is-focused').getAttribute('data-id') === order[0]);
  await page.keyboard.press('Enter');
  await wait(150);
  check('Enter opens the tenant page', await ev(() => location.hash) === '#t-' + order[0] && await page.locator('.drawer').count() === 1);
  await page.click('.drawer .tn-dnav [data-d="1"]');
  await wait(150);
  check('"Next tenant" steps in list order', await ev(() => location.hash) === '#t-' + order[1]);
  check('Previous/Next/Close/Back are worded', /Previous tenant/.test(await page.textContent('.tn-dnav')) && /Back to tenants/.test(await page.textContent('.tn-dhead')) && /Close/.test(await page.textContent('.tn-dhead')));
  await page.click('.drawer .tn-close');
  await wait(220);
  check('Close goes back to #tenants', await ev(() => location.hash) === '#tenants' && await page.locator('.drawer').count() === 0);

  // ---- tenant page: words everywhere
  await ev(id => { location.hash = 't-' + id; }, del.id);
  await wait(200);
  check('status sentence: behind on rent since', /^Owes \$[\d,]+ — behind on rent since [A-Z]/.test((await page.textContent('#tn-dstatus')).trim()));
  check('three big worded buttons', (await page.locator('.tn-dacts .btn').allInnerTexts()).map(s => s.trim()).join('|') === 'Record a payment|Add a note|More');
  check('sections are plain headings', (await page.locator('.drawer .tn-sec-title').allTextContents()).slice(0, 4).join('|') === 'Contact|Lease and rent|Payment history|Notes');
  check('strip has a caption', (await page.textContent('.tn-strip .tn-caption')).includes('Half box = part paid'));
  check('history columns relabelled', (await page.locator('.tn-ledger thead th').allTextContents()).slice(0, 5).join('|') === 'Date|What|Charged|Paid|Still owed');
  check('Download for Excel + Copy a statement', /Download for Excel/.test(await page.textContent('.drawer')) && /Copy a statement/.test(await page.textContent('.drawer')));
  check('Contact has worded Copy / Call / Email', /Copy/.test(await page.textContent('.tn-cline')) && /Call/.test(await page.textContent('.tn-cline')));
  let words = forbiddenIn(await readText(page));
  check('tenant page: no forbidden words', !words, words);
  let au = await auditControls(page, 40);
  check('tenant page: every button has words', !au.noText.length, au.noText.join(', '));
  check('tenant page: controls ≥ 40px on desktop', !au.small.length, au.small.join(', '));
  await page.click('.tn-dacts [data-act="more"]');
  await page.waitForSelector('.tn-morelist');
  const more = (await page.locator('.tn-moreitem-l').allTextContents()).join('|');
  check('More lists everything with words', ['Add a charge', 'Take money off what they owe', 'Raise or change the rent', 'Renew the lease', 'They are moving out', 'Edit their details', 'Remove this tenant'].every(x => more.includes(x)), more);
  check('More items have a one-line explanation', await page.locator('.tn-moreitem-s').count() === await page.locator('.tn-moreitem').count());
  await page.keyboard.press('Escape');
  await wait(200);

  // ---- part payment from the tenant page → wording → "Record the rest" clears it
  await ev(id => { location.hash = 't-' + id; }, nadia);
  await wait(200);
  check('part paid: status sentence', /^Has paid \$800 of \$1,475 for [A-Z][a-z]+\. Still owes \$675 — \d+ days late\.$/.test((await page.textContent('#tn-dstatus')).trim()), await page.textContent('#tn-dstatus'));
  check('part paid: primary says Record the rest ($675)', (await page.textContent('.tn-dacts .btn-primary')).trim() === 'Record the rest ($675)');
  check('part paid: history says "Part payment" and "paid so far"', /Part payment/.test(await page.textContent('.tn-ledger')) && /\$800 paid so far, \$675 still owed/.test(await page.textContent('.tn-ledger')));
  await page.click('.tn-dacts [data-act="more"]');
  await page.waitForSelector('.tn-morelist');
  check('part paid: More offers "Record another part payment"', (await page.textContent('.tn-morelist')).includes('Record another part payment'));
  await page.keyboard.press('Escape');
  await wait(200);
  // record another $300 part payment from the tenant page: More → Record another part payment
  await page.click('.tn-dacts [data-act="more"]');
  await page.click('.tn-moreitem[data-more="part"]');
  await page.waitForSelector('#pay-amount');
  await wait(80);
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
  check('history marks the final payment as "the rest"', /Payment — the rest/.test(await page.textContent('.tn-ledger')));

  // ---- Add a tenant: 3-step guide, Back keeps entries
  await ev(() => { location.hash = 'tenants'; });
  await wait(150);
  await ev(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.click('.tn-add-btn');
  await page.waitForSelector('#tf-name');
  check('guide says Step 1 of 3', /Step 1 of 3/.test(await page.textContent('.sheet')) && /Who is it\?/.test(await page.textContent('.sheet')));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(60);
  check('step 1 asks for the name', (await page.textContent('[data-field="name"] .field-error')).trim() === 'Write their name');
  await page.fill('#tf-name', 'Test Person');
  await page.fill('#tf-phone', '(555) 0199-1234');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('[data-seg-for="tf-proppick"]');
  check('step 2: existing properties as big choices', (await page.locator('[data-seg-for="tf-proppick"] button').allTextContents()).join('|').includes('Alder Court') && (await page.textContent('[data-seg-for="tf-proppick"]')).includes('A different property'));
  await page.click('[data-seg-for="tf-proppick"] [data-value="Alder Court"]');
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
  check('Back and forward keeps step 2 too', await page.inputValue('#tf-unit') === '9Z' && await page.getAttribute('[data-seg-for="tf-proppick"] [data-value="Alder Court"]', 'aria-pressed') === 'true');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#tf-rent');
  await page.fill('#tf-rent', '1500');
  await page.click('[data-seg-for="tf-hasend"] [data-value="yes"]');
  await page.fill('#tf-movein', monthStart);
  await page.fill('#tf-end', await ev(d => RB.date.addDays(RB.date.addMonths(d, 12), -1), monthStart));
  await page.fill('#tf-deposit', '1000');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(100);
  const summary = (await page.textContent('#tf-summary')).trim();
  const expect = await ev(d => 'Test Person, Unit 9Z at Alder Court, $1,500 a month from ' + RB.date.fmt(d, RB.store.today()) + '.', monthStart);
  check('summary sentence before saving', summary === expect, summary);
  check('button says "Add Test Person"', (await page.textContent('.sheet [data-action="next"]')).trim() === 'Add Test Person');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(300);
  const nid = await ev(() => (location.hash.match(/^#t-(.+)$/) || [])[1]);
  check('saving opens the new tenant', !!nid && (await page.textContent('.drawer .drawer-title')) === 'Test Person');
  const t0 = await ev(id => RB.store.tenant(id), nid);
  check('tenant saved with defaults (no extra questions)', t0.property === 'Alder Court' && t0.unit === '9Z' && t0.rent[0].amount === 150000 && t0.deposit.amount === 100000 && t0.trackFrom === monthStart && t0.opening === null && t0.phone === '(555) 0199-1234');
  check('page states the balance in words', (await page.textContent('#tn-dstatus')).trim().startsWith('Owes $1,500'));

  // ---- Edit their details: optional extras behind "Add more details (optional)"
  await ev(id => { RB.actions.editTenant(id); }, nid);
  await page.waitForSelector('#tf-more');
  check('extras are hidden behind a worded toggle', (await page.textContent('#tf-more')).trim() === 'Add more details (optional)' && await page.isHidden('#tf-opening'));
  await page.click('#tf-more');
  check('each extra explains itself', await ev(() => Array.from(document.querySelectorAll('#tf-more-body > .field')).filter(f => !f.querySelector('[name="insPolicy"], [name="insExpires"], [name="emPhone"]')).every(f => f.querySelector('.field-hint'))));
  check('glossary labels for extras', /Start counting rent from/.test(await page.textContent('#tf-more-body')) && /What they already owed/.test(await page.textContent('#tf-more-body')) && /Other monthly charges/.test(await page.textContent('#tf-more-body')));
  await page.fill('#tf-opening', '200');
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(200);
  check('edit saved: what they already owed', await ev(id => RB.store.ledger(id).balance, nid) === 170000);
  await ev(id => { RB.actions.editTenant(id, 'contact'); }, nid);
  await page.waitForSelector('#tf-phone');
  await wait(80);
  check('edit opens at the requested section', await ev(() => document.activeElement && document.activeElement.id === 'tf-phone'));
  await page.keyboard.press('Escape');
  await wait(200);

  // ---- Raise or change the rent
  await ev(id => { RB.actions.changeRent(id); }, nid);
  await page.waitForSelector('#cr-amount');
  check('change-rent asks a plain question', (await page.textContent('label[for="cr-amount"]')).trim() === 'What will the new rent be?');
  await page.fill('#cr-amount', '1600');
  await wait(50);
  check('change-rent sentence', /Rent changes from \$1,500 to \$1,600 on/.test(await page.textContent('#cr-sum')) && (await page.textContent('[data-action="save"]')).trim() === 'Change the rent to $1,600');
  await clearToasts(page);
  await page.click('[data-action="save"]');
  await wait(150);
  check('change rent appends to the schedule', (await ev(id => RB.store.tenant(id).rent, nid)).length === 2);

  // ---- payment, remove (it was a mistake), Undo, put back
  await page.click('.drawer .tn-dacts [data-act="pay"]');
  await page.waitForSelector('.sheet [data-action="save"]');
  await wait(80);
  check('payment sheet offers all of it', (await page.textContent('.sheet')).includes('Yes, all $1,700'));
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(250);
  check('payment clears the balance', await ev(id => RB.store.ledger(id).balance, nid) === 0 && (await page.textContent('#tn-dstatus')).trim() === 'All paid up');
  const payId = await ev(id => RB.store.ledger(id).rows.find(r => r.type === 'payment').id, nid);
  const moreBtn = page.locator(`.drawer [data-act="lmenu"][data-eid="${payId}"]`);
  check('row action is a worded "More"', (await moreBtn.textContent()).trim() === 'More');
  await moreBtn.click();
  const items = (await page.locator('.menu-item').allTextContents()).map(s => s.trim());
  check('row More: remove / receipt / change', items.some(s => s.includes('Remove this payment — it was a mistake')) && items.some(s => s.includes('Copy a receipt')) && items.some(s => s.includes('Change the details')), items.join(' | '));
  await page.click('.menu-item:has-text("Remove this payment")');
  await wait(150);
  check('removing restores what they owe', await ev(id => RB.store.ledger(id).balance, nid) === 170000);
  check('removed line is struck through and says why', await page.locator(`.drawer tr.is-void[data-row="${payId}"]`).count() === 1 && /Removed — it was a mistake/.test(await page.textContent(`.drawer tr[data-row="${payId}"]`)));
  check('toast says what happened, with Undo', /^Removed the \$1,700 payment/.test(await page.textContent('.toast:last-child .toast-msg')) && (await page.textContent('.toast:last-child .toast-action')).trim() === 'Undo');
  await page.click('.toast:last-child .toast-action');
  await wait(150);
  check('Undo puts it back', await ev(id => RB.store.ledger(id).balance, nid) === 0);

  // ---- notes: big "Add a note" → simple sheet
  await page.click('#tn-add-note');
  await page.waitForSelector('#tn-note-text');
  check('note sheet asks plain questions', /What happened\?/.test(await page.textContent('.sheet')) && /Remind me to follow up on/.test(await page.textContent('.sheet')) && (await page.locator('[data-seg-for="tn-note-kind"] button').allTextContents()).join('|') === 'Note|Phone call|Text|Email|Visit');
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(60);
  check('empty note explained', (await page.textContent('[data-field="text"] .field-error')).trim() === 'Write what happened first');
  await page.fill('#tn-note-text', 'Called about the key');
  await page.click('[data-seg-for="tn-note-kind"] [data-value="call"]');
  await page.fill('#tn-note-follow', today);
  await clearToasts(page);
  await page.click('.sheet [data-action="save"]');
  await wait(200);
  const log = await ev(id => Object.values(RB.store.tenant(id).log).filter(Boolean), nid);
  check('note added with kind + follow-up', log.length === 1 && log[0].kind === 'call' && log[0].followUp === today && log[0].text === 'Called about the key');
  check('follow-up shows on Today', await ev(id => RB.store.attention().some(a => a.kind === 'followup' && a.tenantId === id), nid));
  await page.click('.drawer [data-change="fudone"]');
  await wait(150);
  check('"Followed up" ticks it done', await ev(id => Object.values(RB.store.tenant(id).log).filter(Boolean)[0].done, nid) === true);
  const scrolled = await ev(() => { const b = document.querySelector('.drawer-body'); b.scrollTop = 400; return b.scrollTop; });
  await ev(id => RB.store.addEntry(id, { type: 'charge', date: RB.store.today(), amount: 1000, memo: 'Key copy', category: 'fee' }), nid);
  await wait(150);
  check('page scroll survives a store change', await ev(() => document.querySelector('.drawer-body').scrollTop) === scrolled);
  await ev(id => RB.store.addEntry(id, { type: 'payment', date: RB.store.today(), amount: 1000, method: 'Cash' }), nid);
  await wait(100);

  // ---- They are moving out: future date = moving out (notice); then finish with deposit sums
  const future = await ev(t => RB.date.addDays(t, 20), today);
  await ev(id => { RB.actions.moveOut(id); }, nid);
  await page.waitForSelector('#mo-date');
  check('move-out flow: step 1 asks when', /Step 1 of 3/.test(await page.textContent('.sheet')) && /When are they moving out\?/.test(await page.textContent('.sheet')));
  await page.fill('#mo-date', future);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#mo-owed');
  check('move-out flow: step 2 says what they still owe', /What they still owe/.test(await page.textContent('.sheet')) && /when they leave/.test(await page.textContent('#mo-owed')));
  check('final month part shown as a plain sum', /\d+ of \d+ days, so \$[\d,.]+ instead of \$[\d,]+/.test(await page.textContent('#mo-sum')) || /the whole month/.test(await page.textContent('#mo-sum')), await page.textContent('#mo-sum'));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(80);
  check('future date: deposit waits until they leave', /after they leave/.test(await page.textContent('.sheet')));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(80);
  check('future date: summary + button', /is moving out on/.test(await page.textContent('#mo-summary')) && /^Save — moving out /.test((await page.textContent('.sheet [data-action="next"]')).trim()));
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(300);
  const tf = await ev(id => { const t = RB.store.tenant(id); return { status: t.status, mo: t.lease.moveOut }; }, nid);
  check('future date: moving out (not moved out yet)', tf.status === 'notice' && tf.mo === future, JSON.stringify(tf));
  check('lease line says Moving out', /^Moving out /.test((await page.textContent('.tn-dlease')).trim()));
  await ev(d => RB.store.setToday(d), future);
  await wait(150);
  const it = await ev(id => RB.store.attention().find(a => a.kind === 'moveout' && a.tenantId === id), nid);
  check('on the day: Today offers to finish the move-out', !!it && it.action.type === 'moveOut', JSON.stringify(it && it.action));
  check('on the day: the page offers "Finish the move-out"', (await page.textContent('.tn-alerts').catch(() => '')).includes('Finish the move-out'));
  await ev(d => RB.store.setToday(d), today);
  await wait(150);
  await ev(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

  await ev(id => { RB.actions.moveOut(id); }, nid);
  await page.waitForSelector('#mo-date');
  await page.fill('#mo-date', today);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('#mo-owed');
  const owedAtMove = await ev(([id, d]) => RB.model.moveOutPreview(RB.store.tenant(id), RB.store.entries(id), RB.store.settings(), RB.store.today(), d).balance, [nid, today]);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await page.waitForSelector('[data-seg-for="sd-keep"]');
  check('deposit step asks plain questions', /Do you need to keep any of it\?/.test(await page.textContent('.sheet')));
  await page.click('[data-seg-for="sd-keep"] [data-value="yes"]');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(60);
  check('keeping nothing written is explained', /Write what you are keeping/.test(await page.textContent('#sd-ded-wrap')));
  await page.fill('[data-rep="ded"] [data-k="reason"]', 'Cleaning');
  await page.fill('[data-rep="ded"] [data-k="amount"]', '120');
  await wait(80);
  const dueBy = await ev(d => RB.date.fmt(RB.date.addDays(d, RB.store.settings().depositReturnDays), RB.store.today()), today);
  const refund = 100000 - 12000 - Math.max(0, owedAtMove) + Math.max(0, -owedAtMove);
  const sumText = (await page.textContent('#sd-sum')).trim();
  const fm = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const expectSum = 'Deposit $1,000 − cleaning $120' + (owedAtMove > 0 ? ' − unpaid rent ' + fm(owedAtMove) : '') + (owedAtMove < 0 ? ' + money they paid ahead ' + fm(-owedAtMove) : '') + ' = ' + fm(refund) + ' to give back, due by ' + dueBy + '.';
  check('deposit sums in plain words', sumText === expectSum, sumText + ' ≠ ' + expectSum);
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(80);
  check('summary repeats the sums', (await page.textContent('#mo-deposit')).trim() === expectSum && (await page.textContent('.sheet [data-action="next"]')).trim() === 'Finish the move-out');
  await clearToasts(page);
  await page.click('.sheet [data-action="next"]');
  await wait(300);
  const after = await ev(id => ({ status: RB.store.tenant(id).status, ret: RB.store.tenant(id).deposit.returned, bal: RB.store.ledger(id).balance }), nid);
  check('moved out + deposit settled', after.status === 'past' && after.ret && after.ret.refund === refund && after.ret.deductions[0].reason === 'Cleaning' && after.bal === 0, JSON.stringify(after));
  check('toast with Undo', /moved out on/.test(await page.textContent('.toast:last-child .toast-msg')));

  // ---- Remove this tenant: rule-8 confirm with "Keep it"
  await page.click('.drawer .tn-dacts [data-act="more"]');
  await page.click('.tn-moreitem[data-more="delete"]');
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
  check('deep link opens the tenant page', (await p2.textContent('.drawer .drawer-title')) === await p2.evaluate(id => RB.store.tenant(id).name, someId));
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
  check('phone XL list: large cards, no overflow', await p3.locator('.tn-row').count() === 26 && !(await overflow()), await overflow());
  au = await auditControls(p3, 48);
  check('phone XL list: tappable things ≥ 48px', !au.small.length, au.small.join(', '));
  const did = await p3.evaluate(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).delinquent).id);
  await p3.evaluate(id => { location.hash = 't-' + id; }, did);
  await wait(250);
  check('phone XL tenant page: Back visible, no overflow', await p3.isVisible('.drawer .tn-back') && !(await overflow()), await overflow());
  au = await auditControls(p3, 48);
  check('phone XL tenant page: tappable things ≥ 48px', !au.small.length, au.small.join(', '));
  check('phone XL tenant page: every button has words', !au.noText.length, au.noText.join(', '));
  check('phone payment history has no header row', await p3.evaluate(() => getComputedStyle(document.querySelector('.tn-ledger thead')).display === 'none'));
  for (const fn of ['editTenant', 'moveOut', 'changeRent', 'addTenant']) {
    await p3.evaluate(([f, id]) => { RB.actions[f](f === 'addTenant' ? undefined : id); }, [fn, did]);
    await wait(250);
    check('phone XL ' + fn + ' sheet: no overflow', !(await overflow()), await overflow());
    au = await auditControls(p3, 48);
    check('phone XL ' + fn + ' sheet: targets ≥ 48px', !au.small.length, au.small.join(', '));
    await p3.keyboard.press('Escape');
    await wait(200);
  }
  await p3.click('.drawer .tn-back');
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

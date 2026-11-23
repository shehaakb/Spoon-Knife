#!/usr/bin/env node
// Interaction smoke test for the Tenants view + tenant drawer + tenant sheets (local mode).
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

const browser = await chromium.launch();
async function open(viewport, hash) {
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
  if (hash) { await page.evaluate(h => { location.hash = h; }, hash); await wait(150); }
  return { ctx, page };
}

try {
  const { ctx, page } = await open({ width: 1360, height: 900 }, 'tenants');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const today = await ev(() => RB.store.today());
  const monthStart = today.slice(0, 7) + '-01';

  // ---- list basics
  check('list renders a row per current tenant', await page.locator('.tn-tbl tbody tr[data-id]').count() === 26);
  check('summary line', /26 tenants\s*·?\s*3 properties/.test(await page.textContent('.tn-summary')));
  check('default sort = urgency (first row is most urgent)', await ev(() => { const id = document.querySelector('.tn-tbl tbody tr[data-id]').dataset.id; const all = RB.store.tenantsList({ includePast: false }).map(t => RB.store.summary(t.id).urgency); return RB.store.summary(id).urgency === Math.min(...all); }));

  // ---- deep link to a past tenant while "All" is active: the list switches to Past so highlight/position agree
  const pastId = await ev(() => RB.store.tenantsList().find(t => t.status === 'past').id);
  await ev(id => { location.hash = 't-' + id; }, pastId);
  await wait(200);
  check('deep link to a past tenant switches the list to Past', await ev(() => document.querySelector('.chip[aria-pressed="true"]').dataset.k) === 'past');
  check('deep-linked past tenant row is highlighted', await page.locator('.tn-tbl tbody tr.is-selected[data-id="' + pastId + '"]').count() === 1);
  check('drawer shows its position in the list', /^1 of 1$/.test(((await page.textContent('.tn-pos').catch(() => '')) || '').trim()));
  await page.keyboard.press('Escape');
  await wait(250);
  check('deep link did not change the remembered filter', await ev(() => RB.prefs.get('tn:filter', 'all')) !== 'past');
  await page.click('.chip[data-k="all"]');
  await wait(60);

  // ---- filter chips, search, sort
  const owingCount = await ev(() => RB.store.tenantsList().filter(t => RB.store.ledger(t.id).balance > 0).length);
  await page.click('.chip[data-k="owing"]');
  await wait(60);
  const owingRows = await ev(() => Array.from(document.querySelectorAll('.tn-tbl tbody tr[data-id]')).map(r => RB.store.ledger(r.dataset.id).balance));
  check('Owing chip shows only owing tenants', owingRows.length === owingCount && owingRows.every(b => b > 0), owingRows.length + ' rows');
  await page.click('.chip[data-k="past"]');
  await wait(60);
  check('Past chip shows past tenants', await ev(() => Array.from(document.querySelectorAll('.tn-tbl tbody tr[data-id]')).every(r => RB.store.tenant(r.dataset.id).status === 'past')) && await page.locator('.tn-tbl tbody tr[data-id]').count() === 1);
  await page.click('.chip[data-k="all"]');
  await wait(60);
  await page.fill('#tn-q', 'okafor');
  await wait(200);
  check('filter-as-you-type matches name/co-tenant', await page.locator('.tn-tbl tbody tr[data-id]').count() === 1 && (await page.textContent('.tn-tbl tbody')).includes('Maya Okafor'));
  check('filter field keeps focus while typing', await ev(() => document.activeElement && document.activeElement.id === 'tn-q'));
  await page.fill('#tn-q', '0102');
  await wait(200);
  check('filter matches phone numbers', await page.locator('.tn-tbl tbody tr[data-id]').count() >= 1);
  await page.fill('#tn-q', 'zzzz-nothing');
  await wait(200);
  check('no-match state offers to clear', await page.locator('.empty [data-act="clearq"]').count() === 1);
  await page.click('.empty [data-act="clearq"]');
  await wait(80);
  await page.click('th button[data-k="balance"]');
  await wait(60);
  const bals = await ev(() => Array.from(document.querySelectorAll('.tn-tbl tbody tr[data-id]')).map(r => RB.store.ledger(r.dataset.id).balance));
  check('Balance header sorts high → low', bals.every((b, i) => i === 0 || bals[i - 1] >= b));
  await page.click('th button[data-k="balance"]');
  await wait(60);
  const bals2 = await ev(() => Array.from(document.querySelectorAll('.tn-tbl tbody tr[data-id]')).map(r => RB.store.ledger(r.dataset.id).balance));
  check('second click reverses', bals2.every((b, i) => i === 0 || bals2[i - 1] <= b));
  check('sort remembered in prefs', await ev(() => RB.prefs.get('tn:sort').key === 'balance'));
  await page.click('#tn-group');
  await wait(60);
  check('group by property adds group rows', await page.locator('.tn-tbl .tbl-group').count() === 3);
  await page.click('#tn-group');
  await page.click('[data-act="density"][data-v="compact"]');
  await wait(60);
  check('compact density', await page.locator('.tn-tbl.tbl-compact').count() === 1 && await ev(() => RB.prefs.get('tn:density') === 'compact'));
  await page.click('[data-act="density"][data-v="comfortable"]');
  await page.click('[data-act="sortmenu"]');
  await page.click('.menu-item:has-text("Urgency")');
  await wait(60);

  // ---- keyboard: j/k cursor, Enter opens, j/k step in drawer, Esc
  await ev(() => document.activeElement && document.activeElement.blur());
  const order = await ev(() => RB._tn.order.slice());
  await page.keyboard.press('j');
  await wait(40);
  check('j moves the row cursor', await page.locator('.tn-tbl tr.is-focused').getAttribute('data-id') === order[0]);
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await page.keyboard.press('Enter');
  await wait(150);
  check('Enter opens the cursor row', await ev(() => location.hash) === '#t-' + order[0] && await page.locator('.drawer').count() === 1);
  check('open row highlighted beside the drawer', await page.locator('.tn-tbl tr.is-selected').getAttribute('data-id') === order[0] && await page.isVisible('.tn-tbl tr.is-selected'));
  await page.keyboard.press('j');
  await wait(120);
  check('j steps to next tenant in list order', await ev(() => location.hash) === '#t-' + order[1]);
  await page.keyboard.press('ArrowDown');
  await wait(120);
  await page.keyboard.press('ArrowUp');
  await wait(120);
  check('↓/↑ step too', await ev(() => location.hash) === '#t-' + order[1]);
  await page.keyboard.press('Escape');
  await wait(220);
  check('Esc closes the drawer back to #tenants', await ev(() => location.hash) === '#tenants' && await page.locator('.drawer').count() === 0);

  // ---- add tenant
  await page.click('.tn-add-btn');
  await page.waitForSelector('#tf-name');
  await page.click('[data-action="save"]');
  check('add form validates required fields', await page.locator('.sheet .field.is-invalid').count() >= 3);
  await page.fill('#tf-name', 'Test Person');
  await page.fill('#tf-property', 'Alder Court');
  await page.fill('#tf-unit', '9Z');
  await page.fill('#tf-start', monthStart);
  await page.fill('#tf-rent', '1500');
  await page.fill('#tf-deposit', '1000');
  await page.fill('#tf-opening', '200');
  check('move-in follows lease start', await page.inputValue('#tf-movein') === monthStart);
  check('tracking defaults to move-in for a new lease', await page.inputValue('#tf-track') === monthStart);
  check('tracking hint explains charges', (await page.textContent('#tf-track-note')).includes('Rent charges are generated from'));
  await page.click('[data-action="save"]');
  await wait(250);
  const nid = await ev(() => (location.hash.match(/^#t-(.+)$/) || [])[1]);
  check('saving opens the new tenant', !!nid && await page.locator('.drawer .drawer-title').textContent() === 'Test Person');
  const lg = await ev(id => { const l = RB.store.ledger(id); return { bal: l.balance, rows: l.rows.map(r => r.id + ':' + r.amount) }; }, nid);
  check('ledger starts with opening + this month’s rent', lg.bal === 170000 && lg.rows.includes('opening:20000') && lg.rows.some(r => r.startsWith('rent-') && r.endsWith(':150000')), JSON.stringify(lg));
  check('drawer states the balance in words', (await page.textContent('.tn-balw')).replace(/\s+/g, '') === 'Owes$1,700');

  // ---- edit details (section)
  await ev(id => { RB.actions.editTenant(id, 'contact'); }, nid);
  await page.waitForSelector('#tf-phone');
  await wait(80);
  check('edit opens at the requested section', await ev(() => document.activeElement && document.activeElement.id === 'tf-phone'));
  await page.fill('#tf-phone', '(555) 0199-1234');
  await page.click('[data-action="save"]');
  await wait(150);
  check('edit saved and shown in the drawer', await ev(id => RB.store.tenant(id).phone, nid) === '(555) 0199-1234' && (await page.textContent('.drawer')).includes('(555) 0199-1234'));

  // ---- change rent
  await ev(id => { RB.actions.changeRent(id); }, nid);
  await page.waitForSelector('#cr-amount');
  await page.fill('#cr-amount', '1600');
  await wait(50);
  check('change-rent sentence', /Rent changes from \$1,500 to \$1,600 on/.test(await page.textContent('#cr-sum')));
  await page.click('[data-action="save"]');
  await wait(150);
  const rent = await ev(id => RB.store.tenant(id).rent, nid);
  check('change rent appends to the schedule', rent.length === 2 && rent[0].amount === 150000 && rent[1].amount === 160000);

  // ---- record payment from the drawer
  await page.click('.drawer .tn-dacts [data-act="pay"]');
  await page.waitForSelector('#pay-amount');
  await page.fill('#pay-amount', '1700');
  await page.press('#pay-amount', 'Enter');
  await wait(250);
  check('payment from drawer clears the balance', await ev(id => RB.store.ledger(id).balance, nid) === 0);
  check('drawer header updates to Paid up', (await page.textContent('.tn-balw')).includes('Paid up'));

  // ---- void + undo from the ledger row menu
  const payId = await ev(id => RB.store.ledger(id).rows.find(r => r.type === 'payment').id, nid);
  await page.click(`.drawer [data-act="lmenu"][data-eid="${payId}"]`);
  await page.click('.menu-item:has-text("Void")');
  await wait(120);
  check('void restores the balance', await ev(id => RB.store.ledger(id).balance, nid) === 170000);
  check('voided row struck through', await page.locator(`.drawer tr.is-void[data-row="${payId}"]`).count() === 1);
  await page.click('.toast:last-child .toast-action');
  await wait(120);
  check('Undo un-voids', await ev(id => RB.store.ledger(id).balance, nid) === 0);

  // ---- note with follow-up; composer survives store changes; tick done
  await page.fill('#tn-note-text', 'Half-typed note');
  const scrolled = await ev(() => { const b = document.querySelector('.drawer-body'); b.scrollTop = 400; return b.scrollTop; });
  await ev(id => RB.store.addEntry(id, { type: 'charge', date: RB.store.today(), amount: 1000, memo: 'Key copy', category: 'fee' }), nid);
  await wait(150);
  check('half-typed note survives a store change', await page.inputValue('#tn-note-text') === 'Half-typed note');
  check('drawer scroll survives a store change', await ev(() => document.querySelector('.drawer-body').scrollTop) === scrolled);
  await page.fill('#tn-note-text', 'Called about the key');
  await page.click('.tn-composer .seg button[data-value="call"]');
  await page.fill('#tn-note-follow', today);
  await page.click('.tn-composer button[type="submit"]');
  await wait(150);
  const log = await ev(id => Object.values(RB.store.tenant(id).log).filter(Boolean), nid);
  check('note added with kind + follow-up', log.length === 1 && log[0].kind === 'call' && log[0].followUp === today && log[0].text === 'Called about the key');
  check('composer cleared after adding', await page.inputValue('#tn-note-text') === '');
  check('follow-up shows on Today', await ev(id => RB.store.attention().some(a => a.kind === 'followup' && a.tenantId === id), nid));
  await page.click('.drawer [data-change="fudone"]');
  await wait(120);
  check('follow-up ticked done', await ev(id => Object.values(RB.store.tenant(id).log).filter(Boolean)[0].done, nid) === true);

  // ---- give notice
  await ev(id => { RB.actions.giveNotice(id); }, nid);
  await page.waitForSelector('#gn-moveout');
  await page.click('[data-action="save"]');
  await wait(150);
  check('give notice → status notice', await ev(id => RB.store.tenant(id).status, nid) === 'notice' && (await page.textContent('.tn-dtags')).includes('Notice given'));

  // ---- move out with a future date = notice, then "Complete move-out" once the date arrives
  const future = await ev(t => RB.date.addDays(t, 20), today);
  const futureFmt = await ev(([d, t]) => RB.date.fmt(d, t), [future, today]);
  const firstName = await ev(id => RB.store.tenant(id).name.split(' ')[0], nid);
  await ev(id => { RB.actions.moveOut(id); }, nid);
  await page.waitForSelector('#mo-date');
  await page.fill('#mo-date', future);
  await wait(60);
  check('future move-out: sheet says it is recorded as notice', ((await page.textContent('#mo-future').catch(() => '')) || '').includes(firstName + ' moves out ' + futureFmt + ' — recorded as notice.'), await page.textContent('#mo-sum'));
  check('future move-out: button says notice', (await page.textContent('[data-action="save"]')).includes('Record notice'));
  await page.click('[data-action="save"]');
  await wait(300);
  const tf = await ev(id => { const t = RB.store.tenant(id); return { status: t.status, mo: t.lease.moveOut }; }, nid);
  check('future move-out: status notice (not past), moveOut set', tf.status === 'notice' && tf.mo === future, JSON.stringify(tf));
  check('future move-out: no deposit settlement yet', await page.locator('#sd-date').count() === 0);
  await ev(d => RB.store.setToday(d), future);
  await wait(150);
  const it = await ev(id => RB.store.attention().find(a => a.kind === 'moveout' && a.tenantId === id), nid);
  check('on the date: Today offers Complete move-out', !!it && it.action.type === 'moveOut' && it.action.label === 'Complete move-out', JSON.stringify(it && it.action));
  check('on the date: drawer offers Complete move-out', (await page.textContent('.tn-alerts').catch(() => '')).includes('Complete move-out'));
  await ev(d => RB.store.setToday(d), today);
  await wait(150);
  await ev(() => document.querySelectorAll(".toast").forEach(t => t.remove()));

  // ---- move out → settle deposit
  await ev(id => { RB.actions.moveOut(id); }, nid);
  await page.waitForSelector('#mo-date');
  await page.fill('#mo-date', today);
  await wait(60);
  check('move-out shows the final month and what is owed', /Final month/.test(await page.textContent('#mo-sum')) && /Still owed at move-out|Credit at move-out/.test(await page.textContent('#mo-sum')));
  await page.click('[data-action="save"]');
  await page.waitForSelector('#sd-date', { timeout: 3000 });
  check('move-out → status past, then deposit settlement offered', await ev(id => RB.store.tenant(id).status, nid) === 'past');
  const owedNow = await ev(id => RB.store.ledger(id).balance, nid);
  await page.fill('[data-rep="ded"] [data-k="reason"]', 'Cleaning');
  await page.fill('[data-rep="ded"] [data-k="amount"]', '100');
  await wait(60);
  const expectRefund = 100000 - 10000 - owedNow;
  check('refund auto-computed', (await page.textContent('#sd-sum')).replace(/\s+/g, '').includes(('Refundtotenant$' + (expectRefund / 100).toLocaleString('en-US')).replace(/\s+/g, '')), 'owed ' + owedNow);
  await page.click('[data-action="save"]');
  await wait(200);
  const ret = await ev(id => RB.store.tenant(id).deposit.returned, nid);
  check('deposit settlement recorded', ret && ret.refund === expectRefund && ret.deductions.length === 1 && ret.deductions[0].reason === 'Cleaning');
  check('deposit applied to balance as a credit', await ev(id => RB.store.ledger(id).balance, nid) === 0);

  // ---- delete with confirm
  await page.click('.drawer [data-act="more"]');
  await page.click('.menu-item:has-text("Delete tenant")');
  await page.waitForSelector('[data-action="confirm"]');
  check('delete confirm names the tenant', (await page.textContent('.sheet-body')).includes('Test Person'));
  await page.click('[data-action="confirm"]');
  await wait(250);
  check('tenant deleted, back on #tenants', !(await ev(id => !!RB.store.tenant(id), nid)) && await ev(() => location.hash) === '#tenants');

  // ---- hostile strings stay escaped
  await ev(() => RB.store.addTenant({ id: 'xssT1', name: '<img src=x onerror="window.__x=1">', unit: '<b>9</b>', property: '"><svg onload="window.__x=2">', phone: '<i>1</i>', email: 'a@b.co"><script>window.__x=3<' + '/script>', about: '<iframe src="javascript:window.__x=4">', coTenants: [{ name: '<u>co</u>' }], links: [{ id: 'l1', label: '<b>bad</b>', url: 'javascript:window.__x=5' }, { id: 'l2', label: 'ok', url: 'https://example.com/"onmouseover="window.__x=6' }], rent: [{ from: '2026-01-01', amount: 100000 }], lease: { start: '2026-01-01', moveIn: '2026-01-01' }, log: { a: { at: new Date().toISOString(), kind: '<b>x</b>', text: '<img src=x onerror="window.__x=7">', followUp: null, done: false } } }));
  await ev(() => { location.hash = 'tenants'; });
  await wait(100);
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
  check('deep link opens the drawer', await p2.locator('.drawer .drawer-title').count() === 1 && (await p2.textContent('.drawer .drawer-title')) === await p2.evaluate(id => RB.store.tenant(id).name, someId));
  await p2.evaluate(() => { location.hash = 't-doesNotExist'; });
  await wait(200);
  check('unknown id shows a tidy not-found state', (await p2.textContent('.drawer')).includes('Tenant not found'));
  await p2.click('.drawer [data-act="back"]');
  await wait(200);
  check('not-found → back to tenants', await p2.evaluate(() => location.hash) === '#tenants');
  await c2.close();

  // ---- phone: no sideways overflow on list, drawer, sheets
  const { ctx: c3, page: p3 } = await open({ width: 390, height: 844 }, 'tenants');
  const overflow = () => p3.evaluate(() => {
    const W = window.innerWidth;
    const bad = Array.from(document.querySelectorAll('#rb-view *, .drawer *, .sheet *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1 && !e.closest('.chips-scroll, .seg, .hide-phone'); });
    return document.documentElement.scrollWidth > W || bad.length ? (document.documentElement.scrollWidth + ' ' + bad.slice(0, 3).map(e => e.tagName + '.' + e.className).join(' ')) : '';
  });
  check('phone list: cards, no overflow', await p3.locator('.tn-clist .tn-card').count() === 26 && !(await overflow()), await overflow());
  const did = await p3.evaluate(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).delinquent).id);
  await p3.evaluate(id => { location.hash = 't-' + id; }, did);
  await wait(250);
  check('phone drawer: full screen with back control, no overflow', await p3.isVisible('.drawer .tn-back') && !(await overflow()), await overflow());
  check('phone ledger has no header row and fits', await p3.evaluate(() => getComputedStyle(document.querySelector('.tn-ledger thead')).display === 'none'));
  for (const fn of ['editTenant', 'moveOut', 'changeRent']) {
    await p3.evaluate(([f, id]) => { RB.actions[f](id); }, [fn, did]);
    await wait(250);
    check('phone ' + fn + ' sheet: no overflow', !(await overflow()), await overflow());
    await p3.keyboard.press('Escape');
    await wait(200);
  }
  await p3.click('.drawer .tn-back');
  await wait(200);
  check('phone back control returns to the list', await p3.evaluate(() => location.hash) === '#tenants');
  await c3.close();
  await ctx.close();
} catch (e) {
  check('smoke run completed', false, e.message.split('\n')[0]);
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

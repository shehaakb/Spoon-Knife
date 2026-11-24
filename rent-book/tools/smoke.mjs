#!/usr/bin/env node
// Interaction smoke test against dist/preview.html (local mode). Usage: node tools/smoke.mjs  (run build.mjs first)
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.goto(url + '#today');
await page.waitForFunction(() => RB.store.state.ready);

check('first run shows when empty', await page.locator('.firstrun').count() === 1);
await page.click('[data-cmd="sample:load"]');
await page.waitForFunction(() => RB.store.tenantsList().length === 27);
check('sample loads 27 tenants', true);
check('sample banner visible', await page.isVisible('#rb-banner'));

// quick pay + undo
const tid = await page.evaluate(() => RB.store.tenantsList().find(t => RB.store.ledger(t.id).current.status === 'late' && !RB.store.ledger(t.id).delinquent).id);
const before = await page.evaluate(id => RB.store.ledger(id).balance, tid);
await page.evaluate(id => { RB.actions.recordPayment(id, { quick: true }); }, tid);
await page.waitForTimeout(50);
check('quick payment zeroes balance', await page.evaluate(id => RB.store.ledger(id).balance, tid) === 0);
await page.click('.toast-action');
await page.waitForTimeout(50);
check('undo restores balance', await page.evaluate(id => RB.store.ledger(id).balance, tid) === before);
check('undone entry hidden from ledger rows', await page.evaluate(id => !RB.store.ledger(id).rows.some(r => r.entry && r.entry.undone), tid));

// payment sheet: "Only part of it", type amount, submit with Enter
await page.evaluate(id => { RB.actions.recordPayment(id); }, tid);
await page.waitForSelector('#pay-how-1');
await page.click('label[for="pay-how-1"]');
await page.fill('#pay-amount', '100');
check('live sentence says what is left', (await page.textContent('.sheet-foot-note')).startsWith('After this, '));
check('button label says what happens', (await page.textContent('[data-action="save"]')).trim() === 'Record $100');
await page.press('#pay-amount', 'Enter');
await page.waitForTimeout(300);
check('sheet closed after Enter', await page.locator('.sheet').count() === 0);
check('payment of $100 recorded', await page.evaluate((a) => RB.store.ledger(a.id).balance === a.b - 10000, { id: tid, b: before }));

// validation
await page.evaluate(id => { RB.actions.addCharge(id); }, tid);
await page.waitForSelector('#chg-memo');
await page.click('[data-action="save"]');
check('required errors shown', await page.locator('.field.is-invalid').count() >= 2);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('Esc closes sheet', await page.locator('.sheet').count() === 0);

// keyboard navigation
await page.keyboard.press('g'); await page.keyboard.press('r');
await page.waitForTimeout(100);
check('g r goes to Rent', await page.evaluate(() => location.hash === '#rent'));
await page.keyboard.press('Control+k');
check('Ctrl-K opens palette', await page.locator('.palette').count() === 1);
await page.keyboard.type('okafor');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('palette opens tenant drawer', await page.evaluate(() => /^#t-/.test(location.hash)) && await page.locator('.drawer').count() === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('Esc closes drawer and returns to #tenants', await page.evaluate(() => location.hash === '#tenants') && await page.locator('.drawer').count() === 0);
await page.keyboard.press('?');
check('? still opens keyboard shortcuts', (await page.textContent('.sheet-title')) === 'Keyboard shortcuts');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('shortcuts are not advertised in the shell', !/shortcut/i.test(await page.evaluate(() => document.getElementById('rb-rail').innerText + document.getElementById('rb-topbar').innerText)));

// words, not symbols: every button/link in the shell has visible text
await page.evaluate(() => { location.hash = 'today'; });
await page.waitForTimeout(150);
const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('#rb-rail a, #rb-rail button, #rb-topbar a, #rb-topbar button, #rb-banner button, #rb-view button')).filter(e => e.offsetParent !== null && !(e.innerText || '').trim()).map(e => e.id || e.className));
check('shell + Today: no button without visible words', !unnamed.length, unnamed.join(', '));
check('nav labels', (await page.$$eval('.rail-link-label', els => els.map(e => e.textContent.trim()).join(' · '))) === 'Today · Rent · Tenants · Leases · Repairs · Reports · Settings');
check('top bar: title + Find only (no "+ Add" menu)', await page.locator('#rb-add').count() === 0 && (await page.textContent('#rb-find')).trim() === 'Find' && await page.locator('#rb-topbar button:visible, #rb-topbar a:visible').count() <= 2);
check('sidebar: badge only on Today', await page.locator('#rb-nav .rail-count').count() === 1 && await page.locator('#rb-nav-today .rail-count').count() === 1);
check('sidebar: no sync note (it lives in Settings)', await page.locator('#rb-rail .sync-note').count() === 0 && /saved on this device only|Everything is saved/.test(String(await page.evaluate(() => String(RB.ui.syncNote())))));
check('banner: one line, one link', (await page.evaluate(() => document.getElementById('rb-banner').innerText)).replace(/\s+/g, ' ').trim() === 'These are example tenants — Remove them' && await page.evaluate(() => document.getElementById('rb-banner').getBoundingClientRect().height <= 96) && await page.locator('#rb-banner button').count() === 1);
check('"n" opens what-would-you-like-to-do as a sheet', await (async () => { await page.keyboard.press('n'); await page.waitForTimeout(150); const ok = ((await page.textContent('.sheet-title')) || '') === 'What would you like to do?'; await page.keyboard.press('Escape'); await page.waitForTimeout(250); return ok; })());
await page.evaluate(() => { location.hash = 'upkeep'; }); await page.waitForTimeout(120);
check('#upkeep shows Repairs', await page.evaluate(() => document.querySelector('#rb-nav-repairs').getAttribute('aria-current') === 'page'));
await page.evaluate(() => { location.hash = 'rent'; }); await page.waitForTimeout(120);
await page.click('#rb-brand'); await page.waitForTimeout(120);
check('app name returns to Today', await page.evaluate(() => location.hash === '#today'));

// text size: changes computed size, persists across reload
const fs = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
const f0 = await fs();
await page.click('#rb-ts-xl');
await page.waitForTimeout(100);
const f1 = await fs();
check('text size: Extra large makes body text 25% bigger', Math.abs(f1 - f0 * 1.25) < 0.05, f0 + ' → ' + f1);
check('text size: three "A" buttons with accessible names, the choice written beneath', await page.$$eval('#rb-sync [data-textsize]', els => els.map(e => e.textContent.trim() + '/' + e.getAttribute('aria-label')).join('|')) === 'A/Normal text|A/Large text|A/Extra large text' && ((await page.textContent('#rb-sync .textsize-now')) || '').trim() === 'Text size: Extra large');
await page.reload(); await page.waitForFunction(() => RB.store.state.ready); await page.waitForTimeout(100);
check('text size: remembered after reload', Math.abs(await fs() - f1) < 0.05 && await page.evaluate(() => document.querySelector('#rb-ts-xl').getAttribute('aria-pressed') === 'true'));
await page.click('#rb-ts-lg');
await page.waitForTimeout(100);
check('text size: Large = 112%', Math.abs(await fs() - f0 * 1.12) < 0.05);
await page.click('#rb-ts-normal');

// law 10: a toast is gone the moment a sheet opens; a toast raised under a sheet waits for it to close; sheets never stack
await page.evaluate(() => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); RB.ui.toast('Before the sheet', { undo: () => {} }); });
await page.waitForTimeout(50);
await page.evaluate(id => { RB.actions.addNote(id); }, tid);
await page.waitForTimeout(20);
check('toast: gone the moment a sheet opens', await page.evaluate(() => !Array.from(document.querySelectorAll('.toast')).some(t => !t.classList.contains('is-closing'))));
await page.evaluate(() => RB.ui.toast('Raised under the sheet'));
await page.waitForTimeout(250);
check('toast: never shown over an open sheet', await page.evaluate(() => { const t = document.querySelector('.toast:not(.is-closing)'); const s = document.querySelector('.sheet-wrap:not(.is-closing) .sheet'); if (!t) return true; const a = t.getBoundingClientRect(), b = s.getBoundingClientRect(); return !(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top); }));
await page.evaluate(id => { RB.actions.addCharge(id); }, tid);
await page.waitForTimeout(300);
check('sheets never stack: opening one from another replaces it', await page.locator('.sheet-wrap:not(.is-closing)').count() === 1 && ((await page.textContent('.sheet-wrap:not(.is-closing) .sheet-title')) || '') === 'Add a charge');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('toast: held toast shows once the sheet has closed', await page.evaluate(() => Array.from(document.querySelectorAll('.toast-msg')).some(t => t.textContent === 'Raised under the sheet')));
await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

// toast stays at least 9 seconds
await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); RB.ui.toast('Test message', { undo: () => {} }); });
await page.waitForTimeout(9200);
check('toast: still showing after 9 s, with a big Undo', await page.locator('.toast').count() === 1 && (await page.textContent('.toast-action')).trim() === 'Undo' && await page.evaluate(() => document.querySelector('.toast-action').getBoundingClientRect().height >= 40));
await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

// Help: "How do I…?" — every answer starts its task
await page.click('#rb-help');
await page.waitForSelector('.help-item');
const helpIds = await page.$$eval('.help-item', els => els.map(e => e.id.replace('help-', '')));
check('help: nine plain answers', helpIds.length === 9, helpIds.join(','));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
for (const id of helpIds) {
  await page.evaluate(() => { RB.ui.closeAll(); location.hash = 'today'; });
  await page.waitForTimeout(120);
  await page.evaluate(() => RB.shell.helpSheet());
  await page.waitForSelector('#help-go-' + id);
  await page.click('#help-go-' + id);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ hash: location.hash, sheet: (document.querySelector('.sheet-title') || {}).textContent || '' }));
  const ok = { owes: r.hash === '#rent', history: r.hash === '#repairs' }[id] ?? (r.sheet && r.sheet !== 'How do I…?');
  check('help: "' + id + '" starts its task', !!ok, JSON.stringify(r));
  check('help: "' + id + '" — one sheet at a time', await page.locator('.sheet-wrap:not(.is-closing)').count() <= 1);
}
await page.evaluate(() => RB.ui.closeAll());

// re-render must not clobber a focused input: focus kit search, trigger a store change
await page.evaluate(() => { location.hash = 'kit'; });
await page.waitForTimeout(100);
await page.fill('#kit-search', 'abc');
await page.focus('#kit-search');
await page.evaluate(id => { RB.store.addLog(id, { text: 'x' }); }, tid);
await page.waitForTimeout(100);
check('focused input survives store change', await page.evaluate(() => document.activeElement && document.activeElement.id === 'kit-search' && document.activeElement.value === 'abc'));

// XSS: names are escaped everywhere
await page.evaluate(() => RB.store.addTenant({ id: 'xss1', name: '<img src=x onerror="window.__x=1">', unit: '<b>9</b>', property: 'Q', rent: [{ from: '2026-01-01', amount: 100000 }], lease: { start: '2026-01-01', moveIn: '2026-01-01' } }));
for (const r of ['today', 'rent', 'tenants', 'leases', 'reports', 't-xss1']) { await page.evaluate(h => { location.hash = h; }, r); await page.waitForTimeout(80); }
await page.evaluate(() => RB.shell.openPalette('img')); await page.waitForTimeout(80); await page.keyboard.press('Escape');
check('store strings are escaped', await page.evaluate(() => !window.__x && !document.querySelector('#rb-view img, .drawer img, b')));

// remove sample with confirm
await page.evaluate(() => { location.hash = 'setup'; });
await page.waitForTimeout(100);
await page.click('#setup-remove-sample');
await page.waitForSelector('[data-action="confirm"]');
check('confirm names what is removed', (await page.textContent('.sheet-body')).includes('27 sample tenants'));
await page.waitForTimeout(100);
check('confirm: big "Keep it" has focus, red worded button', await page.evaluate(() => document.activeElement.dataset.action === 'keep' && document.activeElement.textContent.trim() === 'Keep it') && (await page.textContent('[data-action="confirm"]')).trim() === 'Remove sample tenants');
await page.click('[data-action="confirm"]');
await page.waitForTimeout(200);
check('sample removed, own tenant kept', await page.evaluate(() => RB.store.tenantsList().length === 1 && !RB.store.hasSample()));

// local persistence across reload
await page.reload();
await page.waitForFunction(() => RB.store.state.ready);
check('local mode persists across reload', await page.evaluate(() => RB.store.tenantsList().length === 1));

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));

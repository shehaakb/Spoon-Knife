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

// payment sheet: type amount, submit with Enter
await page.evaluate(id => { RB.actions.recordPayment(id); }, tid);
await page.waitForSelector('#pay-amount');
await page.fill('#pay-amount', '100');
check('live balance-after note', (await page.textContent('.sheet-foot-note')).includes('Balance after'));
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
check('? opens shortcuts', (await page.textContent('.sheet-title')) === 'Keyboard shortcuts');
await page.keyboard.press('Escape');

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

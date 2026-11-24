#!/usr/bin/env node
// Screenshots of every route (and a few interaction scenarios) at desktop + phone, light + dark.
// Usage: node tools/shots.mjs [--only rent,kit] [--no-build] [--size desktop|phone|rail|wide] [--theme light|dark] [--text normal|lg|xl]
// --text sets the Text size preference before load; lg/xl files get a -lg/-xl suffix (e.g. rent-phone-light-xl.png).
// Default sizes: desktop (1360) and phone (390). `rail` (900, icon rail) and `wide` (1600) run only when asked for.
// Writes rent-book/shots/<scenario>-<size>-<theme>.png. Exits 1 on console errors or horizontal overflow at phone width.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots');
const FONT_CACHE = join(OUT, '.fonts');
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const only = (arg('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
const sizesArg = arg('--size');
const themesArg = arg('--theme');
const textArg = arg('--text') || 'normal';
const textSuffix = textArg === 'normal' ? '' : '-' + textArg;

if (!args.includes('--no-build')) execFileSync(process.execPath, [join(ROOT, 'build.mjs')], { stdio: 'inherit' });
mkdirSync(FONT_CACHE, { recursive: true });

const SIZES = { desktop: { width: 1360, height: 900 }, phone: { width: 390, height: 844 }, rail: { width: 900, height: 900 }, wide: { width: 1600, height: 1000 } };
const DEFAULT_SIZES = ['desktop', 'phone'];
const THEMES = ['light', 'dark'];

// Named scenarios. `route` is the hash; `setup(page, ids)` runs after navigation; `full` = full-page screenshot.
const SCENARIOS = [
  { name: 'today', route: 'today', full: true },
  { name: 'rent', route: 'rent', full: true },
  { name: 'tenants', route: 'tenants', full: true },
  { name: 'tenant-detail', route: ids => 't-' + ids.delinquent },
  { name: 'leases', route: 'leases', full: true },
  { name: 'upkeep', route: 'upkeep', full: true, setup: p => p.click('#rp-tab-todo') },
  { name: 'repairs-history', route: 'repairs', full: true, setup: p => p.click('#rp-tab-history') },
  { name: 'property-history', route: 'p-alder-court', full: true },
  { name: 'past-repair-form', route: 'p-alder-court', setup: async p => { await p.click('#pp-past'); await p.waitForSelector('#pr-title'); await p.fill('#pr-title', 'Leaking kitchen tap'); } },
  { name: 'reports', route: 'reports', full: true, setup: p => p.evaluate(() => { RB.prefs.set('reports:tab', 'roll'); document.getElementById('rp-tab-roll').click(); }) },
  { name: 'reports-aging', route: 'reports', full: true, setup: p => p.click('#rp-tab-aging') },
  { name: 'reports-collection', route: 'reports', full: true, setup: p => p.click('#rp-tab-collection') },
  { name: 'reports-income', route: 'reports', full: true, setup: p => p.click('#rp-tab-income') },
  { name: 'rent-past', route: 'rent', setup: p => p.click('#rent-prev') },
  { name: 'move-out-sheet', route: ids => 't-' + ids.notice, setup: (p, ids) => p.evaluate(id => { RB.actions.moveOut(id); }, ids.notice) },
  { name: 'setup', route: 'setup', full: true },
  { name: 'kit', route: 'kit', full: true },
  { name: 'payment-sheet', route: 'rent', setup: (p, ids) => p.evaluate(id => { RB.actions.recordPayment(id); }, ids.late) },
  { name: 'palette', route: 'today', setup: p => p.evaluate(() => { RB.shell.openPalette('al'); }) },
  { name: 'choices', route: 'rent', setup: async (p, ids) => { await p.evaluate(() => RB.shell.go('rent', 'owes')); await p.waitForTimeout(120); await p.click('#rent-row-' + ids.late); } },
  { name: 'recent', route: 'today', setup: p => p.click('#td-recent') },
  { name: 'today-all', route: 'today', full: true, setup: p => p.click('#td-more') },
  { name: 'more', route: 'today', sizes: ['phone'], setup: p => p.click('#rb-more') },
  { name: 'help', route: 'today', setup: p => p.click(p.viewportSize().width < 760 ? '#rb-more' : '#rb-help').then(() => p.viewportSize().width < 760 ? p.click('#more-help') : null) },
  { name: 'keys', route: 'rent', sizes: ['desktop'], setup: p => p.keyboard.press('?') },
  { name: 'payment-part', route: 'rent', setup: async (p, ids) => { await p.evaluate(id => { RB.actions.recordPayment(id); }, ids.unpaid); await p.waitForSelector('#pay-how-1'); await p.click('label[for="pay-how-1"]'); await p.fill('#pay-amount', '1000'); } },
  { name: 'pick-tenant', route: 'today', setup: p => p.click('#td-task-pay') },
  { name: 'confirm', route: 'today', sizes: ['phone'], setup: p => p.evaluate(() => { RB.actions.removeSample(); }) },
  { name: 'toast', route: 'rent', setup: (p, ids) => p.evaluate(id => { RB.actions.recordPayment(id, { quick: true }); }, ids.late) },
  { name: 'first-run', route: 'today', empty: true, full: true },
];

// Serve Google Fonts through curl (the sandbox proxy) with a disk cache, so screenshots use the real faces.
function fetchCached(url) {
  const key = createHash('sha1').update(url).digest('hex');
  const file = join(FONT_CACHE, key);
  if (existsSync(file)) return readFileSync(file);
  try {
    const buf = execFileSync('curl', ['-sSfL', '--max-time', '20', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', url], { maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(file, buf);
    return buf;
  } catch (e) { return null; }
}

const problems = [];
const browser = await chromium.launch();
const url = pathToFileURL(join(ROOT, 'dist', 'preview.html')).href;
const want = s => !only.length || only.some(o => s.name === o || s.name.includes(o));

for (const sizeName of Object.keys(SIZES)) {
  if (sizesArg ? !sizesArg.split(',').includes(sizeName) : !DEFAULT_SIZES.includes(sizeName)) continue;
  for (const theme of THEMES) {
    if (themesArg && themesArg !== theme) continue;
    for (const empty of [false, true]) {
      const list = SCENARIOS.filter(s => !!s.empty === empty && want(s) && (!s.sizes || s.sizes.includes(sizeName)));
      if (!list.length) continue;
      const context = await browser.newContext({ viewport: SIZES[sizeName], colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: sizeName === 'phone' ? 2 : 1 });
      if (textArg !== 'normal') await context.addInitScript(v => { try { localStorage.setItem('rb:textSize', JSON.stringify(v)); } catch (e) { /* ignore */ } }, textArg);
      await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, async route => {
        const u = route.request().url();
        const body = fetchCached(u);
        if (!body) return route.fulfill({ status: 200, contentType: u.includes('googleapis') ? 'text/css' : 'font/woff2', body: '' });
        return route.fulfill({ status: 200, contentType: u.includes('googleapis') ? 'text/css; charset=utf-8' : 'font/woff2', body });
      });
      const page = await context.newPage();
      const tag = `${sizeName}/${theme}`;
      page.on('console', m => { if (m.type() === 'error') problems.push(`[${tag}] console error: ${m.text()}`); });
      page.on('pageerror', e => problems.push(`[${tag}] page error: ${e.message}`));
      await page.goto(url + '#today');
      await page.waitForFunction(() => window.RB && RB.store.state.ready);
      let ids = {};
      if (!empty) {
        await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
        await page.waitForFunction(() => RB.store.tenantsList().length > 0);
        ids = await page.evaluate(() => {
          const list = RB.store.tenantsList();
          const lg = id => RB.store.ledger(id);
          return {
            delinquent: (list.find(t => lg(t.id).delinquent) || list[0]).id,
            notice: (list.find(t => t.status === 'notice') || list[0]).id,
            late: (list.find(t => lg(t.id).current.status === 'late' && !lg(t.id).delinquent) || list.find(t => lg(t.id).balance > 0) || list[0]).id,
            unpaid: (list.find(t => lg(t.id).current.status === 'late' && !lg(t.id).delinquent && !lg(t.id).current.paid) || list.find(t => lg(t.id).balance > 0) || list[0]).id,
          };
        });
      }
      for (const s of list) {
        const route = typeof s.route === 'function' ? s.route(ids) : s.route;
        await page.evaluate(r => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); location.hash = r; window.scrollTo(0, 0); }, route);
        await page.waitForTimeout(120);
        if (s.setup) { await s.setup(page, ids); await page.waitForTimeout(250); }
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.waitForTimeout(80);
        if (sizeName !== 'desktop') {
          const ov = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, wide: Array.from(document.querySelectorAll('#rb-view *, #rb-layer *, #rb-topbar *, #rb-tabbar *, #rb-banner *')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && !e.closest('.chips-scroll, .seg, .tbl-wrap.hide-phone, .tbl-scroll, .tbl-scroll-phone, .palette-list, .menu'); }).slice(0, 3).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').join('.') + (e.id ? '#' + e.id : '')) }));
          if (ov.doc > ov.win || ov.wide.length) problems.push(`[${tag}] ${s.name}: horizontal overflow ${ov.doc}px > ${ov.win}px ${ov.wide.join(' ')}`);
        }
        const file = join(OUT, `${s.name}-${sizeName}-${theme}${textSuffix}.png`);
        await page.screenshot({ path: file, fullPage: !!s.full });
        console.log('shot', file.replace(ROOT + '/', ''));
      }
      await context.close();
    }
  }
}
await browser.close();

if (problems.length) {
  console.error('\nProblems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nOK: no console errors, no horizontal overflow at phone width.');

#!/usr/bin/env node
// tools/audit.mjs — the acceptance test for SPEC §10 (the v3 elegance pass). Prints a table, exits 1 on any breach.
// Usage: node tools/audit.mjs [--only today,rent,kit] [--text normal,xl] [--size phone|desktop] [--theme light|dark]
//                             [--no-build] [--verbose]
// Each screen is loaded at 390×844 (phone) with the sample tenants, light theme, at Normal and Extra large text, and checked:
//   height   page height in phone screens vs the budget (law 3)
//   filled   filled buttons visible on the screen / in the open sheet (≤ 1, law 1)
//   rowbtn   buttons or links inside a .row (0; Rent "still owes" and Today rent rows may have ONE .row-btn, law 2)
//   sizes    computed font sizes ÷ text scale must be the five sizes (law 4): phone 14/17/18/22/32, desktop 14/16/18/22/36
//   display  exactly one display-size element on a page (law 4)
//   weights  only 400 and 600 (law 4)        min    nothing under 14px (law 4)
//   colour   text in the semantic red/amber/green outside a status marker (0, law 5)
//   radii    border radii ⊆ {0, 6, 10, 16, round} (law 6)
//   overflow horizontal overflow (none)       trunc  truncated titles / ellipsis (none, law 12)
//   wrap     controls whose label wraps onto two lines (none, law 12)
// Plus, once per run: a toast is gone the moment a sheet opens and never overlaps an open sheet (law 10); sheets never
// stack; and the owed sentence is identical on Today, Rent, Tenants and the two reports that state it (law 7).
// Failure lines name the offending element: tag#id.class “text”.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = (arg('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
const texts = (arg('--text') || 'normal,xl').split(',').map(s => s.trim());
const sizeName = arg('--size') || 'phone';
const theme = arg('--theme') || 'light';
const verbose = args.includes('--verbose');
if (!args.includes('--no-build')) execFileSync(process.execPath, [join(ROOT, 'build.mjs')], { stdio: 'inherit' });
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1360, height: 900 } };
const VP = SIZES[sizeName] || SIZES.phone;

// name, how to get there, height budget in screens (null = no budget), lists that may carry one .row-btn, sheet = audit the open sheet
const SCREENS = [
  { name: 'today', route: 'today', budget: 2.0, rowBtn: true },
  { name: 'rent', route: 'rent', budget: 2.5, rowBtn: true },
  { name: 'tenants', route: 'tenants', budget: 3.0 },
  { name: 'tenant', route: ids => 't-' + ids.delinquent, budget: 3.5, drawer: true },
  { name: 'leases', route: 'leases', budget: 2.5 },
  { name: 'repairs', route: 'repairs', intent: 'todo', budget: 1.5 },
  { name: 'repairs-history', route: 'repairs', intent: 'history', budget: null },
  { name: 'property', route: 'p-alder-court', budget: 3.5 },
  { name: 'reports-roll', route: 'reports', click: '#rp-tab-roll', budget: 3.5 },
  { name: 'reports-aging', route: 'reports', click: '#rp-tab-aging', budget: 3.5 },
  { name: 'reports-collection', route: 'reports', click: '#rp-tab-collection', budget: 3.5 },
  { name: 'reports-income', route: 'reports', click: '#rp-tab-income', budget: 3.5 },
  { name: 'settings', route: 'setup', budget: 3.0 },
  { name: 'kit', route: 'kit', budget: null, rowBtn: true },
  // shared sheets (audited inside the open sheet)
  { name: 'sheet-payment', route: 'rent', sheet: true, setup: (p, ids) => p.evaluate(id => { RB.actions.recordPayment(id); }, ids.late) },
  { name: 'sheet-part', route: 'rent', sheet: true, setup: async (p, ids) => { await p.evaluate(id => { RB.actions.recordPayment(id, { part: true }); }, ids.late); } },
  { name: 'sheet-pick', route: 'today', sheet: true, setup: p => p.evaluate(() => { RB.ui.pickTenant({ title: 'Who paid you?', prefer: 'owes' }); }) },
  { name: 'sheet-choices', route: 'rent', sheet: true, setup: async (p, ids) => { await p.evaluate(() => RB.shell.go('rent', 'owes')); await p.waitForTimeout(120); await p.click('#rent-row-' + ids.late); } },
  { name: 'sheet-recent', route: 'today', sheet: true, setup: p => p.click('#td-recent') },
  { name: 'sheet-charge', route: 'today', sheet: true, setup: (p, ids) => p.evaluate(id => { RB.actions.addCharge(id); }, ids.late) },
  { name: 'sheet-note', route: 'today', sheet: true, setup: (p, ids) => p.evaluate(id => { RB.actions.addNote(id); }, ids.late) },
  { name: 'sheet-help', route: 'today', sheet: true, setup: p => p.evaluate(() => { RB.shell.helpSheet(); }) },
];
const want = s => !only.length || only.some(o => s.name === o || (o === 'sheets' && s.sheet) || (!s.sheet && s.name.startsWith(o + '-')));

// ------------------------------------------------------------------ the in-page probe
function probe(opts) {
  const { rowBtn, sheet, desktop } = opts;
  const out = { fails: {}, info: {} };
  const fail = (k, msg) => { (out.fails[k] = out.fails[k] || []).push(msg); };
  const desc = el => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    return tag + id + cls + (t ? ' “' + t + '”' : '');
  };
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 && !el.closest('[hidden], .vh, .is-closing'); };
  const top = RB.ui.topLayer();
  const scope = sheet ? (document.querySelector('.sheet-wrap:not(.is-closing) .sheet') || document.body) : document.body;
  const all = Array.from(scope.querySelectorAll('*')).filter(el => !el.closest('svg') || el.tagName === 'svg');
  const shown = all.filter(vis);
  // page content excludes the parts a covering layer hides: on a page audit, ignore #rb-layer except toasts
  const pageEls = sheet ? shown : shown.filter(el => !el.closest('#rb-layer') || (opts.drawer && el.closest('.drawer')));
  const hasText = el => Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
  const textEls = pageEls.filter(hasText);
  const scaleOf = el => parseFloat(getComputedStyle(el).getPropertyValue('--text-scale')) || 1;

  // height (pages only)
  out.info.height = document.documentElement.scrollHeight / window.innerHeight;
  if (opts.drawer) { const b = document.querySelector('.drawer-body'); if (b) out.info.height = (b.scrollHeight + (document.querySelector('.drawer-head') || { offsetHeight: 0 }).offsetHeight) / window.innerHeight; }

  // filled buttons: background is the accent or the danger colour
  const root = getComputedStyle(document.documentElement);
  const toRgb = c => { const d = document.createElement('span'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
  const ACC = toRgb(root.getPropertyValue('--accent').trim()), BAD = toRgb(root.getPropertyValue('--bad').trim());
  const OK = toRgb(root.getPropertyValue('--ok').trim()), WARN = toRgb(root.getPropertyValue('--warn').trim());
  const filledScope = sheet ? shown : pageEls;
  const filled = filledScope.filter(el => el.matches('button, a, [role="button"], label') && !el.closest('.toast') && [ACC, BAD].includes(getComputedStyle(el).backgroundColor));
  out.info.filled = filled.length;
  if (filled.length > 1) fail('filled', filled.length + ' filled buttons: ' + filled.map(desc).join(' · '));

  // buttons inside rows
  const rows = pageEls.filter(el => el.classList.contains('row'));
  let rowBtns = 0;
  for (const r of rows) {
    const inner = Array.from(r.querySelectorAll('button, a[href], input:not([type="checkbox"]):not([type="hidden"]), select, [role="button"]')).filter(vis).filter(x => !x.classList.contains('row-hit'));
    const allowed = rowBtn ? inner.filter(x => x.classList.contains('row-btn') && x.classList.contains('btn-soft')) : [];
    const bad = inner.filter(x => !allowed.includes(x) || allowed.indexOf(x) > 0);
    rowBtns += inner.length;
    for (const b of bad) fail('rowbtn', 'control inside a row: ' + desc(b) + ' in ' + desc(r));
    if (!rowBtn && allowed.length) fail('rowbtn', 'row button on a list that may not have one: ' + desc(allowed[0]));
  }
  out.info.rowbtn = rowBtns;

  // font sizes, display count, weights, min size
  const canon = desktop ? [14, 16, 18, 22, 36] : [14, 17, 18, 22, 32];
  const sizes = new Map(), weights = new Map();
  let min = 99, minEl = null, displays = [];
  for (const el of textEls) {
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const base = Math.round((px / scaleOf(el)) * 2) / 2;
    if (!sizes.has(base)) sizes.set(base, []);
    sizes.get(base).push(el);
    const w = cs.fontWeight;
    if (!weights.has(w)) weights.set(w, []);
    weights.get(w).push(el);
    if (px < min) { min = px; minEl = el; }
    if (base === canon[4]) displays.push(el);
  }
  out.info.sizes = sizes.size;
  for (const [s, els] of sizes) if (!canon.includes(s)) fail('sizes', s + 'px (×' + els.length + ', not one of ' + canon.join('/') + '): ' + els.slice(0, 3).map(desc).join(' · '));
  if (sizes.size > 5) fail('sizes', sizes.size + ' distinct sizes: ' + Array.from(sizes.keys()).sort((a, b) => a - b).join(', '));
  out.info.display = displays.length;
  if (!sheet && displays.length !== 1) fail('display', displays.length + ' display-size elements (want exactly 1)' + (displays.length ? ': ' + displays.slice(0, 3).map(desc).join(' · ') : ''));
  out.info.weights = weights.size;
  for (const [w, els] of weights) if (w !== '400' && w !== '600') fail('weights', 'weight ' + w + ' (×' + els.length + '): ' + els.slice(0, 3).map(desc).join(' · '));
  out.info.min = Math.round(min * 10) / 10;
  if (min < 13.95) fail('min', 'text at ' + min + 'px: ' + desc(minEl));

  // semantic colour outside a status marker
  const EXEMPT = '.status, .field-error, .btn-danger, .btn-danger-soft, .menu-item.is-danger, .toast';
  const colourBad = textEls.filter(el => [BAD, WARN, OK].includes(getComputedStyle(el).color) && !el.closest(EXEMPT));
  out.info.colour = colourBad.length;
  for (const el of colourBad.slice(0, 6)) fail('colour', 'semantic colour outside a status marker: ' + desc(el));

  // radii
  const radii = new Map();
  for (const el of (sheet ? shown : pageEls)) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    for (const p of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      const v = cs[p]; if (!v || v === '0px') continue;
      const n = v.endsWith('%') ? (parseFloat(v) >= 50 ? 999 : -1) : parseFloat(v);
      const round = n >= 999 || n >= Math.min(r.width, r.height) / 2 - 0.5;
      const ok = round || [6, 10, 16].includes(Math.round(n * 10) / 10);
      if (!ok) { const k = v; if (!radii.has(k)) radii.set(k, []); radii.get(k).push(el); }
    }
  }
  out.info.radii = radii.size;
  for (const [v, els] of radii) fail('radii', 'radius ' + v + ' (×' + els.length + '): ' + Array.from(new Set(els)).slice(0, 3).map(desc).join(' · '));

  // horizontal overflow
  const vw = window.innerWidth;
  const wide = shown.filter(el => { const r = el.getBoundingClientRect(); return r.right > vw + 1 && !el.closest('.chips-scroll, .seg, .tbl-scroll, .tbl-scroll-phone, .palette-list, .menu, .vh'); });
  out.info.overflow = (document.documentElement.scrollWidth > vw ? 1 : 0) + wide.length;
  if (document.documentElement.scrollWidth > vw) fail('overflow', 'page is ' + document.documentElement.scrollWidth + 'px wide in a ' + vw + 'px window');
  for (const el of wide.slice(0, 4)) fail('overflow', 'past the right edge: ' + desc(el));

  // truncated titles
  const trunc = shown.filter(el => {
    const cs = getComputedStyle(el);
    const titleish = el.matches('h1, h2, h3, .row-title, .row-hit, .sheet-title, .topbar-title, .drawer-title, .tab-label, .rows-head');
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
    return titleish && (el.scrollWidth > el.clientWidth + 1) && cs.overflowX !== 'visible';
  });
  out.info.trunc = trunc.length;
  for (const el of trunc.slice(0, 4)) fail('trunc', 'cut off: ' + desc(el));

  // controls whose label wraps
  const ctrls = (sheet ? shown : pageEls).filter(el => el.matches('.btn, .btn-link, .seg > button, .chip, .tab-label, .rows-more, .toast-action') && !el.matches('.help-go'));
  const wraps = ctrls.filter(el => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    const tops = new Set(Array.from(rg.getClientRects()).filter(r => r.width > 1).map(r => Math.round(r.top / 4)));
    return tops.size > 1 && (() => { const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3; return rg.getBoundingClientRect().height > lh * 1.6; })();
  });
  out.info.wrap = wraps.length;
  for (const el of wraps.slice(0, 4)) fail('wrap', 'label wraps inside the control: ' + desc(el));

  // sheets never stack
  const openSheets = document.querySelectorAll('.sheet-wrap:not(.is-closing)').length;
  if (openSheets > 1) fail('stack', openSheets + ' sheets open at once');
  out.text = (document.getElementById('rb-view') || document.body).innerText + '\n' + (document.querySelector('.drawer') || { innerText: '' }).innerText;
  return out;
}

// ------------------------------------------------------------------ run
const COLS = ['height', 'filled', 'rowbtn', 'sizes', 'display', 'weights', 'min', 'colour', 'radii', 'overflow', 'trunc', 'wrap'];
const results = [];
const details = [];
const browser = await chromium.launch();
const url = pathToFileURL(join(ROOT, 'dist', 'preview.html')).href;
const owedOn = {};
let consoleErrors = [];

for (const text of texts) {
  const ctx = await browser.newContext({ viewport: VP, colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  await ctx.addInitScript(v => { try { localStorage.setItem('rb:textSize', JSON.stringify(v)); } catch (e) { /* ignore */ } }, text);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => consoleErrors.push(`[${text}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${text}] ${m.text()}`); });
  await page.goto(url + '#today');
  await page.waitForFunction(() => window.RB && RB.store.state.ready);
  await page.evaluate(() => RB.actions.loadSample({ quiet: true }));
  await page.waitForFunction(() => RB.store.tenantsList().length > 0);
  const ids = await page.evaluate(() => {
    const list = RB.store.tenantsList(); const lg = id => RB.store.ledger(id);
    return {
      delinquent: (list.find(t => lg(t.id).delinquent) || list[0]).id,
      late: (list.find(t => lg(t.id).current.status === 'late' && !lg(t.id).delinquent && !lg(t.id).current.paid) || list.find(t => lg(t.id).balance > 0) || list[0]).id,
    };
  });
  const owed = await page.evaluate(() => RB.ui.owedSentence());

  for (const s of SCREENS.filter(want)) {
    const route = typeof s.route === 'function' ? s.route(ids) : s.route;
    try {
      await page.evaluate(() => { RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(t => t.remove()); });
      await page.waitForTimeout(60);
      if (s.intent) await page.evaluate(([r, i]) => RB.shell.go(r, i), [route, s.intent]);
      else await page.evaluate(r => { if (location.hash === '#' + r) RB.shell.refresh(); else location.hash = r; }, route);
      await page.waitForTimeout(160);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (s.click) { await page.click(s.click); await page.waitForTimeout(120); }
      if (s.setup) {
        await s.setup(page, ids);
        if (s.sheet) await page.waitForSelector('.sheet-wrap:not(.is-closing) .sheet', { timeout: 3000 });
        await page.waitForTimeout(s.sheet ? 420 : 260);
      }
      const r = await page.evaluate(probe, { rowBtn: !!s.rowBtn, sheet: !!s.sheet, desktop: sizeName === 'desktop', drawer: !!s.drawer });
      const row = { screen: s.name, text, info: r.info, fails: r.fails };
      if (s.budget && r.info.height > s.budget + 0.005) (row.fails.height = row.fails.height || []).push(r.info.height.toFixed(2) + ' screens tall (budget ' + s.budget + ')');
      if (s.sheet) row.info.height = null;
      row.budget = s.budget;
      results.push(row);
      if (text === 'normal' && !s.sheet) owedOn[s.name] = r.text;
      for (const [k, list] of Object.entries(row.fails)) for (const m of list) details.push(`${s.name} @ ${text} · ${k}: ${m}`);
    } catch (e) {
      results.push({ screen: s.name, text, info: {}, fails: { error: [String(e.message || e).split('\n')[0]] } });
      details.push(`${s.name} @ ${text} · error: ${String(e.message || e).split('\n')[0]}`);
    }
  }

  // ---- once per text size: toast vs sheet (law 10), on whichever screen is first in the run
  if (!only.length || only.includes('today') || only.includes('rent') || only.includes('sheets')) {
    await page.evaluate(() => { RB.ui.closeAll(); location.hash = 'rent'; });
    await page.waitForTimeout(150);
    const t = await page.evaluate(async id => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      RB.ui.toast('A test message', { undo: () => {} });
      await wait(50);
      RB.actions.recordPayment(id);
      await wait(300);
      const goneOnOpen = !Array.from(document.querySelectorAll('.toast')).some(x => x.isConnected && !x.classList.contains('is-closing'));
      RB.ui.toast('Copied the receipt.', { duration: 0 });
      await wait(250);
      const toast = document.querySelector('.toast:not(.is-closing)');
      const sh = document.querySelector('.sheet-wrap:not(.is-closing) .sheet');
      const btn = sh && sh.querySelector('.sheet-foot .btn-primary');
      const a = toast && toast.getBoundingClientRect(), s = sh && sh.getBoundingClientRect(), b = btn && btn.getBoundingClientRect();
      const hit = (x, y) => x && y && x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
      const res = { goneOnOpen, overSheet: !!hit(a, s), overButton: !!hit(a, b), sheets: document.querySelectorAll('.sheet-wrap:not(.is-closing)').length };
      RB.ui.choices({ items: [{ label: 'x', run: () => {} }] });
      await wait(250);
      res.afterSecond = document.querySelectorAll('.sheet-wrap:not(.is-closing)').length;
      RB.ui.closeAll(); document.querySelectorAll('.toast').forEach(x => x.remove());
      return res;
    }, ids.late);
    const row = { screen: 'toast+sheet', text, info: {}, fails: {} };
    if (!t.goneOnOpen) (row.fails.toast = []).push('a toast was still showing after a sheet opened');
    if (t.overButton) (row.fails.toast = row.fails.toast || []).push('a toast covers the sheet’s primary button');
    else if (t.overSheet) (row.fails.toast = row.fails.toast || []).push('a toast overlaps the open sheet');
    if (t.afterSecond !== 1) (row.fails.stack = []).push(t.afterSecond + ' sheets open after opening one from another (want 1)');
    for (const [k, list] of Object.entries(row.fails)) for (const m of list) details.push(`toast+sheet @ ${text} · ${k}: ${m}`);
    results.push(row);
  }
  if (text === texts[0]) owedOn.__sentence = owed;
  await ctx.close();
}
await browser.close();

// ---- law 7: the owed sentence is the same everywhere it is stated
const OWED_SCREENS = ['today', 'rent', 'tenants', 'reports-roll', 'reports-aging'];
const owedRow = { screen: 'owed sentence', text: 'normal', info: {}, fails: {} };
const present = OWED_SCREENS.filter(n => owedOn[n] !== undefined);
if (present.length) {
  for (const n of present) if (!owedOn[n].replace(/\s+/g, ' ').includes(owedOn.__sentence)) (owedRow.fails.owed = owedRow.fails.owed || []).push(`${n} does not state “${owedOn.__sentence}”`);
  for (const m of owedRow.fails.owed || []) details.push('owed sentence · ' + m);
  results.push(owedRow);
}

// ---- table
const pad = (s, n) => String(s).padEnd(n);
const cell = (r, k) => {
  const bad = r.fails[k] && r.fails[k].length;
  let v = r.info[k];
  if (k === 'height') v = v == null ? '—' : v.toFixed(2) + (r.budget ? '/' + r.budget : '');
  if (v === undefined) v = '';
  return (bad ? '✗ ' : '') + v;
};
const head = pad('screen', 20) + pad('text', 8) + COLS.map(c => pad(c, c === 'height' ? 12 : 9)).join('') + 'result';
console.log('\nSPEC §10 audit — ' + sizeName + ' ' + VP.width + '×' + VP.height + ', ' + theme + ', sample tenants\n');
console.log(head);
console.log('-'.repeat(head.length));
let breaches = 0;
for (const r of results) {
  const n = Object.values(r.fails).reduce((a, l) => a + l.length, 0);
  breaches += n;
  const extra = Object.keys(r.fails).filter(k => !COLS.includes(k));
  console.log(pad(r.screen, 20) + pad(r.text, 8) + COLS.map(c => pad(cell(r, c), c === 'height' ? 12 : 9)).join('') + (n ? 'FAIL ' + n + (extra.length ? ' (' + extra.join(', ') + ')' : '') : 'ok'));
}
if (consoleErrors.length) { breaches += consoleErrors.length; details.push(...consoleErrors.map(e => 'console error ' + e)); }
if (details.length) {
  console.log('\nBreaches (' + details.length + '):');
  const shown = verbose ? details : details.slice(0, 120);
  for (const d of shown) console.log('  ✗ ' + d);
  if (shown.length < details.length) console.log(`  … ${details.length - shown.length} more (--verbose)`);
}
console.log(breaches ? `\nFAIL: ${breaches} breach${breaches === 1 ? '' : 'es'} of SPEC §10.` : '\nOK: every audited screen keeps the laws of SPEC §10.');
process.exit(breaches ? 1 : 0);

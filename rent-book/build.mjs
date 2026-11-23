#!/usr/bin/env node
// Rent Book build: concatenates src/ into dist/rent-book.html (artifact body, no skeleton)
// and dist/preview.html (same content in the host skeleton, for local testing).
// Usage: node build.mjs            (no dependencies)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

function fail(msg) {
  console.error('\n  BUILD FAILED: ' + msg + '\n');
  process.exit(1);
}

const list = (dir, ext) =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(ext)).sort() : [];

// ---- CSS: src/css/*.css in name order ------------------------------------
const cssFiles = list(join(SRC, 'css'), '.css');
let css = '';
for (const f of cssFiles) {
  const text = readFileSync(join(SRC, 'css', f), 'utf8');
  if (/<\/style/i.test(text)) fail(`src/css/${f} contains "</style" which would end the style element.`);
  css += `/* ---- ${f} ---- */\n${text.trim()}\n`;
}

// ---- JS: core (name order, <90), then views/*, then late core (>=90, e.g. 99-boot.js) ----
const coreAll = list(join(SRC, 'js'), '.js');
const isLate = f => /^\d+/.test(f) && parseInt(f, 10) >= 90;
const ordered = [
  ...coreAll.filter(f => !isLate(f)).map(f => ['js/' + f, join(SRC, 'js', f)]),
  ...list(join(SRC, 'js', 'views'), '.js').map(f => ['js/views/' + f, join(SRC, 'js', 'views', f)]),
  ...coreAll.filter(isLate).map(f => ['js/' + f, join(SRC, 'js', f)]),
];
let js = '';
for (const [rel, path] of ordered) {
  const text = readFileSync(path, 'utf8');
  if (/<\/script/i.test(text)) fail(`src/${rel} contains "</script" — split it (e.g. '<\\/script') so it cannot end the script element.`);
  if (/<!--/.test(text)) fail(`src/${rel} contains "<!--" which changes how browsers parse inline scripts. Split the string.`);
  js += `/* ---- ${rel} ---- */\n;(function(){'use strict';\n${text.trim()}\n})();\n`;
}
// Syntax-check the bundle without running it.
try { new Function(js); } catch (e) { fail('JS bundle has a syntax error: ' + e.message); }

// ---- Assemble -------------------------------------------------------------
const tpl = readFileSync(join(SRC, 'index.html'), 'utf8');
if (!tpl.includes('<!--CSS-->') || !tpl.includes('<!--JS-->')) fail('src/index.html needs <!--CSS--> and <!--JS--> placeholders.');
const body = tpl.replace('<!--CSS-->', () => css.trim()).replace('<!--JS-->', () => js.trim()).trim() + '\n';

if (!body.startsWith('<title>Rent Book</title>')) fail('Output must start with <title>Rent Book</title>.');
if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(body.replace(/<script>[\s\S]*<\/script>/, '')))
  fail('Output must not contain doctype/html/head/body tags.');
if ((body.match(/<style>/g) || []).length !== 1) fail('Output must contain exactly one <style>.');
if ((body.match(/<script>/g) || []).length !== 1) fail('Output must contain exactly one <script>.');

const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' +
  ':root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}' +
  '</style></head><body>';
const preview = SKELETON_HEAD + body + '</body></html>\n';

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'rent-book.html'), body);
writeFileSync(join(DIST, 'preview.html'), preview);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`built dist/rent-book.html (${kb(body.length)}) and dist/preview.html — ${cssFiles.length} css, ${ordered.length} js files`);

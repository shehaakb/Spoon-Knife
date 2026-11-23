// 30-ui.js — RB.ui: HTML renderers (return SafeHTML) and interactive primitives (toast, sheet, confirm, menu, drawer, palette, forms).
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date, M = RB.money, h = RB.html, raw = RB.raw;
const ui = (RB.ui = RB.ui || {});

// ================================================================= icons (16px grid, 1.5 stroke)
const ICONS = {
  today: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05"/>',
  rent: '<path d="M3.5 1.75h9v12.5l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z"/><path d="M6 5.25h4M6 7.75h4M6 10.25h2.25"/>',
  tenants: '<circle cx="6" cy="5.5" r="2.25"/><path d="M1.75 13.5c.4-2.4 2.1-3.75 4.25-3.75s3.85 1.35 4.25 3.75"/><path d="M10.5 3.4a2.25 2.25 0 0 1 0 4.2M12 9.9c1.2.5 2 1.6 2.25 3.6"/>',
  leases: '<path d="M4 1.75h5.25l3 3v9.5H4z"/><path d="M9 1.75V5h3.25M6.25 8h4M6.25 10.5h4"/>',
  upkeep: '<path d="M10.2 2.2a3.2 3.2 0 0 0-3.9 4.1L2.4 10.2a1.4 1.4 0 0 0 2 2l3.9-3.9a3.2 3.2 0 0 0 4.1-3.9l-1.9 1.9-1.8-.4-.4-1.8z"/>',
  wrench: '<path d="M10.2 2.2a3.2 3.2 0 0 0-3.9 4.1L2.4 10.2a1.4 1.4 0 0 0 2 2l3.9-3.9a3.2 3.2 0 0 0 4.1-3.9l-1.9 1.9-1.8-.4-.4-1.8z"/>',
  reports: '<path d="M2.5 13.5h11M4.5 11V7.5M8 11V3.5M11.5 11V6"/>',
  setup: '<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  'more-v': '<circle cx="8" cy="3.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="12.5" r=".9" fill="currentColor"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25l3.25 3.25"/>',
  check: '<path d="M3.25 8.5l3 3 6.5-7"/>',
  'check-late': '<path d="M2 8.25l2.75 2.75 5.25-6"/><g class="pill-tick"><circle cx="12" cy="11.25" r="2.75"/><path d="M12 9.9v1.45l.9.6"/></g>',
  clock: '<circle cx="8" cy="8" r="5.75"/><path d="M8 4.75V8l2.25 1.5"/>',
  triangle: '<path d="M8 2.5l5.75 10H2.25z" fill="currentColor"/>',
  half: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor"/>',
  circle: '<circle cx="8" cy="8" r="5"/>',
  dash: '<path d="M3.5 8h9"/>',
  'chevron-left': '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  'chevron-right': '<path d="M6 3.5L10.5 8 6 12.5"/>',
  'chevron-down': '<path d="M3.5 6l4.5 4.5L12.5 6"/>',
  'chevron-up': '<path d="M3.5 10l4.5-4.5 4.5 4.5"/>',
  'arrow-up': '<path d="M8 13V3M4.5 6.5L8 3l3.5 3.5"/>',
  'arrow-right': '<path d="M3 8h10M9 4l4 4-4 4"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.25C10.5 2.56 9.94 2 9.25 2h-6C2.56 2 2 2.56 2 3.25v6c0 .69.56 1.25 1.25 1.25h.25"/>',
  download: '<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11"/>',
  upload: '<path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M2.5 13.5h11"/>',
  phone: '<path d="M3.2 2.2h2.3l1.2 3-1.5 1a7.5 7.5 0 0 0 3.6 3.6l1-1.5 3 1.2v2.3c0 .7-.6 1.3-1.3 1.2A11.5 11.5 0 0 1 2 3.5c-.1-.7.5-1.3 1.2-1.3z"/>',
  mail: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5L8 8.75l5.5-4.25"/>',
  note: '<path d="M3 2.5h10v7.5l-3.5 3.5H3z"/><path d="M9.5 13.5V10H13M5.5 5.5h5M5.5 8h3"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.75h11M5.5 2v3M10.5 2v3"/>',
  key: '<circle cx="5.25" cy="10.75" r="2.75"/><path d="M7.2 8.8l5.8-5.8M11 5l1.75 1.75M9.5 6.5l1.25 1.25"/>',
  undo: '<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  filter: '<path d="M2.5 3.5h11l-4.25 5v4.25l-2.5 1V8.5z"/>',
  sort: '<path d="M5 2.5v11M2.5 11L5 13.5 7.5 11M11 13.5v-11M8.5 5L11 2.5 13.5 5"/>',
  trash: '<path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 9h6.8l.6-9"/>',
  edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/>',
  external: '<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>',
  home: '<path d="M2.5 13.5V6.75L8 2.5l5.5 4.25v6.75z"/><path d="M6.5 13.5v-4h3v4"/>',
  user: '<circle cx="8" cy="5.5" r="2.75"/><path d="M2.75 14c.5-2.75 2.6-4.25 5.25-4.25S12.75 11.25 13.25 14"/>',
  alert: '<circle cx="8" cy="8" r="5.75"/><path d="M8 5v3.5"/><circle cx="8" cy="11" r=".6" fill="currentColor"/>',
  cash: '<rect x="1.75" y="4" width="12.5" height="8" rx="1.25"/><circle cx="8" cy="8" r="1.75"/><path d="M4 6.25v.01M12 9.75v.01"/>',
  keyboard: '<rect x="1.75" y="4" width="12.5" height="8" rx="1.5"/><path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6"/>',
  door: '<path d="M9.5 2.5h-6v11h6"/><path d="M7 8h6.5M11 5.5L13.5 8 11 10.5"/>',
  sample: '<path d="M6 2.5h4M6.75 2.5v3.75L3 12.5c-.5.85.1 1.5.9 1.5h8.2c.8 0 1.4-.65.9-1.5L9.25 6.25V2.5"/><path d="M4.6 10h6.8"/>',
  grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".75"/><rect x="9" y="2.5" width="4.5" height="4.5" rx=".75"/><rect x="2.5" y="9" width="4.5" height="4.5" rx=".75"/><rect x="9" y="9" width="4.5" height="4.5" rx=".75"/>',
  link: '<path d="M6.75 9.25l2.5-2.5"/><path d="M8.75 4.25l.9-.9a2.5 2.5 0 0 1 3.5 3.5l-.9.9M7.25 11.75l-.9.9a2.5 2.5 0 0 1-3.5-3.5l.9-.9"/>',
  dot: '<circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>',
  sync: '<path d="M13 6.5A5 5 0 0 0 3.8 5M3 9.5A5 5 0 0 0 12.2 11"/><path d="M13 3v3.5H9.5M3 13V9.5h3.5"/>',
};
ui.ICONS = ICONS;
/** Inline SVG icon (SafeHTML). opts: {size=16, label (adds role=img + title), cls} */
ui.icon = function icon(name, opts) {
  const o = opts || {};
  const body = ICONS[name] || ICONS.dot;
  const size = o.size || 16;
  const a11y = o.label ? h` role="img" aria-label="${o.label}"` : raw(' aria-hidden="true"');
  return raw(`<svg class="ico ico-${RB.esc(name)}${o.cls ? ' ' + RB.esc(o.cls) : ''}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${a11y}>${body}</svg>`);
};

/** Attribute object → SafeHTML string: {id:'x', 'data-act':'pay', disabled:true} → ' id="x" data-act="pay" disabled' */
ui.attrs = function attrs(obj) {
  if (!obj) return raw('');
  let s = '';
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === false || v === null || v === undefined) continue;
    if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) continue;
    s += v === true ? ' ' + k : ' ' + k + '="' + RB.esc(v) + '"';
  }
  return raw(s);
};

// ================================================================= renderers
const STATUS_ICON = { paid: 'check', paid_late: 'check-late', partial: 'half', due: 'circle', late: 'triangle', none: 'dash' };
ui.STATUS_ICON = STATUS_ICON;

/**
 * Status pill (SafeHTML). status: paid|paid_late|partial|due|late|none.
 * opts: {daysLate (late → "9 d late"), label (override text), size:'sm', title}
 */
ui.pill = function pill(status, opts) {
  const o = opts || {};
  const st = STATUS_ICON[status] ? status : 'none';
  let label = o.label;
  if (!label) {
    if (st === 'late') label = o.daysLate ? o.daysLate + ' d late' : 'Late';
    else if (st === 'none') label = null;
    else label = RB.model.STATUS_LABEL[st];
  }
  if (label === null) return h`<span class="pill pill-none${o.size === 'sm' ? ' pill-sm' : ''}" title="${o.title || 'No charge this month'}">${ui.icon('dash', { size: 12 })}<span class="vh">No charge</span></span>`;
  return h`<span class="pill pill-${st}${o.size === 'sm' ? ' pill-sm' : ''}"${o.title ? h` title="${o.title}"` : ''}>${ui.icon(STATUS_ICON[st], { size: 12 })}<span>${label}</span></span>`;
};

/** Generic tag. tone: ''|'accent'|'ok'|'warn'|'bad'|'quiet' */
ui.tag = (text, tone, icon) => h`<span class="tag${tone ? ' tag-' + tone : ''}">${icon ? ui.icon(icon, { size: 12 }) : ''}${text}</span>`;

/** Tenant status tag: active (no tag unless opts.all), notice, past. */
ui.tenantTag = function tenantTag(status) {
  if (status === 'notice') return ui.tag('Notice given', 'warn', 'door');
  if (status === 'past') return ui.tag('Past', 'quiet');
  return ui.tag('Active', 'ok');
};

/**
 * Door plate (SafeHTML). opts: {size:'sm'|'lg', status (month status, colours lg plates; sm plates only tint late/partial/none),
 *   title, button:true (renders a <button>), attrs:{...} extra attributes (escaped), property}
 */
ui.plate = function plate(unit, opts) {
  const o = opts || {};
  const lg = o.size === 'lg';
  const st = o.status && STATUS_ICON[o.status] ? o.status : '';
  const cls = 'plate ' + (lg ? 'plate-lg' : 'plate-sm') + (st ? ' plate-' + st : '');
  const tag = o.button ? 'button' : 'span';
  const title = o.title || (o.property ? o.property + ' ' + unit : '');
  const inner = lg
    ? h`<span class="plate-unit">${unit || '—'}</span>${st && st !== 'none' ? h`<span class="plate-glyph">${ui.icon(STATUS_ICON[st], { size: 10 })}</span>` : ''}`
    : h`${unit || '—'}`;
  return h`<${raw(tag)} class="${cls}"${o.button ? raw(' type="button"') : ''}${title ? h` title="${title}"` : ''}${ui.attrs(o.attrs)}>${inner}</${raw(tag)}>`;
};

const STRIP_WORD = { paid: 'paid', paid_late: 'paid late', partial: 'partly paid', due: 'due', late: 'late', none: 'no charge' };
/**
 * 12-month payment strip (SafeHTML). cells = RB.model.monthsBack(ledger, endKey, 12) (oldest → newest). opts: {lg:true, today}
 */
ui.strip = function strip(cells, opts) {
  const o = opts || {};
  const today = o.today || (RB.store ? RB.store.today() : D.today());
  const parts = (cells || []).map(c => {
    const mon = D.fmtMonthShort(c.period, today, { year: true });
    let t = mon + ' — ' + STRIP_WORD[c.status];
    if ((c.status === 'paid' || c.status === 'paid_late') && c.paidOn) t += ' ' + D.fmt(c.paidOn, today) + (c.status === 'paid_late' ? ' (' + c.daysLate + ' d late)' : '');
    else if (c.status === 'partial' || c.status === 'late') t += ': ' + M.fmt(c.open) + ' open' + (c.paid ? ', ' + M.fmt(c.paid) + ' paid' : '') + (c.status === 'late' ? ', ' + c.daysLate + ' d' : '');
    else if (c.status === 'due' && c.due) t += ' ' + D.fmt(c.due, today);
    return h`<i class="pc pc-${c.status}" title="${t}"></i>`;
  });
  const label = (cells || []).map(c => D.fmtMonthShort(c.period, today) + ' ' + STRIP_WORD[c.status]).join(', ');
  return h`<span class="pstrip${o.lg ? ' pstrip-lg' : ''}" role="img" aria-label="Last ${(cells || []).length} months: ${label}">${parts}</span>`;
};

/**
 * Money (SafeHTML) with muted currency symbol: <span class="money"><span class="cur">$</span>1,450</span>.
 * opts: {size:'lg'|'md', cls, sign:true (+$50), cents:'always'|'never', tone:'owed'|'credit'}
 */
ui.money = function money(cents, opts) {
  const o = opts || {};
  const n = Math.round(cents || 0);
  const sign = n < 0 ? '−' : o.sign && n > 0 ? '+' : '';
  const cls = 'money' + (o.size ? ' money-' + o.size : '') + (o.tone ? ' amt-' + o.tone : '') + (o.cls ? ' ' + o.cls : '');
  return h`<span class="${cls}">${sign}<span class="cur">${M.symbol}</span>${M.digits(n, o)}</span>`;
};

/** Balance cell: owed → danger colour; credit → muted "$120 cr"; zero → em-rule (or opts.zero text). */
ui.balance = function balance(cents, opts) {
  const o = opts || {};
  if (!cents) return o.zero === undefined ? raw('<span class="amt-zero" aria-label="No balance">—</span>') : h`<span class="amt-zero">${o.zero}</span>`;
  if (cents > 0) return ui.money(cents, { tone: 'owed' });
  return h`<span class="money amt-credit"><span class="cur">${M.symbol}</span>${M.digits(-cents)}<span class="cr">cr</span></span>`;
};

/** Plain date text: "Nov 3" / "Nov 3, 2025". opts.mono → mono class. */
ui.date = (d, opts) => h`<time class="${opts && opts.mono ? 'mono' : ''}" datetime="${d || ''}">${D.fmt(d, RB.store ? RB.store.today() : undefined)}</time>`;

/** <kbd> chip(s): ui.kbd('⌘K') or ui.kbd('g', 't') */
ui.kbd = (...keys) => h`${keys.map(k => h`<kbd class="kbd">${k}</kbd>`)}`;

/** Copyable value: text + copy button (data-copy holds the text; handled globally). */
ui.copyline = function copyline(text, what, opts) {
  if (!text) return h`<span class="faint">—</span>`;
  const extra = opts && opts.href ? h` <a class="btn btn-ghost btn-icon btn-sm" href="${opts.href}" aria-label="${opts.hrefLabel || 'Open'}">${ui.icon(opts.hrefIcon || 'external')}</a>` : '';
  return h`<span class="copyline"><span class="copyline-text">${text}</span><button type="button" class="btn btn-ghost btn-icon btn-sm" data-copy="${text}" data-copy-what="${what || 'text'}" aria-label="Copy ${what || 'text'}" title="Copy">${ui.icon('copy')}</button>${extra}</span>`;
};

/**
 * Empty state. opts: {icon, title, body, actions:[{label, kind:'primary'|'soft'|..., cmd (RB.commands id) | act (data-act) | attrs}], quiet:true}
 */
ui.empty = function empty(opts) {
  const o = opts || {};
  if (o.quiet) return h`<div class="empty empty-quiet">${o.title}</div>`;
  return h`<div class="empty">
    ${o.icon ? h`<div class="empty-icon">${ui.icon(o.icon, { size: 20 })}</div>` : ''}
    ${o.title ? h`<div class="empty-title">${o.title}</div>` : ''}
    ${o.body ? h`<div class="empty-body">${o.body}</div>` : ''}
    ${o.actions && o.actions.length ? h`<div class="empty-actions">${o.actions.map(ui.button)}</div>` : ''}
  </div>`;
};

/**
 * Button (SafeHTML). b: {label, kind:'primary'|'soft'|'ghost'|'danger'|'danger-soft'|'', size:'sm'|'lg', icon, iconOnly, cmd, act, id, attrs, disabled, write:true (marks data-write)}
 */
ui.button = function button(b) {
  const cls = 'btn' + (b.kind ? ' btn-' + b.kind : '') + (b.size ? ' btn-' + b.size : '') + (b.iconOnly ? ' btn-icon' : '') + (b.cls ? ' ' + b.cls : '');
  const a = Object.assign({ type: 'button', class: cls, id: b.id, 'data-cmd': b.cmd, 'data-act': b.act, disabled: !!b.disabled, 'data-write': b.write ? '' : null,
    'aria-label': b.iconOnly ? b.label : null, title: b.iconOnly ? b.label : b.title }, b.attrs || {});
  return h`<button${ui.attrs(a)}>${b.icon ? ui.icon(b.icon) : ''}${b.iconOnly ? '' : h`<span>${b.label}</span>`}</button>`;
};

/** Loading skeleton. opts: {rows=6, title:true, plates:true} */
ui.skeleton = function skeleton(opts) {
  const o = Object.assign({ rows: 6, title: true, plates: true }, opts);
  const widths = [38, 52, 30, 44, 60, 34, 48, 40];
  const rows = Array.from({ length: o.rows }, (_, i) => h`<div class="skel-row">${o.plates ? raw('<span class="skel skel-plate"></span>') : ''}<span class="skel" style="width:${widths[i % 8]}%"></span><span class="spacer"></span><span class="skel" style="width:12%"></span></div>`);
  return h`<div class="skeleton" aria-busy="true" aria-label="Loading">${o.title ? raw('<span class="skel skel-title"></span>') : ''}${rows}</div>`;
};
/** One-line loading note ("Loading your rent book…"). */
ui.loadingNote = text => h`<div class="loading-note"><span class="dot dot-accent dot-pulse"></span>${text || 'Loading your rent book…'}</div>`;

/** First-run panel (no tenants yet). Buttons run commands: tenant:add, setup:import, sample:load. */
ui.firstRun = function firstRun() {
  const opt = (cmd, ico, title, sub) => h`<button type="button" class="firstrun-opt" data-cmd="${cmd}" data-write><span class="firstrun-ico">${ui.icon(ico)}</span><span><span class="firstrun-opt-title">${title}</span><span class="firstrun-opt-sub" style="display:block">${sub}</span></span><span class="chev">${ui.icon('chevron-right')}</span></button>`;
  return h`<section class="firstrun" aria-labelledby="fr-title">
    <div class="firstrun-head">
      <div class="micro">Rent Book</div>
      <h2 class="firstrun-title" id="fr-title">Start your rent book</h2>
      <p class="firstrun-lede">One page for who owes what, whose lease is ending and what needs fixing. Add tenants one at a time, bring them in from a spreadsheet, or look around with sample data first.</p>
    </div>
    <div class="firstrun-opts">
      ${opt('tenant:add', 'plus', 'Add your first tenant', 'Name, unit, rent and lease dates — the ledger builds itself from there.')}
      ${opt('setup:import', 'upload', 'Import from a spreadsheet', 'Paste rows or choose a CSV. Columns are matched for you.')}
      ${opt('sample:load', 'sample', 'Explore with sample data', '27 invented tenants across three buildings. Remove it with one click.')}
    </div>
  </section>`;
};

// ================================================================= layer stack, focus trap, Esc
const layers = []; // {el, kind:'sheet'|'drawer'|'menu'|'palette'|'popover', close(), modal, restore}
ui.layers = layers;
const layerRoot = () => document.getElementById('rb-layer') || document.body;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusables(el) { return Array.from(el.querySelectorAll(FOCUSABLE)).filter(x => x.offsetParent !== null || x === document.activeElement); }
function pushLayer(l) { l.restore = document.activeElement; layers.push(l); return l; }
function popLayer(l) {
  const i = layers.indexOf(l);
  if (i < 0) return;
  layers.splice(i, 1);
  const r = l.restore;
  if (l.restoreFocus !== false && r && r.isConnected && typeof r.focus === 'function') { try { r.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}
ui.topLayer = () => layers[layers.length - 1] || null;
/** True when a modal layer (sheet, palette, menu, confirm) is open. Drawers are not counted: views keep keyboard control while their drawer is open. */
ui.hasModal = () => layers.some(l => l.kind !== 'drawer');
ui.closeAll = () => layers.slice().reverse().forEach(l => l.close());
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
function animateOut(el, then) {
  if (reduceMotion()) { then(); return; }
  el.classList.add('is-closing');
  let done = false;
  const fin = () => { if (!done) { done = true; then(); } };
  el.addEventListener('animationend', fin, { once: true });
  setTimeout(fin, 220);
}
const isPhone = () => { try { return matchMedia('(max-width: 759.98px)').matches; } catch (e) { return false; } };
ui.isPhone = isPhone;

document.addEventListener('keydown', e => {
  const top = ui.topLayer();
  if (!top) return;
  if (e.key === 'Escape') {
    if (top.kind === 'drawer' && e.target && e.target.matches && e.target.matches('input, textarea, select') && e.target.value) return; // let Esc clear the field
    e.preventDefault(); e.stopPropagation();
    top.close();
    return;
  }
  if (e.key === 'Tab' && top.modal !== false) {
    const f = focusables(top.el);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (!top.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

// ================================================================= toast
let toastBox = null;
/**
 * Toast. opts: {undo: fn (adds "Undo"), action:{label, run}, tone:'bad', duration (ms, default 7000; 0 = sticky), icon}
 * Returns {close}.
 */
ui.toast = function toast(message, opts) {
  const o = opts || {};
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    layerRoot().appendChild(toastBox);
  }
  while (toastBox.children.length >= 3) toastBox.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (o.tone === 'bad' ? ' toast-bad' : '');
  const act = o.undo ? { label: 'Undo', run: o.undo } : o.action;
  el.innerHTML = String(h`${o.tone === 'bad' ? h`<span class="toast-ico">${ui.icon('alert')}</span>` : o.icon ? h`<span class="toast-ico">${ui.icon(o.icon)}</span>` : ''}<span class="toast-msg">${message}</span>${act ? h`<button type="button" class="toast-action">${act.label}</button>` : ''}<button type="button" class="toast-x" aria-label="Dismiss">${ui.icon('x', { size: 14 })}</button>`);
  toastBox.appendChild(el);
  let timer = null;
  const close = () => { clearTimeout(timer); if (!el.isConnected) return; animateOut(el, () => el.remove()); };
  const arm = () => { clearTimeout(timer); const d = o.duration === undefined ? 7000 : o.duration; if (d) timer = setTimeout(close, d); };
  if (act) el.querySelector('.toast-action').addEventListener('click', () => { close(); try { act.run(); } catch (e) { console.error(e); } });
  el.querySelector('.toast-x').addEventListener('click', close);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  arm();
  return { el, close };
};

// ================================================================= sheet / confirm
let sheetSeq = 0;
/**
 * Sheet: centred modal (desktop) / bottom sheet (phone).
 * opts: {title, sub, body: (bodyEl, handle) => void | SafeHTML | string(escaped), size:'wide'|'xwide',
 *        actions:[{id, label, kind:'primary'|'danger'|'ghost'|'soft'|'', onClick(handle) → false|Promise (false keeps it open)}],
 *        cancel:'Cancel' | false, note (SafeHTML/str in the footer), initialFocus (selector), onClose(result)}
 * The first 'primary'/'danger' action is the form's submit (Enter in a text field triggers it).
 * Returns handle {el, body, close(result), action(id) → button, setAction(id,{label,disabled}), setNote(html), setTitle(text)}
 */
ui.sheet = function sheet(opts) {
  const o = opts || {};
  const n = ++sheetSeq;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const actions = (o.actions || [{ id: 'ok', label: 'Done', kind: 'primary' }]).map((a, i) => Object.assign({ id: a.id || 'a' + i }, a));
  const submitIdx = actions.findIndex(a => a.kind === 'primary' || a.kind === 'danger');
  const cancel = o.cancel === undefined ? (actions.length && submitIdx >= 0 ? 'Cancel' : false) : o.cancel;
  wrap.innerHTML = String(h`<div class="scrim" data-close></div>
    <div class="sheet${o.size ? ' sheet-' + o.size : ''}" role="dialog" aria-modal="true" aria-labelledby="rb-sheet-${n}-t">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <form class="sheet-form" novalidate autocomplete="off">
        <div class="sheet-head"><div class="grow"><h2 class="sheet-title" id="rb-sheet-${n}-t">${o.title || ''}</h2>${o.sub ? h`<div class="sheet-sub">${o.sub}</div>` : ''}</div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm sheet-close" data-close aria-label="Close">${ui.icon('x')}</button></div>
        <div class="sheet-body"></div>
        <div class="sheet-foot"><span class="sheet-foot-note">${o.note || ''}</span>
          ${cancel ? h`<button type="button" class="btn btn-ghost" data-close>${cancel}</button>` : ''}
          ${actions.map((a, i) => h`<button type="${i === submitIdx ? 'submit' : 'button'}" class="btn${a.kind ? ' btn-' + a.kind : ''}" data-action="${a.id}"${a.disabled ? raw(' disabled') : ''}>${a.label}</button>`)}
        </div>
      </form>
    </div>`);
  layerRoot().appendChild(wrap);
  if (!actions.length && !cancel && !o.note) wrap.querySelector('.sheet-foot').classList.add('is-empty');
  const sheetEl = wrap.querySelector('.sheet');
  const body = wrap.querySelector('.sheet-body');
  const form = wrap.querySelector('form');
  let closed = false;
  const handle = {
    el: sheetEl, body, form,
    close(result) {
      if (closed) return; closed = true;
      popLayer(layer);
      animateOut(sheetEl, () => wrap.remove());
      wrap.querySelector('.scrim').style.opacity = '0';
      if (o.onClose) try { o.onClose(result); } catch (e) { console.error(e); }
    },
    action: id => wrap.querySelector('[data-action="' + id + '"]'),
    setAction(id, p) { const b = handle.action(id); if (!b) return; if (p.label !== undefined) b.textContent = p.label; if (p.disabled !== undefined) b.disabled = !!p.disabled; },
    setNote(x) { wrap.querySelector('.sheet-foot-note').innerHTML = String(x && RB.isSafe(x) ? x : RB.esc(x || '')); },
    setTitle(t) { wrap.querySelector('.sheet-title').textContent = t; },
    get closed() { return closed; },
  };
  const layer = pushLayer({ el: wrap, kind: 'sheet', close: () => handle.close() });
  if (typeof o.body === 'function') { const r = o.body(body, handle); if (r !== undefined && r !== null) body.innerHTML = String(RB.isSafe(r) ? r : RB.esc(r)); }
  else if (o.body !== undefined && o.body !== null) body.innerHTML = String(RB.isSafe(o.body) ? o.body : RB.esc(o.body));
  const run = async a => {
    const btn = handle.action(a.id);
    if (!a.onClick) { handle.close(a.id); return; }
    try {
      btn.setAttribute('aria-busy', 'true');
      const r = await a.onClick(handle);
      if (r !== false) handle.close(a.id);
    } catch (e) { console.error(e); }
    finally { if (btn) btn.removeAttribute('aria-busy'); }
  };
  wrap.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { e.preventDefault(); handle.close(); return; }
    const b = e.target.closest('[data-action]');
    if (b && b.type !== 'submit') { e.preventDefault(); run(actions.find(a => a.id === b.dataset.action)); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); if (submitIdx >= 0 && !handle.action(actions[submitIdx].id).disabled) run(actions[submitIdx]); });
  // initial focus
  requestAnimationFrame(() => {
    const target = (o.initialFocus && sheetEl.querySelector(o.initialFocus)) || body.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea') || (submitIdx >= 0 ? handle.action(actions[submitIdx].id) : null) || sheetEl.querySelector('.sheet-close');
    if (target) { try { target.focus({ preventScroll: true }); if (target.select && target.type !== 'date' && target.tagName === 'INPUT') target.select(); } catch (e) { /* ignore */ } }
  });
  return handle;
};

/** In-page confirm (only for irreversible bulk actions). opts: {title, body (str|SafeHTML), confirmLabel, cancelLabel, danger} → Promise<boolean> */
ui.confirm = function confirm(opts) {
  const o = opts || {};
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: o.title || 'Are you sure?',
      body: o.body ? (RB.isSafe(o.body) ? o.body : h`<p class="muted">${o.body}</p>`) : '',
      cancel: o.cancelLabel || 'Cancel',
      actions: [{ id: 'confirm', label: o.confirmLabel || 'Confirm', kind: o.danger ? 'danger' : 'primary', onClick: () => { ok = true; } }],
      initialFocus: '[data-action="confirm"]',
      onClose: () => resolve(ok),
    });
  });
};

// ================================================================= menu
let openMenu = null;
/**
 * Dropdown menu anchored to an element. items: [{label, icon, hint, danger, disabled, onSelect(), checked} | {sep:true} | {heading:'…'}]
 * opts: {align:'start'|'end'}. Calling again on the same anchor toggles it closed. Returns {close}.
 */
ui.menu = function menu(anchor, items, opts) {
  const o = opts || {};
  if (openMenu && openMenu.anchor === anchor) { openMenu.close(); return null; }
  if (openMenu) openMenu.close();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = String(h`${items.map((it, i) => it.sep ? raw('<div class="menu-sep" role="separator"></div>')
    : it.heading ? h`<div class="menu-label">${it.heading}</div>`
    : h`<button type="button" role="menuitem" class="menu-item${it.danger ? ' is-danger' : ''}" data-i="${i}"${it.disabled ? raw(' disabled') : ''}${it.write ? raw(' data-write') : ''}>${it.icon ? ui.icon(it.icon) : it.checked !== undefined ? ui.icon(it.checked ? 'check' : 'dot', { cls: it.checked ? '' : 'vh' }) : ''}<span>${it.label}</span>${it.hint ? h`<span class="menu-hint">${it.hint}</span>` : ''}</button>`)}`);
  layerRoot().appendChild(el);
  // position
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left = o.align === 'end' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, vw - mw - 8));
  let top = r.bottom + 4;
  if (top + mh > vh - 8 && r.top - mh - 4 > 8) top = r.top - mh - 4;
  el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  const btns = () => Array.from(el.querySelectorAll('.menu-item:not(:disabled)'));
  let closed = false;
  const onDoc = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('pointerdown', onDoc, true);
    window.removeEventListener('resize', close);
    anchor.setAttribute('aria-expanded', 'false');
    el.remove(); popLayer(layer);
    if (openMenu && openMenu.el === el) openMenu = null;
  };
  const layer = pushLayer({ el, kind: 'menu', close, modal: false });
  openMenu = { el, anchor, close };
  el.addEventListener('click', e => {
    const b = e.target.closest('.menu-item');
    if (!b || b.disabled) return;
    const it = items[+b.dataset.i];
    close();
    if (it && it.onSelect) try { it.onSelect(); } catch (err) { console.error(err); }
  });
  el.addEventListener('keydown', e => {
    const list = btns(); const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (list[(i + 1) % list.length] || list[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (list[(i - 1 + list.length) % list.length] || list[0]).focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0] && list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1] && list[list.length - 1].focus(); }
    else if (e.key === 'Tab') { close(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
  window.addEventListener('resize', close);
  const first = btns()[0]; if (first) first.focus({ preventScroll: true });
  return { el, close };
};

// ================================================================= drawer
let drawerHandle = null;
/**
 * Drawer: right side (520px) on desktop, full screen on phone. One at a time — opening another replaces the content.
 * opts: {label (aria-label), render(el, handle) — fill el (use .drawer-head/.drawer-body/.drawer-foot), onClose(), scrim:true}
 * handle: {el, rerender(), close(), isOpen()}
 */
ui.drawer = function drawer(opts) {
  const o = opts || {};
  if (drawerHandle && drawerHandle.isOpen()) {
    drawerHandle.replace(o);
    return drawerHandle;
  }
  const scrim = document.createElement('div');
  scrim.className = 'scrim drawer-scrim';
  const el = document.createElement('aside');
  el.className = 'drawer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.tabIndex = -1;
  if (o.scrim !== false) layerRoot().appendChild(scrim);
  layerRoot().appendChild(el);
  let cur = o, open = true;
  const handle = {
    el,
    isOpen: () => open,
    rerender() { if (!open) return; el.setAttribute('aria-label', cur.label || 'Details'); const st = el.querySelector('.drawer-body'); const top = st ? st.scrollTop : 0; cur.render(el, handle); const nb = el.querySelector('.drawer-body'); if (nb) nb.scrollTop = top; },
    replace(next) { cur = next; el.setAttribute('aria-label', cur.label || 'Details'); cur.render(el, handle); const b = el.querySelector('.drawer-body'); if (b) b.scrollTop = 0; },
    /** close({silent:true}) skips onClose (the shell uses it when switching views). */
    close(opts) {
      if (!open) return; open = false;
      popLayer(layer);
      scrim.remove();
      animateOut(el, () => el.remove());
      drawerHandle = null;
      if (cur.onClose && !(opts && opts.silent)) try { cur.onClose(); } catch (e) { console.error(e); }
    },
  };
  scrim.addEventListener('click', () => handle.close());
  el.addEventListener('click', e => { if (e.target.closest('[data-drawer-close]')) handle.close(); });
  const layer = pushLayer({ el, kind: 'drawer', close: () => handle.close() });
  el.setAttribute('aria-label', o.label || 'Details');
  o.render(el, handle);
  requestAnimationFrame(() => { const f = el.querySelector('[data-autofocus]') || el; try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } });
  drawerHandle = handle;
  return handle;
};
ui.currentDrawer = () => (drawerHandle && drawerHandle.isOpen() ? drawerHandle : null);
/** Standard drawer close button (SafeHTML). */
ui.drawerClose = () => h`<button type="button" class="btn btn-ghost btn-icon drawer-close" data-drawer-close aria-label="Close">${ui.icon('x')}</button>`;

// ================================================================= palette (generic)
/** Highlight query tokens inside text (SafeHTML, escaped). */
ui.highlight = function highlight(text, query) {
  const s = String(text || '');
  const toks = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return h`${s}`;
  const marks = new Array(s.length).fill(false);
  const low = s.toLowerCase();
  toks.forEach(t => { let i = low.indexOf(t); if (i >= 0) for (let j = i; j < i + t.length; j++) marks[j] = true; });
  let out = '', on = false;
  for (let i = 0; i < s.length; i++) {
    if (marks[i] !== on) { out += marks[i] ? '<mark>' : '</mark>'; on = marks[i]; }
    out += RB.esc(s[i]);
  }
  if (on) out += '</mark>';
  return raw(out);
};
/** Simple matcher: every token appears in haystack. Returns score (lower is better) or -1. */
ui.match = function match(hay, query) {
  const toks = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return 0;
  const s = String(hay || '').toLowerCase();
  let score = 0;
  for (const t of toks) {
    const i = s.indexOf(t);
    if (i < 0) return -1;
    score += i === 0 || /[\s\-\/·]/.test(s[i - 1]) ? 0 : 10 + i;
  }
  return score;
};

/**
 * Palette (search + pick). opts: {placeholder, query, source(query) → [{group, items:[{id,label,sub,hint,icon,run()}]}], onClose(picked)}
 * Returns {close, setQuery}.
 */
ui.palette = function palette(opts) {
  const o = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'palette-wrap';
  wrap.innerHTML = String(h`<div class="scrim" data-close></div>
    <div class="palette" role="dialog" aria-modal="true" aria-label="${o.label || 'Search'}">
      <div class="palette-head">${ui.icon('search')}<input class="palette-input" id="rb-palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="rb-palette-list" aria-autocomplete="list" placeholder="${o.placeholder || 'Search…'}" autocomplete="off" spellcheck="false"><kbd class="kbd">esc</kbd></div>
      <div class="palette-list" id="rb-palette-list" role="listbox"></div>
      <div class="palette-foot"><span>${ui.kbd('↑', '↓')} move</span><span>${ui.kbd('↵')} open</span><span>${ui.kbd('esc')} close</span></div>
    </div>`);
  layerRoot().appendChild(wrap);
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.palette-list');
  let flat = [], sel = 0, closed = false, picked = null;
  const render = () => {
    const groups = (o.source(input.value) || []).filter(g => g.items && g.items.length);
    flat = [];
    list.innerHTML = groups.length ? String(h`${groups.map(g => h`${g.group ? h`<div class="palette-group">${g.group}</div>` : ''}${g.items.map(it => { const i = flat.push(it) - 1; return h`<button type="button" class="palette-item" role="option" id="rb-pal-${i}" data-i="${i}" aria-selected="${i === sel ? 'true' : 'false'}">${it.plate ? ui.plate(it.plate) : ui.icon(it.icon || 'arrow-right')}<span class="palette-item-main">${ui.highlight(it.label, input.value)}${it.sub ? h`<span class="palette-item-sub">${ui.highlight(it.sub, input.value)}</span>` : ''}</span>${it.hint ? h`<span class="palette-item-hint">${it.hint}</span>` : ''}</button>`; })}`)}`)
      : String(h`<div class="palette-empty">${o.emptyText || 'Nothing matches'} “${input.value}”</div>`);
    if (sel >= flat.length) sel = Math.max(0, flat.length - 1);
    mark();
  };
  const mark = () => {
    list.querySelectorAll('.palette-item').forEach(b => b.setAttribute('aria-selected', +b.dataset.i === sel ? 'true' : 'false'));
    const cur = list.querySelector('[data-i="' + sel + '"]');
    input.setAttribute('aria-activedescendant', cur ? cur.id : '');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    if (closed) return; closed = true;
    popLayer(layer); wrap.remove();
    if (o.onClose) o.onClose(picked);
  };
  const pick = i => { const it = flat[i]; if (!it) return; picked = it; close(); if (it.run) setTimeout(() => it.run(), 0); };
  const layer = pushLayer({ el: wrap, kind: 'palette', close });
  layer.restoreFocus = o.restoreFocus !== false;
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(flat.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  });
  list.addEventListener('mousemove', e => { const b = e.target.closest('.palette-item'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; mark(); } });
  list.addEventListener('click', e => { const b = e.target.closest('.palette-item'); if (b) pick(+b.dataset.i); });
  wrap.addEventListener('click', e => { if (e.target.matches('[data-close]')) close(); });
  input.value = o.query || '';
  render();
  input.focus();
  if (input.value) input.setSelectionRange(input.value.length, input.value.length);
  return { el: wrap, close, setQuery(q) { input.value = q; sel = 0; render(); } };
};

/** Tenant picker built on the palette → Promise<tenantId|null>. opts: {title(placeholder), filter(tenant) → bool, includePast:false} */
ui.pickTenant = function pickTenant(opts) {
  const o = opts || {};
  return new Promise(resolve => {
    ui.palette({
      placeholder: o.title || 'Choose a tenant…', label: o.title || 'Choose a tenant', emptyText: 'No tenant matches',
      source: q => {
        const list = RB.store.tenantsList({ includePast: !!o.includePast }).filter(t => !o.filter || o.filter(t));
        const items = list.map(t => ({ t, s: ui.match([t.name, t.unit, t.property, (t.coTenants || []).map(c => c.name).join(' ')].join(' '), q) }))
          .filter(x => x.s >= 0).sort((a, b) => a.s - b.s).slice(0, 50)
          .map(({ t }) => { const lg = RB.store.ledger(t.id); return { id: t.id, label: t.name, sub: t.property, plate: t.unit, hint: lg && lg.balance > 0 ? M.fmt(lg.balance) + ' owed' : '' }; });
        return [{ items }];
      },
      onClose: picked => resolve(picked ? picked.id : null),
    });
  });
};

// ================================================================= forms
let fieldSeq = 0;
/**
 * Field (SafeHTML): label + control + hint + error slot. Every control gets a stable id (opts.id || 'f-' + name).
 * opts: {name (required), id, label, type:'text'|'email'|'tel'|'number'|'money'|'date'|'select'|'textarea'|'checkbox'|'seg'|'search',
 *        value, options:[{value,label}|string] (select/seg), placeholder, hint, required, optional:true (adds "optional"),
 *        span:2, attrs:{...} (extra attributes on the control), rows (textarea), min, max, step, autocomplete, write:true,
 *        requiredMsg: what readForm says when a required field is empty (default is built from the label — see readForm)}
 * money: value in cents; readForm returns cents (integer) or null.  date: 'YYYY-MM-DD' or null.  checkbox: boolean.
 */
ui.field = function field(opts) {
  const o = opts || {};
  const name = o.name || 'f' + (++fieldSeq);
  const id = o.id || 'f-' + name;
  const common = Object.assign({ id, name, required: !!o.required, 'data-required-msg': o.required && o.requiredMsg ? o.requiredMsg : null, 'aria-describedby': id + '-err' + (o.hint ? ' ' + id + '-hint' : ''), 'data-write': o.write ? '' : null }, o.attrs || {});
  const val = o.value == null ? '' : o.value;
  let control;
  const t = o.type || 'text';
  if (t === 'money') {
    control = h`<span class="money-input"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input"${ui.attrs(Object.assign({ type: 'text', inputmode: 'decimal', 'data-kind': 'money', autocomplete: 'off', value: val === '' ? '' : M.input(val), placeholder: o.placeholder || '0.00' }, common))}></span>`;
  } else if (t === 'date') {
    control = h`<input class="input"${ui.attrs(Object.assign({ type: 'date', 'data-kind': 'date', value: val, min: o.min, max: o.max }, common))}>`;
  } else if (t === 'select') {
    const opt = (o.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: x }));
    control = h`<span class="select"><select class="input"${ui.attrs(common)}>${opt.map(x => h`<option value="${x.value}"${String(x.value) === String(val) ? raw(' selected') : ''}${x.disabled ? raw(' disabled') : ''}>${x.label}</option>`)}</select></span>`;
  } else if (t === 'textarea') {
    control = h`<textarea class="input textarea"${ui.attrs(Object.assign({ rows: o.rows || 3, placeholder: o.placeholder }, common))}>${val}</textarea>`;
  } else if (t === 'checkbox') {
    return h`<div class="field${o.span === 2 ? ' span-2' : ''}" data-field="${name}"><label class="check"><input${ui.attrs(Object.assign({ type: 'checkbox', checked: !!o.value }, common))}><span>${o.label}</span></label>${o.hint ? h`<div class="field-hint" id="${id}-hint">${o.hint}</div>` : ''}<div class="field-error" id="${id}-err"></div></div>`;
  } else if (t === 'seg') {
    const opt = (o.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: x }));
    control = h`<input type="hidden"${ui.attrs({ id, name, value: val, 'data-kind': 'seg' })}><div class="seg" role="radiogroup" aria-labelledby="${id}-label" data-seg-for="${id}">${opt.map(x => h`<button type="button" role="radio" data-value="${x.value}" aria-checked="${String(x.value) === String(val) ? 'true' : 'false'}" aria-pressed="${String(x.value) === String(val) ? 'true' : 'false'}">${x.icon ? ui.icon(x.icon, { size: 14 }) : ''}${x.label}</button>`)}</div>`;
  } else {
    control = h`<input class="input${t === 'number' ? ' input-num' : ''}"${ui.attrs(Object.assign({ type: t, value: val, placeholder: o.placeholder, min: o.min, max: o.max, step: o.step, autocomplete: o.autocomplete || 'off' }, common))}>`;
  }
  return h`<div class="field${o.span === 2 ? ' span-2' : ''}" data-field="${name}">
    ${o.label ? h`<label class="field-label" id="${id}-label" for="${id}">${o.label}${o.optional ? h` <span class="opt">optional</span>` : ''}</label>` : ''}
    ${control}
    ${o.hint ? h`<div class="field-hint" id="${id}-hint">${o.hint}</div>` : ''}
    <div class="field-error" id="${id}-err" aria-live="polite"></div>
  </div>`;
};

/**
 * Read every named control under root. Returns {values, errors, ok}.
 * money → cents|null (error if unparseable), date → 'YYYY-MM-DD'|null (error if invalid), checkbox → bool, number → Number|null,
 * required + empty → a message that says what to do, from the field's label: "Enter a name", "Enter the monthly rent",
 * "Choose a lease start date" (override per field with ui.field's requiredMsg, i.e. data-required-msg on the control).
 * opts.validate(values) → {name: message} adds custom errors.
 */
/** "Enter a name" / "Enter the monthly rent" / "Choose a lease start date" — the empty-required message for a control. */
function requiredMessage(el, root) {
  if (el.dataset.requiredMsg) return el.dataset.requiredMsg;
  const lab = (el.id && root.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
  let text = '';
  if (lab) { const c = lab.cloneNode(true); c.querySelectorAll('.opt, .vh, svg').forEach(x => x.remove()); text = c.textContent.replace(/\s+/g, ' ').trim(); }
  if (!text) return el.type === 'checkbox' ? 'Tick this to continue' : 'Fill this in';
  const lc = /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
  const a = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
  const kind = el.dataset.kind;
  if (el.type === 'checkbox') return 'Tick “' + text + '” to continue';
  if (kind === 'money') return 'Enter the ' + lc;
  if (kind === 'date') return /^date\b/i.test(lc) ? 'Choose the ' + lc : 'Choose ' + a(/\bdate$/i.test(lc) ? lc : lc + ' date');
  if (kind === 'seg' || el.tagName === 'SELECT') return 'Choose ' + a(lc);
  return 'Enter ' + a(lc);
}
ui.requiredMessage = requiredMessage;

ui.readForm = function readForm(root, opts) {
  const values = {}, errors = {};
  root.querySelectorAll('[name]').forEach(el => {
    const name = el.name;
    if (!name || el.disabled) return;
    const kind = el.dataset.kind;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
    else if (kind === 'money') {
      const s = el.value.trim();
      if (!s) v = null; else { v = M.parse(s); if (v === null) errors[name] = 'Enter an amount like 1,450.50'; }
    } else if (kind === 'date') {
      v = el.value || null;
      if (v && !D.valid(v)) errors[name] = 'Enter a valid date';
    } else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
    else v = el.value.trim();
    values[name] = v;
    if (el.required && (v === null || v === '' || v === false) && !errors[name]) errors[name] = requiredMessage(el, root);
  });
  if (opts && opts.validate) { const more = opts.validate(values) || {}; for (const k of Object.keys(more)) if (more[k] && !errors[k]) errors[k] = more[k]; }
  Object.keys(errors).forEach(k => { if (!errors[k]) delete errors[k]; });
  return { values, errors, ok: !Object.keys(errors).length };
};
/** Show errors from readForm (clears old ones). Focuses the first invalid control unless opts.focus === false. Returns true if there were none. */
ui.showErrors = function showErrors(root, errors, opts) {
  root.querySelectorAll('.field.is-invalid').forEach(f => f.classList.remove('is-invalid'));
  root.querySelectorAll('.field-error').forEach(e => { e.textContent = ''; });
  let first = null;
  for (const name of Object.keys(errors || {})) {
    const f = root.querySelector('[data-field="' + CSS.escape(name) + '"]');
    if (!f) continue;
    f.classList.add('is-invalid');
    const err = f.querySelector('.field-error'); if (err) err.textContent = errors[name];
    const c = f.querySelector('[name]'); if (c) c.setAttribute('aria-invalid', 'true');
    if (!first) first = f.querySelector('input:not([type=hidden]), select, textarea, .seg button');
  }
  if (first && !(opts && opts.focus === false)) first.focus();
  return !first;
};
/** readForm + showErrors in one go → values or null. */
ui.form = function form(root, opts) { const r = ui.readForm(root, opts); return ui.showErrors(root, r.errors) ? r.values : null; };
/** Set a control's value by name (money in cents, seg updates pressed state). */
ui.setValue = function setValue(root, name, value) {
  const el = root.querySelector('[name="' + CSS.escape(name) + '"]');
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else if (el.dataset.kind === 'money') el.value = value == null ? '' : M.input(value);
  else el.value = value == null ? '' : value;
  if (el.dataset.kind === 'seg') { const seg = root.querySelector('[data-seg-for="' + CSS.escape(el.id) + '"]'); if (seg) seg.querySelectorAll('button').forEach(b => { const on = b.dataset.value === String(value); b.setAttribute('aria-pressed', on); b.setAttribute('aria-checked', on); }); }
};

// global behaviours: segmented fields, money formatting, data-copy buttons
document.addEventListener('click', e => {
  const sb = e.target.closest('.seg[data-seg-for] > button');
  if (sb) {
    const seg = sb.parentElement;
    const input = document.getElementById(seg.dataset.segFor);
    seg.querySelectorAll('button').forEach(b => { const on = b === sb; b.setAttribute('aria-pressed', on); b.setAttribute('aria-checked', on); });
    if (input) { input.value = sb.dataset.value; input.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  const cp = e.target.closest('[data-copy]');
  if (cp) { e.preventDefault(); ui.copy(cp.getAttribute('data-copy'), cp.getAttribute('data-copy-what') || 'text'); }
});
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el && el.dataset && el.dataset.kind === 'money' && el.value.trim()) { const c = M.parse(el.value); if (c !== null) el.value = M.input(c); }
});

/** Copy with a toast; if the clipboard is refused, show the text selectable in a sheet. Call inside a click handler. */
ui.copy = function copy(text, what) {
  return RB.copyText(text).then(ok => {
    if (ok) ui.toast('Copied ' + (what || 'to clipboard'), { icon: 'check', duration: 2500 });
    else ui.showText({ title: 'Copy ' + (what || 'text'), text, note: 'Your browser blocked the clipboard — select the text and copy it.' });
    return ok;
  });
};
/** Sheet showing text in a selectable box with a Copy button (also the download fallback). opts: {title, text, note, filename} */
ui.showText = function showText(opts) {
  const o = opts || {};
  return ui.sheet({
    title: o.title || 'Text', size: 'wide', sub: o.filename || '',
    body: el => { el.innerHTML = String(h`${o.note ? h`<p class="muted mb-4">${o.note}</p>` : ''}<textarea class="code-block" id="rb-showtext" readonly rows="14" aria-label="${o.title || 'Text'}">${o.text}</textarea>`); },
    cancel: 'Close',
    actions: [{ id: 'copy', label: 'Copy', kind: 'primary', onClick: () => { const ta = document.getElementById('rb-showtext'); ta.select(); RB.copyText(o.text).then(ok => ui.toast(ok ? 'Copied' : 'Select the text and press Ctrl/⌘-C', { icon: ok ? 'check' : null, duration: 2500 })); return false; } }],
    initialFocus: '#rb-showtext',
  });
};

/**
 * Delegated events, bound once per element (safe to call on every render).
 * handlers: {name: (target, event) => …} — runs for click on [data-act="name"], change on [data-change="name"],
 * input on [data-input="name"], submit on form[data-submit="name"].
 */
ui.bind = function bind(el, handlers) {
  el._rbHandlers = handlers;
  if (el._rbBound) return el;
  el._rbBound = true;
  const route = (attr, e) => {
    const t = e.target.closest('[' + attr + ']');
    if (!t || !el.contains(t)) return;
    const fn = el._rbHandlers[t.getAttribute(attr)];
    if (fn) { if (e.type === 'submit') e.preventDefault(); fn(t, e); }
  };
  el.addEventListener('click', e => route('data-act', e));
  el.addEventListener('change', e => route('data-change', e));
  el.addEventListener('input', e => route('data-input', e));
  el.addEventListener('submit', e => route('data-submit', e));
  return el;
};

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

/** Glossary words for a month status (SPEC §8 rule 4). */
const STATUS_WORD = { paid: 'Paid', paid_late: 'Paid late', partial: 'Part paid', due: 'Not paid yet', late: 'Late', none: 'No charge' };
ui.STATUS_WORD = STATUS_WORD;
/**
 * Status pill (SafeHTML). status: paid|paid_late|partial|due|late|none, or 'partial_late' (some paid, rest past grace).
 * opts: {daysLate (late → "22 days late"), paid (cents already paid that month: a late month with paid > 0 renders as
 *        "Part paid — rest is 22 days late"), label (override text), size:'sm', title}
 * Easiest: ui.monthPill(month) with a RB.model Month object.
 */
ui.pill = function pill(status, opts) {
  const o = opts || {};
  let st = status === 'partial_late' ? 'partial_late' : STATUS_ICON[status] ? status : 'none';
  if (st === 'late' && o.paid > 0) st = 'partial_late';
  let label = o.label;
  if (!label) {
    if (st === 'late') label = o.daysLate ? D.days(o.daysLate) + ' late' : 'Late';
    else if (st === 'partial_late') label = 'Part paid — rest is ' + (o.daysLate ? D.days(o.daysLate) + ' late' : 'late');
    else if (st === 'none') label = null;
    else label = STATUS_WORD[st];
  }
  // v3: a pill IS a status marker (icon + words, colour on the marker only); the pill-* classes stay for old selectors.
  if (label === null) return ui.status('none', 'No rent this month', { cls: 'pill pill-none' + (o.size === 'sm' ? ' pill-sm' : ''), title: o.title || 'No rent charged this month' });
  return ui.status(st, label, { cls: 'pill pill-' + st + (o.size === 'sm' ? ' pill-sm' : ''), title: o.title });
};
/** Pill for a RB.model Month ({status, daysLate, rentPaid}). */
ui.monthPill = (m, opts) => (m && m.scheduled !== false ? ui.pill(m.status, Object.assign({ daysLate: m.daysLate, paid: m.rentPaid }, opts)) : ui.pill('none', opts));

/**
 * Plain words for a month (no markup): "Paid Nov 3", "Paid late, Nov 12", "Part paid — $800 of $1,475",
 * "Not paid yet — due Dec 1", "22 days late", "Part paid — rest is 22 days late", "No rent this month".
 */
ui.statusWords = function statusWords(m, today) {
  if (!m || m.scheduled === false || m.status === 'none') return 'No rent this month';
  const t = today || (RB.store ? RB.store.today() : D.today());
  switch (m.status) {
    case 'paid': return 'Paid' + (m.paidOn ? ' ' + D.fmt(m.paidOn, t) : '');
    case 'paid_late': return 'Paid late' + (m.paidOn ? ', ' + D.fmt(m.paidOn, t) : '');
    case 'partial': return 'Part paid — ' + M.fmt(m.rentPaid) + ' of ' + M.fmt(m.rentCharged);
    case 'due': return 'Not paid yet' + (m.due ? ' — due ' + D.fmt(m.due, t) : '');
    case 'late': return m.rentPaid > 0 ? 'Part paid — rest is ' + D.days(m.daysLate) + ' late' : D.days(m.daysLate) + ' late';
    default: return STATUS_WORD[m.status] || '';
  }
};

/** Money words (plain text): "Owes $1,225" · "All paid up" · "$250 paid ahead". */
ui.balanceWords = c => (c > 0 ? 'Owes ' + M.fmt(c) : c < 0 ? M.fmt(-c) + ' paid ahead' : 'All paid up');

/** Thin two-tone bar showing a paid share, drawn to scale (SafeHTML). opts: {label} */
ui.splitBar = function splitBar(paid, total, opts) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (paid / total) * 100)) : 0;
  const label = (opts && opts.label) || (M.fmt(paid) + ' of ' + M.fmt(total) + ' paid');
  return h`<span class="splitbar" role="img" aria-label="${label}"><span class="splitbar-paid" style="width:${pct.toFixed(2)}%"></span></span>`;
};

/**
 * Generic tag. tone: ''|'accent'|'quiet' → a small neutral label; 'ok'|'warn'|'bad' → rendered as a status marker
 * (v3 law 5: semantic colour only on status markers), keeping the tag-<tone> class for old selectors.
 */
ui.tag = (text, tone, icon) => (tone === 'ok' || tone === 'warn' || tone === 'bad'
  ? ui.status(tone, text, { icon: icon || (tone === 'ok' ? 'check' : tone === 'bad' ? 'triangle' : 'clock'), cls: 'tag tag-' + tone })
  : h`<span class="tag${tone ? ' tag-' + tone : ''}">${icon ? ui.icon(icon, { size: 14 }) : ''}${text}</span>`);

// ================================================================= v3 shared pieces (SPEC §10.2)
const MARK_ICON = { late: 'triangle', bad: 'triangle', urgent: 'triangle', partial_late: 'triangle', partial: 'half', warn: 'clock', notice: 'clock',
  due: 'circle', paid: 'check', paid_late: 'check-late', ok: 'check', info: 'dot', quiet: 'dot', none: 'dash' };
const MARK_TONE = { late: 'late', bad: 'late', urgent: 'late', partial_late: 'partial_late', partial: 'partial', warn: 'warn', notice: 'warn',
  due: 'due', paid: 'paid', paid_late: 'paid_late', ok: 'ok', info: 'info', quiet: 'quiet', none: 'none' };
ui.STATUS_KINDS = Object.keys(MARK_ICON);
/**
 * Status marker (SafeHTML): icon shape + words; the ONLY element allowed to carry semantic colour (law 5).
 * kind: late|bad|urgent (red triangle) · partial (amber half) · partial_late (amber words, red triangle) · warn|notice (amber clock)
 *       · due (ink hollow circle) · paid (muted tick — quiet) · paid_late · ok (green tick, use sparingly) · info (accent dot)
 *       · quiet (muted dot) · none (dash).
 * opts: {icon (override), cls (extra classes), title, id}
 */
ui.status = function status(kind, words, opts) {
  const o = opts || {};
  const k = MARK_TONE[kind] ? kind : 'quiet';
  const cls = 'status status-' + MARK_TONE[k] + (o.cls ? ' ' + o.cls : '');
  return h`<span class="${cls}"${o.title ? h` title="${o.title}"` : ''}${o.id ? h` id="${o.id}"` : ''}>${ui.icon(o.icon || MARK_ICON[k], { size: 14 })}<span class="status-words">${words}</span></span>`;
};

/**
 * The canonical row (SPEC §10.2). Returns `<li>…row…</li>` (pass {bare:true} for the row element alone).
 * opts: {lead (SafeHTML, e.g. ui.plate), title, sub, amt (string|SafeHTML; tabular, ink), status (ui.status(...)) — at the
 *        row's end under the amount, or under the sub line with statusPos:'main', end (extra SafeHTML at the end),
 *        href | act (data-act name) — the whole row is the one tap target and ends in a chevron; neither → a static row,
 *        btn: {label, act, id, attrs, write} — the ONE soft button allowed on Rent "still owes" rows and Today rent rows,
 *        bar (SafeHTML under the sub line, e.g. ui.splitBar), id, cls, attrs (on the tap target), liCls, liAttrs, chev:false, bare}
 * With `btn`, the row is <div class="row row-act">: the title is a <button class="row-hit"> stretched over the whole row
 * (carrying act/href/attrs/id), the button sits beside it (under the text, right-aligned, on phone).
 */
ui.row = function row(opts) {
  const o = opts || {};
  const lead = o.lead ? h`<span class="row-lead">${o.lead}</span>` : '';
  // status sits under the amount at the row's end (default), or under the sub line with statusPos:'main'
  const statusInMain = !!o.status && o.statusPos === 'main';
  const end = o.amt || (o.status && !statusInMain) || o.end
    ? h`<span class="row-end">${o.amt ? h`<span class="row-amt">${o.amt}</span>` : ''}${o.status && !statusInMain ? h`<span class="row-status">${o.status}</span>` : ''}${o.end || ''}</span>` : '';
  const tappable = !!(o.href || o.act || (o.attrs && o.attrs['data-act']));
  const chev = tappable && o.chev !== false ? h`<span class="row-chev" aria-hidden="true">${ui.icon('chevron-right')}</span>` : '';
  const sub = o.sub ? h`<span class="row-sub">${o.sub}</span>` : '';
  const bar = o.bar ? h`<span class="row-bar">${o.bar}</span>` : '';
  const st = statusInMain ? h`<span class="row-status">${o.status}</span>` : '';
  const cls = 'row' + (o.lead ? '' : ' row-nolead') + (o.cls ? ' ' + o.cls : '');
  const tapAttrs = Object.assign({ id: o.id, 'data-act': o.act }, o.attrs || {});
  let el;
  if (o.btn) {
    const b = o.btn;
    const hitTag = o.href ? 'a' : 'button';
    const hit = h`<${raw(hitTag)} class="row-hit"${o.href ? h` href="${o.href}"` : raw(' type="button"')}${ui.attrs(tapAttrs)}>${o.title}</${raw(hitTag)}>`;
    const btn = h`<button${ui.attrs(Object.assign({ type: 'button', class: 'btn btn-soft row-btn', id: b.id, 'data-act': b.act, 'data-write': b.write === false ? null : '' }, b.attrs || {}))}>${b.label}</button>`;
    // the status marker gets its own cell so it can share a line with the button on phone
    const st2 = o.status ? h`<span class="row-status row-act-status">${o.status}</span>` : '';
    const amt = o.amt ? h`<span class="row-end"><span class="row-amt">${o.amt}</span></span>` : '';
    // status + button: their own line on phone (wrapping only when they cannot share it); separate columns on desktop
    el = h`<div class="${cls} row-act">${lead}<span class="row-main">${hit}${sub}${bar}</span>${amt}<span class="row-act-foot">${st2}${btn}</span>${chev}</div>`;
  } else {
    const inner = h`${lead}<span class="row-main"><span class="row-title">${o.title}</span>${sub}${bar}${st}</span>${end}${chev}`;
    if (o.href) el = h`<a class="${cls}" href="${o.href}"${ui.attrs(tapAttrs)}>${inner}</a>`;
    else if (tappable) el = h`<button type="button" class="${cls}"${ui.attrs(tapAttrs)}>${inner}</button>`;
    else el = h`<div class="${cls} row-static"${ui.attrs(tapAttrs)}>${inner}</div>`;
  }
  if (o.bare) return el;
  return h`<li${o.liCls ? h` class="${o.liCls}"` : ''}${ui.attrs(o.liAttrs)}>${el}</li>`;
};
/** A hairline list of rows: ui.rows(arrayOfUiRowOpts | SafeHTML[], {inset, id, label, cls}). */
ui.rows = function rows(items, opts) {
  const o = opts || {};
  const list = (items || []).filter(Boolean).map(x => (RB.isSafe(x) ? x : ui.row(x)));
  return h`<ul class="rows${o.inset ? ' rows-inset' : ''}${o.cls ? ' ' + o.cls : ''}"${o.id ? h` id="${o.id}"` : ''}${o.label ? h` aria-label="${o.label}"` : ''}>${list}</ul>`;
};
/** Group heading for a list of rows: "Still owes 6" (14px 600, ink-2). opts {id} */
ui.rowsHead = (text, count, opts) => h`<h3 class="rows-head"${opts && opts.id ? h` id="${opts.id}"` : ''}>${text}${count !== undefined && count !== null && count !== '' ? h` <span class="rows-count">${count}</span>` : ''}</h3>`;
/** Quiet full-width "Show all 14" control. opts {id, act, expanded, label (override)} */
ui.rowsMore = function rowsMore(n, opts) {
  const o = opts || {};
  return h`<button type="button" class="rows-more"${ui.attrs({ id: o.id, 'data-act': o.act || 'more', 'aria-expanded': o.expanded ? 'true' : 'false' })}>${o.label || (o.expanded ? 'Show fewer' : 'Show all ' + n)}${ui.icon(o.expanded ? 'chevron-up' : 'chevron-down')}</button>`;
};

/**
 * View switch (law 8): one row, never wraps, fits 390px. items [{key, label, count?}], value = selected key.
 * opts {id (prefix → buttons #<id>-<key>), act (data-act, default 'seg'), label (aria-label)}
 * Buttons carry data-k="<key>" and aria-pressed. "Still owes 6 · Paid 20 · All 26".
 */
ui.segment = function segment(items, value, opts) {
  const o = opts || {};
  return h`<div class="seg segment" role="group"${o.label ? h` aria-label="${o.label}"` : ''}${o.id ? h` id="${o.id}"` : ''}>${(items || []).map(x => h`<button type="button"${ui.attrs({ id: o.id ? o.id + '-' + x.key : null, 'data-act': o.act || 'seg', 'data-k': x.key, 'aria-pressed': x.key === value ? 'true' : 'false' })}>${x.label}${x.count !== undefined && x.count !== null ? h` <span class="seg-n">${x.count}</span>` : ''}</button>`)}</div>`;
};

/** Radio cards (2–4 options) — a select at 5+ (law 8). Same opts as ui.field. */
ui.choice = o => ui.field(Object.assign({}, o, { type: 'choice' }));

/** Plain words for a date, written out: "Tuesday, November 24" (adds the year when it is not this year). */
ui.dateWords = function dateWords(d, today) {
  if (!d || !D.valid(d)) return '';
  const t = today || (RB.store ? RB.store.today() : D.today());
  const [y, m, dd] = d.split('-').map(Number);
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return wd + ', ' + D.MONTHS[m - 1] + ' ' + dd + (String(y) !== t.slice(0, 4) ? ', ' + y : '');
};
/** A date field with the date written out beside it (law 11). Same opts as ui.field; type is forced to 'date'. */
ui.dateField = o => ui.field(Object.assign({}, o, { type: 'date' }));

/**
 * One number, one name (law 7): "6 tenants owe $8,545 in total — $6,495 of it is November's rent."
 * owed = RB.model.owed(...) (default: computed from the store). Plain text.
 */
let owedCache = null;
ui.owed = function owed() {
  const S = RB.store;
  if (owedCache && owedCache.v === S.version && owedCache.t === S.today()) return owedCache.o;
  const o = RB.model.owed(S.state, S.today(), id => S.ledger(id));
  owedCache = { v: S.version, t: S.today(), o };
  return o;
};
ui.owedSentence = (owed, today) => RB.model.owedSentence(owed || ui.owed(), today || RB.store.today());

/** Tenant status tag: active (no tag unless opts.all), notice, past. */
ui.tenantTag = function tenantTag(status) {
  if (status === 'notice') return ui.tag('Moving out', 'warn', 'door');
  if (status === 'past') return ui.tag('Moved out', 'quiet');
  return ui.tag('Active', 'quiet');
};

/**
 * Door plate (SafeHTML). opts: {size:'sm'|'lg', status (month status, colours lg plates; sm plates only tint late/partial/none),
 *   title, button:true (renders a <button>), attrs:{...} extra attributes (escaped), property}
 */
ui.plate = function plate(unit, opts) {
  const o = opts || {};
  const lg = o.size === 'lg';
  const st = o.status && (STATUS_ICON[o.status] || o.status === 'partial_late') ? o.status : '';
  // v3: door plates are neutral; only the large grid plate keeps a small status glyph (colour on the glyph).
  const cls = 'plate ' + (lg ? 'plate-lg' : 'plate-sm') + (st && lg ? ' plate-' + st : st === 'none' ? ' plate-none' : '');
  const tag = o.button ? 'button' : 'span';
  const title = o.title || (o.property ? o.property + ' ' + unit : '');
  const inner = lg
    ? h`<span class="plate-unit">${unit || '—'}</span>${st && st !== 'none' ? h`<span class="plate-glyph">${ui.icon(st === 'partial_late' ? 'triangle' : STATUS_ICON[st], { size: 12 })}</span>` : ''}`
    : h`${unit || '—'}`;
  return h`<${raw(tag)} class="${cls}"${o.button ? raw(' type="button"') : ''}${title ? h` title="${title}"` : ''}${ui.attrs(o.attrs)}>${inner}</${raw(tag)}>`;
};

const STRIP_WORD = { paid: 'paid', paid_late: 'paid late', partial: 'part paid', due: 'not paid yet', late: 'late', none: 'no rent' };
/**
 * 12-month payment strip (SafeHTML). cells = RB.model.monthsBack(ledger, endKey, 12) (oldest → newest). opts: {lg:true, today}
 */
ui.strip = function strip(cells, opts) {
  const o = opts || {};
  const today = o.today || (RB.store ? RB.store.today() : D.today());
  const parts = (cells || []).map(c => {
    const mon = D.fmtMonthShort(c.period, today, { year: true });
    let t = mon + ' — ' + STRIP_WORD[c.status];
    if ((c.status === 'paid' || c.status === 'paid_late') && c.paidOn) t += ' ' + D.fmt(c.paidOn, today) + (c.status === 'paid_late' ? ' (' + D.days(c.daysLate) + ' late)' : '');
    else if (c.status === 'partial' || c.status === 'late') t += ': still owes ' + M.fmt(c.open) + (c.paid ? ', ' + M.fmt(c.paid) + ' paid' : '') + (c.status === 'late' ? ', ' + D.days(c.daysLate) + ' late' : '');
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

/**
 * Balance in words (v2 default; v3: always ink — money never carries colour): owed → "Owes $1,225" · zero → "All paid up" · credit → "$250 paid ahead".
 * opts: {zero: text for zero (''→ renders nothing visible)}, {plain:true}: figures only — owed "$1,225", credit "$250 ahead", zero "—".
 */
ui.balance = function balance(cents, opts) {
  const o = opts || {};
  const c = Math.round(cents || 0);
  if (!c) {
    if (o.zero !== undefined) return h`<span class="bal bal-zero amt-zero">${o.zero}</span>`;
    return o.plain ? raw('<span class="amt-zero">—</span>') : raw('<span class="bal bal-zero amt-zero">All paid up</span>');
  }
  if (c > 0) return o.plain ? ui.money(c, { tone: 'owed' }) : h`<span class="bal bal-owed">Owes ${ui.money(c, { tone: 'owed' })}</span>`;
  return h`<span class="bal bal-ahead amt-credit">${ui.money(-c, { cls: 'amt-credit' })} ${o.plain ? 'ahead' : 'paid ahead'}</span>`;
};

/** Plain date text: "Nov 3" / "Nov 3, 2025". opts.mono → mono class. */
ui.date = (d, opts) => h`<time class="${opts && opts.mono ? 'mono' : ''}" datetime="${d || ''}">${D.fmt(d, RB.store ? RB.store.today() : undefined)}</time>`;

/** <kbd> chip(s): ui.kbd('⌘K') or ui.kbd('g', 't') */
ui.kbd = (...keys) => h`${keys.map(k => h`<kbd class="kbd">${k}</kbd>`)}`;

/** Copyable value: text + a worded "Copy" button (data-copy is handled globally) + optional link button ("Call"). */
ui.copyline = function copyline(text, what, opts) {
  if (!text) return h`<span class="muted">Not given</span>`;
  const o = opts || {};
  const extra = o.href ? h`<a class="btn btn-sm btn-worded" href="${o.href}">${ui.icon(o.hrefIcon || 'external')}<span class="btn-label">${o.hrefLabel || 'Open'}</span></a>` : '';
  return h`<span class="copyline"><span class="copyline-text">${text}</span><button type="button" class="btn btn-sm btn-worded" data-copy="${text}" data-copy-what="${what || 'text'}" aria-label="Copy ${what || 'text'}">${ui.icon('copy')}<span class="btn-label">Copy</span></button>${extra}</span>`;
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
  // v2: no icon-only buttons. `iconOnly` is accepted for compatibility but the label is always visible.
  const cls = 'btn' + (b.kind ? ' btn-' + b.kind : '') + (b.size ? ' btn-' + b.size : '') + (b.iconOnly ? ' btn-worded' : '') + (b.cls ? ' ' + b.cls : '');
  const a = Object.assign({ type: 'button', class: cls, id: b.id, 'data-cmd': b.cmd, 'data-act': b.act, disabled: !!b.disabled, 'data-write': b.write ? '' : null, title: b.title }, b.attrs || {});
  return h`<button${ui.attrs(a)}>${b.icon ? ui.icon(b.icon) : ''}<span class="btn-label">${b.label}</span></button>`;
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
      <div class="micro">Welcome to Rent Book</div>
      <h2 class="firstrun-title" id="fr-title">Let’s set up your rent book</h2>
      <p class="firstrun-lede">One place to write down who has paid, who still owes, and what needs fixing. Pick one way to start — you can’t break anything, and you can change your mind later.</p>
    </div>
    <div class="firstrun-opts">
      ${opt('tenant:add', 'plus', 'Add your first tenant', 'Their name, which unit, and the rent. Rent Book keeps track of each month from there.')}
      ${opt('setup:import', 'upload', 'Bring in my tenants', 'Already have a list in Excel or another spreadsheet? Copy it in and we’ll sort out the columns.')}
      ${opt('sample:load', 'sample', 'Try it with sample tenants first', '27 made-up tenants so you can look around safely. Remove them with one button when you’re ready.')}
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
/** Law 10: feedback never blocks. Called whenever a sheet or drawer opens. */
ui.dismissToasts = function dismissToasts() {
  if (!toastBox) return;
  Array.from(toastBox.children).forEach(t => { if (t._rbClose) t._rbClose(); else t.remove(); });
};
const sheetOpen = () => layers.some(l => l.kind === 'sheet' || l.kind === 'palette');
function placeToasts() { if (toastBox) toastBox.classList.toggle('is-top', sheetOpen()); }
/**
 * Toast. opts: {undo: fn (adds a big "Undo"), action:{label, run}, tone:'bad', duration (ms, default 10000; 0 = sticky), icon}
 * Returns {close}.
 */
ui.TOAST_MS = 10000;
const heldToasts = [];
/** Show toasts that were held while a sheet was open (called when the last sheet closes). */
function flushToasts() { if (sheetOpen()) return; heldToasts.splice(0).forEach(t => { if (!t.cancelled) t.show(); }); }
ui.toast = function toast(message, opts) {
  const o = opts || {};
  // Law 10: a toast never sits over a sheet. One raised while a sheet is open is held and shown when it closes.
  if (sheetOpen()) {
    const held = { cancelled: false, real: null, show() { held.real = ui.toast(message, opts); } };
    heldToasts.push(held);
    return { el: null, close() { held.cancelled = true; if (held.real) held.real.close(); } };
  }
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    layerRoot().appendChild(toastBox);
  }
  while (toastBox.children.length >= 3) toastBox.firstChild.remove();
  placeToasts();
  const el = document.createElement('div');
  el.className = 'toast' + (o.tone === 'bad' ? ' toast-bad' : '');
  const act = o.undo ? { label: 'Undo', run: o.undo, undo: true } : o.action;
  el.innerHTML = String(h`${o.tone === 'bad' ? h`<span class="toast-ico">${ui.icon('alert')}</span>` : o.icon ? h`<span class="toast-ico">${ui.icon(o.icon)}</span>` : ''}<span class="toast-msg">${message}</span>${act ? h`<button type="button" class="toast-action">${act.undo ? ui.icon('undo') : ''}${act.label}</button>` : ''}<button type="button" class="toast-x">Close</button>`);
  toastBox.appendChild(el);
  let timer = null;
  const close = () => { clearTimeout(timer); if (!el.isConnected) return; el.style.pointerEvents = 'none'; animateOut(el, () => el.remove()); };
  el._rbClose = () => { clearTimeout(timer); el.remove(); };
  const arm = () => { clearTimeout(timer); const d = o.duration === undefined ? ui.TOAST_MS : o.duration; if (d) timer = setTimeout(close, d); };
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
  // Law 10: sheets never open from sheets. Any open sheet (or Find) is closed first, so there is only ever one.
  layers.filter(l => l.kind === 'sheet' || l.kind === 'palette' || l.kind === 'menu').reverse().forEach(l => { l.restoreFocus = false; l.close(); });
  ui.dismissToasts();
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
          <button type="button" class="btn btn-ghost btn-sm sheet-close" data-close>${ui.icon('x')}<span>Close</span></button></div>
        <div class="sheet-body"></div>
        <div class="sheet-foot"><span class="sheet-foot-note">${o.note || ''}</span>
          ${cancel ? h`<button type="button" class="btn btn-ghost" data-close>${cancel}</button>` : ''}
          ${actions.map((a, i) => h`<button type="${i === submitIdx ? 'submit' : 'button'}" class="btn${a.kind ? ' btn-' + a.kind : ''}" data-action="${a.id}"${a.disabled ? raw(' disabled') : ''}${a.hidden ? raw(' hidden') : ''}>${a.label}</button>`)}
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
      wrap.classList.add('is-closing');
      wrap.style.pointerEvents = 'none';
      animateOut(sheetEl, () => { wrap.remove(); placeToasts(); });
      setTimeout(flushToasts, 0);
      wrap.querySelector('.scrim').style.opacity = '0';
      if (o.onClose) try { o.onClose(result); } catch (e) { console.error(e); }
    },
    action: id => wrap.querySelector('[data-action="' + id + '"]'),
    setAction(id, p) { const b = handle.action(id); if (!b) return; if (p.label !== undefined) b.textContent = p.label; if (p.disabled !== undefined) b.disabled = !!p.disabled; if (p.hidden !== undefined) b.hidden = !!p.hidden; },
    setSub(t) { let el = wrap.querySelector('.sheet-sub'); if (!el) { el = document.createElement('div'); el.className = 'sheet-sub'; wrap.querySelector('.sheet-title').after(el); } el.textContent = t || ''; },
    setNote(x) { wrap.querySelector('.sheet-foot-note').innerHTML = String(x && RB.isSafe(x) ? x : RB.esc(x || '')); },
    setTitle(t) { wrap.querySelector('.sheet-title').textContent = t; },
    get closed() { return closed; },
  };
  const layer = pushLayer({ el: wrap, kind: 'sheet', close: () => handle.close() });
  if (o.page) sheetEl.classList.add('sheet-page');
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
    const target = (o.initialFocus && sheetEl.querySelector(o.initialFocus)) || body.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea') || (submitIdx >= 0 ? handle.action(actions[submitIdx].id) : null) || sheetEl.querySelector('.sheet-close');
    if (target) { try { target.focus({ preventScroll: true }); if (target.select && target.type !== 'date' && target.tagName === 'INPUT') target.select(); } catch (e) { /* ignore */ } }
  });
  return handle;
};

/**
 * Confirm (SPEC §8 rule 8): a plain consequence sentence, a large "Keep it" and a red worded destructive button.
 * opts: {title, body (str|SafeHTML — say what will happen), confirmLabel ("Remove this payment"), cancelLabel='Keep it', danger}
 * → Promise<boolean>. Focus starts on "Keep it"; Enter does not confirm.
 */
ui.confirm = function confirm(opts) {
  const o = opts || {};
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: o.title || 'Are you sure?',
      body: o.body ? (RB.isSafe(o.body) ? o.body : h`<p class="say">${o.body}</p>`) : '',
      cancel: false,
      actions: [
        { id: 'confirm', label: o.confirmLabel || 'Yes, do it', kind: o.danger ? 'danger' : 'primary', onClick: () => { ok = true; } },
        { id: 'keep', label: o.cancelLabel || 'Keep it', kind: 'keep' },
      ],
      initialFocus: '[data-action="keep"]',
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
  ui.dismissToasts();
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
/** Standard drawer close button (SafeHTML): reads "Close" on desktop, "Back" on phone (full-screen page). */
ui.drawerClose = () => h`<button type="button" class="btn btn-ghost drawer-close" data-drawer-close><span class="close-desk">${ui.icon('x')}</span><span class="close-phone">${ui.icon('chevron-left')}</span><span class="close-desk">Close</span><span class="close-phone">Back</span></button>`;

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
    <div class="palette" role="dialog" aria-modal="true" aria-label="${o.label || 'Find'}">
      <div class="palette-head">${ui.icon('search')}<input class="palette-input" id="rb-palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="rb-palette-list" aria-autocomplete="list" aria-label="${o.label || 'Find'}" placeholder="${o.placeholder || 'Find…'}" autocomplete="off" spellcheck="false"></div>
      <div class="palette-list" id="rb-palette-list" role="listbox"></div>
      <div class="palette-foot"><button type="button" class="btn btn-ghost btn-sm" data-close>${ui.icon('x')}<span>Close</span></button></div>
    </div>`);
  layerRoot().appendChild(wrap);
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.palette-list');
  let flat = [], sel = 0, closed = false, picked = null;
  const render = () => {
    const groups = (o.source(input.value) || []).filter(g => g.items && g.items.length);
    flat = [];
    list.innerHTML = groups.length ? String(h`${groups.map(g => h`${g.group ? h`<div class="palette-group">${g.group}</div>` : ''}${g.items.map(it => { const i = flat.push(it) - 1; return h`<button type="button" class="palette-item" role="option" id="rb-pal-${i}" data-i="${i}" aria-selected="${i === sel ? 'true' : 'false'}">${it.plate ? ui.plate(it.plate) : ui.icon(it.icon || 'arrow-right')}<span class="palette-item-main">${ui.highlight(it.label, input.value)}${it.sub ? h`<span class="palette-item-sub">${ui.highlight(it.sub, input.value)}</span>` : ''}</span>${it.hint ? h`<span class="palette-item-hint">${it.hint}</span>` : ''}</button>`; })}`)}`)
      : String(h`<div class="palette-empty">${o.emptyText || 'Nothing matches'} “${input.value}”. Check the spelling, or try part of a name or a unit number.</div>`);
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
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  input.value = o.query || '';
  render();
  input.focus();
  if (input.value) input.setSelectionRange(input.value.length, input.value.length);
  return { el: wrap, close, setQuery(q) { input.value = q; sel = 0; render(); } };
};

/** "Unit 2B at Alder Court" / "No. 4 at Fenwick Row" (plain text). */
ui.place = function place(t) {
  if (!t) return '';
  const u = String(t.unit || '').trim();
  const unit = u ? (/^[A-Za-z]?\d+[A-Za-z]?$/.test(u) || /^\d?[A-Za-z]$/.test(u) ? 'Unit ' + u : u) : '';
  return [unit, t.property].filter(Boolean).join(' at ');
};

/**
 * "What would you like to do?" — a short sheet of choices as rows (SPEC §10.3). Picking one closes the sheet FIRST, then
 * runs the item (law 10: a sheet never opens on top of a sheet).
 * opts: {title='What would you like to do?', sub, body (SafeHTML above the list), items:[{label, hint|sub, run, danger, write, id}]}
 * Falsy items are skipped. Returns the sheet handle. Row ids: item.id || 'choice-<i>'.
 */
ui.choices = function choices(opts) {
  const o = opts || {};
  const items = (o.items || []).filter(Boolean);
  return ui.sheet({
    title: o.title || 'What would you like to do?', sub: o.sub, cancel: false, actions: [],   // the head's "Close" is the one way out
    body: (el, sh) => {
      el.innerHTML = String(h`${o.body || ''}<ul class="rows choices-list">${items.map((x, i) => ui.row({
        title: x.label, sub: x.hint || x.sub, act: 'choice',
        cls: x.danger ? 'is-danger' : '',
        attrs: { id: x.id && /^[A-Za-z][\w-]*$/.test(x.id) ? x.id : 'choice-' + i, 'data-i': i, 'data-choice': x.id || null, 'data-write': x.write ? '' : null },
      }))}</ul>`);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const x = items[+b.dataset.i];
        sh.close('choice');
        if (x && x.run) setTimeout(() => { try { x.run(); } catch (err) { console.error(err); } }, 0);
      });
    },
    initialFocus: '.choices-list .row',
  });
};

/**
 * "Which tenant?" chooser (v2): a sheet with a big find box and large rows — door plate, name, property, what they owe.
 * opts: {title='Which tenant?', sub, filter(tenant) → bool, includePast:false, prefer:'owes'|null (owing tenants first,
 *        most owed first — use for payments), skip: label of an extra button that resolves '' (e.g. "It's for a whole building")}
 * → Promise<id | '' (skip) | null (cancelled)>. Enter in the find box picks the first row.
 */
ui.pickTenant = function pickTenant(opts) {
  const o = opts || {};
  // law 9: pickers show only what is relevant. purpose 'pay' (default when prefer:'owes') shows what they owe;
  // 'repair' and anything else show where they live.
  const purpose = o.purpose || (o.prefer === 'owes' ? 'pay' : 'place');
  return new Promise(resolve => {
    let picked = null;
    const today = RB.store.today();
    const all = RB.store.tenantsList({ includePast: !!o.includePast }).filter(t => !o.filter || o.filter(t));
    const bal = t => { const lg = RB.store.ledger(t.id); return lg ? lg.balance : 0; };
    const base = all.map((t, i) => ({ t, i, b: bal(t) }));
    if (o.prefer === 'owes') base.sort((a, b) => (b.b > 0) - (a.b > 0) || (a.b > 0 && b.b > 0 ? b.b - a.b : a.i - b.i));
    const rows = q => base.map((x, k) => ({ x, k, s: ui.match([x.t.name, x.t.unit, x.t.property, (x.t.coTenants || []).map(c => c.name).join(' ')].join(' '), q) }))
      .filter(r => r.s >= 0).sort((a, b) => (q ? a.s - b.s : 0) || a.k - b.k).map(r => r.x);
    const rowHtml = x => {
      const lg = RB.store.ledger(x.t.id);
      const m = lg && lg.months[D.monthKey(today)];
      const late = m && m.status === 'late';
      const sub = ui.place(x.t) + (x.t.status === 'past' ? ' · moved out' : x.t.status === 'notice' ? ' · moving out' : '');
      const pay = purpose === 'pay';
      return ui.row({ lead: ui.plate(x.t.unit, { property: x.t.property }), title: x.t.name, sub,
        amt: pay ? (x.b > 0 ? M.fmt(x.b) : '') : '',
        status: pay ? (late ? ui.status('late', 'Late — ' + D.days(m.daysLate)) : x.b > 0 ? '' : x.b < 0 ? ui.status('quiet', M.fmt(-x.b) + ' paid ahead') : ui.status('paid', 'All paid up')) : '',
        act: 'pick', cls: 'pick-row', attrs: { id: 'pick-' + x.t.id, 'data-pick': x.t.id } });
    };
    ui.sheet({
      title: o.title || 'Which tenant?', sub: o.sub || (o.prefer === 'owes' ? 'People who still owe are at the top.' : ''),
      cancel: 'Cancel', actions: [],
      body: (el, sh) => {
        el.innerHTML = String(h`<label class="search pick-find" for="pick-q"><span class="search-icon">${ui.icon('search')}</span><input class="input" id="pick-q" type="search" placeholder="A name or a unit, like 2B" autocomplete="off" spellcheck="false" aria-label="Find a tenant"></label>
          ${o.skip ? h`<button type="button" class="btn btn-block pick-skip" id="pick-skip" data-pick="">${o.skip}</button>` : ''}
          <ul class="rows pick-list" id="pick-list" aria-label="Tenants"></ul>`);
        const list = el.querySelector('#pick-list'), q = el.querySelector('#pick-q');
        const draw = () => {
          const r = rows(q.value);
          list.innerHTML = r.length ? String(h`${r.map(rowHtml)}`) : String(h`<li class="pick-empty">No tenant matches “${q.value}”. Check the spelling, or try a unit number.</li>`);
        };
        q.addEventListener('input', draw);
        q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const f = list.querySelector('[data-pick]'); if (f) f.click(); } });
        el.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { picked = b.dataset.pick; sh.close('pick'); } });
        draw();
      },
      initialFocus: ui.isPhone() ? '.sheet-close' : '#pick-q',
      onClose: () => resolve(picked),
    });
  });
};

// ================================================================= forms
let fieldSeq = 0;
/**
 * Field (SafeHTML): label + control + hint + error slot. Every control gets a stable id (opts.id || 'f-' + name).
 * opts: {name (required), id, label, type:'text'|'email'|'tel'|'number'|'money'|'date'|'select'|'textarea'|'checkbox'|'seg'|'choice'|'search',
 *        (choice = large radio cards, preferred over select for ≤6 options; options may carry {sub, icon}; cols:2 → two per row)
 *        big:true (money: larger input),
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
    control = h`<span class="money-input${o.big ? ' money-input-lg' : ''}"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input"${ui.attrs(Object.assign({ type: 'text', inputmode: 'decimal', 'data-kind': 'money', autocomplete: 'off', value: val === '' ? '' : M.input(val), placeholder: o.placeholder || '0.00' }, common))}></span>`;
  } else if (t === 'date') {
    // law 11: the date is written out in words beside the native field ("Tuesday, November 24"); kept live by a global listener.
    control = h`<span class="datefield"><input class="input"${ui.attrs(Object.assign({ type: 'date', 'data-kind': 'date', value: val, min: o.min, max: o.max }, common))}><span class="datefield-words" id="${id}-words" aria-hidden="true">${ui.dateWords(val)}</span></span>`;
  } else if (t === 'select') {
    const opt = (o.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: x }));
    control = h`<span class="select"><select class="input"${ui.attrs(common)}>${opt.map(x => h`<option value="${x.value}"${String(x.value) === String(val) ? raw(' selected') : ''}${x.disabled ? raw(' disabled') : ''}>${x.label}</option>`)}</select></span>`;
  } else if (t === 'textarea') {
    control = h`<textarea class="input textarea"${ui.attrs(Object.assign({ rows: o.rows || 3, placeholder: o.placeholder }, common))}>${val}</textarea>`;
  } else if (t === 'checkbox') {
    return h`<div class="field${o.span === 2 ? ' span-2' : ''}" data-field="${name}"><label class="check"><input${ui.attrs(Object.assign({ type: 'checkbox', checked: !!o.value }, common))}><span>${o.label}</span></label>${o.hint ? h`<div class="field-hint" id="${id}-hint">${o.hint}</div>` : ''}<div class="field-error" id="${id}-err"></div></div>`;
  } else if (t === 'choice' && (o.options || []).length >= 5) {
    // law 8: five or more options → a select (radio cards are for 2–4)
    return ui.field(Object.assign({}, o, { type: 'select' }));
  } else if (t === 'choice') {
    // large tappable choices (radio cards). Options [{value, label, sub?, icon?}] or strings. Read back like any field.
    const opt = (o.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: x }));
    control = h`<div class="choices${o.cols ? ' choices-' + o.cols : ''}" data-choice-for="${name}">${opt.map((x, i) => h`<label class="choice" for="${id}-${i}"><input${ui.attrs(Object.assign({ type: 'radio', id: id + '-' + i, name, value: x.value, checked: String(x.value) === String(val), 'data-kind': 'choice', 'data-write': o.write ? '' : null }, o.attrs || {}))}><span class="choice-body">${x.icon ? ui.icon(x.icon) : ''}<span class="choice-text"><span class="choice-label">${x.label}</span>${x.sub ? h`<span class="choice-sub">${x.sub}</span>` : ''}</span></span></label>`)}</div>`;
    return h`<div class="field${o.span === 2 ? ' span-2' : ''}" data-field="${name}" role="radiogroup" aria-labelledby="${id}-label">
      ${o.label ? h`<div class="field-label" id="${id}-label">${o.label}${o.optional ? h` <span class="opt">optional</span>` : ''}</div>` : ''}
      ${control}${o.hint ? h`<div class="field-hint" id="${id}-hint">${o.hint}</div>` : ''}<div class="field-error" id="${id}-err" aria-live="polite"></div></div>`;
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
/**
 * "Add more details (optional)" disclosure (SafeHTML). opts: {id, label, open} ; body SafeHTML.
 * Optional fields go inside so a form shows at most ~5 questions.
 */
ui.moreDetails = function moreDetails(body, opts) {
  const o = opts || {};
  return h`<details class="more-details"${o.id ? h` id="${o.id}"` : ''}${o.open ? raw(' open') : ''}><summary class="more-details-sum">${ui.icon('chevron-right', { cls: 'more-details-chev' })}<span>${o.label || 'Add more details (optional)'}</span></summary><div class="more-details-body">${body}</div></details>`;
};

/**
 * Text size control (SafeHTML): "Text size: Normal · Large · Extra large", remembered per device (RB.textSize).
 * opts: {id (prefix, unique on the page), compact:true (label visually hidden)}. Place anywhere; every copy stays in sync.
 */
ui.textSizeControl = function textSizeControl(opts) {
  const o = opts || {};
  const id = o.id || 'ts';
  const cur = RB.textSize.get();
  const label = v => (RB.textSize.OPTIONS.find(x => x.value === v) || {}).label || 'Normal';
  if (o.letters) {
    // v3 sidebar: one row of three "A"s of increasing size (accessible names say the size), the choice written beneath
    return h`<div class="textsize textsize-letters" role="group" aria-label="Text size"><div class="seg textsize-seg">${RB.textSize.OPTIONS.map(x => h`<button type="button" id="${id}-${x.value}" data-textsize="${x.value}" aria-pressed="${x.value === cur ? 'true' : 'false'}" aria-label="${x.label} text" class="textsize-${x.value}">A</button>`)}</div><span class="textsize-now" data-textsize-now>Text size: ${label(cur)}</span></div>`;
  }
  return h`<div class="textsize" role="group" aria-labelledby="${id}-l"><span class="textsize-label${o.compact ? ' vh' : ''}" id="${id}-l">Text size</span><div class="seg textsize-seg textsize-words">${RB.textSize.OPTIONS.map(x => h`<button type="button" id="${id}-${x.value}" data-textsize="${x.value}" aria-pressed="${x.value === cur ? 'true' : 'false'}" class="textsize-${x.value}">${x.label}</button>`)}</div></div>`;
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-textsize]');
  if (b) RB.textSize.set(b.dataset.textsize);
});
RB.on('textsize', v => {
  document.querySelectorAll('[data-textsize]').forEach(b => b.setAttribute('aria-pressed', b.dataset.textsize === v ? 'true' : 'false'));
  const l = (RB.textSize.OPTIONS.find(x => x.value === v) || {}).label || 'Normal';
  document.querySelectorAll('[data-textsize-now]').forEach(n => { n.textContent = 'Text size: ' + l; });
});

/**
 * Step-by-step guide in a sheet ("Step 2 of 3", Back / Next, then a summary sentence before saving).
 * opts: {title, steps:[{title, body(el, data) (render fields; values are read by name), validate(values, data) → {name: msg}}],
 *        summary(data) → SafeHTML|string (last screen, "Is this right?"), onDone(data) → false|Promise<false> keeps it open,
 *        doneLabel='Save', data:{} initial values, size}
 * Values from each step's named controls are merged into `data` (same types as ui.readForm). Returns the sheet handle
 * (handle.steps = {data, go(i), index}).
 */
ui.steps = function steps(opts) {
  const o = opts || {};
  const data = Object.assign({}, o.data || {});
  const list = o.steps || [];
  const n = list.length;
  let i = 0;
  const atSummary = () => i >= n;
  // law 9: the check-and-save screen is a step too ("Step 4 of 4")
  const total = n + (o.summary ? 1 : 0);
  let sh = null;
  const draw = () => {
    const body = sh.body;
    if (atSummary()) {
      const sum = o.summary ? o.summary(data) : '';
      body.innerHTML = String(h`<div class="steps-head"><div class="steps-count">Step ${total} of ${total}</div><h3 class="steps-title">Check and save</h3></div><div class="steps-summary">${RB.isSafe(sum) ? sum : h`${sum}`}</div><p class="caption mt-4">Is this right? Press Back to change anything.</p>`);
      sh.setAction('next', { label: o.doneLabel || 'Save' });
    } else {
      const st = list[i];
      body.innerHTML = String(h`<div class="steps-head"><div class="steps-count">Step ${i + 1} of ${total}</div><h3 class="steps-title">${st.title || ''}</h3></div><div class="steps-body form-col"></div>`);
      const el = body.querySelector('.steps-body');
      const r = st.body ? st.body(el, data) : null;
      if (r !== undefined && r !== null) el.innerHTML = String(RB.isSafe(r) ? r : RB.esc(r));
      sh.setAction('next', { label: i === n - 1 && !o.summary ? (o.doneLabel || 'Save') : 'Next' });
      requestAnimationFrame(() => { const f = el.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } });
    }
    sh.setAction('back', { hidden: i === 0 });
    body.scrollTop = 0;
  };
  const finish = async () => { const r = o.onDone ? await o.onDone(data) : undefined; return r === false ? false : undefined; };
  sh = ui.sheet({
    title: o.title || '', size: o.size,
    cancel: 'Cancel',
    actions: [
      { id: 'next', label: 'Next', kind: 'primary', onClick: async () => {
        if (!atSummary()) {
          const st = list[i];
          const el = sh.body.querySelector('.steps-body');
          const v = ui.form(el, { validate: vals => (st.validate ? st.validate(vals, data) : {}) });
          if (!v) return false;
          Object.assign(data, v);
          if (i === n - 1 && !o.summary) return finish();
          i++; draw(); return false;
        }
        return finish();
      } },
      { id: 'back', label: 'Back', kind: '', onClick: () => { if (i > 0) { i--; draw(); } return false; } },
    ],
  });
  sh.steps = { data, go(k) { i = Math.max(0, Math.min(n, k)); draw(); }, get index() { return i; } };
  draw();
  return sh;
};

/** Set a control's value by name (money in cents, seg updates pressed state). */
ui.setValue = function setValue(root, name, value) {
  const el = root.querySelector('[name="' + CSS.escape(name) + '"]');
  if (!el) return;
  if (el.type === 'radio') { root.querySelectorAll('[name="' + CSS.escape(name) + '"]').forEach(r => { r.checked = r.value === String(value); }); return; }
  if (el.type === 'checkbox') el.checked = !!value;
  else if (el.dataset.kind === 'money') el.value = value == null ? '' : M.input(value);
  else el.value = value == null ? '' : value;
  if (el.dataset.kind === 'date') { const w = document.getElementById(el.id + '-words'); if (w) w.textContent = ui.dateWords(el.value); }
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
document.addEventListener('input', e => {
  const el = e.target;
  if (el && el.dataset && el.dataset.kind === 'date' && el.id) { const w = document.getElementById(el.id + '-words'); if (w) w.textContent = ui.dateWords(el.value); }
}, true);
document.addEventListener('change', e => {
  const el = e.target;
  if (el && el.dataset && el.dataset.kind === 'date' && el.id) { const w = document.getElementById(el.id + '-words'); if (w) w.textContent = ui.dateWords(el.value); }
}, true);
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el && el.dataset && el.dataset.kind === 'money' && el.value.trim()) { const c = M.parse(el.value); if (c !== null) el.value = M.input(c); }
});

/** Copy with a toast; if the clipboard is refused, show the text selectable in a sheet. Call inside a click handler. */
ui.copy = function copy(text, what) {
  return RB.copyText(text).then(ok => {
    if (ok) ui.toast('Copied the ' + (what || 'text') + '. You can paste it into a text message or email.', { icon: 'check', duration: 5000 });
    else ui.showText({ title: 'Copy the ' + (what || 'text'), text, note: 'This browser would not copy it for us. Press and hold (or select) the text below, then choose Copy.' });
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
    actions: [{ id: 'copy', label: 'Copy', kind: 'primary', onClick: () => { const ta = document.getElementById('rb-showtext'); ta.select(); RB.copyText(o.text).then(ok => ui.toast(ok ? 'Copied.' : 'Select the text, then choose Copy.', { icon: ok ? 'check' : null, duration: 5000 })); return false; } }],
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

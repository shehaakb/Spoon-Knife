// views/rent.js — Rent: the monthly collection sheet. Built for recording 20+ payments in a minute.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

// ---- view state (module-level; survives re-renders) ----
let period = null;                                   // 'YYYY-MM' shown
let filter = RB.prefs.get('rent.filter', 'all');     // all | unpaid | late | partial | paid
let grouped = !!RB.prefs.get('rent.group', false);   // group by property
let cursorId = null;                                 // keyboard cursor (tenant id)
let bulkMode = false;                                // phone: show tick boxes
const selected = new Set();                          // tenant ids ticked for bulk payment
let pendingFocus = null;                             // element id to focus after the next render
let lastShown = [];                                  // tenant ids in display order (for keys)
let lastRows = new Map();                            // tenant id → row model from the last render
let lastCurrent = true;                              // whether the last render showed this month

const FILTERS = [['all', 'All'], ['unpaid', 'Unpaid'], ['late', 'Late'], ['partial', 'Partial'], ['paid', 'Paid']];
const PRED = {
  all: () => true,
  unpaid: r => r.unpaid,
  late: r => r.m.status === 'late',
  partial: r => r.m.status === 'partial',
  paid: r => r.m.status === 'paid' || r.m.status === 'paid_late',
};
const RANK = { late: 0, partial: 1, due: 2 };
if (!PRED[filter]) filter = 'all';

/** Rows for a period: every tenant with a rent/recurring charge that month, with what Mark paid would record. */
function buildRows(S, key, current) {
  const out = [];
  S.tenantsList().forEach((t, i) => {
    const lg = S.ledger(t.id);
    const m = lg && lg.months[key];
    if (!m || !m.scheduled) return;
    const unpaid = m.open > 0;
    // This month: quick pay records the full open balance (spec). Past month: that month's open amount.
    // Payments settle the oldest charge first, so clearing a past month means clearing everything up to it:
    // the balance less whatever is still open in later months.
    let later = 0;
    if (!current) for (const k of Object.keys(lg.months)) if (k > key) later += lg.months[k].open;
    const payAmount = unpaid ? (current ? Math.max(0, lg.balance) : Math.max(0, Math.min(lg.balance, lg.balance - later))) : 0;
    out.push({ t, i, lg, m, unpaid, payAmount, rank: unpaid ? (RANK[m.status] !== undefined ? RANK[m.status] : 3) : 4 });
  });
  return out;
}
const byRank = (a, b) => a.rank - b.rank || a.i - b.i;

/** Periods that have any rent charge (for the stepper bounds). */
function periodBounds(S, today) {
  const cur = D.monthKey(today);
  let min = cur, max = cur;
  const next = D.addMonthKey(cur, 1);
  for (const t of S.tenantsList()) {
    const lg = S.ledger(t.id); if (!lg) continue;
    for (const k of Object.keys(lg.months)) {
      if (!lg.months[k].scheduled) continue;
      if (k < min) min = k;
      if (k > max && k <= next) max = k;
    }
  }
  return { min, max, cur };
}

/** The payment (or credit) row that settled a month — for "paid Nov 3 · Zelle", receipts and voiding. */
function settledBy(lg, key) {
  const ids = new Set(lg.rows.filter(r => r.type === 'charge' && !r.void && r.period === key && (r.kind === 'rent' || r.kind === 'recurring')).map(r => r.id));
  let best = null;
  for (const r of lg.rows) if (r.type !== 'charge' && !r.void && r.applied && r.applied.some(a => ids.has(a.id))) best = r;
  return best;
}

// ------------------------------------------------------------------ pieces
const lateFeeLink = (r, key, cls) => {
  const s = r.lg.suggestedLateFee;
  if (r.m.status !== 'late' || !s || s.period !== key) return '';
  return h`<button type="button" class="linkbtn linkbtn-muted rent-fee ${cls || ''}" id="rent-fee-${cls ? 'c' : ''}${r.t.id}" data-act="fee" data-id="${r.t.id}" data-write aria-label="Add late fee ${M.fmt(s.amount)} for ${D.monthName(key)}, ${r.t.name}">+ late fee ${M.fmt(s.amount)}</button>`;
};
const payBtn = (r, pre) => h`<span class="btn-group rent-pay">
  <button type="button" class="btn btn-sm btn-soft" id="rent-${pre}pay-${r.t.id}" data-act="pay" data-id="${r.t.id}" data-write title="Record ${M.fmt(r.payAmount)} today" aria-label="Mark paid: record ${M.fmt(r.payAmount)} from ${r.t.name} today">Mark paid</button><button type="button" class="btn btn-sm btn-soft btn-caret" id="rent-${pre}sheet-${r.t.id}" data-act="sheet" data-id="${r.t.id}" data-write aria-label="Payment details for ${r.t.name}" title="Amount, date, method…">${ui.icon('chevron-down')}</button>
</span>`;
const menuBtn = (r, pre) => h`<button type="button" class="btn btn-ghost btn-icon btn-sm rent-menu" id="rent-${pre}menu-${r.t.id}" data-act="menu" data-id="${r.t.id}" aria-label="More for ${r.t.name}" aria-haspopup="menu">${ui.icon('more')}</button>`;
function paidNote(r, today) {
  const p = settledBy(r.lg, r.m.period);
  const when = r.m.paidOn ? D.fmt(r.m.paidOn, today) : '';
  const how = p ? (p.type === 'credit' ? 'credit' : p.method || '') : '';
  return [when, how].filter(Boolean).join(' · ');
}
const amt = (c, opts) => (c ? ui.money(c, opts) : h`<span class="faint" aria-label="none">—</span>`);

function tableRow(r, key, today) {
  const sel = selected.has(r.t.id), cur = cursorId === r.t.id;
  return h`<tr class="rent-row${cur ? ' is-focused' : ''}${sel ? ' is-selected' : ''}" data-row="${r.t.id}" data-act="cursor" data-id="${r.t.id}"${cur ? RB.raw(' aria-current="true"') : ''}>
    <td class="tbl-check">${r.unpaid ? h`<input type="checkbox" id="rent-chk-${r.t.id}" data-change="sel" data-id="${r.t.id}" aria-label="Select ${r.t.name}"${sel ? RB.raw(' checked') : ''} data-write>` : ''}</td>
    <td class="rent-c-plate">${ui.plate(r.t.unit, { property: r.t.property })}</td>
    <td class="rent-c-name"><span class="cell-name">${r.t.name}</span>${!grouped ? h`<span class="cell-sub">${r.t.property}${r.t.status === 'past' ? ' · moved out' : ''}</span>` : r.t.status === 'past' ? h`<span class="cell-sub">moved out</span>` : ''}</td>
    <td class="num">${ui.money(r.m.charged)}</td>
    <td class="num">${amt(r.m.paid)}</td>
    <td class="num">${amt(r.m.open, { tone: r.m.status === 'late' ? 'owed' : '' })}</td>
    <td class="rent-c-status"><span class="rent-status">${ui.pill(r.m.status, { daysLate: r.m.daysLate })}${lateFeeLink(r, key)}</span></td>
    <td class="rent-c-act"><span class="rent-act">${r.unpaid ? payBtn(r, '') : h`<span class="rent-paidon">${paidNote(r, today)}</span>`}${menuBtn(r, '')}</span></td>
  </tr>`;
}

function card(r, key, today) {
  const sel = selected.has(r.t.id), cur = cursorId === r.t.id;
  const showChk = (bulkMode || selected.size > 0) && r.unpaid;
  const sub = r.unpaid
    ? h`${ui.money(r.m.charged)} due${r.m.paid ? h` · ${ui.money(r.m.paid)} paid` : ''}`
    : h`Paid ${paidNote(r, today)}`;
  return h`<div class="crow rent-card${cur ? ' is-cursor' : ''}${sel ? ' is-selected' : ''}" data-row="${r.t.id}" data-act="cursor" data-id="${r.t.id}">
    <span class="crow-lead rent-card-lead">${showChk ? h`<label class="rent-cchk"><input type="checkbox" id="rent-cchk-${r.t.id}" data-change="sel" data-id="${r.t.id}" aria-label="Select ${r.t.name}"${sel ? RB.raw(' checked') : ''} data-write></label>` : ''}${ui.plate(r.t.unit, { property: r.t.property })}</span>
    <div class="crow-main"><div class="crow-title">${r.t.name}</div><div class="crow-sub">${sub}</div></div>
    ${r.unpaid
      ? h`<div class="crow-aside">${ui.pill(r.m.status, { daysLate: r.m.daysLate, size: 'sm' })}${ui.money(r.m.open, { tone: r.m.status === 'late' ? 'owed' : '' })}</div>
        <div class="crow-actions rent-cact">${lateFeeLink(r, key, 'c')}<span class="spacer"></span>${menuBtn(r, 'c')}${payBtn(r, 'c')}</div>`
      : h`<div class="crow-aside rent-caside-paid">${ui.pill(r.m.status, { daysLate: r.m.daysLate, size: 'sm' })}${menuBtn(r, 'c')}</div>`}
  </div>`;
}

// ------------------------------------------------------------------ actions
function rowOf(id) { return lastRows.get(id) || null; }
function payOpts(r) { return lastCurrent ? { quick: true } : { quick: true, amount: r.payAmount }; }
/** Quick pay, then move the cursor to the next unpaid row in the old order (the list re-sorts under it). */
function markPaid(r) {
  if (!r || !r.unpaid) return;
  const ae = document.activeElement;
  const wasBtn = ae && ae.id && /^rent-c?(pay|sheet|chk|cchk)-/.test(ae.id);
  const phone = ae && ae.id && /^rent-c/.test(ae.id);
  const i = lastShown.indexOf(r.t.id);
  const unpaidAfter = lastShown.slice(i + 1).find(id => rowOf(id) && rowOf(id).unpaid);
  const unpaidBefore = lastShown.slice(0, Math.max(0, i)).reverse().find(id => rowOf(id) && rowOf(id).unpaid);
  const next = unpaidAfter || unpaidBefore || null;
  if (cursorId === r.t.id || cursorId === null || wasBtn) cursorId = next || r.t.id;
  if (wasBtn && next) pendingFocus = 'rent-' + (phone ? 'c' : '') + 'pay-' + next;
  selected.delete(r.t.id);
  RB.actions.recordPayment(r.t.id, payOpts(r));
}
function openSheet(r) {
  if (!r) return;
  cursorId = r.t.id;
  RB.actions.recordPayment(r.t.id, lastCurrent || !r.unpaid || !r.payAmount ? {} : { amount: r.payAmount });
}
function rowMenu(anchor, r) {
  const items = [];
  if (r.unpaid) {
    items.push({ label: 'Record payment…', icon: 'cash', write: true, onSelect: () => openSheet(r) });
    const s = r.lg.suggestedLateFee;
    if (r.m.status === 'late' && s && s.period === r.m.period) items.push({ label: 'Add late fee ' + M.fmt(s.amount), icon: 'plus', write: true, onSelect: () => RB.actions.addLateFee(r.t.id, r.m.period) });
  } else {
    const p = settledBy(r.lg, r.m.period);
    if (p && p.kind === 'entry') {
      items.push({ label: 'Copy receipt', icon: 'copy', onSelect: () => RB.actions.copyReceipt(r.t.id, p.id) });
      if (p.type === 'payment') items.push({ label: 'Void ' + M.fmt(p.amount) + ' payment', icon: 'undo', danger: true, write: true, onSelect: () => RB.actions.voidEntry(r.t.id, p.id) });
    }
    items.push({ label: 'Record another payment…', icon: 'cash', write: true, onSelect: () => RB.actions.recordPayment(r.t.id) });
  }
  items.push({ sep: true });
  items.push({ label: 'Add note…', icon: 'note', write: true, onSelect: () => RB.actions.addNote(r.t.id) });
  items.push({ label: 'View tenant', icon: 'user', onSelect: () => RB.actions.openTenant(r.t.id) });
  ui.menu(anchor, items, { align: 'end' });
}
function scrollToCursor() {
  const els = document.querySelectorAll('[data-row="' + CSS.escape(cursorId || '') + '"]');
  for (const el of els) if (el.offsetParent !== null) { el.scrollIntoView({ block: 'nearest' }); break; }
}
function moveCursor(d) {
  if (!lastShown.length) return;
  const i = lastShown.indexOf(cursorId);
  cursorId = lastShown[i < 0 ? (d > 0 ? 0 : lastShown.length - 1) : Math.max(0, Math.min(lastShown.length - 1, i + d))];
  RB.shell.refresh();
  scrollToCursor();
}
function toggleSel(id, on) {
  const r = rowOf(id); if (!r || !r.unpaid) return;
  const v = on === undefined ? !selected.has(id) : on;
  if (v) selected.add(id); else selected.delete(id);
}
function bulkRecord() {
  const rows = Array.from(selected).map(rowOf).filter(r => r && r.unpaid);
  if (!rows.length) return;
  const amounts = {};
  rows.forEach(r => { amounts[r.t.id] = r.payAmount; });
  RB.actions.recordPayments(rows.map(r => r.t.id), lastCurrent ? undefined : { amounts });
  selected.clear();
  bulkMode = false;
  RB.shell.refresh();
}

// ------------------------------------------------------------------ render
function render(el, ctx) {
  const S = ctx.store;
  const today = ctx.today;
  const b = periodBounds(S, today);
  if (!period || period > b.max) period = b.cur;
  if (period < b.min) period = b.min;
  const current = period === b.cur;
  lastCurrent = current;
  const all = buildRows(S, period, current);
  lastRows = new Map(all.map(r => [r.t.id, r]));
  for (const id of Array.from(selected)) { const r = lastRows.get(id); if (!r || !r.unpaid) selected.delete(id); }

  const counts = {}; FILTERS.forEach(([k]) => { counts[k] = all.filter(PRED[k]).length; });
  const shown = all.filter(PRED[filter]).sort(byRank);
  let groups;
  if (grouped) {
    const map = new Map();
    for (const r of shown.slice().sort((a, b2) => a.i - b2.i)) { if (!map.has(r.t.property)) map.set(r.t.property, []); map.get(r.t.property).push(r); }
    groups = Array.from(map.entries()).map(([prop, list]) => ({ prop, list: list.sort(byRank) }));
  } else groups = [{ prop: null, list: shown }];
  lastShown = groups.flatMap(g => g.list.map(r => r.t.id));
  if (cursorId && !lastShown.includes(cursorId)) cursorId = null;

  const p = S.portfolio(period);
  const rate = p.charged ? Math.round((p.collected / p.charged) * 100) : null;
  const unpaidShown = shown.filter(r => r.unpaid);
  const allSel = unpaidShown.length > 0 && unpaidShown.every(r => selected.has(r.t.id));
  const someSel = !allSel && unpaidShown.some(r => selected.has(r.t.id));
  const selRows = Array.from(selected).map(rowOf).filter(Boolean);
  const selTotal = selRows.reduce((a, r) => a + r.payAmount, 0);
  const chip = ([k, label]) => h`<button type="button" class="chip" id="rent-f-${k}" aria-pressed="${filter === k ? 'true' : 'false'}" data-act="filter" data-k="${k}">${label}<span class="chip-count${k === 'late' && counts.late ? ' is-bad' : ''}">${counts[k]}</span></button>`;
  const emptyMsg = { all: 'No rent was charged for ' + D.fmtMonth(period) + '.', unpaid: 'Everyone has paid ' + D.monthName(period) + ' rent.', late: 'No late rent for ' + D.fmtMonth(period) + '.', partial: 'No partial payments for ' + D.fmtMonth(period) + '.', paid: 'No one has paid ' + D.monthName(period) + ' rent yet.' }[filter];

  el.innerHTML = String(h`<div class="rent${selected.size ? ' has-bar' : ''}">
    <div class="view-head rent-head">
      <div class="stepper" role="group" aria-label="Month">
        <button type="button" class="btn btn-ghost btn-icon" id="rent-prev" data-act="step" data-d="-1" aria-label="Previous month"${period <= b.min ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}</button>
        <span class="stepper-label" aria-live="polite">${D.fmtMonth(period)}</span>
        <button type="button" class="btn btn-ghost btn-icon" id="rent-next" data-act="step" data-d="1" aria-label="Next month"${period >= b.max ? RB.raw(' disabled') : ''}>${ui.icon('chevron-right')}</button>
      </div>
      ${current ? h`<span class="rent-now faint">This month</span>` : h`<button type="button" class="btn btn-sm" id="rent-today" data-act="now">${ui.icon('arrow-right')}<span>This month</span></button>`}
      <span class="spacer"></span>
      <label class="check rent-groupby"><input type="checkbox" id="rent-group" data-change="group"${grouped ? RB.raw(' checked') : ''}> <span><span class="hide-phone">Group by property</span><span class="show-phone">By property</span></span></label>
    </div>
    <div class="rent-tools">
      <div class="chips chips-scroll" role="group" aria-label="Filter">${FILTERS.map(chip)}</div>
      <span class="spacer"></span>
      ${counts.unpaid ? h`<button type="button" class="btn btn-sm btn-ghost show-phone rent-selectbtn" id="rent-select" data-act="bulkmode" aria-pressed="${bulkMode || selected.size ? 'true' : 'false'}" data-write>${bulkMode || selected.size ? 'Done' : 'Select'}</button>` : ''}
    </div>
    ${(bulkMode || selected.size > 0) && unpaidShown.length ? h`<div class="show-phone rent-selall"><label class="check"><input type="checkbox" id="rent-call" data-change="all"${allSel ? RB.raw(' checked') : ''}> Select all unpaid (${unpaidShown.length})</label></div>` : ''}

    ${shown.length ? h`
    <div class="tbl-wrap hide-phone"><table class="tbl rent-tbl">
      <thead><tr>
        <th class="tbl-check">${unpaidShown.length ? h`<input type="checkbox" id="rent-all" data-change="all" aria-label="Select all unpaid"${allSel ? RB.raw(' checked') : ''} data-write>` : ''}</th>
        <th class="rent-c-plate">Unit</th><th>Tenant</th><th class="num">Due</th><th class="num">Paid</th><th class="num">Open</th><th>Status</th><th class="rent-c-act"><span class="vh">Actions</span></th>
      </tr></thead>
      <tbody>${groups.map(g => h`${g.prop !== null ? h`<tr class="tbl-group"><td colspan="8">${g.prop || 'No property'} <span class="rent-gcount">${g.list.filter(r => r.unpaid).length ? g.list.filter(r => r.unpaid).length + ' unpaid' : 'all paid'}</span></td></tr>` : ''}${g.list.map(r => tableRow(r, period, today))}`)}</tbody>
    </table></div>
    <div class="clist show-phone rent-cards">${groups.map(g => h`${g.prop !== null ? h`<div class="rent-cgroup">${g.prop || 'No property'}</div>` : ''}${g.list.map(r => card(r, period, today))}`)}</div>`
    : ui.empty({ quiet: true, title: emptyMsg })}

    <div class="totals rent-totals" aria-label="${D.fmtMonth(period)} totals, all tenants">
      <div><span class="micro">Charged</span>${ui.money(p.charged)}</div>
      <div><span class="micro">Collected</span>${ui.money(p.collected)}</div>
      <div><span class="micro">Outstanding</span>${ui.money(p.outstanding, { tone: p.outstanding ? 'owed' : '' })}</div>
      <div><span class="micro">Collection rate</span><span class="rent-rate">${rate === null ? '—' : rate + '%'}</span></div>
      <div class="rent-totals-note">${D.fmtMonth(period)} · all ${RB.plural(p.tenants, 'tenant')}${!current ? ' · payments recorded here are dated today' : ''}</div>
    </div>

    ${selected.size ? h`<div class="actionbar rent-bar" role="region" aria-label="Selected rows">
      <span class="rent-bar-n">${selected.size} selected</span>
      <button type="button" class="btn btn-ghost btn-sm" id="rent-clear" data-act="clear">Clear</button>
      <button type="button" class="btn btn-primary" id="rent-bulk" data-act="bulk" data-write>Record ${RB.plural(selRows.length, 'payment')} · ${M.fmt(selTotal)}</button>
    </div>` : ''}
  </div>`);

  const allBox = el.querySelector('#rent-all'); if (allBox) allBox.indeterminate = someSel;
  const callBox = el.querySelector('#rent-call'); if (callBox) callBox.indeterminate = someSel;

  ui.bind(el, {
    filter: btn => { filter = btn.dataset.k; RB.prefs.set('rent.filter', filter); RB.shell.refresh(); },
    step: btn => { const n = D.addMonthKey(period, +btn.dataset.d); period = n; selected.clear(); cursorId = null; RB.shell.refresh(); const same = document.getElementById(btn.id); if (same && same.disabled) { const o = document.getElementById(btn.dataset.d > 0 ? 'rent-prev' : 'rent-next'); if (o) o.focus(); } },
    now: () => { period = null; selected.clear(); cursorId = null; RB.shell.refresh(); const s = document.getElementById('rent-prev'); if (s) s.focus(); },
    group: inp => { grouped = inp.checked; RB.prefs.set('rent.group', grouped); RB.shell.refresh(); },
    pay: btn => markPaid(rowOf(btn.dataset.id)),
    sheet: btn => openSheet(rowOf(btn.dataset.id)),
    fee: btn => { cursorId = btn.dataset.id; RB.actions.addLateFee(btn.dataset.id, period); },
    menu: btn => { const r = rowOf(btn.dataset.id); if (r) { cursorId = r.t.id; rowMenu(btn, r); } },
    sel: inp => { toggleSel(inp.dataset.id, inp.checked); if (inp.id.startsWith('rent-chk-')) cursorId = inp.dataset.id; RB.shell.refresh(); },
    all: inp => { const on = inp.checked; unpaidShownIds().forEach(id => toggleSel(id, on)); RB.shell.refresh(); },
    bulkmode: () => { if (bulkMode || selected.size) { bulkMode = false; selected.clear(); } else bulkMode = true; RB.shell.refresh(); },
    clear: () => { selected.clear(); bulkMode = false; RB.shell.refresh(); },
    bulk: () => bulkRecord(),
    cursor: (row, e) => {
      if (e.target.closest('input, button, a, label')) return;
      const id = row.dataset.id;
      if ((bulkMode || selected.size) && ui.isPhone()) { toggleSel(id); RB.shell.refresh(); return; }
      if (cursorId !== id) { cursorId = id; RB.shell.refresh(); }
    },
  });
  // Keys while a tick box has focus (the shell treats any input as typing): keep j/k/p/x/o/Enter working.
  if (!el._rentKeys) {
    el._rentKeys = true;
    el.addEventListener('keydown', e => {
      if (!e.target.matches || !e.target.matches('input[type="checkbox"]') || e.target.id === 'rent-group') return;
      if (['j', 'k', 'p', 'o', 'x', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
      }
    });
  }
  if (pendingFocus) {
    const f = document.getElementById(pendingFocus);
    pendingFocus = null;
    if (f && f.offsetParent !== null) try { f.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  }
}
function unpaidShownIds() { return lastShown.filter(id => rowOf(id) && rowOf(id).unpaid); }

function handleKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key;
  if (k === 'j' || k === 'ArrowDown') { moveCursor(1); return true; }
  if (k === 'k' || k === 'ArrowUp') { moveCursor(-1); return true; }
  if (k === 'Escape' && (selected.size || bulkMode)) { selected.clear(); bulkMode = false; RB.shell.refresh(); return true; }
  const r = rowOf(cursorId);
  if (!r || !lastShown.includes(cursorId)) return false;
  if (k === 'p') { if (r.unpaid && RB.store.canWrite()) markPaid(r); return true; }
  if (k === 'Enter') {
    if (e.target && e.target.closest && e.target.closest('button, a, select, textarea, input:not([type="checkbox"])')) return false;
    openSheet(r); return true;
  }
  if (k === 'x') { if (r.unpaid) { toggleSel(r.t.id); RB.shell.refresh(); } return true; }
  if (k === 'o') { RB.actions.openTenant(r.t.id); return true; }
  return false;
}

RB.views.register('rent', {
  title: 'Rent',
  shortcuts: [['j / ↓', 'Next row'], ['k / ↑', 'Previous row'], ['p', 'Mark paid'], ['Enter', 'Open payment sheet'], ['x', 'Select row'], ['o', 'Open tenant'], ['Esc', 'Clear selection']],
  render,
  onKey: e => handleKey(e),
  destroy() { selected.clear(); bulkMode = false; },
});

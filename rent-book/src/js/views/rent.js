// views/rent.js — Rent (SPEC §10.3): the owed sentence (law 7), the month as the display element with text-link stepping,
// a one-row segment, "still owes" rows with ONE soft button (row tap → "What would you like to do?"), paid rows plain,
// "Record several at once" as a text link, the month at a glance (desktop only), totals as one sentence.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

// ---- view state (module-level; survives re-renders) ----
let period = null;                                   // 'YYYY-MM' shown
let tab = RB.prefs.get('rent.tab', 'owes');          // owes | paid | all
let bulkMode = false;                                // "Record several at once"
const selected = new Set();                          // tenant ids ticked in bulk mode
let cursorId = null;                                 // keyboard cursor (not advertised)
let pendingFocus = null;
let lastShown = [];
let lastRows = new Map();

const TABS = [['owes', 'Still owes'], ['paid', 'Paid'], ['all', 'All']];
if (!TABS.some(([k]) => k === tab)) tab = 'owes';
const METHOD_WORD = { Check: 'check', Cash: 'cash', Zelle: 'Zelle', Venmo: 'Venmo', ACH: 'bank transfer', 'Money order': 'money order' };
const byWord = m => (m ? ' by ' + (METHOD_WORD[m] || m) : '');
const longDate = (d, today) => D.monthName(D.monthKey(d)) + ' ' + Number(d.slice(8)) + (d.slice(0, 4) !== today.slice(0, 4) ? ', ' + d.slice(0, 4) : '');

/** Rows for a period: every tenant with a rent/recurring charge that month, with what "Record a payment" would record. */
function buildRows(S, key, current, today) {
  const out = [];
  S.tenantsList().forEach((t, i) => {
    const lg = S.ledger(t.id);
    const m = lg && lg.months[key];
    if (!m || !m.scheduled) return;
    const unpaid = m.open > 0;
    // This month: the full balance. Past month: payments settle the oldest charge first, so clearing a past month
    // means clearing everything up to it — the balance less whatever is still open in later months.
    let later = 0;
    if (!current) for (const k of Object.keys(lg.months)) if (k > key) later += lg.months[k].open;
    const payAmount = unpaid ? (current ? Math.max(0, lg.balance) : Math.max(0, Math.min(lg.balance, lg.balance - later))) : 0;
    const earlier = unpaid ? Math.max(0, payAmount - m.open) : 0;
    const part = unpaid && m.rentPaid > 0;
    out.push({ t, i, lg, m, unpaid, part, payAmount, earlier, key: RB.model.attentionKey(t, lg, today) });
  });
  return out;
}
// law 7: the same order as Today and Tenants (RB.model.attentionCompare)
const byAttention = (a, b) => RB.model.attentionCompare(a.key, b.key) || a.i - b.i;

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

/** The payment (or money off) rows that settled a month. */
function settlers(lg, key) {
  const ids = new Set(lg.rows.filter(r => r.type === 'charge' && !r.void && r.period === key && (r.kind === 'rent' || r.kind === 'recurring')).map(r => r.id));
  return lg.rows.filter(r => r.type !== 'charge' && !r.void && r.applied && r.applied.some(a => ids.has(a.id)));
}

// ------------------------------------------------------------------ row words
function owesSub(r) {
  const m = r.m, mon = D.monthName(m.period);
  const main = r.part ? 'Owes ' + M.fmt(m.open) + ' of ' + mon + '’s ' + M.fmt(m.rentCharged) : 'Owes ' + M.fmt(m.open) + ' for ' + mon;
  return main + (r.earlier ? ' and ' + M.fmt(r.earlier) + ' from earlier months' : '');
}
function owesStatus(r, today) {
  const m = r.m;
  if (r.part && m.status === 'late') return ui.status('partial_late', 'Part paid — rest is ' + D.days(m.daysLate) + ' late');
  if (r.part) return ui.status('partial', 'Part paid — ' + M.fmt(m.rentPaid) + ' of ' + M.fmt(m.rentCharged));
  if (m.status === 'late') return ui.status('late', 'Late — ' + D.days(m.daysLate));
  return ui.status('due', 'Not paid yet' + (m.graceEnd ? ' — late after ' + D.fmt(m.graceEnd, today) : ''));
}
function paidSub(r, today) {
  const m = r.m;
  const ps = settlers(r.lg, m.period);
  const last = ps[ps.length - 1];
  if (!last) return 'Paid ' + M.fmt(m.rentCharged) + (m.paidOn ? ' on ' + longDate(m.paidOn, today) : '');
  if (last.type === 'credit' && ps.length === 1) return 'Covered by money taken off or paid ahead';
  if (ps.length === 1 && last.amount >= m.rentCharged) return 'Paid ' + M.fmt(last.amount) + ' on ' + longDate(last.date, today) + byWord(last.method);
  return 'Paid ' + M.fmt(m.rentCharged) + ' in ' + RB.plural(ps.length, 'part') + ', the last on ' + longDate(m.paidOn || last.date, today) + byWord(last.method);
}

// ------------------------------------------------------------------ rows
function row(r, today) {
  const id = r.t.id;
  const cls = cursorId === id ? 'is-focused' : '';
  const lead = ui.plate(r.t.unit, { property: r.t.property });
  if (bulkMode && r.unpaid) {
    const sel = selected.has(id);
    return h`<li data-row="${id}"><label class="row rent-tick${sel ? ' is-selected' : ''}" for="rent-chk-${id}">
      <span class="row-lead"><input type="checkbox" id="rent-chk-${id}" data-change="sel" data-id="${id}"${sel ? RB.raw(' checked') : ''} data-write></span>
      <span class="row-main"><span class="row-title">${r.t.name}</span><span class="row-sub">Paid ${M.fmt(r.payAmount)} in full</span></span>
      <span class="row-end">${lead}</span></label></li>`;
  }
  if (r.unpaid) {
    return ui.row({
      lead, title: r.t.name, sub: owesSub(r), status: owesStatus(r, today), statusPos: 'main',
      bar: r.part ? ui.splitBar(r.m.rentPaid, r.m.rentCharged, { label: M.fmt(r.m.rentPaid) + ' of ' + M.fmt(r.m.rentCharged) + ' paid' }) : '',
      act: 'row', cls, attrs: { id: 'rent-row-' + id, 'data-id': id, 'aria-haspopup': 'dialog' },
      btn: { label: r.part ? 'Record the rest' : 'Record a payment', act: 'pay', id: 'rent-pay-' + id, attrs: { 'data-id': id } },
      liAttrs: { 'data-row': id, class: 'is-owing' },
    });
  }
  return ui.row({
    lead, title: r.t.name, sub: paidSub(r, today),
    status: r.m.status === 'paid_late' ? ui.status('paid_late', 'Paid late — ' + D.days(r.m.daysLate)) : '', statusPos: 'main',
    act: 'row', cls, attrs: { id: 'rent-row-' + id, 'data-id': id, 'aria-haspopup': 'dialog' },
    liAttrs: { 'data-row': id, class: 'is-paid' },
  });
}

// ------------------------------------------------------------------ actions
function rowOf(id) { return lastRows.get(id) || null; }
/** The common case: the payment sheet with the full amount preselected → "Record $1,550" (two taps). */
function openPay(r, opts) {
  if (!r) return;
  cursorId = r.t.id;
  const o = Object.assign({}, opts || {});
  if (r.unpaid && r.payAmount) o.amount = r.payAmount;
  RB.actions.recordPayment(r.t.id, o);
}
function quickPay(r) {
  if (!r || !r.unpaid) return;
  const i = lastShown.indexOf(r.t.id);
  const next = lastShown.slice(i + 1).find(id => rowOf(id) && rowOf(id).unpaid) || null;
  cursorId = next || r.t.id;
  RB.actions.recordPayment(r.t.id, { quick: true, amount: r.payAmount });
}
/** Row tap: "What would you like to do?" */
function rowChoices(r) {
  const A = RB.actions;
  const id = r.t.id;
  cursorId = id;
  const items = [];
  if (r.unpaid) {
    items.push({ label: 'They paid part of it', hint: 'Type the amount you got', run: () => openPay(r, { part: true }), write: true, id: 'rent-c-part' });
    const s = r.lg.suggestedLateFee;
    if (r.m.status === 'late' && s && s.period === r.m.period) items.push({ label: 'Add a ' + M.fmt(s.amount) + ' late fee', hint: 'For ' + D.monthName(s.period), run: () => A.addLateFee(id, r.m.period), write: true, id: 'rent-c-fee' });
  } else {
    const ps = settlers(r.lg, r.m.period).filter(p => p.kind === 'entry');
    const p = ps[ps.length - 1];
    if (p) {
      items.push({ label: 'Copy a receipt', hint: 'Ready to paste into a text or email', run: () => A.copyReceipt(id, p.id), id: 'rent-c-receipt' });
      if (p.type === 'payment') items.push({ label: 'Remove this payment — it was a mistake', hint: 'You can put it back with Undo', run: () => A.voidEntry(id, p.id), write: true, danger: true, id: 'rent-c-remove' });
    }
  }
  items.push({ label: 'See their page', hint: 'Payment history, notes and lease', run: () => A.openTenant(id), id: 'rent-c-open' });
  ui.choices({ title: r.t.name, sub: ui.place(r.t) + ' · ' + (r.unpaid ? owesSub(r) : paidSub(r, RB.store.today())), items });
}
function moveCursor(d) {
  if (!lastShown.length) return;
  const i = lastShown.indexOf(cursorId);
  cursorId = lastShown[i < 0 ? (d > 0 ? 0 : lastShown.length - 1) : Math.max(0, Math.min(lastShown.length - 1, i + d))];
  RB.shell.refresh();
  const el = document.querySelector('[data-row="' + CSS.escape(cursorId) + '"]');
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function bulkRecord() {
  const rows = Array.from(selected).map(rowOf).filter(r => r && r.unpaid);
  if (!rows.length) return;
  const amounts = {};
  rows.forEach(r => { amounts[r.t.id] = r.payAmount; });
  RB.actions.recordPayments(rows.map(r => r.t.id), { amounts });
  selected.clear();
  bulkMode = false;
  RB.shell.refresh();
}

// ------------------------------------------------------------------ the month at a glance (desktop only)
function glance(rows, today) {
  const byProp = new Map();
  rows.slice().sort((a, b) => a.i - b.i).forEach(r => { if (!byProp.has(r.t.property)) byProp.set(r.t.property, []); byProp.get(r.t.property).push(r); });
  return h`<section class="rent-glance hide-phone" aria-labelledby="rent-glance-t">
    <h2 class="sec-title" id="rent-glance-t">The month at a glance</h2>
    <p class="caption rent-glance-cap">Each box is one home. A tick means paid, a half circle part paid, a red triangle late. Tap a box to see that tenant.</p>
    ${Array.from(byProp.entries()).map(([prop, list]) => h`<div class="rent-prop">${ui.rowsHead(prop || 'No property')}
      <div class="plates">${list.map(r => {
        const st = r.m.status === 'late' && r.m.rentPaid > 0 ? 'partial_late' : r.m.status;
        const label = (r.t.unit || '—') + ', ' + r.t.name + ': ' + ui.statusWords(r.m, today);
        return ui.plate(r.t.unit, { size: 'lg', status: st, button: true, title: label, attrs: { 'data-act': 'open', 'data-id': r.t.id, id: 'rent-p-' + r.t.id, 'aria-label': label } });
      })}</div></div>`)}
  </section>`;
}

// ------------------------------------------------------------------ render
function render(el, ctx) {
  const S = ctx.store;
  const today = ctx.today;
  if (ctx.intent === 'owes') { tab = 'owes'; period = null; }
  const b = periodBounds(S, today);
  if (!period || period > b.max) period = b.cur;
  if (period < b.min) period = b.min;
  const current = period === b.cur;
  const all = buildRows(S, period, current, today);
  lastRows = new Map(all.map(r => [r.t.id, r]));
  for (const id of Array.from(selected)) { const r = lastRows.get(id); if (!r || !r.unpaid) selected.delete(id); }

  const owing = all.filter(r => r.unpaid).sort(byAttention);
  const paid = all.filter(r => !r.unpaid).sort((a, b2) => a.i - b2.i);
  const shown = tab === 'owes' ? owing : tab === 'paid' ? paid : owing.concat(paid);
  if (bulkMode && (tab === 'paid' || owing.length < 2)) bulkMode = false;
  lastShown = shown.map(r => r.t.id);
  if (cursorId && !lastShown.includes(cursorId)) cursorId = null;

  const p = S.portfolio(period);
  const mon = D.monthName(period);
  const counts = { owes: owing.length, paid: paid.length, all: all.length };
  const selRows = Array.from(selected).map(rowOf).filter(Boolean);
  const selTotal = selRows.reduce((a, r) => a + r.payAmount, 0);
  const emptyMsg = { owes: 'Nobody owes anything for ' + mon + '.', paid: 'Nobody has paid ' + mon + ' rent yet.', all: 'No rent was charged for ' + D.fmtMonth(period) + '.' }[tab];
  const rate = p.charged ? Math.round((p.collected / p.charged) * 100) : null;
  const list = (rows, label) => h`<ul class="rows rows-inset rent-list" aria-label="${label}">${rows.map(r => row(r, today))}</ul>`;

  el.innerHTML = String(h`<div class="rent${selected.size ? ' has-bar' : ''}">
    <p class="lead rent-summary" id="rent-summary">${ui.owedSentence()}</p>
    <div class="rent-month" role="group" aria-label="Which month">
      <button type="button" class="btn-link rent-step" id="rent-prev" data-act="step" data-d="-1"${period <= b.min ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}Earlier month</button>
      <h2 class="t-display rent-month-name" id="rent-month-name" aria-live="polite">${D.fmtMonth(period)}</h2>
      <button type="button" class="btn-link rent-step" id="rent-next" data-act="step" data-d="1"${period >= b.max ? RB.raw(' disabled') : ''}>Later month${ui.icon('chevron-right')}</button>
    </div>
    ${current ? '' : h`<p class="callout rent-past">You’re looking at an earlier month. Payments you record here are dated today. <button type="button" class="linkbtn" id="rent-today" data-act="now">Back to ${D.monthName(b.cur)}</button></p>`}
    ${ui.segment(TABS.map(([k, label]) => ({ key: k, label, count: counts[k] })), tab, { id: 'rent-tab', act: 'tab', label: 'Show' })}
    ${tab !== 'paid' && owing.length >= 2 ? h`<p class="rent-bulkline"><button type="button" class="btn-link" id="rent-bulkmode" data-act="bulkmode" aria-pressed="${bulkMode ? 'true' : 'false'}" data-write>${bulkMode ? 'Stop recording several' : 'Record several at once'}</button></p>` : ''}
    ${bulkMode ? h`<div class="callout rent-bulkhelp" id="rent-bulkhelp"><p>Tick everyone who paid in full. Each one is recorded for the whole amount they owe, dated today, the way they paid last time.</p>
      <p class="rent-bulkhelp-acts"><button type="button" class="btn-link" id="rent-tickall" data-act="tickall">Tick everyone (${owing.length})</button>${selected.size ? h`<button type="button" class="btn-link" id="rent-clear" data-act="clear">Untick all</button>` : ''}</p></div>` : ''}

    ${shown.length ? (tab === 'all' && owing.length && paid.length
      ? h`${ui.rowsHead('Still owes', owing.length)}${list(owing, 'Still owes')}${ui.rowsHead('Paid', paid.length)}${list(paid, 'Paid')}`
      : list(shown, TABS.find(x => x[0] === tab)[1]))
      : ui.empty({ quiet: true, title: emptyMsg })}

    ${all.length ? glance(all, today) : ''}

    <p class="rent-totals" id="rent-totals">${all.length
      ? h`${M.fmt(p.charged)} of rent and charges was due for ${mon}. ${M.fmt(p.collected)} has come in${rate === null ? '' : ' (' + rate + '%)'}. ${p.outstanding ? M.fmt(p.outstanding) + ' is still owed.' : 'Nothing is still owed.'}`
      : h`No rent was charged for ${D.fmtMonth(period)}.`}</p>

    ${bulkMode && selected.size ? h`<div class="actionbar rent-bar" role="region" aria-label="Record several at once">
      <span class="rent-bar-n">${RB.plural(selected.size, 'tenant')} ticked</span>
      <button type="button" class="btn btn-primary btn-lg" id="rent-bulk" data-act="bulk" data-write>Record ${RB.plural(selRows.length, 'payment')} — ${M.fmt(selTotal)}</button>
    </div>` : ''}
  </div>`);

  ui.bind(el, {
    tab: btn => { tab = btn.dataset.k; RB.prefs.set('rent.tab', tab); pendingFocus = btn.id; RB.shell.refresh(); },
    step: btn => { period = D.addMonthKey(period, +btn.dataset.d); selected.clear(); cursorId = null; RB.shell.refresh(); const same = document.getElementById(btn.id); if (same && same.disabled) { const o = document.getElementById(btn.dataset.d > 0 ? 'rent-prev' : 'rent-next'); if (o) o.focus(); } },
    now: () => { period = null; selected.clear(); cursorId = null; RB.shell.refresh(); const s = document.getElementById('rent-prev'); if (s) s.focus(); },
    pay: btn => openPay(rowOf(btn.dataset.id)),
    row: btn => { const r = rowOf(btn.dataset.id); if (r) rowChoices(r); },
    open: btn => RB.actions.openTenant(btn.dataset.id),
    sel: inp => { if (inp.checked) selected.add(inp.dataset.id); else selected.delete(inp.dataset.id); pendingFocus = inp.id; RB.shell.refresh(); },
    tickall: () => { owing.forEach(r => selected.add(r.t.id)); RB.shell.refresh(); },
    bulkmode: () => { bulkMode = !bulkMode; selected.clear(); if (bulkMode && tab === 'paid') tab = 'owes'; pendingFocus = 'rent-bulkmode'; RB.shell.refresh(); },
    clear: () => { selected.clear(); RB.shell.refresh(); },
    bulk: () => bulkRecord(),
  });
  if (pendingFocus) {
    const f = document.getElementById(pendingFocus);
    pendingFocus = null;
    if (f && f.offsetParent !== null) try { f.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  }
}

function handleKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key;
  if (k === 'j' || k === 'ArrowDown') { moveCursor(1); return true; }
  if (k === 'k' || k === 'ArrowUp') { moveCursor(-1); return true; }
  if (k === 'Escape' && bulkMode) { selected.clear(); bulkMode = false; RB.shell.refresh(); return true; }
  const r = rowOf(cursorId);
  if (!r || !lastShown.includes(cursorId)) return false;
  if (k === 'p') { if (r.unpaid && RB.store.canWrite()) quickPay(r); return true; }
  if (k === 'Enter') {
    if (e.target && e.target.closest && e.target.closest('button, a, select, textarea, input')) return false;
    if (r.unpaid) openPay(r); else rowChoices(r);
    return true;
  }
  if (k === 'o') { RB.actions.openTenant(r.t.id); return true; }
  return false;
}

RB.views.register('rent', {
  title: 'Rent',
  shortcuts: [['j / ↓', 'Next tenant'], ['k / ↑', 'Previous tenant'], ['p', 'Record the full amount now'], ['Enter', 'Record a payment'], ['o', 'See the tenant'], ['Esc', 'Stop recording several']],
  render,
  onKey: e => handleKey(e),
  destroy() { selected.clear(); bulkMode = false; period = null; },
});

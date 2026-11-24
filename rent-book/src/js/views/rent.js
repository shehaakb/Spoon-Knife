// views/rent.js — Rent: the monthly collection sheet, rethought for SPEC §8.
// A sentence at the top, the month in words, two worded tabs (Still owes / Paid), one large row per tenant with one big
// button ("Record payment" → sheet prefilled → "Record $1,550": two taps), part payments as an obvious second path,
// and "Record several at once" as an explained mode rather than always-on tick boxes.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

// ---- view state (module-level; survives re-renders) ----
let period = null;                                   // 'YYYY-MM' shown
let tab = RB.prefs.get('rent.tab', 'owes');          // owes | paid | all
let bulkMode = false;                                // "Record several at once"
const selected = new Set();                          // tenant ids ticked in bulk mode
let cursorId = null;                                 // keyboard cursor (tenant id) — optional, not advertised
let pendingFocus = null;                             // element id to focus after the next render
let lastShown = [];                                  // tenant ids in display order (for keys)
let lastRows = new Map();                            // tenant id → row model from the last render
let lastCurrent = true;                              // whether the last render showed this month

const TABS = [['owes', 'Still owes'], ['paid', 'Paid'], ['all', 'Everyone']];
if (!TABS.some(([k]) => k === tab)) tab = 'owes';
const RANK = { late: 0, partial: 1, due: 2 };
const METHOD_WORD = { Check: 'check', Cash: 'cash', Zelle: 'Zelle', Venmo: 'Venmo', ACH: 'bank transfer', 'Money order': 'money order' };
const byWord = m => (m ? ' by ' + (METHOD_WORD[m] || m) : '');

/** Rows for a period: every tenant with a rent/recurring charge that month, with what "Record payment" would record. */
function buildRows(S, key, current) {
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
    const earlier = unpaid ? Math.max(0, payAmount - m.open) : 0;   // owed from earlier months, included in payAmount
    const part = unpaid && m.rentPaid > 0;
    out.push({ t, i, lg, m, unpaid, part, payAmount, earlier, rank: unpaid ? (RANK[m.status] !== undefined ? RANK[m.status] : 3) : 4 });
  });
  return out;
}
const byRank = (a, b) => a.rank - b.rank || b.m.daysLate - a.m.daysLate || a.i - b.i;

/** Periods that have any rent charge (for the month buttons). */
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

/** The payment (or money off) rows that settled a month — for "Paid $1,385 on Nov 3 by check", receipts and removing. */
function settlers(lg, key) {
  const ids = new Set(lg.rows.filter(r => r.type === 'charge' && !r.void && r.period === key && (r.kind === 'rent' || r.kind === 'recurring')).map(r => r.id));
  return lg.rows.filter(r => r.type !== 'charge' && !r.void && r.applied && r.applied.some(a => ids.has(a.id)));
}

// ------------------------------------------------------------------ sentences
function owesLine(r, today) {
  const m = r.m, mon = D.monthName(m.period);
  const when = m.status === 'late' ? h` — <span class="rent-late">${D.days(m.daysLate)} late</span>` : m.graceEnd ? h` — not late until after ${D.fmt(m.graceEnd, today)}` : '';
  const head = r.part
    ? h`<span class="rent-say">Part paid — ${M.fmt(m.rentPaid)} of ${M.fmt(m.rentCharged)}. Still owes <strong>${M.fmt(m.open)}</strong>${when}.</span>`
    : h`<span class="rent-say">Owes <strong>${M.fmt(m.open)}</strong> for ${mon}${when}</span>`;
  return h`${head}${r.earlier ? h`<span class="rent-earlier">plus ${M.fmt(r.earlier)} from earlier months</span>` : ''}`;
}
function paidLine(r, today) {
  const m = r.m;
  const ps = settlers(r.lg, m.period);
  const last = ps[ps.length - 1];
  const late = m.status === 'paid_late' ? h` <span class="rent-paidlate">(${D.days(m.daysLate)} late)</span>` : '';
  if (!last) return h`<span class="rent-say">Paid ${M.fmt(m.rentCharged)}${m.paidOn ? ' — done ' + D.fmt(m.paidOn, today) : ''}${late}</span>`;
  if (last.type === 'credit' && ps.length === 1) return h`<span class="rent-say">Covered by money taken off or paid ahead${m.paidOn ? ' — ' + D.fmt(m.paidOn, today) : ''}${late}</span>`;
  if (ps.length === 1 && last.amount >= m.rentCharged) return h`<span class="rent-say">Paid ${M.fmt(last.amount)} on ${D.fmt(last.date, today)}${byWord(last.method)}${late}</span>`;
  return h`<span class="rent-say">Paid ${M.fmt(m.rentCharged)} in ${RB.plural(ps.length, 'part')}, the last on ${D.fmt(m.paidOn || last.date, today)}${byWord(last.method)}${late}</span>`;
}

// ------------------------------------------------------------------ rows
function row(r, today) {
  const id = r.t.id;
  const sel = selected.has(id), cur = cursorId === id;
  const m = r.m;
  const sub = h`<span class="rent-where">${r.t.property}${r.t.status === 'past' ? ' · moved out' : r.t.status === 'notice' ? ' · moving out' : ''}</span>`;
  let actions;
  if (bulkMode && r.unpaid) {
    actions = h`<label class="rent-tick${sel ? ' is-on' : ''}" for="rent-chk-${id}"><input type="checkbox" id="rent-chk-${id}" data-change="sel" data-id="${id}"${sel ? RB.raw(' checked') : ''} data-write><span>Paid ${M.fmt(r.payAmount)} in full</span></label>`;
  } else if (r.unpaid) {
    actions = h`${r.part
      ? h`<button type="button" class="btn btn-primary btn-lg rent-pay" id="rent-pay-${id}" data-act="pay" data-id="${id}" data-write>Record the rest (${M.fmt(r.payAmount)})</button>
          <button type="button" class="btn btn-lg rent-part" id="rent-part-${id}" data-act="part" data-id="${id}" data-write>Another part payment</button>`
      : h`<button type="button" class="btn btn-primary btn-lg rent-pay" id="rent-pay-${id}" data-act="pay" data-id="${id}" data-write>Record payment</button>
          <button type="button" class="btn-link rent-part" id="rent-part-${id}" data-act="part" data-id="${id}" data-write>They paid part of it</button>`}
      <button type="button" class="btn btn-ghost rent-more" id="rent-more-${id}" data-act="menu" data-id="${id}" aria-haspopup="menu">${RB.ui.icon('more')}<span>More</span><span class="vh"> for ${r.t.name}</span></button>`;
  } else {
    actions = h`<button type="button" class="btn btn-ghost rent-more" id="rent-more-${id}" data-act="menu" data-id="${id}" aria-haspopup="menu">${RB.ui.icon('more')}<span>More</span><span class="vh"> for ${r.t.name}</span></button>`;
  }
  return h`<li class="rent-row${r.unpaid ? ' is-owing' : ' is-paid'}${r.part ? ' is-part' : ''}${cur ? ' is-focused' : ''}${sel ? ' is-selected' : ''}" data-row="${id}" data-act="cursor" data-id="${id}">
    <span class="rent-lead">${ui.plate(r.t.unit, { property: r.t.property, status: r.unpaid ? (m.status === 'late' && !r.part ? 'late' : r.part ? 'partial' : '') : '' })}</span>
    <div class="rent-main">
      <div class="rent-name"><button type="button" class="rent-who" id="rent-who-${id}" data-act="open" data-id="${id}">${r.t.name}</button>${sub}</div>
      <div class="rent-line">${r.unpaid ? owesLine(r, today) : paidLine(r, today)}</div>
      ${r.part ? h`<div class="rent-split">${ui.splitBar(m.rentPaid, m.rentCharged, { label: M.fmt(m.rentPaid) + ' of ' + M.fmt(m.rentCharged) + ' paid' })}</div>` : ''}
    </div>
    ${r.unpaid ? '' : h`<div class="rent-status">${ui.monthPill(m)}</div>`}
    <div class="rent-actions">${actions}</div>
  </li>`;
}

// ------------------------------------------------------------------ actions
function rowOf(id) { return lastRows.get(id) || null; }
/** The common case: open the simple sheet with the full amount preselected → "Record $1,550". */
function openPay(r, opts) {
  if (!r) return;
  cursorId = r.t.id;
  const o = Object.assign({}, opts || {});
  if (r.unpaid && r.payAmount) o.amount = r.payAmount;
  RB.actions.recordPayment(r.t.id, o);
}
/** Keyboard "p": record the full amount at once (Undo toast). */
function quickPay(r) {
  if (!r || !r.unpaid) return;
  const i = lastShown.indexOf(r.t.id);
  const next = lastShown.slice(i + 1).find(id => rowOf(id) && rowOf(id).unpaid) || null;
  cursorId = next || r.t.id;
  RB.actions.recordPayment(r.t.id, { quick: true, amount: r.payAmount });
}
function rowMenu(anchor, r) {
  const items = [];
  const A = RB.actions;
  if (r.unpaid) {
    items.push({ label: r.part ? 'Record the rest (' + M.fmt(r.payAmount) + ')' : 'Record the full ' + M.fmt(r.payAmount), icon: 'cash', write: true, onSelect: () => openPay(r) });
    items.push({ label: r.part ? 'Another part payment' : 'They paid part of it', icon: 'half', write: true, onSelect: () => openPay(r, { part: true }) });
    const s = r.lg.suggestedLateFee;
    if (r.m.status === 'late' && s && s.period === r.m.period) items.push({ label: 'Add a late fee of ' + M.fmt(s.amount), icon: 'plus', write: true, onSelect: () => A.addLateFee(r.t.id, r.m.period) });
  } else {
    const ps = settlers(r.lg, r.m.period).filter(p => p.kind === 'entry');
    const p = ps[ps.length - 1];
    if (p) {
      items.push({ label: 'Copy a receipt', icon: 'copy', onSelect: () => A.copyReceipt(r.t.id, p.id) });
      if (p.type === 'payment') items.push({ label: 'Remove this payment — it was a mistake', icon: 'undo', danger: true, write: true, onSelect: () => A.voidEntry(r.t.id, p.id) });
    }
    items.push({ label: 'Record another payment', icon: 'cash', write: true, onSelect: () => A.recordPayment(r.t.id) });
  }
  items.push({ sep: true });
  items.push({ label: 'Write a note', icon: 'note', write: true, onSelect: () => A.addNote(r.t.id) });
  items.push({ label: 'See ' + r.t.name.split(' ')[0] + '’s page', icon: 'user', onSelect: () => A.openTenant(r.t.id) });
  ui.menu(anchor, items, { align: 'end' });
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

// ------------------------------------------------------------------ render
function render(el, ctx) {
  const S = ctx.store;
  const today = ctx.today;
  if (ctx.intent === 'owes') { tab = 'owes'; period = null; }
  const b = periodBounds(S, today);
  if (!period || period > b.max) period = b.cur;
  if (period < b.min) period = b.min;
  const current = period === b.cur;
  lastCurrent = current;
  const all = buildRows(S, period, current);
  lastRows = new Map(all.map(r => [r.t.id, r]));
  for (const id of Array.from(selected)) { const r = lastRows.get(id); if (!r || !r.unpaid) selected.delete(id); }

  const owing = all.filter(r => r.unpaid).sort(byRank);
  const paid = all.filter(r => !r.unpaid).sort((a, b2) => a.i - b2.i);
  const shown = tab === 'owes' ? owing : tab === 'paid' ? paid : owing.concat(paid);
  if (bulkMode && (tab === 'paid' || owing.length < 2)) bulkMode = false;
  lastShown = shown.map(r => r.t.id);
  if (cursorId && !lastShown.includes(cursorId)) cursorId = null;

  const p = S.portfolio(period);
  const mon = D.monthName(period);
  const owedTotal = owing.reduce((a, r) => a + r.m.open, 0);
  const counts = { owes: owing.length, paid: paid.length, all: all.length };
  const verb = current ? 'have paid' : 'paid';
  const say = all.length
    ? h`${mon} rent: <strong>${paid.length} of ${all.length}</strong> tenants ${verb}. ${owing.length ? h`<strong>${owing.length}</strong> still ${owing.length === 1 ? 'owes' : 'owe'} <strong>${M.fmt(owedTotal)}</strong>.` : 'Everyone is paid up for ' + mon + '.'}`
    : h`No rent was charged for ${D.fmtMonth(period)}.`;
  const selRows = Array.from(selected).map(rowOf).filter(Boolean);
  const selTotal = selRows.reduce((a, r) => a + r.payAmount, 0);
  const emptyMsg = { owes: 'Nobody owes anything for ' + mon + '. Everyone is paid up.', paid: 'Nobody has paid ' + mon + ' rent yet.', all: 'No rent was charged for ' + D.fmtMonth(period) + '.' }[tab];
  const rate = p.charged ? Math.round((p.collected / p.charged) * 100) : null;

  el.innerHTML = String(h`<div class="rent${selected.size ? ' has-bar' : ''}">
    <p class="rent-summary" id="rent-summary">${say}</p>
    <div class="rent-month" role="group" aria-label="Which month">
      <button type="button" class="btn rent-step" id="rent-prev" data-act="step" data-d="-1"${period <= b.min ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}<span>Earlier month</span></button>
      <h2 class="rent-month-name" aria-live="polite">${D.fmtMonth(period)}</h2>
      <button type="button" class="btn rent-step" id="rent-next" data-act="step" data-d="1"${period >= b.max ? RB.raw(' disabled') : ''}><span>Later month</span>${ui.icon('chevron-right')}</button>
    </div>
    ${current ? '' : h`<div class="rent-past"><span>You’re looking at an earlier month. Payments you record here are dated today.</span><button type="button" class="btn btn-soft" id="rent-today" data-act="now">Back to ${D.monthName(b.cur)}</button></div>`}
    <div class="rent-tools">
      <div class="rent-tabs" role="group" aria-label="Show">${TABS.map(([k, label]) => h`<button type="button" class="rent-tab" id="rent-tab-${k}" data-act="tab" data-k="${k}" aria-pressed="${tab === k ? 'true' : 'false'}">${label} <span class="rent-tab-n">(${counts[k]})</span></button>`)}</div>
      ${tab !== 'paid' && owing.length >= 2 ? h`<button type="button" class="btn rent-bulkmode" id="rent-bulkmode" data-act="bulkmode" aria-pressed="${bulkMode ? 'true' : 'false'}" data-write>${bulkMode ? 'Stop recording several' : 'Record several at once'}</button>` : ''}
    </div>
    ${bulkMode ? h`<div class="rent-bulkhelp" id="rent-bulkhelp"><p><strong>Tick everyone who paid in full.</strong> Each one is recorded for the whole amount they owe, dated today, the way they paid last time.</p>
      <div class="row row-wrap"><button type="button" class="btn btn-sm" id="rent-tickall" data-act="tickall">Tick everyone (${owing.length})</button>${selected.size ? h`<button type="button" class="btn btn-sm btn-ghost" id="rent-clear" data-act="clear">Untick all</button>` : ''}</div></div>` : ''}

    ${shown.length ? h`<ul class="rent-list" aria-label="${TABS.find(x => x[0] === tab)[1]}">${tab === 'all' && owing.length && paid.length
      ? h`${owing.map(r => row(r, today))}<li class="rent-divider" aria-hidden="true">Paid</li>${paid.map(r => row(r, today))}`
      : shown.map(r => row(r, today))}</ul>`
      : ui.empty({ quiet: true, title: emptyMsg })}

    <div class="rent-totals" id="rent-totals">
      <h3 class="rent-totals-t">${D.fmtMonth(period)} in total</h3>
      <p>${M.fmt(p.charged)} of rent and charges was due. <strong>${M.fmt(p.collected)}</strong> has come in${rate === null ? '' : ' (' + rate + '%)'}. ${p.outstanding ? h`<strong class="tone-bad">${M.fmt(p.outstanding)}</strong> is still owed.` : 'Nothing is still owed.'}</p>
    </div>

    ${bulkMode && selected.size ? h`<div class="actionbar rent-bar" role="region" aria-label="Record several at once">
      <span class="rent-bar-n">${RB.plural(selected.size, 'tenant')} ticked</span>
      <button type="button" class="btn btn-primary btn-lg" id="rent-bulk" data-act="bulk" data-write>Record ${RB.plural(selRows.length, 'payment')} — ${M.fmt(selTotal)}</button>
    </div>` : ''}
  </div>`);

  ui.bind(el, {
    tab: btn => { tab = btn.dataset.k; RB.prefs.set('rent.tab', tab); RB.shell.refresh(); },
    step: btn => { period = D.addMonthKey(period, +btn.dataset.d); selected.clear(); cursorId = null; RB.shell.refresh(); const same = document.getElementById(btn.id); if (same && same.disabled) { const o = document.getElementById(btn.dataset.d > 0 ? 'rent-prev' : 'rent-next'); if (o) o.focus(); } },
    now: () => { period = null; selected.clear(); cursorId = null; RB.shell.refresh(); const s = document.getElementById('rent-prev'); if (s) s.focus(); },
    pay: btn => openPay(rowOf(btn.dataset.id)),
    part: btn => openPay(rowOf(btn.dataset.id), { part: true }),
    open: btn => RB.actions.openTenant(btn.dataset.id),
    menu: btn => { const r = rowOf(btn.dataset.id); if (r) { cursorId = r.t.id; rowMenu(btn, r); } },
    sel: inp => { if (inp.checked) selected.add(inp.dataset.id); else selected.delete(inp.dataset.id); pendingFocus = inp.id; RB.shell.refresh(); },
    tickall: () => { owing.forEach(r => selected.add(r.t.id)); RB.shell.refresh(); },
    bulkmode: () => { bulkMode = !bulkMode; selected.clear(); if (bulkMode && tab === 'paid') tab = 'owes'; pendingFocus = 'rent-bulkmode'; RB.shell.refresh(); },
    clear: () => { selected.clear(); RB.shell.refresh(); },
    bulk: () => bulkRecord(),
    cursor: (rowEl, e) => {
      if (e.target.closest('input, button, a, label')) return;
      if (bulkMode) { const id = rowEl.dataset.id; const r = rowOf(id); if (r && r.unpaid) { if (selected.has(id)) selected.delete(id); else selected.add(id); RB.shell.refresh(); } return; }
      if (cursorId !== rowEl.dataset.id) { cursorId = rowEl.dataset.id; RB.shell.refresh(); }
    },
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
    openPay(r); return true;
  }
  if (k === 'o') { RB.actions.openTenant(r.t.id); return true; }
  return false;
}

RB.views.register('rent', {
  title: 'Rent',
  shortcuts: [['j / ↓', 'Next tenant'], ['k / ↑', 'Previous tenant'], ['p', 'Record the full amount now'], ['Enter', 'Record a payment'], ['o', 'See the tenant'], ['Esc', 'Stop recording several']],
  render,
  onKey: e => handleKey(e),
  destroy() { selected.clear(); bulkMode = false; },
});

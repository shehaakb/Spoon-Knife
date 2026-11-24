// views/tenant-detail.js — the tenant page (#t-<id>): a right drawer on desktop, a full page on phone.
// Loaded before tenant-forms.js and tenants.js (name order); shares helpers with them (and, at render time, with
// leases.js and reports.js) through RB._tn. Words: docs/SPEC.md §8; layout and laws: §10 (v3).
// Order (§10.3): plate + name + one status sentence · actions · Payment history (by month) · Notes · Lease and rent ·
// Repairs in this unit · Contact. The drawer is patched part by part (data-part), so a store change never resets scroll.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});
const S = () => RB.store;

// ------------------------------------------------------------------ shared helpers (used by forms, list, leases, reports)
/** Same checks as the shared actions: read-only / still loading → toast, false. */
T.guard = function guard() {
  const st = S().state;
  if (st.readOnly) { ui.toast('This rent book is view only — you can look, but not change anything.', { tone: 'bad' }); return false; }
  if (!st.mode || !st.ready) { ui.toast('Still loading — try again in a moment.'); return false; }
  return true;
};
T.who = t => RB.actions.who(t);
T.order = [];   // tenant ids in the list's current order (set by tenants.js) — Previous/Next follow it
T.ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
T.unitWord = u => (!u ? '' : /^(no\.?|unit|apt|house|#)/i.test(u) ? u : 'Unit ' + u);
T.place = t => [T.unitWord(t.unit), t.property].filter(Boolean).join(' at ');
const localDay = iso => { const d = new Date(iso); return isNaN(d) ? null : D.make(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
T.localDay = localDay;
T.logList = t => Object.keys(t.log || {}).filter(k => t.log[k]).map(k => Object.assign({ id: k }, t.log[k])).sort((a, b) => D.cmp(b.at || '', a.at || ''));
T.KIND_LABEL = { note: 'Note', call: 'Phone call', text: 'Text', email: 'Email', visit: 'Visit', notice: 'Moving out' };
T.NOTE_KINDS = [{ value: 'note', label: 'Note' }, { value: 'call', label: 'Phone call' }, { value: 'text', label: 'Text' }, { value: 'email', label: 'Email' }, { value: 'visit', label: 'Visit' }];

/** "November 24" (this year) / "November 24, 2025" — law 11: dates written out. */
T.day = (d, today) => { if (!D.isDate(d)) return ''; const s = D.fmtLong(d); return s.replace(', ' + (today || S().today()).slice(0, 4), ''); };
/** "Tuesday, November 24" (+ ", 2027" when not this year). */
T.dayLong = (d, today) => ui.dateWords(d, today);

// ---- wording (glossary, SPEC §8 rule 4). Built on the shared date/money helpers; numbers always spelled with words.
const W = (T.W = {});
W.days = n => RB.plural(Math.abs(n), 'day');
/** "in 24 days" / "22 days ago" / {style:'late'} "22 days late" / "today" — the shared relative phrase, never abbreviated. */
W.rel = (d, today, o) => String(D.rel(d, today, o) || '').replace(/(\d+) ?d\b/g, (m, n) => (n === '1' ? '1 day' : n + ' days'));
W.$ = c => M.fmt(c);
W.date = (d, today) => T.day(d, today);
/** "September" / "September 2025" */
W.monthOf = (d, today) => { const k = D.monthKey(d); return D.monthName(k) + (k.slice(0, 4) !== today.slice(0, 4) ? ' ' + k.slice(0, 4) : ''); };
/** Money owed in words: "Owes $1,225" · "All paid up" · "$250 paid ahead" (plain text). */
W.balance = bal => (bal > 0 ? 'Owes ' + W.$(bal) : bal < 0 ? W.$(-bal) + ' paid ahead' : 'All paid up');
/** This month's part payment, or null: {paid, charged, open, late, daysLate, month} */
W.partial = function partial(lg, today) {
  const c = lg.current;
  if (!c || !(c.open > 0) || !(c.paid > 0) || (c.status !== 'partial' && c.status !== 'late')) return null;
  return { paid: c.paid, charged: c.charged, open: c.open, late: c.status === 'late', daysLate: c.daysLate, month: D.monthName(c.period) };
};
/**
 * One status sentence for a tenant: {text, tone:'bad'|'warn'|'ok'|''} (tone is for other views; v3 screens keep sentences in ink).
 * "Owes $3,300 — behind on rent since September" · "Owes $1,225 — 22 days late" ·
 * "Has paid $800 of $1,475 for November. Still owes $675 — 22 days late." · "All paid up" · "$250 paid ahead"
 */
W.status = function status(t, lg, today) {
  const bal = lg.balance, c = lg.current;
  if (t.status === 'past') return bal > 0 ? { text: 'Moved out — still owes ' + W.$(bal), tone: 'bad' } : { text: 'Moved out — ' + (bal < 0 ? W.$(-bal) + ' paid ahead' : 'all paid up'), tone: '' };
  if (lg.delinquent && bal > 0) return { text: 'Owes ' + W.$(bal) + ' — behind on rent since ' + W.monthOf(lg.oldestOpenDate, today), tone: 'bad' };
  const p = W.partial(lg, today);
  if (p) {
    const more = bal > p.open ? ' Owes ' + W.$(bal) + ' in all.' : '';
    return { text: 'Has paid ' + W.$(p.paid) + ' of ' + W.$(p.charged) + ' for ' + p.month + '. Still owes ' + W.$(p.open) + (p.late ? ' — ' + W.days(p.daysLate) + ' late' : '') + '.' + more, tone: p.late ? 'bad' : 'warn' };
  }
  if (c.status === 'late' && bal > 0) return { text: 'Owes ' + W.$(bal) + ' — ' + W.days(c.daysLate) + ' late', tone: 'bad' };
  if (c.status === 'due' && bal > 0) return { text: 'Owes ' + W.$(bal) + ' — ' + D.monthName(c.period) + ' rent not paid yet', tone: 'warn' };
  if (bal > 0) return { text: 'Owes ' + W.$(bal), tone: 'warn' };
  return { text: W.balance(bal), tone: bal < 0 ? '' : 'ok' };
};
/** Lease in words: "Lease ends Dec 17 — in 24 days" · "Month-to-month" · "Moving out Dec 15 — in 21 days" · "Moved out Oct 31" */
W.lease = function lease(t, ls, today) {
  const l = t.lease || {};
  if (t.status === 'past') return { text: 'Moved out' + (l.moveOut ? ' ' + T.day(l.moveOut, today) : ''), tone: '' };
  if (l.moveOut && (t.status === 'notice' || ls.noticeGiven)) {
    if (l.moveOut < today) return { text: 'Was moving out ' + T.day(l.moveOut, today) + ' — finish the move-out', tone: 'bad' };
    return { text: 'Moving out ' + T.day(l.moveOut, today) + ' — ' + W.rel(l.moveOut, today), tone: 'warn' };
  }
  if (ls.kind === 'upcoming') return { text: 'Moves in ' + T.day(l.moveIn, today) + ' — ' + W.rel(l.moveIn, today), tone: 'accent' };
  if (ls.kind === 'mtm') return { text: 'Month-to-month', tone: '' };
  if (ls.kind === 'fixed' && l.end) return { text: 'Lease ends ' + T.day(l.end, today) + ' — ' + (ls.daysLeft === 0 ? 'today' : W.rel(l.end, today)), tone: ls.inNoticeWindow ? 'warn' : '' };
  return { text: '', tone: '' };
};
/**
 * The short status marker for a tenant row (§10.2): {kind, words, owes}. kind feeds RB.ui.status; owes = amount to
 * show in ink beside it (0 when nothing is owed).
 */
W.marker = function marker(t, lg, today) {
  const bal = lg.balance, c = lg.current;
  const owes = bal > 0 ? bal : 0;
  if (t.status === 'past') return { kind: 'none', words: 'Moved out', owes };
  if (lg.delinquent && bal > 0) return { kind: 'late', words: 'Behind since ' + W.monthOf(lg.oldestOpenDate, today), owes };
  const p = W.partial(lg, today);
  if (p) return p.late ? { kind: 'late', words: 'Part paid — ' + W.days(p.daysLate) + ' late', owes } : { kind: 'partial', words: 'Part paid — ' + W.$(p.paid) + ' of ' + W.$(p.charged), owes };
  if (c.status === 'late' && bal > 0) return { kind: 'late', words: 'Late — ' + W.days(c.daysLate), owes };
  if (bal > 0) return { kind: 'due', words: 'Not paid yet', owes };
  const l = t.lease || {};
  if (t.status === 'notice' && l.moveOut) return { kind: 'notice', words: 'Moving out ' + T.day(l.moveOut, today), owes };
  if (bal < 0) return { kind: 'paid', words: W.$(-bal) + ' paid ahead', owes };
  return { kind: 'paid', words: 'All paid up', owes };
};
/** Strip caption (rule 10) — kept for other views. */
T.STRIP_CAPTION = 'Each box is a month, oldest on the left. Green = paid on time. Green with a dot = paid late. Half box = part paid. Red = late. Empty box = not paid yet.';
/** Big single-choice buttons (legacy, used by Leases and Settings): hidden input + .seg buttons. New tenant forms use ui.field type:'choice'. */
T.pick = function pick(o) {
  const opts = (o.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: x }));
  const val = o.value == null ? '' : String(o.value);
  return h`<div class="field tn-pick-field${o.span === 2 ? ' span-2' : ''}" data-field="${o.name}">
    ${o.label ? h`<span class="field-label" id="${o.id}-label">${o.label}</span>` : ''}
    <input type="hidden" id="${o.id}" name="${o.name}" value="${val}" data-kind="seg"${o.required ? RB.raw(' required') : ''}${o.requiredMsg ? h` data-required-msg="${o.requiredMsg}"` : ''}>
    <div class="seg tn-pick${o.stack ? ' tn-pick-stack' : ''}" role="radiogroup" aria-labelledby="${o.id}-label" data-seg-for="${o.id}">${opts.map(x => h`<button type="button" role="radio" data-value="${x.value}" aria-checked="${String(String(x.value) === val)}" aria-pressed="${String(String(x.value) === val)}"><span class="tn-pick-l">${x.label}</span>${x.sub ? h`<span class="tn-pick-s">${x.sub}</span>` : ''}</button>`)}</div>
    ${o.hint ? h`<div class="field-hint" id="${o.id}-hint">${o.hint}</div>` : ''}
    <div class="field-error" id="${o.id}-err" aria-live="polite"></div>
  </div>`;
};

// ------------------------------------------------------------------ shared v3 pieces (RB.ui.row / status / choices)
T.row = o => ui.row(Object.assign({ bare: true }, o));
T.status = (kind, words) => ui.status(kind, words);
/** "What would you like to do?" — items [{id, label, hint, run, danger, write}] → the shared choices sheet. */
T.choices = function choices(o) {
  return ui.choices({ title: o.title || 'What would you like to do?', sub: o.sub, items: o.items });
};

/** Step to the previous/next tenant in the list's current order. */
T.step = function step(dir) {
  const id = RB.shell.current().param;
  if (!id) return;
  const list = T.order.includes(id) ? T.order : S().tenantsList().map(t => t.id);
  const n = list[list.indexOf(id) + dir];
  if (n) location.hash = 't-' + n;
};

// ------------------------------------------------------------------ drawer
T.openDrawer = function openDrawer(id) {
  return ui.drawer({
    label: 'Tenant',
    scrim: false,
    onClose: () => { if (/^#t-/.test(location.hash)) location.hash = 'tenants'; },
    render: el => renderDrawer(el, id),
  });
};

/** One way out: "Back to tenants" on phone, "Close" on desktop (the same control, worded per size). */
const exitBtn = () => h`<button type="button" class="btn-link tn-exit" data-drawer-close><span class="show-phone tn-exit-w">${ui.icon('chevron-left')}<span>Back to tenants</span></span><span class="hide-phone tn-exit-w">${ui.icon('x')}<span>Close</span></span></button>`;

const MONTHS_SHOWN = 3;
const NOTES_SHOWN = 3;

function renderDrawer(el, id) {
  const t = S().tenant(id);
  el.classList.add('tn-drawer');
  if (!t) {
    el.dataset.tid = '';
    el._tnParts = null;
    el.innerHTML = String(h`<div class="drawer-head tn-dhead"><div class="tn-dhead-bar"><span class="spacer"></span>${exitBtn()}</div></div>
      <div class="drawer-body tn-dbody"><h2 class="tn-name" id="tn-dtitle">Tenant not found</h2>${ui.empty({ title: 'There is no tenant at this link. They may have been removed.', actions: [{ label: 'Back to tenants', kind: 'primary', act: 'back' }] })}</div>`);
    ui.bind(el, { back: () => { location.hash = 'tenants'; } });
    return;
  }
  if (el.dataset.tid !== id || !el._tnParts) {
    el.dataset.tid = id;
    el._tnParts = {};
    el._tnAllMonths = false;
    el._tnAllNotes = false;
    el.innerHTML = String(h`<div class="drawer-head tn-dhead" data-part="bar"></div>
      <div class="drawer-body tn-dbody" id="tn-dbody">
        <div class="tn-dtop" data-part="head"></div>
        <section class="tn-dsec" aria-labelledby="tn-h-ledger"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-ledger">Payment history</h3></div><div data-part="ledger"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-notes"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-notes">Notes</h3></div><div data-part="timeline"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-lease"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-lease">Lease and rent</h3><button type="button" class="btn-link tn-sec-link" data-act="edit" data-sec="lease" data-write>Change</button></div><div data-part="lease"></div></section>
        <section class="tn-dsec tn-dsec-repairs" data-part-wrap="repairs" data-part="repairs"></section>
        <section class="tn-dsec" aria-labelledby="tn-h-contact"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-contact">Contact</h3><button type="button" class="btn-link tn-sec-link" data-act="edit" data-sec="contact" data-write>Change</button></div><div data-part="contact"></div></section>
      </div>`);
  }
  const today = S().today();
  const lg = S().ledger(id);
  const settings = S().settings();
  const ls = RB.model.leaseState(t, settings, today);
  const parts = el._tnParts;
  const set = (name, markup) => {
    const s = String(markup);
    if (parts[name] === s) return;
    parts[name] = s;
    const node = el.querySelector('[data-part="' + name + '"]');
    if (node) node.innerHTML = s;
  };
  set('bar', barPart(t));
  set('head', h`${headPart(t, lg, ls, today)}${alertsPart(t, lg, settings, today)}`);
  set('ledger', ledgerPart(t, lg, today, el._tnAllMonths));
  set('timeline', timelinePart(T.logList(t), today, el._tnAllNotes));
  set('lease', leasePart(t, lg, ls, settings, today));
  const rep = repairsPart(t);
  const wrap = el.querySelector('[data-part-wrap="repairs"]');
  if (wrap) wrap.hidden = rep === null;
  set('repairs', rep || '');
  set('contact', contactPart(t));
  el.setAttribute('aria-labelledby', 'tn-dtitle');
  ui.bind(el, handlers(el, id));
}

/** The primary payment button's label and amount: "Record the rest ($675)" when this month is part paid. */
T.payLabel = function payLabel(lg, today) {
  const p = W.partial(lg, today);
  return p ? { label: 'Record the rest (' + W.$(p.open) + ')', amount: p.open, partial: true } : { label: 'Record a payment', amount: null, partial: false };
};

function barPart(t) {
  const pos = T.order.indexOf(t.id);
  return h`<div class="tn-dhead-bar">
      <span class="tn-steps hide-phone">
        <button type="button" class="btn-link" data-act="step" data-d="-1"${pos <= 0 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-up')}<span>Previous tenant</span></button>
        <button type="button" class="btn-link" data-act="step" data-d="1"${pos < 0 || pos === T.order.length - 1 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-down')}<span>Next tenant</span></button>
      </span>
      <span class="spacer"></span>
      ${exitBtn()}
    </div>`;
}
function headPart(t, lg, ls, today) {
  const st = W.status(t, lg, today);
  const le = W.lease(t, ls, today);
  const pay = T.payLabel(lg, today);
  const co = (t.coTenants || []).filter(c => c && c.name).map(c => c.name);
  const showLease = t.status !== 'past' && (t.status === 'notice' || ls.kind === 'upcoming') && le.text;
  return h`<div class="tn-dident">
      ${ui.plate(t.unit, { size: 'lg', title: T.place(t) })}
      <div class="tn-dident-text">
        <h2 class="tn-name" id="tn-dtitle">${t.name || 'Unnamed tenant'}</h2>
        <div class="tn-dplace">${T.place(t)}${co.length ? h` · with ${co.join(', ')}` : ''}</div>
      </div>
    </div>
    <p class="tn-dstatus" id="tn-dstatus">${st.text}</p>
    ${showLease ? h`<p class="tn-dlease">${le.text}</p>` : ''}
    <div class="tn-dacts">
      <button type="button" class="btn btn-primary" data-act="pay" data-write>${pay.label}</button>
      <button type="button" class="btn btn-outline" id="tn-add-note" data-act="note" data-write>Add a note</button>
      <button type="button" class="btn btn-outline" data-act="more" aria-haspopup="dialog">More</button>
    </div>`;
}

function alertsPart(t, lg, settings, today) {
  const out = [];
  const dd = RB.model.depositDue(t, settings, today);
  if (dd) out.push(h`<li class="tn-alert"><span class="tn-alert-text">The ${W.$(dd.amount)} deposit has to go back by ${T.day(dd.dueDate, today)} — ${dd.overdue ? W.days(-dd.daysLeft) + ' overdue' : W.rel(dd.dueDate, today)}.</span><button type="button" class="btn-link" data-act="settle" data-write>Give back the deposit</button></li>`);
  const ls = RB.model.leaseState(t, settings, today);
  if (t.status === 'notice' && ls.moveOut && ls.moveOut <= today) out.push(h`<li class="tn-alert"><span class="tn-alert-text">${ls.moveOut === today ? 'They move out today.' : h`They were moving out on ${T.day(ls.moveOut, today)}.`} When they have gone, finish the move-out.</span><button type="button" class="btn-link" data-act="moveout" data-write>Finish the move-out</button></li>`);
  return out.length ? h`<ul class="tn-alerts">${out}</ul>` : '';
}

// ---- contact: the number and the address are the tap targets; Copy lives in More
const telHref = p => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.length >= 5 ? 'tel:' + d : null; };
const mailHref = e => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(e || '').trim()) ? 'mailto:' + String(e).trim() : null);
T.telHref = telHref; T.mailHref = mailHref;
function contactRow(value, kind, sub) {
  const href = kind === 'phone' ? telHref(value) : mailHref(value);
  const title = (kind === 'phone' ? 'Call ' : 'Email ') + value;
  return href ? T.row({ title, sub, href, attrs: { 'data-contact': kind } }) : T.row({ title: value, sub });
}
function contactPart(t) {
  const co = (t.coTenants || []).filter(c => c && (c.name || c.phone || c.email));
  const em = t.emergency || {};
  const rows = [];
  if (t.phone) rows.push(contactRow(t.phone, 'phone'));
  if (t.email) rows.push(contactRow(t.email, 'email'));
  co.forEach(c => {
    const who = (c.name || 'Someone') + ' — also on the lease';
    if (c.phone) rows.push(contactRow(c.phone, 'phone', who));
    if (c.email) rows.push(contactRow(c.email, 'email', who));
    if (!c.phone && !c.email) rows.push(T.row({ title: c.name || 'Unnamed', sub: 'Also on the lease' }));
  });
  if (em.phone) rows.push(contactRow(em.phone, 'phone', (em.name ? em.name + ' — ' : '') + 'in an emergency'));
  else if (em.name) rows.push(T.row({ title: em.name, sub: 'In an emergency' }));
  const missing = !t.phone && !t.email;
  return h`${rows.length ? h`<ul class="rows rows-inset rows-nolead">${rows.map(r => h`<li>${r}</li>`)}</ul>` : ''}
    ${missing ? h`<p class="tn-empty">No phone number or email yet. <button type="button" class="btn-link" data-act="edit" data-sec="contact" data-write>Add them</button></p>` : ''}`;
}

// ---- lease and rent: short label/value rows, one "Change" link in the section head
function leasePart(t, lg, ls, settings, today) {
  const l = t.lease || {};
  const rows = [];
  const sched = (t.rent || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  const nowIdx = sched.reduce((acc, r, i) => (r.from <= today ? i : acc), 0);
  const curR = sched[nowIdx], prevR = sched[nowIdx - 1], next = sched.filter(r => r.from > today);
  const terms = RB.model.termsOf(t, settings);
  rows.push(['Rent', h`${W.$(lg.rent)} a month, due on the ${T.ordinal(terms.dueDay)} — late after ${RB.plural(terms.graceDays, 'more day')}${l.dueDay != null || l.graceDays != null ? ' (special for this tenant)' : ''}.${prevR && curR ? h` It was ${W.$(prevR.amount)} until ${T.day(curR.from, today)}.` : ''}${next.map(r => h` Goes to ${W.$(r.amount)} on ${T.day(r.from, today)}.`)}`]);
  const rec = (t.recurring || []).filter(r => r && r.amount && !(r.to && r.to < today));
  if (rec.length) rows.push(['Each month also', RB.html.join(rec.map(r => h`${r.label || 'Monthly charge'} ${W.$(r.amount)}${r.from && r.from > today ? ' from ' + T.day(r.from, today) : r.to ? ' until ' + T.day(r.to, today) : ''}`), ', ')]);
  let lease;
  if (t.status === 'past') lease = h`Moved out ${T.day(l.moveOut, today)}`;
  else if (ls.kind === 'mtm') lease = h`Month-to-month${ls.holdover ? h` since ${T.day(l.end, today)}` : ''}`;
  else if (ls.kind === 'upcoming') lease = h`Starts ${T.day(l.moveIn, today)}${l.end ? h`, ends ${T.day(l.end, today)}` : ''}`;
  else lease = h`Ends ${T.day(l.end, today)} — ${ls.daysLeft === 0 ? 'today' : 'in ' + W.days(ls.daysLeft)}`;
  rows.push(['Lease', h`${lease}. Moved in ${T.day(l.moveIn || l.start, today)}.`]);
  if (l.moveOut && t.status !== 'past') rows.push(['Moving out', h`${T.day(l.moveOut, today)} — ${W.rel(l.moveOut, today)}`]);
  const dep = t.deposit || {};
  if (+dep.amount > 0) {
    if (dep.returned) {
      const kept = (dep.returned.deductions || []).reduce((s, d) => s + (+d.amount || 0), 0);
      rows.push(['Deposit', h`${W.$(dep.amount)} — ${W.$(dep.returned.refund || 0)} given back ${T.day(dep.returned.date, today)}${kept ? ', ' + W.$(kept) + ' kept' : ''}${dep.returned.applied ? ', ' + W.$(dep.returned.applied) + ' used for unpaid rent' : ''}`]);
    } else rows.push(['Deposit', h`${W.$(dep.amount)}${dep.heldAt ? h`, kept at ${dep.heldAt}` : ''}`]);
  }
  const ins = t.insurance;
  if (ins && (ins.carrier || ins.policy || ins.expires)) rows.push(['Insurance', h`${ins.carrier || 'Insurer'}${ins.expires ? h`, ${ins.expires < today ? 'ran out' : 'runs out'} ${T.day(ins.expires, today)}` : ''}`]);
  const links = (t.links || []).filter(x => x && RB.safeUrl(x.url));
  if (links.length) rows.push(['Documents', RB.html.join(links.map(x => h`<a class="tn-link" href="${RB.safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${x.label || x.url}</a>`), ', ')]);
  if (t.about) rows.push(['About them', h`<span class="prewrap">${t.about}</span>`]);
  return h`<dl class="tn-kv">${rows.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

// ---- payment history: by month, newest month first; each month's lines in the order they happened
/** Which payments were part payments: a payment after which a rent charge it went to is still not fully paid. */
function paymentKinds(rows) {
  const paidSoFar = {}, byId = {}, out = {};
  rows.forEach(r => { byId[r.id] = r; });
  rows.forEach(r => {
    if (r.type === 'charge' || r.void || !r.applied) return;
    let part = false, rest = false;
    r.applied.forEach(a => {
      const before = paidSoFar[a.id] || 0;
      paidSoFar[a.id] = before + a.amount;
      const c = byId[a.id];
      if (c && (c.kind === 'rent' || c.kind === 'recurring')) { if (paidSoFar[a.id] < c.amount) part = true; else if (before > 0) rest = true; }
    });
    out[r.id] = part ? 'part' : rest ? 'rest' : '';
  });
  return out;
}
function rowWhat(r, kinds) {
  if (r.kind === 'rent') return D.monthName(r.period) + (r.period.slice(0, 4) !== S().today().slice(0, 4) ? ' ' + r.period.slice(0, 4) : '') + ' rent';
  if (r.kind === 'recurring') return r.label || 'Monthly charge';
  if (r.kind === 'opening') return 'What they already owed';
  const e = r.entry || {};
  if (r.type === 'payment') { const k = kinds[r.id]; return (k === 'part' ? 'Part payment' : k === 'rest' ? 'Payment — the rest' : 'Payment') + (r.method ? ' by ' + r.method : ''); }
  if (r.type === 'credit') return 'Money off' + (r.memo ? ': ' + r.memo : '');
  if (e.category === 'late_fee') return 'Late fee' + (r.period ? ' for ' + D.monthName(r.period) : '');
  return r.memo || 'Charge';
}
function rowSub(r, today) {
  const bits = [T.day(r.date, today)];
  if (r.void) bits.push('Removed — it was a mistake');
  if (r.prorate) bits.push(r.prorate.days + ' of ' + r.prorate.ofDays + ' days of ' + W.$(r.prorate.full));
  if (r.type === 'charge' && !r.void && r.amount > 0) {
    if (r.open === 0 && r.paidOn) bits.push('paid ' + T.day(r.paidOn, today));
    else if (r.open > 0 && r.paid > 0) bits.push(W.$(r.paid) + ' paid so far, ' + W.$(r.open) + ' still owed');
    else if (r.open > 0) bits.push('not paid yet');
  }
  if (r.kind === 'entry') {
    if (r.ref) bits.push('reference ' + r.ref);
    if (r.type === 'payment' && r.memo) bits.push(r.memo);
    if (r.type !== 'charge' && !r.void && r.unapplied > 0) bits.push(W.$(r.unapplied) + ' paid ahead');
  }
  return bits.filter(Boolean).join(' · ');
}
/** Sums for one month of lines (void lines left out): {due, paid, owed}. Exposed for the smoke test. */
T.monthSums = function monthSums(rows) {
  const live = rows.filter(r => !r.void);
  return {
    due: live.filter(r => r.type === 'charge').reduce((s, r) => s + r.amount, 0),
    paid: live.filter(r => r.type !== 'charge').reduce((s, r) => s + r.amount, 0),
    owed: live.filter(r => r.type === 'charge').reduce((s, r) => s + (r.open || 0), 0),
  };
};
/** "November 2026 — $1,475 due, $800 paid, $675 still owed" / "… — $1,475 due, $1,475 paid, paid in full" */
T.monthHeading = function monthHeading(key, rows) {
  const s = T.monthSums(rows);
  const bits = [];
  if (s.due > 0) {
    bits.push(W.$(s.due) + ' due');
    if (s.paid > 0) bits.push(W.$(s.paid) + ' paid');
    bits.push(s.owed === 0 ? 'paid in full' : s.paid === 0 && s.owed === s.due ? 'not paid yet' : W.$(s.owed) + ' still owed');
  } else bits.push(s.paid > 0 ? W.$(s.paid) + ' paid' : 'nothing due');
  return D.fmtMonth(key) + ' — ' + bits.join(', ');
};
/** The lines of the payment history grouped by month: [{key, rows}] newest month first, rows oldest first. */
T.historyMonths = function historyMonths(lg) {
  const by = new Map();
  lg.rows.forEach(r => { const k = D.monthKey(r.date); if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  return Array.from(by.keys()).sort().reverse().map(key => ({ key, rows: by.get(key) }));
};

function ledgerPart(t, lg, today, showAll) {
  const months = T.historyMonths(lg);
  if (!months.length) return h`<p class="tn-empty">Nothing here yet. Rent starts ${T.day(lg.trackFrom, today)}.</p>`;
  const kinds = paymentKinds(lg.rows);
  const shown = showAll ? months : months.slice(0, MONTHS_SHOWN);
  const line = r => {
    const what = rowWhat(r, kinds);
    const stored = r.kind === 'entry';
    const amt = h`<span class="${r.void ? 'tn-struck' : ''}">${W.$(r.amount)}</span>`;
    const o = { title: what, sub: rowSub(r, today), amt, attrs: { 'data-row': r.id } };
    if (stored) Object.assign(o, { act: 'line', attrs: { 'data-row': r.id, 'data-eid': r.id, 'aria-haspopup': 'dialog' } });
    return h`<li class="${r.void ? 'is-void' : ''}">${T.row(o)}</li>`;
  };
  return h`<div class="tn-history" id="tn-history">${shown.map(m => h`<h4 class="rows-head tn-month" data-month="${m.key}">${T.monthHeading(m.key, m.rows)}</h4>
      <ul class="rows rows-inset rows-nolead">${m.rows.map(line)}</ul>`)}</div>
    ${months.length > MONTHS_SHOWN ? h`<button type="button" class="rows-more" data-act="earlier">${showAll ? 'Show only the last 3 months' : 'Show earlier months (' + (months.length - MONTHS_SHOWN) + ')'}</button>` : ''}`;
}

// ---- notes: latest 3 + "Show all"
function noteRow(e, today) {
  const day = localDay(e.at);
  const fu = e.followUp;
  let status = null;
  if (fu) {
    if (e.done) status = T.status('paid', 'Followed up');
    else if (fu < today) status = T.status('late', 'Follow up — ' + W.rel(fu, today, { style: 'late' }));
    else if (fu === today) status = T.status('due', 'Follow up today');
    else status = T.status('none', 'Follow up ' + T.day(fu, today));
  }
  const text = String(e.text || '');
  return T.row({ title: text.length > 72 ? text.slice(0, 70).trim() + '…' : text, sub: [day ? T.day(day, today) : '', T.KIND_LABEL[e.kind] || 'Note'].filter(Boolean).join(' · '), status, statusPos: 'main', act: 'notemenu', attrs: { 'data-lid': e.id, 'aria-haspopup': 'dialog' } });
}
function timelinePart(logs, today, showAll) {
  if (!logs.length) return h`<p class="tn-empty">No notes yet. Write down calls, texts and visits here so you remember them.</p>`;
  const shown = showAll ? logs : logs.slice(0, NOTES_SHOWN);
  return h`<ul class="rows rows-inset rows-nolead tn-notes">${shown.map(e => h`<li class="tn-note${e.done && e.followUp ? ' is-done' : ''}" data-lid="${e.id}">${noteRow(e, today)}</li>`)}</ul>
    ${logs.length > NOTES_SHOWN ? h`<button type="button" class="rows-more" data-act="allnotes">${showAll ? 'Show only the latest 3' : 'Show all ' + logs.length + ' notes'}</button>` : ''}`;
}

/** Repairs in this unit: provided by the Repairs view (RB.repairs.unitSection), which brings its own heading. null = hide. */
function repairsPart(t) {
  const R = RB.repairs;
  if (!R || typeof R.unitSection !== 'function') return null;
  try {
    let out = R.unitSection(t);
    if (out == null || out === '') return null;
    if (out && out.nodeType === 1) out = RB.raw(out.outerHTML);
    else if (!RB.isSafe(out)) out = R.unitSectionIsSafe ? RB.raw(String(out)) : h`${String(out)}`;
    if (!String(out).trim()) return null;
    // One heading only: add ours only if the section does not bring one.
    return /<h[2-4][\s>]/i.test(String(out)) ? out : h`<div class="tn-sec-head"><h3 class="tn-sec-title">Repairs in this unit</h3></div>${out}`;
  } catch (e) { console.warn(e); return null; }
}

// ------------------------------------------------------------------ note sheet (add + change)
T.noteSheet = function noteSheet(id, lid) {
  if (!T.guard()) return Promise.resolve(null);
  const t = S().tenant(id); if (!t) return Promise.resolve(null);
  const e = lid && t.log && t.log[lid] ? t.log[lid] : null;
  if (lid && !e) return Promise.resolve(null);
  const today = S().today();
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: e ? 'Change this note' : 'Add a note', sub: t.name + ' — ' + T.place(t),
      body: el => {
        el.innerHTML = String(h`<div class="tn-form">
        ${ui.field({ name: 'text', id: 'tn-note-text', label: 'What happened?', type: 'textarea', value: e ? e.text : '', required: true, requiredMsg: 'Write what happened first', rows: 4, placeholder: 'For example: Called about the late rent. She will pay on Friday.' })}
        ${ui.field({ name: 'kind', id: 'tn-note-kind', label: 'How?', type: 'select', value: e ? (e.kind === 'notice' ? 'note' : e.kind) : 'note', options: T.NOTE_KINDS })}
        ${T.dateField({ name: 'followUp', id: 'tn-note-follow', label: 'Remind me to follow up on…', value: e ? e.followUp || '' : '', optional: true, hint: 'Leave this empty if you don’t need a reminder. On that day it shows on Today.' })}
      </div>`);
      },
      initialFocus: '#tn-note-text',
      actions: [{ id: 'save', label: e ? 'Save the note' : 'Add the note', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ followUp: v.followUp && !D.valid(v.followUp) ? 'Pick a date from the calendar' : '' }) });
        if (!v) return false;
        if (e) {
          const prev = { kind: e.kind || 'note', text: e.text || '', followUp: e.followUp || null, done: !!e.done };
          const patch = { kind: v.kind || 'note', text: v.text, followUp: v.followUp || null };
          if (patch.followUp !== prev.followUp) patch.done = false;
          S().updateLog(id, lid, patch).catch(() => {});
          saved = lid;
          ui.toast('Saved the note for ' + t.name + '.', { undo: () => S().updateLog(id, lid, prev), duration: 10000 });
        } else {
          const nid = RB.id();
          S().addLog(id, { id: nid, kind: v.kind || 'note', text: v.text, followUp: v.followUp || null, done: false }).catch(() => {});
          saved = nid;
          ui.toast('Added a note for ' + t.name + (v.followUp ? '. You’ll be reminded on ' + T.day(v.followUp, today) + '.' : '.'), { undo: () => S().deleteLog(id, nid), duration: 10000 });
        }
      } }],
      onClose: () => resolve(saved),
    });
  });
};

// ------------------------------------------------------------------ written-out date fields (law 11)
/** A date field with the day written out beside it ("Tuesday, November 24"). Same options as ui.field. */
T.dateField = o => ui.dateField(o);

// ------------------------------------------------------------------ entries: remove / put back
const entryWord = e => (e.type === 'payment' ? 'payment' : e.type === 'credit' ? 'money off' : e.category === 'late_fee' ? 'late fee' : 'charge');
T.removeEntry = function removeEntry(id, eid) {
  if (!T.guard()) return;
  const e = S().entries(id)[eid]; if (!e) return;
  S().voidEntry(id, eid).catch(() => {});
  ui.toast('Removed the ' + W.$(e.amount) + ' ' + entryWord(e) + ' from ' + T.day(e.date, S().today()) + '.', { undo: () => S().unvoidEntry(id, eid), duration: 10000 });
};
T.putBack = function putBack(id, eid) {
  if (!T.guard()) return;
  const e = S().entries(id)[eid]; if (!e) return;
  S().unvoidEntry(id, eid).catch(() => {});
  ui.toast('Put back the ' + W.$(e.amount) + ' ' + entryWord(e) + '.', { undo: () => S().voidEntry(id, eid), duration: 10000 });
};
/** Payment history as a file for Excel — column headings in plain words. */
T.downloadHistory = function downloadHistory(id) {
  const t = S().tenant(id); const lg = S().ledger(id);
  if (!t || !lg) return Promise.resolve(false);
  const kinds = paymentKinds(lg.rows);
  const csv = RB.model.csv(lg.rows, [
    { label: 'Date', key: 'date' },
    { label: 'What', get: r => rowWhat(r, kinds) },
    { label: 'For month', get: r => (r.period ? D.fmtMonth(r.period) : '') },
    { label: 'Charged', money: true, get: r => (r.type === 'charge' ? r.amount : null) },
    { label: 'Paid or money off', money: true, get: r => (r.type !== 'charge' ? r.amount : null) },
    { label: 'Still owed after this line', money: true, get: r => r.balance },
    { label: 'How they paid', get: r => r.method || '' },
    { label: 'Reference', get: r => r.ref || '' },
    { label: 'Note', get: r => (r.kind === 'entry' ? r.memo || '' : '') },
    { label: 'Removed', get: r => (r.void ? 'Removed — it was a mistake' : '') },
  ]);
  const slug = String(t.unit + ' ' + t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tenant';
  return RB.actions.downloadFile('payment-history-' + slug + '-' + S().today() + '.csv', csv, 'text/csv');
};

// ------------------------------------------------------------------ "More" — every other action, with a line each
T.moreSheet = function moreSheet(id) {
  const t = S().tenant(id); if (!t) return;
  const A = RB.actions;
  const today = S().today();
  const lg = S().ledger(id);
  const p = W.partial(lg, today);
  const l = t.lease || {};
  const live = t.status !== 'past';
  const items = [];
  const add = (id2, label, hint, run, extra) => items.push(Object.assign({ id: 'tn-more-' + id2, label, hint, run, write: true }, extra || {}));
  if (p) add('part', 'Record another part payment', 'They paid some more, but not all of it', () => A.recordPayment(id, { part: true }));
  const fee = lg.suggestedLateFee;
  if (fee && live) { const fm = lg.months[fee.period]; add('fee', 'Add a ' + W.$(fee.amount) + ' late fee', D.monthName(fee.period) + ' rent is ' + (fm ? W.days(fm.daysLate) + ' ' : '') + 'late — your rules suggest it', () => A.addLateFee(id)); }
  add('charge', 'Add a charge', 'A late fee, repair bill or utility', () => A.addCharge(id));
  add('credit', 'Take money off what they owe', 'A discount, or money you are giving back', () => A.addCredit(id));
  if (live) {
    add('rent', 'Change the rent', 'Set a new monthly rent from a date you choose', () => A.changeRent(id));
    add('renew', 'Renew the lease', 'Give the lease a new end date', () => A.renewLease(id));
    add('moveout', t.status === 'notice' && l.moveOut && l.moveOut <= today ? 'Finish the move-out' : 'They are moving out', 'Set the date, see what they still owe, and sort out the deposit', () => A.moveOut(id));
  }
  if (t.deposit && +t.deposit.amount > 0 && !t.deposit.returned && l.moveOut && (t.status === 'past' || l.moveOut <= today)) add('settle', 'Give back the deposit', 'Work out what to keep and what to give back', () => A.settleDeposit(id));
  add('stmt', 'Copy a statement', 'Every charge and payment, ready to paste into a message', () => A.copyStatement(id), { write: false });
  add('csv', 'Download for Excel', 'The whole payment history as a spreadsheet file', () => T.downloadHistory(id), { write: false });
  if (t.phone) add('copyphone', 'Copy their phone number', t.phone, () => ui.copy(t.phone, 'phone number'), { write: false });
  if (t.email) add('copyemail', 'Copy their email address', t.email, () => ui.copy(t.email, 'email address'), { write: false });
  add('edit', 'Change their details', 'Name, phone, unit, rent and more', () => A.editTenant(id));
  add('delete', 'Remove this tenant', 'Only if they were added by mistake — this deletes all their history', () => T.deleteTenant(id), { danger: true });
  return T.choices({ title: 'What would you like to do?', sub: t.name + ' — ' + T.place(t), items });
};

/** Tapping a line in the payment history: Change · Remove this payment — it was a mistake · Copy a receipt. */
T.lineSheet = function lineSheet(id, eid) {
  const t = S().tenant(id);
  const e = S().entries(id)[eid];
  if (!t || !e) return;
  const A = RB.actions;
  const w = entryWord(e);
  const today = S().today();
  const items = [{ id: 'tn-line-change', label: 'Change', hint: 'Fix the amount, the date or how they paid', run: () => A.editEntry(id, eid), write: true }];
  if (e.void) items.push({ id: 'tn-line-putback', label: 'Put this ' + w + ' back', hint: 'It was removed by mistake', run: () => T.putBack(id, eid), write: true });
  else items.push({ id: 'tn-line-remove', label: 'Remove this ' + w + ' — it was a mistake', hint: 'You can put it back afterwards', run: () => T.removeEntry(id, eid), write: true });
  if (e.type === 'payment' && !e.void) items.push({ id: 'tn-line-receipt', label: 'Copy a receipt', hint: 'Ready to paste into a text or email', run: () => A.copyReceipt(id, eid) });
  return T.choices({ title: 'What would you like to do?', sub: W.$(e.amount) + ' ' + w + ' — ' + T.day(e.date, today), items });
};

/** Tapping a note: followed up · Change this note · Delete this note. */
T.noteMenu = function noteMenu(id, lid) {
  const t = S().tenant(id);
  const e = t && t.log && t.log[lid];
  if (!e) return;
  const items = [];
  if (e.followUp) items.push(e.done
    ? { id: 'tn-note-undone', label: 'Not followed up yet', hint: 'Bring the reminder back', run: () => RB.actions.followupDone(id, lid, false), write: true }
    : { id: 'tn-note-done', label: 'Mark as followed up', hint: 'The reminder goes away from Today', run: () => RB.actions.followupDone(id, lid, true), write: true });
  items.push({ id: 'tn-note-change', label: 'Change this note', hint: 'Fix the words, the kind or the reminder', run: () => T.noteSheet(id, lid), write: true });
  items.push({ id: 'tn-note-delete', label: 'Delete this note', hint: 'You can undo it straight after', danger: true, write: true, run: () => {
    if (!T.guard()) return;
    const tt = S().tenant(id); const prev = tt && tt.log && tt.log[lid] ? RB.clone(tt.log[lid]) : null;
    if (!prev) return;
    S().deleteLog(id, lid).catch(() => {});
    ui.toast('Deleted the note.', { undo: () => S().updateLog(id, lid, prev), duration: 10000 });
  } });
  return T.choices({ title: 'What would you like to do?', sub: String(e.text || '').slice(0, 80), items });
};

function handlers(el, id) {
  const A = RB.actions;
  return {
    step: b => T.step(+b.dataset.d),
    pay: () => {
      const p = T.payLabel(S().ledger(id), S().today());
      if (p.partial) A.recordPayment(id, { amount: p.amount });
      else A.recordPayment(id);
    },
    fee: () => A.addLateFee(id),
    settle: () => A.settleDeposit(id),
    moveout: () => A.moveOut(id),
    edit: b => A.editTenant(id, b.dataset.sec),
    more: () => T.moreSheet(id),
    note: () => T.noteSheet(id),
    earlier: () => { el._tnAllMonths = !el._tnAllMonths; renderDrawer(el, id); },
    allnotes: () => { el._tnAllNotes = !el._tnAllNotes; renderDrawer(el, id); },
    line: b => T.lineSheet(id, b.dataset.eid),
    notemenu: b => T.noteMenu(id, b.dataset.lid),
  };
}
T.editNote = (id, lid) => T.noteSheet(id, lid);

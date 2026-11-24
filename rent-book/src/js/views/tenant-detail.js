// views/tenant-detail.js — the tenant page (#t-<id>): a right drawer on desktop, a full page on phone.
// Loaded before tenant-forms.js and tenants.js (name order); shares helpers with them (and, at render time, with
// leases.js and reports.js) through RB._tn. Plain-language rules: docs/SPEC.md §8.
// Re-render contract: the drawer is patched part by part (data-part), so a store change never resets its scroll.
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

// ---- wording (glossary, SPEC §8 rule 4). Built on the shared date/money helpers; numbers always spelled with words.
const W = (T.W = {});
W.days = n => RB.plural(Math.abs(n), 'day');
/** "in 24 days" / "22 days ago" / {style:'late'} "22 days late" / "today" — the shared relative phrase, never abbreviated. */
W.rel = (d, today, o) => String(D.rel(d, today, o) || '').replace(/(\d+) ?d\b/g, (m, n) => (n === '1' ? '1 day' : n + ' days'));
W.$ = c => M.fmt(c);
W.date = (d, today) => D.fmt(d, today);
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
 * One status sentence for a tenant: {text, tone:'bad'|'warn'|'ok'|''}.
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
  if (t.status === 'past') return { text: 'Moved out' + (l.moveOut ? ' ' + W.date(l.moveOut, today) : ''), tone: '' };
  if (l.moveOut && (t.status === 'notice' || ls.noticeGiven)) {
    if (l.moveOut < today) return { text: 'Was moving out ' + W.date(l.moveOut, today) + ' — finish the move-out', tone: 'bad' };
    return { text: 'Moving out ' + W.date(l.moveOut, today) + ' — ' + W.rel(l.moveOut, today), tone: 'warn' };
  }
  if (ls.kind === 'upcoming') return { text: 'Moves in ' + W.date(l.moveIn, today) + ' — ' + W.rel(l.moveIn, today), tone: 'accent' };
  if (ls.kind === 'mtm') return { text: 'Month-to-month', tone: '' };
  if (ls.kind === 'fixed' && l.end) return { text: 'Lease ends ' + W.date(l.end, today) + ' — ' + (ls.daysLeft === 0 ? 'today' : W.rel(l.end, today)), tone: ls.inNoticeWindow ? 'warn' : '' };
  return { text: '', tone: '' };
};
/** Strip caption (rule 10). */
T.STRIP_CAPTION = 'Each box is a month, oldest on the left. Green = paid on time. Green with a dot = paid late. Half box = part paid. Red = late. Empty box = not paid yet.';
/** Big single-choice buttons that work like ui.field seg (hidden input + global click handler). */
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

const backBtn = () => h`<button type="button" class="btn tn-back" data-drawer-close>${ui.icon('chevron-left')}<span>Back to tenants</span></button>`;
const closeBtn = () => h`<button type="button" class="btn btn-ghost tn-close hide-phone" data-drawer-close>${ui.icon('x')}<span>Close</span></button>`;

function renderDrawer(el, id) {
  const t = S().tenant(id);
  el.classList.add('tn-drawer');
  if (!t) {
    el.dataset.tid = '';
    el._tnParts = null;
    el.innerHTML = String(h`<div class="drawer-head tn-dhead"><div class="tn-dhead-bar">${backBtn()}<span class="spacer"></span>${closeBtn()}</div><h2 class="drawer-title">Tenant not found</h2></div>
      <div class="drawer-body">${ui.empty({ icon: 'user', title: 'There is no tenant at this link', body: 'They may have been removed, or the link is from another rent book.', actions: [{ label: 'Back to tenants', kind: 'primary', act: 'back' }] })}</div>`);
    ui.bind(el, { back: () => { location.hash = 'tenants'; } });
    return;
  }
  if (el.dataset.tid !== id || !el._tnParts) {
    el.dataset.tid = id;
    el._tnParts = {};
    el._tnShowAll = false;
    el.innerHTML = String(h`<div class="drawer-head tn-dhead" data-part="bar"></div>
      <div class="drawer-body tn-dbody" id="tn-dbody">
        <div class="tn-dtop" data-part="head"></div>
        <div data-part="alerts"></div>
        <section class="tn-dsec" aria-labelledby="tn-h-contact"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-contact">Contact</h3><button type="button" class="btn" data-act="edit" data-sec="contact" data-write>${ui.icon('edit')}<span>Change</span></button></div><div data-part="contact"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-lease"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-lease">Lease and rent</h3></div><div data-part="lease"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-ledger"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-ledger">Payment history</h3></div><div data-part="ledger"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-notes"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-notes">Notes</h3><button type="button" class="btn" id="tn-add-note" data-act="note" data-write>${ui.icon('note')}<span>Add a note</span></button></div><div data-part="timeline"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-repairs" data-part-wrap="repairs"><div class="tn-sec-head"><h3 class="tn-sec-title" id="tn-h-repairs">Repairs in this unit</h3></div><div data-part="repairs"></div></section>
        <nav class="tn-dnav" aria-label="Other tenants" data-part="nav"></nav>
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
  set('head', headPart(t, lg, ls, today));
  set('alerts', alertsPart(t, lg, settings, today));
  set('contact', contactPart(t));
  set('lease', leasePart(t, lg, ls, settings, today));
  set('ledger', ledgerPart(t, lg, today, el._tnShowAll));
  set('timeline', timelinePart(T.logList(t), today));
  const rep = repairsPart(t);
  const wrap = el.querySelector('[data-part-wrap="repairs"]');
  if (wrap) wrap.hidden = rep === null;
  set('repairs', rep || '');
  set('nav', navPart(t));
  el.setAttribute('aria-labelledby', 'tn-dtitle');
  ui.bind(el, handlers(el, id));
}

function navPart(t) {
  const pos = T.order.indexOf(t.id);
  return h`<button type="button" class="btn" data-act="step" data-d="-1"${pos <= 0 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}<span>Previous tenant</span></button>
    <button type="button" class="btn" data-act="step" data-d="1"${pos < 0 || pos === T.order.length - 1 ? RB.raw(' disabled') : ''}><span>Next tenant</span>${ui.icon('chevron-right')}</button>`;
}

/** The primary payment button's label and amount: "Record the rest ($675)" when this month is part paid. */
T.payLabel = function payLabel(lg, today) {
  const p = W.partial(lg, today);
  return p ? { label: 'Record the rest (' + W.$(p.open) + ')', amount: p.open, partial: true } : { label: 'Record a payment', amount: null, partial: false };
};

function barPart(t) {
  const pos = T.order.indexOf(t.id);
  return h`<div class="tn-dhead-bar">
      ${backBtn()}
      <span class="spacer"></span>
      <span class="tn-steps hide-phone">
        <button type="button" class="btn btn-ghost" data-act="step" data-d="-1"${pos <= 0 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-up')}<span>Previous</span></button>
        <button type="button" class="btn btn-ghost" data-act="step" data-d="1"${pos < 0 || pos === T.order.length - 1 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-down')}<span>Next</span></button>
      </span>
      ${closeBtn()}
    </div>`;
}
function headPart(t, lg, ls, today) {
  const st = W.status(t, lg, today);
  const le = W.lease(t, ls, today);
  const pay = T.payLabel(lg, today);
  const co = (t.coTenants || []).filter(c => c && c.name).map(c => c.name);
  return h`    <div class="tn-dident">
      ${ui.plate(t.unit, { size: 'lg', status: lg.current.status, title: T.place(t) })}
      <div class="grow">
        <h2 class="drawer-title" id="tn-dtitle">${t.name || 'Unnamed tenant'}</h2>
        <div class="tn-dplace">${T.place(t)}${co.length ? h`<span class="tn-dwith"> · with ${co.join(', ')}</span>` : ''}</div>
      </div>
    </div>
    <p class="tn-dstatus tone-${st.tone || 'ink'}" id="tn-dstatus">${st.text}</p>
    ${le.text && t.status !== 'past' ? h`<p class="tn-dlease${le.tone ? ' tone-' + le.tone : ''}">${le.text}</p>` : ''}
    <div class="tn-dacts">
      <button type="button" class="btn btn-primary btn-lg" data-act="pay" data-write>${ui.icon('cash')}<span>${pay.label}</span></button>
      <button type="button" class="btn btn-lg" data-act="note" data-write>${ui.icon('note')}<span>Add a note</span></button>
      <button type="button" class="btn btn-lg" data-act="more" aria-haspopup="dialog">${ui.icon('more')}<span>More</span></button>
    </div>`;
}

function alertsPart(t, lg, settings, today) {
  const out = [];
  const fee = lg.suggestedLateFee;
  if (fee && t.status !== 'past') {
    const m = lg.months[fee.period];
    out.push(h`<div class="tn-alert"><span class="tn-alert-text">${D.monthName(fee.period)} rent is ${m ? W.days(m.daysLate) + ' ' : ''}late. Your rules suggest a late fee of ${W.$(fee.amount)}.</span><button type="button" class="btn" data-act="fee" data-write>Add a ${W.$(fee.amount)} late fee</button></div>`);
  }
  const dd = RB.model.depositDue(t, settings, today);
  if (dd) out.push(h`<div class="tn-alert"><span class="tn-alert-text">The ${W.$(dd.amount)} deposit has to go back by ${W.date(dd.dueDate, today)} — ${dd.overdue ? h`<strong class="tone-bad">${W.days(-dd.daysLeft)} overdue</strong>` : W.rel(dd.dueDate, today)}.</span><button type="button" class="btn" data-act="settle" data-write>Give back the deposit</button></div>`);
  const ls = RB.model.leaseState(t, settings, today);
  if (t.status === 'notice' && ls.moveOut && ls.moveOut <= today) out.push(h`<div class="tn-alert"><span class="tn-alert-text">${ls.moveOut === today ? 'They move out today.' : h`They were moving out on ${W.date(ls.moveOut, today)}.`} When they have gone, finish the move-out.</span><button type="button" class="btn" data-act="moveout" data-write>Finish the move-out</button></div>`);
  return out.length ? h`<div class="tn-alerts">${out}</div>` : '';
}

const telHref = p => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.length >= 5 ? 'tel:' + d : null; };
const mailHref = e => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(e || '').trim()) ? 'mailto:' + String(e).trim() : null);
function contactLine(value, kind) {
  const what = kind === 'phone' ? 'phone number' : 'email address';
  const href = kind === 'phone' ? telHref(value) : mailHref(value);
  return h`<div class="tn-cline"><span class="tn-cval">${value}</span><span class="tn-cbtns">
    <button type="button" class="btn" data-copy="${value}" data-copy-what="${what}">${ui.icon('copy')}<span>Copy</span></button>
    ${href ? h`<a class="btn" href="${href}">${ui.icon(kind === 'phone' ? 'phone' : 'mail')}<span>${kind === 'phone' ? 'Call' : 'Email'}</span></a>` : ''}</span></div>`;
}
const addBtn = (label, sec) => h`<button type="button" class="btn btn-ghost tn-addbtn" data-act="edit" data-sec="${sec}" data-write>${ui.icon('plus')}<span>${label}</span></button>`;

function contactPart(t) {
  const co = (t.coTenants || []).filter(c => c && (c.name || c.phone || c.email));
  const em = t.emergency || {};
  return h`<dl class="tn-facts">
    <div><dt>Phone</dt><dd>${t.phone ? contactLine(t.phone, 'phone') : addBtn('Add a phone number', 'contact')}</dd></div>
    <div><dt>Email</dt><dd>${t.email ? contactLine(t.email, 'email') : addBtn('Add an email address', 'contact')}</dd></div>
    ${co.length ? h`<div><dt>Also on the lease</dt><dd>${co.map(c => h`<div class="tn-person"><div class="tn-person-name">${c.name || 'Unnamed'}</div>${c.phone ? contactLine(c.phone, 'phone') : ''}${c.email ? contactLine(c.email, 'email') : ''}</div>`)}</dd></div>` : ''}
    ${em.name || em.phone ? h`<div><dt>In an emergency, call</dt><dd><div class="tn-person">${em.name ? h`<div class="tn-person-name">${em.name}</div>` : ''}${em.phone ? contactLine(em.phone, 'phone') : ''}</div></dd></div>` : ''}
  </dl>`;
}

function leasePart(t, lg, ls, settings, today) {
  const l = t.lease || {};
  const rows = [];
  const sched = (t.rent || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  const nowIdx = sched.reduce((acc, r, i) => (r.from <= today ? i : acc), 0);
  const curR = sched[nowIdx], prevR = sched[nowIdx - 1], next = sched.filter(r => r.from > today);
  rows.push(['Rent', h`<div class="tn-big">${ui.money(lg.rent)} a month</div>
    ${prevR && curR ? h`<div class="tn-sub">Since ${W.date(curR.from, today)}. It was ${W.$(prevR.amount)} before that.</div>` : ''}
    ${next.map(r => h`<div class="tn-sub tone-accent">Goes to ${W.$(r.amount)} on ${W.date(r.from, today)}.</div>`)}`]);
  const terms = RB.model.termsOf(t, settings);
  rows.push(['When rent is due', h`On the ${T.ordinal(terms.dueDay)} of each month. It counts as late after ${RB.plural(terms.graceDays, 'more day')}${l.dueDay != null || l.graceDays != null ? ' (special for this tenant)' : ''}.`]);
  const rec = (t.recurring || []).filter(r => r && r.amount && !(r.to && r.to < today));
  if (rec.length) rows.push(['Other monthly charges', h`${rec.map(r => h`<div>${r.label || 'Monthly charge'}: ${W.$(r.amount)} a month${r.from && r.from > today ? ' from ' + W.date(r.from, today) : r.to ? ' until ' + W.date(r.to, today) : ''}</div>`)}`]);
  // lease
  let lease;
  if (t.status === 'past') lease = h`Moved out ${W.date(l.moveOut, today)}. They had moved in ${W.date(l.moveIn || l.start, today)}.`;
  else if (ls.kind === 'mtm') lease = h`Month-to-month${ls.holdover ? h` since the lease ended ${W.date(l.end, today)}` : ''}. Moved in ${W.date(l.moveIn || l.start, today)}.`;
  else if (ls.kind === 'upcoming') lease = h`Moves in ${W.date(l.moveIn, today)}${l.end ? h`. The lease ends ${W.date(l.end, today)}` : ' (month-to-month)'}.`;
  else lease = h`Runs from ${W.date(l.start, today)} to ${W.date(l.end, today)} — ${ls.daysLeft === 0 ? 'ends today' : W.days(ls.daysLeft) + ' left'}. Moved in ${W.date(l.moveIn || l.start, today)}.`;
  rows.push(['Lease', h`${lease}${l.moveOut && t.status !== 'past' ? h`<div class="tn-sub tone-warn">Moving out ${W.date(l.moveOut, today)} — ${W.rel(l.moveOut, today)}.</div>` : ''}`]);
  // deposit
  const dep = t.deposit || {};
  if (+dep.amount > 0) {
    if (dep.returned) {
      const kept = (dep.returned.deductions || []).reduce((s, d) => s + (+d.amount || 0), 0);
      rows.push(['Deposit', h`${W.$(dep.amount)}. Sorted out on ${W.date(dep.returned.date, today)}: ${W.$(dep.returned.refund || 0)} given back${kept ? ', ' + W.$(kept) + ' kept' : ''}${dep.returned.applied ? ', ' + W.$(dep.returned.applied) + ' used for unpaid rent' : ''}.`]);
    } else rows.push(['Deposit', h`${W.$(dep.amount)}${dep.received ? ', paid ' + W.date(dep.received, today) : ''}${dep.heldAt ? h`, kept at ${dep.heldAt}` : ''}.`]);
  }
  const ins = t.insurance;
  if (ins && (ins.carrier || ins.policy || ins.expires)) rows.push(['Renter’s insurance', h`${ins.carrier || 'Insurer'}${ins.policy ? h`, policy ${ins.policy}` : ''}${ins.expires ? h`<div class="tn-sub ${ins.expires < today ? 'tone-bad' : D.diffDays(today, ins.expires) <= 30 ? 'tone-warn' : ''}">${ins.expires < today ? 'Ran out' : 'Runs out'} ${W.date(ins.expires, today)}</div>` : ''}`]);
  const links = (t.links || []).filter(x => x && RB.safeUrl(x.url));
  if (links.length) rows.push(['Documents', h`${links.map(x => h`<div><a class="tn-link" href="${RB.safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${x.label || x.url} ${ui.icon('external', { size: 14 })}</a></div>`)}`]);
  if (t.about) rows.push(['About them', h`<div class="prewrap">${t.about}</div>`]);
  const live = t.status !== 'past';
  return h`<dl class="tn-facts">${rows.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    <div class="tn-btnrow">
      ${live ? h`<button type="button" class="btn" data-act="rent" data-write>Raise or change the rent</button><button type="button" class="btn" data-act="renew" data-write>Renew the lease</button>` : ''}
      <button type="button" class="btn btn-ghost" data-act="edit" data-sec="lease" data-write>${ui.icon('edit')}<span>Change these details</span></button>
    </div>`;
}

// ---- payment history
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
  if (r.type === 'payment') { const k = kinds[r.id]; return (k === 'part' ? 'Part payment' : k === 'rest' ? 'Payment — the rest' : 'Payment') + (r.method ? ' (' + r.method + ')' : ''); }
  if (r.type === 'credit') return 'Money off' + (r.memo ? ': ' + r.memo : '');
  if (e.category === 'late_fee') return 'Late fee' + (r.period ? ' for ' + D.monthName(r.period) : '');
  return r.memo || 'Charge';
}
function rowSub(r, today) {
  const bits = [];
  if (r.void) bits.push('Removed — it was a mistake');
  if (r.prorate) bits.push(h`${r.prorate.days} of ${r.prorate.ofDays} days of ${W.$(r.prorate.full)}`);
  if (r.type === 'charge' && !r.void && r.amount > 0) {
    if (r.open === 0 && r.paidOn) bits.push(h`<span class="tone-ok">Paid ${W.date(r.paidOn, today)}</span>`);
    else if (r.open > 0 && r.paid > 0) bits.push(h`<span class="tone-warn">${W.$(r.paid)} paid so far, ${W.$(r.open)} still owed</span>`);
    else if (r.open > 0) bits.push(h`<span class="${r.date < today ? 'tone-bad' : ''}">Not paid yet</span>`);
  }
  if (r.kind === 'entry') {
    if (r.ref) bits.push(h`Reference ${r.ref}`);
    if (r.type === 'payment' && r.memo) bits.push(r.memo);
    if (r.type !== 'charge' && !r.void && r.unapplied > 0) bits.push(h`${W.$(r.unapplied)} paid ahead`);
  }
  return bits.length ? h`<span class="tn-l-sub">${RB.html.join(bits, ' · ')}</span>` : '';
}

function ledgerPart(t, lg, today, showAll) {
  const cutoff = D.monthStart(D.addMonthKey(D.monthKey(today), -11));
  const all = lg.rows.slice().reverse();
  const shown = showAll ? all : all.filter(r => r.date >= cutoff);
  const hidden = all.length - shown.length;
  const cells = RB.model.monthsBack(lg, D.monthKey(today), 12);
  const kinds = paymentKinds(lg.rows);
  const tools = h`<div class="tn-btnrow">
      <button type="button" class="btn" data-act="pay" data-write>${ui.icon('cash')}<span>Record a payment</span></button>
      <button type="button" class="btn" data-act="charge" data-write>${ui.icon('plus')}<span>Add a charge</span></button>
      <button type="button" class="btn btn-ghost" data-act="stmt">${ui.icon('copy')}<span>Copy a statement</span></button>
      <button type="button" class="btn btn-ghost" data-act="csv">${ui.icon('download')}<span>Download for Excel</span></button>
    </div>`;
  const strip = h`<figure class="tn-strip"><figcaption class="tn-strip-h">The last 12 months</figcaption>${ui.strip(cells, { lg: true, today })}<p class="tn-caption">${T.STRIP_CAPTION}</p></figure>`;
  if (!all.length) return h`${strip}${ui.empty({ quiet: true, title: 'Nothing here yet. Rent starts ' + W.date(lg.trackFrom, today) + '.' })}${tools}`;
  let last = null;
  const out = [];
  for (const r of shown) {
    const mk = D.monthKey(r.date);
    if (mk !== last) { out.push(h`<tr class="tn-l-month"><th colspan="6" scope="rowgroup">${D.fmtMonth(mk)}</th></tr>`); last = mk; }
    const stored = r.kind === 'entry';
    const what = rowWhat(r, kinds);
    out.push(h`<tr class="${r.void ? 'is-void' : ''}" data-row="${r.id}">
      <td class="tn-l-date">${W.date(r.date, today)}</td>
      <td class="tn-l-what"><span class="tn-l-text">${what}</span>${rowSub(r, today)}</td>
      <td class="tn-l-amt" data-label="Charged">${r.type === 'charge' ? ui.money(r.amount) : ''}</td>
      <td class="tn-l-amt tn-l-pay" data-label="Paid">${r.type !== 'charge' ? ui.money(r.amount) : ''}</td>
      <td class="tn-l-amt tn-l-bal" data-label="Still owed">${r.balance < 0 ? h`${ui.money(-r.balance)} ahead` : ui.money(r.balance)}</td>
      <td class="tn-l-act">${stored ? h`<button type="button" class="btn btn-ghost" data-act="lmenu" data-eid="${r.id}" aria-haspopup="menu" aria-label="More about: ${what}, ${W.date(r.date, today)}"><span>More</span></button>` : ''}</td></tr>`);
  }
  return h`${strip}${tools}
    <table class="tn-ledger" aria-describedby="tn-ledger-cap"><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" class="tn-l-amt">Charged</th><th scope="col" class="tn-l-amt">Paid</th><th scope="col" class="tn-l-amt">Still owed</th><th scope="col" class="tn-l-act"><span class="vh">More</span></th></tr></thead><tbody>${out}</tbody></table>
    <p class="tn-caption" id="tn-ledger-cap">Newest first. “Still owed” is what they owed after each line${lg.balance < 0 ? ' (“ahead” means they have paid more than was due)' : ''}.</p>
    ${hidden > 0 ? h`<div class="tn-more-rows"><button type="button" class="btn" data-act="earlier">${ui.icon('chevron-down')}<span>Show ${RB.plural(hidden, 'older line')}</span></button></div>`
      : showAll && all.some(r => r.date < cutoff) ? h`<div class="tn-more-rows"><button type="button" class="btn" data-act="earlier">${ui.icon('chevron-up')}<span>Show only the last 12 months</span></button></div>` : ''}`;
}

function timelinePart(logs, today) {
  if (!logs.length) return h`<p class="tn-caption">No notes yet. Write down calls, texts and visits here so you remember them.</p>`;
  return h`<ul class="tn-notes">${logs.map(e => {
    const day = localDay(e.at);
    const fu = e.followUp;
    const fuText = fu ? (e.done ? h`Followed up (was due ${W.date(fu, today)})` : fu < today ? h`<span class="tone-bad">Follow up was due ${W.date(fu, today)} — ${W.rel(fu, today, { style: 'late' })}</span>` : fu === today ? h`<span class="tone-warn">Follow up today</span>` : h`Follow up ${W.date(fu, today)} — ${W.rel(fu, today)}`) : null;
    return h`<li class="tn-note${e.done && fu ? ' is-done' : ''}" data-lid="${e.id}">
      <div class="tn-note-meta">${day ? W.date(day, today) : ''} · ${T.KIND_LABEL[e.kind] || 'Note'}</div>
      <div class="tn-note-text prewrap">${e.text}</div>
      ${fuText ? h`<div class="tn-note-fu">${ui.icon('calendar', { size: 16 })}<span>${fuText}</span></div>` : ''}
      <div class="tn-note-acts">${fu ? h`<label class="check tn-tick"><input type="checkbox" data-change="fudone" data-lid="${e.id}"${e.done ? RB.raw(' checked') : ''} data-write><span>Followed up</span></label>` : ''}
        <button type="button" class="btn btn-ghost" data-act="logmenu" data-lid="${e.id}" aria-haspopup="menu"><span>More</span></button></div>
    </li>`;
  })}</ul>`;
}

/** Repairs in this unit: provided by the Repairs view (RB.repairs.unitSection) when it exists. null = hide the section. */
function repairsPart(t) {
  const R = RB.repairs;
  if (!R || typeof R.unitSection !== 'function') return null;
  try {
    const out = R.unitSection(t);
    if (out == null || out === '') return null;
    if (RB.isSafe(out)) return out;
    if (out && out.nodeType === 1) return RB.raw(out.outerHTML);
    return R.unitSectionIsSafe ? RB.raw(String(out)) : h`${String(out)}`;
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
      body: h`<div class="tn-form">
        ${ui.field({ name: 'text', id: 'tn-note-text', label: 'What happened?', type: 'textarea', value: e ? e.text : '', required: true, requiredMsg: 'Write what happened first', rows: 4, placeholder: 'For example: Called about the late rent. She will pay on Friday.' })}
        ${T.pick({ name: 'kind', id: 'tn-note-kind', label: 'How?', value: e ? (e.kind === 'notice' ? 'note' : e.kind) : 'note', options: T.NOTE_KINDS })}
        ${ui.field({ name: 'followUp', id: 'tn-note-follow', label: 'Remind me to follow up on…', type: 'date', value: e ? e.followUp || '' : '', optional: true, hint: 'Leave this empty if you don’t need a reminder. On that day it shows on Today.' })}
      </div>`,
      initialFocus: '#tn-note-text',
      cancel: 'Close',
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
          ui.toast('Added a note for ' + t.name + (v.followUp ? '. You’ll be reminded on ' + W.date(v.followUp, today) + '.' : '.'), { undo: () => S().deleteLog(id, nid), duration: 10000 });
        }
      } }],
      onClose: () => resolve(saved),
    });
  });
};

// ------------------------------------------------------------------ entries: remove / put back
const entryWord = e => (e.type === 'payment' ? 'payment' : e.type === 'credit' ? 'money off' : e.category === 'late_fee' ? 'late fee' : 'charge');
T.removeEntry = function removeEntry(id, eid) {
  if (!T.guard()) return;
  const e = S().entries(id)[eid]; if (!e) return;
  S().voidEntry(id, eid).catch(() => {});
  ui.toast('Removed the ' + W.$(e.amount) + ' ' + entryWord(e) + ' from ' + W.date(e.date, S().today()) + '.', { undo: () => S().unvoidEntry(id, eid), duration: 10000 });
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
  if (p) items.push(['part', 'Record another part payment', 'They paid some more, but not all of it', () => A.recordPayment(id, { part: true })]);
  else if (lg.balance > 0) items.push(['payall', 'Record a payment', 'Someone paid you — write it down', () => A.recordPayment(id)]);
  items.push(['charge', 'Add a charge', 'A late fee, repair bill or utility', () => A.addCharge(id)]);
  items.push(['credit', 'Take money off what they owe', 'A discount, or money you are giving back', () => A.addCredit(id)]);
  if (live) {
    items.push(['rent', 'Raise or change the rent', 'Set a new monthly rent from a date you choose', () => A.changeRent(id)]);
    items.push(['renew', 'Renew the lease', 'Give the lease a new end date', () => A.renewLease(id)]);
    items.push(['moveout', t.status === 'notice' && l.moveOut && l.moveOut <= today ? 'Finish the move-out' : 'They are moving out', 'Set the date, see what they still owe, and sort out the deposit', () => A.moveOut(id)]);
  }
  if (t.deposit && +t.deposit.amount > 0 && !t.deposit.returned && l.moveOut && (t.status === 'past' || l.moveOut <= today)) items.push(['settle', 'Give back the deposit', 'Work out what to keep and what to give back', () => A.settleDeposit(id)]);
  items.push(['edit', 'Edit their details', 'Name, phone, unit, rent and more', () => A.editTenant(id)]);
  items.push(['delete', 'Remove this tenant', 'Only if they were added by mistake — this deletes all their history', () => T.deleteTenant(id)]);
  ui.sheet({
    title: 'What would you like to do?', sub: t.name + ' — ' + T.place(t), cancel: 'Close', actions: [],
    body: (el, sh) => {
      el.innerHTML = String(h`<div class="tn-morelist">${items.map(([k, label, sub]) => h`<button type="button" class="tn-moreitem${k === 'delete' ? ' is-danger' : ''}" data-more="${k}"${k === 'stmt' ? '' : RB.raw(' data-write')}><span class="tn-moreitem-l">${label}</span><span class="tn-moreitem-s">${sub}</span>${ui.icon('chevron-right')}</button>`)}</div>`);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-more]'); if (!b) return;
        const it = items.find(x => x[0] === b.dataset.more);
        sh.close();
        if (it) setTimeout(it[3], 0);
      });
    },
  });
};

function handlers(el, id) {
  const A = RB.actions;
  return {
    step: b => T.step(+b.dataset.d),
    pay: b => {
      const lg = S().ledger(id); const p = T.payLabel(lg, S().today());
      if (b.closest('.tn-dacts') && p.partial) A.recordPayment(id, { amount: p.amount });
      else A.recordPayment(id);
    },
    charge: () => A.addCharge(id),
    fee: () => A.addLateFee(id),
    settle: () => A.settleDeposit(id),
    moveout: () => A.moveOut(id),
    rent: () => A.changeRent(id),
    renew: () => A.renewLease(id),
    edit: b => A.editTenant(id, b.dataset.sec),
    stmt: () => A.copyStatement(id),
    csv: () => T.downloadHistory(id),
    more: () => T.moreSheet(id),
    note: () => T.noteSheet(id),
    earlier: () => { el._tnShowAll = !el._tnShowAll; renderDrawer(el, id); },
    fudone: b => { A.followupDone(id, b.dataset.lid, b.checked); },
    lmenu: b => {
      const e = S().entries(id)[b.dataset.eid];
      if (!e) return;
      const eid = b.dataset.eid;
      const w = entryWord(e);
      const items = [];
      if (e.void) items.push({ label: 'Put this ' + w + ' back', icon: 'undo', write: true, onSelect: () => T.putBack(id, eid) });
      else items.push({ label: 'Remove this ' + w + ' — it was a mistake', icon: 'x', write: true, onSelect: () => T.removeEntry(id, eid) });
      if (e.type === 'payment') items.push({ label: 'Copy a receipt', icon: 'copy', onSelect: () => A.copyReceipt(id, eid) });
      items.push({ label: 'Change the details', icon: 'edit', write: true, onSelect: () => A.editEntry(id, eid) });
      ui.menu(b, items, { align: 'end' });
    },
    logmenu: b => {
      const lid = b.dataset.lid;
      ui.menu(b, [
        { label: 'Change this note', icon: 'edit', write: true, onSelect: () => T.noteSheet(id, lid) },
        { label: 'Delete this note', icon: 'trash', danger: true, write: true, onSelect: () => {
          if (!T.guard()) return;
          const t = S().tenant(id); const prev = t && t.log && t.log[lid] ? RB.clone(t.log[lid]) : null;
          if (!prev) return;
          S().deleteLog(id, lid).catch(() => {});
          ui.toast('Deleted the note.', { undo: () => S().updateLog(id, lid, prev), duration: 10000 });
        } },
      ], { align: 'end' });
    },
  };
}
T.editNote = (id, lid) => T.noteSheet(id, lid);

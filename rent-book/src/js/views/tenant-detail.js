// views/tenant-detail.js — the #t-<id> tenant detail drawer (right drawer on desktop, full page on phone).
// Loaded before tenant-forms.js and tenants.js (name order); shares helpers with them through RB._tn.
// Re-render contract: the drawer is patched part by part (data-part), so a store change never resets the drawer's
// scroll position or the half-typed note in the composer (which is built once per tenant and never re-rendered).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});
const S = () => RB.store;

// ------------------------------------------------------------------ shared helpers (used by forms + list)
/** Same checks as the shared actions: read-only / still loading → toast, false. */
T.guard = function guard() {
  const st = S().state;
  if (st.readOnly) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return false; }
  if (!st.mode || !st.ready) { ui.toast('Still loading — try again in a moment.'); return false; }
  return true;
};
T.who = t => RB.actions.who(t);
T.order = [];   // tenant ids in the list's current order (set by tenants.js) — j/k stepping follows it
T.ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
/** "Owes $1,225" / "Paid up" / "$250 credit" (SafeHTML) */
T.balanceWords = function balanceWords(bal, opts) {
  const size = (opts && opts.size) || 'md';
  if (bal > 0) return h`<span class="tn-balw tn-balw-owed">Owes ${ui.money(bal, { size, tone: 'owed' })}</span>`;
  if (bal < 0) return h`<span class="tn-balw tn-balw-credit">${ui.money(-bal, { size })} credit</span>`;
  return h`<span class="tn-balw tn-balw-zero">${ui.icon('check', { size: 14 })}Paid up</span>`;
};
T.place = t => [t.property, t.unit ? (/^[A-Za-z]?\d+[A-Za-z]?$/.test(t.unit) || /^\d?[A-Za-z]$/.test(t.unit) ? 'Unit ' + t.unit : t.unit) : ''].filter(Boolean).join(' · ');
const localDay = iso => { const d = new Date(iso); return isNaN(d) ? null : D.make(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
T.localDay = localDay;
T.logList = t => Object.keys(t.log || {}).filter(k => t.log[k]).map(k => Object.assign({ id: k }, t.log[k])).sort((a, b) => D.cmp(b.at || '', a.at || ''));
T.KIND_ICON = { note: 'note', call: 'phone', text: 'mail', email: 'mail', visit: 'home', notice: 'door' };
T.KIND_LABEL = { note: 'Note', call: 'Call', text: 'Text', email: 'Email', visit: 'Visit', notice: 'Notice' };

/** Step to the previous/next tenant in the list's current order. */
T.step = function step(dir) {
  const id = RB.shell.current().param;
  if (!id) return;
  const list = T.order.includes(id) ? T.order : S().tenantsList().map(t => t.id);
  const n = list[list.indexOf(id) + dir];
  if (n) location.hash = 't-' + n;
};

// ------------------------------------------------------------------ drawer
/** Open (or switch) the drawer to tenant `id`. */
T.openDrawer = function openDrawer(id) {
  return ui.drawer({
    label: 'Tenant details',
    scrim: false,
    onClose: () => { if (/^#t-/.test(location.hash)) location.hash = 'tenants'; },
    render: el => renderDrawer(el, id),
  });
};

function renderDrawer(el, id) {
  const t = S().tenant(id);
  if (!t) {
    el.dataset.tid = '';
    el._tnParts = null;
    el.innerHTML = String(h`<div class="drawer-head tn-dhead"><div class="tn-dhead-bar"><button type="button" class="btn btn-ghost btn-sm tn-back show-phone" data-drawer-close>${ui.icon('chevron-left')}<span>Tenants</span></button><span class="spacer"></span><span class="hide-phone">${ui.drawerClose()}</span></div><h2 class="drawer-title">Tenant not found</h2></div>
      <div class="drawer-body">${ui.empty({ icon: 'user', title: 'No tenant at this link', body: 'They may have been deleted, or the link is from another rent book.', actions: [{ label: 'Back to tenants', kind: 'soft', act: 'back' }] })}</div>`);
    ui.bind(el, { back: () => { location.hash = 'tenants'; } });
    return;
  }
  if (el.dataset.tid !== id || !el._tnParts) {
    el.dataset.tid = id;
    el._tnParts = {};
    el._tnShowAll = false;
    el.innerHTML = String(h`<div class="drawer-head tn-dhead" data-part="head"></div>
      <div class="drawer-body tn-dbody" id="tn-dbody">
        <div data-part="alerts"></div>
        <section class="tn-dsec" aria-labelledby="tn-h-contact"><div class="sec"><h3 class="sec-title" id="tn-h-contact">Contact</h3><div class="sec-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-sec="contact" data-write>${ui.icon('edit')}<span>Edit</span></button></div></div><div data-part="contact"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-lease"><div data-part="leasehead"></div><div data-part="lease"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-ledger"><div data-part="ledgerhead"></div><div data-part="ledger"></div></section>
        <section class="tn-dsec" aria-labelledby="tn-h-notes"><div class="sec"><h3 class="sec-title" id="tn-h-notes">Notes &amp; timeline</h3><span class="sec-meta" data-part="notecount"></span></div>
          ${composer()}
          <div data-part="timeline"></div></section>
      </div>`);
    const ta = el.querySelector('#tn-note-text');
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitNote(el, id); } });
    ta.addEventListener('input', () => { const err = el.querySelector('#tn-note-text-err'); if (err) err.textContent = ''; });
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
  set('head', headPart(t, lg, ls, today));
  set('alerts', alertsPart(t, lg, settings, today));
  set('contact', contactPart(t));
  set('leasehead', h`<div class="sec"><h3 class="sec-title" id="tn-h-lease">Lease</h3><div class="sec-actions">${t.status !== 'past' ? h`<button type="button" class="btn btn-ghost btn-sm" data-act="rent" data-write>Change rent</button><button type="button" class="btn btn-ghost btn-sm" data-act="renew" data-write>Renew</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-sec="lease" data-write>${ui.icon('edit')}<span>Edit</span></button></div></div>`);
  set('lease', leasePart(t, lg, ls, settings, today));
  set('ledgerhead', ledgerHead(t, lg));
  set('ledger', ledgerPart(t, lg, today, el._tnShowAll));
  const logs = T.logList(t);
  set('notecount', logs.length ? String(logs.length) : '');
  set('timeline', timelinePart(logs, today));
  el.setAttribute('aria-labelledby', 'tn-dtitle');
  ui.bind(el, handlers(el, id));
}

function headPart(t, lg, ls, today) {
  const cur = lg.current;
  const pos = T.order.indexOf(t.id);
  const tags = [];
  if (t.status === 'past') tags.push(ui.tag('Moved out' + (ls.moveOut ? ' ' + D.fmt(ls.moveOut, today) : ''), 'quiet', 'door'));
  else if (t.status === 'notice') tags.push(ui.tag('Notice given' + (ls.moveOut ? ' · moves out ' + D.fmt(ls.moveOut, today) : ''), 'warn', 'door'));
  if (t.status !== 'past') {
    if (ls.kind === 'upcoming') tags.push(ui.tag(ls.label.replace(/^./, c => c.toUpperCase()), 'accent', 'calendar'));
    else if (ls.kind === 'mtm') tags.push(ui.tag(ls.holdover ? 'Month-to-month (lease ended ' + D.fmt(ls.end, today) + ')' : 'Month-to-month', 'quiet'));
    else if (ls.kind === 'fixed' && t.status !== 'notice') tags.push(ui.tag('Lease ends ' + D.fmt(ls.end, today) + ' · ' + ls.label, ls.inNoticeWindow ? 'warn' : 'quiet', 'leases'));
  }
  if (lg.delinquent) tags.push(ui.tag('Delinquent · since ' + D.fmt(lg.oldestOpenDate, today), 'bad', 'alert'));
  const month = cur.status === 'none' ? null
    : h`<span class="tn-dmonth"><span class="faint">${D.monthName(cur.period)}</span>${ui.pill(cur.status, { daysLate: cur.daysLate, label: cur.status === 'paid' || cur.status === 'paid_late' ? (cur.status === 'paid' ? 'Paid ' : 'Paid late ') + D.fmt(cur.paidOn, today) : cur.status === 'partial' ? M.fmt(cur.paid) + ' of ' + M.fmt(cur.charged) + ' paid' : cur.status === 'due' ? 'Due ' + D.fmt(cur.due, today) : null })}</span>`;
  return h`<div class="tn-dhead-bar">
      <button type="button" class="btn btn-ghost btn-sm tn-back show-phone" data-drawer-close>${ui.icon('chevron-left')}<span>Tenants</span></button>
      <span class="spacer"></span>
      ${pos >= 0 ? h`<span class="tn-pos faint hide-phone">${pos + 1} of ${T.order.length}</span>` : ''}
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="step" data-d="-1" aria-label="Previous tenant (k)" title="Previous tenant  k"${pos === 0 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-up')}</button>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="step" data-d="1" aria-label="Next tenant (j)" title="Next tenant  j"${pos >= 0 && pos === T.order.length - 1 ? RB.raw(' disabled') : ''}>${ui.icon('chevron-down')}</button>
      <span class="hide-phone">${ui.drawerClose()}</span>
    </div>
    <div class="tn-dident">
      ${ui.plate(t.unit, { size: 'lg', status: cur.status, title: T.place(t) })}
      <div class="grow">
        <h2 class="drawer-title" id="tn-dtitle">${t.name || 'Unnamed tenant'}</h2>
        <div class="tn-dplace">${T.place(t)}${(t.coTenants || []).filter(c => c && c.name).length ? h` <span class="faint">· with ${(t.coTenants || []).filter(c => c && c.name).map(c => c.name).join(', ')}</span>` : ''}</div>
      </div>
    </div>
    ${tags.length ? h`<div class="tn-dtags">${tags}</div>` : ''}
    <div class="tn-dstat">
      <div class="tn-dbal">${T.balanceWords(lg.balance)}${month}</div>
      <div class="tn-dacts">
        <button type="button" class="btn btn-primary" data-act="pay" data-write>${ui.icon('cash')}<span>Record payment</span></button>
        <button type="button" class="btn btn-icon" data-act="more" aria-label="More actions" aria-haspopup="menu" title="More actions">${ui.icon('more')}</button>
      </div>
    </div>`;
}

function alertsPart(t, lg, settings, today) {
  const out = [];
  const fee = lg.suggestedLateFee;
  if (fee && t.status !== 'past') {
    const m = lg.months[fee.period];
    out.push(h`<div class="tn-alert">${ui.icon('triangle', { size: 12, cls: 'tone-bad' })}<span class="grow">${D.monthName(fee.period)} rent is ${m ? m.daysLate : ''} d late and has no late fee.</span><button type="button" class="linkbtn" data-act="fee" data-write>Add late fee ${M.fmt(fee.amount)}</button></div>`);
  }
  const dd = RB.model.depositDue(t, settings, today);
  if (dd) out.push(h`<div class="tn-alert">${ui.icon('clock', { size: 14, cls: dd.overdue || dd.daysLeft <= 7 ? 'tone-bad' : 'tone-warn' })}<span class="grow">Deposit ${M.fmt(dd.amount)} due back ${dd.overdue ? h`<strong class="tone-bad">${-dd.daysLeft} d overdue</strong> (${D.fmt(dd.dueDate, today)})` : h`by ${D.fmt(dd.dueDate, today)} (${D.rel(dd.dueDate, today)})`}.</span><button type="button" class="linkbtn" data-act="settle" data-write>Settle deposit</button></div>`);
  const ls = RB.model.leaseState(t, settings, today);
  if (t.status === 'notice' && ls.moveOut && ls.moveOut <= today) out.push(h`<div class="tn-alert">${ui.icon('door', { size: 14, cls: 'tone-warn' })}<span class="grow">Move-out date ${D.fmt(ls.moveOut, today)} has passed.</span><button type="button" class="linkbtn" data-act="moveout" data-write>Finish move-out</button></div>`);
  return out.length ? h`<div class="tn-alerts">${out}</div>` : '';
}

const addBtn = (label, sec) => h`<button type="button" class="linkbtn linkbtn-muted tn-add" data-act="edit" data-sec="${sec}" data-write>${ui.icon('plus', { size: 14 })}${label}</button>`;
const telHref = p => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.length >= 5 ? 'tel:' + d : null; };
const mailHref = e => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(e || '').trim()) ? 'mailto:' + String(e).trim() : null);
const phoneLine = p => ui.copyline(p, 'phone number', telHref(p) ? { href: telHref(p), hrefLabel: 'Call', hrefIcon: 'phone' } : null);
const emailLine = e => ui.copyline(e, 'email address', mailHref(e) ? { href: mailHref(e), hrefLabel: 'Write an email', hrefIcon: 'mail' } : null);

function contactPart(t) {
  const co = (t.coTenants || []).filter(c => c && (c.name || c.phone || c.email));
  const em = t.emergency || {};
  return h`<dl class="kv tn-kv">
    <dt>Phone</dt><dd>${t.phone ? phoneLine(t.phone) : addBtn('Add phone', 'contact')}</dd>
    <dt>Email</dt><dd>${t.email ? emailLine(t.email) : addBtn('Add email', 'contact')}</dd>
    <dt>Co-tenants</dt><dd>${co.length ? h`<div class="stack stack-1">${co.map(c => h`<div class="tn-person"><span class="medium">${c.name || 'Unnamed'}</span>${c.phone ? h`<span class="tn-person-line">${phoneLine(c.phone)}</span>` : ''}${c.email ? h`<span class="tn-person-line">${emailLine(c.email)}</span>` : ''}</div>`)}</div>` : addBtn('Add co-tenant', 'cotenants')}</dd>
    <dt>Emergency</dt><dd>${em.name || em.phone ? h`<div class="tn-person">${em.name ? h`<span class="medium">${em.name}</span>` : ''}${em.phone ? h`<span class="tn-person-line">${phoneLine(em.phone)}</span>` : ''}</div>` : addBtn('Add emergency contact', 'emergency')}</dd>
  </dl>`;
}

function leasePart(t, lg, ls, settings, today) {
  const l = t.lease || {};
  const rows = [];
  // term
  let term;
  if (ls.kind === 'fixed' || (ls.kind === 'upcoming' && l.end)) {
    const pct = Math.round((ls.progress || 0) * 1000) / 10;
    term = h`<div>${D.fmt(l.start, today)} <span class="faint">→</span> ${D.fmt(l.end, today)}</div>
      <div class="bar bar-thin tn-term" role="img" aria-label="${Math.round(pct)}% through the lease term"><span class="bar-seg${ls.inNoticeWindow ? ' bar-seg-warn' : ''}" style="width:${pct}%"></span></div>
      <div class="tn-kv-sub">${ls.daysLeft === 0 ? 'Ends today' : ls.daysLeft + ' days left'}${ls.inNoticeWindow && !ls.noticeGiven ? h` · <span class="tone-warn">inside the ${settings.leaseNoticeDays}-day notice window</span>` : ''}</div>`;
  } else if (ls.kind === 'mtm' || (ls.kind === 'upcoming' && !l.end)) {
    term = h`<div>Month-to-month since ${D.fmt(ls.holdover ? D.addDays(l.end, 1) : l.start, today)}</div>${ls.holdover ? h`<div class="tn-kv-sub">Fixed term ${D.fmt(l.start, today)} → ${D.fmt(l.end, today)}</div>` : ''}`;
  } else {
    term = h`<div>${D.fmt(l.start, today)} <span class="faint">→</span> ${l.end ? D.fmt(l.end, today) : 'month-to-month'}</div>`;
  }
  rows.push(['Term', term]);
  // move in / notice / move out
  const dates = [h`Moved in ${D.fmt(l.moveIn, today) || '—'}`];
  if (l.noticeDate) dates.push(h`notice given ${D.fmt(l.noticeDate, today)}`);
  if (l.moveOut) dates.push(l.moveOut <= today || t.status === 'past' ? h`moved out ${D.fmt(l.moveOut, today)}` : h`<span class="tone-warn">moves out ${D.fmt(l.moveOut, today)} (${D.rel(l.moveOut, today)})</span>`);
  rows.push(['Dates', h`${RB.html.join(dates, ' · ')}`]);
  // rent with history
  const sched = (t.rent || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  const nowIdx = sched.reduce((acc, r, i) => (r.from <= today ? i : acc), 0);
  const curR = sched[nowIdx], prevR = sched[nowIdx - 1], next = sched.filter(r => r.from > today);
  let rent = h`<div><strong class="medium">${ui.money(lg.rent)}</strong>${prevR && curR ? h` <span class="muted">since ${D.fmt(curR.from, today)}</span> <span class="faint">· was ${M.fmt(prevR.amount)}</span>` : ''}</div>`;
  if (next.length) rent = h`${rent}<div class="tn-kv-sub tone-accent">${next.map(r => h`Changes to ${M.fmt(r.amount)} on ${D.fmt(r.from, today)}`)}</div>`;
  if (sched.length > 2) rent = h`${rent}<details class="tn-hist"><summary>All ${sched.length} rent amounts</summary><ul>${sched.slice().reverse().map(r => h`<li><span class="mono">${D.fmt(r.from, today)}</span><span class="spacer"></span>${ui.money(r.amount)}</li>`)}</ul></details>`;
  rows.push(['Rent', rent]);
  const rec = (t.recurring || []).filter(r => r && r.amount);
  rows.push(['Also monthly', rec.length ? h`<div class="stack stack-1">${rec.map(r => h`<div>${r.label || 'Recurring charge'} <span class="muted">${ui.money(r.amount)}/mo</span>${r.to && r.to < today ? h` <span class="faint">· ended ${D.fmt(r.to, today)}</span>` : r.from && r.from > today ? h` <span class="faint">· from ${D.fmt(r.from, today)}</span>` : r.to ? h` <span class="faint">· until ${D.fmt(r.to, today)}</span>` : ''}</div>`)}</div>` : addBtn('Add parking, pet rent…', 'recurring')]);
  const terms = RB.model.termsOf(t, settings);
  const custom = l.dueDay != null || l.graceDays != null;
  rows.push(['Due', h`${T.ordinal(terms.dueDay)} of the month · ${RB.plural(terms.graceDays, 'day')} grace${custom ? h` <span class="faint">(this tenant)</span>` : ''}`]);
  // deposit
  const dep = t.deposit || {};
  let depo;
  if (!(+dep.amount > 0)) depo = addBtn('Add deposit', 'deposit');
  else if (dep.returned) {
    const kept = (dep.returned.deductions || []).reduce((s, d) => s + (+d.amount || 0), 0);
    depo = h`<div>${ui.money(dep.amount)} <span class="muted">settled ${D.fmt(dep.returned.date, today)}</span></div><div class="tn-kv-sub">${M.fmt(dep.returned.refund || 0)} refunded${kept ? ' · ' + M.fmt(kept) + ' deducted' : ''}${dep.returned.applied ? ' · ' + M.fmt(dep.returned.applied) + ' applied to balance' : ''}</div>`;
  } else {
    const dd = RB.model.depositDue(t, settings, today);
    depo = h`<div>${ui.money(dep.amount)}${dep.received ? h` <span class="muted">received ${D.fmt(dep.received, today)}</span>` : ''}${dep.heldAt ? h` <span class="faint">· held at ${dep.heldAt}</span>` : ''}</div>${dd ? h`<div class="tn-kv-sub ${dd.overdue ? 'tone-bad' : 'tone-warn'}">Return by ${D.fmt(dd.dueDate, today)} — ${dd.overdue ? -dd.daysLeft + ' d overdue' : D.rel(dd.dueDate, today)} <button type="button" class="linkbtn" data-act="settle" data-write>Settle deposit</button></div>` : ''}`;
  }
  rows.push(['Deposit', depo]);
  rows.push(['Tracked from', h`${D.fmt(lg.trackFrom, today)}${t.opening && +t.opening.amount ? h` <span class="muted">· ${M.fmt(Math.abs(t.opening.amount))} ${t.opening.amount > 0 ? 'brought forward' : 'credit brought forward'}</span>` : ''}`]);
  const ins = t.insurance;
  rows.push(['Insurance', ins && (ins.carrier || ins.policy || ins.expires) ? h`<div>${ins.carrier || 'Insurer'}${ins.policy ? h` <span class="muted mono">${ins.policy}</span>` : ''}</div>${ins.expires ? h`<div class="tn-kv-sub ${ins.expires < today ? 'tone-bad' : D.diffDays(today, ins.expires) <= 30 ? 'tone-warn' : ''}">${ins.expires < today ? 'Expired' : 'Expires'} ${D.fmt(ins.expires, today)}</div>` : ''}` : addBtn('Add renter’s insurance', 'insurance')]);
  const links = (t.links || []).filter(x => x && RB.safeUrl(x.url));
  rows.push(['Links', links.length ? h`<div class="stack stack-1">${links.map(x => h`<a class="tn-link" href="${RB.safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${ui.icon('link', { size: 14 })}<span class="truncate">${x.label || x.url}</span>${ui.icon('external', { size: 12 })}</a>`)}</div>` : addBtn('Add a link to the lease', 'links')]);
  rows.push(['About', t.about ? h`<div class="prewrap">${t.about}</div>` : addBtn('Add pets, vehicles, quirks…', 'about')]);
  return h`<dl class="kv tn-kv">${rows.map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

function ledgerHead(t, lg) {
  return h`<div class="sec"><h3 class="sec-title" id="tn-h-ledger">Ledger</h3><span class="sec-meta">${lg.balance > 0 ? h`<span class="tone-bad">${M.fmt(lg.balance)} owed</span>` : lg.balance < 0 ? M.fmt(-lg.balance) + ' credit' : 'Paid up'}</span></div>
    <div class="tn-ltools">
      <button type="button" class="btn btn-sm btn-soft" data-act="pay" data-write>${ui.icon('cash')}<span>Record payment</span></button>
      <button type="button" class="btn btn-sm" data-act="charge" data-write>${ui.icon('plus')}<span>Add charge</span></button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-act="stmt">${ui.icon('copy')}<span>Copy statement</span></button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="csv" title="Download CSV">${ui.icon('download')}<span>CSV</span></button>
    </div>`;
}

function rowSub(r, today) {
  const bits = [];
  if (r.void) bits.push('Voided');
  if (r.prorate) bits.push(h`${r.prorate.days} of ${r.prorate.ofDays} days × ${M.fmt(r.prorate.full)}`);
  if (r.kind === 'opening') bits.push('Owed before tracking began');
  if (r.type === 'charge' && !r.void && r.amount > 0) {
    if (r.open === 0 && r.paidOn && r.paidOn !== r.date) bits.push(h`<span class="tn-paidon">${ui.icon('check', { size: 12 })}paid ${D.fmt(r.paidOn, today)}</span>`);
    else if (r.open > 0 && r.paid > 0) bits.push(h`<span class="tone-warn">${M.fmt(r.open)} still open</span>`);
    else if (r.open > 0 && r.date < today && r.kind !== 'opening') bits.push(h`<span class="tone-bad">unpaid</span>`);
  }
  if (r.kind === 'entry') {
    if (r.ref) bits.push(h`<span class="mono">Ref ${r.ref}</span>`);
    if (r.type === 'payment' && r.memo) bits.push(r.memo);
    if (r.type === 'charge' && r.category && r.memo && !String(r.memo).toLowerCase().startsWith(String(RB.model.CATEGORY_LABEL[r.category] || '~').toLowerCase())) bits.push(RB.model.CATEGORY_LABEL[r.category] || '');
    if (r.type !== 'charge' && !r.void && r.unapplied > 0) bits.push(h`${M.fmt(r.unapplied)} to credit`);
  }
  const b = bits.filter(Boolean);
  return b.length ? h`<span class="l-sub">${RB.html.join(b, ' · ')}</span>` : '';
}

function ledgerPart(t, lg, today, showAll) {
  const cutoff = D.monthStart(D.addMonthKey(D.monthKey(today), -11));
  const all = lg.rows.slice().reverse();
  const shown = showAll ? all : all.filter(r => r.date >= cutoff);
  const hidden = all.length - shown.length;
  if (!all.length) return ui.empty({ quiet: true, title: 'No charges yet — rent starts ' + D.fmt(lg.trackFrom, today) + '.' });
  let last = null;
  const out = [];
  for (const r of shown) {
    const mk = D.monthKey(r.date);
    if (mk !== last) { out.push(h`<tr class="ledger-month"><td colspan="6">${D.fmtMonth(mk)}</td></tr>`); last = mk; }
    const stored = r.kind === 'entry';
    out.push(h`<tr class="${r.void ? 'is-void' : ''}" data-row="${r.id}"><td class="l-date">${D.fmtNum(r.date, { mon: true })}</td><td class="l-desc"><span class="l-desc-text">${r.label}</span>${rowSub(r, today)}</td><td class="l-amt">${r.type === 'charge' ? ui.money(r.amount) : ''}</td><td class="l-amt l-pay">${r.type !== 'charge' ? ui.money(r.amount) : ''}</td><td class="l-bal"><span class="tn-bal-lbl">bal </span>${ui.money(r.balance)}</td><td class="l-act">${stored ? h`<button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="lmenu" data-eid="${r.id}" aria-label="Actions for ${r.label} ${D.fmt(r.date, today)}" aria-haspopup="menu">${ui.icon('more')}</button>` : ''}</td></tr>`);
  }
  return h`<table class="ledger tn-ledger"><thead><tr><th>Date</th><th>Description</th><th class="l-amt">Charge</th><th class="l-amt">Payment</th><th class="l-bal">Balance</th><th class="l-act"><span class="vh">Actions</span></th></tr></thead><tbody>${out}</tbody></table>
    ${hidden > 0 ? h`<div class="tn-more-rows"><button type="button" class="btn btn-sm btn-ghost" data-act="earlier">${ui.icon('chevron-down')}<span>Show ${RB.plural(hidden, 'earlier entry', 'earlier entries')}</span></button></div>`
      : showAll && all.some(r => r.date < cutoff) ? h`<div class="tn-more-rows"><button type="button" class="btn btn-sm btn-ghost" data-act="earlier">${ui.icon('chevron-up')}<span>Show the last 12 months only</span></button></div>` : ''}`;
}

function composer() {
  const kinds = RB.actions.LOG_KINDS || [];
  return h`<form class="tn-composer" id="tn-note-form" data-submit="note" novalidate autocomplete="off" data-write>
    <label class="vh" for="tn-note-text">Add a note</label>
    <textarea class="input textarea tn-note-text" id="tn-note-text" name="text" rows="2" placeholder="Add a note — a call, a text, a visit…" aria-describedby="tn-note-text-err"></textarea>
    <div class="field-error" id="tn-note-text-err" aria-live="polite"></div>
    <div class="tn-composer-row">
      <input type="hidden" id="tn-note-kind" name="kind" value="note" data-kind="seg">
      <div class="seg" role="radiogroup" aria-label="Kind of note" data-seg-for="tn-note-kind">${kinds.map(k => h`<button type="button" role="radio" data-value="${k.value}" aria-checked="${k.value === 'note'}" aria-pressed="${k.value === 'note'}">${k.label}</button>`)}</div>
      <label class="tn-follow"><span class="faint">${ui.icon('calendar', { size: 14 })}</span><span class="vh">Follow up on</span><input class="input" type="date" id="tn-note-follow" name="followUp" data-kind="date" title="Follow up on (optional)"></label>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-sm btn-primary">Add note</button>
    </div>
  </form>`;
}

function timelinePart(logs, today) {
  if (!logs.length) return ui.empty({ quiet: true, title: 'No notes yet. Calls, texts and visits you log here show up newest first.' });
  return h`<div class="tl tn-tl">${logs.map(e => {
    const day = localDay(e.at);
    const when = day ? (day.slice(0, 4) === today.slice(0, 4) ? D.fmtNum(day, { mon: true }) : D.MON[+day.slice(5, 7) - 1] + ' ’' + day.slice(2, 4)) : '';
    const fu = e.followUp;
    const fuText = fu ? (e.done ? h`Follow-up done · was due ${D.fmt(fu, today)}` : fu < today ? h`<span class="tone-bad">Follow up ${D.fmt(fu, today)} · ${D.rel(fu, today, { style: 'late' })}</span>` : fu === today ? h`<span class="tone-warn">Follow up today</span>` : h`Follow up ${D.fmt(fu, today)} · ${D.rel(fu, today)}`) : null;
    return h`<div class="tl-item${e.done && fu ? ' is-done' : ''}" data-lid="${e.id}">
      <span class="tl-when" title="${day ? D.fmtLong(day) : ''}">${when}</span>
      <div class="tl-body"><span class="tn-kind">${ui.icon(T.KIND_ICON[e.kind] || 'note', { size: 12 })}${T.KIND_LABEL[e.kind] || 'Note'}</span><span class="prewrap">${e.text}</span>${fuText ? h`<div class="tl-meta">${ui.icon('calendar', { size: 12 })}${fuText}</div>` : ''}</div>
      <div class="tn-tl-act">${fu ? h`<label class="tn-tick" title="${e.done ? 'Reopen follow-up' : 'Mark follow-up done'}"><input type="checkbox" data-change="fudone" data-lid="${e.id}"${e.done ? RB.raw(' checked') : ''} data-write><span class="vh">Follow-up done</span></label>` : ''}<button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="logmenu" data-lid="${e.id}" aria-label="Actions for this note" aria-haspopup="menu">${ui.icon('more')}</button></div>
    </div>`;
  })}</div>`;
}

function submitNote(el, id) {
  if (!T.guard()) return;
  const form = el.querySelector('#tn-note-form');
  const ta = form.querySelector('#tn-note-text');
  const text = ta.value.trim();
  const err = form.querySelector('#tn-note-text-err');
  if (!text) { err.textContent = 'Write what happened first.'; ta.focus(); return; }
  const fu = form.querySelector('#tn-note-follow').value || null;
  if (fu && !D.valid(fu)) { err.textContent = 'That follow-up date isn’t valid — pick one from the calendar.'; return; }
  const kind = form.querySelector('#tn-note-kind').value || 'note';
  const lid = RB.id();
  S().addLog(id, { id: lid, kind, text, followUp: fu, done: false }).catch(() => {});
  ta.value = ''; form.querySelector('#tn-note-follow').value = ''; err.textContent = '';
  ui.setValue(form, 'kind', 'note');
  ui.toast(fu ? 'Note added · follow up ' + D.fmt(fu, S().today()) : 'Note added', { undo: () => S().deleteLog(id, lid) });
}

function handlers(el, id) {
  const A = RB.actions;
  return {
    step: b => T.step(+b.dataset.d),
    pay: () => A.recordPayment(id),
    charge: () => A.addCharge(id),
    fee: () => A.addLateFee(id),
    settle: () => A.settleDeposit(id),
    moveout: () => A.moveOut(id),
    rent: () => A.changeRent(id),
    renew: () => A.renewLease(id),
    edit: b => A.editTenant(id, b.dataset.sec),
    stmt: () => A.copyStatement(id),
    csv: () => A.downloadLedgerCsv(id),
    more: b => T.overflowMenu(b, id),
    earlier: () => { el._tnShowAll = !el._tnShowAll; renderDrawer(el, id); },
    note: () => submitNote(el, id),
    fudone: b => { const done = b.checked; A.followupDone(id, b.dataset.lid, done); },
    lmenu: b => {
      const e = S().entries(id)[b.dataset.eid];
      if (!e) return;
      const eid = b.dataset.eid;
      const items = [{ label: 'Edit', icon: 'edit', write: true, onSelect: () => A.editEntry(id, eid) }];
      if (e.void) items.push({ label: 'Restore', icon: 'undo', write: true, onSelect: () => { if (!T.guard()) return; S().unvoidEntry(id, eid).catch(() => {}); ui.toast('Restored ' + M.fmt(e.amount) + ' ' + (e.type === 'charge' ? 'charge' : e.type), { undo: () => S().voidEntry(id, eid) }); } });
      else items.push({ label: 'Void', icon: 'x', write: true, onSelect: () => A.voidEntry(id, eid) });
      if (e.type !== 'charge') items.push({ sep: true }, { label: e.type === 'payment' ? 'Copy receipt' : 'Copy credit note', icon: 'copy', onSelect: () => A.copyReceipt(id, eid) });
      ui.menu(b, items, { align: 'end' });
    },
    logmenu: b => {
      const lid = b.dataset.lid;
      ui.menu(b, [
        { label: 'Edit note', icon: 'edit', write: true, onSelect: () => T.editNote(id, lid) },
        { label: 'Delete note', icon: 'trash', danger: true, write: true, onSelect: () => {
          if (!T.guard()) return;
          const t = S().tenant(id); const prev = t && t.log && t.log[lid] ? RB.clone(t.log[lid]) : null;
          if (!prev) return;
          S().deleteLog(id, lid).catch(() => {});
          ui.toast('Note deleted', { undo: () => S().updateLog(id, lid, prev) });
        } },
      ], { align: 'end' });
    },
  };
}

/** The header's overflow menu. */
T.overflowMenu = function overflowMenu(anchor, id) {
  const A = RB.actions;
  const t = S().tenant(id); if (!t) return;
  const items = [
    { label: 'Add charge', icon: 'plus', write: true, onSelect: () => A.addCharge(id) },
    { label: 'Add credit', icon: 'undo', write: true, onSelect: () => A.addCredit(id) },
    { label: 'Add note', icon: 'note', write: true, onSelect: () => { const ta = document.getElementById('tn-note-text'); if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); } else A.addNote(id); } },
    { sep: true },
    { label: 'Edit details', icon: 'edit', hint: 'e', write: true, onSelect: () => A.editTenant(id) },
  ];
  if (t.status !== 'past') {
    items.push(
      { label: 'Change rent', icon: 'cash', write: true, onSelect: () => A.changeRent(id) },
      { label: 'Renew lease', icon: 'leases', write: true, onSelect: () => A.renewLease(id) });
    if (t.status !== 'notice') items.push({ label: 'Give notice', icon: 'calendar', write: true, onSelect: () => A.giveNotice(id) });
    items.push({ label: 'Move out', icon: 'door', write: true, onSelect: () => A.moveOut(id) });
  }
  if (t.deposit && +t.deposit.amount > 0 && !t.deposit.returned && t.lease && t.lease.moveOut) items.push({ label: 'Settle deposit', icon: 'key', write: true, onSelect: () => A.settleDeposit(id) });
  items.push({ sep: true }, { label: 'Delete tenant', icon: 'trash', danger: true, write: true, onSelect: () => T.deleteTenant(id) });
  ui.menu(anchor, items, { align: 'end' });
};

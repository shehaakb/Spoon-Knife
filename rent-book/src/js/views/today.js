// views/today.js — Today: start from the task (three big buttons), then this month's rent as a sentence,
// "What needs you" in plain sentences, the month at a glance, and recent activity in sentences. SPEC §4 + §8.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

const SHOW = 5;                 // rows per group before "Show n more"
const expanded = {};            // group key → true when the user asked to see every row

const GROUPS = [
  { key: 'rent', label: 'Rent', kinds: ['delinquent', 'late', 'partial'] },
  { key: 'repairs', label: 'Repairs', kinds: ['ticket'] },
  { key: 'leases', label: 'Leases and moving', kinds: ['lease', 'moveout', 'movein', 'deposit'] },
  { key: 'follow', label: 'Reminders', kinds: ['followup', 'insurance'] },
];
const SEV = { high: { icon: 'triangle', label: 'Needs you now' }, medium: { icon: 'alert', label: 'Soon' }, low: { icon: 'circle', label: 'When you can' } };
const METHOD_WORD = { Check: 'check', Cash: 'cash', Zelle: 'Zelle', Venmo: 'Venmo', ACH: 'bank transfer', 'Money order': 'money order' };
const KIND_WORD = { note: 'wrote a note about', call: 'phoned', text: 'texted', email: 'emailed', visit: 'visited', notice: 'gave notice to' };
const byWord = m => (m ? ' by ' + (METHOD_WORD[m] || m) : '');

// ------------------------------------------------------------------ (0) start from the task
const TASKS = [
  { id: 'pay', icon: 'cash', label: 'Record a rent payment', help: 'Someone paid you — write it down' },
  { id: 'repair', icon: 'wrench', label: 'Log a repair', help: 'Something needs fixing — make a note of it' },
  { id: 'tenant', icon: 'user', label: 'Add a tenant', help: 'Someone new is moving in' },
];
function tasks() {
  return h`<section class="td-tasks" aria-label="What would you like to do?">
    ${TASKS.map(t => h`<button type="button" class="td-task" id="td-task-${t.id}" data-act="task" data-task="${t.id}" data-write>
      <span class="td-task-ico">${ui.icon(t.icon, { size: 22 })}</span>
      <span class="td-task-text"><span class="td-task-label">${t.label}</span><span class="td-task-help">${t.help}</span></span>
      ${ui.icon('chevron-right', { cls: 'td-task-chev' })}
    </button>`)}
  </section>`;
}
async function runTask(id) {
  const A = RB.actions;
  if (id === 'pay') {
    const tid = await ui.pickTenant({ title: 'Who paid you?', prefer: 'owes' });
    if (tid) A.recordPayment(tid);
  } else if (id === 'repair') {
    const tid = await ui.pickTenant({ title: 'Where is the repair?', sub: 'Choose the tenant whose home it is in.', skip: 'It’s for a whole building, or I’m not sure' });
    if (tid === null) return;
    A.addTicket(tid ? { tenantId: tid } : undefined);
  } else if (id === 'tenant') A.addTenant();
}

// ------------------------------------------------------------------ (1) this month's rent, as a sentence
function monthParts(S, period) {
  const sums = { partial: 0, late: 0, due: 0, owe: 0 };
  for (const t of S.tenantsList()) {
    const m = (S.ledger(t.id) || { months: {} }).months[period];
    if (!m || !m.scheduled || !m.open) continue;
    sums.owe++;
    if (m.rentPaid > 0) sums.partial += m.open;
    else if (m.status === 'late') sums.late += m.open;
    else sums.due += m.open;
  }
  return sums;
}
function collection(S, today) {
  const p = S.portfolio();
  const parts = monthParts(S, p.period);
  const mon = D.monthName(p.period);
  const pct = v => (p.charged ? Math.max(0, Math.min(100, (v / p.charged) * 100)) : 0);
  const owe = parts.owe;
  const sentence = h`<strong>${M.fmt(p.collected)}</strong> of ${M.fmt(p.charged)} collected for ${mon}. ${owe ? h`<strong>${RB.plural(owe, 'tenant')}</strong> still ${owe === 1 ? 'owes' : 'owe'}.` : 'Everyone has paid.'}`;
  const grace = today <= p.graceEnd
    ? h`Rent was due ${D.fmt(p.dueDate, today)}. Anyone who hasn’t paid by ${D.fmt(p.graceEnd, today)} will be late — that’s ${D.rel(p.graceEnd, today)}.`
    : h`Rent was due ${D.fmt(p.dueDate, today)}. Since ${D.fmt(D.addDays(p.graceEnd, 1), today)}, anything unpaid counts as late.`;
  const key = (cls, label, cents) => (cents ? h`<span class="bar-key bar-key-${cls}">${label}: ${M.fmt(cents)}</span>` : '');
  return h`<section class="td-collect" aria-labelledby="td-collect-t">
    <h2 class="sec-title" id="td-collect-t">${D.fmtMonth(p.period)} rent</h2>
    <p class="td-say" id="td-say">${sentence}</p>
    <div class="bar bar-lg td-bar" aria-hidden="true">
      <span class="bar-seg bar-seg-ok" style="width:${pct(p.collected)}%"></span>
      <span class="bar-seg bar-seg-warn" style="width:${pct(parts.partial)}%"></span>
      <span class="bar-seg bar-seg-bad" style="width:${pct(parts.late)}%"></span>
    </div>
    <div class="bar-legend td-legend">${key('ok', 'Collected', p.collected)}${key('warn', 'Part paid — still owed', parts.partial)}${key('bad', 'Late', parts.late)}${key('soft', 'Not paid yet', parts.due)}</div>
    <p class="caption td-grace">${grace}</p>
    <a class="btn btn-lg td-collect-go" href="#rent" id="td-go-rent">${owe ? 'See who still owes' : 'Open the Rent page'}${ui.icon('arrow-right')}</a>
  </section>`;
}

// ------------------------------------------------------------------ (2) what needs you
/** One plain sentence per item, built from the data (not the model's terse detail line). */
function sentence(S, a, today) {
  const t = a.tenantId ? S.tenant(a.tenantId) : null;
  const name = t ? t.name : a.title;
  const lg = t ? S.ledger(t.id) : null;
  switch (a.kind) {
    case 'delinquent': {
      const n = Object.values(lg.months).filter(m => m.open > 0).length;
      return h`${name} is behind on rent: owes <strong>${M.fmt(lg.balance)}</strong> from ${RB.plural(n, 'month')}. The oldest is from ${D.fmt(lg.oldestOpenDate, today)}.`;
    }
    case 'late': {
      const m = lg.current.status === 'late' ? lg.months[lg.current.period] : Object.values(lg.months).filter(x => x.status === 'late').pop();
      if (m.rentPaid > 0) return h`${name} has paid ${M.fmt(m.rentPaid)} of ${M.fmt(m.rentCharged)} for ${D.monthName(m.period)}. Still owes <strong>${M.fmt(m.open)}</strong>, ${D.days(m.daysLate)} late.`;
      return h`${name} hasn’t paid ${D.monthName(m.period)} rent (<strong>${M.fmt(m.open)}</strong>). It is ${D.days(m.daysLate)} late.`;
    }
    case 'partial': {
      const m = lg.months[lg.current.period];
      return h`${name} has paid ${M.fmt(m.rentPaid)} of ${M.fmt(m.rentCharged)} for ${D.monthName(m.period)}. Still owes <strong>${M.fmt(m.open)}</strong> — it becomes late after ${D.fmt(m.graceEnd, today)}.`;
    }
    case 'ticket': {
      const k = S.ticket(a.ticketId) || {};
      const where = k.unit ? (k.property ? k.property + ', ' : '') + RB.actions.who({ unit: k.unit }) : k.property || 'the building';
      const age = k.reported ? D.diffDays(k.reported, today) : 0;
      const when = k.status === 'scheduled' && k.scheduled ? 'Booked for ' + D.fmt(k.scheduled, today) + '.' : age > 0 ? 'Reported ' + D.days(age) + ' ago.' : 'Reported today.';
      return h`${k.priority === 'urgent' ? 'Urgent repair: ' : 'Repair: '}${(k.title || 'repair').replace(/^\w/, c => c.toLowerCase())} at ${where}. ${when}`;
    }
    case 'lease': {
      const ls = RB.model.leaseState(t, S.settings(), today);
      return h`${name}’s lease ends ${D.fmt(ls.end, today)} (${D.rel(ls.end, today)}). You haven’t decided yet whether to renew.`;
    }
    case 'moveout': {
      const mo = t.lease && t.lease.moveOut;
      return mo <= today ? h`${name} was due to move out ${mo === today ? 'today' : 'on ' + D.fmt(mo, today)}. Finish the move-out when they have gone.` : h`${name} moves out ${D.fmt(mo, today)} (${D.rel(mo, today)}).`;
    }
    case 'movein': return h`${name} moves in ${D.fmt(t.lease.moveIn, today)} (${D.rel(t.lease.moveIn, today)}).`;
    case 'deposit': {
      const dd = RB.model.depositDue(t, S.settings(), today);
      if (!dd) return a.detail;
      return dd.overdue ? h`${name}’s deposit of <strong>${M.fmt(dd.amount)}</strong> should have gone back by ${D.fmt(dd.dueDate, today)} — ${D.days(-dd.daysLeft)} ago.` : h`Give back ${name}’s deposit of <strong>${M.fmt(dd.amount)}</strong> by ${D.fmt(dd.dueDate, today)} (${D.rel(dd.dueDate, today)}).`;
    }
    case 'followup': {
      const e = t && t.log && t.log[a.logId];
      return h`Reminder about ${name}: “${String((e && e.text) || '').slice(0, 140)}”${e && e.followUp < today ? h` — due since ${D.fmt(e.followUp, today)}` : ''}.`;
    }
    case 'insurance': {
      const ex = t.insurance && t.insurance.expires;
      return ex < today ? h`${name}’s renter’s insurance ran out on ${D.fmt(ex, today)}. Ask them for the new policy.` : h`${name}’s renter’s insurance runs out ${D.fmt(ex, today)} (${D.rel(ex, today)}).`;
    }
    default: return h`${a.title}: ${a.detail}`;
  }
}
const BUTTON_WORDS = { recordPayment: 'Record a payment', addLateFee: null, openTenant: 'See their page', openTicket: 'Open the repair', followupDone: 'Mark it done', settleDeposit: 'Give back the deposit', renewLease: 'Renew or end the lease', moveOut: 'Finish the move-out' };
const PLAN = { moveout: 'Plan the move-out', movein: 'See their page', insurance: 'See their page' };
function buttonLabel(a) {
  if (a.action.type === 'addLateFee') return a.action.label;
  return (a.action.type === 'openTenant' && PLAN[a.kind]) || BUTTON_WORDS[a.action.type] || a.action.label;
}
function plateFor(S, a) {
  if (a.ticketId) { const k = S.ticket(a.ticketId); return k && k.unit ? ui.plate(k.unit, { property: k.property }) : h`<span class="td-lead-ico">${ui.icon('wrench')}</span>`; }
  const t = a.tenantId && S.tenant(a.tenantId);
  return t ? ui.plate(t.unit, { property: t.property }) : h`<span class="td-lead-ico">${ui.icon('dot')}</span>`;
}
const writeAct = t => !['openTenant', 'openTicket', 'renewLease', 'settleDeposit'].includes(t);
function attRow(S, a, today) {
  const sev = SEV[a.severity] || SEV.low;
  const isPay = a.action.type === 'recordPayment';
  const t = a.tenantId ? S.tenant(a.tenantId) : null;
  const lg = t ? S.ledger(t.id) : null;
  const partLate = isPay && lg && Object.values(lg.months).some(m => m.status === 'late' && m.rentPaid > 0);
  return h`<li class="td-row" data-item="${a.id}">
    <span class="td-lead">${plateFor(S, a)}</span>
    <div class="td-main">
      <p class="td-sentence"><span class="td-sev td-sev-${a.severity}">${ui.icon(sev.icon, { size: 14 })}<span class="vh">${sev.label}: </span></span>${sentence(S, a, today)}</p>
      <div class="td-actions">
        <button type="button" class="btn ${isPay ? 'btn-primary' : 'btn-soft'}" id="td-1-${a.id}" data-act="run" data-which="action" data-id="${a.id}"${writeAct(a.action.type) ? RB.raw(' data-write') : ''}>${buttonLabel(a)}</button>
        ${isPay && !partLate ? h`<button type="button" class="btn-link" id="td-part-${a.id}" data-act="part" data-id="${a.id}" data-write>They paid part of it</button>` : ''}
        ${a.secondary ? h`<button type="button" class="btn-link" id="td-2-${a.id}" data-act="run" data-which="secondary" data-id="${a.id}"${writeAct(a.secondary.type) ? RB.raw(' data-write') : ''}>${a.secondary.type === 'openTenant' ? 'See their page' : a.secondary.label}</button>` : ''}
      </div>
    </div>
  </li>`;
}
function attention(S, att, today) {
  if (!att.length) return h`<div class="sec"><h2 class="sec-title">What needs you</h2></div>${ui.empty({ quiet: true, title: 'Nothing needs you today. Enjoy your day.' })}`;
  const known = new Set(GROUPS.flatMap(g => g.kinds));
  const groups = GROUPS.map(g => ({ g, items: att.filter(a => g.kinds.includes(a.kind) || (g.key === 'follow' && !known.has(a.kind))) })).filter(x => x.items.length);
  return h`<div class="sec"><h2 class="sec-title" id="td-att-t">What needs you</h2><span class="sec-meta">${RB.plural(att.length, 'thing')}, most important first</span></div>
    ${groups.map(({ g, items }) => {
      const open = expanded[g.key] || items.length <= SHOW;
      const shown = open ? items : items.slice(0, SHOW);
      return h`<section class="td-group" aria-labelledby="td-g-${g.key}">
        <h3 class="td-group-label" id="td-g-${g.key}">${g.label} <span class="td-group-n">(${items.length})</span></h3>
        <ul class="td-rows">${shown.map(a => attRow(S, a, today))}</ul>
        ${items.length > SHOW ? h`<button type="button" class="btn td-more" id="td-more-${g.key}" data-act="more" data-g="${g.key}" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Show fewer' : 'Show ' + (items.length - SHOW) + ' more'}</button>` : ''}
      </section>`;
    })}`;
}

// ------------------------------------------------------------------ (3) the month at a glance
function glance(S, today) {
  const period = D.monthKey(today);
  const byProp = new Map();
  for (const t of S.tenantsList({ includePast: false })) {
    const m = (S.ledger(t.id) || { months: {} }).months[period];
    const st = m && m.scheduled ? (m.status === 'late' && m.rentPaid > 0 ? 'partial' : m.status) : 'none';
    if (!byProp.has(t.property)) byProp.set(t.property, []);
    byProp.get(t.property).push({ t, st, m });
  }
  const keys = [['paid', 'Green with a tick = paid'], ['partial', 'Amber = paid part of it'], ['late', 'Red = late'], ['due', 'White = not paid yet']];
  return h`<section class="td-glance" aria-labelledby="td-glance-t">
    <div class="sec"><h2 class="sec-title" id="td-glance-t">${D.monthName(period)} at a glance</h2></div>
    <p class="caption td-glance-cap">Each box is one home, labelled with its unit. Tap a box to see that tenant.</p>
    ${Array.from(byProp.entries()).map(([prop, list]) => h`<div class="td-prop">
      <h3 class="td-prop-label">${prop || 'No property'}</h3>
      <div class="plates td-plates">${list.map(({ t, st, m }) => {
        const label = (t.unit || '—') + ', ' + t.name + ': ' + ui.statusWords(m, today);
        return ui.plate(t.unit, { size: 'lg', status: st, button: true, title: label, attrs: { 'data-act': 'open', 'data-id': t.id, id: 'td-p-' + t.id, 'aria-label': label } });
      })}</div>
    </div>`)}
    <ul class="td-keys" aria-label="What the colours mean">${keys.map(([k, words]) => h`<li class="td-keyitem"><span class="td-keyplate" aria-hidden="true">${ui.plate('', { size: 'lg', status: k })}</span><span>${words}</span></li>`)}</ul>
  </section>`;
}

// ------------------------------------------------------------------ (4) recent activity, in sentences
function events(S, today) {
  const out = [];
  for (const t of S.tenantsList()) {
    const ents = S.entries(t.id) || {};
    for (const id of Object.keys(ents)) {
      const e = ents[id];
      if (!e || e.undone) continue;
      const on = ' on ' + D.fmt(e.date, today);
      let text;
      if (e.type === 'payment') text = h`${t.name} paid <strong>${M.fmt(e.amount)}</strong>${byWord(e.method)}${on}`;
      else if (e.type === 'credit') text = h`You took ${M.fmt(e.amount)} off what ${t.name} owes${e.memo ? h` (${e.memo})` : ''}${on}`;
      else text = e.category === 'late_fee' ? h`You added a ${M.fmt(e.amount)} late fee for ${t.name}${on}` : h`You added a ${M.fmt(e.amount)} charge for ${t.name}${e.memo ? h` (${e.memo})` : ''}${on}`;
      if (e.void) text = h`${text} — removed as a mistake`;
      out.push({ id: 'e-' + id, at: e.createdAt || e.date, t, text, void: !!e.void });
    }
    const log = t.log || {};
    for (const id of Object.keys(log)) {
      const l = log[id];
      if (!l || !l.at) continue;
      const d = String(l.at).slice(0, 10);
      out.push({ id: 'l-' + id, at: l.at, t, quote: true, text: h`You ${KIND_WORD[l.kind] || 'wrote a note about'} ${t.name} on ${D.fmt(d, today)}: “${String(l.text || '').slice(0, 90)}${String(l.text || '').length > 90 ? '…' : ''}”` });
    }
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, 8);
}
function activity(S, today) {
  const list = events(S, today);
  return h`<section class="td-activity" aria-labelledby="td-act-t">
    <div class="sec"><h2 class="sec-title" id="td-act-t">What happened lately</h2></div>
    ${list.length ? h`<ul class="td-events">${list.map(ev => h`<li><button type="button" class="td-ev${ev.void ? ' is-void' : ''}" id="td-ev-${ev.id}" data-act="open" data-id="${ev.t.id}">
      ${ui.plate(ev.t.unit)}<span class="td-ev-text">${ev.text}${ev.quote ? '' : '.'}</span>${ui.icon('chevron-right', { cls: 'td-ev-chev' })}
    </button></li>`)}</ul>` : ui.empty({ quiet: true, title: 'Nothing yet. Payments and notes you record will show here.' })}
  </section>`;
}

RB.views.register('today', {
  title: 'Today',
  render(el, ctx) {
    const S = ctx.store;
    const att = S.attention();
    const byId = new Map(att.map(a => [a.id, a]));
    el.innerHTML = String(h`<div class="td">
      ${tasks()}
      ${collection(S, ctx.today)}
      <div class="td-attention">${attention(S, att, ctx.today)}</div>
      ${glance(S, ctx.today)}
      ${activity(S, ctx.today)}
    </div>`);
    ui.bind(el, {
      task: b => runTask(b.dataset.task),
      run: b => { const a = byId.get(b.dataset.id); if (a) RB.actions.run(a[b.dataset.which]); },
      part: b => { const a = byId.get(b.dataset.id); if (a && a.tenantId) RB.actions.recordPayment(a.tenantId, { part: true }); },
      more: b => { expanded[b.dataset.g] = !expanded[b.dataset.g]; RB.shell.refresh(); },
      open: b => RB.actions.openTenant(b.dataset.id),
    });
  },
});

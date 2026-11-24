// views/today.js — Today (SPEC §10.3): (1) this month's rent as one figure + one sentence + a bar (opens Rent),
// (2) one filled action and two outline ones, (3) "Needs you": the five most important things as rows, then
// "Show all N" expanding in place grouped by kind, (4) a quiet link to "See what you did recently" (a page-like sheet).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

const TOP = 5;                  // rows shown before "Show all N"
let showAll = false;            // "Show all N" expanded in place

const GROUPS = [
  { key: 'rent', label: 'Rent', kinds: ['delinquent', 'late', 'partial'] },
  { key: 'repairs', label: 'Repairs', kinds: ['ticket'] },
  { key: 'leases', label: 'Leases and moving', kinds: ['lease', 'moveout', 'movein', 'deposit'] },
  { key: 'follow', label: 'Reminders', kinds: ['followup', 'insurance'] },
];
const RENT_KINDS = ['delinquent', 'late', 'partial'];
const METHOD_WORD = { Check: 'check', Cash: 'cash', Zelle: 'Zelle', Venmo: 'Venmo', ACH: 'bank transfer', 'Money order': 'money order' };
const KIND_WORD = { note: 'Note', call: 'Phone call', text: 'Text message', email: 'Email', visit: 'Visit', notice: 'Notice' };
const cap = s => String(s || '').replace(/^\w/, c => c.toUpperCase());

// ------------------------------------------------------------------ (1) this month's rent
function money(S, today) {
  const p = S.portfolio();
  const pct = p.charged ? Math.max(0, Math.min(100, (p.collected / p.charged) * 100)) : 0;
  return h`<a class="td-money" href="#rent" id="td-money" aria-describedby="td-owed">
    <span class="td-money-label">${D.monthName(p.period)} rent<span class="td-money-go">See who still owes${ui.icon('chevron-right')}</span></span>
    <span class="td-fig"><span class="td-figure t-display" id="td-figure">${M.fmt(p.collected)}</span> <span class="td-of" id="td-say">of ${M.fmt(p.charged)} has come in.</span></span>
    <span class="bar td-bar" role="img" aria-label="${Math.round(pct)}% of ${D.monthName(p.period)} rent has come in"><span class="bar-seg" style="width:${pct.toFixed(2)}%"></span></span>
    <span class="td-owed" id="td-owed">${ui.owedSentence()}</span>
  </a>`;
}

// ------------------------------------------------------------------ (2) actions: one filled, two outline
function actions() {
  return h`<div class="td-actions" role="group" aria-label="What would you like to do?">
    <button type="button" class="btn btn-primary btn-lg td-act-pay" id="td-task-pay" data-act="task" data-task="pay" data-write>${ui.icon('cash')}Record a rent payment</button>
    <div class="td-actions-2">
      <button type="button" class="btn btn-outline btn-lg" id="td-task-repair" data-act="task" data-task="repair" data-write>Log a repair</button>
      <button type="button" class="btn btn-outline btn-lg" id="td-task-tenant" data-act="task" data-task="tenant" data-write>Add a tenant</button>
    </div>
  </div>`;
}
async function runTask(id) {
  const A = RB.actions;
  if (id === 'pay') {
    const tid = await ui.pickTenant({ title: 'Who paid you?', prefer: 'owes', purpose: 'pay' });
    if (tid) A.recordPayment(tid);
  } else if (id === 'repair') {
    const tid = await ui.pickTenant({ title: 'Where is the repair?', sub: 'Choose the tenant whose home it is in.', purpose: 'repair', skip: 'It’s for a whole building, or I’m not sure' });
    if (tid === null) return;
    A.addTicket(tid ? { tenantId: tid } : undefined);
  } else if (id === 'tenant') A.addTenant();
}

// ------------------------------------------------------------------ (3) needs you
/** Row content for one attention item: {title, sub, status, lead}. Short, plain, one fact per line. */
function itemRow(S, a, today) {
  const t = a.tenantId ? S.tenant(a.tenantId) : null;
  const lg = t ? S.ledger(t.id) : null;
  const lead = a.ticketId
    ? (() => { const k = S.ticket(a.ticketId); return k && k.unit ? ui.plate(k.unit, { property: k.property }) : h`<span class="td-lead-ico">${ui.icon('wrench')}</span>`; })()
    : t ? ui.plate(t.unit, { property: t.property }) : '';
  const name = t ? t.name : a.title;
  switch (a.kind) {
    case 'delinquent': {
      const n = Object.values(lg.months).filter(m => m.open > 0).length;
      return { lead, title: name, sub: 'Owes ' + M.fmt(lg.balance) + ' from ' + RB.plural(n, 'month'), status: ui.status('late', 'Behind on rent') };
    }
    case 'late': {
      const m = lg.current.status === 'late' ? lg.months[lg.current.period] : Object.values(lg.months).filter(x => x.status === 'late').pop();
      return { lead, title: name, sub: m.rentPaid > 0 ? 'Owes ' + M.fmt(m.open) + ' of ' + D.monthName(m.period) + '’s ' + M.fmt(m.rentCharged) : 'Owes ' + M.fmt(m.open) + ' for ' + D.monthName(m.period),
        status: m.rentPaid > 0 ? ui.status('partial_late', 'Part paid — rest is ' + D.days(m.daysLate) + ' late') : ui.status('late', 'Late — ' + D.days(m.daysLate)) };
    }
    case 'partial': {
      const m = lg.months[lg.current.period];
      return { lead, title: name, sub: 'Owes ' + M.fmt(m.open) + ' for ' + D.monthName(m.period), status: ui.status('partial', 'Part paid — ' + M.fmt(m.rentPaid) + ' of ' + M.fmt(m.rentCharged)) };
    }
    case 'ticket': {
      const k = S.ticket(a.ticketId) || {};
      const where = k.unit ? ui.place(k) : k.property || 'The whole building';
      const age = k.reported ? D.diffDays(k.reported, today) : 0;
      const when = k.status === 'scheduled' && k.scheduled ? 'booked for ' + D.fmt(k.scheduled, today) : age > 0 ? 'waiting ' + D.days(age) : 'reported today';
      return { lead, title: cap(k.title || 'Repair'), sub: where + ' · ' + when, status: k.priority === 'urgent' ? ui.status('urgent', 'Urgent') : '' };
    }
    case 'lease': {
      const ls = RB.model.leaseState(t, S.settings(), today);
      return { lead, title: name, sub: 'Lease ends ' + D.fmt(ls.end, today) + ' — renew or not?', status: ui.status('warn', cap(D.rel(ls.end, today))) };
    }
    case 'moveout': {
      const mo = t.lease && t.lease.moveOut;
      return mo <= today
        ? { lead, title: name, sub: 'Was due to move out ' + (mo === today ? 'today' : D.fmt(mo, today)), status: ui.status('warn', 'Finish the move-out') }
        : { lead, title: name, sub: 'Moves out ' + D.fmt(mo, today), status: ui.status('warn', cap(D.rel(mo, today))) };
    }
    case 'movein': return { lead, title: name, sub: 'Moves in ' + D.fmt(t.lease.moveIn, today), status: ui.status('info', cap(D.rel(t.lease.moveIn, today))) };
    case 'deposit': {
      const dd = RB.model.depositDue(t, S.settings(), today);
      if (!dd) return { lead, title: name, sub: a.detail };
      return { lead, title: name, sub: 'Give back the ' + M.fmt(dd.amount) + ' deposit by ' + D.fmt(dd.dueDate, today),
        status: dd.overdue ? ui.status('late', 'Overdue — ' + D.days(-dd.daysLeft)) : ui.status(dd.daysLeft <= 7 ? 'late' : 'warn', cap(D.rel(dd.dueDate, today))) };
    }
    case 'followup': {
      const e = t && t.log && t.log[a.logId];
      const text = String((e && e.text) || '');
      return { lead, title: name, sub: 'Reminder: “' + (text.length > 90 ? text.slice(0, 88) + '…' : text) + '”',
        status: ui.status('warn', e && e.followUp < today ? 'Due since ' + D.fmt(e.followUp, today) : 'Due today') };
    }
    case 'insurance': {
      const ex = t.insurance && t.insurance.expires;
      return { lead, title: name, sub: 'Renter’s insurance ' + (ex < today ? 'ran out ' : 'runs out ') + D.fmt(ex, today), status: ui.status(ex < today ? 'warn' : 'quiet', ex < today ? 'Ask for the new policy' : cap(D.rel(ex, today))) };
    }
    default: return { lead, title: a.title, sub: a.detail };
  }
}
function attRow(S, a, today) {
  const r = itemRow(S, a, today);
  const pay = RENT_KINDS.includes(a.kind) && a.tenantId;
  const lg = pay ? S.ledger(a.tenantId) : null;
  const cur = pay ? lg.months[lg.current.period] : null;
  const partPaid = pay && a.kind !== 'delinquent' && cur && cur.open > 0 && cur.rentPaid > 0;
  if (pay) { r.amt = M.fmt(lg.balance); r.sub = ''; }
  return ui.row(Object.assign(r, {
    act: 'item', attrs: { id: 'td-row-' + a.id, 'data-id': a.id, 'aria-haspopup': pay || a.kind === 'followup' ? 'dialog' : null },
    statusPos: 'main',
    btn: pay ? { label: partPaid ? 'Record the rest' : 'Record a payment', act: 'pay', id: 'td-pay-' + a.id, attrs: { 'data-id': a.id } } : null,
    liAttrs: { 'data-item': a.id },
  }));
}
function needsYou(S, att, today) {
  if (!att.length) return h`<section class="td-needs" aria-labelledby="td-needs-t"><h2 class="sec-title" id="td-needs-t">Needs you</h2>${ui.empty({ quiet: true, title: 'Nothing needs you today.' })}</section>`;
  const more = att.length > TOP;
  let body;
  if (showAll && more) {
    const known = new Set(GROUPS.flatMap(g => g.kinds));
    body = GROUPS.map(g => ({ g, items: att.filter(a => g.kinds.includes(a.kind) || (g.key === 'follow' && !known.has(a.kind))) })).filter(x => x.items.length)
      .map(({ g, items }) => h`${ui.rowsHead(g.label, items.length, { id: 'td-g-' + g.key })}<ul class="rows rows-inset td-rows" aria-labelledby="td-g-${g.key}">${items.map(a => attRow(S, a, today))}</ul>`);
  } else body = h`<ul class="rows rows-inset td-rows" aria-labelledby="td-needs-t">${att.slice(0, TOP).map(a => attRow(S, a, today))}</ul>`;
  return h`<section class="td-needs" aria-labelledby="td-needs-t">
    <h2 class="sec-title td-needs-t" id="td-needs-t">Needs you <span class="rows-count">${att.length}</span></h2>
    ${body}
    ${more ? ui.rowsMore(att.length, { id: 'td-more', act: 'more', expanded: showAll }) : ''}
  </section>`;
}
/** Tapping a row opens the thing, or a short "What would you like to do?" sheet. */
function openItem(S, a) {
  const A = RB.actions;
  const t = a.tenantId ? S.tenant(a.tenantId) : null;
  if (RENT_KINDS.includes(a.kind) && t) {
    const lg = S.ledger(t.id);
    const fee = lg.suggestedLateFee;
    return ui.choices({ title: t.name, sub: ui.place(t) + ' · ' + ui.balanceWords(lg.balance), items: [
      { label: 'They paid part of it', hint: 'Type the amount you got', run: () => A.recordPayment(t.id, { part: true }), write: true, id: 'td-c-part' },
      fee ? { label: 'Add a ' + M.fmt(fee.amount) + ' late fee', hint: 'For ' + D.monthName(fee.period), run: () => A.addLateFee(t.id, fee.period), write: true, id: 'td-c-fee' } : null,
      { label: 'See their page', hint: 'Payment history, notes and lease', run: () => A.openTenant(t.id), id: 'td-c-open' },
    ] });
  }
  if (a.kind === 'followup' && t) {
    return ui.choices({ title: 'Reminder about ' + t.name, items: [
      { label: 'Mark it done', run: () => A.run(a.action), write: true, id: 'td-c-done' },
      { label: 'See their page', run: () => A.openTenant(t.id), id: 'td-c-open' },
    ] });
  }
  return A.run(a.action);
}

// ------------------------------------------------------------------ (4) what you did recently (page-like sheet)
function events(S, today) {
  const out = [];
  for (const t of S.tenantsList()) {
    const ents = S.entries(t.id) || {};
    for (const id of Object.keys(ents)) {
      const e = ents[id];
      if (!e || e.undone) continue;
      let sub;
      if (e.type === 'payment') sub = 'Paid ' + M.fmt(e.amount) + (e.method ? ' by ' + (METHOD_WORD[e.method] || e.method) : '');
      else if (e.type === 'credit') sub = 'You took ' + M.fmt(e.amount) + ' off' + (e.memo ? ' (' + e.memo + ')' : '');
      else sub = e.category === 'late_fee' ? 'You added a ' + M.fmt(e.amount) + ' late fee' : 'You added a ' + M.fmt(e.amount) + ' charge' + (e.memo ? ' (' + e.memo + ')' : '');
      out.push({ id: 'e-' + id, at: e.createdAt || e.date, date: e.date, t, sub: sub + (e.void ? ' — removed as a mistake' : '') });
    }
    const log = t.log || {};
    for (const id of Object.keys(log)) {
      const l = log[id];
      if (!l || !l.at) continue;
      const text = String(l.text || '');
      out.push({ id: 'l-' + id, at: l.at, date: String(l.at).slice(0, 10), t, sub: (KIND_WORD[l.kind] || 'Note') + ': “' + (text.length > 80 ? text.slice(0, 78) + '…' : text) + '”' });
    }
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, 20);
}
function recentSheet(S, today) {
  const list = events(S, today);
  const days = [];
  for (const ev of list) { const last = days[days.length - 1]; if (last && last.date === ev.date) last.items.push(ev); else days.push({ date: ev.date, items: [ev] }); }
  ui.sheet({
    title: 'What you did recently', page: true, cancel: false, actions: [{ id: 'close', label: 'Close', kind: '' }],
    body: (el, sh) => {
      el.innerHTML = String(list.length ? h`${days.map(d => h`<div class="recent-day">${ui.rowsHead(ui.dateWords(d.date, today))}<ul class="rows rows-inset">${d.items.map(ev => ui.row({
        lead: ui.plate(ev.t.unit, { property: ev.t.property }), title: ev.t.name, sub: ev.sub, act: 'open', attrs: { id: 'td-ev-' + ev.id, 'data-id': ev.t.id } }))}</ul></div>`)}`
        : ui.empty({ quiet: true, title: 'Nothing yet. Payments and notes you record will show here.' }));
      el.addEventListener('click', e => { const b = e.target.closest('[data-act="open"]'); if (!b) return; sh.close(); RB.actions.openTenant(b.dataset.id); });
    },
  });
}

RB.views.register('today', {
  title: 'Today',
  render(el, ctx) {
    const S = ctx.store;
    const att = S.attention();
    const byId = new Map(att.map(a => [a.id, a]));
    el.innerHTML = String(h`<div class="td">
      <div class="td-main">${money(S, ctx.today)}${actions()}</div>
      <div class="td-side">${needsYou(S, att, ctx.today)}
        <p class="td-recent"><button type="button" class="btn-link" id="td-recent" data-act="recent" aria-haspopup="dialog">See what you did recently${ui.icon('chevron-right')}</button></p>
      </div>
    </div>`);
    ui.bind(el, {
      task: b => runTask(b.dataset.task),
      item: b => { const a = byId.get(b.dataset.id); if (a) openItem(S, a); },
      pay: b => { const a = byId.get(b.dataset.id); if (a && a.tenantId) RB.actions.recordPayment(a.tenantId); },
      more: () => { showAll = !showAll; RB.shell.refresh(); const m = document.getElementById('td-more'); if (m) m.focus({ preventScroll: true }); },
      recent: () => recentSheet(S, ctx.today),
    });
  },
  destroy() { showAll = false; },
});

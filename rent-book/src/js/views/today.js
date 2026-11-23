// views/today.js — Today: this month's collection, needs attention, the month at a glance, recent activity.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

const SHOW = 6;                 // rows per attention group before "Show n more"
const expanded = {};            // group key → true when the user asked to see every row

const GROUPS = [
  { key: 'rent', label: 'Rent', kinds: ['delinquent', 'late', 'partial'] },
  { key: 'upkeep', label: 'Upkeep', kinds: ['ticket'] },
  { key: 'leases', label: 'Leases & move-outs', kinds: ['lease', 'moveout', 'movein', 'deposit'] },
  { key: 'follow', label: 'Follow-ups', kinds: ['followup', 'insurance'] },
];
const SEV = {
  high: { icon: 'triangle', label: 'Urgent' },
  medium: { icon: 'alert', label: 'Soon' },
  low: { icon: 'circle', label: 'When you can' },
};
const KIND_WORD = { note: 'Note', call: 'Call', text: 'Text', email: 'Email', visit: 'Visit', notice: 'Notice' };

/** Plain words for a month status, for accessible labels: "22 days late", "paid Nov 3". */
function statusWords(m, today) {
  if (!m || !m.scheduled) return 'no charge this month';
  switch (m.status) {
    case 'paid': return 'paid' + (m.paidOn ? ' ' + D.fmt(m.paidOn, today) : '');
    case 'paid_late': return 'paid late, ' + D.fmt(m.paidOn, today);
    case 'partial': return 'partly paid, ' + M.fmt(m.rentOpen) + ' open';
    case 'due': return 'due ' + D.fmt(m.due, today);
    case 'late': return RB.plural(m.daysLate, 'day') + ' late';
    default: return 'no charge this month';
  }
}

// ------------------------------------------------------------------ (1) collection header
function collection(S, today) {
  const p = S.portfolio();
  const open = { partial: 0, late: 0, due: 0 };
  for (const t of S.tenantsList()) {
    const m = (S.ledger(t.id) || { months: {} }).months[p.period];
    if (!m || !m.scheduled || !m.open) continue;
    open[m.status === 'late' ? 'late' : m.status === 'partial' ? 'partial' : 'due'] += m.open;
  }
  const pct = v => (p.charged ? Math.max(0, Math.min(100, (v / p.charged) * 100)) : 0);
  const graceTxt = today <= p.graceEnd
    ? h`Grace ends ${D.fmt(p.graceEnd, today)} · ${D.rel(p.graceEnd, today)}`
    : h`Grace ended ${D.fmt(p.graceEnd, today)} — unpaid rent is now late`;
  const key = (cls, label, cents) => (cents ? h`<span class="bar-key bar-key-${cls}">${label} <span class="td-key-amt">${M.fmt(cents)}</span></span>` : '');
  return h`<a class="td-collect" href="#rent" aria-label="${D.fmtMonth(p.period)}: ${M.fmt(p.collected)} of ${M.fmt(p.charged)} collected, ${p.paidCount} of ${p.tenants} paid. Open Rent.">
    <div class="td-collect-top">
      <span class="micro">${D.fmtMonth(p.period)} rent</span>
      <span class="td-collect-go">Open Rent ${ui.icon('chevron-right', { size: 14 })}</span>
    </div>
    <div class="td-collect-sum">${ui.money(p.collected, { size: 'lg' })}<span class="td-collect-of">of ${ui.money(p.charged)} collected</span></div>
    <div class="bar bar-lg td-bar" aria-hidden="true">
      <span class="bar-seg bar-seg-ok" style="width:${pct(p.collected)}%"></span>
      <span class="bar-seg bar-seg-warn" style="width:${pct(open.partial)}%"></span>
      <span class="bar-seg bar-seg-bad" style="width:${pct(open.late)}%"></span>
    </div>
    <div class="bar-legend td-legend">${key('ok', 'Collected', p.collected)}${key('warn', 'Partly paid, still open', open.partial)}${key('bad', 'Late', open.late)}${key('soft', 'Not due yet', open.due)}</div>
    <div class="td-collect-meta"><span><strong>${p.paidCount}</strong> of ${p.tenants} paid</span><span class="td-dotsep" aria-hidden="true">·</span><span>${graceTxt}</span></div>
  </a>`;
}

// ------------------------------------------------------------------ (2) needs attention
function plateFor(S, a) {
  if (a.ticketId) { const k = S.ticket(a.ticketId); return k && k.unit ? ui.plate(k.unit, { property: k.property }) : h`<span class="td-lead-ico">${ui.icon('wrench')}</span>`; }
  const t = a.tenantId && S.tenant(a.tenantId);
  return t ? ui.plate(t.unit, { property: t.property }) : h`<span class="td-lead-ico">${ui.icon('dot')}</span>`;
}
function attRow(S, a) {
  const sev = SEV[a.severity] || SEV.low;
  const primaryKind = a.action.type === 'recordPayment' ? 'btn-soft' : '';
  const writeAct = t => !['openTenant', 'openTicket', 'renewLease', 'settleDeposit'].includes(t);
  return h`<div class="lrow td-row" data-item="${a.id}">
    <span class="lrow-lead">${plateFor(S, a)}</span>
    <div class="td-main">
      <div class="lrow-title"><span class="td-sev td-sev-${a.severity}">${ui.icon(sev.icon, { size: 12, label: sev.label })}</span><button type="button" class="td-subject" id="td-s-${a.id}" data-act="subject" data-id="${a.id}">${a.title}</button></div>
      <div class="lrow-detail">${a.detail}</div>
    </div>
    <div class="lrow-actions">
      ${a.secondary ? h`<button type="button" class="linkbtn linkbtn-muted td-second" id="td-2-${a.id}" data-act="run" data-which="secondary" data-id="${a.id}"${writeAct(a.secondary.type) ? RB.raw(' data-write') : ''}>${a.secondary.label}</button>` : ''}
      <button type="button" class="btn btn-sm ${primaryKind}" id="td-1-${a.id}" data-act="run" data-which="action" data-id="${a.id}"${writeAct(a.action.type) ? RB.raw(' data-write') : ''}>${a.action.label}</button>
    </div>
  </div>`;
}
function attention(S, att) {
  if (!att.length) return h`<div class="sec"><h2 class="sec-title">Needs attention</h2></div>${ui.empty({ quiet: true, title: 'Nothing needs you today.' })}`;
  const known = new Set(GROUPS.flatMap(g => g.kinds));
  const groups = GROUPS.map(g => ({ g, items: att.filter(a => g.kinds.includes(a.kind) || (g.key === 'follow' && !known.has(a.kind))) })).filter(x => x.items.length);
  return h`<div class="sec"><h2 class="sec-title">Needs attention</h2><span class="sec-meta">${att.length}</span></div>
    ${groups.map(({ g, items }) => {
      const open = expanded[g.key] || items.length <= SHOW;
      const shown = open ? items : items.slice(0, SHOW);
      return h`<section class="td-group" aria-labelledby="td-g-${g.key}">
        <h3 class="td-group-label" id="td-g-${g.key}">${g.label}<span class="td-group-n">${items.length}</span></h3>
        <div class="td-rows">${shown.map(a => attRow(S, a))}</div>
        ${items.length > SHOW ? h`<button type="button" class="linkbtn td-more" id="td-more-${g.key}" data-act="more" data-g="${g.key}" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Show fewer' : 'Show ' + (items.length - SHOW) + ' more'}</button>` : ''}
      </section>`;
    })}`;
}

// ------------------------------------------------------------------ (3) the month at a glance
function glance(S, today) {
  const period = D.monthKey(today);
  const byProp = new Map();
  const counts = { paid: 0, paid_late: 0, partial: 0, due: 0, late: 0 };
  for (const t of S.tenantsList({ includePast: false })) {
    const m = (S.ledger(t.id) || { months: {} }).months[period];
    const st = m && m.scheduled ? m.status : 'none';
    if (counts[st] !== undefined) counts[st]++;
    if (!byProp.has(t.property)) byProp.set(t.property, []);
    byProp.get(t.property).push({ t, st, m });
  }
  const keys = ['paid', 'paid_late', 'partial', 'due', 'late'];
  return h`<section class="td-glance" aria-labelledby="td-glance-t">
    <div class="sec"><h2 class="sec-title" id="td-glance-t">The month at a glance</h2></div>
    ${Array.from(byProp.entries()).map(([prop, list]) => h`<div class="td-prop">
      <div class="td-prop-label">${prop || 'No property'}</div>
      <div class="plates td-plates">${list.map(({ t, st, m }) => {
        const label = (t.unit || '—') + ', ' + t.name + ', ' + statusWords(m, today);
        return ui.plate(t.unit, { size: 'lg', status: st, button: true, title: label, attrs: { 'data-act': 'open', 'data-id': t.id, id: 'td-p-' + t.id, 'aria-label': label } });
      })}</div>
    </div>`)}
    <div class="td-keys" aria-label="Legend">${keys.map(k => h`<span class="td-keyitem">${ui.pill(k, { size: 'sm' })}${counts[k] ? h`<span class="td-keycount">${counts[k]}</span>` : ''}</span>`)}</div>
  </section>`;
}

// ------------------------------------------------------------------ (4) recent activity
function events(S) {
  const out = [];
  for (const t of S.tenantsList()) {
    const ents = S.entries(t.id) || {};
    for (const id of Object.keys(ents)) {
      const e = ents[id];
      if (!e || e.undone) continue;
      let text;
      if (e.type === 'payment') text = 'Payment' + (e.method ? ' · ' + e.method : '');
      else if (e.type === 'credit') text = 'Credit' + (e.memo ? ' · ' + e.memo : '');
      else text = e.category === 'late_fee' ? 'Late fee' : 'Charge' + (e.memo ? ' · ' + e.memo : '');
      out.push({ id: 'e-' + id, at: e.createdAt || e.date, date: e.date, t, text, amount: e.amount, pay: e.type !== 'charge', void: !!e.void });
    }
    const log = t.log || {};
    for (const id of Object.keys(log)) {
      const l = log[id];
      if (!l || !l.at) continue;
      out.push({ id: 'l-' + id, at: l.at, date: String(l.at).slice(0, 10), t, text: (KIND_WORD[l.kind] || 'Note') + ' · ' + (l.text || '') });
    }
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, 8);
}
function activity(S, today) {
  const list = events(S);
  return h`<section class="td-activity" aria-labelledby="td-act-t">
    <div class="sec"><h2 class="sec-title" id="td-act-t">Recent activity</h2></div>
    ${list.length ? h`<ul class="td-events">${list.map(ev => h`<li><button type="button" class="td-ev${ev.void ? ' is-void' : ''}" id="td-ev-${ev.id}" data-act="open" data-id="${ev.t.id}">
      <span class="td-ev-when">${D.fmt(ev.date, today)}</span>
      <span class="td-ev-main"><span class="td-ev-who">${ui.plate(ev.t.unit)}<span class="td-ev-name">${ev.t.name}</span></span><span class="td-ev-text">${ev.void ? 'Voided · ' : ''}${ev.text}</span></span>
      ${ev.amount ? h`<span class="td-ev-amt${ev.pay && !ev.void ? ' is-in' : ''}">${ui.money(ev.amount)}</span>` : h`<span></span>`}
    </button></li>`)}</ul>` : ui.empty({ quiet: true, title: 'No payments or notes yet.' })}
  </section>`;
}

RB.views.register('today', {
  title: 'Today',
  render(el, ctx) {
    const S = ctx.store;
    const att = S.attention();
    const byId = new Map(att.map(a => [a.id, a]));
    el.innerHTML = String(h`<div class="td">
      ${collection(S, ctx.today)}
      <div class="td-attention">${attention(S, att)}</div>
      <div class="td-split">${glance(S, ctx.today)}${activity(S, ctx.today)}</div>
    </div>`);
    ui.bind(el, {
      run: b => { const a = byId.get(b.dataset.id); if (a) RB.actions.run(a[b.dataset.which]); },
      subject: b => {
        const a = byId.get(b.dataset.id); if (!a) return;
        if (a.ticketId) RB.actions.openTicket(a.ticketId); else if (a.tenantId) RB.actions.openTenant(a.tenantId);
      },
      more: b => { expanded[b.dataset.g] = !expanded[b.dataset.g]; RB.shell.refresh(); },
      open: b => RB.actions.openTenant(b.dataset.id),
    });
  },
});

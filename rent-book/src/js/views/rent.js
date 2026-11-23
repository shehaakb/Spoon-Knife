// views/rent.js — PLACEHOLDER (to be replaced wholesale by the Rent view author). Exercises the foundation.
const RB = globalThis.RB;
const { html: h, ui, date: D } = RB;
let period = null;
let filter = 'all';

RB.views.register('rent', {
  title: 'Rent',
  shortcuts: [['j / k', 'Move between rows'], ['p', 'Mark paid'], ['Enter', 'Open payment sheet']],
  render(el, ctx) {
    const S = ctx.store;
    period = period || D.monthKey(ctx.today);
    const rows = S.tenantsList().map(t => ({ t, lg: S.ledger(t.id) })).map(x => ({ ...x, m: x.lg.months[period] })).filter(x => x.m && x.m.scheduled);
    const counts = { all: rows.length, unpaid: rows.filter(x => x.m.rentOpen > 0).length, late: rows.filter(x => x.m.status === 'late').length, partial: rows.filter(x => x.m.status === 'partial').length, paid: rows.filter(x => x.m.status === 'paid' || x.m.status === 'paid_late').length };
    const pred = { all: () => true, unpaid: x => x.m.rentOpen > 0, late: x => x.m.status === 'late', partial: x => x.m.status === 'partial', paid: x => x.m.status === 'paid' || x.m.status === 'paid_late' }[filter];
    const shown = rows.filter(pred);
    const tot = shown.reduce((a, x) => ({ c: a.c + x.m.charged, p: a.p + x.m.paid, o: a.o + x.m.open }), { c: 0, p: 0, o: 0 });
    const chip = (k, label) => h`<button type="button" class="chip" aria-pressed="${filter === k}" data-act="filter" data-k="${k}">${label}<span class="chip-count${k === 'late' && counts.late ? ' is-bad' : ''}">${counts[k]}</span></button>`;
    const action = x => x.m.open > 0 && x.lg.balance > 0
      ? h`<span class="btn-group"><button type="button" class="btn btn-sm btn-primary" data-act="paid" data-id="${x.t.id}" data-write>Mark paid</button><button type="button" class="btn btn-sm btn-primary btn-caret" data-act="sheet" data-id="${x.t.id}" aria-label="Record payment details" data-write>${ui.icon('chevron-down')}</button></span>`
      : h`<button type="button" class="btn btn-sm btn-ghost" data-act="sheet" data-id="${x.t.id}" data-write>Record</button>`;
    el.innerHTML = String(h`
      <div class="view-head">
        <div class="stepper"><button type="button" class="btn btn-ghost btn-icon" data-act="step" data-d="-1" aria-label="Previous month">${ui.icon('chevron-left')}</button><span class="stepper-label">${D.fmtMonth(period)}</span><button type="button" class="btn btn-ghost btn-icon" data-act="step" data-d="1" aria-label="Next month"${period >= D.monthKey(ctx.today) ? RB.raw(' disabled') : ''}>${ui.icon('chevron-right')}</button></div>
        <span class="spacer"></span>
        <div class="chips chips-scroll">${chip('all', 'All')}${chip('unpaid', 'Unpaid')}${chip('late', 'Late')}${chip('partial', 'Partial')}${chip('paid', 'Paid')}</div>
      </div>
      <div class="tbl-wrap hide-phone"><table class="tbl">
        <thead><tr><th>Tenant</th><th class="num">Due</th><th class="num">Paid</th><th class="num">Open</th><th>Status</th><th class="shrink"></th></tr></thead>
        <tbody>${shown.map(x => h`<tr><td><span class="row">${ui.plate(x.t.unit)}<span class="cell-name">${x.t.name}</span></span></td><td class="num">${ui.money(x.m.charged)}</td><td class="num">${x.m.paid ? ui.money(x.m.paid) : h`<span class="faint">—</span>`}</td><td class="num">${x.m.open ? ui.money(x.m.open, { tone: x.m.status === 'late' ? 'owed' : '' }) : h`<span class="faint">—</span>`}</td><td>${ui.pill(x.m.status, { daysLate: x.m.daysLate })}</td><td class="shrink">${action(x)}</td></tr>`)}</tbody>
      </table></div>
      <div class="clist show-phone">${shown.map(x => h`<div class="crow"><span class="crow-lead">${ui.plate(x.t.unit)}</span><div class="crow-main"><div class="crow-title">${x.t.name}</div><div class="crow-sub">${ui.money(x.m.charged)} due${x.m.paid ? h` · ${ui.money(x.m.paid)} paid` : ''}</div></div><div class="crow-aside">${ui.pill(x.m.status, { daysLate: x.m.daysLate })}</div>${x.m.open > 0 ? h`<div class="crow-actions">${action(x)}</div>` : ''}</div>`)}</div>
      <div class="totals"><div><span class="micro">Charged</span>${ui.money(tot.c)}</div><div><span class="micro">Collected</span>${ui.money(tot.p)}</div><div><span class="micro">Outstanding</span>${ui.money(tot.o, { tone: tot.o ? 'owed' : '' })}</div></div>
    `);
    ui.bind(el, {
      filter: b => { filter = b.dataset.k; RB.shell.refresh(); },
      step: b => { period = D.addMonthKey(period, +b.dataset.d); RB.shell.refresh(); },
      paid: b => RB.actions.recordPayment(b.dataset.id, { quick: true }),
      sheet: b => RB.actions.recordPayment(b.dataset.id),
    });
  },
});

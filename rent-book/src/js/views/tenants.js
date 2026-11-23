// views/tenants.js — PLACEHOLDER (to be replaced wholesale by the Tenants view author).
// Shows the list and a basic #t-<id> drawer so the shell, drawer and ledger components are reviewable.
const RB = globalThis.RB;
const { html: h, ui, date: D } = RB;

function ledgerTable(lg, today) {
  const rows = lg.rows.slice().reverse();
  let lastMonth = null;
  const out = [];
  for (const r of rows) {
    const mk = D.monthKey(r.date);
    if (mk !== lastMonth) { out.push(h`<tr class="ledger-month"><td colspan="5">${D.fmtMonth(mk)}</td></tr>`); lastMonth = mk; }
    out.push(h`<tr class="${r.void ? 'is-void' : ''}"><td class="l-date">${D.fmtNum(r.date, { mon: true })}</td>
      <td class="l-desc"><span class="l-desc-text">${r.label}</span>${r.prorate ? h`<span class="l-sub">${r.prorate.days} of ${r.prorate.ofDays} days</span>` : r.ref ? h`<span class="l-sub">Ref ${r.ref}</span>` : ''}</td>
      <td class="l-amt">${r.type === 'charge' ? ui.money(r.amount) : ''}</td><td class="l-amt l-pay">${r.type !== 'charge' ? ui.money(r.amount) : ''}</td><td class="l-bal">${ui.money(r.balance)}</td></tr>`);
  }
  return h`<table class="ledger"><thead><tr><th>Date</th><th>Description</th><th class="l-amt">Charge</th><th class="l-amt">Payment</th><th class="l-bal">Balance</th></tr></thead><tbody>${out}</tbody></table>`;
}

function drawerFor(id, ctx) {
  const S = ctx.store;
  ui.drawer({
    label: 'Tenant details',
    onClose: () => { if (/^#t-/.test(location.hash)) location.hash = 'tenants'; },
    render(el) {
      const t = S.tenant(id);
      if (!t) { el.innerHTML = String(h`<div class="drawer-head"><div class="drawer-title">Not found</div>${ui.drawerClose()}</div>`); return; }
      const lg = S.ledger(id);
      el.innerHTML = String(h`<div class="drawer-head"><div class="stack stack-1 grow">${ui.plate(t.unit, { size: 'lg', status: lg.current.status })}<div class="drawer-title">${t.name}</div><div class="muted">${t.property} · ${ui.balance(lg.balance, { zero: 'Nothing owed' })}</div></div>${ui.drawerClose()}</div>
        <div class="drawer-body">
          <div class="sec"><h3 class="sec-title">Contact</h3></div>
          <dl class="kv"><dt>Phone</dt><dd>${ui.copyline(t.phone, 'phone number')}</dd><dt>Email</dt><dd>${ui.copyline(t.email, 'email address')}</dd></dl>
          <div class="sec"><h3 class="sec-title">Ledger</h3><div class="sec-actions"><button type="button" class="btn btn-sm btn-ghost" data-act="stmt">${ui.icon('copy')}Copy statement</button></div></div>
          ${ledgerTable(lg, ctx.today)}
        </div>
        <div class="drawer-foot"><button type="button" class="btn btn-primary" data-act="pay" data-write>${ui.icon('cash')}Record payment</button><button type="button" class="btn" data-act="note" data-write>${ui.icon('note')}Add note</button></div>`);
      ui.bind(el, { pay: () => RB.actions.recordPayment(id), note: () => RB.actions.addNote(id), stmt: () => RB.actions.copyStatement(id) });
    },
  });
}

RB.views.register('tenants', {
  title: 'Tenants',
  render(el, ctx) {
    const S = ctx.store;
    const list = S.tenantsList();
    const end = D.monthKey(ctx.today);
    el.innerHTML = String(h`
      <div class="tbl-wrap hide-phone"><table class="tbl">
        <thead><tr><th>Tenant</th><th>Property</th><th class="num">Rent</th><th>This month</th><th>12 months</th><th class="num">Balance</th><th>Lease</th></tr></thead>
        <tbody>${list.map(t => { const lg = S.ledger(t.id); const ls = RB.model.leaseState(t, ctx.state.settings, ctx.today); return h`<tr class="is-link${t.status === 'past' ? ' is-muted' : ''}${ctx.param === t.id ? ' is-selected' : ''}" data-act="open" data-id="${t.id}">
          <td><span class="row">${ui.plate(t.unit)}<span><span class="cell-name">${t.name}</span>${t.coTenants && t.coTenants.length ? h`<span class="cell-sub">${t.coTenants.map(c => c.name).join(', ')}</span>` : ''}</span></span></td>
          <td class="muted">${t.property}</td><td class="num">${ui.money(lg.rent)}</td><td>${ui.pill(lg.current.status, { daysLate: lg.current.daysLate })}</td>
          <td>${ui.strip(RB.model.monthsBack(lg, end, 12), { today: ctx.today })}</td><td class="num">${ui.balance(lg.balance, { zero: '' })}</td><td class="muted nowrap">${ls.label}</td></tr>`; })}</tbody>
      </table></div>
      <div class="clist show-phone">${list.map(t => { const lg = S.ledger(t.id); return h`<div class="crow is-link" data-act="open" data-id="${t.id}"><span class="crow-lead">${ui.plate(t.unit)}</span><div class="crow-main"><div class="crow-title">${t.name}</div><div class="crow-sub">${t.property}</div></div><div class="crow-aside">${ui.pill(lg.current.status, { daysLate: lg.current.daysLate, size: 'sm' })}${ui.balance(lg.balance, { zero: '' })}</div></div>`; })}</div>
    `);
    ui.bind(el, { open: b => RB.actions.openTenant(b.dataset.id) });
    const d = ui.currentDrawer();
    if (ctx.param) { if (!d || ctx.reason !== 'store') drawerFor(ctx.param, ctx); else d.rerender(); }
    else if (d) d.close({ silent: true });
  },
  onKey(e, ctx) {
    if (!ctx.param || !['j', 'k', 'ArrowDown', 'ArrowUp'].includes(e.key)) return false;
    const list = ctx.store.tenantsList();
    const i = list.findIndex(t => t.id === ctx.param);
    const n = list[i + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)];
    if (n) location.hash = 't-' + n.id;
    return true;
  },
  destroy() { const d = ui.currentDrawer(); if (d) d.close({ silent: true }); },
});

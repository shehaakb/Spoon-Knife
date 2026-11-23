// views/today.js — PLACEHOLDER (to be replaced wholesale by the Today view author). Exercises the foundation.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;

RB.views.register('today', {
  title: 'Today',
  render(el, ctx) {
    const S = ctx.store;
    const p = S.portfolio();
    const att = S.attention();
    const tenants = S.tenantsList({ includePast: false });
    const pct = v => (p.charged ? Math.min(100, (v / p.charged) * 100) : 0);
    const graceTxt = ctx.today <= p.graceEnd ? 'grace ends ' + D.rel(p.graceEnd, ctx.today) : 'grace ended ' + D.fmt(p.graceEnd, ctx.today);
    const byProp = {};
    tenants.forEach(t => { (byProp[t.property] = byProp[t.property] || []).push(t); });
    el.innerHTML = String(h`
      <section>
        <div class="micro">${D.fmtMonth(p.period)}</div>
        <div class="row row-base gap-3 mt-2 row-wrap"><span>${ui.money(p.collected, { size: 'lg' })}</span><span class="muted t-15">of ${ui.money(p.charged)} collected</span></div>
        <div class="bar bar-lg mt-4" role="img" aria-label="${M.fmt(p.collected)} of ${M.fmt(p.charged)} collected">
          <span class="bar-seg bar-seg-ok" style="width:${pct(p.collected)}%"></span>
        </div>
        <div class="row row-wrap gap-4 mt-2 muted"><span><strong>${p.paidCount}</strong> of ${p.tenants} paid</span><span>${ui.money(p.outstanding)} outstanding</span><span>${graceTxt}</span></div>
      </section>
      <div class="sec"><h2 class="sec-title">Needs attention</h2><span class="sec-meta">${att.length || ''}</span></div>
      ${att.length ? h`<div class="rule">${att.slice(0, 12).map((a, i) => h`<div class="lrow">
          <span class="lrow-lead">${a.unit ? ui.plate((S.tenant(a.tenantId) || {}).unit || a.unit.split(' ').pop()) : ui.icon('wrench')}</span>
          <div><div class="lrow-title"><span class="lrow-sev sev-${a.severity}"></span> ${a.title}</div><div class="lrow-detail">${a.detail}</div></div>
          <div class="lrow-actions">${a.secondary ? h`<button type="button" class="btn btn-sm btn-ghost" data-act="run" data-i="${i}" data-which="secondary" data-write>${a.secondary.label}</button>` : ''}<button type="button" class="btn btn-sm${a.action.type === 'recordPayment' ? ' btn-primary' : ''}" data-act="run" data-i="${i}" data-which="action">${a.action.label}</button></div>
        </div>`)}</div>` : ui.empty({ quiet: true, title: 'Nothing needs you today.' })}
      <div class="sec"><h2 class="sec-title">The month at a glance</h2></div>
      ${Object.keys(byProp).map(prop => h`<div class="micro mt-4 mb-2">${prop}</div><div class="plates">${byProp[prop].map(t => { const lg = S.ledger(t.id); return ui.plate(t.unit, { size: 'lg', status: lg.current.status, button: true, title: t.name + ' — ' + RB.model.STATUS_LABEL[lg.current.status], attrs: { 'data-act': 'open', 'data-id': t.id } }); })}</div>`)}
    `);
    ui.bind(el, {
      run: b => { const a = att[+b.dataset.i]; RB.actions.run(a && a[b.dataset.which]); },
      open: b => RB.actions.openTenant(b.dataset.id),
    });
  },
});

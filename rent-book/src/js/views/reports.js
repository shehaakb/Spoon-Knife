// views/reports.js — PLACEHOLDER (to be replaced wholesale by the Reports view author).
const RB = globalThis.RB;
const { html: h, ui, date: D } = RB;

RB.views.register('reports', {
  title: 'Reports',
  render(el, ctx) {
    const S = ctx.store;
    const col = S.collectionByMonth(12);
    const ag = S.aging();
    el.innerHTML = String(h`
      <div class="sec"><h2 class="sec-title">Collection by month</h2><div class="sec-actions"><button type="button" class="btn btn-sm btn-ghost" data-act="csv">${ui.icon('download')}Download CSV</button></div></div>
      <div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Month</th><th class="num">Charged</th><th class="num">Collected</th><th class="num">Rate</th></tr></thead>
        <tbody>${col.slice().reverse().map(c => h`<tr><td>${D.fmtMonth(c.period)}</td><td class="num">${ui.money(c.charged)}</td><td class="num">${ui.money(c.collected)}</td><td class="num">${c.rate == null ? '—' : (c.rate * 100).toFixed(1) + '%'}</td></tr>`)}</tbody></table></div>
      <div class="sec"><h2 class="sec-title">Aging</h2><span class="sec-meta">${ag.rows.length} owing</span></div>
      <div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Tenant</th><th class="num">0–30</th><th class="num hide-phone">31–60</th><th class="num hide-phone">61–90</th><th class="num hide-phone">90+</th><th class="num">Total</th></tr></thead>
        <tbody>${ag.rows.map(r => h`<tr><td><span class="row">${ui.plate(r.unit)}<span class="truncate">${r.name}</span></span></td><td class="num">${ui.money(r.d0_30)}</td><td class="num hide-phone">${ui.money(r.d31_60)}</td><td class="num hide-phone">${ui.money(r.d61_90)}</td><td class="num hide-phone">${ui.money(r.d90)}</td><td class="num">${ui.money(r.total, { tone: 'owed' })}</td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${ui.money(ag.totals.d0_30)}</td><td class="num hide-phone">${ui.money(ag.totals.d31_60)}</td><td class="num hide-phone">${ui.money(ag.totals.d61_90)}</td><td class="num hide-phone">${ui.money(ag.totals.d90)}</td><td class="num">${ui.money(ag.totals.total)}</td></tr></tfoot></table></div>`);
    ui.bind(el, { csv: () => RB.actions.downloadFile('collection-' + ctx.today + '.csv', RB.model.collectionCsv(col), 'text/csv') });
  },
});

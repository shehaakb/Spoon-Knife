// views/leases.js — PLACEHOLDER (to be replaced wholesale by the Leases view author).
const RB = globalThis.RB;
const { html: h, ui, date: D } = RB;

RB.views.register('leases', {
  title: 'Leases',
  render(el, ctx) {
    const S = ctx.store;
    const list = S.tenantsList({ includePast: false }).map(t => ({ t, ls: RB.model.leaseState(t, ctx.state.settings, ctx.today) }))
      .sort((a, b) => (a.ls.end || '9999').localeCompare(b.ls.end || '9999'));
    el.innerHTML = String(h`
      <div class="sec"><h2 class="sec-title">By end date</h2><span class="sec-meta">Notice window ${ctx.state.settings.leaseNoticeDays} days</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Tenant</th><th class="hide-phone">Start</th><th>Ends</th><th class="hide-phone">Through the term</th></tr></thead>
        <tbody>${list.map(({ t, ls }) => h`<tr class="is-link" data-act="open" data-id="${t.id}"><td><span class="row">${ui.plate(t.unit)}<span class="cell-name truncate">${t.name}</span></span></td>
          <td class="hide-phone muted">${ui.date(ls.start)}</td>
          <td>${ls.kind === 'mtm' ? ui.tag('Month-to-month', 'quiet') : h`<span class="${ls.inNoticeWindow ? 'tone-warn medium' : ''}">${ls.label}</span>`}${ls.noticeGiven ? h` ${ui.tag('Notice', 'warn')}` : ''}</td>
          <td class="hide-phone" style="width:30%">${ls.progress != null ? h`<div class="bar bar-thin"><span class="bar-seg${ls.inNoticeWindow ? ' bar-seg-warn' : ''}" style="width:${Math.round(ls.progress * 100)}%"></span></div>` : ''}</td></tr>`)}</tbody>
      </table></div>`);
    ui.bind(el, { open: b => RB.actions.openTenant(b.dataset.id) });
  },
});

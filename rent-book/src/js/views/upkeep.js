// views/upkeep.js — PLACEHOLDER (to be replaced wholesale by the Upkeep view author).
const RB = globalThis.RB;
const { html: h, ui, date: D } = RB;

const PRIO = { urgent: ['Urgent', 'bad'], normal: ['Normal', ''], low: ['Low', 'quiet'] };
RB.views.register('upkeep', {
  title: 'Upkeep',
  firstRun: false,
  render(el, ctx) {
    const list = ctx.store.ticketsList().sort((a, b) => (a.status === 'done') - (b.status === 'done') || D.cmp(b.reported, a.reported));
    el.innerHTML = String(h`
      <div class="sec"><h2 class="sec-title">Requests</h2><span class="sec-meta">${list.filter(k => k.status !== 'done').length} open</span></div>
      ${list.length ? h`<div class="rule">${list.map(k => h`<div class="lrow"><span class="lrow-lead">${ui.plate(k.unit)}</span>
        <div><div class="lrow-title">${k.title}</div><div class="lrow-detail">${k.property} · ${k.status === 'done' ? 'done ' + D.fmt(k.completed, ctx.today) : D.diffDays(k.reported, ctx.today) + ' d open'}${k.vendor ? ' · ' + k.vendor : ''}${k.cost ? h` · ${ui.money(k.cost)}` : ''}</div></div>
        <div class="lrow-actions">${ui.tag(PRIO[k.priority][0], PRIO[k.priority][1])}${ui.tag(k.status === 'open' ? 'Open' : k.status === 'scheduled' ? 'Scheduled ' + D.fmt(k.scheduled, ctx.today) : 'Done', k.status === 'done' ? 'ok' : k.status === 'scheduled' ? 'accent' : '')}</div></div>`)}</div>`
        : ui.empty({ icon: 'wrench', title: 'No upkeep requests', body: 'Log repairs and maintenance here so nothing slips.' })}`);
  },
});

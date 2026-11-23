// views/setup.js — PLACEHOLDER (to be replaced wholesale by the Setup view author). Sample-data buttons work.
const RB = globalThis.RB;
const { html: h, ui, money: M } = RB;

RB.views.register('setup', {
  title: 'Setup',
  firstRun: false,
  render(el, ctx) {
    const s = ctx.state.settings;
    const hasSample = ctx.store.hasSample();
    const lf = s.lateFee.type === 'none' ? 'None' : s.lateFee.type === 'flat' ? M.fmt(s.lateFee.amount) + ' flat' : s.lateFee.amount + '% of rent';
    el.innerHTML = String(h`
      ${ctx.intent === 'import' ? h`<div class="form-note mb-4">Spreadsheet import lands here (Setup view author).</div>` : ''}
      <div class="sec"><h2 class="sec-title">Rules</h2></div>
      <dl class="kv">
        <dt>Portfolio</dt><dd>${s.portfolioName || h`<span class="faint">Not named</span>`}</dd>
        <dt>Rent due</dt><dd>Day ${s.dueDay} of the month, ${s.graceDays}-day grace</dd>
        <dt>Late fee</dt><dd>${lf}</dd>
        <dt>Deposit return</dt><dd>${s.depositReturnDays} days after move-out</dd>
        <dt>Lease notice window</dt><dd>${s.leaseNoticeDays} days</dd>
        <dt>Payment methods</dt><dd>${s.methods.join(', ')}</dd>
      </dl>
      <div class="sec"><h2 class="sec-title">Sample data</h2></div>
      <p class="muted mb-4">${hasSample ? 'Sample tenants are loaded. Remove them before you add your own, or keep exploring.' : 'Load 27 invented tenants across three buildings to see how everything works.'}</p>
      <div class="row row-wrap">
        <button type="button" class="btn${hasSample ? '' : ' btn-primary'}" id="setup-load-sample" data-cmd="sample:load" data-write${hasSample ? RB.raw(' disabled') : ''}>${ui.icon('sample')}Load sample data</button>
        <button type="button" class="btn btn-danger-soft" id="setup-remove-sample" data-cmd="sample:remove" data-write${hasSample ? '' : RB.raw(' disabled')}>${ui.icon('trash')}Remove sample data</button>
      </div>
      <div class="sec"><h2 class="sec-title">Backup</h2></div>
      <div class="row row-wrap"><button type="button" class="btn" data-cmd="backup:download">${ui.icon('download')}Download backup</button></div>
      <div class="sec"><h2 class="sec-title">Keyboard</h2></div>
      <button type="button" class="btn btn-ghost" data-cmd="help:keys">${ui.icon('keyboard')}Show shortcuts ${ui.kbd('?')}</button>`);
  },
});

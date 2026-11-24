// views/kit.js — developer route #kit (not in the nav): the v3 system (SPEC §10) on one page, for review.
// Type specimen, button hierarchy, the canonical row, status markers, the one choice control, fields, layers.
// It must itself pass `node tools/audit.mjs --only kit` (one filled button, five sizes, two weights, no stray red).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
let pickVal = 'all';

RB.views.register('kit', {
  title: 'Component kit',
  firstRun: false,
  loading: true,
  render(el, ctx) {
    const today = ctx.today;
    const sec = (id, title, note, body) => h`<section class="kit-sec" id="kit-${id}"><h2 class="sec-title kit-label">${title}</h2>${note ? h`<p class="caption kit-note">${note}</p>` : ''}${body}</section>`;
    const swatch = n => h`<div class="kit-swatch"><i style="background:var(--${n})"></i><span class="mono">--${n}</span></div>`;
    const cells = Array.from({ length: 12 }, (_, i) => {
      const st = ['paid', 'paid', 'paid_late', 'paid', 'partial', 'paid', 'late', 'paid_late', 'paid', 'none', 'paid', 'due'][i];
      return { period: D.addMonthKey(D.monthKey(today), i - 11), status: st, paidOn: D.dayIn(D.addMonthKey(D.monthKey(today), i - 11), st === 'paid_late' ? 11 : 2), daysLate: 10, open: 64500, paid: 80000, due: D.dayIn(D.monthKey(today), 1) };
    });
    const ready = ctx.state.ready && RB.store.tenantsList().length;

    el.innerHTML = String(h`<div class="kit">
      <p class="lead mb-4">The v3 system on one page. Rules: SPEC §10. API: <span class="mono">docs/CONTRACT.md</span> → “What changed in v3”.</p>

      ${sec('type', 'Type: five sizes, two weights', 'All sizes multiply by the text size. 600 is only for a row’s first line, button labels and sans headings. Exactly one display element per screen.', h`<div class="kit-specimen">
        <span class="caption">--t-display 32/36</span><span class="t-display">$34,770</span>
        <span class="caption">--t-title 22</span><span class="t-title">Record a payment</span>
        <span class="caption">--t-lead 18</span><span class="t-lead">6 tenants owe $8,545 in total — $6,495 of it is November’s rent.</span>
        <span class="caption">--t-body 16 (17)</span><span>Owes $1,550 for November. <strong>Row titles and buttons are 600.</strong></span>
        <span class="caption">--t-cap 14</span><span class="t-cap muted">Unit 2B at Alder Court · captions, status markers, group heads</span>
      </div>`)}

      ${sec('buttons', 'Buttons: one filled per screen', 'Filled for the one obvious thing; soft for the one row action; outline for secondary actions; text links for the rest.', h`<div class="stack stack-4">
        <div class="kit-btnrow"><button class="btn btn-primary btn-lg" type="button" id="kit-btn-primary">${ui.icon('cash')}Record a rent payment</button></div>
        <div class="kit-btnrow"><button class="btn btn-soft" type="button">Record a payment</button><button class="btn btn-outline" type="button">Log a repair</button><button class="btn" type="button">Add a tenant</button><button class="btn-link" type="button">Record several at once</button><button class="btn" type="button" disabled>Disabled</button></div>
        <p class="caption">Confirm sheets add a red worded button and a larger “Keep it” — open “Confirm” below.</p></div>`)}

      ${sec('rows', 'The row', 'One tap target ending in a chevron. Only Rent’s “still owes” rows and Today’s rent rows carry one soft button.', h`<div style="max-width:640px">
        ${ui.rowsHead('Still owes', 2)}
        <ul class="rows rows-inset">
          ${ui.row({ lead: ui.plate('202'), title: 'Imogen Hart', sub: 'Owes $1,550 for November', status: ui.status('late', 'Late — 23 days'), statusPos: 'main', act: 'noop', attrs: { id: 'kit-row-1' }, btn: { label: 'Record a payment', act: 'noop', id: 'kit-row-btn' } })}
          ${ui.row({ lead: ui.plate('103'), title: 'Nadia Haddad', sub: 'Owes $675 of November’s $1,475', status: ui.status('partial', 'Part paid — $800 of $1,475'), statusPos: 'main', bar: ui.splitBar(80000, 147500), act: 'noop', btn: { label: 'Record the rest ($675)', act: 'noop' } })}
        </ul>
        ${ui.rowsHead('Tenants', 3)}
        <ul class="rows rows-inset">
          ${ui.row({ lead: ui.plate('1B'), title: 'Tomasz Wolski', sub: 'Unit 1B at Alder Court', amt: '$3,300', status: ui.status('late', 'Behind on rent'), href: '#kit' })}
          ${ui.row({ lead: ui.plate('No. 8'), title: 'Ruth Abernathy', sub: 'No. 8 at Fenwick Row', status: ui.status('paid', 'All paid up'), href: '#kit' })}
          ${ui.row({ lead: ui.plate('2C'), title: 'Aisha Rahman', sub: 'Unit 2C at Alder Court', status: ui.status('warn', 'Lease ends in 51 days'), href: '#kit' })}
        </ul>
        ${ui.rowsMore(14, { id: 'kit-more', act: 'noop' })}</div>`)}

      ${sec('status', 'Status markers', 'Colour lives here and nowhere else: icon shape + words. Amounts, sentences and door plates stay in ink.', h`<div class="stack stack-3">
        <div class="kit-btnrow">${ui.status('late', 'Late — 23 days')}${ui.status('partial_late', 'Part paid — rest is 23 days late')}${ui.status('partial', 'Part paid — $800 of $1,475')}${ui.status('warn', 'In 24 days')}</div>
        <div class="kit-btnrow">${ui.status('due', 'Not paid yet')}${ui.status('paid', 'Paid')}${ui.status('paid_late', 'Paid late')}${ui.status('urgent', 'Urgent')}${ui.status('info', 'Moves in Dec 1')}${ui.status('none', 'No rent this month')}</div>
        <div class="kit-btnrow">${['1A', '2B', '101', 'No. 12'].map(u => ui.plate(u))}${['paid', 'partial', 'late', 'due'].map(s => ui.plate(s === 'paid' ? '3A' : s === 'partial' ? '2A' : s === 'late' ? '3C' : '3D', { size: 'lg', status: s }))}${ui.strip(cells, { today })}</div></div>`)}

      ${sec('choices', 'One choice control', '2–4 options: radio cards. 5 or more: a select (automatic). Segments only switch views; chips only filter.', h`<div class="stack stack-5" style="max-width:560px">
        ${ui.field({ name: 'kpay', id: 'kit-how', label: 'Did they pay all of it?', type: 'choice', value: pickVal, options: [{ value: 'all', label: 'Yes, all $1,550', sub: 'Everything they owe right now' }, { value: 'part', label: 'Only part of it', sub: 'You’ll type the amount next' }] })}
        ${ui.field({ name: 'kmethod', id: 'kit-method', label: 'How did they pay?', type: 'choice', value: 'Zelle', options: ['Check', 'Cash', 'Zelle', 'Venmo', 'Money order'] })}
        ${ui.segment([{ key: 'owes', label: 'Still owes', count: 6 }, { key: 'paid', label: 'Paid', count: 20 }, { key: 'all', label: 'All', count: 26 }], 'owes', { id: 'kit-seg', act: 'noop', label: 'Show' })}
        <div class="chips"><button class="chip" type="button" aria-pressed="true">Everyone <span class="chip-count">26</span></button><button class="chip" type="button" aria-pressed="false">Owes money <span class="chip-count">6</span></button></div></div>`)}

      ${sec('fields', 'Fields', 'Questions as labels; dates written out beside the field; amount fields sized to the answer.', h`<form class="form-col" id="kit-form" novalidate style="max-width:560px">
        ${ui.field({ name: 'kamt', id: 'kit-amount', label: 'How much did they pay?', type: 'money', big: true, value: 145000, hint: 'They owe $1,550.' })}
        ${ui.field({ name: 'kdate', id: 'kit-date', label: 'When did you get it?', type: 'date', value: today })}
        ${ui.field({ name: 'kbad', id: 'kit-bad', label: 'How much?', type: 'money', value: null })}
        <label class="search" for="kit-search"><span class="search-icon">${ui.icon('search')}</span><input class="input" id="kit-search" type="search" placeholder="A name or a unit, like 2B"></label>
        ${ui.moreDetails(ui.field({ name: 'kref', id: 'kit-ref', label: 'Check number or confirmation code', optional: true }))}</form>`)}

      ${sec('text', 'Text size', 'The sidebar control (three “A”s) and the worded one (Settings, More). Both remember the choice on this device.', h`<div class="kit-btnrow" style="align-items:flex-start">${ui.textSizeControl({ id: 'kit-tsl', letters: true })}${ui.textSizeControl({ id: 'kit-ts' })}</div>`)}

      ${sec('tokens', 'Colour tokens', 'Semantic colours (ok, warn, bad) appear only inside status markers.', h`<div class="kit-grid">${['paper', 'surface', 'sunk', 'tint', 'ink', 'ink-2', 'line', 'line-2', 'accent', 'accent-soft', 'ok', 'warn', 'bad'].map(swatch)}</div>`)}

      ${sec('layers', 'Floating layers', 'A sheet never opens on another sheet; a toast never covers a sheet.', h`<div class="kit-btnrow">
        <button type="button" class="btn" id="kit-pick" data-act="pick">Which tenant?</button><button type="button" class="btn" id="kit-choices" data-act="choices">What would you like to do?</button>
        <button type="button" class="btn" id="kit-steps" data-act="steps">Step-by-step guide</button><button type="button" class="btn" id="kit-pay" data-act="pay">Payment sheet</button>
        <button type="button" class="btn" id="kit-toast-undo" data-act="toastUndo">Toast with Undo</button><button type="button" class="btn" id="kit-confirm" data-act="confirm">Confirm</button>
        <button type="button" class="btn" id="kit-drawer" data-act="drawer">Drawer</button><button type="button" class="btn" id="kit-help" data-cmd="help:howto">Help</button><button type="button" class="btn" id="kit-palette" data-act="palette">Find</button></div>`)}
    </div>`);
    ui.showErrors(el.querySelector('#kit-form'), { kbad: 'Type an amount like 1,450.50' }, { focus: false });
    const needTenants = fn => () => { if (!ready) { ui.toast('Load the sample tenants first (Find → “Load sample tenants”).'); return; } fn(); };
    ui.bind(el, {
      noop: () => {},
      toastUndo: () => ui.toast('Recorded $1,450 from Maya Okafor. All paid up.', { undo: () => ui.toast('Undone — nothing was recorded.') }),
      pick: needTenants(() => ui.pickTenant({ title: 'Who paid you?', prefer: 'owes' }).then(id => id && ui.toast('You chose ' + RB.store.tenant(id).name + '.'))),
      choices: () => ui.choices({ title: 'Imogen Hart', sub: 'Unit 202 at 418 Marlow Street · Owes $1,550', items: [
        { label: 'They paid part of it', hint: 'Type the amount you got', run: () => ui.toast('Example only.') },
        { label: 'Add a $50 late fee', hint: 'For November', run: () => ui.toast('Example only.') },
        { label: 'See their page', hint: 'Payment history, notes and lease', run: () => ui.toast('Example only.') }] }),
      pay: needTenants(() => { const t = RB.store.tenantsList().find(x => RB.store.ledger(x.id).balance > 0) || RB.store.tenantsList()[0]; RB.actions.recordPayment(t.id); }),
      steps: () => ui.steps({ title: 'Add a tenant (example)', doneLabel: 'Add tenant',
        steps: [
          { title: 'Who is it?', body: (b, d) => h`${ui.field({ name: 'name', id: 'ks-name', label: 'What is their name?', value: d.name || '', required: true, placeholder: 'For example: Maya Okafor' })}` },
          { title: 'Where do they live?', body: (b, d) => h`${ui.field({ name: 'unit', id: 'ks-unit', label: 'Which unit?', value: d.unit || '', required: true, placeholder: 'For example: 1A' })}` },
          { title: 'What do they pay?', body: (b, d) => h`${ui.field({ name: 'rent', id: 'ks-rent', label: 'How much is the rent each month?', type: 'money', big: true, value: d.rent, required: true })}` },
        ],
        summary: d => h`<strong>${d.name}</strong>, Unit ${d.unit}, ${M.fmt(d.rent)} a month.`,
        onDone: d => { ui.toast('This is only an example — ' + d.name + ' was not added.'); } }),
      confirm: () => ui.confirm({ title: 'Remove the sample tenants?', body: h`<p class="say">This removes the <strong>27 sample tenants</strong>, their payment history and <strong>6 sample repairs</strong>. Tenants you added yourself stay.</p>`, confirmLabel: 'Remove sample tenants', danger: true }),
      drawer: () => ui.drawer({ label: 'Example drawer', render: d => { d.innerHTML = String(h`<div class="drawer-head"><div class="grow stack stack-1">${ui.plate('2B')}<div class="drawer-title">Owen Gallagher</div><div class="muted">Unit 2B at Alder Court · ${ui.balance(64500)}</div></div>${ui.drawerClose()}</div><div class="drawer-body"><div class="sec"><h3 class="sec-title">Lease and rent</h3></div><dl class="kv"><dt>Term</dt><dd>March 1 to February 28, 2027</dd><dt>Rent</dt><dd>${ui.money(137500)}</dd></dl></div>`); } }),
      palette: () => RB.shell.openPalette(),
    });
    el.addEventListener('change', e => { if (e.target.name === 'kpay') pickVal = e.target.value; });
  },
});

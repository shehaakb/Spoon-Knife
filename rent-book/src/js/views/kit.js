// views/kit.js — developer route #kit (not in the nav): every component in the library, for review. Owned by the foundation.
const RB = globalThis.RB;
const { html: h, raw, ui, date: D, money: M } = RB;
let sortDir = 'ascending';

function synthLedger(today) {
  const k = D.monthKey(today);
  const t = { id: 'kit', name: 'Kit Tenant', unit: '2B', property: 'Alder Court', status: 'active',
    lease: { start: D.monthStart(D.addMonthKey(k, -3)), end: null, moveIn: D.dayIn(D.addMonthKey(k, -3), 12) },
    rent: [{ from: D.monthStart(D.addMonthKey(k, -3)), amount: 145000 }], trackFrom: D.dayIn(D.addMonthKey(k, -3), 12),
    recurring: [{ id: 'pet', label: 'Pet rent', amount: 3500, from: D.monthStart(D.addMonthKey(k, -1)), to: null }] };
  const e = {
    a: { type: 'payment', date: D.dayIn(D.addMonthKey(k, -3), 12), amount: Math.round(145000 * (D.daysInMonth(D.addMonthKey(k, -3)) - 11) / D.daysInMonth(D.addMonthKey(k, -3))), method: 'Zelle', ref: '448120' },
    b: { type: 'payment', date: D.dayIn(D.addMonthKey(k, -2), 9), amount: 145000, method: 'Check', ref: '1043' },
    c: { type: 'charge', date: D.dayIn(D.addMonthKey(k, -2), 12), amount: 5000, category: 'late_fee', period: D.addMonthKey(k, -2), memo: 'Late fee — ' + D.monthName(D.addMonthKey(k, -2)) },
    d: { type: 'payment', date: D.dayIn(D.addMonthKey(k, -1), 2), amount: 100000, method: 'Zelle', ref: 'dup', void: true },
    f: { type: 'payment', date: D.dayIn(D.addMonthKey(k, -1), 3), amount: 153500, method: 'Zelle', ref: '551902' },
  };
  return RB.model.buildLedger(t, e, RB.store.settings(), today);
}

RB.views.register('kit', {
  title: 'Component kit',
  firstRun: false,
  loading: true,
  render(el, ctx) {
    const today = ctx.today;
    const lg = synthLedger(today);
    const sts = ['paid', 'paid_late', 'partial', 'due', 'late', 'none'];
    const cells = Array.from({ length: 12 }, (_, i) => {
      const st = ['paid', 'paid', 'paid_late', 'paid', 'partial', 'paid', 'late', 'paid_late', 'paid', 'none', 'paid', 'due'][i];
      return { period: D.addMonthKey(D.monthKey(today), i - 11), status: st, paidOn: D.dayIn(D.addMonthKey(D.monthKey(today), i - 11), st === 'paid_late' ? 11 : 2), daysLate: 10, open: 64500, paid: 80000, due: D.dayIn(D.monthKey(today), 1) };
    });
    const swatch = n => h`<div class="kit-swatch"><i style="background:var(--${n})"></i><span class="mono">--${n}</span></div>`;
    const sec = (title, body) => h`<section class="kit-sec"><div class="sec kit-label"><h2 class="sec-title">${title}</h2></div>${body}</section>`;
    const rows = lg.rows.slice().reverse();
    let lastM = null;
    const ledgerRows = rows.map(r => { const mk = D.monthKey(r.date); const div = mk !== lastM ? h`<tr class="ledger-month"><td colspan="6">${D.fmtMonth(mk)}</td></tr>` : ''; lastM = mk;
      return h`${div}<tr class="${r.void ? 'is-void' : ''}"><td class="l-date">${D.fmtNum(r.date, { mon: true })}</td><td class="l-desc"><span class="l-desc-text">${r.label}</span>${r.prorate ? h`<span class="l-sub">${r.prorate.days} of ${r.prorate.ofDays} days</span>` : r.void ? h`<span class="l-sub">Removed — it was a mistake</span>` : r.ref ? h`<span class="l-sub">Ref ${r.ref}</span>` : ''}</td><td class="l-amt">${r.type === 'charge' ? ui.money(r.amount) : ''}</td><td class="l-amt l-pay">${r.type !== 'charge' ? ui.money(r.amount) : ''}</td><td class="l-bal">${ui.money(r.balance)}</td><td class="l-act"><button type="button" class="btn btn-ghost btn-sm" data-act="menu">${ui.icon('more')}<span>More</span></button></td></tr>`; });

    el.innerHTML = String(h`
      <p class="muted mb-4">Every component in the library, in both themes. Not linked from the nav. See <span class="mono">docs/CONTRACT.md</span> (“What changed in v2”).</p>
      ${sec('Text size: Normal · Large · Extra large', h`<div class="stack stack-4">${ui.textSizeControl({ id: 'kit-ts' })}
        <p class="caption">The three sizes side by side (each panel sets its own --text-scale). The control above changes the whole app and is remembered on this device.</p>
        <div class="kit-sizes">${RB.textSize.OPTIONS.map(o => h`<div class="kit-size text-scope" data-scale="${o.value}"><div class="micro mb-2">${o.label} · ${Math.round(o.scale * 100)}%</div>
          <div class="stack stack-3"><p class="say">Imogen Hart owes <strong>$1,550</strong> for November — 23 days late.</p>
          <div class="row row-wrap">${ui.plate('202', { status: 'late' })}${ui.pill('partial_late', { daysLate: 23 })}</div>
          <button type="button" class="btn btn-primary btn-lg">Record payment</button><button type="button" class="btn-link">They paid part of it</button></div></div>`)}</div></div>`)}
      ${sec('Tokens', h`<div class="kit-grid">${['paper', 'surface', 'sunk', 'ink', 'ink-2', 'ink-3', 'line', 'line-2', 'accent', 'accent-soft', 'ok', 'ok-soft', 'warn', 'warn-soft', 'bad', 'bad-soft'].map(swatch)}</div>`)}
      ${sec('Type', h`<div class="stack stack-3">
        <div class="t-34 display">Newsreader 38 (--t-34) — ${ui.money(1245000, { size: 'lg' })}</div>
        <div class="h-view">Newsreader 27 (--t-24) — view title</div><div class="sec-title">Newsreader 20 (--t-18) — section title</div>
        <div class="t-15">Plex Sans 17 (--t-15) — sentences, buttons, labels</div><div>Plex Sans 16 desktop / 17 phone (--t-body) — body text with tabular figures 1,450 · 12,000</div>
        <div class="t-13 muted">Plex Sans 15 (--t-13) — secondary lines, in ink-2</div><div class="t-12 muted">Plex Sans 14 (--t-12) — the smallest anything readable gets</div><div class="micro">Micro label 14 — uppercase, sparingly</div><div class="mono">IBM Plex Mono — Nov 03 · ref 448120</div></div>`)}
      ${sec('Buttons', h`<div class="stack stack-3">
        <div class="row row-wrap"><button class="btn btn-primary" type="button">${ui.icon('cash')}Record $1,450</button><button class="btn" type="button">Default</button><button class="btn btn-soft" type="button">Soft</button><button class="btn btn-ghost" type="button">Ghost</button><button class="btn btn-danger" type="button">Delete tenant</button><button class="btn btn-danger-soft" type="button">${ui.icon('trash')}Remove</button><button class="btn" type="button" disabled>Disabled</button><button class="linkbtn" type="button">Link button</button></div>
        <div class="row row-wrap"><button class="btn btn-primary btn-sm" type="button">Small</button><button class="btn btn-sm" type="button">Small</button><button class="btn btn-primary btn-lg" type="button">Large primary</button><button class="btn btn-lg" type="button">Large</button></div>
        <div class="row row-wrap"><button class="btn btn-primary btn-xl" type="button">${ui.icon('cash')}Record a rent payment</button><button class="btn btn-keep" type="button">Keep it</button><button class="btn-link" type="button">They paid part of it</button></div>
        <div class="row row-wrap">${ui.button({ label: 'Add', icon: 'plus', kind: 'soft' })}${ui.button({ label: 'Find', icon: 'search', kind: 'ghost' })}${ui.button({ label: 'More', icon: 'more', kind: 'ghost' })}${ui.button({ label: 'Copy', icon: 'copy', size: 'sm', iconOnly: true })}${ui.drawerClose()}</div>
        <p class="caption">No icon-only buttons: ui.button always shows its label (iconOnly is ignored), and ui.drawerClose reads “Close” (“Back” on phone).</p></div>`)}
      ${sec('Form fields', h`<form class="form-grid" id="kit-form" novalidate style="max-width:640px">
        ${ui.field({ name: 'kname', id: 'kit-name', label: 'Name', value: 'Maya Okafor', required: true })}
        ${ui.field({ name: 'kamt', id: 'kit-amount', label: 'Amount', type: 'money', value: 145050, hint: 'Open balance $1,450.50' })}
        ${ui.field({ name: 'kdate', id: 'kit-date', label: 'Date received', type: 'date', value: today })}
        ${ui.field({ name: 'kmethod', id: 'kit-method', label: 'How did they pay?', type: 'choice', cols: 2, value: 'Zelle', options: ['Check', 'Cash', 'Zelle', 'ACH'], span: 2 })}
        ${ui.field({ name: 'khow', id: 'kit-how', label: 'Did they pay all of it?', type: 'choice', value: 'all', options: [{ value: 'all', label: 'Yes, all $1,550', sub: 'Everything they owe right now' }, { value: 'part', label: 'Only part of it', sub: 'You’ll type the amount next' }], span: 2 })}
        ${ui.field({ name: 'kref', id: 'kit-ref', label: 'Reference', optional: true, placeholder: 'Check no., confirmation…' })}
        ${ui.field({ name: 'kbad', id: 'kit-bad', label: 'Invalid field', type: 'money', value: '' })}
        <div class="span-2">${ui.moreDetails(h`${ui.field({ name: 'kmemo', id: 'kit-memo', label: 'A note for yourself', optional: true })}`)}</div>
        ${ui.field({ name: 'knote', id: 'kit-note', label: 'Notes', type: 'textarea', span: 2, placeholder: 'Pets, vehicles, quirks…' })}
        ${ui.field({ name: 'kcheck', id: 'kit-check', label: 'Charge a late fee automatically suggested', type: 'checkbox', value: true, span: 2 })}
        <div class="span-2 form-sum"><span class="muted">Balance after</span><strong>${ui.money(0)}</strong></div>
        <label class="search span-2" for="kit-search"><span class="search-icon">${ui.icon('search')}</span><input class="input" id="kit-search" type="search" placeholder="Search tenants…"><kbd class="kbd search-kbd">/</kbd></label>
      </form>`)}
      ${sec('Segmented control & filter chips', h`<div class="stack stack-4">
        <div class="seg" role="group" aria-label="Example"><button type="button" aria-pressed="true">This month</button><button type="button" aria-pressed="false">Last month</button></div>
        <div class="chips"><button type="button" class="chip" aria-pressed="true">All<span class="chip-count">27</span></button><button type="button" class="chip" aria-pressed="false">Unpaid<span class="chip-count">6</span></button><button type="button" class="chip" aria-pressed="false">Late<span class="chip-count is-bad">3</span></button><button type="button" class="chip" aria-pressed="false">Partial<span class="chip-count">2</span></button><button type="button" class="chip" aria-pressed="false">Paid<span class="chip-count">21</span></button></div></div>`)}
      ${sec('Status pills & tags', h`<div class="stack stack-3"><div class="row row-wrap">${sts.map(s => ui.pill(s, { daysLate: 9 }))}${ui.pill('late', { daysLate: 22, paid: 80000 })}</div>
        <div class="caption">Glossary words: Paid · Paid late · Part paid · Not paid yet · 22 days late · Part paid — rest is 22 days late (ui.pill(status, {paid}) or ui.monthPill(month)).</div><div class="row row-wrap">${sts.map(s => ui.pill(s, { daysLate: 9, size: 'sm' }))}</div>
        <div class="row row-wrap">${ui.tenantTag('active')}${ui.tenantTag('notice')}${ui.tenantTag('past')}${ui.tag('Urgent', 'bad')}${ui.tag('Scheduled Nov 26', 'accent', 'calendar')}${ui.tag('Month-to-month', 'quiet')}${ui.tag('View only', 'accent', 'key')}</div></div>`)}
      ${sec('Door plates', h`<div class="stack stack-4"><div class="row row-wrap">${['1A', '2B', '101', 'No. 12'].map(u => ui.plate(u))}${ui.plate('3C', { status: 'late' })}${ui.plate('2A', { status: 'partial' })}${ui.plate('—', { status: 'none' })}</div>
        <div class="plates">${sts.map((s, i) => ui.plate(['1A', '2B', '3C', '101', 'No. 8', '303'][i], { size: 'lg', status: s, button: true, title: RB.model.STATUS_LABEL[s] }))}</div></div>`)}
      ${sec('Payment strip', h`<div class="stack stack-3"><div>${ui.strip(cells, { today })}</div><div>${ui.strip(cells, { today, lg: true })}</div></div>`)}
      ${sec('Money, balance, progress', h`<div class="stack stack-4">
        <div class="row row-base gap-5 row-wrap">${ui.money(3412500, { size: 'lg' })}${ui.money(145050, { size: 'md' })}${ui.money(145000)}${ui.money(-12000)}</div>
        <div class="row row-base gap-5 row-wrap">${ui.balance(290000)}${ui.balance(-25000)}${ui.balance(0)}<span class="caption">ui.balance — worded by default</span></div>
        <div style="max-width:320px" class="stack stack-1"><span class="say">Part paid — $800 of $1,475. Still owes $675.</span>${ui.splitBar(80000, 147500)}</div>
        <div style="max-width:560px"><div class="bar bar-lg"><span class="bar-seg bar-seg-ok" style="width:68%"></span><span class="bar-seg bar-seg-warn" style="width:6%"></span><span class="bar-mark" style="left:84%" title="Target"></span></div>
          <div class="bar-legend"><span class="bar-key bar-key-ok">Collected</span><span class="bar-key bar-key-warn">Partial</span><span class="bar-key bar-key-soft">Outstanding</span></div></div>
        <div style="max-width:320px"><div class="bar bar-thin"><span class="bar-seg" style="width:72%"></span><span class="bar-mark" style="left:80%"></span></div></div></div>`)}
      ${sec('Data table', h`<div class="tbl-wrap tbl-scroll-phone"><table class="tbl">
        <thead><tr><th class="tbl-check hide-phone"><input type="checkbox" aria-label="Select all" id="kit-all"></th><th aria-sort="${sortDir}"><button type="button" class="th-sort" data-act="sort">Tenant${ui.icon('arrow-up', { cls: 'sort-ind' })}</button></th><th class="hide-phone"><button type="button" class="th-sort">Property${ui.icon('arrow-up', { cls: 'sort-ind' })}</button></th><th class="num hide-phone"><button type="button" class="th-sort">Rent${ui.icon('arrow-up', { cls: 'sort-ind' })}</button></th><th>Status</th><th class="hide-phone">12 months</th><th class="num">Balance</th></tr></thead>
        <tbody>
          <tr class="is-link"><td class="tbl-check hide-phone"><input type="checkbox" aria-label="Select" id="kit-r1"></td><td><span class="row">${ui.plate('1A')}<span><span class="cell-name">Maya Okafor</span><span class="cell-sub">Dev Okafor</span></span></span></td><td class="hide-phone muted">Alder Court</td><td class="num hide-phone">${ui.money(132500)}</td><td>${ui.pill('paid')}</td><td class="hide-phone">${ui.strip(cells, { today })}</td><td class="num">${ui.balance(0, { zero: '' })}</td></tr>
          <tr class="is-selected"><td class="tbl-check hide-phone"><input type="checkbox" checked aria-label="Select" id="kit-r2"></td><td><span class="row">${ui.plate('3C', { status: 'late' })}<span class="cell-name">Elena Petrova</span></span></td><td class="hide-phone muted">Alder Court</td><td class="num hide-phone">${ui.money(122500)}</td><td>${ui.pill('late', { daysLate: 17 })}</td><td class="hide-phone">${ui.strip(cells.slice().reverse(), { today })}</td><td class="num">${ui.balance(122500)}</td></tr>
          <tr class="is-focused"><td class="tbl-check hide-phone"><input type="checkbox" aria-label="Select" id="kit-r3"></td><td><span class="row">${ui.plate('No. 8')}<span class="cell-name">Ruth Abernathy</span></span></td><td class="hide-phone muted">Fenwick Row</td><td class="num hide-phone">${ui.money(240000)}</td><td>${ui.pill('paid')}</td><td class="hide-phone">${ui.strip(cells, { today })}</td><td class="num">${ui.balance(-25000)}</td></tr>
          <tr class="is-muted"><td class="tbl-check hide-phone"><input type="checkbox" aria-label="Select" id="kit-r4"></td><td><span class="row">${ui.plate('No. 10')}<span class="cell-name">Callum Reid</span></span></td><td class="hide-phone muted">Fenwick Row</td><td class="num hide-phone">${ui.money(205000)}</td><td>${ui.pill('none')}</td><td class="hide-phone">${ui.strip(cells.map(c => ({ ...c, status: 'none' })), { today })}</td><td class="num">${ui.balance(0, { zero: '' })}</td></tr>
        </tbody>
        <tfoot><tr><td class="hide-phone"></td><td>4 tenants</td><td class="hide-phone"></td><td class="num hide-phone">${ui.money(700000)}</td><td></td><td class="hide-phone"></td><td class="num">${ui.money(97500)}</td></tr></tfoot></table></div>
        <div class="totals"><div><span class="micro">Charged</span>${ui.money(3412500)}</div><div><span class="micro">Collected</span>${ui.money(2964000)}</div><div><span class="micro">Outstanding</span>${ui.money(448500, { tone: 'owed' })}</div></div>`)}
      ${sec('Card list (phone rows)', h`<div class="clist" style="max-width:420px">
        <div class="crow"><span class="crow-lead">${ui.plate('3C', { status: 'late' })}</span><div class="crow-main"><div class="crow-title">Elena Petrova</div><div class="crow-sub">Owes $1,225 for November — 17 days late</div></div><div class="crow-aside">${ui.pill('late', { daysLate: 17, size: 'sm' })}${ui.balance(122500)}</div>
          <div class="crow-actions"><button class="btn btn-primary btn-lg" type="button">Record payment</button><button class="btn-link" type="button">They paid part of it</button></div></div>
        <div class="crow"><span class="crow-lead">${ui.plate('1A')}</span><div class="crow-main"><div class="crow-title">Maya Okafor</div><div class="crow-sub">Paid $1,325 on Nov 1 by Zelle</div></div><div class="crow-aside">${ui.pill('paid', { size: 'sm' })}</div></div></div>`)}
      ${sec('Ledger', h`<div style="max-width:640px"><table class="ledger"><thead><tr><th>Date</th><th>Description</th><th class="l-amt">Charge</th><th class="l-amt">Payment</th><th class="l-bal">Balance</th><th class="l-act"><span class="vh">Actions</span></th></tr></thead><tbody>${ledgerRows}</tbody></table></div>`)}
      ${sec('Sections, key/value, copy, kbd', h`<div style="max-width:560px">
        <div class="sec"><h3 class="sec-title">Contact</h3><span class="sec-meta">2 people</span><div class="sec-actions"><button class="btn btn-sm btn-ghost" type="button">${ui.icon('edit')}Edit</button></div></div>
        <dl class="kv"><dt>Phone</dt><dd>${ui.copyline('(555) 0142-3381', 'phone number', { href: 'tel:5550142', hrefLabel: 'Call', hrefIcon: 'phone' })}</dd><dt>Email</dt><dd>${ui.copyline('maya.okafor@example.com', 'email address')}</dd><dt>Emergency</dt><dd>Ada Okafor · (555) 0199-2210</dd></dl>
        <div class="sec sec-sm"><h3 class="sec-title">Micro section</h3></div>
        <p class="caption">Keyboard keys (${ui.kbd('g', 't')}, ${ui.kbd('/')}) still work but are only listed in Settings → Keyboard shortcuts.</p></div>`)}
      ${sec('Lists: attention rows & timeline', h`<div style="max-width:720px"><div class="rule">
        <div class="lrow"><span class="lrow-lead">${ui.plate('3C', { status: 'late' })}</span><div><div class="lrow-title"><span class="lrow-sev sev-high"></span> Elena Petrova</div><div class="lrow-detail">Owes $1,225 for November — 17 days late</div></div><div class="lrow-actions"><button class="btn btn-sm btn-ghost" type="button">Add late fee $50</button><button class="btn btn-sm btn-primary" type="button">Record payment</button></div></div>
        <div class="lrow"><span class="lrow-lead">${ui.plate('202')}</span><div><div class="lrow-title"><span class="lrow-sev sev-medium"></span> No hot water</div><div class="lrow-detail">418 Marlow Street 202 · 1 d open · urgent</div></div><div class="lrow-actions"><button class="btn btn-sm" type="button">Open</button></div></div></div>
        <div class="tl mt-5"><div class="tl-item"><span class="tl-when">Nov 17</span><div class="tl-body">${ui.tag('Text', 'quiet', 'phone')} Texted a reminder about the balance.<div class="tl-meta">Follow up Nov 22 · due</div></div><input type="checkbox" aria-label="Done" id="kit-fu1"></div>
          <div class="tl-item is-done"><span class="tl-when">Oct 21</span><div class="tl-body">${ui.tag('Note', 'quiet', 'note')} Okayed a small vegetable bed.<div class="tl-meta">Done</div></div><input type="checkbox" checked aria-label="Done" id="kit-fu2"></div></div></div>`)}
      ${sec('Empty, loading, first run', h`<div class="stack stack-5"><div class="panel">${ui.empty({ icon: 'tenants', title: 'No tenants match', body: 'Try a different search or clear the filter.', actions: [{ label: 'Show everyone', kind: '' }, { label: 'Add a tenant', kind: 'primary', icon: 'plus' }] })}</div>
        ${ui.empty({ quiet: true, title: 'Nothing needs you today. Enjoy your day.' })}
        <div style="max-width:640px">${ui.loadingNote()}${ui.skeleton({ rows: 3 })}</div>
        <div class="panel" style="padding:0 24px 8px">${ui.firstRun()}</div></div>`)}
      ${sec('Banner', h`<div class="banner" style="border-radius:var(--r-ctl)"><div class="banner-text">You’re looking at <strong>sample tenants</strong>. Look around — nothing here is real.</div><div class="banner-actions"><button type="button" class="btn btn-sm btn-ghost">Remove sample tenants</button><button type="button" class="btn btn-sm">Bring in my tenants</button></div></div>`)}
      ${sec('Floating layers', h`<div class="row row-wrap">
        <button type="button" class="btn" id="kit-pick" data-act="pick">Which tenant? chooser</button><button type="button" class="btn" id="kit-steps" data-act="steps">Step-by-step guide</button><button type="button" class="btn" id="kit-help" data-cmd="help:howto">Help — How do I…?</button><button type="button" class="btn" id="kit-pay" data-act="pay">Payment sheet</button>
        <button type="button" class="btn" id="kit-toast" data-act="toast">Toast</button><button type="button" class="btn" id="kit-toast-undo" data-act="toastUndo">Toast with Undo</button>
        <button type="button" class="btn" id="kit-sheet" data-act="sheet">Sheet</button><button type="button" class="btn" id="kit-confirm" data-act="confirm">Confirm</button>
        <button type="button" class="btn" id="kit-menu" data-act="menu" aria-haspopup="menu">${ui.icon('more')}More</button><button type="button" class="btn" id="kit-drawer" data-act="drawer">Drawer</button>
        <button type="button" class="btn" id="kit-palette" data-act="palette">Find</button></div>`)}
    `);
    ui.showErrors(el.querySelector('#kit-form'), { kbad: 'Enter an amount like 1,450.50' }, { focus: false });
    ui.bind(el, {
      sort: () => { sortDir = sortDir === 'ascending' ? 'descending' : 'ascending'; RB.shell.refresh(); },
      toast: () => ui.toast('Copied receipt', { icon: 'check' }),
      toastUndo: () => ui.toast('Recorded $1,450 from Maya Okafor. All paid up.', { undo: () => ui.toast('Undone — nothing was recorded.') }),
      pick: () => ui.pickTenant({ title: 'Who paid you?', prefer: 'owes' }).then(id => id && ui.toast('You chose ' + RB.store.tenant(id).name + '.')),
      pay: () => { const t = RB.store.tenantsList().find(x => RB.store.ledger(x.id).balance > 0) || RB.store.tenantsList()[0]; if (t) RB.actions.recordPayment(t.id); },
      steps: () => ui.steps({ title: 'Add a tenant (example)', doneLabel: 'Add tenant',
        steps: [
          { title: 'Who is it?', body: (b, d) => h`${ui.field({ name: 'name', id: 'ks-name', label: 'What is their name?', value: d.name || '', required: true, placeholder: 'For example: Maya Okafor' })}` },
          { title: 'Where do they live?', body: (b, d) => h`${ui.field({ name: 'unit', id: 'ks-unit', label: 'Which unit?', value: d.unit || '', required: true, placeholder: 'For example: 1A' })}` },
          { title: 'What do they pay?', body: (b, d) => h`${ui.field({ name: 'rent', id: 'ks-rent', label: 'How much is the rent each month?', type: 'money', big: true, value: d.rent, required: true })}` },
        ],
        summary: d => h`<strong>${d.name}</strong>, Unit ${d.unit}, ${M.fmt(d.rent)} a month.`,
        onDone: d => { ui.toast('This is only an example — ' + d.name + ' was not added.'); } }),
      sheet: () => ui.sheet({ title: 'Record a payment', sub: 'Maya Okafor · Unit 1A, Alder Court', note: 'After this, Maya will be all paid up.',
        body: h`<div class="form-grid">${ui.field({ name: 'a', id: 'ks-amount', label: 'Amount', type: 'money', value: 132500 })}${ui.field({ name: 'd', id: 'ks-date', label: 'Date', type: 'date', value: today })}${ui.field({ name: 'm', id: 'ks-method', label: 'Method', type: 'select', options: ['Zelle', 'Check'] })}${ui.field({ name: 'r', id: 'ks-ref', label: 'Reference', optional: true })}</div>`,
        actions: [{ id: 'ok', label: 'Record $1,325', kind: 'primary' }] }),
      confirm: () => ui.confirm({ title: 'Remove the sample tenants?', body: h`<p class="say">This removes the <strong>27 sample tenants</strong>, their payment history and <strong>6 sample repairs</strong>. Tenants you added yourself stay.</p>`, confirmLabel: 'Remove sample tenants', danger: true }),
      menu: b => ui.menu(b, [{ heading: 'This payment' }, { label: 'Change it', icon: 'edit' }, { label: 'Copy a receipt', icon: 'copy' }, { sep: true }, { label: 'Remove this payment — it was a mistake', icon: 'undo', danger: true }]),
      drawer: () => ui.drawer({ label: 'Example drawer', render: d => { d.innerHTML = String(h`<div class="drawer-head"><div class="grow stack stack-1">${ui.plate('2B', { size: 'lg', status: 'partial' })}<div class="drawer-title">Owen Gallagher</div><div class="muted">Alder Court · ${ui.balance(64500)}</div></div>${ui.drawerClose()}</div><div class="drawer-body"><div class="sec"><h3 class="sec-title">Lease</h3></div><dl class="kv"><dt>Term</dt><dd>Mar 1 – Feb 28, 2027</dd><dt>Rent</dt><dd>${ui.money(137500)}</dd></dl></div><div class="drawer-foot"><button class="btn btn-primary" type="button">Record payment</button></div>`); } }),
      palette: () => RB.shell.openPalette(),
    });
  },
});

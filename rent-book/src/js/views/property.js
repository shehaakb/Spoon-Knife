// views/property.js — one property's repair history (#p-<slug>; slug from RB.model.repairProperties). Rendered by the
// 'repairs' view (views/repairs.js) whenever the route has a property slug.
// Header totals in a sentence, "Spending by year" (bars to scale, amounts written on them), "What the money went on"
// (labelled horizontal bars), "Keep an eye on" (repeat problems + warranties in sentences), then the year-grouped
// timeline with worded filters, a "Showing …" sentence, a by-unit view, "Download for Excel" and "Copy".
// Uses the sheets and helpers in views/repairs.js through RB.repairs (that file loads after this one: use at render time only).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;
const Mo = RB.model;
const BUILDING = Mo.REPAIR_BUILDING;
const R = () => RB.repairs;

let slugNow = null;
let f = { unit: '', category: '', year: '', q: '' };
let mode = 'date';                     // date | unit

const unitText = (key) => (key === BUILDING ? 'Whole building' : Mo.unitWords(key));
const pct = (v, max) => (max > 0 ? v / max : 0);

function header(p, hist, today) {
  const first = hist.firstDate;
  const tenantPaid = hist.all.filter(k => k.paidBy === 'tenant').reduce((s, k) => s + k.cost, 0);
  const total = hist.all.reduce((s, k) => s + k.cost, 0);
  const open = hist.open;
  return h`<header class="pp-head">
    <button type="button" class="btn btn-ghost pp-back" data-act="back">${ui.icon('chevron-left')}<span>All properties</span></button>
    <h1 class="pp-title" id="pp-title">${p.name}</h1>
    <p class="pp-sum" id="pp-sum">${hist.all.length
      ? h`<strong>${RB.plural(hist.all.length, 'repair')}</strong> since ${first.slice(0, 4)} · <strong>${M.fmt(total)}</strong> spent${tenantPaid ? h` <span class="muted">(${M.fmt(tenantPaid)} of it paid by tenants)</span>` : ''}`
      : h`No repairs written down yet`}</p>
    <p class="pp-sub">${p.unitCount ? RB.plural(p.unitCount, 'unit') : 'No units written down yet'}${open.length ? h` · <span class="${open.some(k => k.priority === 'urgent') ? 'tone-bad' : 'tone-warn'} medium">${RB.plural(open.length, 'repair')} still to do</span> <button type="button" class="btn btn-ghost pp-todo-btn" data-act="todo">${ui.icon('arrow-right')}<span>See what’s still to do</span></button>` : ''}</p>
    ${hist.all.length ? h`<div class="pp-actions">
      <button type="button" class="btn btn-primary btn-lg" data-act="log" id="pp-log" data-write>${ui.icon('plus')}<span>Log a repair</span></button>
      <button type="button" class="btn btn-lg" data-act="past" id="pp-past" data-write>${ui.icon('plus')}<span>Add a past repair</span></button>
    </div>` : ''}
  </header>`;
}

function yearsChart(tot, today, p) {
  const curYear = today.slice(0, 4);
  const max = tot.max.year;
  const years = tot.byYear.slice(-10);
  return h`<section class="pp-sec" aria-labelledby="pp-years-title">
    <h2 class="pp-sec-title" id="pp-years-title">Spending by year</h2>
    <ol class="pp-years" style="--n:${years.length}">${years.map(y => h`<li class="pp-yr${y.year === curYear ? ' is-current' : ''}${f.year === y.year ? ' is-picked' : ''}">
      <button type="button" class="pp-yr-btn" data-act="pickYear" data-year="${y.year}" aria-pressed="${String(f.year === y.year)}" aria-label="${y.year}${y.year === curYear ? ' so far' : ''}: ${M.fmt(y.total)} on ${RB.plural(y.count, 'repair')}. Show only these.">
        <span class="pp-yr-plot"><span class="pp-yr-amt">${M.fmt(y.total)}</span><span class="pp-yr-bar" data-total="${y.total}" style="--p:${pct(y.total, max).toFixed(5)}"></span></span>
        <span class="pp-yr-label">${y.year}${y.year === curYear ? h` <span class="pp-yr-so">so far</span>` : ''}</span>
        <span class="pp-yr-n">${RB.plural(y.count, 'repair')}</span>
      </button></li>`)}</ol>
    <p class="pp-caption">What was spent on repairs at ${p.name} each year${years.length < tot.byYear.length ? ' (the last 10 years)' : ''}. Bigger bar = more money. Tap a year to list only that year’s repairs.</p>
  </section>`;
}

function categoryChart(tot) {
  const max = tot.max.category;
  return h`<section class="pp-sec" aria-labelledby="pp-cats-title">
    <h2 class="pp-sec-title" id="pp-cats-title">What the money went on</h2>
    <ul class="pp-cats">${tot.byCategory.map(c => h`<li>
      <button type="button" class="pp-cat${f.category === c.key ? ' is-picked' : ''}" data-act="pickCat" data-cat="${c.key}" aria-pressed="${String(f.category === c.key)}">
        <span class="pp-cat-top"><span class="pp-cat-label">${c.label}</span><span class="pp-cat-amt">${M.fmt(c.total)} <span class="muted">· ${RB.plural(c.count, 'repair')}</span></span></span>
        <span class="pp-cat-track"><span class="pp-cat-bar" data-total="${c.total}" style="--p:${pct(c.total, max).toFixed(5)}"></span></span>
      </button></li>`)}</ul>
    <p class="pp-caption">Each kind of repair, biggest cost first. Longer bar = more money. Tap one to list only those repairs.</p>
  </section>`;
}

function watchList(found) {
  if (!found.length) return '';
  return h`<section class="pp-sec" aria-labelledby="pp-watch-title">
    <h2 class="pp-sec-title" id="pp-watch-title">Keep an eye on</h2>
    <ul class="pp-watch">${found.map((x, i) => h`<li class="pp-watch-item${x.kind === 'repeat' ? ' is-repeat' : ''}">
      <span class="pp-watch-ico">${ui.icon(x.kind === 'repeat' ? 'alert' : 'check', { size: 20 })}</span>
      <div class="pp-watch-main"><p class="pp-watch-text">${x.text}.</p>
        ${x.kind === 'repeat'
          ? h`<button type="button" class="btn" data-act="watch" data-i="${i}">${ui.icon('arrow-right')}<span>See all ${Mo.repairsNoun(2, x.category).replace(/^2 /, '')} ${x.building ? 'for the whole building' : 'in ' + Mo.unitWords(x.unitKey)}</span></button>`
          : h`<button type="button" class="btn" data-act="open" data-id="${x.id}">${ui.icon('arrow-right')}<span>See this repair</span></button>`}</div>
    </li>`)}</ul>
    <p class="pp-caption">We flag a unit when the same kind of repair happens 3 times in a year, or twice in 90 days. Warranties show until they run out.</p>
  </section>`;
}

function filterBar(p, hist, units, years) {
  const any = f.unit || f.category || f.year || f.q;
  return h`<div class="pp-filters" role="group" aria-label="Choose which repairs to show">
    ${ui.field({ name: 'unit', id: 'pp-unit', label: 'Which unit?', type: 'select', value: f.unit, attrs: { 'data-change': 'filter' },
      options: [{ value: '', label: 'All units' }].concat(units.map(u => ({ value: u, label: unitText(u) })), [{ value: BUILDING, label: 'Whole building' }]) })}
    ${ui.field({ name: 'category', id: 'pp-cat', label: 'What kind?', type: 'select', value: f.category, attrs: { 'data-change': 'filter' },
      options: [{ value: '', label: 'All kinds' }].concat(Mo.REPAIR_CATEGORIES.map(c => ({ value: c.key, label: c.label }))) })}
    ${ui.field({ name: 'year', id: 'pp-year', label: 'Which year?', type: 'select', value: f.year, attrs: { 'data-change': 'filter' },
      options: [{ value: '', label: 'All years' }].concat(years.map(y => ({ value: y, label: y }))) })}
    ${ui.field({ name: 'q', id: 'pp-q', label: 'Find a word', type: 'search', value: f.q, placeholder: 'For example: boiler', attrs: { 'data-input': 'find', enterkeyhint: 'search' } })}
  </div>
  <div class="pp-showing-row">
    <p class="pp-showing" id="pp-showing" aria-live="polite">${Mo.repairShowingText(hist)}</p>
    ${any ? h`<button type="button" class="btn btn-ghost" data-act="clear" id="pp-clear">${ui.icon('x')}<span>Show all repairs</span></button>` : ''}
  </div>
  <div class="pp-tools">
    <div class="seg pp-mode" role="group" aria-label="Show the list">
      <button type="button" data-act="mode" data-mode="date" id="pp-mode-date" aria-pressed="${String(mode === 'date')}">By date</button>
      <button type="button" data-act="mode" data-mode="unit" id="pp-mode-unit" aria-pressed="${String(mode === 'unit')}">By unit</button>
    </div>
    <span class="spacer"></span>
    <button type="button" class="btn" data-act="csv" id="pp-csv"${hist.count ? '' : RB.raw(' disabled')}>${ui.icon('download')}<span>Download for Excel</span></button>
    <button type="button" class="btn" data-act="copy" id="pp-copy"${hist.count ? '' : RB.raw(' disabled')}>${ui.icon('copy')}<span>Copy</span></button>
  </div>`;
}

function entry(k, today) {
  const t = k.tenantId && S().tenant(k.tenantId);
  const canCharge = R().canCharge(k);
  return h`<li class="pp-entry" data-ticket="${k.id}">
    <div class="pp-entry-date">${D.fmtLong(k.date).replace(/, \d{4}$/, '')}</div>
    <div class="pp-entry-main">
      <button type="button" class="pp-entry-title" data-act="open" data-id="${k.id}">${k.title || 'Repair'}</button>
      <div class="pp-entry-where">${k.building ? h`<span class="rp-whole">Whole building</span>` : ui.plate(k.unitKey, { property: k.property })}<span class="tag tag-quiet">${Mo.REPAIR_CATEGORY_LABEL[k.category]}</span></div>
      <p class="pp-entry-facts">${k.vendor ? h`Fixed by ${k.vendor} · ` : ''}<span class="pp-entry-cost">${k.cost ? ui.money(k.cost) : 'No cost'}</span>${k.cost ? h` · ${k.paidBy === 'tenant' ? h`paid by the tenant${t ? h` (${t.name})` : ''}${k.chargeId ? ', charged to them' : ''}` : 'paid by you'}` : ''}</p>
      ${k.notes ? h`<p class="pp-entry-notes">${k.notes}</p>` : ''}
      ${k.warrantyUntil ? h`<p class="pp-entry-notes">${k.warrantyUntil >= today ? 'Under warranty until ' : 'Warranty ended '}${D.fmtLong(k.warrantyUntil)}</p>` : ''}
      <div class="pp-entry-actions">
        <button type="button" class="btn" data-act="open" data-id="${k.id}">${ui.icon('edit')}<span>Change or delete</span></button>
        ${canCharge ? h`<button type="button" class="btn btn-soft" data-act="charge" data-id="${k.id}" data-write>Charge ${M.fmt(k.cost)} to ${t.name}</button>` : ''}
      </div>
    </div>
  </li>`;
}

function timeline(hist, today) {
  if (!hist.count) return h`<div class="pp-none">${ui.empty({ quiet: true, title: 'No repairs match. Try “Show all repairs”.' })}</div>`;
  return h`<div class="pp-timeline">${hist.years.map(y => h`<section class="pp-ygroup" aria-labelledby="pp-y-${y.year}">
    <h3 class="pp-yhead" id="pp-y-${y.year}"><span class="pp-yhead-year">${y.year}</span><span class="pp-yhead-sum">${RB.plural(y.count, 'repair')} · ${M.fmt(y.total)}</span></h3>
    <ol class="pp-entries">${y.items.map(k => entry(k, today))}</ol>
  </section>`)}</div>`;
}

function byUnit(hist, today) {
  const tot = Mo.repairTotals(hist.items, { today });
  if (!tot.byUnit.length) return h`<div class="pp-none">${ui.empty({ quiet: true, title: 'No repairs match. Try “Show all repairs”.' })}</div>`;
  return h`<ul class="pp-units">${tot.byUnit.map(u => h`<li class="pp-unit">
    <span class="pp-unit-lead">${u.building ? h`<span class="rp-whole">Whole building</span>` : ui.plate(u.unit)}</span>
    <div class="pp-unit-main">
      <p class="pp-unit-line"><strong>${RB.plural(u.count, 'repair')}</strong> · <strong>${M.fmt(u.total)}</strong></p>
      <p class="pp-unit-last muted">Last: ${u.last.title || 'Repair'}, ${D.fmtLong(u.last.date)}</p>
    </div>
    <button type="button" class="btn" data-act="seeUnit" data-unit="${u.unitKey}">${ui.icon('arrow-right')}<span>See ${u.building ? 'whole-building repairs' : 'repairs for ' + Mo.unitWords(u.unit)}</span></button>
  </li>`)}</ul>`;
}

function emptyProperty(p, hist, today) {
  return h`<div class="pp-empty">${ui.empty({ icon: 'wrench', title: 'No repairs written down for ' + p.name + ' yet',
    body: 'It’s worth doing: a full list of what was fixed and what it cost helps at tax time, with insurance claims, if you ever sell — and it shows you when the same thing keeps breaking.',
    actions: [{ label: 'Log a repair', kind: 'primary', act: 'log', icon: 'plus', write: true }, { label: 'Add a past repair', act: 'past', icon: 'plus', write: true }] })}</div>
    ${hist.open.length ? h`<p class="pp-sub">${RB.plural(hist.open.length, 'repair')} on the to-do list here. <button type="button" class="btn btn-ghost pp-todo-btn" data-act="todo">${ui.icon('arrow-right')}<span>See them</span></button></p>` : ''}`;
}

// The shell routes #p-<slug> to the 'repairs' view with ctx.param = slug; that view calls this.
RB.repairs = RB.repairs || {};
RB.repairs.renderProperty = function renderProperty(el, ctx) {
    const today = ctx.today;
    const slug = ctx.param;
    if (slug !== slugNow) { slugNow = slug; f = { unit: '', category: '', year: '', q: '' }; mode = 'date'; if (ctx.reason !== 'store') window.scrollTo(0, 0); }
    if (ctx.intent && typeof ctx.intent === 'object') { f = Object.assign({ unit: '', category: '', year: '', q: '' }, ctx.intent); mode = 'date'; }
    const p = Mo.propertyBySlug(ctx.state, slug, today);
    if (!p) {
      el.innerHTML = String(h`<div class="pp-notfound">${ui.empty({ icon: 'alert', title: 'We couldn’t find that property', body: 'It may have been renamed, or everything at it was removed.', actions: [{ label: 'See all properties', kind: 'primary', act: 'back', icon: 'chevron-left' }] })}</div>`);
      ui.bind(el, { back: () => R().showHistory() });
      return;
    }
    const whole = Mo.repairHistory(ctx.state, p.name);
    const units = Array.from(new Set(p.units.concat(f.unit && f.unit !== BUILDING ? [f.unit] : []))).sort(RB.natCmp);
    const years = Array.from(new Set(whole.all.map(k => k.year).concat(f.year ? [f.year] : []))).sort().reverse();
    const hist = Mo.repairHistory(ctx.state, p.name, f);
    const tot = Mo.repairTotals(whole.all, { today });
    const found = Mo.repeatProblems(whole.all.concat(whole.open), today);
    el.innerHTML = String(h`<div class="pp">
      ${header(p, whole, today)}
      ${whole.all.length ? h`
        <div class="pp-charts">${yearsChart(tot, today, p)}${categoryChart(tot)}</div>
        ${watchList(found)}
        <section class="pp-sec pp-history" aria-labelledby="pp-hist-title">
          <h2 class="pp-sec-title" id="pp-hist-title">Every repair</h2>
          ${filterBar(p, hist, units, years)}
          ${mode === 'unit' ? byUnit(hist, today) : timeline(hist, today)}
        </section>` : emptyProperty(p, whole, today)}
    </div>`);
    const set = patch => { Object.assign(f, patch); RB.shell.refresh(); };
    const jump = () => { const x = el.querySelector('#pp-hist-title'); if (x && x.scrollIntoView) x.scrollIntoView({ block: 'start' }); };
    ui.bind(el, {
      back: () => R().showHistory(),
      todo: () => R().showTodo(p.name),
      log: () => R().logRepair({ property: p.name, fixedProperty: true, unit: f.unit && f.unit !== BUILDING ? f.unit : '', scope: f.unit === BUILDING ? 'building' : '' }),
      past: () => R().addPastRepair({ property: p.name, unit: f.unit && f.unit !== BUILDING ? f.unit : '', scope: f.unit === BUILDING ? 'building' : '' }),
      open: b => R().openRepair(b.dataset.id),
      charge: b => R().chargeTenant(b.dataset.id),
      filter: s => set({ [s.name]: s.value }),
      find: RB.debounce(i => set({ q: i.value }), 250),
      clear: () => { set({ unit: '', category: '', year: '', q: '' }); },
      pickYear: b => { set({ year: f.year === b.dataset.year ? '' : b.dataset.year }); mode = 'date'; jump(); },
      pickCat: b => { set({ category: f.category === b.dataset.cat ? '' : b.dataset.cat }); mode = 'date'; jump(); },
      watch: b => { const x = found[+b.dataset.i]; if (!x) return; mode = 'date'; set({ unit: x.unitKey, category: x.category, year: '', q: '' }); jump(); },
      seeUnit: b => { mode = 'date'; set({ unit: b.dataset.unit }); jump(); },
      mode: b => { mode = b.dataset.mode; RB.shell.refresh(); },
      csv: () => {
        const name = Mo.propertySlug(p.name) + '-repairs' + (f.year ? '-' + f.year : '') + '.csv';
        RB.actions.downloadFile(name, Mo.repairsCsv(hist.items), 'text/csv');
      },
      copy: () => ui.copy(Mo.repairsText(hist.items, { title: p.name + ' — repairs', showing: Mo.repairShowingText(hist) }), 'the list of repairs'),
    });
};
/** Leaving the property page (the Repairs board or another view): next visit starts unfiltered. */
RB.repairs.leaveProperty = () => { slugNow = null; };

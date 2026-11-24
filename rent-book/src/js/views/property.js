// views/property.js — one property's repair history (#p-<slug>; slug from RB.model.repairProperties). Rendered by the
// 'repairs' view (views/repairs.js) whenever the route has a property slug. SPEC §10.3:
// the one display element is this year's cost in a sentence; "Spending by year" and "What the money went on" (bars to
// scale, quiet: one accent, values written on, short captions); "Keep an eye on" as plain rows with a marker; then the
// list — this year's repairs as rows, earlier years folded to one row each that expands in place — with the filters
// behind one "Filter" control and the "Showing …" sentence. One filled button: "Add a past repair".
// Uses the sheets and helpers in views/repairs.js through RB.repairs (that file loads after this one: use at render time only).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const Mo = RB.model;
const BUILDING = Mo.REPAIR_BUILDING;
const R = () => RB.repairs;
const NOF = { unit: '', category: '', year: '', q: '' };

let slugNow = null;
let f = Object.assign({}, NOF);
let mode = 'date';                     // date | unit
let filterOpen = false;
let openYears = new Set();             // earlier years expanded in place
let allCur = false;                    // this year's list beyond the first few
const CUR_SHOWN = 3;
const CATS_SHOWN = 4;
let allCats = false;                   // "What the money went on" beyond the biggest few

const unitText = key => (key === BUILDING ? 'Whole building' : Mo.unitWords(key));
const pct = (v, max) => (max > 0 ? v / max : 0);
const anyFilter = () => !!(f.unit || f.category || f.year || f.q);

function header(p, hist, today) {
  const year = today.slice(0, 4);
  const yr = hist.all.filter(k => k.year === year);
  const yTotal = yr.reduce((s, k) => s + k.cost, 0);
  const total = hist.all.reduce((s, k) => s + k.cost, 0);
  const tenantPaid = hist.all.filter(k => k.paidBy === 'tenant').reduce((s, k) => s + k.cost, 0);
  const open = hist.open;
  return h`<header class="pp-head">
    <button type="button" class="btn-link pp-back" data-act="back">${ui.icon('chevron-left')}<span>All properties</span></button>
    <h1 class="pp-title" id="pp-title">${p.name}</h1>
    <p class="pp-display" id="pp-yearcost"><span class="pp-fig t-display">${M.fmt(yTotal)}</span> spent on repairs in ${year}${yr.length ? h`, on ${RB.plural(yr.length, 'repair')}` : ''}.</p>
    <p class="pp-sum"><span id="pp-sum">${hist.all.length
      ? h`${RB.plural(hist.all.length, 'repair')} since ${hist.firstDate.slice(0, 4)} · ${M.fmt(total)} spent${tenantPaid ? h` (${M.fmt(tenantPaid)} of it paid by tenants)` : ''}`
      : 'No repairs written down yet'}.</span>
      <span class="pp-sub">${p.unitCount ? RB.plural(p.unitCount, 'unit') : 'No units written down yet'}${open.length ? h` · ${RB.plural(open.length, 'repair')} still to do — <button type="button" class="linkbtn" data-act="todo" id="pp-todo">See them</button>` : ''}</span></p>
    ${hist.all.length ? h`<div class="pp-actions">
      <button type="button" class="btn btn-primary" data-act="past" id="pp-past" data-write>${ui.icon('plus')}<span>Add a past repair</span></button>
      <button type="button" class="btn btn-outline" data-act="log" id="pp-log" data-write>Log a repair</button>
    </div>` : ''}
  </header>`;
}

function yearsChart(tot, today, p) {
  const curYear = today.slice(0, 4);
  const max = tot.max.year;
  const years = tot.byYear.slice(-10);
  return h`<section class="pp-sec" aria-labelledby="pp-years-title">
    <h2 class="pp-sec-title" id="pp-years-title">Spending by year</h2>
    <ol class="pp-years" style="--n:${years.length}">${years.map(y => h`<li class="pp-yr${y.year === curYear ? ' is-current' : ''}">
      <button type="button" class="pp-yr-btn" data-act="pickYear" data-year="${y.year}" aria-pressed="${String(f.year === y.year)}" aria-label="${y.year}${y.year === curYear ? ' so far' : ''}: ${M.fmt(y.total)} on ${RB.plural(y.count, 'repair')}. Show only these.">
        <span class="pp-yr-plot"><span class="pp-yr-amt">${M.fmt(y.total)}</span><span class="pp-yr-bar" data-total="${y.total}" style="--p:${pct(y.total, max).toFixed(5)}"></span></span>
        <span class="pp-yr-label">${y.year}${y.year === curYear ? ' so far' : ''}</span>
      </button></li>`)}</ol>
    <p class="pp-caption">Choose a year to list its repairs.</p>
  </section>`;
}

function categoryChart(tot) {
  const max = tot.max.category;
  return h`<section class="pp-sec" aria-labelledby="pp-cats-title">
    <h2 class="pp-sec-title" id="pp-cats-title">What the money went on</h2>
    <ul class="pp-cats">${(allCats || tot.byCategory.length <= CATS_SHOWN + 1 ? tot.byCategory : tot.byCategory.slice(0, CATS_SHOWN)).map(c => h`<li>
      <button type="button" class="pp-cat" data-act="pickCat" data-cat="${c.key}" aria-pressed="${String(f.category === c.key)}">
        <span class="pp-cat-top"><span class="pp-cat-label">${c.label}</span><span class="pp-cat-amt">${M.fmt(c.total)} · ${RB.plural(c.count, 'repair')}</span></span>
        <span class="pp-cat-track"><span class="pp-cat-bar" data-total="${c.total}" style="--p:${pct(c.total, max).toFixed(5)}"></span></span>
      </button></li>`)}</ul>
    ${tot.byCategory.length > CATS_SHOWN + 1 ? h`<button type="button" class="rows-more" id="pp-cats-more" data-act="allCats" aria-expanded="${String(allCats)}">${allCats ? 'Show only the biggest' : 'Show all ' + tot.byCategory.length + ' kinds'}</button>` : ''}
    <p class="pp-caption">Biggest first. Choose one to list those repairs.</p>
  </section>`;
}

function watchList(found) {
  if (!found.length) return '';
  return h`<section class="pp-sec" aria-labelledby="pp-watch-title">
    <h2 class="pp-sec-title" id="pp-watch-title">Keep an eye on</h2>
    <ul class="rows rows-inset pp-watch">${found.map((x, i) => ui.row({
      title: x.text + '.', status: x.kind === 'repeat' ? ui.status('warn', 'Repeat') : ui.status('ok', 'Warranty'), statusPos: 'main',
      act: x.kind === 'repeat' ? 'watch' : 'open', attrs: x.kind === 'repeat' ? { 'data-i': i, 'data-kind': 'repeat' } : { 'data-id': x.id, 'data-kind': 'warranty' },
    }))}</ul>
    <p class="pp-caption">Same repair 3 times in a year, or twice in 90 days.</p>
  </section>`;
}

function filterPanel(units, years) {
  return h`<div class="pp-filters" id="pp-filters"${filterOpen ? '' : RB.raw(' hidden')}>
    ${ui.field({ name: 'unit', id: 'pp-unit', label: 'Which unit?', type: 'select', value: f.unit, attrs: { 'data-change': 'filter' },
      options: [{ value: '', label: 'All units' }].concat(units.map(u => ({ value: u, label: unitText(u) })), [{ value: BUILDING, label: 'Whole building' }]) })}
    ${ui.field({ name: 'category', id: 'pp-cat', label: 'What kind?', type: 'select', value: f.category, attrs: { 'data-change': 'filter' },
      options: [{ value: '', label: 'All kinds' }].concat(Mo.REPAIR_CATEGORIES.map(c => ({ value: c.key, label: c.label }))) })}
    ${ui.field({ name: 'year', id: 'pp-year', label: 'Which year?', type: 'select', value: f.year, attrs: { 'data-change': 'filter' },
      options: [{ value: '', label: 'All years' }].concat(years.map(y => ({ value: y, label: y }))) })}
    ${ui.field({ name: 'q', id: 'pp-q', label: 'Find a word', type: 'search', value: f.q, placeholder: 'For example: boiler', attrs: { 'data-input': 'find', enterkeyhint: 'search' } })}
    <div class="field pp-mode-field"><span class="field-label" id="pp-mode-l">List them</span>
      <div class="seg pp-mode" role="group" aria-labelledby="pp-mode-l">
        <button type="button" data-act="mode" data-mode="date" id="pp-mode-date" aria-pressed="${String(mode === 'date')}">By date</button>
        <button type="button" data-act="mode" data-mode="unit" id="pp-mode-unit" aria-pressed="${String(mode === 'unit')}">By unit</button>
      </div></div>
  </div>`;
}

function entryRow(k, today) {
  const where = k.building ? 'Whole building' : Mo.unitWords(k.unitKey);
  return ui.row({ title: k.title || 'Repair', sub: [R().shortDay(k.date, today), where, k.vendor].filter(Boolean).join(' · '),
    amt: k.cost ? M.fmt(k.cost) : 'No cost', act: 'open', attrs: { 'data-id': k.id, 'data-ticket': k.id } });
}

function timeline(hist, today) {
  if (!hist.count) return h`<p class="pp-none">No repairs match. Try “Show all repairs”.</p>`;
  const cur = today.slice(0, 4);
  return h`<div class="pp-timeline">${hist.years.map((y, i) => {
    const open = anyFilter() || y.year === cur || (i === 0 && hist.years.every(x => x.year !== cur)) || openYears.has(y.year);
    const head = h`${y.year} — ${RB.plural(y.count, 'repair')}`;
    const cut = !anyFilter() && !allCur && y.year === cur && y.items.length > CUR_SHOWN + 1;
    return open
      ? h`<section class="pp-ygroup" aria-labelledby="pp-y-${y.year}">
        <h3 class="rows-head pp-yhead" id="pp-y-${y.year}"><span class="pp-yhead-year">${y.year}</span> · ${RB.plural(y.count, 'repair')} · ${M.fmt(y.total)}${openYears.has(y.year) && !anyFilter() ? h` <button type="button" class="linkbtn pp-yfold" data-act="year" data-year="${y.year}">Fold it away</button>` : ''}</h3>
        <ul class="rows rows-inset pp-entries">${(cut ? y.items.slice(0, CUR_SHOWN) : y.items).map(k => entryRow(k, today))}</ul>
        ${cut ? h`<button type="button" class="rows-more" data-act="allCur" id="pp-cur-more">Show all ${y.count} from ${y.year}</button>` : ''}</section>`
      : h`<ul class="rows rows-inset pp-yrows">${ui.row({ title: head, amt: M.fmt(y.total), sub: 'Show them', act: 'year', attrs: { 'data-year': y.year, 'aria-expanded': 'false' } })}</ul>`;
  })}</div>`;
}

function byUnit(hist, today) {
  const tot = Mo.repairTotals(hist.items, { today });
  if (!tot.byUnit.length) return h`<p class="pp-none">No repairs match. Try “Show all repairs”.</p>`;
  return h`<ul class="rows rows-inset pp-units">${tot.byUnit.map(u => ui.row({
    lead: u.building ? '' : ui.plate(u.unit),
    title: u.building ? 'Whole building' : Mo.unitWords(u.unit),
    sub: RB.plural(u.count, 'repair') + ' · last: ' + (u.last.title || 'Repair') + ', ' + R().shortDay(u.last.date, today),
    amt: M.fmt(u.total), act: 'seeUnit', attrs: { 'data-unit': u.unitKey },
  }))}</ul>`;
}

function emptyProperty(p, hist) {
  return h`<div class="pp-empty">${ui.empty({ title: 'No repairs written down for ' + p.name + ' yet',
    body: 'A list of what was fixed and what it cost helps at tax time, with insurance, if you ever sell — and it shows you when the same thing keeps breaking. It’s worth doing.',
    actions: [{ label: 'Add a past repair', kind: 'primary', act: 'past', write: true }, { label: 'Log a repair', kind: 'outline', act: 'log', write: true }] })}</div>
    ${hist.open.length ? h`<p class="pp-sub">${RB.plural(hist.open.length, 'repair')} on the to-do list here — <button type="button" class="linkbtn" data-act="todo">See them</button></p>` : ''}`;
}

// The shell routes #p-<slug> to the 'repairs' view with ctx.param = slug; that view calls this.
RB.repairs = RB.repairs || {};
RB.repairs.renderProperty = function renderProperty(el, ctx) {
  const today = ctx.today;
  const slug = ctx.param;
  if (slug !== slugNow) { slugNow = slug; f = Object.assign({}, NOF); mode = 'date'; filterOpen = false; openYears = new Set(); allCur = false; allCats = false; if (ctx.reason !== 'store') window.scrollTo(0, 0); }
  if (ctx.intent && typeof ctx.intent === 'object') { f = Object.assign({}, NOF, ctx.intent); mode = 'date'; }
  const p = Mo.propertyBySlug(ctx.state, slug, today);
  if (!p) {
    el.innerHTML = String(h`<div class="pp-notfound">${ui.empty({ title: 'We couldn’t find that property', body: 'It may have been renamed, or everything at it was removed.', actions: [{ label: 'See all properties', kind: 'primary', act: 'back' }] })}</div>`);
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
        <div class="pp-showing-row">
          <p class="pp-showing"><span id="pp-showing" aria-live="polite">${Mo.repairShowingText(hist)}</span>${anyFilter() ? h` — <button type="button" class="linkbtn" data-act="clear" id="pp-clear">Show all repairs</button>` : ''}</p>
          <button type="button" class="btn btn-outline pp-filter-btn" data-act="filters" id="pp-filter" aria-expanded="${String(filterOpen)}" aria-controls="pp-filters">${ui.icon('filter')}<span>${filterOpen ? 'Hide the filter' : 'Filter'}</span></button>
        </div>
        ${filterPanel(units, years)}
        ${mode === 'unit' ? byUnit(hist, today) : timeline(hist, today)}
        <p class="pp-tools">
          <button type="button" class="btn-link" data-act="csv" id="pp-csv"${hist.count ? '' : RB.raw(' disabled')}>Download for Excel</button>
          <button type="button" class="btn-link" data-act="copy" id="pp-copy"${hist.count ? '' : RB.raw(' disabled')}>Copy as text</button>
        </p>
      </section>` : emptyProperty(p, whole)}
  </div>`);
  const set = patch => { Object.assign(f, patch); RB.shell.refresh(); };
  const jump = () => { const x = el.querySelector('#pp-hist-title'); if (x && x.scrollIntoView) x.scrollIntoView({ block: 'start' }); };
  ui.bind(el, {
    back: () => R().showHistory(),
    todo: () => R().showTodo(p.name),
    log: () => R().logRepair({ property: p.name, fixedProperty: true, unit: f.unit && f.unit !== BUILDING ? f.unit : '', scope: f.unit === BUILDING ? 'building' : '' }),
    past: () => R().addPastRepair({ property: p.name, unit: f.unit && f.unit !== BUILDING ? f.unit : '', scope: f.unit === BUILDING ? 'building' : '' }),
    open: b => R().openRepair(b.dataset.id),
    allCats: () => { allCats = !allCats; RB.shell.refresh(); },
    allCur: () => { allCur = true; RB.shell.refresh(); },
    filters: () => { filterOpen = !filterOpen; RB.shell.refresh(); },
    filter: s => set({ [s.name]: s.value }),
    find: RB.debounce(i => set({ q: i.value }), 250),
    clear: () => { set(Object.assign({}, NOF)); },
    year: b => { const y = b.dataset.year; if (openYears.has(y)) openYears.delete(y); else openYears.add(y); RB.shell.refresh(); const x = el.querySelector(openYears.has(y) ? '#pp-y-' + y : '[data-act="year"][data-year="' + y + '"]'); if (x && x.focus) { if (!x.matches('button')) x.setAttribute('tabindex', '-1'); x.focus({ preventScroll: false }); } },
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

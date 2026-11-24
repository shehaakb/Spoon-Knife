// views/tenants.js — Tenants list (#tenants): one calm list of large rows (cards on phone). Hosts the #t-<id>
// tenant page (tenant-detail.js) and uses the sheets in tenant-forms.js. Plain-language rules: docs/SPEC.md §8.
// UI state lives in module variables; conveniences (filter, sort, grouping) are remembered with RB.prefs.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});

// 'ending' is reachable only from the "Leases ending soon" line, not as a fourth button.
const FILTERS = [['all', 'Everyone'], ['owing', 'Owes money'], ['past', 'Moved out']];
const SORTS = [['urgency', 'Who needs attention'], ['name', 'Name'], ['unit', 'Unit']];

let filter = RB.prefs.get('tn:filter', 'all');
if (!['all', 'owing', 'past', 'ending'].includes(filter)) filter = 'all';
let sort = RB.prefs.get('tn:sort', 'urgency');
if (sort && typeof sort === 'object') sort = sort.key;
if (!SORTS.some(s => s[0] === sort)) sort = 'urgency';
let group = !!RB.prefs.get('tn:group', false);
let query = '';
let cursor = null;   // tenant id under the keyboard cursor

// ------------------------------------------------------------------ data
function rowsFor(ctx) {
  const S = ctx.store;
  return S.tenantsList().map(t => {
    const lg = S.ledger(t.id);
    const sum = RB.model.tenantSummary(t, lg, ctx.state.settings, ctx.today);
    return { t, lg, sum, ls: sum.lease };
  });
}
const PRED = {
  all: r => r.t.status !== 'past',
  owing: r => r.lg.balance > 0,
  ending: r => r.t.status === 'active' && r.ls.kind === 'fixed' && r.ls.inNoticeWindow,
  past: r => r.t.status === 'past',
};
const hay = t => [t.name, t.unit, 'unit ' + t.unit, t.property, [t.property, t.unit].join(' '), t.phone, t.email, (t.coTenants || []).map(c => c && c.name).join(' ')].join(' · ');
function cmp(a, b) {
  let c = 0;
  if (sort === 'urgency') c = a.sum.urgency - b.sum.urgency || b.lg.balance - a.lg.balance;
  else if (sort === 'name') c = RB.natCmp(a.t.name, b.t.name);
  else c = RB.natCmp(a.t.property, b.t.property) || RB.natCmp(a.t.unit, b.t.unit);
  return c || RB.natCmp(a.t.property, b.t.property) || RB.natCmp(a.t.unit, b.t.unit) || RB.natCmp(a.t.name, b.t.name);
}
function visible(rows) {
  const q = query.trim();
  const base = q && filter === 'all' ? rows : rows.filter(PRED[filter]);
  const out = q ? base.filter(r => ui.match(hay(r.t), q) >= 0) : base;
  out.sort(cmp);
  if (group) {
    const by = new Map();
    out.forEach(r => { const k = r.t.property || 'No property'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    return Array.from(by.keys()).sort(RB.natCmp).map(k => ({ property: k, rows: by.get(k) }));
  }
  return [{ property: null, rows: out }];
}

// ------------------------------------------------------------------ rows
const coNames = t => (t.coTenants || []).filter(c => c && c.name).map(c => c.name).join(', ');
function row(r, ctx) {
  const t = r.t;
  const W = T.W;
  const st = W.status(t, r.lg, ctx.today);
  const le = W.lease(t, r.ls, ctx.today);
  const co = coNames(t);
  const cls = ['tn-row', t.status === 'past' ? 'is-past' : '', ctx.param === t.id ? 'is-selected' : '', cursor === t.id && ctx.param !== t.id ? 'is-focused' : ''].filter(Boolean).join(' ');
  const plateSt = ['late', 'partial'].includes(r.lg.current.status) ? r.lg.current.status : '';
  return h`<a class="${cls}" href="#t-${t.id}" data-act="open" data-id="${t.id}">
    <span class="tn-row-plate">${ui.plate(t.unit, { status: plateSt })}</span>
    <span class="tn-row-who"><span class="tn-row-name">${t.name || 'Unnamed tenant'}</span><span class="tn-row-place">${T.place(t)}${co ? h` · with ${co}` : ''}</span></span>
    <span class="tn-row-money tone-${st.tone || 'ink'}">${st.text}</span>
    <span class="tn-row-lease${le.tone ? ' tone-' + le.tone : ''}">${t.status === 'past' ? '' : le.text}</span>
    <span class="tn-row-open" aria-hidden="true"><span>Open</span>${ui.icon('chevron-right')}</span>
  </a>`;
}

// ------------------------------------------------------------------ render
function render(el, ctx) {
  const W = T.W;
  const all = rowsFor(ctx);
  // A deep link can open a tenant the current filter hides (e.g. a moved-out tenant under "Everyone").
  // Switch the list to one that contains them so the highlight and Previous/Next agree. Not remembered.
  if (ctx.param && ctx.reason !== 'refresh') {
    const mine = all.find(r => r.t.id === ctx.param);
    if (mine && !visible(all).some(g => g.rows.includes(mine))) {
      query = '';
      if (!PRED[filter](mine)) filter = ['all', 'past', 'owing'].find(k => PRED[k](mine)) || filter;
    }
  }
  const counts = {};
  Object.keys(PRED).forEach(k => { counts[k] = all.filter(PRED[k]).length; });
  const groups = visible(all);
  const flat = groups.flatMap(g => g.rows);
  T.order = flat.map(r => r.t.id);
  if (cursor && !T.order.includes(cursor)) cursor = null;
  if (ctx.param && T.order.includes(ctx.param)) cursor = ctx.param;

  const current = all.filter(PRED.all);
  const props = new Set(current.map(r => r.t.property).filter(Boolean));
  const monthly = current.reduce((s, r) => s + r.sum.rent, 0);
  const owing = all.filter(PRED.owing);
  const owed = owing.reduce((s, r) => s + r.lg.balance, 0);
  const ending = all.filter(PRED.ending).sort((a, b) => D.cmp(a.ls.end, b.ls.end));
  const q = query.trim();
  const filterLabel = filter === 'ending' ? 'Leases ending soon' : FILTERS.find(f => f[0] === filter)[1];

  const choice = ([k, label]) => h`<button type="button" class="tn-choice" aria-pressed="${String(filter === k)}" data-act="filter" data-k="${k}"><span>${label}</span> <span class="tn-choice-n">(${counts[k]})</span></button>`;
  const sortBtn = ([k, label]) => h`<button type="button" aria-pressed="${String(sort === k)}" data-act="sort" data-k="${k}">${label}</button>`;
  const list = groups.map(g => h`${g.property !== null ? h`<h3 class="tn-group">${g.property} <span class="tn-group-n">— ${RB.plural(g.rows.length, 'tenant')}</span></h3>` : ''}${g.rows.map(r => row(r, ctx))}`);
  const emptyMsg = q
    ? { icon: 'search', title: 'Nobody matches “' + q + '”', body: filter !== 'all' ? 'Only “' + filterLabel + '” is being searched. Try Everyone, or check the spelling.' : 'You can search by name, unit, property, phone number or email.', actions: [{ label: 'Clear the search', kind: 'primary', act: 'clearq' }] }
    : { icon: 'tenants', title: { owing: 'Nobody owes money', ending: 'No leases end soon', past: 'Nobody has moved out yet', all: 'No tenants yet' }[filter], body: { owing: 'Everyone is paid up.', ending: 'No lease ends in the next ' + ctx.state.settings.leaseNoticeDays + ' days.', past: 'When someone moves out, they stay here with their payment history.', all: 'Add a tenant to start.' }[filter], actions: filter === 'all' ? [{ label: 'Add a tenant', kind: 'primary', act: 'add', icon: 'plus' }] : [{ label: 'Show everyone', kind: 'primary', act: 'filter', attrs: { 'data-k': 'all' } }] };

  el.innerHTML = String(h`
    <div class="tn-top">
      <p class="tn-summary"><strong>${RB.plural(current.length, 'tenant')}</strong> in ${RB.plural(props.size, 'property', 'properties')}. Rent each month: <strong>${W.$(monthly)}</strong>.${owing.length ? h` <span class="tone-bad">${owing.length === 1 ? '1 tenant owes' : owing.length + ' tenants owe'} a total of ${W.$(owed)}.</span>` : ' Nobody owes money.'}</p>
      <button type="button" class="btn btn-primary btn-lg tn-add-btn" data-act="add" data-write>${ui.icon('plus')}<span>Add a tenant</span></button>
    </div>
    <div class="tn-find">
      <label class="tn-find-label" for="tn-q">Find a tenant by name or unit</label>
      <div class="tn-find-row">
        <span class="search tn-search"><span class="search-icon">${ui.icon('search')}</span><input class="input" type="search" id="tn-q" placeholder="For example: Maya or 2B" value="${query}" data-input="q" autocomplete="off" spellcheck="false"></span>
        ${q ? h`<button type="button" class="btn btn-lg tn-q-clear" data-act="clearq">Clear</button>` : ''}
      </div>
    </div>
    <div class="tn-show" role="group" aria-label="Show">${FILTERS.map(choice)}</div>
    ${ending.length ? h`<p class="tn-ending">${ui.icon('leases')}<span>${ending.length === 1 ? 'A lease ends soon' : ending.length + ' leases end soon'}: ${RB.html.join(ending.slice(0, 3).map(r => h`<strong>${r.t.name}</strong> (${W.date(r.ls.end, ctx.today)})`), ', ')}${ending.length > 3 ? ' and more' : ''}.</span>
      ${filter === 'ending' ? h`<button type="button" class="btn" data-act="filter" data-k="all">Show everyone</button>` : h`<button type="button" class="btn" data-act="filter" data-k="ending">Show them</button>`}</p>` : ''}
    <div class="tn-tools">
      <div class="tn-sort"><span class="tn-sort-label" id="tn-sort-label">Sort by:</span><div class="seg tn-sortseg" role="group" aria-labelledby="tn-sort-label">${SORTS.map(sortBtn)}</div></div>
      <label class="check tn-groupby"><input type="checkbox" id="tn-group" data-change="group"${group ? RB.raw(' checked') : ''}><span>Group by property</span></label>
    </div>
    <p class="tn-count" id="tn-count">${q ? h`${RB.plural(flat.length, 'tenant')} found for “${q}”` : filter === 'all' ? h`Showing everyone (${flat.length})` : h`Showing: ${filterLabel} (${flat.length})`}</p>
    ${flat.length ? h`<div class="tn-list" id="tn-list">${list}</div>` : ui.empty(emptyMsg)}
  `);

  ui.bind(el, {
    open: (b, e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); cursor = b.dataset.id; RB.actions.openTenant(b.dataset.id); },
    filter: b => { filter = b.dataset.k; if (filter !== 'ending') RB.prefs.set('tn:filter', filter); cursor = null; RB.shell.refresh(); },
    sort: b => { sort = b.dataset.k; RB.prefs.set('tn:sort', sort); RB.shell.refresh(); },
    group: inp => { group = !!inp.checked; RB.prefs.set('tn:group', group); RB.shell.refresh(); },
    q: inp => { query = inp.value; refreshSoon(); },
    clearq: () => { query = ''; RB.shell.refresh(); const i = document.getElementById('tn-q'); if (i) i.focus(); },
    add: () => RB.actions.addTenant(),
  });
  const qi = el.querySelector('#tn-q');
  if (qi && !qi._tnKeys) {
    qi._tnKeys = true;
    qi.addEventListener('keydown', e => {
      if (e.key === 'Escape' && qi.value) { e.preventDefault(); e.stopPropagation(); query = ''; RB.shell.refresh(); }
      else if (e.key === 'Enter') { const first = T.order[0]; if (first) { e.preventDefault(); cursor = first; qi.blur(); RB.actions.openTenant(first); } }
    });
  }

  // tenant page
  const d = ui.currentDrawer();
  if (ctx.param) {
    if (!d || ctx.reason === 'mount' || ctx.reason === 'route' || !d.el.dataset.tid || d.el.dataset.tid !== ctx.param) T.openDrawer(ctx.param);
    else d.rerender();
  } else if (d) d.close({ silent: true });
  layout(el, !!ctx.param);
  if (ctx.reason === 'route' && ctx.param) scrollToRow(el, ctx.param);
}
const refreshSoon = RB.debounce(() => RB.shell.refresh(), 60);

/** Desktop: keep the list visible beside the tenant page when there is room; narrower lists drop the lease line. */
function layout(el, open) {
  el.style.paddingRight = '';
  el.classList.remove('tn-split', 'tn-narrow');
  if (!open || ui.isPhone()) return;
  const r = el.getBoundingClientRect();
  const dr = document.querySelector('.drawer');
  const dw = dr ? dr.getBoundingClientRect().width : Math.min(560, window.innerWidth);
  const pad = Math.max(0, Math.round(r.right - (window.innerWidth - dw) + 24));
  const avail = r.width - pad;
  if (avail < 420) return;    // too narrow to share: the tenant page simply covers the list
  el.classList.add('tn-split');
  el.style.paddingRight = pad + 'px';
  if (avail < 900) el.classList.add('tn-narrow');
}
window.addEventListener('resize', RB.debounce(() => { const c = RB.shell.current(); const root = RB.shell.root(); if (c.view === 'tenants' && root && root.dataset.view === 'tenants') layout(root, !!c.param); }, 100));

function scrollToRow(el, id) {
  const row = Array.from(el.querySelectorAll('[data-id]')).find(x => x.dataset.id === id && x.offsetParent);
  if (!row) return;
  const r = row.getBoundingClientRect();
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || 56;
  if (r.top < top + 40 || r.bottom > window.innerHeight - 8) row.scrollIntoView({ block: 'center' });
}

function moveCursor(dir) {
  if (!T.order.length) return;
  const i = T.order.indexOf(cursor);
  cursor = T.order[i < 0 ? (dir > 0 ? 0 : T.order.length - 1) : Math.max(0, Math.min(T.order.length - 1, i + dir))];
  RB.shell.refresh();
  const root = RB.shell.root();
  if (root) scrollToRow(root, cursor);
}

RB.views.register('tenants', {
  title: 'Tenants',
  shortcuts: [['j / k', 'Move between tenants'], ['↓ / ↑', 'Move between tenants'], ['Enter', 'Open tenant'], ['p', 'Record a payment'], ['e', 'Edit their details'], ['Esc', 'Close the tenant']],
  render,
  onKey(e, ctx) {
    const k = e.key;
    const down = k === 'j' || k === 'ArrowDown', up = k === 'k' || k === 'ArrowUp';
    if (ctx.param) {
      if (down || up) { T.step(down ? 1 : -1); return true; }
      if (k === 'p') { RB.actions.recordPayment(ctx.param); return true; }
      if (k === 'e') { RB.actions.editTenant(ctx.param); return true; }
      return false;
    }
    if (down || up) { moveCursor(down ? 1 : -1); return true; }
    if (k === 'Enter' && cursor) { RB.actions.openTenant(cursor); return true; }
    if (k === 'p' && cursor) { RB.actions.recordPayment(cursor); return true; }
    if (k === 'e' && cursor) { RB.actions.editTenant(cursor); return true; }
    if (k === 'f') { const i = document.getElementById('tn-q'); if (i) { i.focus(); i.select(); return true; } }
    return false;
  },
  destroy() { const d = ui.currentDrawer(); if (d) d.close({ silent: true }); },
});

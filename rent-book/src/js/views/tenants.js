// views/tenants.js — Tenants list (#tenants): table on desktop, cards on phone. Hosts the #t-<id> drawer
// (tenant-detail.js) and uses the sheets in tenant-forms.js. UI state lives in module variables; conveniences
// (filter, sort, grouping, density) are remembered with RB.prefs.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});

const FILTERS = [['all', 'All'], ['owing', 'Owing'], ['ending', 'Lease ending'], ['notice', 'Notice'], ['past', 'Past']];
const SORTS = {
  urgency: { label: 'Urgency', dir: 1 },
  name: { label: 'Name', dir: 1 },
  property: { label: 'Property and unit', dir: 1 },
  rent: { label: 'Rent', dir: -1 },
  status: { label: 'This month', dir: 1 },
  balance: { label: 'Balance', dir: -1 },
  lease: { label: 'Lease end', dir: 1 },
};
const STATUS_ORDER = { late: 0, partial: 1, due: 2, paid_late: 3, paid: 4, none: 5 };

let filter = RB.prefs.get('tn:filter', 'all');
if (!FILTERS.some(f => f[0] === filter)) filter = 'all';
let sort = RB.prefs.get('tn:sort', { key: 'urgency', dir: 1 });
if (!sort || !SORTS[sort.key]) sort = { key: 'urgency', dir: 1 };
let group = !!RB.prefs.get('tn:group', false);
let density = RB.prefs.get('tn:density', 'comfortable') === 'compact' ? 'compact' : 'comfortable';
let query = '';
let cursor = null;   // tenant id under the keyboard cursor

// ------------------------------------------------------------------ data
function rowsFor(ctx) {
  const S = ctx.store;
  const end = D.monthKey(ctx.today);
  return S.tenantsList().map(t => {
    const lg = S.ledger(t.id);
    const sum = RB.model.tenantSummary(t, lg, ctx.state.settings, ctx.today);
    return { t, lg, sum, ls: sum.lease, cells: RB.model.monthsBack(lg, end, 12) };
  });
}
const PRED = {
  all: r => r.t.status !== 'past',
  owing: r => r.lg.balance > 0,
  ending: r => r.t.status === 'active' && r.ls.kind === 'fixed' && r.ls.inNoticeWindow,
  notice: r => r.t.status === 'notice',
  past: r => r.t.status === 'past',
};
const hay = t => [t.name, t.unit, t.property, [t.property, t.unit].join(' '), t.phone, t.email, (t.coTenants || []).map(c => c && c.name).join(' ')].join(' · ');
function leaseKey(r) {
  if (r.t.status === 'past') return 1e7;
  if (r.ls.moveOut && r.t.status === 'notice') return D.toDays(r.ls.moveOut) - 1e5;
  if (r.ls.kind === 'fixed' || r.ls.kind === 'upcoming') return r.ls.end ? D.toDays(r.ls.end) : 1e6;
  return 1e6; // month-to-month after dated leases
}
function cmp(a, b) {
  const k = sort.key;
  let c = 0;
  if (k === 'urgency') c = a.sum.urgency - b.sum.urgency || b.lg.balance - a.lg.balance;
  else if (k === 'name') c = RB.natCmp(a.t.name, b.t.name);
  else if (k === 'property') c = RB.natCmp(a.t.property, b.t.property) || RB.natCmp(a.t.unit, b.t.unit);
  else if (k === 'rent') c = a.sum.rent - b.sum.rent;
  else if (k === 'status') c = STATUS_ORDER[a.lg.current.status] - STATUS_ORDER[b.lg.current.status] || b.lg.current.daysLate - a.lg.current.daysLate;
  else if (k === 'balance') c = a.lg.balance - b.lg.balance;
  else if (k === 'lease') c = leaseKey(a) - leaseKey(b);
  c *= sort.dir;
  return c || RB.natCmp(a.t.property, b.t.property) || RB.natCmp(a.t.unit, b.t.unit) || RB.natCmp(a.t.name, b.t.name);
}
function visible(rows) {
  const q = query.trim();
  let out;
  if (q) {
    const base = filter === 'all' ? rows : rows.filter(PRED[filter]);
    out = base.filter(r => ui.match(hay(r.t), q) >= 0);
  } else out = rows.filter(PRED[filter]);
  out.sort(cmp);
  if (group) {
    const by = new Map();
    out.forEach(r => { const k = r.t.property || '—'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    return Array.from(by.keys()).sort(RB.natCmp).map(k => ({ property: k, rows: by.get(k) }));
  }
  return [{ property: null, rows: out }];
}

// ------------------------------------------------------------------ cells
const coNames = t => (t.coTenants || []).filter(c => c && c.name).map(c => c.name).join(', ');
function leaseCell(r, today) {
  const ls = r.ls;
  if (r.t.status === 'past') return h`<span class="faint">ended${ls.moveOut ? ' ' + D.fmt(ls.moveOut, today) : ''}</span>`;
  if (r.t.status === 'notice' && ls.moveOut) return h`<span class="tone-warn" title="Moves out ${D.fmt(ls.moveOut, today)}">${ui.icon('door', { size: 12, cls: 'tn-ico-inline' })}out ${D.rel(ls.moveOut, today)}</span>`;
  if (ls.kind === 'mtm') return h`<span class="faint">month-to-month</span>`;
  if (ls.kind === 'upcoming') return h`<span class="tone-accent">${ls.label}</span>`;
  return h`<span class="${ls.inNoticeWindow ? 'tone-warn' : 'muted'}" title="Lease ends ${D.fmt(ls.end, today)}">${ls.label}</span>`;
}
const pill = (r, size) => ui.pill(r.lg.current.status, { daysLate: r.lg.current.daysLate, size, title: r.lg.current.status === 'none' ? (r.t.status === 'past' ? 'Moved out' : 'No charge this month') : null });

function th(key, label, cls) {
  const on = sort.key === key;
  return h`<th class="${cls || ''}"${on ? h` aria-sort="${sort.dir === 1 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="th-sort" data-act="sort" data-k="${key}">${label}${ui.icon('arrow-up', { cls: 'sort-ind' })}</button></th>`;
}

function tableRow(r, ctx) {
  const t = r.t;
  const co = coNames(t);
  const cls = ['is-link', t.status === 'past' ? 'is-muted' : '', ctx.param === t.id ? 'is-selected' : '', cursor === t.id && ctx.param !== t.id ? 'is-focused' : ''].filter(Boolean).join(' ');
  return h`<tr class="${cls}" data-act="open" data-id="${t.id}">
    <td class="tn-c-name"><span class="tn-namecell">${ui.plate(t.unit, { title: RB.model.unitLabel(t), status: ['late', 'partial'].includes(r.lg.current.status) ? r.lg.current.status : '' })}<span class="tn-namestack"><a class="cell-name tn-namelink" href="#t-${t.id}">${t.name || 'Unnamed tenant'}</a>${co ? h`<span class="cell-sub">${co}</span>` : ''}</span></span></td>
    <td class="tn-c-prop muted">${t.property}</td>
    <td class="num">${ui.money(r.sum.rent)}</td>
    <td class="tn-c-status">${pill(r)}</td>
    <td class="tn-c-strip">${ui.strip(r.cells, { today: ctx.today })}</td>
    <td class="num tn-c-bal">${ui.balance(r.lg.balance, { zero: '' })}</td>
    <td class="tn-c-lease nowrap">${leaseCell(r, ctx.today)}</td>
  </tr>`;
}
function card(r, ctx) {
  const t = r.t;
  const bal = r.lg.balance;
  const cls = ['crow', 'is-link', 'tn-card', t.status === 'past' ? 'is-muted' : '', ctx.param === t.id ? 'is-selected' : '', cursor === t.id ? 'is-focused' : ''].filter(Boolean).join(' ');
  return h`<div class="${cls}" data-act="open" data-id="${t.id}">
    <span class="crow-lead">${ui.plate(t.unit, { title: RB.model.unitLabel(t) })}</span>
    <div class="crow-main"><a class="crow-title tn-namelink" href="#t-${t.id}">${t.name || 'Unnamed tenant'}</a>
      <div class="crow-sub tn-card-sub">${ui.money(r.sum.rent)}<span class="faint">/mo</span>${bal ? h` · ${bal > 0 ? h`${ui.balance(bal)} owed` : ui.balance(bal)}` : ''} · ${leaseCell(r, ctx.today)}</div></div>
    <div class="crow-aside">${pill(r, 'sm')}</div>
    <div class="tn-card-strip">${ui.strip(r.cells, { today: ctx.today })}</div>
  </div>`;
}

// ------------------------------------------------------------------ render
function render(el, ctx) {
  const all = rowsFor(ctx);
  const counts = {};
  FILTERS.forEach(([k]) => { counts[k] = all.filter(PRED[k]).length; });
  // A deep link (or a move-out) can open a tenant the current filter hides, e.g. #t-<past tenant> under "All".
  // Switch the list to one that contains them so the highlight, "N of M" and j/k stepping stay coherent.
  // Not on 'refresh': that's the viewer choosing a filter themselves. Not remembered in prefs.
  if (ctx.param && ctx.reason !== 'refresh') {
    const mine = all.find(r => r.t.id === ctx.param);
    if (mine && !visible(all).some(g => g.rows.includes(mine))) {
      if (query && PRED[filter](mine)) query = '';
      else { query = ''; filter = ['all', 'past', 'notice', 'owing', 'ending'].find(k => PRED[k](mine)) || filter; }
    }
  }
  const groups = visible(all);
  const flat = groups.flatMap(g => g.rows);
  T.order = flat.map(r => r.t.id);
  if (cursor && !T.order.includes(cursor)) cursor = null;
  if (ctx.param && T.order.includes(ctx.param)) cursor = ctx.param;

  const current = all.filter(PRED.all);
  const props = new Set(current.map(r => r.t.property).filter(Boolean));
  const monthly = current.reduce((s, r) => s + r.sum.rent, 0);
  const owed = all.reduce((s, r) => s + Math.max(0, r.lg.balance), 0);
  const chip = ([k, label]) => h`<button type="button" class="chip" aria-pressed="${String(filter === k)}" data-act="filter" data-k="${k}">${label}<span class="chip-count${k === 'owing' && counts.owing ? ' is-bad' : ''}">${counts[k]}</span></button>`;
  const sortLabel = SORTS[sort.key].label;
  const sortDefault = sort.key === 'urgency' && sort.dir === 1;
  const q = query.trim();
  const empty = !flat.length;
  const filterLabel = FILTERS.find(f => f[0] === filter)[1];

  const head = h`<thead><tr>${th('name', 'Tenant', 'tn-c-name')}${th('property', 'Property', 'tn-c-prop')}${th('rent', 'Rent', 'num')}${th('status', 'This month', 'tn-c-status')}<th class="tn-c-strip">12 months</th>${th('balance', 'Balance', 'num tn-c-bal')}${th('lease', 'Lease end', 'tn-c-lease')}</tr></thead>`;
  const body = groups.map(g => h`${g.property !== null ? h`<tr class="tbl-group"><td colspan="7"><span class="tn-group">${g.property}<span class="faint">${RB.plural(g.rows.length, 'tenant')} · ${M.fmt(g.rows.filter(r => r.t.status !== 'past').reduce((s, r) => s + r.sum.rent, 0))}/mo</span></span></td></tr>` : ''}${g.rows.map(r => tableRow(r, ctx))}`);
  const cards = groups.map(g => h`${g.property !== null ? h`<div class="tn-card-group">${g.property}<span class="faint">${RB.plural(g.rows.length, 'tenant')}</span></div>` : ''}${g.rows.map(r => card(r, ctx))}`);

  el.innerHTML = String(h`
    <div class="view-head tn-top">
      <p class="view-summary tn-summary"><span><strong>${current.length}</strong> ${current.length === 1 ? 'tenant' : 'tenants'}</span><span><strong>${props.size}</strong> ${props.size === 1 ? 'property' : 'properties'}</span><span><strong>${M.fmt(monthly)}</strong> monthly rent</span>${owed ? h`<span class="tone-bad tn-sum-owed">${M.fmt(owed)} owed</span>` : ''}</p>
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary tn-add-btn" data-act="add" data-write>${ui.icon('plus')}<span>Add tenant</span></button>
    </div>
    <div class="view-head tn-head">
      <div class="chips chips-scroll tn-chips" role="group" aria-label="Show">${FILTERS.map(chip)}</div>
      <span class="spacer hide-phone"></span>
      <label class="search tn-search" for="tn-q"><span class="search-icon">${ui.icon('filter')}</span><input class="input" type="search" id="tn-q" placeholder="Filter by name, unit, phone…" value="${query}" data-input="q" autocomplete="off" spellcheck="false" aria-label="Filter tenants">${q ? h`<button type="button" class="btn btn-ghost btn-icon btn-sm tn-q-clear" data-act="clearq" aria-label="Clear filter">${ui.icon('x', { size: 14 })}</button>` : ''}</label>
    </div>
    <div class="tn-tools">
      <span class="tn-count faint">${q ? h`${RB.plural(flat.length, 'match', 'matches')} for “${q}”${filter !== 'all' ? ' in ' + filterLabel : ''}` : h`Showing ${RB.plural(flat.length, 'tenant')}`}</span>
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm tn-sortbtn" data-act="sortmenu" aria-haspopup="menu">${ui.icon('sort')}<span>Sort: ${sortLabel}${sortDefault ? '' : sort.dir === SORTS[sort.key].dir ? '' : ' (reversed)'}</span></button>
      <label class="check tn-groupby"><input type="checkbox" id="tn-group" data-change="group"${group ? RB.raw(' checked') : ''}> <span><span class="hide-phone">Group by property</span><span class="show-phone">By property</span></span></label>
      <div class="seg hide-phone" role="group" aria-label="Row density"><button type="button" data-act="density" data-v="comfortable" aria-pressed="${String(density === 'comfortable')}">Comfortable</button><button type="button" data-act="density" data-v="compact" aria-pressed="${String(density === 'compact')}">Compact</button></div>
    </div>
    ${empty ? ui.empty(q
      ? { icon: 'search', title: 'No tenants match “' + q + '”', body: filter !== 'all' ? 'Only ' + filterLabel + ' is being searched. Try All, or check the spelling.' : 'Search covers names, co-tenants, units, properties, phone numbers and emails.', actions: [{ label: 'Clear filter', act: 'clearq' }].concat(filter !== 'all' ? [{ label: 'Search all tenants', kind: 'soft', act: 'filter', attrs: { 'data-k': 'all' } }] : []) }
      : { icon: 'tenants', title: { owing: 'Nobody owes anything', ending: 'No leases ending soon', notice: 'Nobody has given notice', past: 'No past tenants yet', all: 'No current tenants' }[filter], body: { owing: 'Every balance is paid up or in credit.', ending: 'No fixed-term lease ends within the next ' + ctx.state.settings.leaseNoticeDays + ' days.', notice: 'Tenants show here once you record their notice.', past: 'Tenants you move out stay here with their ledger.', all: 'Add a tenant to start their ledger.' }[filter], quiet: false, actions: filter === 'all' ? [{ label: 'Add tenant', kind: 'primary', act: 'add', icon: 'plus' }] : [{ label: 'Show all tenants', act: 'filter', attrs: { 'data-k': 'all' } }] })
    : h`<div class="tbl-wrap hide-phone tn-tbl-wrap"><table class="tbl tn-tbl${density === 'compact' ? ' tbl-compact' : ''}" aria-label="Tenants">${head}<tbody>${body}</tbody></table></div>
      <div class="clist show-phone tn-clist">${cards}</div>`}
  `);

  ui.bind(el, {
    open: (b, e) => { if (e.target.closest('a.tn-namelink') && (e.metaKey || e.ctrlKey)) return; e.preventDefault(); cursor = b.dataset.id; RB.actions.openTenant(b.dataset.id); },
    filter: b => { filter = b.dataset.k; RB.prefs.set('tn:filter', filter); cursor = null; RB.shell.refresh(); },
    sort: b => { const k = b.dataset.k; sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: SORTS[k].dir }; RB.prefs.set('tn:sort', sort); RB.shell.refresh(); },
    sortmenu: b => ui.menu(b, Object.keys(SORTS).map(k => ({ label: SORTS[k].label, checked: sort.key === k, hint: k === 'urgency' ? 'default' : '', onSelect: () => { sort = { key: k, dir: SORTS[k].dir }; RB.prefs.set('tn:sort', sort); RB.shell.refresh(); } })), { align: 'end' }),
    group: inp => { group = !!inp.checked; RB.prefs.set('tn:group', group); RB.shell.refresh(); },
    density: b => { density = b.dataset.v; RB.prefs.set('tn:density', density); RB.shell.refresh(); },
    q: inp => { query = inp.value; refreshSoon(); },
    clearq: () => { query = ''; RB.shell.refresh(); const i = document.getElementById('tn-q'); if (i) i.focus(); },
    add: () => RB.actions.addTenant(),
  });
  const qi = el.querySelector('#tn-q');
  if (qi && !qi._tnKeys) {
    qi._tnKeys = true;
    qi.addEventListener('keydown', e => {
      if (e.key === 'Escape' && qi.value) { e.preventDefault(); e.stopPropagation(); query = ''; RB.shell.refresh(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { const first = T.order[0]; if (first) { e.preventDefault(); cursor = first; qi.blur(); if (e.key === 'Enter') RB.actions.openTenant(first); else RB.shell.refresh(); } }
    });
  }

  // drawer
  const d = ui.currentDrawer();
  if (ctx.param) {
    if (!d || ctx.reason === 'mount' || ctx.reason === 'route' || !d.el.dataset.tid || d.el.dataset.tid !== ctx.param) T.openDrawer(ctx.param);
    else d.rerender();
  } else if (d) d.close({ silent: true });
  layout(el, !!ctx.param);
  if (ctx.reason === 'route' && ctx.param) scrollToRow(el, ctx.param);
}
const refreshSoon = RB.debounce(() => RB.shell.refresh(), 60);

/** Desktop: keep the list visible beside the drawer — pad the list so the drawer doesn't cover it, and drop columns as it narrows. */
function layout(el, open) {
  el.style.paddingRight = '';
  el.classList.remove('tn-split', 'tn-narrow', 'tn-xnarrow');
  if (!open || ui.isPhone()) return;
  const r = el.getBoundingClientRect();
  const drawerLeft = window.innerWidth - Math.min(520, window.innerWidth);
  const pad = Math.max(0, Math.round(r.right - drawerLeft + 24));
  const avail = r.width - pad;
  if (avail < 420) return;    // too narrow to share: the drawer simply overlays the list
  el.classList.add('tn-split');
  el.style.paddingRight = pad + 'px';
  if (avail < 980) el.classList.add('tn-narrow');
  if (avail < 640) el.classList.add('tn-xnarrow');
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
  shortcuts: [['j / k', 'Move between tenants'], ['↓ / ↑', 'Move between tenants'], ['Enter', 'Open tenant'], ['p', 'Record payment'], ['e', 'Edit details'], ['Esc', 'Close tenant']],
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

// views/tenants.js — Tenants list (#tenants): find box, one-row segment, canonical rows grouped "Needs attention" then
// by property (SPEC §10.3). Hosts the #t-<id> tenant page (tenant-detail.js) and uses the sheets in tenant-forms.js.
// UI state lives in module variables; the chosen segment is remembered with RB.prefs.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});

const FILTERS = [['all', 'Everyone'], ['owing', 'Owes money'], ['past', 'Moved out']];

let filter = RB.prefs.get('tn:filter', 'all');
if (!FILTERS.some(f => f[0] === filter)) filter = 'all';
let query = '';
let cursor = null;   // tenant id under the keyboard cursor
// Property groups under "Everyone" fold to one row each on phone (law 3: show less); open on desktop. Explicit choices win.
const groupOpen = new Map();
const isOpen = (g, ctx) => (groupOpen.has(g.id) ? groupOpen.get(g.id) : !ctx.phone) || (ctx.param && g.rows.some(r => r.t.id === ctx.param));

// ------------------------------------------------------------------ data
function rowsFor(ctx) {
  const S = ctx.store;
  return S.tenantsList().map(t => ({ t, lg: S.ledger(t.id) }));
}
const PRED = {
  all: r => r.t.status !== 'past',
  owing: r => r.lg.balance > 0,
  past: r => r.t.status === 'past',
};
const hay = t => [t.name, t.unit, 'unit ' + t.unit, t.property, [t.property, t.unit].join(' '), t.phone, t.email, (t.coTenants || []).map(c => c && c.name).join(' ')].join(' · ');
const byPlace = (a, b) => RB.natCmp(a.t.property || '', b.t.property || '') || RB.natCmp(a.t.unit || '', b.t.unit || '') || RB.natCmp(a.t.name || '', b.t.name || '');

/** Tenant ids that need attention, in the one shared order (law 7). */
const attentionIds = ctx => RB.model.attentionOrder(ctx.state, ctx.today, id => ctx.store.ledger(id));
/** The owed sentence, worded the same on every screen (law 7). */
const owedSentence = () => ui.owedSentence();

/** Groups to show: [{id, title, rows}] */
function groupsFor(ctx, all) {
  const q = query.trim();
  if (q) {
    const found = all.filter(r => ui.match(hay(r.t), q) >= 0).sort(byPlace);
    return [{ id: 'found', title: found.length === 1 ? '1 tenant found' : found.length + ' tenants found', rows: found }];
  }
  const base = all.filter(PRED[filter]);
  const att = attentionIds(ctx);
  if (filter === 'owing') {
    const rank = id => { const i = att.indexOf(id); return i < 0 ? 1e6 : i; };
    return [{ id: 'owing', title: 'Owes money', rows: base.slice().sort((a, b) => rank(a.t.id) - rank(b.t.id) || b.lg.balance - a.lg.balance) }];
  }
  const out = [];
  let rest = base;
  if (filter === 'all') {
    const need = att.map(id => base.find(r => r.t.id === id)).filter(Boolean);
    if (need.length) out.push({ id: 'attention', title: 'Needs attention', rows: need });
    rest = base.filter(r => !need.includes(r));
  }
  const by = new Map();
  rest.slice().sort(byPlace).forEach(r => { const k = r.t.property || 'No property'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  Array.from(by.keys()).sort(RB.natCmp).forEach(k => out.push({ id: 'p-' + k, title: k, rows: by.get(k) }));
  return out;
}

// ------------------------------------------------------------------ rows
function row(r, ctx) {
  const t = r.t;
  const mk = T.W.marker(t, r.lg, ctx.today);
  const cls = [ctx.param === t.id ? 'is-selected' : '', cursor === t.id && ctx.param !== t.id ? 'is-focused' : ''].filter(Boolean).join(' ');
  return T.row({
    lead: ui.plate(t.unit, {}),
    title: t.name || 'Unnamed tenant',
    sub: T.place(t),
    amt: mk.owes ? M.fmt(mk.owes) : null,
    // paid is quiet (law 5): an all-paid-up row carries no marker at all
    status: mk.words === 'All paid up' ? null : T.status(mk.kind, mk.words),
    href: '#t-' + t.id,
    cls,
    attrs: { 'data-act': 'open', 'data-id': t.id, 'aria-current': ctx.param === t.id ? 'page' : null },
  });
}

// ------------------------------------------------------------------ render
function render(el, ctx) {
  const all = rowsFor(ctx);
  // A deep link can open a tenant the current segment hides (e.g. a moved-out tenant under "Everyone").
  // Switch the list to one that contains them so the highlight and Previous/Next agree. Not remembered.
  if (ctx.param && ctx.reason !== 'refresh') {
    const mine = all.find(r => r.t.id === ctx.param);
    if (mine && !groupsFor(ctx, all).some(g => g.rows.includes(mine))) {
      query = '';
      if (!PRED[filter](mine)) filter = ['all', 'past', 'owing'].find(k => PRED[k](mine)) || filter;
    }
  }
  const counts = {};
  Object.keys(PRED).forEach(k => { counts[k] = all.filter(PRED[k]).length; });
  const groups = groupsFor(ctx, all);
  const flat = groups.flatMap(g => g.rows);
  T.order = flat.map(r => r.t.id);
  if (cursor && !T.order.includes(cursor)) cursor = null;
  if (ctx.param && T.order.includes(ctx.param)) cursor = ctx.param;
  const q = query.trim();

  const foldable = g => filter === 'all' && !q && g.id.startsWith('p-');
  const folded = groups.filter(g => g.rows.length && foldable(g) && !isOpen(g, ctx));
  const groupRow = g => {
    const owe = g.rows.filter(r => r.lg.balance > 0).length, moving = g.rows.filter(r => r.t.status === 'notice').length;
    const sub = [RB.plural(g.rows.length, 'tenant'), owe ? owe + ' owe money' : 'all paid up', moving ? moving + ' moving out' : ''].filter(Boolean).join(' · ');
    return h`<li>${T.row({ title: g.title, sub, act: 'group', attrs: { 'data-g': g.id, 'aria-expanded': 'false' } })}</li>`;
  };
  const list = [];
  groups.filter(g => g.rows.length).forEach(g => {
    if (folded.includes(g)) { if (g === folded[0]) list.push(h`<h3 class="rows-head" data-group="properties">By property</h3><ul class="rows rows-inset rows-nolead">${folded.map(groupRow)}</ul>`); return; }
    list.push(h`<h3 class="rows-head" data-group="${g.id}">${g.title}${g.id !== 'found' ? h` <span class="rows-count">${g.rows.length}</span>` : ''}</h3>
    <ul class="rows rows-inset">${g.rows.map(r => h`<li>${row(r, ctx)}</li>`)}</ul>
    ${foldable(g) && ctx.phone ? h`<button type="button" class="rows-more" data-act="group" data-g="${g.id}" aria-expanded="true">Show fewer</button>` : ''}`);
  });
  const empty = q
    ? h`<p class="tn-empty">Nobody matches “${q}”. You can find people by name, unit, phone number or email. <button type="button" class="btn-link" data-act="clearq">Clear the search</button></p>`
    : filter === 'owing' ? h`<p class="tn-empty">Nobody owes money. <button type="button" class="btn-link" data-act="filter" data-k="all">Show everyone</button></p>`
      : filter === 'past' ? h`<p class="tn-empty">Nobody has moved out yet. <button type="button" class="btn-link" data-act="filter" data-k="all">Show everyone</button></p>`
        : h`<p class="tn-empty">No tenants yet. <button type="button" class="btn-link" data-act="add" data-write>Add a tenant</button></p>`;

  el.innerHTML = String(h`
    <div class="tn-head">
      <label class="vh" for="tn-q">Find a tenant by name or unit</label>
      <span class="search tn-search"><span class="search-icon">${ui.icon('search')}</span><input class="input" type="search" id="tn-q" placeholder="Find a tenant by name or unit" value="${query}" data-input="q" autocomplete="off" spellcheck="false"></span>
      ${q ? h`<button type="button" class="btn btn-outline tn-q-clear" data-act="clearq">Clear</button>` : ''}
      <button type="button" class="btn btn-primary hide-phone tn-add-btn" data-act="add" data-write>Add a tenant</button>
    </div>
    <div class="tn-bar">
      ${ui.segment(FILTERS.map(([key, label]) => ({ key, label, count: counts[key] })), q ? null : filter, { id: 'tn-seg', act: 'filter', label: 'Show' })}
    </div>
    <div class="tn-titlerow"><h2 class="tn-total${ctx.param ? ' is-beside' : ''}" id="tn-total">${RB.plural(counts.all, 'tenant')}</h2><button type="button" class="btn-link show-phone tn-add-link" data-act="add" data-write>Add a tenant</button></div>
    <p class="tn-owed" id="tn-owed">${owedSentence()}</p>
    ${flat.length ? h`<div class="tn-list" id="tn-list">${list}</div>` : empty}
  `);

  ui.bind(el, {
    open: (b, e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); cursor = b.dataset.id; RB.actions.openTenant(b.dataset.id); },
    filter: b => { filter = b.dataset.k; query = ''; RB.prefs.set('tn:filter', filter); cursor = null; RB.shell.refresh(); },
    q: inp => { query = inp.value; refreshSoon(); },
    clearq: () => { query = ''; RB.shell.refresh(); const i = document.getElementById('tn-q'); if (i) i.focus(); },
    add: () => RB.actions.addTenant(),
    group: b => { const g = groups.find(x => x.id === b.dataset.g); if (!g) return; groupOpen.set(g.id, !isOpen(g, ctx)); RB.shell.refresh(); },
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

/** Desktop: keep the list visible beside the tenant page when there is room. */
function layout(el, open) {
  el.style.paddingRight = '';
  el.classList.remove('tn-split');
  if (!open || ui.isPhone()) return;
  const r = el.getBoundingClientRect();
  const dr = document.querySelector('.drawer');
  const dw = dr ? dr.getBoundingClientRect().width : Math.min(600, window.innerWidth);
  const pad = Math.max(0, Math.round(r.right - (window.innerWidth - dw) + 24));
  if (r.width - pad < 360) return;    // too narrow to share: the tenant page simply covers the list
  el.classList.add('tn-split');
  el.style.paddingRight = pad + 'px';
}
window.addEventListener('resize', RB.debounce(() => { const c = RB.shell.current(); const root = RB.shell.root(); if (c.view === 'tenants' && root && root.dataset.view === 'tenants') layout(root, !!c.param); }, 100));

function scrollToRow(el, id) {
  const r0 = Array.from(el.querySelectorAll('[data-id]')).find(x => x.dataset.id === id && x.offsetParent);
  if (!r0) return;
  const r = r0.getBoundingClientRect();
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || 56;
  if (r.top < top + 40 || r.bottom > window.innerHeight - 8) r0.scrollIntoView({ block: 'center' });
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
  shortcuts: [['j / k', 'Move between tenants'], ['↓ / ↑', 'Move between tenants'], ['Enter', 'Open tenant'], ['p', 'Record a payment'], ['e', 'Change their details'], ['Esc', 'Close the tenant']],
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

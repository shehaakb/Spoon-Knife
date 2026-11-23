// 40-shell.js — app chrome, hash router, view registry, re-render contract, command palette, keyboard shortcuts.
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date, M = RB.money, h = RB.html, raw = RB.raw, ui = RB.ui;

const NAV = [
  { route: 'today', label: 'Today', icon: 'today', key: 'd' },
  { route: 'rent', label: 'Rent', icon: 'rent', key: 'r' },
  { route: 'tenants', label: 'Tenants', icon: 'tenants', key: 't' },
  { route: 'leases', label: 'Leases', icon: 'leases', key: 'l' },
  { route: 'upkeep', label: 'Upkeep', icon: 'upkeep', key: 'u' },
  { route: 'reports', label: 'Reports', icon: 'reports', key: 'p' },
  { route: 'setup', label: 'Setup', icon: 'setup', key: 's' },
];
const TABS = ['today', 'rent', 'tenants', 'upkeep'];
const ROUTES = new Set(NAV.map(n => n.route).concat(['kit']));

// ================================================================= view registry
const views = {};
/**
 * Register a view. def: {title, render(el, ctx), update?(el, ctx), onKey?(e, ctx) → true if handled,
 *   destroy?(), shortcuts?: [[keys, label]], firstRun?: false (render even with no tenants), loading?: true (render while loading)}
 */
RB.views = {
  register(name, def) { views[name] = Object.assign({ name }, def); if (cur.view === name && started) mount(cur, 'mount'); },
  get: name => views[name],
  all: () => Object.assign({}, views),
  NAV,
};

// ================================================================= commands (palette + quick-add)
const commands = new Map();
/**
 * Register a command. cmd: {id, label, group?:'Actions'|'Go to'|…, icon?, hint? (shortcut text), keywords?,
 *   run(), when?() → bool, quickAdd?: number (order in the "+" menu), write?: true (hidden when read-only)}
 * Elements with data-cmd="<id>" run the command on click.
 */
RB.commands = {
  register(cmd) { commands.set(cmd.id, cmd); return () => commands.delete(cmd.id); },
  run(id) { const c = commands.get(id); if (c) { if (c.write && !RB.store.canWrite()) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return; } return c.run(); } console.warn('Unknown command', id); },
  list: () => Array.from(commands.values()).filter(c => !c.when || c.when()),
  get: id => commands.get(id),
};

// ================================================================= router
let cur = { route: 'today', view: 'today', param: null };
let started = false;
let mounted = null;      // {name, root}
let pendingIntent = null;
let deferredRender = false;
let lastReady = null;

function parseHash() {
  const raw0 = (location.hash || '').replace(/^#/, '');
  const m = raw0.match(/^t-([A-Za-z0-9-]+)$/);
  if (m) return { route: raw0, view: 'tenants', param: m[1] };
  if (ROUTES.has(raw0)) return { route: raw0, view: raw0, param: null };
  return { route: 'today', view: 'today', param: null };
}
function onHash() {
  const next = parseHash();
  const viewChanged = next.view !== cur.view;
  cur = next;
  mount(cur, viewChanged ? 'mount' : 'route');
}

function ctxFor(reason) {
  const intent = pendingIntent; if (reason !== 'store') pendingIntent = null;
  const st = RB.store.state;
  return { route: cur.route, view: cur.view, param: cur.param, tenantId: cur.view === 'tenants' ? cur.param : null,
    state: st, store: RB.store, today: RB.store.today(), reason, intent, phone: ui.isPhone() };
}

function mount(r, reason) {
  const host = document.getElementById('rb-view');
  const def = views[r.view] || views.today;
  if (reason === 'mount' || !mounted || mounted.name !== def.name) {
    if (mounted) { const old = views[mounted.name]; if (old && old.destroy) try { old.destroy(); } catch (e) { console.error(e); } }
    const d = ui.currentDrawer(); if (d) d.close({ silent: true });
    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'view-root view-' + def.name;
    root.dataset.view = def.name;
    host.appendChild(root);
    mounted = { name: def.name, root };
    window.scrollTo(0, 0);
    renderChrome();
    renderView('mount');
  } else {
    renderChrome();
    renderView(reason);
  }
}

function textFocusIn(root) {
  const a = document.activeElement;
  return a && root.contains(a) && (a.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable="true"]'));
}

/**
 * Render the mounted view. Reasons: 'mount' | 'route' | 'store' | 'refresh' | 'today'.
 * Keeps window scroll; restores focus (and caret) to the element with the same id after re-render.
 */
function renderView(reason) {
  if (!mounted) return;
  const def = views[mounted.name];
  const root = mounted.root;
  const st = RB.store.state;
  deferredRender = false;
  const y = window.scrollY;
  const ae = document.activeElement;
  const focusId = ae && root.contains(ae) && ae.id ? ae.id : null;
  let sel = null;
  try { if (focusId && typeof ae.selectionStart === 'number') sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { /* ignore */ }

  if (!def) { root.innerHTML = String(ui.empty({ title: 'Not built yet', body: 'This view has no implementation.' })); return; }
  if (!st.ready && !def.loading) {
    root.innerHTML = String(h`${ui.loadingNote()}${ui.skeleton()}`);
    root.dataset.state = 'loading';
    return;
  }
  if (st.ready && def.firstRun !== false && RB.store.tenantsList().length === 0) {
    root.innerHTML = String(ui.firstRun());
    root.dataset.state = 'empty';
    return;
  }
  root.dataset.state = 'ready';
  try { def.render(root, ctxFor(reason)); }
  catch (e) {
    console.error(e);
    root.innerHTML = String(ui.empty({ icon: 'alert', title: 'Something went wrong showing this page', body: String(e && e.message || e) }));
  }
  if (reason !== 'mount') window.scrollTo(0, y);
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && el !== document.activeElement && root.contains(el)) {
      try { el.focus({ preventScroll: true }); if (sel && typeof el.setSelectionRange === 'function') el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ }
    }
  }
}

function onStoreChange() {
  renderChrome();
  if (!mounted) return;
  const st = RB.store.state;
  const def = views[mounted.name];
  const readyFlip = lastReady !== st.ready;
  lastReady = st.ready;
  if (!readyFlip && mounted.root.dataset.state === 'ready' && def && def.update) {
    try { def.update(mounted.root, ctxFor('store')); } catch (e) { console.error(e); }
    return;
  }
  if (!readyFlip && textFocusIn(mounted.root)) { deferredRender = true; return; }
  renderView('store');
}
document.addEventListener('focusout', () => {
  if (!deferredRender) return;
  setTimeout(() => { if (deferredRender && mounted && !textFocusIn(mounted.root)) renderView('store'); }, 0);
});

// ================================================================= chrome
const $ = id => document.getElementById(id);
function renderChrome() {
  const st = RB.store.state;
  const att = st.ready ? RB.store.attention() : [];
  const high = att.filter(a => a.severity === 'high').length;
  const lateCount = st.ready ? RB.store.tenantsList({ includePast: false }).filter(t => { const lg = RB.store.ledger(t.id); return lg && lg.current.status === 'late'; }).length : 0;
  const counts = { today: high || '', rent: lateCount || '' };
  const active = cur.view;
  // rail
  const nav = $('rb-nav');
  if (nav) nav.innerHTML = String(h`${NAV.map(n => h`<a class="rail-link" href="#${n.route}"${n.route === active ? raw(' aria-current="page"') : ''} title="${n.label}">${ui.icon(n.icon)}<span class="rail-link-label">${n.label}</span><span class="rail-count" aria-label="${counts[n.route] ? counts[n.route] + ' need attention' : ''}">${counts[n.route]}</span></a>`)}`);
  // tab bar (phone)
  const tb = $('rb-tabbar');
  if (tb) {
    const moreActive = !TABS.includes(active) && active !== 'kit';
    tb.innerHTML = String(h`${TABS.map(r => { const n = NAV.find(x => x.route === r); return h`<a class="tab" href="#${r}"${r === active ? raw(' aria-current="page"') : ''}>${ui.icon(n.icon, { size: 20 })}<span>${n.label}</span><span class="tab-badge">${counts[r]}</span></a>`; })}
      <button type="button" class="tab" id="rb-more"${moreActive ? raw(' aria-current="page"') : ''}>${ui.icon('more', { size: 20 })}<span>More</span></button>`);
  }
  // title
  const def = views[cur.view];
  const title = (def && (typeof def.title === 'function' ? def.title(ctxFor('store')) : def.title)) || (NAV.find(n => n.route === cur.view) || {}).label || 'Rent Book';
  if ($('rb-title').textContent !== title && !titleOverride) $('rb-title').textContent = title;
  document.title = (titleOverride || title) === 'Today' ? 'Rent Book' : (titleOverride || title) + ' · Rent Book';
  $('rb-portfolio').textContent = st.settings.portfolioName || '';
  // top note: view only
  const tn = $('rb-topnote');
  tn.hidden = !st.readOnly;
  if (st.readOnly) tn.innerHTML = String(ui.tag('View only', 'accent', 'key'));
  document.documentElement.classList.toggle('is-readonly', !!st.readOnly);
  // sync note
  $('rb-sync').innerHTML = String(h`${syncNote(st)}<button type="button" class="rail-help" data-cmd="help:keys" title="Keyboard shortcuts">${ui.icon('keyboard')}<span class="rail-help-label">Shortcuts <kbd class="kbd">?</kbd></span></button>`);
  // banner
  const bn = $('rb-banner');
  let banner = null;
  if (st.loadIssue === 'timeout') banner = h`<div class="banner-text">${ui.icon('alert')} <strong>Can’t reach your saved data yet.</strong> Still trying — what you see may be out of date.</div>`;
  else if (st.loadIssue === 'error') banner = h`<div class="banner-text"><strong>Live updates stopped.</strong> What you see may be out of date; reopen the page to reconnect.</div>`;
  else if (st.ready && RB.store.hasSample()) banner = h`<div class="banner-text">${ui.icon('sample', { cls: 'vh' })}You’re looking at <strong>sample tenants</strong>. Explore freely — nothing here is real.</div>
    <div class="banner-actions"><button type="button" class="btn btn-sm btn-ghost" data-cmd="sample:remove" data-write>Remove sample data</button><button type="button" class="btn btn-sm" data-cmd="setup:import" data-write>Import my tenants</button></div>`;
  bn.hidden = !banner;
  bn.className = 'banner' + (st.loadIssue ? ' banner-warn' : '');
  if (banner) { const s = String(banner); if (bn.innerHTML !== s) bn.innerHTML = s; }
}
function syncNote(st) {
  let dot = 'dot', text;
  if (st.readOnly) { dot = 'dot dot-accent'; text = 'View only'; }
  else if (!st.mode) { dot = 'dot dot-accent dot-pulse'; text = 'Connecting…'; }
  else if (st.mode === 'local') { dot = 'dot dot-warn'; text = 'Not syncing — saved on this device only'; }
  else if (st.loadIssue) { dot = 'dot dot-warn'; text = st.loadIssue === 'timeout' ? 'Can’t reach saved data yet' : 'Not syncing'; }
  else if (st.saving) { dot = 'dot dot-accent dot-pulse'; text = 'Saving…'; }
  else if (!st.synced) { dot = 'dot dot-accent dot-pulse'; text = 'Loading…'; }
  else { dot = 'dot dot-ok'; text = 'Saved'; }
  return h`<div class="sync-note" title="${text}"><span class="${dot}"></span><span class="sync-text">${text}</span></div>`;
}
let titleOverride = null;

// ================================================================= command palette & quick add
function openPalette(query) {
  if (ui.topLayer() && ui.topLayer().kind === 'palette') return;
  ui.palette({
    placeholder: 'Search tenants, units, or type a command…', label: 'Search and commands', query: query || '',
    source: q => {
      const groups = [];
      const ql = q.trim();
      const tenants = RB.store.state.ready ? RB.store.tenantsList() : [];
      if (ql) {
        const matches = tenants.map(t => ({ t, s: ui.match([t.name, t.unit, t.property, t.phone, t.email, (t.coTenants || []).map(c => c.name).join(' ')].join(' · '), ql) }))
          .filter(x => x.s >= 0).sort((a, b) => a.s - b.s || (a.t.status === 'past') - (b.t.status === 'past')).slice(0, 7);
        if (matches.length) {
          groups.push({ group: 'Tenants', items: matches.map(({ t }) => { const lg = RB.store.ledger(t.id); return { id: 't:' + t.id, label: t.name, sub: t.property + (t.status === 'past' ? ' · past' : ''), plate: t.unit, hint: lg && lg.balance > 0 ? M.fmt(lg.balance) + ' owed' : '', run: () => RB.actions.openTenant(t.id) }; }) });
          if (matches.length <= 3 && RB.store.canWrite()) {
            const t = matches[0].t;
            groups.push({ group: t.name, items: [
              { id: 'pay', label: 'Record payment', sub: '— ' + t.name, icon: 'cash', run: () => RB.actions.recordPayment(t.id) },
              { id: 'note', label: 'Add note', sub: '— ' + t.name, icon: 'note', run: () => RB.actions.addNote(t.id) },
              { id: 'chg', label: 'Add charge', sub: '— ' + t.name, icon: 'plus', run: () => RB.actions.addCharge(t.id) },
            ] });
          }
        }
      }
      const cmds = RB.commands.list().filter(c => !(c.write && !RB.store.canWrite()))
        .map(c => ({ c, s: ui.match(c.label + ' ' + (c.keywords || '') + ' ' + (c.group || ''), ql) })).filter(x => x.s >= 0)
        .sort((a, b) => a.s - b.s);
      const byGroup = {};
      cmds.forEach(({ c }) => { (byGroup[c.group || 'Actions'] = byGroup[c.group || 'Actions'] || []).push({ id: c.id, label: c.label, icon: c.icon || 'arrow-right', hint: c.hint, run: () => RB.commands.run(c.id) }); });
      ['Actions', 'Go to'].concat(Object.keys(byGroup).filter(g => g !== 'Actions' && g !== 'Go to')).forEach(g => { if (byGroup[g]) groups.push({ group: g, items: byGroup[g].slice(0, ql ? 8 : 12) }); });
      return groups;
    },
  });
}
function quickAdd(anchor) {
  const items = RB.commands.list().filter(c => c.quickAdd).sort((a, b) => a.quickAdd - b.quickAdd)
    .map(c => ({ label: c.label, icon: c.icon, hint: c.hint, write: c.write, disabled: c.write && !RB.store.canWrite(), onSelect: () => RB.commands.run(c.id) }));
  ui.menu(anchor, items, { align: 'end' });
}
async function withTenant(title, fn) { const id = await ui.pickTenant({ title }); if (id) fn(id); }

function registerBuiltins() {
  const C = RB.commands, A = RB.actions;
  NAV.forEach((n, i) => C.register({ id: 'go:' + n.route, label: n.label, group: 'Go to', icon: n.icon, hint: 'g ' + n.key, keywords: 'go open view', run: () => go(n.route) }));
  C.register({ id: 'payment:record', label: 'Record payment…', group: 'Actions', icon: 'cash', quickAdd: 1, write: true, keywords: 'pay rent received', run: () => withTenant('Record a payment from…', id => A.recordPayment(id)) });
  C.register({ id: 'charge:add', label: 'Add charge…', group: 'Actions', icon: 'plus', quickAdd: 2, write: true, keywords: 'fee utility damage bill', run: () => withTenant('Add a charge for…', id => A.addCharge(id)) });
  C.register({ id: 'credit:add', label: 'Add credit…', group: 'Actions', icon: 'undo', write: true, keywords: 'refund discount', run: () => withTenant('Add a credit for…', id => A.addCredit(id)) });
  C.register({ id: 'note:add', label: 'Add note…', group: 'Actions', icon: 'note', quickAdd: 3, write: true, keywords: 'log call text email visit follow up', run: () => withTenant('Add a note for…', id => A.addNote(id)) });
  C.register({ id: 'tenant:add', label: 'Add tenant', group: 'Actions', icon: 'user', quickAdd: 4, write: true, keywords: 'new tenant lease move in', run: () => A.addTenant() });
  C.register({ id: 'ticket:add', label: 'New upkeep request', group: 'Actions', icon: 'wrench', quickAdd: 5, write: true, keywords: 'maintenance repair ticket', run: () => A.addTicket() });
  C.register({ id: 'setup:import', label: 'Import tenants from a spreadsheet', group: 'Actions', icon: 'upload', write: true, keywords: 'csv paste import', run: () => go('setup', 'import') });
  C.register({ id: 'backup:download', label: 'Download backup (JSON)', group: 'Actions', icon: 'download', keywords: 'export save json', run: () => A.backup() });
  C.register({ id: 'sample:load', label: 'Load sample data', group: 'Actions', icon: 'sample', write: true, keywords: 'demo example', when: () => !RB.store.hasSample(), run: () => A.loadSample() });
  C.register({ id: 'sample:remove', label: 'Remove sample data', group: 'Actions', icon: 'trash', write: true, keywords: 'demo example clear', when: () => RB.store.hasSample(), run: () => A.removeSample() });
  C.register({ id: 'help:keys', label: 'Keyboard shortcuts', group: 'Help', icon: 'keyboard', hint: '?', run: () => helpSheet() });
}

// ================================================================= keyboard
const GLOBAL_KEYS = [
  ['/', 'Search'], ['⌘K / Ctrl K', 'Command palette'], ['n', 'Quick add'], ['?', 'Keyboard shortcuts'], ['Esc', 'Close sheet, drawer or menu'],
].concat(NAV.map(n => ['g ' + n.key, 'Go to ' + n.label]));
function helpSheet() {
  const def = views[cur.view];
  const viewKeys = (def && def.shortcuts) || [];
  const row = ([k, label]) => h`<div class="keys-row"><span>${label}</span><span>${k.split(' / ').map((alt, i) => h`${i ? raw(' <span class="faint">or</span> ') : ''}${alt.split(' ').map(x => ui.kbd(x))}`)}</span></div>`;
  ui.sheet({
    title: 'Keyboard shortcuts', size: 'wide', cancel: false, actions: [{ id: 'ok', label: 'Done', kind: '' }],
    body: h`<div class="keys"><div class="keys-group"><div class="micro mb-2">Everywhere</div>${GLOBAL_KEYS.map(row)}</div>
      ${viewKeys.length ? h`<div class="keys-group"><div class="micro mb-2">${def.title || cur.view}</div>${viewKeys.map(row)}</div>` : ''}</div>`,
  });
}
let gPending = 0;
function isTyping(t) { return t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]'); }
document.addEventListener('keydown', e => {
  if (e.defaultPrevented) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
  if (ui.hasModal()) return;
  if (isTyping(e.target)) {
    if (e.key === 'Escape' && e.target.id === 'rb-search') { e.target.value = ''; e.target.blur(); }
    return;
  }
  if (mod || e.altKey) return;
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const n = NAV.find(x => x.key === e.key.toLowerCase());
    if (n) { e.preventDefault(); go(n.route); return; }
  }
  if (e.key === 'g') { gPending = Date.now(); return; }
  gPending = 0;
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?') { e.preventDefault(); helpSheet(); return; }
  if (e.key === 'n' || e.key === '+') { e.preventDefault(); quickAdd($('rb-add')); return; }
  const def = mounted && views[mounted.name];
  if (def && def.onKey && mounted.root.dataset.state === 'ready') { try { if (def.onKey(e, ctxFor('key')) === true) e.preventDefault(); } catch (err) { console.error(err); } }
});

// ================================================================= navigation API
/** Navigate to a route ('rent', 'tenants', 't-<id>', …) with an optional one-shot intent passed to the view as ctx.intent. */
function go(route, intent) {
  pendingIntent = intent || null;
  if (('#' + route) === location.hash || (!location.hash && route === 'today')) { mount(parseHash(), 'refresh'); return; }
  location.hash = route;
}
function moreSheet() {
  const s = RB.store.state;
  const sh = ui.sheet({
    title: 'More', cancel: false, actions: [],
    body: h`<div class="more-list stack stack-1">${NAV.filter(n => !TABS.includes(n.route)).map(n => h`<a class="menu-item" href="#${n.route}" data-more>${ui.icon(n.icon)}<span>${n.label}</span></a>`)}
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" data-cmd="help:keys" data-more>${ui.icon('keyboard')}<span>Keyboard shortcuts</span></button>
      <div class="mt-4 faint t-12">${syncNote(s)}</div></div>`,
  });
  sh.body.addEventListener('click', e => { if (e.target.closest('[data-more]')) sh.close(); });
}

RB.shell = {
  go,
  /** Re-render the current view now (after a view changes its own UI state). reason defaults to 'refresh'. */
  refresh(reason) { renderView(reason || 'refresh'); },
  current: () => Object.assign({}, cur),
  root: () => (mounted ? mounted.root : null),
  /** Override the top-bar title (e.g. "November 2026"); null restores the view title. */
  setTitle(text) { titleOverride = text || null; const def = views[cur.view]; $('rb-title').textContent = text || (def && def.title) || ''; },
  openPalette, quickAdd, helpSheet,
  start() {
    if (started) return; started = true;
    registerBuiltins();
    $('rb-search-icon').innerHTML = String(ui.icon('search'));
    $('rb-find').innerHTML = String(ui.icon('search'));
    $('rb-add').innerHTML = String(ui.icon('plus'));
    const search = $('rb-search');
    // The top-bar field is an affordance for the palette: clicking or typing in it opens the palette with that text.
    search.addEventListener('mousedown', e => { e.preventDefault(); openPalette(search.value); });
    search.addEventListener('keydown', e => {
      if ((e.key.length === 1 && !e.metaKey && !e.ctrlKey) || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openPalette(e.key.length === 1 ? e.key : ''); }
    });
    $('rb-find').addEventListener('click', () => openPalette());
    $('rb-add').addEventListener('click', e => quickAdd(e.currentTarget));
    document.addEventListener('click', e => {
      if (e.target.closest('#rb-more')) { moreSheet(); return; }
      const c = e.target.closest('[data-cmd]');
      if (c && !c.disabled) { e.preventDefault(); RB.commands.run(c.getAttribute('data-cmd')); }
    });
    window.addEventListener('hashchange', () => { titleOverride = null; onHash(); });
    RB.store.subscribe(onStoreChange);
    setInterval(() => { const t = D.today(); if (t !== RB.store.today()) RB.store.setToday(t); }, 60000);
    cur = parseHash();
    mount(cur, 'mount');
  },
};

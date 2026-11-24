// 40-shell.js — app chrome, hash router, view registry, re-render contract, command palette, keyboard shortcuts.
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date, M = RB.money, h = RB.html, raw = RB.raw, ui = RB.ui;

const NAV = [
  { route: 'today', label: 'Today', icon: 'today', key: 'd' },
  { route: 'rent', label: 'Rent', icon: 'rent', key: 'r' },
  { route: 'tenants', label: 'Tenants', icon: 'tenants', key: 't' },
  { route: 'leases', label: 'Leases', icon: 'leases', key: 'l' },
  { route: 'repairs', label: 'Repairs', icon: 'wrench', key: 'u' },
  { route: 'reports', label: 'Reports', icon: 'reports', key: 'p' },
  { route: 'setup', label: 'Settings', icon: 'setup', key: 's' },
];
const TABS = ['today', 'rent', 'tenants', 'repairs'];
const ROUTES = new Set(NAV.map(n => n.route).concat(['kit', 'upkeep']));
// Route aliases: #upkeep and #repairs both show Repairs (whichever name the Repairs view registers under).
const ALIAS = { upkeep: 'repairs' };
// Parameterised routes: [regex on the hash, view name]. The first capture group becomes ctx.param.
const PATTERNS = [
  [/^t-([A-Za-z0-9-]+)$/, 'tenants'],     // tenant page (drawer over Tenants)
  [/^p-([a-z0-9-]+)$/, 'repairs'],        // a property's repair history (SPEC §9)
];
/** The registered view for a name, following the repairs/upkeep alias both ways. */
function viewDef(name) { return views[name] || (name === 'repairs' && views.upkeep) || (name === 'upkeep' && views.repairs) || null; }
/** Nav key for a view name (so 'upkeep' highlights Repairs). */
const navKey = v => (v === 'upkeep' ? 'repairs' : v);

// ================================================================= view registry
const views = {};
/**
 * Register a view. def: {title, render(el, ctx), update?(el, ctx), onKey?(e, ctx) → true if handled,
 *   destroy?(), shortcuts?: [[keys, label]], firstRun?: false (render even with no tenants), loading?: true (render while loading)}
 */
RB.views = {
  register(name, def) { views[name] = Object.assign({ name }, def); if (started && viewDef(cur.view) === views[name]) mount(cur, 'mount'); },
  get: name => viewDef(name),
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
  for (const [re, view] of PATTERNS) { const m = raw0.match(re); if (m) return { route: raw0, view, param: m[1] }; }
  if (ROUTES.has(raw0)) return { route: raw0, view: ALIAS[raw0] || raw0, param: null };
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
  const def = viewDef(r.view) || views.today;
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
  return a && root.contains(a) && isTyping(a);
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

  if (!def) { root.innerHTML = String(ui.empty({ title: 'This page isn’t ready yet', body: 'Use the menu to go somewhere else.' })); return; }
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
    root.innerHTML = String(ui.empty({ icon: 'alert', title: 'Something went wrong showing this page', body: h`Your information is safe. Try going to Today and back. (Details: ${String(e && e.message || e)})`, actions: [{ label: 'Go to Today', kind: 'primary', attrs: { 'data-cmd': 'go:today' } }] }));
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
  // v3: a badge only on Today (= every item in "Needs you"). Rent's badge is gone.
  const counts = { today: att.length || '' };
  const countWords = { today: n => RB.plural(n, 'thing') + ' need' + (n === 1 ? 's' : '') + ' you' };
  const active = navKey(cur.view);
  // rail
  const nav = $('rb-nav');
  if (nav) {
    const html = String(h`${NAV.map(n => h`<a class="rail-link" href="#${n.route}" id="rb-nav-${n.route}"${n.route === active ? raw(' aria-current="page"') : ''}>${ui.icon(n.icon)}<span class="rail-link-label">${n.label}</span>${counts[n.route] ? h`<span class="rail-count"><span aria-hidden="true">${counts[n.route]}</span><span class="vh">, ${countWords[n.route](counts[n.route])}</span></span>` : ''}</a>`)}`);
    if (nav.innerHTML !== html) nav.innerHTML = html;
  }
  // tab bar (phone)
  const tb = $('rb-tabbar');
  if (tb) {
    const moreActive = !TABS.includes(active) && active !== 'kit';
    const html = String(h`${TABS.map(r => { const n = NAV.find(x => x.route === r); return h`<a class="tab" href="#${r}" id="rb-tab-${r}"${r === active ? raw(' aria-current="page"') : ''}>${ui.icon(n.icon, { size: 22 })}<span class="tab-label">${n.label}</span>${counts[r] ? h`<span class="tab-badge"><span aria-hidden="true">${counts[r]}</span><span class="vh">, ${countWords[r](counts[r])}</span></span>` : ''}</a>`; })}
      <button type="button" class="tab" id="rb-more"${moreActive ? raw(' aria-current="page"') : ''}>${ui.icon('more', { size: 22 })}<span class="tab-label">More</span></button>`);
    if (tb.innerHTML !== html) tb.innerHTML = html;
  }
  // title
  const def = viewDef(cur.view);
  const title = (def && (typeof def.title === 'function' ? def.title(ctxFor('store')) : def.title)) || (NAV.find(n => n.route === active) || {}).label || 'Rent Book';
  if ($('rb-title').textContent !== title && !titleOverride) $('rb-title').textContent = title;
  document.title = (titleOverride || title) === 'Today' ? 'Rent Book' : (titleOverride || title) + ' · Rent Book';
  $('rb-portfolio').textContent = st.settings.portfolioName || '';
  // top note: view only
  const tn = $('rb-topnote');
  tn.hidden = !st.readOnly;
  if (st.readOnly) tn.innerHTML = String(ui.tag('View only', 'accent', 'key'));
  document.documentElement.classList.toggle('is-readonly', !!st.readOnly);
  // rail footer (v3): Help and a compact text-size control on one row; the sync note lives in Settings now.
  const foot = $('rb-sync');
  if (!foot.dataset.built) {
    foot.dataset.built = '1';
    foot.innerHTML = String(h`<div class="rail-foot-row"><button type="button" class="btn btn-ghost rail-help" id="rb-help" data-cmd="help:howto">${ui.icon('alert')}<span class="rail-help-label">Help</span></button>
      <div class="rail-textsize">${ui.textSizeControl({ id: 'rb-ts', letters: true })}</div></div>`);
  }
  // banner: one line, one link
  const bn = $('rb-banner');
  let banner = null;
  if (st.loadIssue === 'timeout') banner = h`<div class="banner-text"><strong>Can’t reach your saved information yet.</strong> Still trying — what you see may be out of date.</div>`;
  else if (st.loadIssue === 'error') banner = h`<div class="banner-text"><strong>Live updates stopped.</strong> Close this page and open it again to reconnect.</div>`;
  else if (st.ready && RB.store.hasSample()) banner = h`<div class="banner-text">These are example tenants —</div><div class="banner-actions"><button type="button" class="btn-link" id="rb-banner-remove" data-cmd="sample:remove" data-write>Remove them</button></div>`;
  bn.hidden = !banner;
  bn.className = 'banner' + (st.loadIssue ? ' banner-warn' : '');
  if (banner) { const s2 = String(banner); if (bn.innerHTML !== s2) bn.innerHTML = s2; }
}
/** Tenants with any rent month open past its grace period (status 'late'), current or earlier. */
function lateTenants() {
  return RB.store.tenantsList().filter(t => { const lg = RB.store.ledger(t.id); return lg && Object.values(lg.months).some(m => m.status === 'late'); });
}
/** The "saved on this device only" / "Everything is saved" note (SafeHTML) — Settings shows it under "Who can see this". */
ui.syncNote = () => syncNote(RB.store.state);
function syncNote(st) {
  let dot = 'dot', text;
  if (st.readOnly) { dot = 'dot dot-accent'; text = 'View only'; }
  else if (!st.mode) { dot = 'dot dot-accent dot-pulse'; text = 'Connecting…'; }
  else if (st.mode === 'local') { dot = 'dot dot-warn'; text = 'Not syncing — saved on this device only'; }
  else if (st.loadIssue) { dot = 'dot dot-warn'; text = st.loadIssue === 'timeout' ? 'Can’t reach your saved information yet' : 'Not syncing'; }
  else if (st.saving) { dot = 'dot dot-accent dot-pulse'; text = 'Saving…'; }
  else if (!st.synced) { dot = 'dot dot-accent dot-pulse'; text = 'Loading…'; }
  else { dot = 'dot dot-ok'; text = 'Everything is saved'; }
  return h`<div class="sync-note"><span class="${dot}" aria-hidden="true"></span><span class="sync-text">${text}</span></div>`;
}
let titleOverride = null;

// ================================================================= Find (palette) & Add menu
function openPalette(query) {
  if (ui.topLayer() && ui.topLayer().kind === 'palette') return;
  ui.palette({
    placeholder: 'Find a tenant or do something…', label: 'Find', query: query || '',
    emptyText: 'Nothing found for',
    source: q => {
      const groups = [];
      const ql = q.trim();
      const tenants = RB.store.state.ready ? RB.store.tenantsList() : [];
      if (ql) {
        const matches = tenants.map(t => ({ t, s: ui.match([t.name, t.unit, t.property, t.phone, t.email, (t.coTenants || []).map(c => c.name).join(' ')].join(' · '), ql) }))
          .filter(x => x.s >= 0).sort((a, b) => a.s - b.s || (a.t.status === 'past') - (b.t.status === 'past')).slice(0, 7);
        if (matches.length) {
          groups.push({ group: 'Tenants', items: matches.map(({ t }) => { const lg = RB.store.ledger(t.id); return { id: 't:' + t.id, label: t.name, sub: t.property + (t.status === 'past' ? ' · moved out' : ''), plate: t.unit, hint: lg ? ui.balanceWords(lg.balance) : '', run: () => RB.actions.openTenant(t.id) }; }) });
          if (matches.length <= 3 && RB.store.canWrite()) {
            const t = matches[0].t;
            groups.push({ group: 'For ' + t.name, items: [
              { id: 'pay', label: 'Record a payment', sub: '— ' + t.name, icon: 'cash', run: () => RB.actions.recordPayment(t.id) },
              { id: 'note', label: 'Write a note', sub: '— ' + t.name, icon: 'note', run: () => RB.actions.addNote(t.id) },
              { id: 'chg', label: 'Add a charge', sub: '— ' + t.name, icon: 'plus', run: () => RB.actions.addCharge(t.id) },
            ] });
          }
        }
      }
      const cmds = RB.commands.list().filter(c => !(c.write && !RB.store.canWrite()))
        .map(c => ({ c, s: ui.match(c.label + ' ' + (c.keywords || '') + ' ' + (c.group || ''), ql) })).filter(x => x.s >= 0)
        .sort((a, b) => a.s - b.s);
      const byGroup = {};
      cmds.forEach(({ c }) => { (byGroup[c.group || 'Things you can do'] = byGroup[c.group || 'Things you can do'] || []).push({ id: c.id, label: c.label, icon: c.icon || 'arrow-right', run: () => RB.commands.run(c.id) }); });
      ['Things you can do', 'Go to'].concat(Object.keys(byGroup).filter(g => g !== 'Things you can do' && g !== 'Go to')).forEach(g => { if (byGroup[g]) groups.push({ group: g, items: byGroup[g].slice(0, ql ? 8 : 12) }); });
      return groups;
    },
  });
}
/** v3: the top-bar "+ Add" menu is gone. The `n` / `+` keys open the same things as a choices sheet. */
function quickAdd() {
  const items = RB.commands.list().filter(c => c.quickAdd && !(c.write && !RB.store.canWrite())).sort((a, b) => a.quickAdd - b.quickAdd)
    .map(c => ({ label: c.label, run: () => RB.commands.run(c.id), write: c.write }));
  return ui.choices({ title: 'What would you like to do?', items });
}
async function withTenant(title, fn, opts) { const id = await ui.pickTenant(Object.assign({ title }, opts || {})); if (id) fn(id); return id; }

function registerBuiltins() {
  const C = RB.commands, A = RB.actions;
  NAV.forEach(n => C.register({ id: 'go:' + n.route, label: 'Go to ' + n.label, group: 'Go to', icon: n.icon, keywords: 'go open page ' + n.label, run: () => go(n.route) }));
  C.register({ id: 'go:upkeep', label: 'Go to Repairs', group: 'Go to', icon: 'wrench', when: () => false, run: () => go('repairs') });
  C.register({ id: 'payment:record', label: 'Record a rent payment', group: 'Things you can do', icon: 'cash', quickAdd: 1, write: true, keywords: 'pay rent received money paid', run: () => withTenant('Who paid you?', id => A.recordPayment(id), { prefer: 'owes' }) });
  C.register({ id: 'payment:part', label: 'A tenant paid only part of the rent', group: 'Things you can do', icon: 'cash', write: true, keywords: 'partial part payment some', run: () => withTenant('Who paid part of the rent?', id => A.recordPayment(id, { part: true }), { prefer: 'owes' }) });
  C.register({ id: 'ticket:add', label: 'Log a repair', group: 'Things you can do', icon: 'wrench', quickAdd: 2, write: true, keywords: 'repair maintenance fix broken upkeep ticket', run: () => A.addTicket() });
  C.register({ id: 'tenant:add', label: 'Add a tenant', group: 'Things you can do', icon: 'user', quickAdd: 3, write: true, keywords: 'new tenant lease move in', run: () => A.addTenant() });
  C.register({ id: 'charge:add', label: 'Add a charge', group: 'Things you can do', icon: 'plus', quickAdd: 4, write: true, keywords: 'fee utility damage bill', run: () => withTenant('Who is the charge for?', id => A.addCharge(id)) });
  C.register({ id: 'credit:add', label: 'Take money off what someone owes', group: 'Things you can do', icon: 'undo', quickAdd: 5, write: true, keywords: 'credit refund discount money off', run: () => withTenant('Whose bill are you lowering?', id => A.addCredit(id), { prefer: 'owes' }) });
  C.register({ id: 'note:add', label: 'Write a note', group: 'Things you can do', icon: 'note', quickAdd: 6, write: true, keywords: 'log call text email visit follow up reminder', run: () => withTenant('Who is the note about?', id => A.addNote(id)) });
  C.register({ id: 'setup:import', label: 'Bring in my tenants', group: 'Things you can do', icon: 'upload', write: true, keywords: 'csv paste import spreadsheet excel', run: () => go('setup', 'import') });
  C.register({ id: 'backup:download', label: 'Save a copy of everything', group: 'Things you can do', icon: 'download', keywords: 'export save json backup', run: () => A.backup() });
  C.register({ id: 'sample:load', label: 'Load sample tenants', group: 'Things you can do', icon: 'sample', write: true, keywords: 'demo example', when: () => !RB.store.hasSample(), run: () => A.loadSample() });
  C.register({ id: 'sample:remove', label: 'Remove sample tenants', group: 'Things you can do', icon: 'trash', write: true, keywords: 'demo example clear', when: () => RB.store.hasSample(), run: () => A.removeSample() });
  C.register({ id: 'help:howto', label: 'Help — How do I…?', group: 'Help', icon: 'alert', keywords: 'help how question stuck', run: () => helpSheet() });
  // Keyboard shortcuts still work but are not advertised in the main UI (Settings → "Keyboard shortcuts" uses this id).
  C.register({ id: 'help:keys', label: 'Keyboard shortcuts', group: 'Help', icon: 'keyboard', when: () => false, run: () => keysSheet() });
  C.register({ id: 'textsize', label: 'Make the text bigger or smaller', group: 'Help', icon: 'search', keywords: 'text size font larger bigger zoom read glasses', run: () => textSizeSheet() });
}

// ================================================================= Help: "How do I…?"
const pickThen = (title, fn, opts) => () => withTenant(title, fn, opts);
const hook = (name, id, fallback) => (typeof RB.actions[name] === 'function' ? RB.actions[name](id) : fallback(id));
/** Eight-plus plain answers, each with a button that starts the task. Hooks are used defensively (fallback: open the right page). */
const HELP = [
  { id: 'pay', q: 'Record a rent payment', a: 'Someone paid you. Choose who paid, check the amount, and press the big Record button. You can undo it straight after.', btn: 'Record a payment now', run: () => RB.commands.run('payment:record') },
  { id: 'part', q: 'A tenant paid only part of the rent', a: 'Choose who paid, pick “Only part of it”, and type the amount you got. Rent Book keeps track of what they still owe.', btn: 'Record a part payment', run: () => RB.commands.run('payment:part') },
  { id: 'fix', q: 'Fix a mistake', a: 'Right after you do something, press Undo in the message at the bottom of the screen. Later on: open the tenant, tap the payment in their Payment history, then choose Change or Remove.', btn: 'Find the tenant', run: pickThen('Whose payment was wrong?', id => RB.actions.openTenant(id)) },
  { id: 'tenant', q: 'Add a tenant', a: 'Write down their name, which unit they live in and the rent. It takes a minute, a step at a time.', btn: 'Add a tenant now', run: () => RB.commands.run('tenant:add') },
  { id: 'repair', q: 'Log a repair', a: 'Write down what needs fixing and where. You can add who fixed it and what it cost later.', btn: 'Log a repair now', run: () => RB.commands.run('ticket:add') },
  { id: 'owes', q: 'See who owes me money', a: 'The Rent page lists everyone who still owes for the month at the top, with how much and how late.', btn: 'Show who still owes', run: () => go('rent', 'owes') },
  { id: 'raise', q: 'Raise the rent', a: 'Choose the tenant, then the new amount and the date it starts. Earlier months keep the old rent.', btn: 'Choose a tenant', run: pickThen('Whose rent is going up?', id => hook('changeRent', id, RB.actions.openTenant)) },
  { id: 'moving', q: 'A tenant is moving out', a: 'Choose the tenant and the day they leave. Rent Book works out the last month’s rent and reminds you to return the deposit.', btn: 'Choose a tenant', run: pickThen('Who is moving out?', id => hook('giveNotice', id, x => hook('moveOut', x, RB.actions.openTenant))) },
  { id: 'history', q: 'See a property’s repair history', a: 'Repairs has a “History by property” tab: every repair for a building, what it cost, and anything that keeps coming back.', btn: 'Show repair history', run: () => go('repairs', 'history') },
];
function helpSheet() {
  const sh = ui.sheet({
    title: 'How do I…?', sub: 'Choose a question. Each one has a button that starts it for you.', size: 'wide', cancel: false,
    actions: [{ id: 'ok', label: 'Close', kind: '' }],
    body: h`<ol class="help-list">${HELP.map(x => h`<li class="help-item" id="help-${x.id}">
      <h3 class="help-q">${x.q}</h3><p class="help-a">${x.a}</p>
      <button type="button" class="btn btn-soft help-go" id="help-go-${x.id}" data-help="${x.id}">${x.btn}${ui.icon('arrow-right')}</button></li>`)}</ol>
      <div class="help-foot">${ui.textSizeControl({ id: 'help-ts' })}<p class="caption">Nothing you do here is permanent: every change shows a message with an Undo button for 10 seconds.</p></div>`,
  });
  sh.body.addEventListener('click', e => {
    const b = e.target.closest('[data-help]'); if (!b) return;
    const x = HELP.find(y => y.id === b.dataset.help);
    sh.close();
    if (x) setTimeout(() => { try { x.run(); } catch (err) { console.error(err); } }, 0);
  });
  return sh;
}
function textSizeSheet() {
  ui.sheet({ title: 'Text size', sub: 'Make everything bigger or smaller. This device remembers your choice.', cancel: false, actions: [{ id: 'ok', label: 'Done', kind: 'primary' }],
    body: h`${ui.textSizeControl({ id: 'tss', compact: true })}<p class="say mt-4">This is how text will look.</p>` });
}

// ================================================================= keyboard (kept for people who like it; not advertised)
const GLOBAL_KEYS = [
  ['/', 'Find'], ['⌘K / Ctrl K', 'Find'], ['n', 'Add'], ['?', 'Keyboard shortcuts'], ['Esc', 'Close'],
].concat(NAV.map(n => ['g ' + n.key, 'Go to ' + n.label]));
function keysSheet() {
  const def = viewDef(cur.view);
  const viewKeys = (def && def.shortcuts) || [];
  const row = ([k, label]) => h`<div class="keys-row"><span>${label}</span><span>${k.split(' / ').map((alt, i) => h`${i ? raw(' <span class="muted">or</span> ') : ''}${alt.split(' ').map(x => ui.kbd(x))}`)}</span></div>`;
  ui.sheet({
    title: 'Keyboard shortcuts', sub: 'Optional. Everything can also be done with the buttons.', size: 'wide', cancel: false, actions: [{ id: 'ok', label: 'Close', kind: '' }],
    body: h`<div class="keys"><div class="keys-group"><div class="sec-sm mb-2"><span class="sec-title">Everywhere</span></div>${GLOBAL_KEYS.map(row)}</div>
      ${viewKeys.length ? h`<div class="keys-group"><div class="sec-sm mb-2"><span class="sec-title">${(def && def.title && typeof def.title === 'string' ? def.title : cur.view)}</span></div>${viewKeys.map(row)}</div>` : ''}</div>`,
  });
}
let gPending = 0;
// Only text-entry controls swallow shortcuts. Checkboxes, radios, buttons, ranges and the like keep j/k/p… working.
const TEXT_ENTRY = 'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"], input[type="number"], input[type="date"], input[type="datetime-local"], input[type="month"], input[type="week"], input[type="time"]';
function isTyping(t) { return !!(t && t.closest && t.closest(TEXT_ENTRY)); }
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
  if (e.key === '?') { e.preventDefault(); keysSheet(); return; }
  if (e.key === 'n' || e.key === '+') { e.preventDefault(); quickAdd(); return; }
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
  const sh = ui.sheet({
    title: 'More', cancel: false, actions: [{ id: 'ok', label: 'Close', kind: '' }],
    body: h`<div class="more-list">${NAV.filter(n => !TABS.includes(n.route) && n.route !== 'today').map(n => h`<a class="menu-item" href="#${n.route}" id="more-${n.route}" data-more>${ui.icon(n.icon)}<span>${n.label}</span></a>`)}
      <button type="button" class="menu-item" id="more-help" data-cmd="help:howto" data-more>${ui.icon('alert')}<span>Help — How do I…?</span></button></div>
      <div class="more-textsize">${ui.textSizeControl({ id: 'more-ts' })}</div>`,
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
  setTitle(text) { titleOverride = text || null; const def = viewDef(cur.view); $('rb-title').textContent = text || (def && typeof def.title === 'string' ? def.title : '') || ''; },
  openPalette, quickAdd, lateTenants,
  /** "How do I…?" help sheet (rule 9). */
  helpSheet,
  /** Keyboard shortcuts list (not advertised in the main UI; Settings links to it with data-cmd="help:keys"). */
  keysSheet, textSizeSheet,
  /** The Help answers (id, q, a, btn, run) — for tests and for Settings to reuse. */
  HELP,
  start() {
    if (started) return; started = true;
    registerBuiltins();
    $('rb-search-icon').innerHTML = String(ui.icon('search'));
    $('rb-find').innerHTML = String(h`${ui.icon('search')}<span>Find</span>`);

    const search = $('rb-search');
    // The top-bar field is an affordance for the palette: clicking or typing in it opens the palette with that text.
    search.addEventListener('mousedown', e => { e.preventDefault(); openPalette(search.value); });
    search.addEventListener('keydown', e => {
      if ((e.key.length === 1 && !e.metaKey && !e.ctrlKey) || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openPalette(e.key.length === 1 ? e.key : ''); }
    });
    $('rb-find').addEventListener('click', () => openPalette());

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

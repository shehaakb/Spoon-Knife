// 20-store.js — RB.store: single source of truth. Cloud mode (artifact db) or local mode (localStorage).
// State is DERIVED: server docs (from snapshots / localStorage) + pending optimistic writes folded on top.
// Never write on load, in render or in a snapshot callback — only from user actions.
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date;

const COLS = ['meta', 'tenants', 'ledgers', 'tickets'];
const LOCAL_KEY = 'rb:data:v1';
const LOAD_TIMEOUT_MS = 10000;
const MAX_INFLIGHT = 4;

const server = { meta: {}, tenants: {}, ledgers: {}, tickets: {} };   // id -> data (frozen in cloud mode)
const viewDocs = { meta: {}, tenants: {}, ledgers: {}, tickets: {} }; // id -> derived data (server + pending)
let pending = [];                                                     // optimistic ops not yet confirmed
let seq = 0;
let db = null;
const queues = {};             // doc path -> promise chain (one write at a time per document)
let inflight = 0;
const waiters = [];
const delivered = {};          // collection -> got a snapshot
const confirmed = {};          // collection -> got a non-cache snapshot
let loadTimer = null;
const unsubs = {};
const resubTries = {};
const listeners = new Set();
let notifyScheduled = false;
let version = 0;
let today = D.today();
let settingsCache = { src: undefined, val: null };

const state = {
  settings: RB.model.settingsWithDefaults({}),
  tenants: viewDocs.tenants,
  ledgers: viewDocs.ledgers,
  tickets: viewDocs.tickets,
  ready: false,          // first data (or timeout) has arrived — views may show empty states
  mode: null,            // null while resolving, then 'cloud' | 'local'
  readOnly: false,       // writes are rejected for this viewer ("View only")
  loadIssue: null,       // null | 'timeout' (still waiting after 10 s) | 'error' (a listener died)
  synced: false,         // cloud: every collection confirmed by the server
  saving: 0,             // writes in flight
  today,
};

// ------------------------------------------------------------------ helpers
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
/** db-style deep merge: nested plain objects merge, everything else (arrays, null, scalars) replaces. Returns new objects along changed paths. */
function mergeDeep(base, patch) {
  const out = Object.assign({}, isObj(base) ? base : {});
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k], v) : (isObj(v) ? mergeDeep({}, v) : v);
  }
  return out;
}
function applyOp(doc, op) {
  if (op.kind === 'set') return RB.clone(op.data);
  if (op.kind === 'update') return doc === undefined ? undefined : mergeDeep(doc, op.data); // update on a missing doc fails in the db too
  if (op.kind === 'delete') return undefined;
  return doc;
}
function recompute(col, id) {
  let d = server[col][id];
  for (const op of pending) if (op.col === col && op.id === id) d = applyOp(d, op);
  if (d === undefined) delete viewDocs[col][id]; else viewDocs[col][id] = d;
}
function recomputeCol(col) {
  const ids = new Set(Object.keys(server[col]).concat(Object.keys(viewDocs[col]), pending.filter(o => o.col === col).map(o => o.id)));
  ids.forEach(id => recompute(col, id));
}
function refreshSettings() {
  const src = viewDocs.meta.settings;
  if (settingsCache.src !== src || !settingsCache.val) {
    settingsCache = { src, val: RB.model.settingsWithDefaults(src) };
    RB.money.setCurrency(settingsCache.val.currency);
  }
  state.settings = settingsCache.val;
}
function changed() {
  version++;
  refreshSettings();
  state.saving = inflight + waiters.length;
  if (notifyScheduled) return;
  notifyScheduled = true;
  const run = () => { notifyScheduled = false; listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
}
function toast(msg, opts) { if (RB.ui && RB.ui.toast) RB.ui.toast(msg, Object.assign({ tone: 'bad' }, opts)); else console.warn(msg); }
function fail(msg) { const e = new Error(msg); e.code = 'rejected_locally'; return Promise.reject(e); }

// ------------------------------------------------------------------ local persistence
const persistLocal = RB.debounce(() => {
  try { globalThis.localStorage.setItem(LOCAL_KEY, JSON.stringify(server)); }
  catch (e) { toast('Couldn’t save on this device — storage is full or blocked.'); }
}, 250);
// never lose the last debounced write when the page goes away
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => { if (state.mode === 'local') persistLocal.flush(); });
  addEventListener('visibilitychange', () => { if (state.mode === 'local' && document.visibilityState === 'hidden') persistLocal.flush(); });
}
function loadLocal() {
  try {
    const raw = globalThis.localStorage.getItem(LOCAL_KEY);
    if (raw) { const d = JSON.parse(raw); COLS.forEach(c => { server[c] = isObj(d[c]) ? d[c] : {}; }); }
  } catch (e) { /* corrupt or blocked: start empty */ }
}

// ------------------------------------------------------------------ write pipeline
function acquireSlot() { if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve(); } return new Promise(r => waiters.push(r)); }
function releaseSlot() { const w = waiters.shift(); if (w) w(); else inflight--; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runWrite(op) {
  const ref = db.doc(op.col + '/' + op.id);
  const call = () => op.kind === 'set' ? ref.set(RB.clone(op.data)) : op.kind === 'update' ? ref.update(RB.clone(op.data)) : ref.delete();
  await acquireSlot();
  changed();
  try {
    try { await call(); }
    catch (e) {
      const code = e && e.code;
      const known = ['invalid_argument', 'resource_exhausted', 'quota_exceeded', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'];
      if (code === 'unavailable' || !known.includes(code)) { await sleep(300 + Math.random() * 700); await call(); } // transient: retry once
      else throw e;
    }
  } finally { releaseSlot(); changed(); }
}

function handleWriteError(err, op) {
  const code = err && err.code;
  if (code === 'invalid_argument' || code === 'transform_error' || code === 'not_granted' || code === 'revoked') {
    if (!state.readOnly) {
      state.readOnly = true;
      toast('This rent book is view only for you — changes can’t be saved.');
    }
  } else if (code === 'quota_exceeded') toast('Storage for this rent book is full — remove sample data or old tenants to make room.');
  else if (code === 'resource_exhausted') toast('Too many changes at once — that one wasn’t saved. Try again in a moment.');
  else toast('Couldn’t save — check your connection and try again.');
  if (RB.emit) RB.emit('store:writeError', { error: err, op });
}

/**
 * Commit one document write. kind: 'set' | 'update' | 'delete'. Applies optimistically, then writes (cloud) or persists (local).
 * Resolves when stored; rejects (after rolling back + toasting) on failure.
 */
function commit(col, id, kind, data) {
  if (state.readOnly) { toast('View only — you can’t change this rent book.'); return fail('read_only'); }
  if (!state.mode || (state.mode === 'cloud' && !state.ready)) { toast('Still loading — try again in a moment.'); return fail('not_ready'); }
  const op = { seq: ++seq, col, id, kind, data: data === undefined ? undefined : RB.clone(data), acked: false };
  if (state.mode === 'local') {
    const next = applyOp(server[col][id], op);
    if (kind === 'update' && next === undefined) return fail('missing_document');
    if (next === undefined) delete server[col][id]; else server[col][id] = next;
    recompute(col, id); changed(); persistLocal();
    return Promise.resolve();
  }
  pending.push(op);
  recompute(col, id); changed();
  const path = col + '/' + id;
  const p = (queues[path] || Promise.resolve()).then(() => runWrite(op));
  queues[path] = p.catch(() => {});
  return p.then(() => {
    op.acked = true;
    setTimeout(() => dropOp(op), 45000); // fallback only: the next snapshot of this collection normally clears it
  }, err => {
    dropOp(op);
    handleWriteError(err, op);
    throw err;
  });
}
function dropOp(op) {
  const i = pending.indexOf(op);
  if (i < 0) return;
  pending.splice(i, 1);
  recompute(op.col, op.id); changed();
}

// ------------------------------------------------------------------ cloud subscriptions
function onSnap(col, snap) {
  const next = {};
  for (const d of snap.docs) { if (d.exists !== false) next[d.id] = d.data(); }
  server[col] = next;
  // the db applies our own writes to snapshots (latency compensation), so confirmed ops can go
  pending = pending.filter(o => !(o.col === col && o.acked));
  recomputeCol(col);
  delivered[col] = true;
  if (!snap.metadata || !snap.metadata.fromCache) confirmed[col] = true;
  resubTries[col] = 0;
  // Don't flash the empty first-run panel from an empty cached snapshot: wait for the server's answer on tenants
  // (or any cached tenants, or the 10 s timeout / an error).
  if (!state.ready && COLS.every(c => delivered[c]) && (confirmed.tenants || Object.keys(server.tenants).length)) state.ready = true;
  if (COLS.every(c => confirmed[c])) {
    state.synced = true;
    if (state.loadIssue === 'timeout') state.loadIssue = null;
    clearTimeout(loadTimer);
  }
  changed();
}
function onSnapError(col, err) {
  const code = err && err.code;
  delivered[col] = true; // an error ends the loading state for this collection
  if (!state.ready && COLS.every(c => delivered[c])) state.ready = true;
  if (code === 'revoked') { state.readOnly = true; state.loadIssue = 'error'; changed(); return; }
  if (code === 'unavailable' || !code) {
    // host stopped answering: the only recovery is a fresh listener (bounded backoff)
    const n = (resubTries[col] = (resubTries[col] || 0) + 1);
    if (n <= 5) { setTimeout(() => subscribe(col), Math.min(30000, 2000 * n)); return; }
  }
  state.loadIssue = 'error';
  changed();
}
function subscribe(col) {
  if (unsubs[col]) { try { unsubs[col](); } catch (e) { /* ignore */ } }
  try {
    unsubs[col] = db.collection(col).onSnapshot(snap => onSnap(col, snap), err => onSnapError(col, err));
  } catch (e) { onSnapError(col, e); }
}

// ------------------------------------------------------------------ boot
async function start() {
  if (start.started) return; start.started = true;
  changed(); // render immediately in "loading"
  let resolved = null;
  try {
    const c = globalThis.window && window.claude;
    resolved = c && typeof c.use === 'function' ? await c.use('db') : null;
  } catch (e) { resolved = null; }
  if (resolved) {
    db = resolved;
    state.mode = 'cloud';
    loadTimer = setTimeout(() => {
      if (!state.synced) { state.loadIssue = 'timeout'; state.ready = true; changed(); }
    }, LOAD_TIMEOUT_MS);
    COLS.forEach(subscribe);
    // optional: the platform may tell us up front that this viewer cannot write
    try {
      const u = await window.claude.use('user');
      if (u && typeof u.can === 'function') { const can = await u.can('data.write'); if (can === false) { state.readOnly = true; changed(); } }
    } catch (e) { /* not declared / unavailable: rely on rejected writes */ }
  } else {
    state.mode = 'local';
    loadLocal();
    COLS.forEach(recomputeCol);
    state.ready = true; state.synced = true;
  }
  changed();
}

// ------------------------------------------------------------------ selectors (memoised)
const ledgerCache = new Map(); // tenantId -> {t, l, s, today, val}
function ledger(tenantId) {
  const t = viewDocs.tenants[tenantId];
  if (!t) return null;
  const l = viewDocs.ledgers[tenantId];
  const c = ledgerCache.get(tenantId);
  if (c && c.t === t && c.l === l && c.s === state.settings && c.today === today) return c.val;
  const val = RB.model.buildLedger(Object.assign({ id: tenantId }, t), (l && l.entries) || {}, state.settings, today);
  ledgerCache.set(tenantId, { t, l, s: state.settings, today, val });
  return val;
}
let listCache = { v: -1, val: null, key: '' };
/** Tenants as an array with ids, sorted property → unit (natural) → name. opts.includePast (default true). */
function tenantsList(opts) {
  const includePast = !opts || opts.includePast !== false;
  const key = includePast ? 'all' : 'cur';
  if (listCache.src !== viewDocs.tenants || listCache.key !== key || listCache.n !== Object.keys(viewDocs.tenants).length || listCache.v !== version) {
    const arr = Object.keys(viewDocs.tenants).map(id => Object.assign({ id }, viewDocs.tenants[id], { id }));
    listCache = { v: version, src: viewDocs.tenants, key, n: arr.length, val: RB.model.sortTenants(arr.filter(t => includePast || t.status !== 'past')) };
  }
  return listCache.val;
}
function ticketsList() { return Object.keys(viewDocs.tickets).map(id => Object.assign({ id }, viewDocs.tickets[id], { id })); }
const memo = {};
function memoByVersion(name, fn) { const m = memo[name]; if (m && m.v === version && m.today === today) return m.val; const val = fn(); memo[name] = { v: version, today, val }; return val; }
const getLedger = id => ledger(id);
const modelState = () => ({ settings: state.settings, tenants: viewDocs.tenants, ledgers: viewDocs.ledgers, tickets: viewDocs.tickets });

// ------------------------------------------------------------------ mutations
const now = () => D.nowIso();
function stripId(o) { const c = RB.clone(o) || {}; delete c.id; return c; }

function saveSettings(patch) {
  if (viewDocs.meta.settings) return commit('meta', 'settings', 'update', patch);
  return commit('meta', 'settings', 'set', mergeDeep(RB.model.settingsWithDefaults({}), patch));
}
function addTenant(data) {
  const id = (data && data.id) || RB.id();
  const doc = Object.assign({
    name: '', phone: '', email: '', coTenants: [], emergency: { name: '', phone: '' }, property: '', unit: '', status: 'active',
    lease: { start: null, end: null, moveIn: null, noticeDate: null, moveOut: null, dueDay: null, graceDays: null },
    rent: [], recurring: [], trackFrom: null, opening: null, deposit: { amount: 0, received: null, heldAt: '', returned: null },
    insurance: null, links: [], about: '', log: {},
  }, stripId(data), { createdAt: now(), updatedAt: now() });
  if (!doc.trackFrom) doc.trackFrom = doc.lease.moveIn || doc.lease.start || today;
  return commit('tenants', id, 'set', doc).then(() => id);
}
function updateTenant(id, patch) {
  if (!viewDocs.tenants[id]) return fail('missing_tenant');
  return commit('tenants', id, 'update', Object.assign(stripId(patch), { updatedAt: now() }));
}
function deleteTenant(id) {
  const ps = [commit('tenants', id, 'delete')];
  if (viewDocs.ledgers[id] || server.ledgers[id]) ps.push(commit('ledgers', id, 'delete'));
  return Promise.all(ps).then(() => undefined);
}
function addEntry(tenantId, entry) {
  const id = (entry && entry.id) || RB.id();
  const e = Object.assign({ void: false }, stripId(entry), { createdAt: now() });
  e.amount = Math.abs(Math.round(+e.amount || 0));
  const p = viewDocs.ledgers[tenantId]
    ? commit('ledgers', tenantId, 'update', { entries: { [id]: e } })
    : commit('ledgers', tenantId, 'set', { entries: { [id]: e } });
  return p.then(() => id);
}
function updateEntry(tenantId, entryId, patch) {
  const lg = viewDocs.ledgers[tenantId];
  if (!lg || !lg.entries || !lg.entries[entryId]) return fail('missing_entry');
  const p = stripId(patch);
  if (p.amount !== undefined) p.amount = Math.abs(Math.round(+p.amount || 0));
  p.updatedAt = now();
  return commit('ledgers', tenantId, 'update', { entries: { [entryId]: p } });
}
const voidEntry = (tenantId, entryId) => updateEntry(tenantId, entryId, { void: true });
const unvoidEntry = (tenantId, entryId) => updateEntry(tenantId, entryId, { void: false, undone: false });
/** Undo of a just-added entry: void + hidden from the ledger entirely. */
const undoEntry = (tenantId, entryId) => updateEntry(tenantId, entryId, { void: true, undone: true });
function addLog(tenantId, log) {
  const id = (log && log.id) || RB.id();
  const e = Object.assign({ at: now(), kind: 'note', text: '', followUp: null, done: false }, stripId(log));
  return commit('tenants', tenantId, 'update', { log: { [id]: e }, updatedAt: now() }).then(() => id);
}
const updateLog = (tenantId, logId, patch) => commit('tenants', tenantId, 'update', { log: { [logId]: stripId(patch) }, updatedAt: now() });
/** No field delete in the db: a removed log entry is stored as null and ignored everywhere. */
const deleteLog = (tenantId, logId) => commit('tenants', tenantId, 'update', { log: { [logId]: null }, updatedAt: now() });
function addTicket(data) {
  const id = (data && data.id) || RB.id();
  const doc = Object.assign({ tenantId: null, property: '', unit: '', title: '', detail: '', priority: 'normal', status: 'open',
    reported: today, scheduled: null, completed: null, vendor: '', cost: null, paidBy: 'owner' }, stripId(data), { createdAt: now(), updatedAt: now() });
  return commit('tickets', id, 'set', doc).then(() => id);
}
const updateTicket = (id, patch) => commit('tickets', id, 'update', Object.assign(stripId(patch), { updatedAt: now() }));
const deleteTicket = id => commit('tickets', id, 'delete');

function asMap(x) {
  if (!x) return {};
  if (Array.isArray(x)) { const m = {}; x.forEach(d => { if (d) { const id = d.id || RB.id(); m[id] = stripId(d); } }); return m; }
  return x;
}
/**
 * Write many docs. data: {settings?, tenants?, ledgers?, tickets?} (maps id→doc or arrays with .id).
 * opts.replace: delete every existing tenant/ledger/ticket not in `data` (restore from backup).
 * Resolves {written, deleted}.
 */
async function importAll(data, opts) {
  const replace = !!(opts && opts.replace);
  const tenants = asMap(data.tenants), ledgers = asMap(data.ledgers), tickets = asMap(data.tickets);
  const ps = [];
  let deleted = 0;
  if (data.settings) ps.push(commit('meta', 'settings', 'set', mergeDeep(viewDocs.meta.settings || RB.model.settingsWithDefaults({}), data.settings)));
  if (replace) {
    for (const id of Object.keys(viewDocs.tenants)) if (!tenants[id]) { ps.push(commit('tenants', id, 'delete')); deleted++; }
    for (const id of Object.keys(viewDocs.ledgers)) if (!ledgers[id]) ps.push(commit('ledgers', id, 'delete'));
    for (const id of Object.keys(viewDocs.tickets)) if (!tickets[id]) ps.push(commit('tickets', id, 'delete'));
  }
  for (const id of Object.keys(tenants)) ps.push(commit('tenants', id, 'set', stripId(tenants[id])));
  for (const id of Object.keys(ledgers)) ps.push(commit('ledgers', id, 'set', { entries: (ledgers[id] && (ledgers[id].entries || ledgers[id])) || {} }));
  for (const id of Object.keys(tickets)) ps.push(commit('tickets', id, 'set', stripId(tickets[id])));
  const res = await Promise.allSettled(ps);
  const failed = res.filter(r => r.status === 'rejected').length;
  if (failed) throw Object.assign(new Error(failed + ' of ' + res.length + ' writes failed'), { code: 'partial_failure', failed });
  return { written: ps.length - deleted, deleted };
}
/** Delete every tenant/ticket with sample:true (and their ledgers); hasSample → false. Resolves {tenants, tickets}. */
async function removeSample() {
  const ts = Object.keys(viewDocs.tenants).filter(id => viewDocs.tenants[id].sample);
  const ks = Object.keys(viewDocs.tickets).filter(id => viewDocs.tickets[id].sample);
  const ps = [];
  ts.forEach(id => ps.push(deleteTenant(id)));
  ks.forEach(id => ps.push(commit('tickets', id, 'delete')));
  if (viewDocs.meta.settings && viewDocs.meta.settings.hasSample) ps.push(saveSettings({ hasSample: false }));
  await Promise.all(ps);
  return { tenants: ts.length, tickets: ks.length };
}
/** Plain JSON-able backup of everything. */
function exportAll() {
  return {
    format: 'rent-book-backup', version: 1, exportedAt: now(),
    settings: RB.clone(viewDocs.meta.settings || state.settings),
    tenants: RB.clone(viewDocs.tenants), ledgers: RB.clone(viewDocs.ledgers), tickets: RB.clone(viewDocs.tickets),
  };
}

// ------------------------------------------------------------------ public API
RB.store = {
  state,
  start,
  /** fn(state) after any change; batched to one call per animation frame. Returns unsubscribe. */
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get version() { return version; },
  today: () => today,
  /** Change "today" (midnight rollover; tests). Invalidates every derived value. */
  setToday(d) { if (D.isDate(d) && d !== today) { today = d; state.today = d; changed(); } },
  settings: () => state.settings,
  tenant: id => (viewDocs.tenants[id] ? Object.assign({ id }, viewDocs.tenants[id], { id }) : null),
  entries: id => (viewDocs.ledgers[id] && viewDocs.ledgers[id].entries) || {},
  ticket: id => (viewDocs.tickets[id] ? Object.assign({ id }, viewDocs.tickets[id], { id }) : null),
  ledger,
  tenantsList,
  ticketsList,
  hasSample: () => Object.keys(viewDocs.tenants).some(id => viewDocs.tenants[id].sample),
  canWrite: () => !state.readOnly && !!state.mode,
  // memoised whole-portfolio selectors (recomputed once per store version / day)
  attention: () => memoByVersion('attention', () => RB.model.attention(modelState(), today, getLedger)),
  portfolio: period => memoByVersion('portfolio:' + (period || ''), () => RB.model.portfolio(modelState(), today, period, getLedger)),
  rentRoll: () => memoByVersion('rentRoll', () => RB.model.rentRoll(modelState(), today, getLedger)),
  aging: () => memoByVersion('aging', () => RB.model.aging(modelState(), today, getLedger)),
  collectionByMonth: n => memoByVersion('collection:' + (n || 12), () => RB.model.collectionByMonth(modelState(), today, n, getLedger)),
  incomeByYear: year => memoByVersion('income:' + year, () => RB.model.incomeByYear(modelState(), year, getLedger, today)),
  summary: id => { const t = RB.store.tenant(id); return t ? RB.model.tenantSummary(t, ledger(id), state.settings, today) : null; },
  modelState,
  // mutations
  saveSettings, addTenant, updateTenant, deleteTenant,
  addEntry, updateEntry, voidEntry, unvoidEntry, undoEntry,
  addLog, updateLog, deleteLog,
  addTicket, updateTicket, deleteTicket,
  importAll, removeSample, exportAll,
  /** Testing aid (local mode only): wipe everything. */
  _resetLocal() { if (state.mode !== 'local') return; COLS.forEach(c => { server[c] = {}; }); COLS.forEach(recomputeCol); persistLocal.flush(); changed(); },
};

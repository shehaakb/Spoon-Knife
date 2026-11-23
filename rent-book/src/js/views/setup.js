// views/setup.js — Setup: rules saved field by field, payment methods, spreadsheet import, backup/restore, sample data.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;

// ------------------------------------------------------------------ view state (survives store re-renders)
const drafts = {};          // key -> raw text the user typed but that isn't saved yet
const errs = {};            // key -> message
let flash = null;           // {key, until}
let methodDraft = '';
const imp = { text: '', fileName: '', map: null, mapFor: null, removeSample: null, done: null, fileErr: '' };
let restore = null;         // {data, name, summary} | {error, name}

// ------------------------------------------------------------------ helpers
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function canWrite() { if (!S().canWrite()) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return false; } return true; }

/** Plain-language rule sentence for the given settings. */
function ruleSentence(s) {
  const due = +s.dueDay || 1, g = +s.graceDays || 0, last = due + g;
  const first = 'Rent is due on the ' + ord(due) + (g ? ', with ' + RB.plural(g, 'day') + ' of grace.' : ', with no grace period.');
  const when = last <= 28 ? 'After the ' + ord(last) : 'More than ' + RB.plural(g, 'day') + ' after the due date';
  const lf = s.lateFee || {};
  if (lf.type === 'none' || !(+lf.amount > 0)) return first + ' Late fees are off — nothing is suggested.';
  if (lf.type === 'flat') return first + ' ' + when + ', suggest a ' + M.fmt(+lf.amount) + ' late fee.';
  const rents = S().tenantsList({ includePast: false }).map(t => RB.model.rentOn(t, S().today())).filter(Boolean).sort((a, b) => a - b);
  const ex = rents.length ? rents[Math.floor(rents.length / 2)] : 145000;
  return first + ' ' + when + ', suggest a late fee of ' + (+lf.amount) + '% of that month’s rent (' + M.fmt(Math.round(ex * lf.amount / 100)) + ' on ' + M.fmt(ex) + ').';
}

function showFlash(el, key) {
  flash = { key, until: Date.now() + 2200 };
  const f = el && el.querySelector('#st-saved-' + key);
  if (f) f.classList.add('is-on');
  setTimeout(() => {
    if (flash && flash.key === key && Date.now() >= flash.until - 5) flash = null;
    const x = document.getElementById('st-saved-' + key); if (x) x.classList.remove('is-on');
  }, 2200);
}
function setErr(el, key, msg) {
  if (msg) errs[key] = msg; else delete errs[key];
  const row = el && el.querySelector('[data-row="' + key + '"]');
  if (row) { row.classList.toggle('is-invalid', !!msg); const e = row.querySelector('.field-error'); if (e) e.textContent = msg || ''; }
}

/** Parse + validate a settings field; returns {patch} or {error}. */
function parseSetting(key, raw, s) {
  const v = String(raw == null ? '' : raw).trim();
  const int = (lo, hi, what) => { if (!/^\d+$/.test(v)) return { error: 'Enter a whole number of ' + what }; const n = +v; if (n < lo || n > hi) return { error: 'Between ' + lo + ' and ' + hi + ' ' + what }; return { n }; };
  switch (key) {
    case 'portfolioName': return { patch: { portfolioName: v.slice(0, 80) } };
    case 'dueDay': { const r = int(1, 28, 'days'); return r.error ? r : { patch: { dueDay: r.n } }; }
    case 'graceDays': { const r = int(0, 27, 'days'); return r.error ? r : { patch: { graceDays: r.n } }; }
    case 'depositReturnDays': { const r = int(0, 120, 'days'); return r.error ? r : { patch: { depositReturnDays: r.n } }; }
    case 'leaseNoticeDays': { const r = int(7, 365, 'days'); return r.error ? r : { patch: { leaseNoticeDays: r.n } }; }
    case 'lateFeeAmount': {
      if (s.lateFee.type === 'flat') { const c = M.parse(v); if (c === null || c <= 0) return { error: 'Enter an amount like 50' }; return { patch: { lateFee: { type: 'flat', amount: c } } }; }
      const p = Number(v.replace('%', '')); if (!v || !isFinite(p) || p <= 0 || p > 50) return { error: 'Enter a percentage between 0 and 50' };
      return { patch: { lateFee: { type: 'percent', amount: Math.round(p * 100) / 100 } } };
    }
  }
  return { error: 'Unknown setting' };
}
function saveSetting(el, key, raw) {
  if (!canWrite()) return;
  const s = S().settings();
  const r = parseSetting(key, raw, s);
  if (r.error) { setErr(el, key, r.error); return; }
  setErr(el, key, null);
  const cur = JSON.stringify(Object.keys(r.patch).reduce((o, k) => (o[k] = s[k], o), {}));
  delete drafts[key];
  if (JSON.stringify(r.patch) === cur || (key === 'lateFeeAmount' && s.lateFee.amount === r.patch.lateFee.amount)) return;
  S().saveSettings(r.patch).catch(() => {});
  showFlash(el, key);
}
function previewSettings() {
  const s = RB.clone(S().settings());
  ['dueDay', 'graceDays', 'lateFeeAmount'].forEach(k => {
    if (drafts[k] === undefined) return;
    const r = parseSetting(k, drafts[k], S().settings());
    if (r.patch) { if (r.patch.lateFee) s.lateFee = r.patch.lateFee; else Object.assign(s, r.patch); }
  });
  return s;
}

// ------------------------------------------------------------------ import
const FIELDS = [
  { key: '', label: 'Don’t import' },
  { key: 'name', label: 'Name', re: /(^|\b)(name|tenant|resident|lessee|occupant)/ },
  { key: 'unit', label: 'Unit', re: /(^|\b)(unit|apt|apartment|suite|door|house|no\.?$|#)/ },
  { key: 'property', label: 'Property', re: /(property|building|address|street|complex|bldg)/ },
  { key: 'phone', label: 'Phone', re: /(phone|mobile|cell|tel)/ },
  { key: 'email', label: 'Email', re: /e-?mail/ },
  { key: 'rent', label: 'Rent', re: /rent|monthly/ },
  { key: 'start', label: 'Lease start', re: /(start|move.?in|begin|commence|from)/ },
  { key: 'end', label: 'Lease end', re: /(end|expir|until|through|term.?date)/ },
  { key: 'deposit', label: 'Deposit', re: /deposit/ },
  { key: 'balance', label: 'Balance owed', re: /(balance|owed|owing|arrears|past.?due|outstanding)/ },
];
// matching order: specific words first, so "Tenant email" is email and "Rent deposit" is deposit
const MATCH_ORDER = ['email', 'phone', 'deposit', 'balance', 'start', 'end', 'rent', 'property', 'unit', 'name'];
function autoMap(header) {
  const used = new Set();
  return header.map(raw => {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return '';
    for (const k of MATCH_ORDER) { if (used.has(k)) continue; const f = FIELDS.find(x => x.key === k); if (f.re.test(s)) { used.add(k); return k; } }
    return '';
  });
}
/** Parse the pasted text into {header, rows, map, hasHeader}. */
function parsed() {
  const all = RB.model.parseDelimited(imp.text).slice(0, 1001);
  if (!all.length) return null;
  const width = Math.min(30, Math.max(...all.map(r => r.length)));
  const norm = all.map(r => Array.from({ length: width }, (_, i) => r[i] || ''));
  const auto = autoMap(norm[0]);
  const hasHeader = auto.some(Boolean);
  if (imp.mapFor !== imp.text.split(/\r?\n/, 1)[0] || !imp.map || imp.map.length !== width) {
    imp.map = hasHeader ? auto : norm[0].map(() => '');
    imp.mapFor = imp.text.split(/\r?\n/, 1)[0];
  }
  return { header: hasHeader ? norm[0] : norm[0].map((_, i) => 'Column ' + (i + 1)), rows: hasHeader ? norm.slice(1) : norm, hasHeader, width };
}
/** Validate one row under the current mapping → {ok, problems, data}. */
function checkRow(row, existing, today) {
  const get = k => { const i = imp.map.indexOf(k); return i >= 0 ? String(row[i] || '').trim() : ''; };
  const problems = [];
  const name = get('name').slice(0, 120);
  if (!name) problems.push('Missing name');
  const rentRaw = get('rent');
  const rent = rentRaw ? M.parse(rentRaw) : null;
  if (!rentRaw) problems.push('Missing rent'); else if (rent === null || rent <= 0) problems.push('Rent “' + rentRaw.slice(0, 20) + '” isn’t an amount');
  const date = (k, label) => { const v = get(k); if (!v) return null; const d = D.parseLoose(v, today); if (!d) problems.push(label + ' “' + v.slice(0, 20) + '” isn’t a date'); return d; };
  const start = date('start', 'Lease start'), end = date('end', 'Lease end');
  if (start && end && end <= start) problems.push('Lease ends before it starts');
  const money = (k, label) => { const v = get(k); if (!v) return 0; const c = M.parse(v); if (c === null) { problems.push(label + ' “' + v.slice(0, 20) + '” isn’t an amount'); return 0; } return c; };
  const deposit = money('deposit', 'Deposit'), balance = money('balance', 'Balance');
  if (deposit < 0) problems.push('Deposit can’t be negative');
  const unit = get('unit').slice(0, 40), property = get('property').slice(0, 120);
  if (name && existing.has((name + '|' + unit).toLowerCase())) problems.push('Already in your rent book');
  return { ok: !problems.length, problems, data: { name, unit, property, phone: get('phone').slice(0, 60), email: get('email').slice(0, 160), rent, start, end, deposit, balance } };
}
function checkAll(p, today) {
  const existing = new Set(S().tenantsList().filter(t => !t.sample).map(t => (t.name + '|' + (t.unit || '')).toLowerCase()));
  const seen = new Set();
  return p.rows.map(r => {
    const c = checkRow(r, existing, today);
    const key = (c.data.name + '|' + c.data.unit).toLowerCase();
    if (c.data.name && seen.has(key)) { c.problems.push('Same name and unit as a row above'); c.ok = false; }
    seen.add(key);
    return c;
  });
}
function tenantDoc(d, today) {
  const tf = D.monthStart(D.monthKey(today));
  const start = d.start || tf;
  const now = D.nowIso();
  return {
    name: d.name, phone: d.phone, email: d.email, coTenants: [], emergency: { name: '', phone: '' }, property: d.property, unit: d.unit, status: 'active',
    lease: { start, end: d.end || null, moveIn: start, noticeDate: null, moveOut: null, dueDay: null, graceDays: null },
    rent: [{ from: start, amount: d.rent }], recurring: [], trackFrom: D.max(tf, start),
    opening: d.balance ? { amount: d.balance } : null,
    deposit: { amount: d.deposit || 0, received: d.deposit ? start : null, heldAt: '', returned: null },
    insurance: null, links: [], about: '', log: {}, createdAt: now, updatedAt: now,
  };
}
const TEMPLATE = 'Name,Unit,Property,Phone,Email,Rent,Lease start,Lease end,Deposit,Balance owed\r\n' +
  'Maya Okafor,2B,Alder Court,(555) 014-2233,maya@example.com,1450,1/1/2026,12/31/2026,1450,0\r\n' +
  'Theo Lindqvist,102,418 Marlow Street,(555) 019-8870,,1520,2025-10-01,2027-09-30,1520,250\r\n' +
  'Lena Fischer,No. 4,Fenwick Row,,lena@example.com,1950,Mar 1 2025,,1950,\r\n';

async function doImport(el, today) {
  if (!canWrite()) return;
  const p = parsed(); if (!p) return;
  const checks = checkAll(p, today).filter(c => c.ok);
  if (!checks.length) return;
  const removeSample = S().hasSample() && imp.removeSample !== false;
  if (removeSample) {
    const ts = S().tenantsList().filter(t => t.sample).length;
    const ok = await ui.confirm({
      title: 'Import ' + RB.plural(checks.length, 'tenant') + ' and remove sample data?',
      body: h`<p class="muted">The <strong>${RB.plural(ts, 'sample tenant')}</strong>, their ledgers and sample upkeep requests are deleted first. Then <strong>${RB.plural(checks.length, 'tenant')}</strong> from your spreadsheet are added.</p>`,
      confirmLabel: 'Remove sample and import', danger: true,
    });
    if (!ok) return;
    try { await S().removeSample(); } catch (e) { return; }
  }
  const tenants = {};
  checks.forEach(c => { tenants[RB.id()] = tenantDoc(c.data, today); });
  const ids = Object.keys(tenants);
  try { await S().importAll({ tenants }); } catch (e) { ui.toast('Some tenants couldn’t be saved — check the Tenants list and try again.', { tone: 'bad' }); }
  imp.done = { count: ids.length, skipped: p.rows.length - ids.length, removed: removeSample };
  imp.text = ''; imp.fileName = ''; imp.map = null; imp.mapFor = null;
  ui.toast('Imported ' + RB.plural(ids.length, 'tenant'), { undo: () => { ids.forEach(id => S().deleteTenant(id).catch(() => {})); imp.done = null; } });
  RB.shell.refresh();
}

// ------------------------------------------------------------------ render pieces
const savedTag = key => h`<span class="st-saved${flash && flash.key === key && Date.now() < flash.until ? ' is-on' : ''}" id="st-saved-${key}" aria-live="polite">${ui.icon('check', { size: 12 })}Saved</span>`;
function row(key, label, hint, control) {
  return h`<div class="st-row${errs[key] ? ' is-invalid' : ''}" data-row="${key}">
    <div class="st-label"><label class="st-label-text" for="st-${key}">${label}</label>${hint ? h`<div class="st-hint">${hint}</div>` : ''}</div>
    <div class="st-ctl"><div class="st-ctl-line">${control}${savedTag(key)}</div><div class="field-error" aria-live="polite">${errs[key] || ''}</div></div>
  </div>`;
}
const val = (key, v) => (drafts[key] !== undefined ? drafts[key] : v);
function numInput(key, value, suffix, attrs) {
  return h`<span class="st-num"><input class="input input-num" type="text" id="st-${key}" data-key="${key}" data-change="save" data-input="draft" value="${val(key, value)}" autocomplete="off" data-write${ui.attrs(Object.assign({ inputmode: 'numeric' }, attrs))}><span class="st-suffix">${suffix}</span></span>`;
}

function importSection(today) {
  const p = imp.text.trim() ? parsed() : null;
  const checks = p ? checkAll(p, today) : [];
  const good = checks.filter(c => c.ok).length;
  const bad = checks.length - good;
  const mapped = imp.map || [];
  const missing = p ? ['name', 'rent'].filter(k => !mapped.includes(k)) : [];
  const fieldLabel = k => (FIELDS.find(f => f.key === k) || {}).label;
  return h`
    ${imp.done ? h`<div class="st-done" role="status">${ui.icon('check')}<div class="grow"><strong>Imported ${RB.plural(imp.done.count, 'tenant')}.</strong> ${imp.done.skipped ? RB.plural(imp.done.skipped, 'row') + ' with problems ' + (imp.done.skipped === 1 ? 'was' : 'were') + ' left out. ' : ''}Their ledgers start on ${D.fmt(D.monthStart(D.monthKey(today)), today)} with the balance you gave as the opening line.</div>
      <button type="button" class="btn btn-sm" data-act="goTenants">See tenants</button><button type="button" class="btn btn-sm btn-ghost btn-icon" data-act="doneClose" aria-label="Dismiss">${ui.icon('x')}</button></div>` : ''}
    <div class="st-import-grid">
      <div class="st-import-in">
        <label class="field-label" for="st-import-text">Paste rows from a spreadsheet</label>
        <textarea class="input textarea st-import-text" id="st-import-text" rows="7" data-input="impText" spellcheck="false" placeholder="Copy the rows in Excel, Numbers or Google Sheets — header row included — and paste here." data-write>${imp.text}</textarea>
        <div class="row row-wrap st-import-btns">
          <label class="btn btn-sm st-file" for="st-import-file" data-write>${ui.icon('upload')}<span>Choose a CSV file</span></label>
          <input type="file" id="st-import-file" class="vh" accept=".csv,.tsv,.txt,text/csv,text/plain" data-change="impFile">
          ${imp.fileName ? h`<span class="faint t-12 truncate">${imp.fileName}</span>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="template">${ui.icon('download')}<span>Download a template CSV</span></button>
          ${imp.text ? h`<button type="button" class="btn btn-sm btn-ghost" data-act="impClear">Clear</button>` : ''}
        </div>
        ${imp.fileErr ? h`<div class="field-error">${imp.fileErr}</div>` : ''}
      </div>
      <div class="st-import-eg">
        <div class="micro mb-2">Expected shape</div>
        <div class="st-eg" aria-label="Example spreadsheet">
          <table><thead><tr><th>Name</th><th>Unit</th><th>Rent</th><th>Lease end</th><th>Balance owed</th></tr></thead>
          <tbody><tr><td>Maya Okafor</td><td>2B</td><td>1450</td><td>12/31/2026</td><td>0</td></tr>
          <tr><td>Theo Lindqvist</td><td>102</td><td>1520</td><td>2027-09-30</td><td>250</td></tr></tbody></table>
        </div>
        <p class="st-hint mt-2">One row per tenant. Name and rent are needed; property, phone, email, lease start, deposit and balance are optional. Dates like 1/15/2026, 2026-01-15 or Jan 15 2026 all work. “Balance owed” is what they owed before ${D.monthName(D.monthKey(today))}’s rent.</p>
      </div>
    </div>
    <div id="st-import-preview">${p ? h`
      <div class="st-prev-head">
        <div><strong>${RB.plural(p.rows.length, 'row')}</strong> found${p.hasHeader ? '' : ' (no header row recognised — match the columns below)'} · <span class="tone-ok">${good} ready</span>${bad ? h` · <span class="tone-bad">${RB.plural(bad, 'row')} with problems will be skipped</span>` : ''}</div>
        ${missing.length ? h`<div class="tone-bad t-12">Choose which column holds the ${missing.map(fieldLabel).join(' and ').toLowerCase()}.</div>` : h`<div class="faint t-12">Columns were matched by their headings — change any that are wrong.</div>`}
      </div>
      <div class="st-prev-scroll"><table class="tbl tbl-compact st-prev" id="st-import-table">
        <thead><tr><th class="st-prev-n">#</th><th class="st-prev-checkh">Check</th>${p.header.map((hd, i) => h`<th><span class="st-src">${hd || 'Column ' + (i + 1)}</span>
          <span class="select st-map"><select class="input" id="st-map-${i}" data-change="map" data-i="${i}" aria-label="Import column ${hd || i + 1} as">${FIELDS.map(f => h`<option value="${f.key}"${mapped[i] === f.key ? RB.raw(' selected') : ''}>${f.label}</option>`)}</select></span></th>`)}</tr></thead>
        <tbody>${p.rows.slice(0, 200).map((r, ri) => h`<tr class="${checks[ri].ok ? '' : 'st-prev-bad'}"><td class="st-prev-n faint">${ri + 1}</td>
          <td class="st-prev-check">${checks[ri].ok ? h`<span class="tone-ok st-ready">${ui.icon('check', { size: 14 })}Ready</span>` : h`<span class="tone-bad st-problem">${checks[ri].problems.join(' · ')}</span>`}</td>
          ${r.map((c, i) => h`<td class="${mapped[i] ? '' : 'st-prev-skip'}"><span class="truncate st-cell">${c}</span></td>`)}</tr>`)}</tbody>
      </table></div>
      ${p.rows.length > 200 ? h`<p class="st-hint mt-2">Showing the first 200 rows; all ${p.rows.length} are checked.</p>` : ''}
      <div class="st-import-go">
        ${S().hasSample() ? h`<label class="check"><input type="checkbox" id="st-import-rmsample" data-change="impSample"${imp.removeSample !== false ? RB.raw(' checked') : ''}><span>Remove the sample tenants first</span></label>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" id="st-import-go" data-act="doImport" data-write${good && !missing.length ? '' : RB.raw(' disabled')}>Import ${RB.plural(good, 'tenant')}</button>
      </div>` : ''}</div>`;
}

function backupSection(today) {
  const r = restore;
  return h`
    <p class="st-p">A backup is one JSON file with every tenant, ledger entry, note, upkeep request and setting. Keep one somewhere safe now and then.</p>
    <div class="row row-wrap mt-4">
      <button type="button" class="btn" id="st-backup" data-cmd="backup:download">${ui.icon('download')}<span>Download backup</span></button>
      <label class="btn btn-ghost" for="st-restore-file" data-write>${ui.icon('upload')}<span>Restore from backup…</span></label>
      <input type="file" id="st-restore-file" class="vh" accept=".json,application/json" data-change="restoreFile">
    </div>
    ${r ? r.error ? h`<div class="st-restore is-bad" role="alert">${ui.icon('alert')}<div class="grow"><strong>${r.name}</strong> can’t be restored: ${r.error}</div><button type="button" class="btn btn-sm btn-ghost btn-icon" data-act="restoreClose" aria-label="Dismiss">${ui.icon('x')}</button></div>`
      : h`<div class="st-restore" id="st-restore-summary">
        <div class="grow"><div class="strong">${r.name}</div>
          <div class="muted t-13">Backup from ${r.summary.when} · ${RB.plural(r.summary.tenants, 'tenant')} · ${RB.plural(r.summary.entries, 'ledger entry', 'ledger entries')} · ${RB.plural(r.summary.tickets, 'upkeep request')}${r.summary.portfolio ? ' · “' + r.summary.portfolio + '”' : ''}</div>
          <div class="tone-bad t-12 mt-2">Restoring replaces everything in this rent book.</div></div>
        <button type="button" class="btn btn-danger-soft" id="st-restore-go" data-act="restoreGo" data-write>Replace with this backup…</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="restoreClose" aria-label="Cancel">${ui.icon('x')}</button>
      </div>` : ''}`;
}

function summarize(data) {
  if (!data || data.format !== 'rent-book-backup' || !RB.isObj(data.tenants)) return null;
  const ledgers = RB.isObj(data.ledgers) ? data.ledgers : {};
  const entries = Object.keys(ledgers).reduce((n, k) => n + Object.keys((ledgers[k] && ledgers[k].entries) || {}).length, 0);
  const at = String(data.exportedAt || '').slice(0, 10);
  return { tenants: Object.keys(data.tenants).length, entries, tickets: RB.isObj(data.tickets) ? Object.keys(data.tickets).length : 0,
    when: D.valid(at) ? D.fmtLong(at) : 'an unknown date', portfolio: data.settings && typeof data.settings.portfolioName === 'string' ? data.settings.portfolioName.slice(0, 80) : '' };
}
function readFile(input, cb) {
  const f = input.files && input.files[0]; if (!f) return;
  if (f.size > 15 * 1024 * 1024) { cb(null, f.name, 'The file is larger than 15 MB.'); input.value = ''; return; }
  const fr = new FileReader();
  fr.onload = () => { cb(String(fr.result || ''), f.name); input.value = ''; };
  fr.onerror = () => { cb(null, f.name, 'The file couldn’t be read.'); input.value = ''; };
  fr.readAsText(f);
}

// ------------------------------------------------------------------ view
const SECTIONS = [['rules', 'Rent rules'], ['leases', 'Deposits & leases'], ['methods', 'Payment methods'], ['import', 'Import tenants'], ['backup', 'Backup'], ['sample', 'Sample data'], ['about', 'Sharing & shortcuts']];
let previewPatch = null;

RB.views.register('setup', {
  title: 'Setup',
  firstRun: false,
  render(el, ctx) {
    const s = ctx.state.settings;
    const today = ctx.today;
    const hasSample = ctx.store.hasSample();
    const lf = s.lateFee;
    const sec = (id, title, body, meta) => h`<section class="st-sec" id="st-sec-${id}" aria-labelledby="st-h-${id}"><div class="st-sec-head"><h2 class="st-sec-title" id="st-h-${id}">${title}</h2>${meta || ''}</div>${body}</section>`;
    el.innerHTML = String(h`
      <div class="st-layout">
        <nav class="st-toc hide-phone" aria-label="Setup sections">${[['portfolio', 'Portfolio']].concat(SECTIONS).map(([id, t]) => h`<a href="#setup" data-act="toc" data-id="${id}">${t}</a>`)}</nav>
        <div class="st-main">
          ${sec('portfolio', 'Portfolio', row('portfolioName', 'Portfolio name', 'Shown in the sidebar and on receipts and statements.',
            h`<input class="input st-wide" type="text" id="st-portfolioName" data-key="portfolioName" data-change="save" data-input="draft" value="${val('portfolioName', s.portfolioName)}" placeholder="e.g. Calder & Vane Rentals" maxlength="80" autocomplete="off" data-write>`))}
          ${sec('rules', 'Rent rules', h`
            ${row('dueDay', 'Rent is due on', 'Day of the month. Individual leases can override it.', h`<span class="select st-sel"><select class="input" id="st-dueDay" data-key="dueDay" data-change="save" data-write>${Array.from({ length: 28 }, (_, i) => h`<option value="${i + 1}"${+val('dueDay', s.dueDay) === i + 1 ? RB.raw(' selected') : ''}>the ${ord(i + 1)}</option>`)}</select></span>`)}
            ${row('graceDays', 'Grace period', 'Rent paid within this many days of the due date isn’t late.', numInput('graceDays', s.graceDays, 'days', { maxlength: 2 }))}
            <div class="st-row" data-row="lateFee">
              <div class="st-label"><span class="st-label-text" id="st-latefee-label">Late fee</span><div class="st-hint">Suggested on Today and Rent once rent is late. Nothing is charged until you click it.</div></div>
              <div class="st-ctl">
                <div class="st-ctl-line"><div class="seg" role="radiogroup" aria-labelledby="st-latefee-label">${[['none', 'None'], ['flat', 'Flat amount'], ['percent', 'Percent of rent']].map(([v, l]) => h`<button type="button" role="radio" id="st-lf-${v}" data-act="lfType" data-v="${v}" aria-checked="${String(lf.type === v)}" aria-pressed="${String(lf.type === v)}" data-write>${l}</button>`)}</div>${savedTag('lateFeeType')}</div>
                ${lf.type !== 'none' ? h`<div class="st-ctl-line mt-2" data-row="lateFeeAmount">
                  ${lf.type === 'flat'
                    ? h`<span class="money-input st-money"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" id="st-lateFeeAmount" data-key="lateFeeAmount" data-change="save" data-input="draft" value="${val('lateFeeAmount', M.input(lf.amount))}" aria-label="Late fee amount" autocomplete="off" data-write></span>`
                    : numInput('lateFeeAmount', lf.amount, '% of the month’s rent', { inputmode: 'decimal', 'aria-label': 'Late fee percent' })}
                  ${savedTag('lateFeeAmount')}</div><div class="field-error" aria-live="polite">${errs.lateFeeAmount || ''}</div>` : ''}
              </div>
            </div>
            <p class="st-sentence" id="st-rule-sentence">${ruleSentence(previewSettings())}</p>`)}
          ${sec('leases', 'Deposits & leases', h`
            ${row('depositReturnDays', 'Return deposits within', 'Counted from the move-out date. Today warns you as the deadline nears.', numInput('depositReturnDays', s.depositReturnDays, 'days after move-out', { maxlength: 3 }))}
            ${row('leaseNoticeDays', 'Lease notice window', 'Leases ending within this window ask for a decision — renew, month-to-month or notice.', numInput('leaseNoticeDays', s.leaseNoticeDays, 'days before the end', { maxlength: 3 }))}`)}
          ${sec('methods', 'Payment methods', h`
            <p class="st-p">Offered when you record a payment. Removing one doesn’t change payments already recorded with it.</p>
            <div class="st-methods" id="st-methods">${s.methods.map((m, i) => h`<span class="st-method">${m}<button type="button" class="st-method-x" data-act="rmMethod" data-i="${i}" aria-label="Remove ${m}" data-write${s.methods.length <= 1 ? RB.raw(' disabled') : ''}>${ui.icon('x', { size: 12 })}</button></span>`)}
              <form class="st-method-add" data-submit="addMethod"><input class="input" type="text" id="st-method-new" data-input="methodDraft" value="${methodDraft}" placeholder="Add a method…" maxlength="30" autocomplete="off" aria-label="New payment method" data-write><button type="submit" class="btn btn-sm" data-write>Add</button></form>
            </div>${savedTag('methods')}`)}
          ${sec('import', 'Import tenants', importSection(today))}
          ${sec('backup', 'Backup', backupSection(today))}
          ${sec('sample', 'Sample data', h`
            <p class="st-p">${hasSample ? 'Sample tenants are loaded. Remove them before you add your own, or keep exploring.' : 'Load 27 invented tenants across three buildings to see how everything works. Your own tenants are kept.'}</p>
            <div class="row row-wrap mt-4">
              <button type="button" class="btn${hasSample ? '' : ' btn-soft'}" id="setup-load-sample" data-cmd="sample:load" data-write${hasSample ? RB.raw(' disabled') : ''}>${ui.icon('sample')}<span>Load sample data</span></button>
              <button type="button" class="btn btn-danger-soft" id="setup-remove-sample" data-cmd="sample:remove" data-write${hasSample ? '' : RB.raw(' disabled')}>${ui.icon('trash')}<span>Remove sample data…</span></button>
            </div>`)}
          ${sec('about', 'Sharing & shortcuts', h`
            <p class="st-p">Your rent book is saved with this page. Anyone you share the page with as an editor sees every tenant, phone number and payment in it and can change them; nobody else can. ${ctx.state.mode === 'local' ? 'Right now it isn’t syncing, so changes are saved on this device only.' : ''}</p>
            <div class="row row-wrap mt-4"><button type="button" class="btn btn-ghost" id="st-keys" data-cmd="help:keys">${ui.icon('keyboard')}<span>Keyboard shortcuts</span> ${ui.kbd('?')}</button>
              <span class="faint t-12">${ui.kbd('/')} search · ${ui.kbd('n')} add · ${ui.kbd('g')} ${ui.kbd('r')} go to Rent</span></div>`)}
        </div>
      </div>`);

    const patchPreview = () => { const x = el.querySelector('#st-rule-sentence'); if (x) x.textContent = ruleSentence(previewSettings()); };
    previewPatch = previewPatch || RB.debounce(() => {
      const box = el.querySelector('#st-import-preview'); if (!box) return;
      // replace only the preview region so the textarea keeps focus and caret
      const tmp = document.createElement('div'); tmp.innerHTML = String(importSection(S().today()));
      const np = tmp.querySelector('#st-import-preview'); if (np) box.replaceWith(np);
    }, 200);
    ui.bind(el, {
      toc: (a, e) => { e.preventDefault(); const t = el.querySelector('#st-sec-' + a.dataset.id); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
      draft: i => { drafts[i.dataset.key] = i.value; if (errs[i.dataset.key]) setErr(el, i.dataset.key, null); patchPreview(); },
      save: i => saveSetting(el, i.dataset.key, i.value),
      lfType: b => {
        if (!canWrite()) return;
        const v = b.dataset.v; const cur = S().settings().lateFee;
        if (cur.type === v) return;
        const amount = v === 'none' ? cur.amount : v === cur.type ? cur.amount : v === 'flat' ? 5000 : 5;
        delete drafts.lateFeeAmount; delete errs.lateFeeAmount;
        flash = { key: 'lateFeeType', until: Date.now() + 2200 };
        S().saveSettings({ lateFee: { type: v, amount } }).catch(() => {});
        setTimeout(() => { if (flash && flash.key === 'lateFeeType') { flash = null; const x = document.getElementById('st-saved-lateFeeType'); if (x) x.classList.remove('is-on'); } }, 2200);
      },
      methodDraft: i => { methodDraft = i.value; },
      addMethod: () => {
        if (!canWrite()) return;
        const m = methodDraft.trim().slice(0, 30); const list = S().settings().methods;
        if (!m) return;
        if (list.some(x => x.toLowerCase() === m.toLowerCase())) { ui.toast(m + ' is already in the list'); return; }
        methodDraft = '';
        S().saveSettings({ methods: list.concat([m]) }).catch(() => {});
        flash = { key: 'methods', until: Date.now() + 2200 };
        setTimeout(() => { const x = document.getElementById('st-saved-methods'); if (x) x.classList.remove('is-on'); }, 2200);
      },
      rmMethod: b => {
        if (!canWrite()) return;
        const list = S().settings().methods.slice(); const i = +b.dataset.i; const m = list[i];
        if (list.length <= 1 || m === undefined) return;
        const before = list.slice(); list.splice(i, 1);
        S().saveSettings({ methods: list }).catch(() => {});
        ui.toast('Removed ' + m + ' from payment methods', { undo: () => S().saveSettings({ methods: before }) });
      },
      impText: t => { imp.text = t.value; imp.done = null; previewPatch(); },
      impFile: inp => readFile(inp, (text, name, err) => {
        if (err || text == null) { imp.fileErr = (name ? name + ': ' : '') + (err || 'couldn’t be read'); RB.shell.refresh(); return; }
        imp.text = text; imp.fileName = name; imp.fileErr = ''; imp.done = null; imp.map = null; imp.mapFor = null; RB.shell.refresh();
      }),
      impClear: () => { imp.text = ''; imp.fileName = ''; imp.map = null; imp.mapFor = null; imp.fileErr = ''; RB.shell.refresh(); },
      impSample: c => { imp.removeSample = c.checked; },
      map: sel => {
        const i = +sel.dataset.i; const k = sel.value;
        if (k) imp.map = imp.map.map((x, j) => (j !== i && x === k ? '' : x)); // each field maps from one column
        imp.map[i] = k; RB.shell.refresh();
      },
      template: () => RB.actions.downloadFile('rent-book-import-template.csv', TEMPLATE, 'text/csv'),
      doImport: () => doImport(el, today),
      goTenants: () => RB.shell.go('tenants'),
      doneClose: () => { imp.done = null; RB.shell.refresh(); },
      restoreFile: inp => readFile(inp, (text, name, err) => {
        if (err || text == null) { restore = { error: err || 'it couldn’t be read.', name }; RB.shell.refresh(); return; }
        let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }
        const summary = summarize(data);
        restore = summary ? { data, name, summary } : { error: data ? 'it isn’t a Rent Book backup.' : 'it isn’t valid JSON.', name };
        RB.shell.refresh();
      }),
      restoreGo: async () => { if (!restore || !restore.data) return; const ok = await RB.actions.restore(restore.data); if (ok) { restore = null; RB.shell.refresh(); } },
      restoreClose: () => { restore = null; RB.shell.refresh(); },
    });
    if (ctx.intent === 'import') {
      requestAnimationFrame(() => { const t = el.querySelector('#st-sec-import'); if (t) t.scrollIntoView({ block: 'start' }); const ta = el.querySelector('#st-import-text'); if (ta) ta.focus({ preventScroll: true }); });
    }
  },
  destroy() { if (previewPatch) previewPatch.cancel(); previewPatch = null; },
});

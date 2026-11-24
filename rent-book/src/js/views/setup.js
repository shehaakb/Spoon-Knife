// views/setup.js — Settings (#setup): text size, rent rules as plain sentences that save on change, ways tenants
// pay, "Bring in my tenants" (a guided 3-step flow), Save a copy / Restore from a copy, example tenants, who can
// see this, and keyboard shortcuts at the bottom. Plain-language rules: docs/SPEC.md §8.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;

// ------------------------------------------------------------------ view state (survives store re-renders)
const drafts = {};          // key -> raw text the user typed but that isn't saved yet
const errs = {};            // key -> message
let flash = null;           // {key, until}
let methodDraft = '';
const imp = { step: 1, text: '', fileName: '', map: null, mapFor: null, removeSample: null, done: null, fileErr: '' };
let restore = null;         // {data, name, summary} | {error, name}

// ------------------------------------------------------------------ helpers
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function canWrite() { if (!S().canWrite()) { ui.toast('This rent book is view only — you can look, but not change anything.', { tone: 'bad' }); return false; } return true; }

/** The rules in one plain paragraph. */
function ruleSentence(s) {
  const due = +s.dueDay || 1, g = +s.graceDays || 0, last = due + g;
  const first = 'Rent is due on the ' + ord(due) + '. ' + (g ? (last <= 28 ? 'It counts as late after the ' + ord(last) + '.' : 'It counts as late ' + RB.plural(g, 'day') + ' after that.') : 'It counts as late the day after.');
  const lf = s.lateFee || {};
  if (lf.type === 'none' || !(+lf.amount > 0)) return first + ' No late fee is suggested.';
  if (lf.type === 'flat') return first + ' Then a ' + M.fmt(+lf.amount) + ' late fee is suggested — nothing is charged until you press the button.';
  const rents = S().tenantsList({ includePast: false }).map(t => RB.model.rentOn(t, S().today())).filter(Boolean).sort((a, b) => a - b);
  const ex = rents.length ? rents[Math.floor(rents.length / 2)] : 145000;
  return first + ' Then a late fee of ' + (+lf.amount) + '% of that month’s rent is suggested (' + M.fmt(Math.round(ex * lf.amount / 100)) + ' on ' + M.fmt(ex) + ') — nothing is charged until you press the button.';
}

function showFlash(el, key) {
  flash = { key, until: Date.now() + 3000 };
  const f = el && el.querySelector('#st-saved-' + key);
  if (f) f.classList.add('is-on');
  setTimeout(() => {
    if (flash && flash.key === key && Date.now() >= flash.until - 5) flash = null;
    const x = document.getElementById('st-saved-' + key); if (x) x.classList.remove('is-on');
  }, 3000);
}
function setErr(el, key, msg) {
  if (msg) errs[key] = msg; else delete errs[key];
  const row = el && el.querySelector('[data-row="' + key + '"]');
  if (row) { row.classList.toggle('is-invalid', !!msg); const e = row.querySelector('.field-error'); if (e) e.textContent = msg || ''; }
}

/** Parse + validate a settings field; returns {patch} or {error}. */
function parseSetting(key, raw, s) {
  const v = String(raw == null ? '' : raw).trim();
  const int = (lo, hi) => { if (!/^\d+$/.test(v)) return { error: 'Write a whole number, like ' + lo + (hi > 10 ? ' or ' + Math.min(hi, 30) : '') }; const n = +v; if (n < lo || n > hi) return { error: 'Use a number from ' + lo + ' to ' + hi }; return { n }; };
  switch (key) {
    case 'portfolioName': return { patch: { portfolioName: v.slice(0, 80) } };
    case 'dueDay': { const r = int(1, 28); return r.error ? r : { patch: { dueDay: r.n } }; }
    case 'graceDays': { const r = int(0, 27); return r.error ? r : { patch: { graceDays: r.n } }; }
    case 'depositReturnDays': { const r = int(0, 120); return r.error ? r : { patch: { depositReturnDays: r.n } }; }
    case 'leaseNoticeDays': { const r = int(7, 365); return r.error ? r : { patch: { leaseNoticeDays: r.n } }; }
    case 'lateFeeAmount': {
      if (s.lateFee.type === 'flat') { const c = M.parse(v); if (c === null || c <= 0) return { error: 'Write an amount, like 50' }; return { patch: { lateFee: { type: 'flat', amount: c } } }; }
      const p = Number(v.replace('%', '')); if (!v || !isFinite(p) || p <= 0 || p > 50) return { error: 'Write a percent from 1 to 50' };
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

// ------------------------------------------------------------------ bring in my tenants
const FIELDS = [
  { key: '', label: 'Leave it out' },
  { key: 'name', label: 'Name', re: /(^|\b)(name|tenant|resident|lessee|occupant)/ },
  { key: 'unit', label: 'Unit', re: /(^|\b)(unit|apt|apartment|suite|door|house|no\.?$|#)/ },
  { key: 'property', label: 'Property', re: /(property|building|address|street|complex|bldg)/ },
  { key: 'phone', label: 'Phone', re: /(phone|mobile|cell|tel)/ },
  { key: 'email', label: 'Email', re: /e-?mail/ },
  { key: 'rent', label: 'Rent each month', re: /rent|monthly/ },
  { key: 'start', label: 'Lease started', re: /(start|move.?in|begin|commence|from)/ },
  { key: 'end', label: 'Lease ends', re: /(end|expir|until|through|term.?date)/ },
  { key: 'deposit', label: 'Deposit', re: /deposit/ },
  { key: 'balance', label: 'What they already owe', re: /(balance|owed?\b|owing|arrears|past.?due|outstanding)/ },
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
/** Parse the pasted text into {header, rows, hasHeader, width}. */
function parsed() {
  const all = RB.model.parseDelimited(imp.text).filter(r => r.some(c => String(c).trim())).slice(0, 1001);
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
const FIX_DATE = ' Write it like 1/15/2026 or Jan 15 2026.';
/** Validate one row under the current mapping → {ok, problems (plain sentences), data}. */
function checkRow(row, existing, today) {
  const get = k => { const i = imp.map.indexOf(k); return i >= 0 ? String(row[i] || '').trim() : ''; };
  const problems = [];
  const name = get('name').slice(0, 120);
  if (!name) problems.push('There is no name.');
  const rentRaw = get('rent');
  const rent = rentRaw ? M.parse(rentRaw) : null;
  if (!rentRaw) problems.push('There is no rent.'); else if (rent === null || rent <= 0) problems.push('The rent “' + rentRaw.slice(0, 20) + '” is not an amount of money. Write it like 1450.');
  const date = (k, label) => { const v = get(k); if (!v) return null; const d = D.parseLoose(v, today); if (!d) problems.push(label + ' “' + v.slice(0, 20) + '” is not a date we understand.' + FIX_DATE); return d; };
  const start = date('start', 'The lease start'), end = date('end', 'The lease end');
  if (start && end && end <= start) problems.push('The lease ends before it starts.');
  const money = (k, label) => { const v = get(k); if (!v) return 0; const c = M.parse(v); if (c === null) { problems.push(label + ' “' + v.slice(0, 20) + '” is not an amount of money.'); return 0; } return c; };
  const deposit = money('deposit', 'The deposit'), balance = money('balance', 'What they already owe');
  if (deposit < 0) problems.push('The deposit can’t be less than zero.');
  const unit = get('unit').slice(0, 40), property = get('property').slice(0, 120);
  if (name && existing.has((name + '|' + unit).toLowerCase())) problems.push('They are already in your rent book.');
  return { ok: !problems.length, problems, data: { name, unit, property, phone: get('phone').slice(0, 60), email: get('email').slice(0, 160), rent, start, end, deposit, balance } };
}
function checkAll(p, today) {
  const existing = new Set(S().tenantsList().filter(t => !t.sample).map(t => (t.name + '|' + (t.unit || '')).toLowerCase()));
  const seen = new Map();
  return p.rows.map((r, i) => {
    const c = checkRow(r, existing, today);
    const key = (c.data.name + '|' + c.data.unit).toLowerCase();
    if (c.data.name && seen.has(key)) { c.problems.push('Same name and unit as row ' + (seen.get(key) + 1) + '.'); c.ok = false; }
    else seen.set(key, i);
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
const TEMPLATE = 'Name,Unit,Property,Phone,Email,Rent each month,Lease started,Lease ends,Deposit,What they already owe\r\n' +
  'Maya Okafor,2B,Alder Court,(555) 014-2233,maya@example.com,1450,1/1/2026,12/31/2026,1450,0\r\n' +
  'Theo Lindqvist,102,418 Marlow Street,(555) 019-8870,,1520,2025-10-01,2027-09-30,1520,250\r\n' +
  'Lena Fischer,No. 4,Fenwick Row,,lena@example.com,1950,Mar 1 2025,,1950,\r\n';

async function doImport(today) {
  if (!canWrite()) return;
  const p = parsed(); if (!p) return;
  const checks = checkAll(p, today).filter(c => c.ok);
  if (!checks.length) return;
  const removeSample = S().hasSample() && imp.removeSample !== false;
  if (removeSample) {
    const ts = S().tenantsList().filter(t => t.sample).length;
    const ok = await ui.confirm({
      title: 'Remove the example tenants and bring in yours?',
      body: h`<p>The <strong>${RB.plural(ts, 'example tenant')}</strong>, their payment history and the example repairs are deleted first. Then your <strong>${RB.plural(checks.length, 'tenant')}</strong> are added.</p>`,
      confirmLabel: 'Remove the examples and bring in mine', cancelLabel: 'Keep it as it is', danger: true,
    });
    if (!ok) return;
    try { await S().removeSample(); } catch (e) { return; }
  }
  const tenants = {};
  checks.forEach(c => { tenants[RB.id()] = tenantDoc(c.data, today); });
  const ids = Object.keys(tenants);
  try { await S().importAll({ tenants }); } catch (e) { ui.toast('Some tenants couldn’t be saved. Look at the Tenants list and try again.', { tone: 'bad' }); }
  imp.done = { count: ids.length, skipped: p.rows.length - ids.length, removed: removeSample };
  imp.text = ''; imp.fileName = ''; imp.map = null; imp.mapFor = null; imp.step = 1;
  ui.toast('Brought in ' + RB.plural(ids.length, 'tenant') + '.', { duration: 10000, undo: () => { ids.forEach(id => S().deleteTenant(id).catch(() => {})); imp.done = null; } });
  RB.shell.refresh();
}

// ------------------------------------------------------------------ render pieces
const savedTag = key => h`<span class="st-saved${flash && flash.key === key && Date.now() < flash.until ? ' is-on' : ''}" id="st-saved-${key}" aria-live="polite">${ui.icon('check')}Saved</span>`;
const val = (key, v) => (drafts[key] !== undefined ? drafts[key] : v);
function numInput(key, value, label, attrs) {
  return h`<input class="input st-num" type="text" id="st-${key}" data-key="${key}" data-change="save" data-input="draft" value="${val(key, value)}" autocomplete="off" aria-label="${label}" data-write${ui.attrs(Object.assign({ inputmode: 'numeric' }, attrs))}>`;
}
/** A sentence with a control in it, its "Saved" note and its error line. */
function sentence(key, parts, hint) {
  return h`<div class="st-sentence-row${errs[key] ? ' is-invalid' : ''}" data-row="${key}">
    <p class="st-sentence-text">${parts}${savedTag(key)}</p>
    ${hint ? h`<p class="st-hint">${hint}</p>` : ''}
    <div class="field-error" aria-live="polite">${errs[key] || ''}</div>
  </div>`;
}

function importStep1() {
  const p = imp.text.trim() ? parsed() : null;
  return h`<ol class="st-steps" aria-label="Steps"><li aria-current="step">1. Paste your list</li><li>2. Check the columns</li><li>3. Look it over</li></ol>
    <h3 class="st-step-title">Step 1 of 3: Paste your list or choose a file</h3>
    <p class="st-p">Open your list in Excel, Numbers or Google Sheets. Select it all — with the headings — copy it, and paste it in the box below. One row for each tenant, like this:</p>
    <figure class="st-eg"><table aria-label="An example list"><thead><tr><th>Name</th><th>Unit</th><th>Rent each month</th><th>Lease ends</th></tr></thead>
      <tbody><tr><td>Maya Okafor</td><td>2B</td><td>1450</td><td>12/31/2026</td></tr><tr><td>Theo Lindqvist</td><td>102</td><td>1520</td><td>9/30/2027</td></tr></tbody></table>
      <figcaption class="st-hint">Only the name and the rent are needed. The property, phone, email, lease dates, deposit and what they already owe can come too.</figcaption></figure>
    <label class="field-label" for="st-import-text">Paste your list here</label>
    <textarea class="input textarea st-import-text" id="st-import-text" rows="6" data-input="impText" spellcheck="false" placeholder="Click here, then paste (Ctrl+V, or ⌘V on a Mac)" data-write>${imp.text}</textarea>
    <div class="st-btnrow">
      <label class="btn st-file" for="st-import-file" data-write>${ui.icon('upload')}<span>Or choose a file</span></label>
      <input type="file" id="st-import-file" class="vh" accept=".csv,.tsv,.txt,text/csv,text/plain" data-change="impFile">
      <button type="button" class="btn btn-ghost" data-act="template">${ui.icon('download')}<span>Download an example for Excel</span></button>
      ${imp.text ? h`<button type="button" class="btn btn-ghost" data-act="impClear">Start again</button>` : ''}
    </div>
    ${imp.fileName ? h`<p class="st-hint">From the file: ${imp.fileName}</p>` : ''}
    ${imp.fileErr ? h`<div class="field-error">${imp.fileErr}</div>` : ''}
    <div class="st-btnrow st-next">
      <span class="st-imp-count" id="st-imp-count">${p ? (p.rows.length === 1 ? 'We found 1 tenant row.' : 'We found ' + p.rows.length + ' tenant rows.') : ''}</span>
      <button type="button" class="btn btn-primary btn-lg" id="st-imp-next1" data-act="impStep" data-s="2"${p && p.rows.length ? '' : RB.raw(' disabled')}>Next: check the columns</button>
    </div>`;
}
function importStep2(p) {
  const mapped = imp.map || [];
  const missing = ['name', 'rent'].filter(k => !mapped.includes(k));
  const label = k => (FIELDS.find(f => f.key === k) || {}).label;
  return h`<h3 class="st-step-title">Step 2 of 3: Check we understood your columns</h3>
    <p class="st-p">${p.hasHeader ? 'We matched your columns by their headings. If one is wrong, change it.' : 'We couldn’t find headings, so tell us what each column holds.'}</p>
    <div class="st-cols">${p.header.map((hd, i) => {
      const eg = p.rows.slice(0, 2).map(r => r[i]).filter(Boolean);
      return h`<div class="st-col${mapped[i] ? '' : ' is-skip'}">
        <div class="st-col-name">Your column “${hd || 'Column ' + (i + 1)}”</div>
        ${eg.length ? h`<div class="st-hint">For example: ${eg.join(', ')}</div>` : ''}
        <label class="st-col-q" for="st-map-${i}">This column is:</label>
        <span class="select"><select class="input" id="st-map-${i}" data-change="map" data-i="${i}">${FIELDS.map(f => h`<option value="${f.key}"${mapped[i] === f.key ? RB.raw(' selected') : ''}>${f.label}</option>`)}</select></span>
      </div>`;
    })}</div>
    ${missing.length ? h`<p class="st-warn" role="alert">Tell us which column holds the ${missing.map(label).join(' and the ').toLowerCase()} — they are needed.</p>` : ''}
    <div class="st-btnrow st-next">
      <button type="button" class="btn btn-lg" data-act="impStep" data-s="1">Back</button>
      <button type="button" class="btn btn-primary btn-lg" id="st-imp-next2" data-act="impStep" data-s="3"${missing.length ? RB.raw(' disabled') : ''}>Next: look it over</button>
    </div>`;
}
function importStep3(p, today) {
  const checks = checkAll(p, today);
  const good = checks.filter(c => c.ok).length;
  const bad = checks.length - good;
  const rowName = (c, i) => (c.data.name || 'Row ' + (i + 1)) + (c.data.unit ? ', ' + c.data.unit : '');
  return h`<h3 class="st-step-title">Step 3 of 3: Look it over</h3>
    <p class="st-p"><strong>${good === 1 ? '1 tenant is' : good + ' tenants are'} ready to bring in.</strong>${bad ? h` <span class="tone-bad">${bad === 1 ? '1 row has a problem' : bad + ' rows have problems'} and will be left out.</span>` : ''}</p>
    ${bad ? h`<div class="st-problems"><p class="st-p">To fix a problem, change it in your spreadsheet and paste the list again — or carry on, and only that row is left out.</p>
      <ul>${checks.map((c, i) => c.ok ? '' : h`<li><strong>Row ${i + 1} (${rowName(c, i)}):</strong> ${c.problems.join(' ')}</li>`)}</ul></div>` : ''}
    <ul class="st-preview" id="st-import-table">${checks.slice(0, 200).map((c, i) => h`<li class="${c.ok ? '' : 'is-bad'}">
      <span class="st-preview-n">Row ${i + 1}</span>
      <span class="st-preview-main"><strong>${c.data.name || 'No name'}</strong>${c.data.unit || c.data.property ? h` — ${[c.data.unit, c.data.property].filter(Boolean).join(', ')}` : ''}${c.data.rent ? h` — ${M.fmt(c.data.rent)} a month` : ''}</span>
      <span class="st-preview-st">${c.ok ? h`<span class="tone-ok">${ui.icon('check')}Ready</span>` : h`<span class="tone-bad">${c.problems.join(' ')}</span>`}</span></li>`)}</ul>
    ${p.rows.length > 200 ? h`<p class="st-hint">Showing the first 200 rows. All ${p.rows.length} were checked.</p>` : ''}
    ${S().hasSample() ? h`<label class="check st-rmsample"><input type="checkbox" id="st-import-rmsample" data-change="impSample"${imp.removeSample !== false ? RB.raw(' checked') : ''}><span>Remove the example tenants first</span></label>` : ''}
    <div class="st-btnrow st-next">
      <button type="button" class="btn btn-lg" data-act="impStep" data-s="2">Back</button>
      <button type="button" class="btn btn-primary btn-lg" id="st-import-go" data-act="doImport" data-write${good ? '' : RB.raw(' disabled')}>Bring in ${RB.plural(good, 'tenant')}</button>
    </div>`;
}
function importSection(today) {
  const p = imp.text.trim() ? parsed() : null;
  let step = imp.step;
  if (step > 1 && !p) step = imp.step = 1;
  if (step === 3 && ['name', 'rent'].some(k => !(imp.map || []).includes(k))) step = imp.step = 2;
  return h`
    ${imp.done ? h`<div class="st-done" role="status">${ui.icon('check')}<div class="grow"><strong>Brought in ${RB.plural(imp.done.count, 'tenant')}.</strong> ${imp.done.skipped ? (imp.done.skipped === 1 ? '1 row with a problem was left out. ' : imp.done.skipped + ' rows with problems were left out. ') : ''}Their rent is counted from ${D.fmt(D.monthStart(D.monthKey(today)), today)}, starting with what they already owed.</div>
      <button type="button" class="btn" data-act="goTenants">See your tenants</button><button type="button" class="btn btn-ghost" data-act="doneClose">Close</button></div>` : ''}
    <div class="st-import" id="st-import">${step === 1 ? importStep1() : step === 2 ? importStep2(p) : importStep3(p, today)}</div>`;
}

function backupSection() {
  const r = restore;
  return h`
    <p class="st-p">A copy is one file with all your tenants, payments, notes, repairs and settings. Save one now and then, and keep it somewhere safe — in your email, or on a USB stick.</p>
    <div class="st-btnrow">
      <button type="button" class="btn btn-lg" id="st-backup" data-cmd="backup:download">${ui.icon('download')}<span>Save a copy</span></button>
      <label class="btn btn-lg" for="st-restore-file" data-write>${ui.icon('upload')}<span>Restore from a copy</span></label>
      <input type="file" id="st-restore-file" class="vh" accept=".json,application/json" data-change="restoreFile">
    </div>
    <p class="st-hint">Restoring replaces everything in this rent book with what is in the copy. You will be asked before anything changes.</p>
    ${r ? r.error ? h`<div class="st-restore is-bad" role="alert">${ui.icon('alert')}<div class="grow"><strong>${r.name}</strong> can’t be used: ${r.error}</div><button type="button" class="btn" data-act="restoreClose">Close</button></div>`
      : h`<div class="st-restore" id="st-restore-summary">
        <div class="grow"><div class="strong">${r.name}</div>
          <p class="st-p">This copy was saved on ${r.summary.when}. It has ${RB.plural(r.summary.tenants, 'tenant')}, ${RB.plural(r.summary.entries, 'payment or charge', 'payments and charges')} and ${RB.plural(r.summary.tickets, 'repair')}${r.summary.portfolio ? ' (“' + r.summary.portfolio + '”)' : ''}.</p>
          <p class="st-p tone-bad">If you restore it, everything in this rent book now is replaced.</p></div>
        <div class="st-btnrow"><button type="button" class="btn btn-danger" id="st-restore-go" data-act="restoreGo" data-write>Replace everything with this copy</button>
        <button type="button" class="btn btn-lg" data-act="restoreClose">Keep what I have</button></div>
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
  if (f.size > 15 * 1024 * 1024) { cb(null, f.name, 'the file is bigger than 15 MB.'); input.value = ''; return; }
  const fr = new FileReader();
  fr.onload = () => { cb(String(fr.result || ''), f.name); input.value = ''; };
  fr.onerror = () => { cb(null, f.name, 'the file couldn’t be opened.'); input.value = ''; };
  fr.readAsText(f);
}

// ------------------------------------------------------------------ view
RB.views.register('setup', {
  title: 'Settings',
  firstRun: false,
  render(el, ctx) {
    const s = ctx.state.settings;
    const today = ctx.today;
    const hasSample = ctx.store.hasSample();
    const lf = s.lateFee;
    const sec = (id, title, body) => h`<section class="st-sec" id="st-sec-${id}" aria-labelledby="st-h-${id}"><h2 class="st-sec-title" id="st-h-${id}">${title}</h2>${body}</section>`;
    const lfChoice = (v, label) => h`<button type="button" role="radio" id="st-lf-${v}" data-act="lfType" data-v="${v}" aria-checked="${String(lf.type === v)}" aria-pressed="${String(lf.type === v)}" data-write>${label}</button>`;
    el.innerHTML = String(h`
      <div class="st-main">
        ${sec('text', 'Text size', h`${typeof ui.textSizeControl === 'function' ? ui.textSizeControl({ id: 'st-ts' }) : ''}<p class="st-hint">Makes all the words and buttons bigger on this device.</p>`)}
        ${sec('rules', 'Your rent rules', h`
          ${sentence('dueDay', h`Rent is due on the <span class="select st-inline-sel"><select class="input" id="st-dueDay" data-key="dueDay" data-change="save" aria-label="Day rent is due" data-write>${Array.from({ length: 28 }, (_, i) => h`<option value="${i + 1}"${+val('dueDay', s.dueDay) === i + 1 ? RB.raw(' selected') : ''}>${ord(i + 1)}</option>`)}</select></span> of the month.`)}
          ${sentence('graceDays', h`Give tenants ${numInput('graceDays', s.graceDays, 'Days before rent counts as late', { maxlength: 2 })} days before it counts as late.`)}
          <div class="st-sentence-row" data-row="lateFeeType">
            <p class="st-sentence-text" id="st-latefee-label">When rent is late:${savedTag('lateFeeType')}</p>
            <div class="seg tn-pick st-lf" role="radiogroup" aria-labelledby="st-latefee-label">${lfChoice('none', 'Don’t suggest a late fee')}${lfChoice('flat', 'Suggest a set amount')}${lfChoice('percent', 'Suggest a percent of the rent')}</div>
          </div>
          ${lf.type === 'flat' ? sentence('lateFeeAmount', h`When rent is late, suggest a late fee of <span class="money-input st-money"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" id="st-lateFeeAmount" data-key="lateFeeAmount" data-change="save" data-input="draft" value="${val('lateFeeAmount', M.input(lf.amount))}" aria-label="Late fee amount" autocomplete="off" data-write></span>.`)
            : lf.type === 'percent' ? sentence('lateFeeAmount', h`When rent is late, suggest a late fee of ${numInput('lateFeeAmount', lf.amount, 'Late fee percent', { inputmode: 'decimal' })} percent of that month’s rent.`) : ''}
          <p class="st-rules" id="st-rule-sentence">${ruleSentence(previewSettings())}</p>`)}
        ${sec('leases', 'Deposits and leases', h`
          ${sentence('depositReturnDays', h`Give back deposits within ${numInput('depositReturnDays', s.depositReturnDays, 'Days to give back a deposit', { maxlength: 3 })} days after a tenant moves out.`, 'Today reminds you before the deadline.')}
          ${sentence('leaseNoticeDays', h`Remind me about leases ${numInput('leaseNoticeDays', s.leaseNoticeDays, 'Days before a lease ends', { maxlength: 3 })} days before they end.`, 'So there is time to renew, or to find a new tenant.')}`)}
        ${sec('portfolio', 'Your name on receipts', sentence('portfolioName', h`<label for="st-portfolioName">What do you call your rentals?</label> <input class="input st-wide" type="text" id="st-portfolioName" data-key="portfolioName" data-change="save" data-input="draft" value="${val('portfolioName', s.portfolioName)}" placeholder="For example: Calder Rentals" maxlength="80" autocomplete="off" data-write>`, 'It is printed on receipts and statements you copy for tenants.'))}
        ${sec('methods', 'Ways tenants pay you', h`
          <p class="st-p">These are the choices when you record a payment. Removing one doesn’t change payments already recorded.${savedTag('methods')}</p>
          <ul class="st-methods" id="st-methods">${s.methods.map((m, i) => h`<li class="st-method"><span>${m}</span><button type="button" class="btn btn-ghost" data-act="rmMethod" data-i="${i}" data-write${s.methods.length <= 1 ? RB.raw(' disabled') : ''}>Remove</button></li>`)}</ul>
          <form class="st-method-add" data-submit="addMethod"><label class="field-label" for="st-method-new">Add another way</label><span class="st-btnrow"><input class="input" type="text" id="st-method-new" data-input="methodDraft" value="${methodDraft}" placeholder="For example: PayPal" maxlength="30" autocomplete="off" data-write><button type="submit" class="btn" data-write>Add</button></span></form>`)}
        ${sec('import', 'Bring in my tenants', importSection(today))}
        ${sec('backup', 'Save a copy', backupSection())}
        ${sec('sample', 'Example tenants', h`
          <p class="st-p">${hasSample ? 'Example tenants are showing so you can try things out. Remove them before you add your own.' : 'You can show 27 made-up tenants to try things out. Your own tenants are kept.'}</p>
          <div class="st-btnrow">${hasSample
            ? h`<button type="button" class="btn btn-lg" id="setup-remove-sample" data-cmd="sample:remove" data-write>${ui.icon('trash')}<span>Remove the example tenants</span></button>`
            : h`<button type="button" class="btn btn-lg" id="setup-load-sample" data-cmd="sample:load" data-write>${ui.icon('sample')}<span>Show example tenants</span></button>`}</div>`)}
        ${sec('about', 'Who can see this?', h`
          <p class="st-p">Your rent book is saved with this page. Anyone you share the page with can see every tenant, phone number and payment in it — and change them if you let them edit. Nobody else can see it.${ctx.state.mode === 'local' ? ' Right now it is saved on this device only.' : ''}</p>`)}
        ${sec('keys', 'Keyboard shortcuts', h`<p class="st-p">If you like using the keyboard, there are shortcuts for common jobs. You never need them.</p>
          <div class="st-btnrow"><button type="button" class="btn" id="st-keys" data-cmd="help:keys">${ui.icon('keyboard')}<span>Show the keyboard shortcuts</span></button></div>`)}
      </div>`);

    const patchPreview = () => { const x = el.querySelector('#st-rule-sentence'); if (x) x.textContent = ruleSentence(previewSettings()); };
    ui.bind(el, {
      draft: i => { drafts[i.dataset.key] = i.value; if (errs[i.dataset.key]) setErr(el, i.dataset.key, null); patchPreview(); },
      save: i => saveSetting(el, i.dataset.key, i.value),
      lfType: b => {
        if (!canWrite()) return;
        const v = b.dataset.v; const cur = S().settings().lateFee;
        if (cur.type === v) return;
        const amount = v === 'none' ? cur.amount : v === 'flat' ? 5000 : 5;
        delete drafts.lateFeeAmount; delete errs.lateFeeAmount;
        flash = { key: 'lateFeeType', until: Date.now() + 3000 };
        S().saveSettings({ lateFee: { type: v, amount } }).catch(() => {});
        setTimeout(() => { if (flash && flash.key === 'lateFeeType') { flash = null; const x = document.getElementById('st-saved-lateFeeType'); if (x) x.classList.remove('is-on'); } }, 3000);
      },
      methodDraft: i => { methodDraft = i.value; },
      addMethod: () => {
        if (!canWrite()) return;
        const m = methodDraft.trim().slice(0, 30); const list = S().settings().methods;
        if (!m) return;
        if (list.some(x => x.toLowerCase() === m.toLowerCase())) { ui.toast(m + ' is already on the list.'); return; }
        methodDraft = '';
        S().saveSettings({ methods: list.concat([m]) }).catch(() => {});
        flash = { key: 'methods', until: Date.now() + 3000 };
        setTimeout(() => { const x = document.getElementById('st-saved-methods'); if (x) x.classList.remove('is-on'); }, 3000);
      },
      rmMethod: b => {
        if (!canWrite()) return;
        const list = S().settings().methods.slice(); const i = +b.dataset.i; const m = list[i];
        if (list.length <= 1 || m === undefined) return;
        const before = list.slice(); list.splice(i, 1);
        S().saveSettings({ methods: list }).catch(() => {});
        ui.toast('Removed ' + m + ' from the ways tenants pay you.', { undo: () => S().saveSettings({ methods: before }), duration: 10000 });
      },
      impText: t => {
        imp.text = t.value; imp.done = null;
        // patch only the count and the Next button, so the box keeps focus and caret
        const p = imp.text.trim() ? parsed() : null;
        const c = el.querySelector('#st-imp-count'); if (c) c.textContent = p ? (p.rows.length === 1 ? 'We found 1 tenant row.' : 'We found ' + p.rows.length + ' tenant rows.') : '';
        const n = el.querySelector('#st-imp-next1'); if (n) n.disabled = !(p && p.rows.length);
      },
      impFile: inp => readFile(inp, (text, name, err) => {
        if (err || text == null) { imp.fileErr = (name ? name + ': ' : '') + (err || 'it couldn’t be opened.'); RB.shell.refresh(); return; }
        imp.text = text; imp.fileName = name; imp.fileErr = ''; imp.done = null; imp.map = null; imp.mapFor = null; imp.step = 2; RB.shell.refresh();
      }),
      impClear: () => { imp.text = ''; imp.fileName = ''; imp.map = null; imp.mapFor = null; imp.fileErr = ''; imp.step = 1; RB.shell.refresh(); },
      impStep: b => { imp.step = +b.dataset.s; RB.shell.refresh(); const t = el.querySelector('#st-sec-import'); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: 'start' }); },
      impSample: c => { imp.removeSample = c.checked; },
      map: sel => {
        const i = +sel.dataset.i; const k = sel.value;
        if (k) imp.map = imp.map.map((x, j) => (j !== i && x === k ? '' : x)); // each kind comes from one column
        imp.map[i] = k; RB.shell.refresh();
      },
      template: () => RB.actions.downloadFile('rent-book-example-list.csv', TEMPLATE, 'text/csv'),
      doImport: () => doImport(today),
      goTenants: () => RB.shell.go('tenants'),
      doneClose: () => { imp.done = null; RB.shell.refresh(); },
      restoreFile: inp => readFile(inp, (text, name, err) => {
        if (err || text == null) { restore = { error: err || 'it couldn’t be opened.', name }; RB.shell.refresh(); return; }
        let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }
        const summary = summarize(data);
        restore = summary ? { data, name, summary } : { error: 'it isn’t a copy saved from Rent Book.', name };
        RB.shell.refresh();
      }),
      restoreGo: async () => { if (!restore || !restore.data) return; const ok = await RB.actions.restore(restore.data); if (ok) { restore = null; RB.shell.refresh(); } },
      restoreClose: () => { restore = null; RB.shell.refresh(); },
    });
    if (ctx.intent === 'import') {
      requestAnimationFrame(() => { const t = el.querySelector('#st-sec-import'); if (t) t.scrollIntoView({ block: 'start' }); const ta = el.querySelector('#st-import-text'); if (ta) ta.focus({ preventScroll: true }); });
    }
  },
});

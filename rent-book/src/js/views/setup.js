// views/setup.js — Settings (#setup), SPEC §10.3: a short page of sections — text size, rent rules as plain sentences
// that save on change, deposits and leases, your name on receipts, ways tenants pay (a compact list changed in a short
// sheet), three rows that open their own flows ("Bring in my tenants" — a ui.steps guide; "Save a copy"; "Restore from a
// copy"), example tenants, who can see this (with the sync note), keyboard shortcuts. Words: docs/SPEC.md §8.
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


/** Bring the checked rows in (after the guide has closed — law 10: the confirm never opens on top of it). */
async function doImport(today, checks, rowCount, removeSample) {
  if (!canWrite()) return;
  if (!checks.length) return;
  if (removeSample) {
    const ts = S().tenantsList().filter(t => t.sample).length;
    const ok = await ui.confirm({
      title: 'Remove the example tenants and bring in yours?',
      body: h`<p>The ${RB.plural(ts, 'example tenant')}, their payment history and the example repairs are deleted first. Then your ${RB.plural(checks.length, 'tenant')} are added.</p>`,
      confirmLabel: 'Remove the examples and bring in mine', danger: true,
    });
    if (!ok) return;
    try { await S().removeSample(); } catch (e) { return; }
  }
  const tenants = {};
  checks.forEach(c => { tenants[RB.id()] = tenantDoc(c.data, today); });
  const ids = Object.keys(tenants);
  try { await S().importAll({ tenants }); } catch (e) { ui.toast('Some tenants couldn’t be saved. Look at the Tenants list and try again.', { tone: 'bad' }); }
  imp.done = { count: ids.length, skipped: rowCount - ids.length, removed: removeSample };
  imp.text = ''; imp.fileName = ''; imp.map = null; imp.mapFor = null;
  ui.toast('Brought in ' + RB.plural(ids.length, 'tenant') + '.', { undo: () => { ids.forEach(id => S().deleteTenant(id).catch(() => {})); imp.done = null; RB.shell.refresh(); } });
  RB.shell.refresh();
}

// ------------------------------------------------------------------ "Bring in my tenants": its own guided flow (ui.steps)
const countWords = p => (p ? (p.rows.length === 1 ? 'We found 1 tenant row.' : 'We found ' + p.rows.length + ' tenant rows.') : '');
function step1Body(el, getSh) {
  const draw = () => {
    const p = imp.text.trim() ? parsed() : null;
    el.innerHTML = String(h`
      <p>Open your list in Excel, Numbers or Google Sheets. Select it all — with the headings — copy it, and paste it below. One row for each tenant, like this:</p>
      <figure class="st-eg"><table aria-label="An example list"><thead><tr><th>Name</th><th>Unit</th><th>Rent each month</th><th>Lease ends</th></tr></thead>
        <tbody><tr><td>Maya Okafor</td><td>2B</td><td>1450</td><td>12/31/2026</td></tr><tr><td>Theo Lindqvist</td><td>102</td><td>1520</td><td>9/30/2027</td></tr></tbody></table>
        <figcaption class="st-hint">Only the name and the rent are needed. The property, phone, email, lease dates, deposit and what they already owe can come too.</figcaption></figure>
      <div class="field" data-field="list">
        <label class="field-label" for="st-import-text">Paste your list here</label>
        <textarea class="input textarea st-import-text" id="st-import-text" name="list" rows="6" spellcheck="false" placeholder="Tap here, then paste" data-write>${imp.text}</textarea>
        <div class="field-hint" id="st-imp-count" aria-live="polite">${countWords(p)}</div>
        <div class="field-error" aria-live="polite">${imp.fileErr}</div>
      </div>
      <div class="st-links">
        <label class="btn btn-outline st-file" for="st-import-file" data-write>${ui.icon('upload')}<span>Or choose a file</span></label>
        <input type="file" id="st-import-file" class="vh" accept=".csv,.tsv,.txt,text/csv,text/plain">
        <button type="button" class="btn-link" id="st-template">Download an example for Excel</button>
        ${imp.text ? h`<button type="button" class="btn-link" id="st-imp-clear">Start again</button>` : ''}
      </div>
      ${imp.fileName ? h`<p class="st-hint">From the file: ${imp.fileName}</p>` : ''}`);
    const ta = el.querySelector('#st-import-text');
    ta.addEventListener('input', () => { imp.text = ta.value; imp.done = null; imp.fileErr = ''; const q = imp.text.trim() ? parsed() : null; el.querySelector('#st-imp-count').textContent = countWords(q); });
    el.querySelector('#st-import-file').addEventListener('change', e => readFile(e.target, (text, name, err) => {
      if (err || text == null) { imp.fileErr = (name ? name + ': ' : '') + (err || 'it couldn’t be opened.'); draw(); return; }
      imp.text = text; imp.fileName = name; imp.fileErr = ''; imp.done = null; imp.map = null; imp.mapFor = null;
      getSh().steps.go(1);
    }));
    el.querySelector('#st-template').addEventListener('click', () => RB.actions.downloadFile('rent-book-example-list.csv', TEMPLATE, 'text/csv'));
    const clr = el.querySelector('#st-imp-clear');
    if (clr) clr.addEventListener('click', () => { imp.text = ''; imp.fileName = ''; imp.map = null; imp.mapFor = null; imp.fileErr = ''; draw(); el.querySelector('#st-import-text').focus(); });
  };
  draw();
}
function step2Body(el) {
  const draw = () => {
    const p = parsed();
    const mapped = imp.map || [];
    const missing = ['name', 'rent'].filter(k => !mapped.includes(k));
    const label = k => (FIELDS.find(f => f.key === k) || {}).label;
    el.innerHTML = String(h`
      <p>${p.hasHeader ? 'We matched your columns by their headings. If one is wrong, change it.' : 'We couldn’t find headings, so tell us what each column holds.'}</p>
      <div class="field" data-field="cols">
        <div class="st-cols">${p.header.map((hd, i) => {
          const eg = p.rows.slice(0, 2).map(r => r[i]).filter(Boolean);
          return h`<div class="st-col">
            <label class="field-label" for="st-map-${i}">Your column “${hd || 'Column ' + (i + 1)}” is:</label>
            <span class="select"><select class="input" id="st-map-${i}" data-i="${i}">${FIELDS.map(f => h`<option value="${f.key}"${mapped[i] === f.key ? RB.raw(' selected') : ''}>${f.label}</option>`)}</select></span>
            ${eg.length ? h`<div class="field-hint">For example: ${eg.join(', ')}</div>` : ''}
          </div>`;
        })}</div>
        <div class="field-error" aria-live="polite">${missing.length ? 'Tell us which column holds the ' + missing.map(label).join(' and the ').toLowerCase() + ' — they are needed.' : ''}</div>
      </div>`);
    el.querySelectorAll('select[data-i]').forEach(sel => sel.addEventListener('change', () => {
      const i = +sel.dataset.i; const k = sel.value;
      if (k) imp.map = imp.map.map((x, j) => (j !== i && x === k ? '' : x)); // each kind comes from one column
      imp.map[i] = k; draw(); const again = el.querySelector('#st-map-' + i); if (again) again.focus();
    }));
  };
  draw();
}
function lookOver(today) {
  const p = parsed();
  const checks = checkAll(p, today);
  const good = checks.filter(c => c.ok).length;
  const bad = checks.length - good;
  const rowName = c => [c.data.name, c.data.unit].filter(Boolean).join(', ') || 'empty';
  return h`<div class="st-import" id="st-import">
    <p class="st-lead">${good === 1 ? '1 tenant is' : good + ' tenants are'} ready to bring in.${bad ? h` ${bad === 1 ? '1 row has a problem' : bad + ' rows have problems'} and will be left out.` : ''}</p>
    ${bad ? h`<div class="st-problems"><p>To fix a problem, change it in your spreadsheet and paste the list again — or carry on, and only that row is left out.</p>
      <ul>${checks.map((c, i) => c.ok ? '' : h`<li>Row ${i + 1} (${rowName(c)}): ${c.problems.join(' ')}</li>`)}</ul></div>` : ''}
    <ul class="rows st-preview" id="st-import-table">${checks.slice(0, 200).map((c, i) => ui.row({
      title: c.data.name || 'No name',
      sub: [c.data.unit, c.data.property].filter(Boolean).join(', ') + (c.data.rent ? (c.data.unit || c.data.property ? ' · ' : '') + M.fmt(c.data.rent) + ' a month' : ''),
      status: c.ok ? ui.status('paid', 'Ready') : ui.status('late', 'Left out'), liAttrs: { 'data-row': i + 1 },
    }))}</ul>
    ${p.rows.length > 200 ? h`<p class="st-hint">Showing the first 200 rows. All ${p.rows.length} were checked.</p>` : ''}
    ${S().hasSample() ? h`<label class="check st-rmsample"><input type="checkbox" id="st-import-rmsample"${imp.removeSample !== false ? RB.raw(' checked') : ''}><span>Remove the example tenants first</span></label>` : ''}
  </div>`;
}
function openImport() {
  if (!canWrite()) return null;
  const today = S().today();
  imp.done = null;
  const goodCount = () => { const p = imp.text.trim() ? parsed() : null; return p ? checkAll(p, today).filter(c => c.ok).length : 0; };
  let sh = null;
  sh = ui.steps({
    title: 'Bring in my tenants', size: 'wide',
    steps: [
      { title: 'Paste your list or choose a file', body: el => step1Body(el, () => sh),
        validate: () => { const p = imp.text.trim() ? parsed() : null; return { list: p && p.rows.length ? '' : 'Paste your list first, or choose a file.' }; } },
      { title: 'Check we understood your columns', body: el => step2Body(el),
        validate: () => ({ cols: ['name', 'rent'].every(k => (imp.map || []).includes(k)) ? '' : 'Tell us which column holds the name and the rent.' }) },
    ],
    summary: () => lookOver(today),
    get doneLabel() { const n = goodCount(); return n ? 'Bring in ' + RB.plural(n, 'tenant') : 'Nothing to bring in'; },
    onDone: () => {
      const p = parsed(); if (!p) return false;
      const checks = checkAll(p, today).filter(c => c.ok);
      if (!checks.length) { ui.toast('No row is ready yet. Press Back and fix the list.', { tone: 'bad' }); return false; }
      const cb = sh.body.querySelector('#st-import-rmsample');
      const removeSample = S().hasSample() && (cb ? cb.checked : imp.removeSample !== false);
      setTimeout(() => doImport(today, checks, p.rows.length, removeSample), 0);
      return undefined;
    },
  });
  sh.el.classList.add('sheet-page', 'st-flow');
  sh.body.addEventListener('change', e => { if (e.target.id === 'st-import-rmsample') imp.removeSample = e.target.checked; });
  return sh;
}

// ------------------------------------------------------------------ "Restore from a copy": its own short flow
function openRestore() {
  if (!canWrite()) return;
  restore = null;
  const body = sh => h`
    <p>Choose a copy you saved from Rent Book. Restoring replaces everything in this rent book with what is in the copy — you will see what is in it first.</p>
    <p class="st-links"><label class="btn btn-outline" for="st-restore-file">${ui.icon('upload')}<span>Choose the copy</span></label>
      <input type="file" id="st-restore-file" class="vh" accept=".json,application/json"></p>
    ${restore ? restore.error ? h`<p class="st-restore is-bad" role="alert">${ui.status('late', 'Can’t be used')} ${restore.name}: ${restore.error}</p>`
      : h`<div class="st-restore" id="st-restore-summary">
        <p>${restore.name} was saved on ${restore.summary.when}. It has ${RB.plural(restore.summary.tenants, 'tenant')}, ${RB.plural(restore.summary.entries, 'payment or charge', 'payments and charges')} and ${RB.plural(restore.summary.tickets, 'repair')}${restore.summary.portfolio ? ' (“' + restore.summary.portfolio + '”)' : ''}.</p>
        <p>If you restore it, everything in this rent book now is replaced.</p></div>` : ''}`;
  ui.sheet({
    title: 'Restore from a copy', cancel: 'Keep what I have',
    body: (el, sh) => {
      const draw = () => {
        el.innerHTML = String(body(sh));
        sh.setAction('go', { hidden: !(restore && restore.data) });
        el.querySelector('#st-restore-file').addEventListener('change', e => readFile(e.target, (text, name, err) => {
          if (err || text == null) { restore = { error: err || 'it couldn’t be opened.', name }; draw(); return; }
          let data = null; try { data = JSON.parse(text); } catch (x) { data = null; }
          const summary = summarize(data);
          restore = summary ? { data, name, summary } : { error: 'it isn’t a copy saved from Rent Book.', name };
          draw();
        }));
      };
      draw();
    },
    actions: [{ id: 'go', label: 'Replace everything with this copy', kind: 'danger', hidden: true, onClick: () => {
      const data = restore && restore.data; if (!data) return false;
      restore = null;
      setTimeout(() => RB.actions.restore(data), 0);   // its confirm opens after this sheet has closed (law 10)
    } }],
    onClose: () => { if (restore && !restore.data) restore = null; },
  });
}

// ------------------------------------------------------------------ "Ways tenants pay you": a compact list, changed in a short sheet
function openMethods() {
  if (!canWrite()) return;
  let removed = null;
  ui.sheet({
    title: 'Ways tenants pay you', sub: 'These are the choices when you record a payment. Removing one doesn’t change payments already recorded.',
    cancel: 'Done',
    body: (el, sh) => {
      const draw = () => {
        const list = S().settings().methods;
        el.innerHTML = String(h`<ul class="st-methods" id="st-methods">${list.map((m, i) => h`<li class="st-method"><span>${m}</span>${list.length > 1 ? h`<button type="button" class="btn-link" data-rm="${i}" data-write>Remove</button>` : ''}</li>`)}</ul>
          ${removed ? h`<p class="st-hint">Removed ${removed.name}. <button type="button" class="linkbtn" id="st-method-undo">Put it back</button></p>` : ''}
          ${ui.field({ name: 'method', id: 'st-method-new', label: 'Add another way', value: methodDraft, placeholder: 'For example: PayPal', attrs: { maxlength: 30, 'data-write': '' } })}`);
        const inp = el.querySelector('#st-method-new');
        inp.addEventListener('input', () => { methodDraft = inp.value; });
        el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
          const cur = S().settings().methods.slice(); const i = +b.dataset.rm; const m = cur[i];
          if (cur.length <= 1 || m === undefined) return;
          removed = { name: m, before: cur.slice() }; cur.splice(i, 1);
          S().saveSettings({ methods: cur }).catch(() => {});
          draw();
        }));
        const u = el.querySelector('#st-method-undo');
        if (u) u.addEventListener('click', () => { S().saveSettings({ methods: removed.before }).catch(() => {}); removed = null; draw(); });
      };
      sh._draw = draw;
      draw();
    },
    actions: [{ id: 'add', label: 'Add', kind: 'primary', onClick: sh => {
      const m = methodDraft.trim().slice(0, 30); const list = S().settings().methods;
      if (!m) { ui.showErrors(sh.body, { method: 'Type a way to pay, like PayPal' }); return false; }
      if (list.some(x => x.toLowerCase() === m.toLowerCase())) { ui.showErrors(sh.body, { method: m + ' is already on the list.' }); return false; }
      methodDraft = '';
      S().saveSettings({ methods: list.concat([m]) }).catch(() => {});
      sh._draw(); const inp = sh.body.querySelector('#st-method-new'); if (inp) inp.focus();
      return false;
    } }],
    initialFocus: '#st-method-new',
  });
}

// ------------------------------------------------------------------ render pieces
const savedTag = key => h`<span class="st-saved${flash && flash.key === key && Date.now() < flash.until ? ' is-on' : ''}" id="st-saved-${key}" aria-live="polite">${ui.status('paid', 'Saved')}</span>`;
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
    const d = imp.done;
    el.innerHTML = String(h`
      <div class="st-main">
        ${sec('text', 'Text size', h`${ui.textSizeControl({ id: 'st-ts', compact: true })}<p class="st-hint">Makes all the words and buttons bigger on this device.</p>`)}
        ${sec('rules', 'Your rent rules', h`
          ${sentence('dueDay', h`Rent is due on the <span class="select st-inline-sel"><select class="input" id="st-dueDay" data-key="dueDay" data-change="save" aria-label="Day rent is due" data-write>${Array.from({ length: 28 }, (_, i) => h`<option value="${i + 1}"${+val('dueDay', s.dueDay) === i + 1 ? RB.raw(' selected') : ''}>${ord(i + 1)}</option>`)}</select></span> of the month.`)}
          ${sentence('graceDays', h`Give tenants ${numInput('graceDays', s.graceDays, 'Days before rent counts as late', { maxlength: 2 })} days before it counts as late.`)}
          <div class="st-sentence-row" data-row="lateFeeType">
            ${ui.field({ name: 'lfType', id: 'st-lf', label: h`When rent is late:${savedTag('lateFeeType')}`, type: 'choice', value: lf.type, write: true, attrs: { 'data-change': 'lfType' },
              options: [{ value: 'none', label: 'Don’t suggest a late fee' }, { value: 'flat', label: 'Suggest a set amount' }, { value: 'percent', label: 'Suggest a percent of the rent' }] })}
          </div>
          ${lf.type === 'flat' ? sentence('lateFeeAmount', h`Suggest a late fee of <span class="money-input st-money"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" id="st-lateFeeAmount" data-key="lateFeeAmount" data-change="save" data-input="draft" value="${val('lateFeeAmount', M.input(lf.amount))}" aria-label="Late fee amount" autocomplete="off" data-write></span>.`)
            : lf.type === 'percent' ? sentence('lateFeeAmount', h`Suggest a late fee of ${numInput('lateFeeAmount', lf.amount, 'Late fee percent', { inputmode: 'decimal' })} percent of that month’s rent.`) : ''}
          <p class="st-rules" id="st-rule-sentence">${ruleSentence(previewSettings())}</p>`)}
        ${sec('leases', 'Deposits and leases', h`
          ${sentence('depositReturnDays', h`Give back deposits within ${numInput('depositReturnDays', s.depositReturnDays, 'Days to give back a deposit', { maxlength: 3 })} days after a tenant moves out.`)}
          ${sentence('leaseNoticeDays', h`Remind me about leases ${numInput('leaseNoticeDays', s.leaseNoticeDays, 'Days before a lease ends', { maxlength: 3 })} days before they end.`)}`)}
        ${sec('portfolio', 'Your name on receipts', sentence('portfolioName', h`<label for="st-portfolioName">What do you call your rentals?</label> <input class="input st-wide" type="text" id="st-portfolioName" data-key="portfolioName" data-change="save" data-input="draft" value="${val('portfolioName', s.portfolioName)}" placeholder="For example: Calder Rentals" maxlength="80" autocomplete="off" data-write>`))}
        ${sec('methods', 'Ways tenants pay you', h`<p class="st-methods-line"><span id="st-methods-list">${s.methods.join(' · ')}</span>. <button type="button" class="linkbtn" id="st-methods-change" data-act="methods" data-write>Change</button></p>`)}
        ${sec('copies', 'Your tenants and copies', h`
          ${d ? h`<p class="st-done" role="status">${ui.status('paid', 'Brought in ' + RB.plural(d.count, 'tenant') + '.')} ${d.skipped ? (d.skipped === 1 ? '1 row with a problem was left out. ' : d.skipped + ' rows with problems were left out. ') : ''}Their rent is counted from ${ui.dateWords(D.monthStart(D.monthKey(today)), today)}. <a class="linkbtn" href="#tenants">See your tenants</a></p>` : ''}
          ${ui.rows([
            { title: 'Bring in my tenants', sub: 'From a spreadsheet: paste your list or choose a file', act: 'import', id: 'st-import-open', attrs: { 'data-write': '' } },
            { title: 'Save a copy', sub: 'One file with everything — keep it somewhere safe', act: 'backup', id: 'st-backup' },
            { title: 'Restore from a copy', sub: 'Put back everything from a copy you saved', act: 'restore', id: 'st-restore-open', attrs: { 'data-write': '' } },
          ], { inset: true, id: 'st-copies' })}`)}
        ${sec('sample', 'Example tenants', h`
          <p>${hasSample ? 'Example tenants are showing so you can try things out.' : 'You can show 27 made-up tenants to try things out. Your own tenants are kept.'}
          ${hasSample
            ? h`<button type="button" class="linkbtn" id="setup-remove-sample" data-cmd="sample:remove" data-write>Remove the example tenants</button>`
            : h`<button type="button" class="linkbtn" id="setup-load-sample" data-cmd="sample:load" data-write>Show example tenants</button>`}</p>`)}
        ${sec('about', 'Who can see this?', h`
          <p>Anyone you share this page with can see every tenant, phone number and payment — and change them if you let them edit. Nobody else can.</p>
          ${ui.syncNote ? ui.syncNote() : ctx.state.mode === 'local' ? h`<p class="st-hint">Right now it is saved on this device only.</p>` : ''}`)}
        ${sec('keys', 'Keyboard shortcuts', h`<p>For people who like the keyboard. You never need them. <button type="button" class="linkbtn" id="st-keys" data-cmd="help:keys">Show the shortcuts</button></p>`)}
      </div>`);

    const patchPreview = () => { const x = el.querySelector('#st-rule-sentence'); if (x) x.textContent = ruleSentence(previewSettings()); };
    ui.bind(el, {
      draft: i => { drafts[i.dataset.key] = i.value; if (errs[i.dataset.key]) setErr(el, i.dataset.key, null); patchPreview(); },
      save: i => saveSetting(el, i.dataset.key, i.value),
      lfType: r => {
        if (!canWrite()) return;
        const v = r.value; const cur = S().settings().lateFee;
        if (cur.type === v) return;
        const amount = v === 'none' ? cur.amount : v === 'flat' ? 5000 : 5;
        delete drafts.lateFeeAmount; delete errs.lateFeeAmount;
        flash = { key: 'lateFeeType', until: Date.now() + 3000 };
        S().saveSettings({ lateFee: { type: v, amount } }).catch(() => {});
        setTimeout(() => { if (flash && flash.key === 'lateFeeType') { flash = null; const x = document.getElementById('st-saved-lateFeeType'); if (x) x.classList.remove('is-on'); } }, 3000);
      },
      methods: () => openMethods(),
      import: () => openImport(),
      backup: () => RB.actions.backup(),
      restore: () => openRestore(),
    });
    if (ctx.intent === 'import') requestAnimationFrame(() => openImport());
  },
});

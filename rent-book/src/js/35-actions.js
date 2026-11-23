// 35-actions.js — RB.actions: shared flows any view can call. Undo, not confirm (spec §5).
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date, M = RB.money, h = RB.html, ui = RB.ui;
const S = () => RB.store;

/** "Unit 2B" for short unit labels, the label itself otherwise ("No. 4"), else the tenant's name. */
function who(t) {
  if (!t) return 'tenant';
  if (t.unit) return /^[A-Za-z]?\d+[A-Za-z]?$/.test(t.unit) || /^\d?[A-Za-z]$/.test(t.unit) ? 'Unit ' + t.unit : t.unit;
  return t.name || 'tenant';
}
function guard() {
  const st = S().state;
  if (st.readOnly) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return false; }
  if (!st.mode || !st.ready) { ui.toast('Still loading — try again in a moment.'); return false; }
  return true;
}
function lastMethod(tenantId) {
  const lg = S().ledger(tenantId);
  const methods = S().settings().methods;
  const m = (lg && lg.lastPayment && lg.lastPayment.method) || RB.prefs.get('lastMethod', null) || methods[0] || 'Check';
  return m;
}
function monthOptions(today, back, fwd, sel) {
  const out = [];
  for (let i = fwd; i >= -back; i--) { const k = D.addMonthKey(D.monthKey(today), i); out.push({ value: k, label: D.fmtMonth(k) }); }
  if (sel && !out.some(o => o.value === sel)) out.push({ value: sel, label: D.fmtMonth(sel) });
  return out;
}
const tenantSub = t => [t.name, [t.property, t.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

// ------------------------------------------------------------------ payments
/**
 * Record a payment.
 * opts.quick: record the full open balance today with the tenant's last-used method, then an Undo toast (no sheet).
 *             If nothing is owed, falls back to the sheet.
 * otherwise:  payment sheet (amount prefilled to opts.amount ?? open balance ?? current rent, date, method, reference, memo, live "Balance after").
 * Resolves the new entry id, or null if cancelled.
 */
function recordPayment(tenantId, opts) {
  const o = opts || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  const lg = S().ledger(tenantId);
  const today = S().today();
  const open = Math.max(0, lg.balance);
  if (o.quick && open > 0) {
    const id = RB.id();
    const method = lastMethod(tenantId);
    const amount = o.amount || open;
    S().addEntry(tenantId, { id, type: 'payment', date: today, amount, method, ref: '', memo: '' }).catch(() => {});
    ui.toast('Recorded ' + M.fmt(amount) + ' from ' + who(t), { undo: () => S().undoEntry(tenantId, id) });
    return Promise.resolve(id);
  }
  return new Promise(resolve => {
    let saved = null;
    const methods = S().settings().methods;
    const start = o.amount != null ? o.amount : open || lg.rent || 0;
    ui.sheet({
      title: 'Record payment', sub: tenantSub(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-grid">
          ${ui.field({ name: 'amount', id: 'pay-amount', label: 'Amount', type: 'money', value: start, required: true, hint: open > 0 ? h`Open balance ${M.fmt(open)}` : lg.balance < 0 ? 'Already ' + M.fmt(-lg.balance) + ' in credit' : 'Nothing owed right now' })}
          ${ui.field({ name: 'date', id: 'pay-date', label: 'Date received', type: 'date', value: o.date || today, required: true })}
          ${ui.field({ name: 'method', id: 'pay-method', label: 'Method', type: 'select', value: o.method || lastMethod(tenantId), options: methods })}
          ${ui.field({ name: 'ref', id: 'pay-ref', label: 'Reference', placeholder: 'Check no., confirmation…', optional: true })}
          ${ui.field({ name: 'memo', id: 'pay-memo', label: 'Memo', type: 'text', optional: true, span: 2 })}
        </div>`);
        const upd = () => {
          const c = M.parse(el.querySelector('#pay-amount').value);
          const after = lg.balance - (c || 0);
          sh.setNote(h`Balance after: <strong>${after > 0 ? M.fmt(after) + ' owed' : after < 0 ? M.fmt(-after) + ' credit' : M.fmt(0)}</strong>`);
          sh.setAction('save', { label: c > 0 ? 'Record ' + M.fmt(c) : 'Record payment', disabled: !(c > 0) });
        };
        el.addEventListener('input', upd);
        requestAnimationFrame(upd);
      },
      actions: [{ id: 'save', label: 'Record ' + M.fmt(start), kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Enter an amount above zero' : '' }) });
        if (!v) return false;
        const id = RB.id();
        S().addEntry(tenantId, { id, type: 'payment', date: v.date, amount: v.amount, method: v.method, ref: v.ref, memo: v.memo }).catch(() => {});
        RB.prefs.set('lastMethod', v.method);
        saved = id;
        ui.toast('Recorded ' + M.fmt(v.amount) + ' from ' + who(t), { undo: () => S().undoEntry(tenantId, id) });
      } }],
      onClose: () => resolve(saved),
    });
  });
}

/** Record payments for several tenants at once (full open balance each, today, last-used method). Single toast with Undo. */
function recordPayments(tenantIds, opts) {
  if (!guard()) return Promise.resolve([]);
  const today = S().today();
  const amounts = (opts && opts.amounts) || null; // optional {tenantId: cents} (capped at the balance), e.g. one past month's open amount
  const done = [];
  let total = 0;
  for (const tid of tenantIds) {
    const lg = S().ledger(tid); if (!lg || lg.balance <= 0) continue;
    const amount = amounts && amounts[tid] > 0 ? Math.min(amounts[tid], lg.balance) : lg.balance;
    const id = RB.id();
    S().addEntry(tid, { id, type: 'payment', date: today, amount, method: lastMethod(tid), ref: '', memo: '' }).catch(() => {});
    done.push([tid, id]); total += amount;
  }
  if (done.length) ui.toast('Recorded ' + RB.plural(done.length, 'payment') + ' · ' + M.fmt(total), { undo: () => done.forEach(([tid, id]) => S().undoEntry(tid, id)) });
  return Promise.resolve(done.map(d => d[1]));
}

// ------------------------------------------------------------------ charges, credits, late fees
const CATS = [{ value: 'utility', label: 'Utility' }, { value: 'damage', label: 'Damage / repair' }, { value: 'fee', label: 'Fee' }, { value: 'late_fee', label: 'Late fee' }, { value: 'other', label: 'Other' }];
/** Sheet: add a manual charge (description, amount, date, category, period). preset: {amount, category, memo, period, date}. Resolves entry id|null. */
function addCharge(tenantId, preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  const today = S().today();
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Add charge', sub: tenantSub(t),
      body: h`<div class="form-grid">
        ${ui.field({ name: 'memo', id: 'chg-memo', label: 'Description', value: p.memo || '', placeholder: 'Water & sewer, key replacement…', required: true, span: 2 })}
        ${ui.field({ name: 'amount', id: 'chg-amount', label: 'Amount', type: 'money', value: p.amount, required: true })}
        ${ui.field({ name: 'date', id: 'chg-date', label: 'Date', type: 'date', value: p.date || today, required: true })}
        ${ui.field({ name: 'category', id: 'chg-category', label: 'Kind', type: 'select', value: p.category || 'utility', options: CATS })}
        ${ui.field({ name: 'period', id: 'chg-period', label: 'For month', type: 'select', value: p.period || D.monthKey(today), options: monthOptions(today, 12, 1, p.period) })}
      </div>`,
      actions: [{ id: 'save', label: 'Add charge', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Enter an amount above zero' : '' }) });
        if (!v) return false;
        const id = RB.id();
        S().addEntry(tenantId, { id, type: 'charge', date: v.date, amount: v.amount, category: v.category, period: v.period, memo: v.memo }).catch(() => {});
        saved = id;
        ui.toast('Added ' + M.fmt(v.amount) + ' charge to ' + who(t), { undo: () => S().undoEntry(tenantId, id) });
      } }],
      onClose: () => resolve(saved),
    });
  });
}
/** Sheet: add a credit (amount, date, reason). Resolves entry id|null. */
function addCredit(tenantId, preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  const today = S().today();
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Add credit', sub: tenantSub(t),
      body: h`<div class="form-grid">
        ${ui.field({ name: 'memo', id: 'cr-memo', label: 'Reason', value: p.memo || '', placeholder: 'Repair reimbursement, goodwill…', required: true, span: 2 })}
        ${ui.field({ name: 'amount', id: 'cr-amount', label: 'Amount', type: 'money', value: p.amount, required: true })}
        ${ui.field({ name: 'date', id: 'cr-date', label: 'Date', type: 'date', value: p.date || today, required: true })}
      </div>`,
      actions: [{ id: 'save', label: 'Add credit', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Enter an amount above zero' : '' }) });
        if (!v) return false;
        const id = RB.id();
        S().addEntry(tenantId, { id, type: 'credit', date: v.date, amount: v.amount, memo: v.memo }).catch(() => {});
        saved = id;
        ui.toast('Credited ' + M.fmt(v.amount) + ' to ' + who(t), { undo: () => S().undoEntry(tenantId, id) });
      } }],
      onClose: () => resolve(saved),
    });
  });
}
/** One click: post the late fee for `period` (default: the ledger's suggestion), dated today. Undo toast. Resolves entry id|null. */
function addLateFee(tenantId, period) {
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  const lg = S().ledger(tenantId);
  const k = period || (lg.suggestedLateFee && lg.suggestedLateFee.period) || D.monthKey(S().today());
  const amount = lg.suggestedLateFee && lg.suggestedLateFee.period === k ? lg.suggestedLateFee.amount : RB.model.lateFeeAmount(t, S().settings(), k);
  if (!amount) { ui.toast('No late fee is set up — choose one in Setup.'); return Promise.resolve(null); }
  const id = RB.id();
  S().addEntry(tenantId, { id, type: 'charge', category: 'late_fee', period: k, date: S().today(), amount, memo: 'Late fee — ' + D.monthName(k) }).catch(() => {});
  ui.toast('Added late fee ' + M.fmt(amount) + ' to ' + who(t), { undo: () => S().undoEntry(tenantId, id) });
  return Promise.resolve(id);
}

// ------------------------------------------------------------------ entries
function entryOf(tenantId, entryId) { const e = S().entries(tenantId)[entryId]; return e ? Object.assign({ id: entryId }, e) : null; }
const kindWord = e => (e.type === 'payment' ? 'payment' : e.type === 'credit' ? 'credit' : (e.category === 'late_fee' ? 'late fee' : 'charge'));
/** Void an entry (kept, struck through) with Undo. */
function voidEntry(tenantId, entryId) {
  if (!guard()) return Promise.resolve();
  const e = entryOf(tenantId, entryId); if (!e) return Promise.resolve();
  const p = S().voidEntry(tenantId, entryId).catch(() => {});
  ui.toast('Voided ' + M.fmt(e.amount) + ' ' + kindWord(e), { undo: () => S().unvoidEntry(tenantId, entryId) });
  return p;
}
/** Sheet: edit an entry's amount/date/method/ref/memo (category+period for charges). */
function editEntry(tenantId, entryId) {
  if (!guard()) return Promise.resolve(false);
  const t = S().tenant(tenantId); const e = entryOf(tenantId, entryId);
  if (!t || !e) return Promise.resolve(false);
  const today = S().today();
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: 'Edit ' + kindWord(e), sub: tenantSub(t),
      body: h`<div class="form-grid">
        ${ui.field({ name: 'amount', id: 'ed-amount', label: 'Amount', type: 'money', value: e.amount, required: true })}
        ${ui.field({ name: 'date', id: 'ed-date', label: 'Date', type: 'date', value: e.date, required: true })}
        ${e.type === 'payment' ? h`${ui.field({ name: 'method', id: 'ed-method', label: 'Method', type: 'select', value: e.method, options: Array.from(new Set(S().settings().methods.concat(e.method ? [e.method] : []))) })}
          ${ui.field({ name: 'ref', id: 'ed-ref', label: 'Reference', value: e.ref || '', optional: true })}` : ''}
        ${e.type === 'charge' ? h`${ui.field({ name: 'category', id: 'ed-category', label: 'Kind', type: 'select', value: e.category || 'other', options: CATS })}
          ${ui.field({ name: 'period', id: 'ed-period', label: 'For month', type: 'select', value: e.period || D.monthKey(e.date), options: monthOptions(today, 24, 1, e.period) })}` : ''}
        ${ui.field({ name: 'memo', id: 'ed-memo', label: e.type === 'payment' ? 'Memo' : 'Description', value: e.memo || '', span: 2, required: e.type !== 'payment', optional: e.type === 'payment' })}
      </div>`,
      actions: [{ id: 'save', label: 'Save changes', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Enter an amount above zero' : '' }) });
        if (!v) return false;
        const before = { amount: e.amount, date: e.date, method: e.method || '', ref: e.ref || '', memo: e.memo || '', category: e.category || null, period: e.period || null };
        S().updateEntry(tenantId, entryId, v).catch(() => {});
        ok = true;
        ui.toast('Saved ' + kindWord(e), { undo: () => S().updateEntry(tenantId, entryId, before) });
      } }],
      onClose: () => resolve(ok),
    });
  });
}
/** Copy a plain-text receipt for an entry to the clipboard. Call from a click handler. */
function copyReceipt(tenantId, entryId) {
  const t = S().tenant(tenantId); const lg = S().ledger(tenantId);
  if (!t || !lg) return Promise.resolve(false);
  return ui.copy(RB.model.receiptText({ tenant: t, ledger: lg, entryId, settings: S().settings() }), 'receipt');
}
/** Copy a plain-text statement (opts.from/to 'YYYY-MM-DD'). */
function copyStatement(tenantId, opts) {
  const t = S().tenant(tenantId); const lg = S().ledger(tenantId);
  if (!t || !lg) return Promise.resolve(false);
  return ui.copy(RB.model.statementText(Object.assign({ tenant: t, ledger: lg, settings: S().settings() }, opts || {})), 'statement');
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
/** Download the tenant's ledger as CSV. */
function downloadLedgerCsv(tenantId) {
  const t = S().tenant(tenantId); const lg = S().ledger(tenantId);
  if (!t || !lg) return Promise.resolve(false);
  return downloadFile('ledger-' + slug(t.unit + ' ' + t.name) + '-' + S().today() + '.csv', RB.model.ledgerCsv(lg), 'text/csv');
}

// ------------------------------------------------------------------ notes
const LOG_KINDS = [{ value: 'note', label: 'Note' }, { value: 'call', label: 'Call' }, { value: 'text', label: 'Text' }, { value: 'email', label: 'Email' }, { value: 'visit', label: 'Visit' }, { value: 'notice', label: 'Notice' }];
/** Sheet: add a timeline note (kind, text, optional follow-up date). Undo toast. Resolves log id|null. */
function addNote(tenantId, preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Add note', sub: tenantSub(t),
      body: h`<div class="form-grid">
        ${ui.field({ name: 'kind', id: 'note-kind', label: 'Kind', type: 'seg', value: p.kind || 'note', options: LOG_KINDS, span: 2 })}
        ${ui.field({ name: 'text', id: 'note-text', label: 'What happened', type: 'textarea', value: p.text || '', required: true, requiredMsg: 'Describe what happened', span: 2, rows: 4 })}
        ${ui.field({ name: 'followUp', id: 'note-followup', label: 'Follow up on', type: 'date', value: p.followUp || '', optional: true, hint: 'Shows on Today when it’s due.' })}
      </div>`,
      initialFocus: '#note-text',
      actions: [{ id: 'save', label: 'Add note', kind: 'primary', onClick: s => {
        const v = ui.form(s.body);
        if (!v) return false;
        const id = RB.id();
        S().addLog(tenantId, { id, kind: v.kind || 'note', text: v.text, followUp: v.followUp || null, done: false }).catch(() => {});
        saved = id;
        ui.toast('Note added', { undo: () => S().deleteLog(tenantId, id) });
      } }],
      onClose: () => resolve(saved),
    });
  });
}
/** Tick a follow-up done (Undo toast). */
function followupDone(tenantId, logId, done) {
  if (!guard()) return Promise.resolve();
  const val = done === undefined ? true : !!done;
  const p = S().updateLog(tenantId, logId, { done: val }).catch(() => {});
  ui.toast(val ? 'Follow-up done' : 'Follow-up reopened', { undo: () => S().updateLog(tenantId, logId, { done: !val }) });
  return p;
}

// ------------------------------------------------------------------ files
let downloadsP = null;
/** Start resolving the downloads capability early (boot calls this) so a click doesn't wait. */
function warmDownloads() {
  if (downloadsP) return downloadsP;
  try {
    const c = window.claude;
    downloadsP = c && typeof c.use === 'function' ? Promise.resolve(c.use('downloads')).catch(() => null) : Promise.resolve(null);
  } catch (e) { downloadsP = Promise.resolve(null); }
  return downloadsP;
}
/**
 * Offer a file to the viewer via the downloads capability (viewer confirms). Falls back to a sheet with the text
 * and a Copy button when downloads are unavailable or refused. Resolves true if saved.
 */
async function downloadFile(filename, text, mime) {
  const dl = await warmDownloads();
  if (dl && typeof dl.save === 'function') {
    try {
      await dl.save({ filename, data: text });
      ui.toast('Saved ' + filename, { icon: 'check', duration: 3000 });
      return true;
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return false;
      if (code === 'rate_limited') { ui.toast('A download is already waiting for you to confirm.'); return false; }
    }
  }
  ui.showText({ title: 'Download ' + filename, filename, text, note: 'Downloads aren’t available here — copy the text and paste it into a file named ' + filename + '.' });
  return false;
}

// ------------------------------------------------------------------ navigation & sample data
/** Open the tenant detail (Tenants view drawer) via #t-<id>. */
function openTenant(id) { if (id) location.hash = 't-' + id; }
/** Load the sample portfolio (27 tenants, 6 tickets). */
async function loadSample(opts) {
  if (!guard()) return false;
  const data = RB.sample.generate(S().today());
  const hasReal = S().tenantsList().some(t => !t.sample);
  if (hasReal) data.settings = { hasSample: true };
  try {
    await S().importAll(data);
    if (!(opts && opts.quiet)) ui.toast('Loaded ' + Object.keys(data.tenants).length + ' sample tenants', { icon: 'check' });
    return true;
  } catch (e) { return false; }
}
/** Confirm sheet naming what goes, then remove every sample tenant, ledger and ticket. */
async function removeSample() {
  if (!guard()) return false;
  const ts = S().tenantsList().filter(t => t.sample).length;
  const ks = S().ticketsList().filter(t => t.sample).length;
  if (!ts && !ks) { ui.toast('There is no sample data to remove.'); return false; }
  const ok = await ui.confirm({
    title: 'Remove sample data?',
    body: h`<p class="muted">This deletes <strong>${RB.plural(ts, 'sample tenant')}</strong>, their ledgers and notes, and <strong>${RB.plural(ks, 'sample upkeep request')}</strong>. Tenants you added yourself are kept.</p>`,
    confirmLabel: 'Remove sample data', danger: true,
  });
  if (!ok) return false;
  try { const r = await S().removeSample(); ui.toast('Removed ' + RB.plural(r.tenants, 'sample tenant')); if (/^#t-/.test(location.hash)) location.hash = 'tenants'; return true; }
  catch (e) { return false; }
}
/** Download everything as JSON. */
function backup() {
  const data = S().exportAll();
  return downloadFile('rent-book-backup-' + S().today() + '.json', JSON.stringify(data, null, 2), 'application/json');
}
/** Restore from a parsed backup object after a confirm sheet that names what will be replaced. */
async function restore(data) {
  if (!guard()) return false;
  if (!data || data.format !== 'rent-book-backup' || !data.tenants) { ui.toast('That file isn’t a Rent Book backup.', { tone: 'bad' }); return false; }
  const nNew = Object.keys(data.tenants).length, nOld = S().tenantsList().length;
  const ok = await ui.confirm({
    title: 'Restore this backup?',
    body: h`<p class="muted">Everything now in this rent book (<strong>${RB.plural(nOld, 'tenant')}</strong>, their ledgers and upkeep requests) is replaced by the backup from ${data.exportedAt ? D.fmtLong(String(data.exportedAt).slice(0, 10)) : 'the file'} with <strong>${RB.plural(nNew, 'tenant')}</strong>.</p>`,
    confirmLabel: 'Replace with backup', danger: true,
  });
  if (!ok) return false;
  try { await S().importAll(data, { replace: true }); ui.toast('Restored ' + RB.plural(nNew, 'tenant')); return true; } catch (e) { return false; }
}

// ------------------------------------------------------------------ overridable hooks (views replace these)
/** Minimal "Add tenant" sheet. The Tenants view may replace RB.actions.addTenant with its full form. Resolves id|null. */
function addTenant(preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const today = S().today();
  const props = Array.from(new Set(S().tenantsList().map(t => t.property).filter(Boolean)));
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Add tenant', size: 'wide',
      body: h`<fieldset class="fieldset"><legend class="fieldset-title">Who and where</legend><div class="form-grid">
          ${ui.field({ name: 'name', id: 'nt-name', label: 'Name', value: p.name || '', required: true, autocomplete: 'off' })}
          ${ui.field({ name: 'phone', id: 'nt-phone', label: 'Phone', type: 'tel', value: p.phone || '', optional: true })}
          ${ui.field({ name: 'property', id: 'nt-property', label: 'Property', value: p.property || props[0] || '', required: true, attrs: { list: 'nt-props' } })}
          ${ui.field({ name: 'unit', id: 'nt-unit', label: 'Unit', value: p.unit || '', required: true, placeholder: '2B' })}
          ${ui.field({ name: 'email', id: 'nt-email', label: 'Email', type: 'email', value: p.email || '', optional: true, span: 2 })}
        </div><datalist id="nt-props">${props.map(x => h`<option value="${x}"></option>`)}</datalist></fieldset>
        <fieldset class="fieldset"><legend class="fieldset-title">Lease and money</legend><div class="form-grid">
          ${ui.field({ name: 'rent', id: 'nt-rent', label: 'Monthly rent', type: 'money', value: p.rent, required: true })}
          ${ui.field({ name: 'deposit', id: 'nt-deposit', label: 'Deposit held', type: 'money', value: p.deposit, optional: true })}
          ${ui.field({ name: 'start', id: 'nt-start', label: 'Lease start', type: 'date', value: p.start || today, required: true })}
          ${ui.field({ name: 'end', id: 'nt-end', label: 'Lease end', type: 'date', value: p.end || '', hint: 'Leave empty for month-to-month' })}
          ${ui.field({ name: 'moveIn', id: 'nt-movein', label: 'Moved in', type: 'date', value: p.moveIn || '', hint: 'Defaults to lease start' })}
          ${ui.field({ name: 'opening', id: 'nt-opening', label: 'Balance owed today', type: 'money', value: p.opening, optional: true, hint: 'Carried in from before; negative for credit' })}
        </div></fieldset>`,
      actions: [{ id: 'save', label: 'Add tenant', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ end: v.end && v.start && v.end <= v.start ? 'Must be after the start' : '', rent: v.rent !== null && v.rent < 0 ? 'Rent can’t be negative' : '' }) });
        if (!v) return false;
        const moveIn = v.moveIn || v.start;
        const trackFrom = v.opening ? D.max(moveIn, today) : moveIn;
        const id = RB.id();
        S().addTenant({ id, name: v.name, phone: v.phone, email: v.email, property: v.property, unit: v.unit, status: 'active',
          lease: { start: v.start, end: v.end || null, moveIn, noticeDate: null, moveOut: null, dueDay: null, graceDays: null },
          rent: [{ from: D.min(v.start, moveIn), amount: v.rent }], trackFrom, opening: v.opening ? { amount: v.opening } : null,
          deposit: { amount: v.deposit || 0, received: v.deposit ? moveIn : null, heldAt: '', returned: null } }).catch(() => {});
        saved = id;
        ui.toast('Added ' + v.name, { action: { label: 'Open', run: () => openTenant(id) } });
      } }],
      onClose: () => resolve(saved),
    });
  });
}

RB.actions = {
  who, lastMethod, monthOptions,
  recordPayment, recordPayments, addCharge, addCredit, addLateFee,
  voidEntry, editEntry, copyReceipt, copyStatement, downloadLedgerCsv,
  addNote, followupDone, LOG_KINDS, CATEGORIES: CATS,
  warmDownloads, downloadFile,
  openTenant, loadSample, removeSample, backup, restore,
  // ---- hooks: views replace these with full implementations (assign at load time)
  addTenant,
  editTenant: id => openTenant(id),
  addTicket: () => { location.hash = 'upkeep'; RB.emit('ticket:add'); },
  openTicket: id => { location.hash = 'upkeep'; RB.emit('ticket:open', id); },
  settleDeposit: id => openTenant(id),
  renewLease: id => openTenant(id),
  /** Run an action object from RB.model.attention() items: {type, tenantId, ticketId, logId, period}. */
  run(a) {
    if (!a) return;
    const A = RB.actions;
    switch (a.type) {
      case 'recordPayment': return A.recordPayment(a.tenantId, { quick: !!a.quick, amount: a.amount });
      case 'addLateFee': return A.addLateFee(a.tenantId, a.period);
      case 'openTenant': return A.openTenant(a.tenantId);
      case 'openTicket': return A.openTicket(a.ticketId);
      case 'followupDone': return A.followupDone(a.tenantId, a.logId);
      case 'settleDeposit': return A.settleDeposit(a.tenantId);
      case 'renewLease': return A.renewLease(a.tenantId);
      case 'moveOut': return A.moveOut ? A.moveOut(a.tenantId) : A.openTenant(a.tenantId);
      default: console.warn('Unknown action', a);
    }
  },
};

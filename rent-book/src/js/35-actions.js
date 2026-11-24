// 35-actions.js — RB.actions: shared flows any view can call. Undo, not confirm (spec §5, §8 rule 8).
// Every sheet here follows SPEC §8: one column, question labels, big choices instead of dropdowns, optional fields behind
// "Add more details (optional)", a plain live sentence, and a primary button that states the action ("Record $1,385").
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date, M = RB.money, h = RB.html, ui = RB.ui;
const S = () => RB.store;

/** "Unit 2B" for short unit labels, the label itself otherwise ("No. 4"), else the tenant's name. */
function who(t) {
  if (!t) return 'tenant';
  if (t.unit) return /^[A-Za-z]?\d+[A-Za-z]?$/.test(t.unit) || /^\d?[A-Za-z]$/.test(t.unit) ? 'Unit ' + t.unit : t.unit;
  return t.name || 'tenant';
}
const first = t => String((t && t.name) || 'They').trim().split(/\s+/)[0];
function guard() {
  const st = S().state;
  if (st.readOnly) { ui.toast('View only — you can look around, but you can’t change anything here.', { tone: 'bad' }); return false; }
  if (!st.mode || !st.ready) { ui.toast('Still loading — please try again in a moment.'); return false; }
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
const tenantSub = t => [t.name, ui.place(t)].filter(Boolean).join(' — ');
const METHOD_WORDS = { Check: 'Check', Cash: 'Cash', Zelle: 'Zelle', Venmo: 'Venmo', ACH: 'Bank transfer (ACH)', 'Money order': 'Money order' };
const methodOptions = (methods, extra) => Array.from(new Set(methods.concat(extra ? [extra] : []))).map(m => ({ value: m, label: METHOD_WORDS[m] || m }));
const AMOUNT_MSG = 'Type how much they paid, like 800';

/**
 * Plain sentence for what a payment of `amount` leaves behind: "After this, Claire will be all paid up." /
 * "After this, Imogen will still owe $550 for November." / "That is $50 more than they owe — it will count toward next month."
 */
function afterSentence(t, lg, amount) {
  const owed = Math.max(0, lg.balance);
  const after = lg.balance - (amount || 0);
  if (!(amount > 0)) return '';
  if (owed > 0 && after < 0) return 'That is ' + M.fmt(-after) + ' more than they owe — it will count toward next month.';
  if (owed <= 0) return 'They don’t owe anything right now, so this will count as paid ahead (' + M.fmt(-after) + ').';
  if (after === 0) return 'After this, ' + first(t) + ' will be all paid up.';
  const cur = lg.months[D.monthKey(S().today())];
  const forMonth = cur && cur.open > 0 && after <= cur.open ? ' for ' + D.monthName(cur.period) : '';
  return 'After this, ' + first(t) + ' will still owe ' + M.fmt(after) + forMonth + '.';
}
/** Toast text after a payment: "Recorded $1,000 from Imogen Hart. Still owes $550." */
function paidToast(t, amount, balanceBefore) {
  const after = balanceBefore - amount;
  return 'Recorded ' + M.fmt(amount) + ' from ' + t.name + '.' + (after > 0 && balanceBefore > 0 ? ' Still owes ' + M.fmt(after) + '.' : after === 0 && balanceBefore > 0 ? ' All paid up.' : '');
}

// ------------------------------------------------------------------ payments
/**
 * Record a payment.
 * opts.quick: record `opts.amount` (default the full balance) today with the tenant's last-used method, then an Undo
 *             toast (no sheet). If nothing is owed, falls back to the sheet.
 * otherwise:  the payment sheet. When the tenant owes money its first question is "Did they pay all of it?" —
 *             "Yes, all $1,550" (preselected) or "Only part of it" (reveals "How much did they pay?").
 *             opts: {amount (what "all" means; default the balance), part:true (start on "Only part of it"), date, method}
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
    ui.toast(paidToast(t, amount, lg.balance), { undo: () => S().undoEntry(tenantId, id) });
    return Promise.resolve(id);
  }
  return new Promise(resolve => {
    let saved = null;
    const methods = S().settings().methods;
    const owes = open > 0;
    const full = o.amount != null && o.amount > 0 ? o.amount : open;
    const earlier = owes ? Math.max(0, full - ((lg.months[D.monthKey(today)] || {}).open || 0)) : 0;
    let part = !!o.part;
    const amountOf = el => {
      if (owes && !part) return full;
      const v = el.querySelector('#pay-amount').value.trim();
      return v ? M.parse(v) : null;
    };
    ui.sheet({
      title: 'Record a payment', sub: tenantSub(t),
      body: (el, sh) => {
        const fullSub = earlier > 0 ? 'Includes ' + M.fmt(earlier) + ' from earlier months' : 'Everything they owe right now';
        el.innerHTML = String(h`<div class="form-col pay-form">
          ${owes ? ui.field({ name: 'how', id: 'pay-how', label: 'Did they pay all of it?', type: 'choice', value: part ? 'part' : 'all',
            options: [{ value: 'all', label: 'Yes, all ' + M.fmt(full), sub: fullSub }, { value: 'part', label: 'Only part of it', sub: 'You’ll type the amount next' }] }) : ''}
          <div id="pay-amount-wrap"${owes && !part ? RB.raw(' hidden') : ''}>
            ${ui.field({ name: 'amount', id: 'pay-amount', label: 'How much did they pay?', type: 'money', big: true, value: owes ? null : (o.amount != null ? o.amount : lg.rent || null), placeholder: '',
              hint: owes ? 'They owe ' + M.fmt(full) + '. Type the amount you got, like 800.' : 'They don’t owe anything right now. Anything you record counts as paid ahead.' })}
          </div>
          ${ui.field({ name: 'date', id: 'pay-date', label: 'When did you get it?', type: 'date', value: o.date || today, required: true, hint: 'Change it if the money came earlier.' })}
          ${ui.field({ name: 'method', id: 'pay-method', label: 'How did they pay?', type: 'choice', cols: 2, value: o.method || lastMethod(tenantId), options: methodOptions(methods, o.method || lastMethod(tenantId)), hint: 'Set to the way they paid last time.' })}
          ${ui.moreDetails(h`${ui.field({ name: 'ref', id: 'pay-ref', label: 'Check number or confirmation code', placeholder: 'For example 1043', optional: true })}
            ${ui.field({ name: 'memo', id: 'pay-memo', label: 'A note for yourself', type: 'textarea', rows: 2, optional: true, placeholder: 'For example: paid in two parts' })}`, { id: 'pay-more' })}
        </div>`);
        const wrap = el.querySelector('#pay-amount-wrap');
        const upd = () => {
          const c = amountOf(el);
          sh.setNote(c > 0 ? afterSentence(t, lg, c) : '');
          sh.setAction('save', { label: c > 0 ? 'Record ' + M.fmt(c) : 'Record a payment' });
        };
        el.addEventListener('change', e => {
          if (e.target.name === 'how') {
            part = e.target.value === 'part';
            wrap.hidden = !part;
            if (part) { const a = el.querySelector('#pay-amount'); a.value = ''; requestAnimationFrame(() => a.focus()); }
            ui.showErrors(el, {}, { focus: false });
          }
          upd();
        });
        el.addEventListener('input', upd);
        requestAnimationFrame(upd);
      },
      initialFocus: owes && !part ? '[data-action="save"]' : '#pay-amount',
      actions: [{ id: 'save', label: 'Record ' + M.fmt(owes ? full : (o.amount || lg.rent || 0)), kind: 'primary', onClick: s => {
        const r = ui.readForm(s.body);
        const amount = owes && !part ? full : r.values.amount;
        if (!(amount > 0)) r.errors.amount = AMOUNT_MSG;
        if (!ui.showErrors(s.body, r.errors)) return false;
        const v = r.values;
        const id = RB.id();
        S().addEntry(tenantId, { id, type: 'payment', date: v.date, amount, method: v.method, ref: v.ref || '', memo: v.memo || '' }).catch(() => {});
        RB.prefs.set('lastMethod', v.method);
        saved = id;
        ui.toast(paidToast(t, amount, lg.balance), { undo: () => S().undoEntry(tenantId, id) });
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
  if (done.length) ui.toast('Recorded ' + RB.plural(done.length, 'payment') + ' — ' + M.fmt(total) + ' in all.', { undo: () => done.forEach(([tid, id]) => S().undoEntry(tid, id)) });
  return Promise.resolve(done.map(d => d[1]));
}

// ------------------------------------------------------------------ charges, money off, late fees
const CATS = [{ value: 'utility', label: 'A bill (water, power…)' }, { value: 'damage', label: 'Damage or repair' }, { value: 'fee', label: 'A fee' }, { value: 'late_fee', label: 'Late fee' }, { value: 'other', label: 'Something else' }];
/** Sheet: "Add a charge" (what for, how much, kind; date + month behind "more details"). preset: {amount, category, memo, period, date}. Resolves entry id|null. */
function addCharge(tenantId, preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  const today = S().today();
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Add a charge', sub: tenantSub(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-col">
          ${ui.field({ name: 'memo', id: 'chg-memo', label: 'What is it for?', value: p.memo || '', placeholder: 'For example: water bill, new key', required: true, requiredMsg: 'Write what the charge is for' })}
          ${ui.field({ name: 'amount', id: 'chg-amount', label: 'How much?', type: 'money', big: true, value: p.amount, required: true, requiredMsg: 'Type the amount, like 40', placeholder: '' })}
          ${ui.field({ name: 'category', id: 'chg-category', label: 'What kind of charge?', type: 'choice', cols: 2, value: p.category || 'utility', options: CATS })}
          ${ui.moreDetails(h`${ui.field({ name: 'date', id: 'chg-date', label: 'Date of the charge', type: 'date', value: p.date || today, required: true })}
            ${ui.field({ name: 'period', id: 'chg-period', label: 'Which month is it for?', type: 'select', value: p.period || D.monthKey(today), options: monthOptions(today, 12, 1, p.period) })}`)}
        </div>`);
        const upd = () => { const c = M.parse(el.querySelector('#chg-amount').value); sh.setAction('save', { label: c > 0 ? 'Add ' + M.fmt(c) + ' charge' : 'Add charge' }); sh.setNote(c > 0 ? 'After this, ' + first(t) + ' will owe ' + M.fmt(Math.max(0, S().ledger(tenantId).balance + c)) + '.' : ''); };
        el.addEventListener('input', upd); requestAnimationFrame(upd);
      },
      actions: [{ id: 'save', label: 'Add charge', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Type an amount above zero' : '' }) });
        if (!v) return false;
        const id = RB.id();
        S().addEntry(tenantId, { id, type: 'charge', date: v.date, amount: v.amount, category: v.category, period: v.period, memo: v.memo }).catch(() => {});
        saved = id;
        ui.toast('Added a ' + M.fmt(v.amount) + ' charge for ' + t.name + '.', { undo: () => S().undoEntry(tenantId, id) });
      } }],
      onClose: () => resolve(saved),
    });
  });
}
/** Sheet: "Take money off what they owe" (reason, amount, date behind "more details"). Stored as a credit entry. Resolves entry id|null. */
function addCredit(tenantId, preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  const today = S().today();
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Take money off what they owe', sub: tenantSub(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-col">
          ${ui.field({ name: 'memo', id: 'cr-memo', label: 'Why are you taking money off?', value: p.memo || '', placeholder: 'For example: they paid for a repair themselves', required: true, requiredMsg: 'Write the reason, so you remember later' })}
          ${ui.field({ name: 'amount', id: 'cr-amount', label: 'How much?', type: 'money', big: true, value: p.amount, required: true, requiredMsg: 'Type the amount, like 75', placeholder: '' })}
          ${ui.moreDetails(ui.field({ name: 'date', id: 'cr-date', label: 'Date', type: 'date', value: p.date || today, required: true }))}
        </div>`);
        const upd = () => { const c = M.parse(el.querySelector('#cr-amount').value); sh.setAction('save', { label: c > 0 ? 'Take ' + M.fmt(c) + ' off' : 'Take it off' }); sh.setNote(c > 0 ? afterSentence(t, S().ledger(tenantId), c).replace('more than they owe — it will count toward next month', 'more than they owe — it will count as paid ahead') : ''); };
        el.addEventListener('input', upd); requestAnimationFrame(upd);
      },
      actions: [{ id: 'save', label: 'Take it off', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Type an amount above zero' : '' }) });
        if (!v) return false;
        const id = RB.id();
        S().addEntry(tenantId, { id, type: 'credit', date: v.date, amount: v.amount, memo: v.memo }).catch(() => {});
        saved = id;
        ui.toast('Took ' + M.fmt(v.amount) + ' off what ' + t.name + ' owes.', { undo: () => S().undoEntry(tenantId, id) });
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
  if (!amount) { ui.toast('No late fee is set up yet. You can choose one in Settings.'); return Promise.resolve(null); }
  const id = RB.id();
  S().addEntry(tenantId, { id, type: 'charge', category: 'late_fee', period: k, date: S().today(), amount, memo: 'Late fee — ' + D.monthName(k) }).catch(() => {});
  ui.toast('Added a ' + M.fmt(amount) + ' late fee for ' + t.name + ' (' + D.monthName(k) + ').', { undo: () => S().undoEntry(tenantId, id) });
  return Promise.resolve(id);
}

// ------------------------------------------------------------------ entries
function entryOf(tenantId, entryId) { const e = S().entries(tenantId)[entryId]; return e ? Object.assign({ id: entryId }, e) : null; }
const kindWord = e => (e.type === 'payment' ? 'payment' : e.type === 'credit' ? 'money off' : (e.category === 'late_fee' ? 'late fee' : 'charge'));
/** Remove an entry (it was a mistake). Kept in the history struck through; Undo puts it back. */
function voidEntry(tenantId, entryId) {
  if (!guard()) return Promise.resolve();
  const e = entryOf(tenantId, entryId); if (!e) return Promise.resolve();
  const t = S().tenant(tenantId);
  const p = S().voidEntry(tenantId, entryId).catch(() => {});
  ui.toast('Removed the ' + M.fmt(e.amount) + ' ' + kindWord(e) + (t ? ' for ' + t.name : '') + '.', { undo: () => S().unvoidEntry(tenantId, entryId) });
  return p;
}
/** Sheet: fix an entry's amount/date/method/reference/note (kind + month for charges). */
function editEntry(tenantId, entryId) {
  if (!guard()) return Promise.resolve(false);
  const t = S().tenant(tenantId); const e = entryOf(tenantId, entryId);
  if (!t || !e) return Promise.resolve(false);
  const today = S().today();
  const word = kindWord(e);
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: 'Change this ' + word, sub: tenantSub(t),
      body: h`<div class="form-col">
        ${e.type !== 'payment' ? ui.field({ name: 'memo', id: 'ed-memo', label: e.type === 'credit' ? 'Why was money taken off?' : 'What is it for?', value: e.memo || '', required: true }) : ''}
        ${ui.field({ name: 'amount', id: 'ed-amount', label: 'How much?', type: 'money', big: true, value: e.amount, required: true })}
        ${ui.field({ name: 'date', id: 'ed-date', label: e.type === 'payment' ? 'When did you get it?' : 'Date', type: 'date', value: e.date, required: true })}
        ${e.type === 'payment' ? h`${ui.field({ name: 'method', id: 'ed-method', label: 'How did they pay?', type: 'choice', cols: 3, value: e.method, options: methodOptions(S().settings().methods, e.method) })}
          ${ui.moreDetails(h`${ui.field({ name: 'ref', id: 'ed-ref', label: 'Check number or confirmation code', value: e.ref || '', optional: true })}${ui.field({ name: 'memo', id: 'ed-memo', label: 'A note for yourself', value: e.memo || '', optional: true })}`, { open: !!(e.ref || e.memo) })}` : ''}
        ${e.type === 'charge' ? h`${ui.field({ name: 'category', id: 'ed-category', label: 'What kind of charge?', type: 'choice', cols: 2, value: e.category || 'other', options: CATS })}
          ${ui.field({ name: 'period', id: 'ed-period', label: 'Which month is it for?', type: 'select', value: e.period || D.monthKey(e.date), options: monthOptions(today, 24, 1, e.period) })}` : ''}
      </div>`,
      actions: [{ id: 'save', label: 'Save changes', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ amount: v.amount !== null && v.amount <= 0 ? 'Type an amount above zero' : '' }) });
        if (!v) return false;
        const before = { amount: e.amount, date: e.date, method: e.method || '', ref: e.ref || '', memo: e.memo || '', category: e.category || null, period: e.period || null };
        S().updateEntry(tenantId, entryId, v).catch(() => {});
        ok = true;
        ui.toast('Saved your changes to the ' + word + '.', { undo: () => S().updateEntry(tenantId, entryId, before) });
      } }],
      onClose: () => resolve(ok),
    });
  });
}
/** Lines that say a payment only covered part of a month: "Part payment received: $800." / "Still owed for November: $675." */
function partLines(lg, row) {
  if (!row || row.type !== 'payment' || !row.applied) return [];
  const byId = {}; lg.rows.forEach(r => { byId[r.id] = r; });
  const periods = Array.from(new Set(row.applied.map(a => byId[a.id]).filter(c => c && (c.kind === 'rent' || c.kind === 'recurring')).map(c => c.period)));
  const k = periods.find(p => lg.months[p] && lg.months[p].rentOpen > 0);
  if (!k) return [];
  return ['Part payment received: ' + M.fmt(row.amount) + '.', 'Still owed for ' + D.monthName(k) + ': ' + M.fmt(lg.months[k].rentOpen) + '.'];
}
/** Copy a plain-text receipt for an entry to the clipboard (says so when it was a part payment). Call from a click handler. */
function copyReceipt(tenantId, entryId) {
  const t = S().tenant(tenantId); const lg = S().ledger(tenantId);
  if (!t || !lg) return Promise.resolve(false);
  let text = RB.model.receiptText({ tenant: t, ledger: lg, entryId, settings: S().settings() });
  const extra = partLines(lg, lg.rows.find(r => r.id === entryId));
  if (extra.length) { const lines = text.split('\n'); const i = lines.findIndex(l => /^Amount:/.test(l)); lines.splice(i >= 0 ? i + 1 : lines.length, 0, ...extra); text = lines.join('\n'); }
  return ui.copy(text, 'receipt');
}
/** Copy a plain-text statement (opts.from/to 'YYYY-MM-DD'); part-paid months are spelled out at the end. */
function copyStatement(tenantId, opts) {
  const t = S().tenant(tenantId); const lg = S().ledger(tenantId);
  if (!t || !lg) return Promise.resolve(false);
  let text = RB.model.statementText(Object.assign({ tenant: t, ledger: lg, settings: S().settings() }, opts || {}));
  const o = opts || {};
  const parts = Object.values(lg.months).filter(m => m.scheduled && m.rentPaid > 0 && m.rentOpen > 0 && (!o.from || m.period >= o.from.slice(0, 7)) && (!o.to || m.period <= o.to.slice(0, 7)))
    .map(m => D.fmtMonth(m.period) + ': part payment received ' + M.fmt(m.rentPaid) + '. Still owed: ' + M.fmt(m.rentOpen) + '.');
  if (parts.length) text += '\n\n' + parts.join('\n');
  return ui.copy(text, 'statement');
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
/** Download the tenant's payment history for Excel (CSV). */
function downloadLedgerCsv(tenantId) {
  const t = S().tenant(tenantId); const lg = S().ledger(tenantId);
  if (!t || !lg) return Promise.resolve(false);
  return downloadFile('payment-history-' + slug(t.unit + ' ' + t.name) + '-' + S().today() + '.csv', RB.model.ledgerCsv(lg), 'text/csv');
}

// ------------------------------------------------------------------ notes
const LOG_KINDS = [{ value: 'note', label: 'Note' }, { value: 'call', label: 'Phone call' }, { value: 'text', label: 'Text message' }, { value: 'email', label: 'Email' }, { value: 'visit', label: 'Visit' }, { value: 'notice', label: 'Notice' }];
/** Sheet: write a note (what kind, what happened, optional reminder date). Undo toast. Resolves log id|null. */
function addNote(tenantId, preset) {
  const p = preset || {};
  if (!guard()) return Promise.resolve(null);
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(null);
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Write a note', sub: tenantSub(t),
      body: h`<div class="form-col">
        ${ui.field({ name: 'text', id: 'note-text', label: 'What happened?', type: 'textarea', value: p.text || '', required: true, requiredMsg: 'Write a few words about what happened', rows: 4, placeholder: 'For example: called about the late rent, will pay Friday' })}
        ${ui.field({ name: 'kind', id: 'note-kind', label: 'What kind of note is it?', type: 'choice', cols: 3, value: p.kind || 'note', options: LOG_KINDS })}
        ${ui.field({ name: 'followUp', id: 'note-followup', label: 'Remind me on', type: 'date', value: p.followUp || '', optional: true, hint: 'It will show on Today on that date.' })}
      </div>`,
      initialFocus: '#note-text',
      actions: [{ id: 'save', label: 'Save note', kind: 'primary', onClick: s => {
        const v = ui.form(s.body);
        if (!v) return false;
        const id = RB.id();
        S().addLog(tenantId, { id, kind: v.kind || 'note', text: v.text, followUp: v.followUp || null, done: false }).catch(() => {});
        saved = id;
        ui.toast('Saved your note for ' + t.name + '.', { undo: () => S().deleteLog(tenantId, id) });
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
  ui.toast(val ? 'Marked the reminder done.' : 'Marked the reminder not done.', { undo: () => S().updateLog(tenantId, logId, { done: !val }) });
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
      ui.toast('Saved the file ' + filename + '.', { icon: 'check', duration: 5000 });
      return true;
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return false;
      if (code === 'rate_limited') { ui.toast('A file is already waiting for you to say yes to it.'); return false; }
    }
  }
  ui.showText({ title: 'Save ' + filename, filename, text, note: 'Saving files isn’t available here. Press Copy, then paste the text into a new file named ' + filename + '.' });
  return false;
}

// ------------------------------------------------------------------ navigation & sample data
/** Open the tenant page (Tenants view drawer) via #t-<id>. */
function openTenant(id) { if (id) location.hash = 't-' + id; }
/** Load the sample tenants (27 tenants, sample repairs). */
async function loadSample(opts) {
  if (!guard()) return false;
  const data = RB.sample.generate(S().today());
  const hasReal = S().tenantsList().some(t => !t.sample);
  if (hasReal) data.settings = { hasSample: true };
  try {
    await S().importAll(data);
    if (!(opts && opts.quiet)) ui.toast('Loaded ' + Object.keys(data.tenants).length + ' sample tenants. Look around — nothing here is real.', { icon: 'check' });
    return true;
  } catch (e) { return false; }
}
/** Confirm sheet naming what goes, then remove every sample tenant, payment history and repair. */
async function removeSample() {
  if (!guard()) return false;
  const ts = S().tenantsList().filter(t => t.sample).length;
  const ks = S().ticketsList().filter(t => t.sample).length;
  if (!ts && !ks) { ui.toast('There are no sample tenants to remove.'); return false; }
  const ok = await ui.confirm({
    title: 'Remove the sample tenants?',
    body: h`<p class="say">This removes the <strong>${RB.plural(ts, 'sample tenant')}</strong>, their payment history and notes, and <strong>${RB.plural(ks, 'sample repair')}</strong>. Tenants you added yourself stay.</p>`,
    confirmLabel: 'Remove sample tenants', danger: true,
  });
  if (!ok) return false;
  try { const r = await S().removeSample(); ui.toast('Removed ' + RB.plural(r.tenants, 'sample tenant') + '.'); if (/^#t-/.test(location.hash)) location.hash = 'tenants'; return true; }
  catch (e) { return false; }
}
/** Save a copy of everything (JSON file). */
function backup() {
  const data = S().exportAll();
  return downloadFile('rent-book-copy-' + S().today() + '.json', JSON.stringify(data, null, 2), 'application/json');
}
/** Restore from a saved copy after a confirm sheet that says what will be replaced. */
async function restore(data) {
  if (!guard()) return false;
  if (!data || data.format !== 'rent-book-backup' || !data.tenants) { ui.toast('That file isn’t a Rent Book copy. Choose the file you saved from Rent Book.', { tone: 'bad' }); return false; }
  const nNew = Object.keys(data.tenants).length, nOld = S().tenantsList().length;
  const ok = await ui.confirm({
    title: 'Restore from this copy?',
    body: h`<p class="say">Everything in your rent book now (<strong>${RB.plural(nOld, 'tenant')}</strong>, their payment history and repairs) will be replaced by the copy from ${data.exportedAt ? D.fmtLong(String(data.exportedAt).slice(0, 10)) : 'the file'}, which has <strong>${RB.plural(nNew, 'tenant')}</strong>.</p>`,
    confirmLabel: 'Replace with the copy', danger: true,
  });
  if (!ok) return false;
  try { await S().importAll(data, { replace: true }); ui.toast('Restored ' + RB.plural(nNew, 'tenant') + ' from your copy.'); return true; } catch (e) { return false; }
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
      title: 'Add a tenant', size: 'wide',
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
          ${ui.field({ name: 'opening', id: 'nt-opening', label: 'What they already owed', type: 'money', value: p.opening, optional: true, hint: 'Carried in from before; negative for credit' })}
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
        ui.toast('Added ' + v.name + '.', { action: { label: 'See their page', run: () => openTenant(id) } });
      } }],
      onClose: () => resolve(saved),
    });
  });
}


RB.actions = {
  who, lastMethod, monthOptions, afterSentence,
  recordPayment, recordPayments, addCharge, addCredit, addLateFee,
  voidEntry, removeEntry: voidEntry, editEntry, copyReceipt, copyStatement, downloadLedgerCsv,
  addNote, followupDone, LOG_KINDS, CATEGORIES: CATS,
  warmDownloads, downloadFile,
  openTenant, loadSample, removeSample, backup, restore,
  // ---- hooks: views replace these with full implementations (assign at load time)
  addTenant,
  editTenant: id => openTenant(id),
  addTicket: () => { location.hash = 'repairs'; RB.emit('ticket:add'); },
  openTicket: id => { location.hash = 'repairs'; RB.emit('ticket:open', id); },
  settleDeposit: id => openTenant(id),
  renewLease: id => openTenant(id),
  /** Run an action object from RB.model.attention() items: {type, tenantId, ticketId, logId, period}. */
  run(a) {
    if (!a) return;
    const A = RB.actions;
    switch (a.type) {
      case 'recordPayment': return A.recordPayment(a.tenantId, { quick: !!a.quick, amount: a.amount, part: !!a.part });
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

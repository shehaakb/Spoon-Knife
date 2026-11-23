// 10-model.js — PURE functions: no DOM, no store, no clock (today is always passed in).
// Loadable in node: run 00-util.js then this file in the same global (see test/model.test.mjs).
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date, M = RB.money;

const DEFAULT_SETTINGS = Object.freeze({
  portfolioName: '',
  currency: 'USD',
  dueDay: 1,
  graceDays: 5,
  lateFee: Object.freeze({ type: 'flat', amount: 5000 }),
  depositReturnDays: 30,
  leaseNoticeDays: 60,
  methods: Object.freeze(['Check', 'Cash', 'Zelle', 'Venmo', 'ACH', 'Money order']),
  hasSample: false,
});

const STATUSES = ['paid', 'paid_late', 'partial', 'due', 'late', 'none'];
const STATUS_LABEL = { paid: 'Paid', paid_late: 'Paid late', partial: 'Partial', due: 'Due', late: 'Late', none: 'No charge' };
const CATEGORY_LABEL = { late_fee: 'Late fee', utility: 'Utility', damage: 'Damage', fee: 'Fee', other: 'Other' };
const TYPE_ORDER = { opening: 0, charge: 1, credit: 2, payment: 3 };

function settingsWithDefaults(s) {
  const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
  out.lateFee = Object.assign({}, DEFAULT_SETTINGS.lateFee, (s && s.lateFee) || {});
  out.methods = (s && Array.isArray(s.methods) && s.methods.length ? s.methods : DEFAULT_SETTINGS.methods).slice();
  return out;
}

function termsOf(tenant, settings) {
  const lease = (tenant && tenant.lease) || {};
  const s = settings || DEFAULT_SETTINGS;
  const dueDay = lease.dueDay != null && lease.dueDay !== '' ? +lease.dueDay : (s.dueDay != null ? +s.dueDay : 1);
  const graceDays = lease.graceDays != null && lease.graceDays !== '' ? +lease.graceDays : (s.graceDays != null ? +s.graceDays : 0);
  return { dueDay: Math.min(31, Math.max(1, dueDay || 1)), graceDays: Math.max(0, graceDays || 0) };
}

/** Rent amount (cents) in force on `date` from tenant.rent schedule. Before the first row → first row's amount; no rows → 0. */
function rentOn(tenant, date) {
  const rows = ((tenant && tenant.rent) || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  if (!rows.length) return 0;
  let amt = rows[0].amount || 0;
  for (const r of rows) { if (r.from <= date) amt = r.amount || 0; else break; }
  return amt;
}

function entryList(entries) {
  if (!entries) return [];
  if (Array.isArray(entries)) return entries.filter(Boolean);
  if (entries.entries && RB.isObj(entries.entries)) entries = entries.entries; // accept a ledger doc too
  return Object.keys(entries).map(id => (entries[id] ? Object.assign({ id }, entries[id], { id: entries[id].id || id }) : null)).filter(Boolean);
}

function trackStart(tenant) {
  const l = (tenant && tenant.lease) || {};
  return tenant.trackFrom || l.moveIn || l.start || null;
}

/**
 * Derive the full ledger. See docs/CONTRACT.md "buildLedger output" for the exact shape.
 * @param tenant   tenant doc
 * @param entries  ledger entries map {id: entry} (or a ledger doc {entries}, or an array)
 * @param settings settings doc (defaults filled in)
 * @param today    'YYYY-MM-DD'
 */
function buildLedger(tenant, entries, settings, today) {
  settings = settingsWithDefaults(settings);
  const { dueDay, graceDays } = termsOf(tenant, settings);
  const lease = tenant.lease || {};
  const trackFrom = trackStart(tenant);
  const moveIn = lease.moveIn || null;
  const moveOut = lease.moveOut || null;
  const rows = [];
  const todayKey = D.monthKey(today);

  // ---- 1. generated charges (rent + recurring), one set per month
  if (trackFrom && D.isDate(trackFrom)) {
    const firstKey = D.monthKey(trackFrom);
    let lastKey = todayKey;
    if (moveOut && D.monthKey(moveOut) < lastKey) lastKey = D.monthKey(moveOut);
    const prorateFirst = !!moveIn && trackFrom === moveIn && D.parts(trackFrom).d !== 1;
    for (let k = firstKey; k <= lastKey; k = D.addMonthKey(k, 1)) {
      const mStart = D.monthStart(k), mEnd = D.monthEnd(k), ofDays = D.daysInMonth(k);
      let due = D.dayIn(k, dueDay);
      let from = mStart, to = mEnd;
      if (k === firstKey) {
        if (prorateFirst) { from = trackFrom; if (due < trackFrom) due = trackFrom; }
        else if (trackFrom > due) continue; // rent due before tracking began is part of `opening`
      }
      if (moveOut && moveOut < to) to = moveOut;
      if (to < from) continue;
      const days = D.diffDays(from, to) + 1;
      const prorated = days !== ofDays;
      const ratio = days / ofDays;
      const fullRent = rentOn(tenant, due);
      const rentAmt = prorated ? Math.round(fullRent * ratio) : fullRent;
      const name = D.monthName(k);
      rows.push({
        id: 'rent-' + k, kind: 'rent', type: 'charge', generated: true, date: due, period: k, amount: rentAmt,
        label: 'Rent — ' + name + (k.slice(0, 4) !== todayKey.slice(0, 4) ? ' ' + k.slice(0, 4) : ''),
        prorate: prorated ? { days, ofDays, full: fullRent, from, to } : null,
      });
      for (const rc of tenant.recurring || []) {
        if (!rc || !rc.amount) continue;
        if (rc.from && rc.from > mEnd) continue;
        if (rc.to && rc.to < mStart) continue;
        rows.push({
          id: 'rec-' + (rc.id || rc.label) + '-' + k, kind: 'recurring', type: 'charge', generated: true, date: due, period: k,
          amount: prorated ? Math.round(rc.amount * ratio) : rc.amount, label: rc.label || 'Recurring charge', recurringId: rc.id || null,
          prorate: prorated ? { days, ofDays, full: rc.amount, from, to } : null,
        });
      }
    }
  }

  // ---- 2. opening balance
  const open0 = tenant.opening && +tenant.opening.amount;
  if (open0) {
    rows.push({
      id: 'opening', kind: 'opening', type: open0 > 0 ? 'charge' : 'credit', generated: true,
      date: trackFrom || today, period: trackFrom ? D.monthKey(trackFrom) : todayKey, amount: Math.abs(open0), label: 'Balance brought forward',
    });
  }

  // ---- 3. stored entries
  for (const e of entryList(entries)) {
    if (e.undone) continue; // undone = removed via Undo; never shown
    if (!D.isDate(e.date) || !(e.type === 'payment' || e.type === 'charge' || e.type === 'credit')) continue;
    const amount = Math.abs(Math.round(+e.amount || 0));
    let label;
    if (e.type === 'payment') label = 'Payment' + (e.method ? ' · ' + e.method : '');
    else if (e.type === 'credit') label = e.memo || 'Credit';
    else label = e.memo || (CATEGORY_LABEL[e.category] || 'Charge') + (e.period ? ' — ' + D.monthName(e.period) : '');
    rows.push({
      id: e.id, kind: 'entry', type: e.type, entry: e, date: e.date,
      period: e.type === 'charge' ? (D.isMonth(e.period) ? e.period : D.monthKey(e.date)) : D.monthKey(e.date),
      amount, label, method: e.method || null, ref: e.ref || null, memo: e.memo || null, category: e.category || null,
      void: !!e.void, createdAt: e.createdAt || '',
    });
  }

  // ---- 4. sort: date, then opening < charge < credit < payment, then createdAt, then id
  const ord = r => (r.kind === 'opening' ? 0 : TYPE_ORDER[r.type]);
  const kindOrd = r => (r.kind === 'rent' ? 0 : r.kind === 'recurring' ? 1 : 2);
  rows.sort((a, b) => D.cmp(a.date, b.date) || ord(a) - ord(b) || kindOrd(a) - kindOrd(b) ||
    D.cmp(a.createdAt || '', b.createdAt || '') || D.cmp(a.id, b.id));

  // ---- 5. running balance + FIFO allocation
  let bal = 0;
  const queue = [];   // open charges, oldest first
  const pool = [];    // unapplied money [{amount, date, rowId}]
  const applyPool = ch => {
    while (ch.open > 0 && pool.length) {
      const f = pool[0];
      const take = Math.min(f.amount, ch.open);
      ch.open -= take; ch.paid += take; f.amount -= take;
      ch.paidOn = D.max(ch.paidOn, f.date);
      f.row.applied.push({ id: ch.id, amount: take });
      if (f.amount === 0) pool.shift();
    }
    if (ch.open === 0) { const i = queue.indexOf(ch); if (i >= 0) queue.splice(i, 1); }
  };
  for (const r of rows) {
    if (r.void) { r.balance = bal; continue; }
    if (r.type === 'charge') {
      bal += r.amount;
      r.paid = 0; r.open = r.amount; r.paidOn = r.amount === 0 ? r.date : null;
      if (r.amount > 0) { queue.push(r); applyPool(r); if (r.open > 0) r.paidOn = null; }
    } else {
      bal -= r.amount;
      r.applied = [];
      let left = r.amount;
      while (left > 0 && queue.length) {
        const ch = queue[0];
        const take = Math.min(left, ch.open);
        ch.open -= take; ch.paid += take; left -= take;
        r.applied.push({ id: ch.id, amount: take });
        if (ch.open === 0) { ch.paidOn = r.date; queue.shift(); }
      }
      r.unapplied = left;
      if (left > 0) pool.push({ amount: left, date: r.date, row: r });
    }
    r.balance = bal;
  }

  // ---- 6. month summaries
  const months = {};
  for (const r of rows) {
    if (r.void || r.type !== 'charge' || r.kind === 'opening') continue;
    const m = months[r.period] || (months[r.period] = {
      period: r.period, charged: 0, paid: 0, open: 0, rentCharged: 0, rentPaid: 0, rentOpen: 0, rent: 0,
      due: null, graceEnd: null, status: 'none', paidOn: null, daysLate: 0, scheduled: false, lateFee: false, prorate: null,
    });
    m.charged += r.amount; m.paid += r.paid; m.open += r.open;
    if (r.kind === 'rent' || r.kind === 'recurring') {
      m.scheduled = true;
      m.rentCharged += r.amount; m.rentPaid += r.paid; m.rentOpen += r.open;
      if (r.kind === 'rent') { m.rent = r.amount; m.prorate = r.prorate; }
      m.due = D.min(m.due, r.date);
      if (r.open === 0) m.paidOn = D.max(m.paidOn, r.paidOn);
    }
    if (r.category === 'late_fee') m.lateFee = true;
  }
  for (const k of Object.keys(months)) {
    const m = months[k];
    if (!m.scheduled) { m.status = 'none'; continue; }
    m.graceEnd = D.addDays(m.due, graceDays);
    if (m.rentOpen === 0) {
      if (!m.paidOn || m.paidOn <= m.graceEnd) { m.status = 'paid'; m.daysLate = 0; }
      else { m.status = 'paid_late'; m.daysLate = D.diffDays(m.due, m.paidOn); }
      m.paidOn = m.paidOn || m.due;
    } else {
      m.paidOn = null;
      if (today > m.graceEnd) { m.status = 'late'; m.daysLate = D.diffDays(m.due, today); }
      else { m.status = m.rentPaid > 0 ? 'partial' : 'due'; m.daysLate = 0; }
    }
  }

  // ---- 7. aging, delinquency, current, last payment, late-fee suggestion
  const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  let oldestOpenDate = null;
  for (const r of rows) {
    if (r.void || r.type !== 'charge' || !r.open) continue;
    const age = D.diffDays(r.date, today);
    if (age <= 30) aging.d0_30 += r.open; else if (age <= 60) aging.d31_60 += r.open; else if (age <= 90) aging.d61_90 += r.open; else aging.d90 += r.open;
    oldestOpenDate = D.min(oldestOpenDate, r.date);
  }
  const delinquent = !!oldestOpenDate && D.diffDays(oldestOpenDate, today) > 30;

  const cm = months[todayKey];
  const current = cm && cm.scheduled
    ? { period: todayKey, status: cm.status, due: cm.due, graceEnd: cm.graceEnd, charged: cm.rentCharged, paid: cm.rentPaid, open: cm.rentOpen, daysLate: cm.daysLate, paidOn: cm.paidOn }
    : { period: todayKey, status: 'none', due: null, graceEnd: null, charged: 0, paid: 0, open: 0, daysLate: 0, paidOn: null };

  let lastPayment = null;
  for (const r of rows) if (!r.void && r.type === 'payment' && (!lastPayment || r.date >= lastPayment.date)) lastPayment = { date: r.date, amount: r.amount, method: r.method, id: r.id };

  let suggestedLateFee = null;
  if (settings.lateFee && settings.lateFee.type !== 'none' && +settings.lateFee.amount > 0) {
    const feePeriods = new Set(rows.filter(r => !r.void && r.type === 'charge' && r.category === 'late_fee' && r.entry && r.entry.period).map(r => r.entry.period));
    const lateKeys = Object.keys(months).filter(k => months[k].status === 'late' && !feePeriods.has(k)).sort();
    if (lateKeys.length) {
      const k = lateKeys[lateKeys.length - 1];
      suggestedLateFee = { period: k, amount: lateFeeAmount(tenant, settings, k) };
    }
  }

  const credit = bal < 0 ? -bal : 0;
  return {
    tenantId: tenant.id || null,
    rows, balance: bal, credit, months, current, aging, oldestOpenDate, delinquent, lastPayment, suggestedLateFee,
    dueDay, graceDays, trackFrom, rent: rentOn(tenant, today), today,
  };
}

/** Late fee (cents) for a period under settings.lateFee: flat = amount cents; percent = amount% of that month's rent. */
function lateFeeAmount(tenant, settings, period) {
  settings = settingsWithDefaults(settings);
  const lf = settings.lateFee || {};
  if (lf.type === 'flat') return Math.round(+lf.amount || 0);
  if (lf.type === 'percent') {
    const { dueDay } = termsOf(tenant, settings);
    return Math.round(rentOn(tenant, D.dayIn(period, dueDay)) * (+lf.amount || 0) / 100);
  }
  return 0;
}

/**
 * Last n months ending at endKey (oldest → newest), filling gaps with status 'none'.
 * Each cell: {period, status, charged, paid, open, paidOn, daysLate, due}
 */
function monthsBack(ledger, endKey, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = D.addMonthKey(endKey, -i);
    const m = ledger && ledger.months[k];
    out.push(m && m.scheduled
      ? { period: k, status: m.status, charged: m.charged, paid: m.paid, open: m.open, paidOn: m.paidOn, daysLate: m.daysLate, due: m.due }
      : { period: k, status: 'none', charged: m ? m.charged : 0, paid: m ? m.paid : 0, open: m ? m.open : 0, paidOn: null, daysLate: 0, due: null });
  }
  return out;
}

/** Status of one month ('none' when not tracked). */
function monthStatus(ledger, key) { const m = ledger && ledger.months[key]; return m && m.scheduled ? m.status : 'none'; }

/**
 * Lease position. kind: 'fixed' (has an end date in the future or today), 'mtm' (no end, or end passed while still
 * living there = holdover), 'ended' (status past, or moved out on/before today), 'upcoming' (moveIn after today).
 */
function leaseState(tenant, settings, today) {
  settings = settingsWithDefaults(settings);
  const l = tenant.lease || {};
  const out = {
    kind: 'fixed', start: l.start || null, end: l.end || null, moveIn: l.moveIn || null, moveOut: l.moveOut || null,
    noticeDate: l.noticeDate || null, noticeGiven: !!l.noticeDate, daysLeft: null, inNoticeWindow: false, progress: null,
    holdover: false, label: '', daysToMoveOut: null,
  };
  if (l.moveOut) out.daysToMoveOut = D.diffDays(today, l.moveOut);
  if (tenant.status === 'past' || (l.moveOut && l.moveOut < today)) { out.kind = 'ended'; out.label = 'ended'; return out; }
  if (l.moveIn && l.moveIn > today) { out.kind = 'upcoming'; out.label = 'moves in ' + D.rel(l.moveIn, today); }
  if (!l.end) {
    if (out.kind !== 'upcoming') { out.kind = 'mtm'; out.label = 'month-to-month'; }
  } else if (l.end < today) {
    out.kind = 'mtm'; out.holdover = true; out.label = 'month-to-month';
    out.daysLeft = D.diffDays(today, l.end);
  } else {
    out.daysLeft = D.diffDays(today, l.end);
    out.inNoticeWindow = out.daysLeft <= settings.leaseNoticeDays;
    if (out.kind !== 'upcoming') out.label = out.daysLeft === 0 ? 'ends today' : 'in ' + out.daysLeft + ' d';
    if (l.start && l.end > l.start) out.progress = Math.max(0, Math.min(1, D.diffDays(l.start, today) / D.diffDays(l.start, l.end)));
  }
  if (out.noticeGiven && l.moveOut) out.label = 'moving out ' + D.rel(l.moveOut, today);
  return out;
}

/** Deposit to return after move-out, or null. {amount, moveOut, dueDate, daysLeft, overdue} */
function depositDue(tenant, settings, today) {
  settings = settingsWithDefaults(settings);
  const l = tenant.lease || {}, dep = tenant.deposit;
  if (!l.moveOut || !dep || !(+dep.amount > 0) || dep.returned) return null;
  if (l.moveOut > today && tenant.status !== 'past') return null;
  const dueDate = D.addDays(l.moveOut, +settings.depositReturnDays || 0);
  const daysLeft = D.diffDays(today, dueDate);
  return { amount: +dep.amount, moveOut: l.moveOut, dueDate, daysLeft, overdue: daysLeft < 0 };
}

function tenantsArr(state) {
  const t = state.tenants || {};
  return Array.isArray(t) ? t.slice() : Object.keys(t).map(id => (t[id] ? Object.assign({ id }, t[id], { id: t[id].id || id }) : null)).filter(Boolean);
}
function ticketsArr(state) {
  const t = state.tickets || {};
  return Array.isArray(t) ? t.slice() : Object.keys(t).map(id => (t[id] ? Object.assign({ id }, t[id], { id: t[id].id || id }) : null)).filter(Boolean);
}
function ledgerGetter(state, today, getLedger) {
  if (getLedger) return getLedger;
  const cache = {};
  const settings = settingsWithDefaults(state.settings);
  return id => {
    if (cache[id]) return cache[id];
    const t = (state.tenants || {})[id] || tenantsArr(state).find(x => x.id === id);
    const lg = (state.ledgers || {})[id];
    return (cache[id] = buildLedger(Object.assign({ id }, t), lg ? lg.entries || lg : {}, settings, today));
  };
}
const unitLabel = t => [t.property, t.unit].filter(Boolean).join(' ');
const sortTenants = list => list.sort((a, b) => RB.natCmp(a.property, b.property) || RB.natCmp(a.unit, b.unit) || RB.natCmp(a.name, b.name));
const isCurrent = t => t.status !== 'past';

/**
 * Prioritised "needs attention" items for the Today view.
 * Item: {id, kind, severity:'high'|'medium'|'low', rank, tenantId?, ticketId?, logId?, title, detail, amount?, date?,
 *        action:{type, label, ...args}, secondary?:{type, label, ...args}}
 * kinds: delinquent, late, partial, ticket, lease, moveout, movein, deposit, followup, insurance
 * action.type: recordPayment {tenantId} | addLateFee {tenantId, period} | openTenant {tenantId} | openTicket {ticketId}
 *              | followupDone {tenantId, logId} | settleDeposit {tenantId} | renewLease {tenantId}
 */
function attention(state, today, getLedger) {
  const settings = settingsWithDefaults(state.settings);
  const L = ledgerGetter(state, today, getLedger);
  const items = [];
  const sevRank = { high: 0, medium: 1, low: 2 };
  for (const t of tenantsArr(state)) {
    const name = t.name || 'Unnamed tenant';
    const unit = unitLabel(t);
    const lg = L(t.id);
    const pay = { type: 'recordPayment', tenantId: t.id, label: 'Record payment' };
    if (lg.balance > 0 && (lg.delinquent || lg.current.status === 'late' || lg.current.status === 'partial' || Object.values(lg.months).some(m => m.status === 'late'))) {
      const lateFee = lg.suggestedLateFee ? { type: 'addLateFee', tenantId: t.id, period: lg.suggestedLateFee.period, amount: lg.suggestedLateFee.amount, label: 'Add late fee ' + M.fmt(lg.suggestedLateFee.amount) } : null;
      if (lg.delinquent) {
        const behind = Object.values(lg.months).filter(m => m.open > 0).length;
        items.push({ id: 'delinquent-' + t.id, kind: 'delinquent', severity: 'high', rank: -D.diffDays(lg.oldestOpenDate, today), tenantId: t.id, unit,
          title: name, detail: M.fmt(lg.balance) + ' owed · ' + RB.plural(behind, 'month') + ' behind · oldest ' + D.fmt(lg.oldestOpenDate, today),
          amount: lg.balance, date: lg.oldestOpenDate, action: pay, secondary: lateFee });
      } else if (lg.current.status === 'late' || Object.values(lg.months).some(m => m.status === 'late')) {
        const lateM = lg.current.status === 'late' ? lg.months[lg.current.period] : Object.values(lg.months).filter(m => m.status === 'late').pop();
        items.push({ id: 'late-' + t.id, kind: 'late', severity: 'high', rank: -lateM.daysLate, tenantId: t.id, unit,
          title: name, detail: D.monthName(lateM.period) + ' rent · ' + M.fmt(lateM.open) + (lateM.paid > 0 ? ' still open (' + M.fmt(lateM.paid) + ' paid)' : '') + ' · ' + lateM.daysLate + ' d late',
          amount: lg.balance, date: lateM.due, action: pay, secondary: lateFee });
      } else {
        items.push({ id: 'partial-' + t.id, kind: 'partial', severity: 'medium', rank: 0, tenantId: t.id, unit,
          title: name, detail: 'Paid ' + M.fmt(lg.current.paid) + ' of ' + M.fmt(lg.current.charged) + ' · grace ends ' + D.rel(lg.current.graceEnd, today),
          amount: lg.current.open, date: lg.current.graceEnd, action: pay });
      }
    }
    if (isCurrent(t)) {
      const ls = leaseState(t, settings, today);
      if (ls.kind === 'fixed' && ls.inNoticeWindow && !ls.noticeGiven && t.status === 'active') {
        items.push({ id: 'lease-' + t.id, kind: 'lease', severity: ls.daysLeft <= 30 ? 'medium' : 'low', rank: ls.daysLeft, tenantId: t.id, unit,
          title: name, detail: 'Lease ends ' + D.fmt(ls.end, today) + ' (' + ls.label + ') · no renewal decided', date: ls.end,
          action: { type: 'renewLease', tenantId: t.id, label: 'Decide' } });
      }
      const l = t.lease || {};
      if (l.moveOut && l.moveOut >= today && D.diffDays(today, l.moveOut) <= 30) {
        items.push({ id: 'moveout-' + t.id, kind: 'moveout', severity: 'medium', rank: D.diffDays(today, l.moveOut), tenantId: t.id, unit,
          title: name, detail: 'Moves out ' + D.fmt(l.moveOut, today) + ' (' + D.rel(l.moveOut, today) + ')', date: l.moveOut,
          action: { type: 'openTenant', tenantId: t.id, label: 'Plan move-out' } });
      }
      if (l.moveIn && l.moveIn > today && D.diffDays(today, l.moveIn) <= 30) {
        items.push({ id: 'movein-' + t.id, kind: 'movein', severity: 'low', rank: D.diffDays(today, l.moveIn), tenantId: t.id, unit,
          title: name, detail: 'Moves in ' + D.fmt(l.moveIn, today) + ' (' + D.rel(l.moveIn, today) + ')', date: l.moveIn,
          action: { type: 'openTenant', tenantId: t.id, label: 'Open' } });
      }
      const ins = t.insurance;
      if (ins && ins.expires && D.diffDays(today, ins.expires) <= 30) {
        const n = D.diffDays(today, ins.expires);
        items.push({ id: 'insurance-' + t.id, kind: 'insurance', severity: n < 0 ? 'medium' : 'low', rank: n, tenantId: t.id, unit,
          title: name, detail: 'Renter’s insurance ' + (n < 0 ? 'expired ' + D.fmt(ins.expires, today) : 'expires ' + D.fmt(ins.expires, today) + ' (' + D.rel(ins.expires, today) + ')'),
          date: ins.expires, action: { type: 'openTenant', tenantId: t.id, label: 'Open' } });
      }
    }
    const dd = depositDue(t, settings, today);
    if (dd) {
      items.push({ id: 'deposit-' + t.id, kind: 'deposit', severity: dd.daysLeft <= 7 ? 'high' : 'medium', rank: dd.daysLeft, tenantId: t.id, unit,
        title: name, detail: 'Deposit ' + M.fmt(dd.amount) + ' due back ' + D.fmt(dd.dueDate, today) + ' (' + (dd.overdue ? -dd.daysLeft + ' d overdue' : D.rel(dd.dueDate, today)) + ')',
        amount: dd.amount, date: dd.dueDate, action: { type: 'settleDeposit', tenantId: t.id, label: 'Settle deposit' } });
    }
    const log = t.log || {};
    for (const lid of Object.keys(log)) {
      const e = log[lid];
      if (!e || e.done || !e.followUp || e.followUp > today) continue;
      items.push({ id: 'followup-' + t.id + '-' + lid, kind: 'followup', severity: 'medium', rank: D.diffDays(today, e.followUp), tenantId: t.id, logId: lid, unit,
        title: name, detail: 'Follow up: ' + String(e.text || '').slice(0, 120) + (e.followUp < today ? ' (since ' + D.fmt(e.followUp, today) + ')' : ''),
        date: e.followUp, action: { type: 'followupDone', tenantId: t.id, logId: lid, label: 'Mark done' }, secondary: { type: 'openTenant', tenantId: t.id, label: 'Open' } });
    }
  }
  for (const k of ticketsArr(state)) {
    if (k.status === 'done') continue;
    const age = k.reported ? D.diffDays(k.reported, today) : 0;
    if (k.priority !== 'urgent' && !(k.status === 'open' && k.priority === 'normal')) continue;
    items.push({ id: 'ticket-' + k.id, kind: 'ticket', severity: k.priority === 'urgent' ? 'high' : 'low', rank: -age, ticketId: k.id, tenantId: k.tenantId || null,
      unit: unitLabel(k), title: k.title || 'Upkeep request',
      detail: unitLabel(k) + ' · ' + (k.status === 'scheduled' && k.scheduled ? 'scheduled ' + D.fmt(k.scheduled, today) : age + ' d open') + (k.priority === 'urgent' ? ' · urgent' : ''),
      date: k.reported, action: { type: 'openTicket', ticketId: k.id, label: 'Open' } });
  }
  items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.rank - b.rank || RB.natCmp(a.title, b.title));
  return items;
}

/**
 * Month totals for the portfolio. period 'YYYY-MM' (default: today's month).
 * {period, charged, collected, outstanding, received, tenants, counts:{paid,paid_late,partial,due,late,none}, paidCount, dueDate, graceEnd}
 * charged/collected/outstanding count all charges for that period (rent, recurring, manual); received = payments dated in the period.
 */
function portfolio(state, today, period, getLedger) {
  period = period || D.monthKey(today);
  const settings = settingsWithDefaults(state.settings);
  const L = ledgerGetter(state, today, getLedger);
  const out = { period, charged: 0, collected: 0, outstanding: 0, received: 0, tenants: 0,
    counts: { paid: 0, paid_late: 0, partial: 0, due: 0, late: 0, none: 0 }, paidCount: 0,
    dueDate: D.dayIn(period, settings.dueDay), graceEnd: D.addDays(D.dayIn(period, settings.dueDay), settings.graceDays) };
  for (const t of tenantsArr(state)) {
    const lg = L(t.id);
    const m = lg.months[period];
    for (const r of lg.rows) if (!r.void && r.type === 'payment' && D.monthKey(r.date) === period) out.received += r.amount;
    if (!m || !m.scheduled) continue;
    out.tenants++;
    out.charged += m.charged; out.collected += m.paid; out.outstanding += m.open;
    out.counts[m.status]++;
  }
  out.paidCount = out.counts.paid + out.counts.paid_late;
  return out;
}

/** Rent roll. {rows:[{tenantId,property,unit,name,status,rent,leaseStart,leaseEnd,deposit,balance,monthStatus}], totals:{rent,deposit,balance}, occupancy:{occupied,units,rate}} */
function rentRoll(state, today, getLedger) {
  const L = ledgerGetter(state, today, getLedger);
  const list = sortTenants(tenantsArr(state));
  const rows = list.map(t => {
    const lg = L(t.id);
    return { tenantId: t.id, property: t.property || '', unit: t.unit || '', name: t.name || '', status: t.status || 'active',
      rent: rentOn(t, today), leaseStart: (t.lease || {}).start || null, leaseEnd: (t.lease || {}).end || null,
      moveOut: (t.lease || {}).moveOut || null, deposit: (t.deposit && +t.deposit.amount) || 0, balance: lg.balance, monthStatus: lg.current.status };
  });
  const cur = rows.filter(r => r.status !== 'past');
  const units = new Set(rows.map(r => r.property + '\u0000' + r.unit));
  const occ = new Set(cur.map(r => r.property + '\u0000' + r.unit));
  return {
    rows,
    totals: { rent: cur.reduce((s, r) => s + r.rent, 0), deposit: rows.reduce((s, r) => s + r.deposit, 0), balance: rows.reduce((s, r) => s + r.balance, 0) },
    occupancy: { occupied: occ.size, units: units.size, rate: units.size ? occ.size / units.size : 0 },
  };
}

/** Aging report: tenants with open charges. {rows:[{tenantId,name,property,unit,d0_30,d31_60,d61_90,d90,total}], totals} */
function aging(state, today, getLedger) {
  const L = ledgerGetter(state, today, getLedger);
  const rows = [];
  const totals = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 };
  for (const t of sortTenants(tenantsArr(state))) {
    const a = L(t.id).aging;
    const total = a.d0_30 + a.d31_60 + a.d61_90 + a.d90;
    if (!total) continue;
    rows.push({ tenantId: t.id, name: t.name || '', property: t.property || '', unit: t.unit || '', ...a, total });
    for (const k of Object.keys(totals)) totals[k] += k === 'total' ? total : a[k];
  }
  return { rows, totals };
}

/** Last n months (default 12), oldest → newest: [{period, charged, collected, outstanding, rate}] (rate 0..1 or null when nothing charged) */
function collectionByMonth(state, today, n, getLedger) {
  n = n || 12;
  const L = ledgerGetter(state, today, getLedger);
  const end = D.monthKey(today);
  const out = [];
  const list = tenantsArr(state);
  for (let i = n - 1; i >= 0; i--) {
    const k = D.addMonthKey(end, -i);
    let charged = 0, collected = 0, outstanding = 0;
    for (const t of list) { const m = L(t.id).months[k]; if (m) { charged += m.charged; collected += m.paid; outstanding += m.open; } }
    out.push({ period: k, charged, collected, outstanding, rate: charged ? collected / charged : null });
  }
  return out;
}

/** Cash received per tenant in a calendar year (payments dated in year). {year, rows:[{tenantId,name,property,unit,payments,credits,count,byMonth[12]}], totals:{payments,credits,byMonth}} */
function incomeByYear(state, year, getLedger, today) {
  year = String(year);
  const L = ledgerGetter(state, today || D.today(), getLedger);
  const rows = [];
  const totals = { payments: 0, credits: 0, byMonth: new Array(12).fill(0) };
  for (const t of sortTenants(tenantsArr(state))) {
    const r = { tenantId: t.id, name: t.name || '', property: t.property || '', unit: t.unit || '', payments: 0, credits: 0, count: 0, byMonth: new Array(12).fill(0) };
    for (const row of L(t.id).rows) {
      if (row.void || row.kind !== 'entry' || row.date.slice(0, 4) !== year) continue;
      if (row.type === 'payment') { r.payments += row.amount; r.count++; r.byMonth[+row.date.slice(5, 7) - 1] += row.amount; }
      if (row.type === 'credit') r.credits += row.amount;
    }
    if (!r.payments && !r.credits) continue;
    rows.push(r);
    totals.payments += r.payments; totals.credits += r.credits; r.byMonth.forEach((v, i) => (totals.byMonth[i] += v));
  }
  return { year, rows, totals };
}

/** Plain-text receipt for a payment row. args: {tenant, ledger, entryId, settings} */
function receiptText({ tenant, ledger, entryId, settings }) {
  settings = settingsWithDefaults(settings);
  const row = ledger.rows.find(r => r.id === entryId);
  if (!row) return '';
  const today = ledger.today;
  const lines = [];
  lines.push((settings.portfolioName || 'Rent receipt') + (settings.portfolioName ? ' — ' : '') + (row.type === 'payment' ? 'Payment receipt' : row.type === 'credit' ? 'Credit note' : 'Charge'));
  lines.push('');
  const kv = (k, v) => lines.push((k + ':').padEnd(15) + v);
  kv('Tenant', tenant.name || '');
  kv('Unit', unitLabel(tenant));
  kv('Amount', M.fmt(row.amount));
  kv('Date', D.fmtLong(row.date));
  if (row.method) kv('Method', row.method + (row.ref ? ' (ref ' + row.ref + ')' : ''));
  else if (row.ref) kv('Reference', row.ref);
  if (row.applied && row.applied.length) {
    const byId = {}; ledger.rows.forEach(r => (byId[r.id] = r));
    kv('Applied to', row.applied.map(a => (byId[a.id] ? byId[a.id].label : 'charge') + ' ' + M.fmt(a.amount)).join('; '));
  }
  if (row.memo && row.type === 'payment') kv('Memo', row.memo);
  const after = row.balance;
  kv('Balance after', after > 0 ? M.fmt(after) + ' owed' : after < 0 ? M.fmt(-after) + ' credit' : M.fmt(0) + ' (paid in full)');
  if (row.void) lines.push('', 'VOID — this entry was voided.');
  lines.push('', 'Issued ' + D.fmtLong(today));
  return lines.join('\n');
}

/** Plain-text statement. args: {tenant, ledger, settings, from?, to?} — from/to 'YYYY-MM-DD' inclusive. */
function statementText({ tenant, ledger, settings, from, to }) {
  settings = settingsWithDefaults(settings);
  const rows = ledger.rows.filter(r => !r.void && (!from || r.date >= from) && (!to || r.date <= to));
  const startBal = (() => { if (!from) return 0; let b = 0; for (const r of ledger.rows) { if (r.void) continue; if (r.date >= from) break; b = r.balance; } return b; })();
  const W = 44;
  const money = c => M.fmt(c, { cents: 'always' });
  const line = (l, r) => { l = String(l); r = String(r); const sp = Math.max(1, W - l.length - r.length); return l + ' '.repeat(sp) + r; };
  const out = [];
  out.push(settings.portfolioName ? settings.portfolioName + ' — Statement' : 'Statement');
  out.push(tenant.name + ' · ' + unitLabel(tenant));
  out.push((from ? D.fmtLong(from) : 'Start') + ' to ' + D.fmtLong(to || ledger.today));
  out.push('-'.repeat(W));
  if (from) out.push(line('Opening balance', money(startBal)));
  for (const r of rows) {
    const amt = r.type === 'charge' ? money(r.amount) : '−' + money(r.amount);
    out.push(line(D.fmtNum(r.date, { mon: true }) + '  ' + r.label.slice(0, 24), amt));
  }
  out.push('-'.repeat(W));
  const end = rows.length ? rows[rows.length - 1].balance : startBal;
  out.push(line(end < 0 ? 'Credit on account' : 'Balance due', money(Math.abs(end))));
  return out.join('\n');
}

// ---------------------------------------------------------------- CSV
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // formula-injection guard
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Generic CSV: columns [{label, get(row) | key, money?:true}] → string with CRLF line ends. */
function csv(rows, columns) {
  const head = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => { const v = c.get ? c.get(r) : r[c.key]; return csvCell(c.money ? (v == null ? '' : M.plain(v)) : v); }).join(','));
  return [head].concat(body).join('\r\n') + '\r\n';
}
function ledgerCsv(ledger) {
  return csv(ledger.rows, [
    { label: 'Date', key: 'date' },
    { label: 'Description', key: 'label' },
    { label: 'Period', key: 'period' },
    { label: 'Charge', money: true, get: r => (r.type === 'charge' ? r.amount : null) },
    { label: 'Payment/Credit', money: true, get: r => (r.type !== 'charge' ? r.amount : null) },
    { label: 'Balance', money: true, get: r => r.balance },
    { label: 'Method', key: 'method' },
    { label: 'Reference', key: 'ref' },
    { label: 'Memo', key: 'memo' },
    { label: 'Void', get: r => (r.void ? 'yes' : '') },
  ]);
}
function rentRollCsv(rr) {
  return csv(rr.rows, [
    { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' }, { label: 'Tenant', key: 'name' }, { label: 'Status', key: 'status' },
    { label: 'Rent', key: 'rent', money: true }, { label: 'Lease start', key: 'leaseStart' }, { label: 'Lease end', get: r => r.leaseEnd || 'month-to-month' },
    { label: 'Deposit', key: 'deposit', money: true }, { label: 'Balance', key: 'balance', money: true }, { label: 'This month', key: 'monthStatus' },
  ]);
}
function agingCsv(ag) {
  return csv(ag.rows.concat([Object.assign({ name: 'Total', property: '', unit: '' }, ag.totals)]), [
    { label: 'Tenant', key: 'name' }, { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' },
    { label: '0-30', key: 'd0_30', money: true }, { label: '31-60', key: 'd31_60', money: true }, { label: '61-90', key: 'd61_90', money: true },
    { label: '90+', key: 'd90', money: true }, { label: 'Total', key: 'total', money: true },
  ]);
}
function collectionCsv(rows) {
  return csv(rows, [
    { label: 'Month', key: 'period' }, { label: 'Charged', key: 'charged', money: true }, { label: 'Collected', key: 'collected', money: true },
    { label: 'Outstanding', key: 'outstanding', money: true }, { label: 'Rate', get: r => (r.rate == null ? '' : (r.rate * 100).toFixed(1) + '%') },
  ]);
}
function incomeCsv(inc) {
  const months = D.MON.map((m, i) => ({ label: m, money: true, get: r => r.byMonth[i] }));
  return csv(inc.rows.concat([Object.assign({ name: 'Total', property: '', unit: '', count: '' }, inc.totals)]), [
    { label: 'Tenant', key: 'name' }, { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' },
  ].concat(months, [{ label: 'Payments', key: 'payments', money: true }, { label: 'Credits', key: 'credits', money: true }]));
}

/** Parse CSV or tab-separated text (auto-detected) into an array of string arrays. Handles quotes, CRLF, BOM. */
function parseDelimited(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(x => x.trim()));
}

/**
 * One-line summary for lists/sorting. {tenantId, name, unit, property, rent, status, monthStatus, balance, delinquent,
 *  lease (leaseState), daysLate, urgency (lower = more urgent)}
 */
function tenantSummary(tenant, ledger, settings, today) {
  const ls = leaseState(tenant, settings, today);
  const st = ledger.current.status;
  let urgency = 100;
  if (ledger.delinquent) urgency = 0;
  else if (st === 'late') urgency = 10 - Math.min(9, ledger.current.daysLate / 10);
  else if (st === 'partial') urgency = 20;
  else if (st === 'due') urgency = 40;
  else if (ledger.balance > 0) urgency = 30;
  if (urgency >= 40 && tenant.status === 'notice') urgency = 35;
  if (urgency >= 40 && ls.inNoticeWindow && !ls.noticeGiven) urgency = 38;
  if (tenant.status === 'past') urgency = 200;
  return { tenantId: tenant.id, name: tenant.name || '', unit: tenant.unit || '', property: tenant.property || '', rent: rentOn(tenant, today),
    status: tenant.status || 'active', monthStatus: st, balance: ledger.balance, delinquent: ledger.delinquent, lease: ls, daysLate: ledger.current.daysLate, urgency };
}

RB.model = {
  DEFAULT_SETTINGS, STATUSES, STATUS_LABEL, CATEGORY_LABEL,
  settingsWithDefaults, termsOf, rentOn, buildLedger, lateFeeAmount, monthsBack, monthStatus,
  leaseState, depositDue, attention, portfolio, rentRoll, aging, collectionByMonth, incomeByYear,
  receiptText, statementText, csv, csvCell, ledgerCsv, rentRollCsv, agingCsv, collectionCsv, incomeCsv,
  parseDelimited, tenantSummary, unitLabel, sortTenants, tenantsArr, ticketsArr,
};

// ---------------------------------------------------------------- move-out & deposit settlement (Tenants view)
/**
 * Preview of a move-out on `moveOut` (pure). Builds the ledger as it will stand on the later of today and moveOut,
 * with lease.moveOut set, assuming no further payments.
 * → {moveOut, period, finalRows — generated rent+recurring rows of the final month (with prorate), finalTotal,
 *    balance — owed at move-out (>0) or credit (<0), balanceNow, depositDueDate}
 */
function moveOutPreview(tenant, entries, settings, today, moveOut) {
  settings = settingsWithDefaults(settings);
  const t = RB.clone(tenant);
  t.lease = Object.assign({}, t.lease || {}, { moveOut });
  const asOf = D.max(today, moveOut);
  const lg = buildLedger(t, entries, settings, asOf);
  const period = D.monthKey(moveOut);
  const finalRows = lg.rows.filter(r => r.generated && (r.kind === 'rent' || r.kind === 'recurring') && r.period === period);
  const now = buildLedger(tenant, entries, settings, today);
  return {
    moveOut, period, finalRows, finalTotal: finalRows.reduce((s, r) => s + r.amount, 0),
    balance: lg.balance, balanceNow: now.balance,
    depositDueDate: D.addDays(moveOut, +settings.depositReturnDays || 0),
  };
}

/**
 * Deposit settlement arithmetic (pure). args: {deposit (cents), deductions:[{reason, amount}], balance (ledger balance,
 * >0 owed, <0 credit), applyToBalance:bool — use the deposit against what is owed, or refund a credit with it}
 * → {deposit, deducted, available, applied — deposit used to pay the unpaid balance, creditRefunded, refund, shortfall — deductions
 *    beyond the deposit, balanceAfter — ledger balance once `applied` is credited and `shortfall` charged, lines}
 */
function depositSettlement({ deposit, deductions, balance, applyToBalance }) {
  const dep = Math.max(0, Math.round(+deposit || 0));
  const lines = (deductions || []).filter(d => d && Math.round(+d.amount || 0) > 0).map(d => ({ reason: String(d.reason || '').trim(), amount: Math.round(+d.amount) }));
  const deducted = lines.reduce((s, d) => s + d.amount, 0);
  const available = Math.max(0, dep - deducted);
  const shortfall = Math.max(0, deducted - dep);
  const bal = Math.round(+balance || 0);
  const owed = Math.max(0, bal);
  const applied = applyToBalance ? Math.min(owed, available) : 0;
  const creditRefunded = applyToBalance && bal < 0 ? -bal : 0;   // credit on account paid back with the deposit
  const refund = available - applied + creditRefunded;
  return { deposit: dep, deducted, available, applied, creditRefunded, refund, shortfall, balanceAfter: bal - applied + creditRefunded + shortfall, lines };
}
RB.model.moveOutPreview = moveOutPreview;
RB.model.depositSettlement = depositSettlement;

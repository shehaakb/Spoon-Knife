// node --test test/*.test.mjs — tests for the pure model (src/js/00-util.js + 10-model.js + 25-sample.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');
for (const f of ['00-util.js', '10-model.js', '25-sample.js']) {
  runInThisContext(`;(function(){'use strict';\n${readFileSync(join(SRC, f), 'utf8')}\n})();`, { filename: f });
}
const RB = globalThis.RB;
const { buildLedger, leaseState, depositDue, attention, portfolio, aging, collectionByMonth, incomeByYear, receiptText, statementText, monthsBack, rentRoll } = RB.model;
const D = RB.date, M = RB.money;

const SETTINGS = { dueDay: 1, graceDays: 5, lateFee: { type: 'flat', amount: 5000 }, depositReturnDays: 30, leaseNoticeDays: 60, methods: ['Check', 'Zelle'] };
let seq = 0;
const pay = (date, amount, extra = {}) => ({ id: 'p' + ++seq, type: 'payment', date, amount, method: 'Zelle', void: false, createdAt: date + 'T12:00:00Z', ...extra });
const charge = (date, amount, extra = {}) => ({ id: 'c' + ++seq, type: 'charge', date, amount, void: false, createdAt: date + 'T12:00:00Z', ...extra });
const credit = (date, amount, extra = {}) => ({ id: 'k' + ++seq, type: 'credit', date, amount, void: false, createdAt: date + 'T12:00:00Z', ...extra });
const map = list => Object.fromEntries(list.map(e => [e.id, e]));
const tenant = (over = {}) => ({
  id: 't1', name: 'Test Tenant', property: 'Alder Court', unit: '2B', status: 'active',
  lease: { start: '2026-01-01', end: '2026-12-31', moveIn: '2026-01-01', noticeDate: null, moveOut: null, dueDay: null, graceDays: null },
  rent: [{ from: '2026-01-01', amount: 145000 }], recurring: [], trackFrom: '2026-01-01', opening: null,
  deposit: { amount: 145000, received: '2026-01-01', heldAt: 'Bank', returned: null }, log: {}, ...over,
});

// ------------------------------------------------------------------ util
test('money format and parse', () => {
  assert.equal(M.fmt(145000), '$1,450');
  assert.equal(M.fmt(145050), '$1,450.50');
  assert.equal(M.fmt(-12000), '−$120');
  assert.equal(M.fmt(5), '$0.05');
  assert.equal(M.parse('1,450.50'), 145050);
  assert.equal(M.parse('$1450'), 145000);
  assert.equal(M.parse('1450.5'), 145050);
  assert.equal(M.parse(' -120 '), -12000);
  assert.equal(M.parse('(120.00)'), -12000);
  assert.equal(M.parse('abc'), null);
  assert.equal(M.parse(''), null);
  assert.equal(M.parse('1,45'), null);
  assert.equal(M.plain(-12345), '-123.45');
});

test('date helpers never touch UTC and handle boundaries', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.addMonthKey('2026-12', 1), '2027-01');
  assert.equal(D.addMonthKey('2026-01', -1), '2025-12');
  assert.equal(D.diffDays('2026-11-01', '2026-11-10'), 9);
  assert.equal(D.diffDays('2025-12-31', '2026-01-01'), 1);
  assert.equal(D.daysInMonth('2024-02'), 29);
  assert.equal(D.weekday('2026-11-23'), 'Mon');
  assert.equal(D.fmt('2026-11-03', '2026-11-23'), 'Nov 3');
  assert.equal(D.fmt('2025-11-03', '2026-11-23'), 'Nov 3, 2025');
  assert.equal(D.rel('2026-12-05', '2026-11-23'), 'in 12 d');
  assert.equal(D.rel('2026-11-14', '2026-11-23', { style: 'late' }), '9 d late');
  assert.equal(D.parseLoose('11/3/2026'), '2026-11-03');
  assert.equal(D.parseLoose('Nov 3, 2026'), '2026-11-03');
  assert.equal(D.parseLoose('2026-02-30'), null);
});

test('html template escapes by default, raw opts out, arrays flatten', () => {
  const name = '<img src=x onerror=alert(1)>';
  const out = String(RB.html`<b>${name}</b>${RB.raw('<i>ok</i>')}${[RB.html`<u>${'a&b'}</u>`, '<x>']}`);
  assert.equal(out, '<b>&lt;img src=x onerror=alert(1)&gt;</b><i>ok</i><u>a&amp;b</u>&lt;x&gt;');
  assert.equal(RB.safeUrl('javascript:alert(1)'), null);
  assert.equal(RB.safeUrl('https://example.com/lease.pdf'), 'https://example.com/lease.pdf');
});

// ------------------------------------------------------------------ ledger basics
test('on-time payment → paid', () => {
  const lg = buildLedger(tenant(), map([pay('2026-01-01', 145000)]), SETTINGS, '2026-01-20');
  assert.equal(lg.balance, 0);
  assert.equal(lg.months['2026-01'].status, 'paid');
  assert.equal(lg.months['2026-01'].paidOn, '2026-01-01');
  assert.equal(lg.current.status, 'paid');
  const ch = lg.rows.find(r => r.id === 'rent-2026-01');
  assert.equal(ch.paid, 145000); assert.equal(ch.open, 0);
});

test('charge exists from the 1st even when due later; due vs late by grace', () => {
  const t = tenant({ lease: { ...tenant().lease, dueDay: 5 } });
  let lg = buildLedger(t, {}, SETTINGS, '2026-01-01');
  assert.equal(lg.rows.length, 1);
  assert.equal(lg.rows[0].date, '2026-01-05');
  assert.equal(lg.current.status, 'due');
  lg = buildLedger(t, {}, SETTINGS, '2026-01-10'); // due 5 + grace 5 = Jan 10, still in grace
  assert.equal(lg.current.status, 'due');
  lg = buildLedger(t, {}, SETTINGS, '2026-01-11');
  assert.equal(lg.current.status, 'late');
  assert.equal(lg.current.daysLate, 6);
});

test('late payment → paid_late', () => {
  const lg = buildLedger(tenant(), map([pay('2026-01-09', 145000)]), SETTINGS, '2026-01-20');
  assert.equal(lg.months['2026-01'].status, 'paid_late');
  assert.equal(lg.months['2026-01'].daysLate, 8);
  const lg2 = buildLedger(tenant(), map([pay('2026-01-06', 145000)]), SETTINGS, '2026-01-20');
  assert.equal(lg2.months['2026-01'].status, 'paid', 'paid on last grace day is on time');
});

test('partial within grace, then late after grace', () => {
  const e = map([pay('2026-01-02', 80000)]);
  let lg = buildLedger(tenant(), e, SETTINGS, '2026-01-04');
  assert.equal(lg.current.status, 'partial');
  assert.equal(lg.current.open, 65000);
  lg = buildLedger(tenant(), e, SETTINGS, '2026-01-07');
  assert.equal(lg.current.status, 'late');
  assert.equal(lg.balance, 65000);
});

test('overpayment carried as credit to next month', () => {
  const e = map([pay('2026-01-01', 175000)]);
  let lg = buildLedger(tenant(), e, SETTINGS, '2026-01-20');
  assert.equal(lg.balance, -30000);
  assert.equal(lg.credit, 30000);
  lg = buildLedger(tenant(), e, SETTINGS, '2026-02-03');
  assert.equal(lg.balance, 115000);
  assert.equal(lg.months['2026-02'].paid, 30000);
  assert.equal(lg.current.status, 'partial');
  // prepayment for next month in full → paid on time with paidOn = payment date
  const lg2 = buildLedger(tenant(), map([pay('2026-01-01', 145000), pay('2026-01-28', 145000)]), SETTINGS, '2026-02-10');
  assert.equal(lg2.months['2026-02'].status, 'paid');
  assert.equal(lg2.months['2026-02'].paidOn, '2026-01-28');
});

test('FIFO across months: payment pays oldest open charge first', () => {
  const e = map([pay('2026-02-03', 145000)]);
  const lg = buildLedger(tenant(), e, SETTINGS, '2026-02-20');
  assert.equal(lg.months['2026-01'].status, 'paid_late');
  assert.equal(lg.months['2026-01'].paidOn, '2026-02-03');
  assert.equal(lg.months['2026-02'].status, 'late');
  assert.equal(lg.balance, 145000);
  const p = lg.rows.find(r => r.type === 'payment');
  assert.deepEqual(p.applied, [{ id: 'rent-2026-01', amount: 145000 }]);
});

test('running balance and same-day ordering (charges before payments)', () => {
  const lg = buildLedger(tenant(), map([pay('2026-01-01', 145000), pay('2026-02-01', 100000)]), SETTINGS, '2026-02-02');
  assert.deepEqual(lg.rows.map(r => [r.id.startsWith('rent') ? 'rent' : 'pay', r.balance]), [['rent', 145000], ['pay', 0], ['rent', 145000], ['pay', 45000]]);
});

test('proration: first month from move-in, last month to move-out', () => {
  const t = tenant({ lease: { start: '2026-01-16', end: null, moveIn: '2026-01-16', moveOut: '2026-03-10', noticeDate: '2026-02-01' }, rent: [{ from: '2026-01-16', amount: 155000 }], trackFrom: '2026-01-16' });
  const lg = buildLedger(t, {}, SETTINGS, '2026-04-15');
  const jan = lg.rows.find(r => r.id === 'rent-2026-01');
  assert.deepEqual([jan.prorate.days, jan.prorate.ofDays], [16, 31]);
  assert.equal(jan.amount, Math.round(155000 * 16 / 31));
  assert.equal(jan.date, '2026-01-16', 'prorated first charge dated on move-in when due day is earlier');
  const mar = lg.rows.find(r => r.id === 'rent-2026-03');
  assert.deepEqual([mar.prorate.days, mar.prorate.ofDays], [10, 31]);
  assert.equal(mar.amount, 50000);
  assert.ok(!lg.rows.some(r => r.id === 'rent-2026-04'), 'no charges after move-out');
  assert.equal(lg.rows.find(r => r.id === 'rent-2026-02').prorate, null);
});

test('rent change mid-history uses the schedule in force on the due date', () => {
  const t = tenant({ rent: [{ from: '2026-01-01', amount: 145000 }, { from: '2026-04-01', amount: 152500 }] });
  const lg = buildLedger(t, {}, SETTINGS, '2026-05-02');
  assert.equal(lg.rows.find(r => r.id === 'rent-2026-03').amount, 145000);
  assert.equal(lg.rows.find(r => r.id === 'rent-2026-04').amount, 152500);
  assert.equal(lg.rent, 152500);
});

test('recurring charges are their own rows and count in the month', () => {
  const t = tenant({ recurring: [{ id: 'pet', label: 'Pet rent', amount: 3500, from: '2026-02-01', to: null }] });
  const lg = buildLedger(t, map([pay('2026-01-01', 145000), pay('2026-02-01', 148500)]), SETTINGS, '2026-02-10');
  assert.ok(lg.rows.some(r => r.id === 'rec-pet-2026-02'));
  assert.ok(!lg.rows.some(r => r.id === 'rec-pet-2026-01'));
  assert.equal(lg.months['2026-02'].charged, 148500);
  assert.equal(lg.months['2026-02'].status, 'paid');
});

test('opening balance owed and opening credit', () => {
  let lg = buildLedger(tenant({ opening: { amount: 20000 } }), map([pay('2026-01-02', 145000)]), SETTINGS, '2026-01-20');
  assert.equal(lg.rows[0].label, 'Balance brought forward');
  assert.equal(lg.balance, 20000);
  assert.equal(lg.months['2026-01'].status, 'late', 'FIFO: opening paid first, January still short');
  lg = buildLedger(tenant({ opening: { amount: -20000 } }), map([pay('2026-01-02', 125000)]), SETTINGS, '2026-01-20');
  assert.equal(lg.balance, 0);
  assert.equal(lg.months['2026-01'].status, 'paid');
});

test('trackFrom after a due date: that month is part of opening', () => {
  const t = tenant({ trackFrom: '2026-01-10', lease: { ...tenant().lease, moveIn: '2025-06-01' }, opening: { amount: 145000 } });
  const lg = buildLedger(t, {}, SETTINGS, '2026-02-03');
  assert.ok(!lg.rows.some(r => r.id === 'rent-2026-01'));
  assert.ok(lg.rows.some(r => r.id === 'rent-2026-02'));
  assert.equal(lg.balance, 290000);
});

test('void entries are ignored for maths but kept in rows; undone entries vanish', () => {
  const e = map([pay('2026-01-01', 145000, { void: true }), pay('2026-01-02', 145000, { void: true, undone: true })]);
  const lg = buildLedger(tenant(), e, SETTINGS, '2026-01-20');
  assert.equal(lg.balance, 145000);
  assert.equal(lg.current.status, 'late');
  assert.equal(lg.rows.filter(r => r.type === 'payment').length, 1);
  assert.equal(lg.rows.find(r => r.type === 'payment').void, true);
  assert.equal(lg.lastPayment, null);
});

test('late fee suggestion appears for a late month and disappears once posted', () => {
  let lg = buildLedger(tenant(), {}, SETTINGS, '2026-01-12');
  assert.deepEqual(lg.suggestedLateFee, { period: '2026-01', amount: 5000 });
  const fee = charge('2026-01-12', 5000, { category: 'late_fee', period: '2026-01', memo: 'Late fee' });
  lg = buildLedger(tenant(), map([fee]), SETTINGS, '2026-01-12');
  assert.equal(lg.suggestedLateFee, null);
  assert.equal(lg.balance, 150000);
  lg = buildLedger(tenant(), map([{ ...fee, void: true }]), SETTINGS, '2026-01-12');
  assert.deepEqual(lg.suggestedLateFee, { period: '2026-01', amount: 5000 }, 'voided fee does not count');
  lg = buildLedger(tenant(), {}, { ...SETTINGS, lateFee: { type: 'percent', amount: 5 } }, '2026-01-12');
  assert.equal(lg.suggestedLateFee.amount, 7250);
  lg = buildLedger(tenant(), {}, { ...SETTINGS, lateFee: { type: 'none', amount: 0 } }, '2026-01-12');
  assert.equal(lg.suggestedLateFee, null);
  lg = buildLedger(tenant(), {}, SETTINGS, '2026-01-05');
  assert.equal(lg.suggestedLateFee, null, 'no suggestion while in grace');
});

test('a manual charge does not change month status but ages', () => {
  const e = map([pay('2026-01-01', 145000), charge('2026-01-08', 12000, { category: 'utility', memo: 'Water' })]);
  const lg = buildLedger(tenant(), e, SETTINGS, '2026-01-20');
  assert.equal(lg.months['2026-01'].status, 'paid');
  assert.equal(lg.months['2026-01'].open, 12000);
  assert.equal(lg.balance, 12000);
});

test('aging buckets and delinquency', () => {
  const lg = buildLedger(tenant(), map([pay('2026-01-01', 145000)]), SETTINGS, '2026-05-15');
  // Feb 1 (103 d), Mar 1 (75 d), Apr 1 (44 d), May 1 (14 d)
  assert.deepEqual(lg.aging, { d0_30: 145000, d31_60: 145000, d61_90: 145000, d90: 145000 });
  assert.equal(lg.delinquent, true);
  assert.equal(lg.oldestOpenDate, '2026-02-01');
  const ok = buildLedger(tenant(), {}, SETTINGS, '2026-01-25');
  assert.equal(ok.delinquent, false);
  const ag = aging({ settings: SETTINGS, tenants: { t1: tenant() }, ledgers: { t1: { entries: map([pay('2026-01-01', 145000)]) } } }, '2026-05-15');
  assert.equal(ag.totals.total, 580000);
});

test('month boundaries and year rollover', () => {
  const t = tenant({ lease: { start: '2025-11-01', end: null, moveIn: '2025-11-01' }, rent: [{ from: '2025-11-01', amount: 100000 }], trackFrom: '2025-11-01' });
  const lg = buildLedger(t, map([pay('2025-11-01', 100000), pay('2025-12-01', 100000), pay('2026-01-03', 100000)]), SETTINGS, '2026-01-31');
  assert.deepEqual(Object.keys(lg.months), ['2025-11', '2025-12', '2026-01']);
  assert.equal(lg.months['2026-01'].status, 'paid');
  assert.equal(lg.rows.find(r => r.id === 'rent-2025-12').label, 'Rent — December 2025');
  const strip = monthsBack(lg, '2026-01', 4);
  assert.deepEqual(strip.map(s => s.status), ['none', 'paid', 'paid', 'paid']);
  assert.equal(buildLedger(t, {}, SETTINGS, '2026-02-01').rows.filter(r => r.kind === 'rent').length, 4);
});

test('dueDay and graceDays overrides on the lease beat settings; due day clamps to month end', () => {
  const t = tenant({ lease: { ...tenant().lease, dueDay: 31, graceDays: 0 } });
  const lg = buildLedger(t, {}, SETTINGS, '2026-03-01');
  assert.equal(lg.rows.find(r => r.id === 'rent-2026-02').date, '2026-02-28');
  assert.equal(lg.months['2026-02'].status, 'late');
  assert.equal(lg.months['2026-03'].status, 'due');
  const lg2 = buildLedger(tenant({ lease: { ...tenant().lease, graceDays: 10 } }), {}, SETTINGS, '2026-01-09');
  assert.equal(lg2.current.status, 'due');
});

test('leaseState and depositDue', () => {
  const s = { ...SETTINGS };
  let ls = leaseState(tenant(), s, '2026-11-15');
  assert.equal(ls.kind, 'fixed'); assert.equal(ls.daysLeft, 46); assert.equal(ls.inNoticeWindow, true); assert.equal(ls.label, 'in 46 d');
  assert.ok(ls.progress > 0.85 && ls.progress < 0.9);
  ls = leaseState(tenant({ lease: { ...tenant().lease, end: null } }), s, '2026-11-15');
  assert.equal(ls.kind, 'mtm');
  ls = leaseState(tenant(), s, '2027-02-01');
  assert.equal(ls.kind, 'mtm'); assert.equal(ls.holdover, true);
  const past = tenant({ status: 'past', lease: { ...tenant().lease, moveOut: '2026-10-31' } });
  assert.equal(leaseState(past, s, '2026-11-15').kind, 'ended');
  assert.deepEqual(depositDue(past, s, '2026-11-15'), { amount: 145000, moveOut: '2026-10-31', dueDate: '2026-11-30', daysLeft: 15, overdue: false });
  assert.equal(depositDue({ ...past, deposit: { ...past.deposit, returned: { date: '2026-11-10', refund: 145000, deductions: [] } } }, s, '2026-11-15'), null);
});

test('portfolio, attention, collection, income and text outputs', () => {
  const tenants = {
    a: tenant({ id: 'a', name: 'Ann', unit: '1A' }),
    b: tenant({ id: 'b', name: 'Bo', unit: '1B' }),
    c: tenant({ id: 'c', name: 'Cy', unit: '1C' }),
  };
  const ledgers = {
    a: { entries: map([pay('2026-01-01', 145000), pay('2026-02-01', 145000)]) },
    b: { entries: map([pay('2026-01-03', 145000)]) },
    c: { entries: {} },
  };
  const state = { settings: SETTINGS, tenants, ledgers, tickets: { k1: { title: 'Leak', priority: 'urgent', status: 'open', property: 'Alder Court', unit: '1A', reported: '2026-02-01' } } };
  const p = portfolio(state, '2026-02-10', '2026-02');
  assert.equal(p.charged, 435000); assert.equal(p.collected, 145000); assert.equal(p.outstanding, 290000);
  assert.equal(p.counts.paid, 1); assert.equal(p.counts.late, 2); assert.equal(p.paidCount, 1);
  const att = attention(state, '2026-02-10');
  assert.equal(att[0].severity, 'high');
  assert.deepEqual(att.map(i => i.kind).sort(), ['delinquent', 'late', 'ticket']);
  assert.ok(att.find(i => i.kind === 'late').secondary.label.startsWith('Add late fee $50'));
  const col = collectionByMonth(state, '2026-02-10', 3);
  assert.deepEqual(col.map(c => c.period), ['2025-12', '2026-01', '2026-02']);
  assert.equal(col[0].rate, null);
  const inc = incomeByYear(state, 2026);
  assert.equal(inc.totals.payments, 435000);
  const rr = rentRoll(state, '2026-02-10');
  assert.equal(rr.occupancy.units, 3);
  const lg = buildLedger(tenants.a, ledgers.a.entries, SETTINGS, '2026-02-10');
  const pid = lg.rows.find(r => r.type === 'payment').id;
  const txt = receiptText({ tenant: tenants.a, ledger: lg, entryId: pid, settings: { ...SETTINGS, portfolioName: 'Alder Rentals' } });
  assert.match(txt, /Alder Rentals — Payment receipt/);
  assert.match(txt, /Amount:\s+\$1,450/);
  assert.match(txt, /Balance after:\s+\$0 \(paid in full\)/);
  assert.match(statementText({ tenant: tenants.c, ledger: buildLedger(tenants.c, {}, SETTINGS, '2026-02-10'), settings: SETTINGS }), /Balance due\s+\$2,900\.00/);
  assert.equal(RB.model.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.deepEqual(RB.model.parseDelimited('a,b\n"x, y","q""z"\n'), [['a', 'b'], ['x, y', 'q"z']]);
});

// ------------------------------------------------------------------ sample data
test('sample data produces the described spread relative to today', () => {
  for (const today of ['2026-11-23', '2026-11-03', '2027-03-01', '2026-01-15']) {
    const s = RB.sample.generate(today);
    const ids = Object.keys(s.tenants);
    assert.equal(ids.length, 27, today);
    const L = id => buildLedger({ id, ...s.tenants[id] }, s.ledgers[id] ? s.ledgers[id].entries : {}, s.settings, today);
    const cur = ids.filter(id => s.tenants[id].status !== 'past');
    const st = cur.map(id => L(id).current);
    const unpaid = st.filter(c => c.status !== 'none' && c.paid === 0 && c.open > 0).length;
    const partial = st.filter(c => c.paid > 0 && c.open > 0).length;
    const delinquent = cur.filter(id => L(id).delinquent).length;
    const credit = ids.filter(id => L(id).balance < 0).length;
    const mtm = cur.filter(id => leaseState(s.tenants[id], s.settings, today).kind === 'mtm').length;
    const ending = cur.filter(id => { const ls = leaseState(s.tenants[id], s.settings, today); return ls.kind === 'fixed' && ls.daysLeft <= 60 && !ls.noticeGiven; }).length;
    const notice = ids.filter(id => s.tenants[id].status === 'notice').length;
    const past = ids.filter(id => s.tenants[id].status === 'past' && depositDue(s.tenants[id], s.settings, today)).length;
    const lateHist = ids.filter(id => Object.values(L(id).months).some(m => m.status === 'paid_late')).length;
    const incr = ids.filter(id => s.tenants[id].rent.length > 1).length;
    assert.equal(unpaid, 4, today + ' unpaid this month (3 + the delinquent one)');
    assert.equal(partial, 2, today + ' partial');
    assert.equal(delinquent, 1, today + ' delinquent');
    assert.equal(credit, 1, today + ' credit');
    assert.equal(mtm, 3, today + ' month-to-month');
    assert.equal(ending, 2, today + ' leases ending within 60 d');
    assert.equal(notice, 1, today + ' notice');
    assert.equal(past, 1, today + ' moved out with deposit due');
    assert.ok(lateHist >= 3, today + ' paid_late history');
    assert.ok(incr >= 3, today + ' rent increases');
    assert.equal(Object.keys(s.tickets).length, 6);
    assert.ok(ids.every(id => s.tenants[id].sample === true));
    const fu = ids.flatMap(id => Object.values(s.tenants[id].log || {})).filter(e => e.followUp && !e.done && e.followUp <= today);
    assert.equal(fu.length, 1, today + ' one follow-up due');
    // deterministic
    assert.deepEqual(RB.sample.generate(today), s);
  }
});

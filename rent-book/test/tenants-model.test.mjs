// node --test test/*.test.mjs — model helpers added for the Tenants view (moveOutPreview, depositSettlement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');
if (!globalThis.RB || !globalThis.RB.model) {
  for (const f of ['00-util.js', '10-model.js']) runInThisContext(`;(function(){'use strict';\n${readFileSync(join(SRC, f), 'utf8')}\n})();`, { filename: f });
}
const { moveOutPreview, depositSettlement } = globalThis.RB.model;
const SETTINGS = { dueDay: 1, graceDays: 5, lateFee: { type: 'flat', amount: 5000 }, depositReturnDays: 30, leaseNoticeDays: 60 };
const tenant = (over = {}) => ({
  id: 't1', name: 'T', property: 'P', unit: '1', status: 'active',
  lease: { start: '2026-01-01', end: null, moveIn: '2026-01-01', noticeDate: null, moveOut: null },
  rent: [{ from: '2026-01-01', amount: 310000 }], recurring: [], trackFrom: '2026-01-01', opening: null,
  deposit: { amount: 310000, received: '2026-01-01', heldAt: '', returned: null }, log: {}, ...over,
});
const paidThrough = (lastMonth) => {
  const e = {};
  for (let m = 1; m <= lastMonth; m++) e['p' + m] = { type: 'payment', date: '2026-' + String(m).padStart(2, '0') + '-01', amount: 310000, void: false, createdAt: 'x' + m };
  return e;
};

test('moveOutPreview: future move-out prorates the final month and projects the balance', () => {
  const p = moveOutPreview(tenant(), paidThrough(11), SETTINGS, '2026-11-23', '2026-12-10');
  assert.equal(p.period, '2026-12');
  assert.equal(p.finalRows.length, 1);
  assert.deepEqual([p.finalRows[0].prorate.days, p.finalRows[0].prorate.ofDays], [10, 31]);
  assert.equal(p.finalTotal, 100000);          // 3100 × 10/31
  assert.equal(p.balanceNow, 0);
  assert.equal(p.balance, 100000);
  assert.equal(p.depositDueDate, '2027-01-09');
});

test('moveOutPreview: past move-out drops charges after it', () => {
  const p = moveOutPreview(tenant(), paidThrough(9), SETTINGS, '2026-11-23', '2026-10-15');
  assert.equal(p.period, '2026-10');
  assert.equal(p.finalTotal, 150000);          // 3100 × 15/31
  assert.equal(p.balanceNow, 620000);          // Oct + Nov unpaid today
  assert.equal(p.balance, 150000);
});

test('depositSettlement: deductions, apply to balance, refund', () => {
  const s = depositSettlement({ deposit: 145000, deductions: [{ reason: 'Cleaning', amount: 15000 }, { reason: '', amount: 0 }], balance: 30000, applyToBalance: true });
  assert.equal(s.deducted, 15000);
  assert.equal(s.applied, 30000);
  assert.equal(s.refund, 100000);
  assert.equal(s.shortfall, 0);
  assert.equal(s.balanceAfter, 0);
  assert.equal(s.lines.length, 1);
});

test('depositSettlement: not applied, credit balance, shortfall', () => {
  assert.equal(depositSettlement({ deposit: 100000, deductions: [], balance: 30000, applyToBalance: false }).refund, 100000);
  const cr = depositSettlement({ deposit: 100000, deductions: [], balance: -5000, applyToBalance: true });
  assert.equal(cr.applied, 0);
  assert.equal(cr.creditRefunded, 5000);
  assert.equal(cr.refund, 105000);
  assert.equal(cr.balanceAfter, 0);
  assert.equal(depositSettlement({ deposit: 100000, deductions: [], balance: -5000, applyToBalance: false }).refund, 100000);
  const s = depositSettlement({ deposit: 50000, deductions: [{ reason: 'Carpet', amount: 80000 }], balance: 10000, applyToBalance: true });
  assert.equal(s.refund, 0);
  assert.equal(s.applied, 0);
  assert.equal(s.shortfall, 30000);
  assert.equal(s.balanceAfter, 40000);
});

// node --test test/*.test.mjs — v3 law 7: one number (RB.model.owed), one sentence (owedSentence), one order (attentionOrder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');
if (!globalThis.RB || !globalThis.RB.model || !globalThis.RB.sample) {
  for (const f of ['00-util.js', '10-model.js', '25-sample.js']) {
    runInThisContext(`;(function(){'use strict';\n${readFileSync(join(SRC, f), 'utf8')}\n})();`, { filename: f });
  }
}
const RB = globalThis.RB;
const { owed, owedSentence, attentionOrder, attentionKey, attentionCompare, attention, buildLedger, settingsWithDefaults } = RB.model;
const TODAY = '2026-11-24';
const sample = () => { const d = RB.sample.generate(TODAY); return { settings: d.settings, tenants: d.tenants, ledgers: d.ledgers, tickets: d.tickets }; };
const ledgerOf = state => { const s = settingsWithDefaults(state.settings); return id => buildLedger(Object.assign({ id }, state.tenants[id]), (state.ledgers[id] || {}).entries || {}, s, TODAY); };

test('owed: total is the sum of every positive balance; thisMonth is the part that is this month', () => {
  const st = sample();
  const L = ledgerOf(st);
  const o = owed(st, TODAY);
  const ids = Object.keys(st.tenants);
  const positive = ids.map(id => L(id).balance).filter(b => b > 0);
  assert.equal(o.total, positive.reduce((a, b) => a + b, 0));
  assert.equal(o.tenants.length, positive.length);
  assert.equal(o.tenants.reduce((a, t) => a + t.thisMonth, 0), o.thisMonth);
  assert.ok(o.thisMonth <= o.total);
  for (const t of o.tenants) assert.equal(t.thisMonth + t.earlier, t.balance);
  // thisMonth = what is still open on this month's charges (what the Rent page shows for the month)
  const monthOpen = ids.reduce((a, id) => { const m = L(id).months['2026-11']; return a + (m && L(id).balance > 0 ? Math.min(m.open, L(id).balance) : 0); }, 0);
  assert.equal(o.thisMonth, monthOpen);
  assert.equal(o.period, '2026-11');
});

test('owedSentence: the one wording', () => {
  const st = sample();
  const o = owed(st, TODAY);
  const s = owedSentence(o, TODAY);
  const fmt = RB.money.fmt;
  if (o.thisMonth < o.total) assert.equal(s, `${o.tenants.length} tenants owe ${fmt(o.total)} in total — ${fmt(o.thisMonth)} of it is November’s rent.`);
  assert.equal(owedSentence({ total: 0, thisMonth: 0, period: '2026-11', tenants: [] }, TODAY), 'Nobody owes you anything.');
  assert.equal(owedSentence({ total: 270000, thisMonth: 270000, period: '2026-11', tenants: [{}, {}] }, TODAY), '2 tenants owe $2,700, all of it November’s rent.');
  assert.equal(owedSentence({ total: 205000, thisMonth: 0, period: '2026-11', tenants: [{}] }, TODAY), '1 tenant owes $2,050, all from earlier months.');
  assert.equal(owedSentence({ total: 854500, thisMonth: 649500, period: '2026-11', tenants: [1, 2, 3, 4, 5, 6] }, TODAY), '6 tenants owe $8,545 in total — $6,495 of it is November’s rent.');
});

test('attentionOrder: behind on rent first (oldest), then late (most days), part paid, not paid yet; larger balance breaks ties', () => {
  const st = sample();
  const L = ledgerOf(st);
  const order = attentionOrder(st, TODAY);
  const keys = order.map(id => attentionKey(st.tenants[id], L(id), TODAY));
  for (let i = 1; i < keys.length; i++) assert.ok(attentionCompare(keys[i - 1], keys[i]) <= 0, `out of order at ${i}`);
  assert.ok(keys.every(k => k.tier < 9 && k.balance > 0));
  // a delinquent tenant (sample has one) comes first
  const del = Object.keys(st.tenants).find(id => L(id).delinquent && L(id).balance > 0);
  if (del) assert.equal(order[0], del);
  // owed() lists tenants in exactly this order
  assert.deepEqual(owed(st, TODAY).tenants.map(t => t.tenantId), order);
});

test('attentionCompare: tiers, then days, then balance, then name', () => {
  const c = (a, b) => Math.sign(attentionCompare(a, b));
  assert.equal(c({ tier: 0, days: 10, balance: 1, name: 'b' }, { tier: 1, days: 99, balance: 9, name: 'a' }), -1);
  assert.equal(c({ tier: 1, days: 30, balance: 1, name: 'b' }, { tier: 1, days: 20, balance: 9, name: 'a' }), -1);
  assert.equal(c({ tier: 2, days: 0, balance: 500, name: 'b' }, { tier: 2, days: 0, balance: 100, name: 'a' }), -1);
  assert.equal(c({ tier: 3, days: 0, balance: 100, name: 'Ann' }, { tier: 3, days: 0, balance: 100, name: 'Bob' }), -1);
});

test('attention(): rent items follow attentionOrder', () => {
  const st = sample();
  const order = attentionOrder(st, TODAY);
  const rentIds = attention(st, TODAY).filter(a => ['delinquent', 'late', 'partial'].includes(a.kind)).map(a => a.tenantId);
  const filtered = order.filter(id => rentIds.includes(id));
  // within each severity the order matches; across severities high comes before medium
  const sevOf = id => attention(st, TODAY).find(a => a.tenantId === id && ['delinquent', 'late', 'partial'].includes(a.kind)).severity;
  const bySev = s => rentIds.filter(id => sevOf(id) === s);
  assert.deepEqual(bySev('high'), filtered.filter(id => sevOf(id) === 'high'));
  assert.deepEqual(bySev('medium'), filtered.filter(id => sevOf(id) === 'medium'));
});

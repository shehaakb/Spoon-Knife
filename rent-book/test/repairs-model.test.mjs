// node --test test/*.test.mjs — Repairs history model (SPEC §9) and the sample past repairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'js');
if (!globalThis.RB || !globalThis.RB.model || !globalThis.RB.sample) {
  for (const f of ['00-util.js', '10-model.js', '25-sample.js']) runInThisContext(`;(function(){'use strict';\n${readFileSync(join(SRC, f), 'utf8')}\n})();`, { filename: f });
}
const RB = globalThis.RB;
const Mo = RB.model, D = RB.date;
const { suggestCategory, repairCategory, propertySlug, repairProperties, propertyBySlug, repairHistory, repairTotals, repeatProblems,
  repairShowingText, repairsCsv, repairsText, REPAIR_BUILDING } = Mo;

const TODAY = '2026-11-24';
let n = 0;
const rep = (over = {}) => ({ id: 'r' + ++n, property: 'Alder Court', unit: '2B', title: 'Repair', status: 'done', priority: 'normal',
  reported: over.completed || '2026-01-01', completed: '2026-01-01', cost: 10000, paidBy: 'owner', vendor: '', createdAt: 'x' + n, ...over });
const stateOf = (list, tenants = {}) => ({ settings: {}, tenants, ledgers: {}, tickets: Object.fromEntries(list.map(k => [k.id, k])) });
const items = list => list.map(Mo.repairItem);

// ------------------------------------------------------------------ categories
test('suggestCategory: title words → category', () => {
  const cases = {
    'Leaking tap': 'plumbing', 'Kitchen sink clogged': 'plumbing', 'No hot water': 'plumbing', 'Water heater pilot out': 'plumbing',
    'Toilet running': 'plumbing', 'Bathroom fan rattles': 'electrical', 'Smoke detector chirping': 'electrical', 'Outlet sparks': 'electrical',
    'Replace dishwasher': 'appliance', 'Dishwasher leaking': 'appliance', 'Fridge not cooling': 'appliance', 'Boiler service': 'heating',
    'Furnace not starting': 'heating', 'AC not cooling': 'heating', 'Clean gutters before winter': 'roof', 'Roof leak over stairwell': 'roof',
    'Garage door spring snapped': 'doors', 'Broken window latch': 'doors', 'Rekey lock': 'doors', 'Mice in the kitchen': 'pest',
    'Ants by the back door': 'pest', 'Repaint hallway': 'painting', 'Carpet stain': 'painting', 'Leak': 'plumbing',
  };
  for (const [title, want] of Object.entries(cases)) assert.equal(suggestCategory(title), want, title);
  assert.equal(suggestCategory(''), null);
  assert.equal(suggestCategory('Misc. odd job'), null);
  assert.equal(suggestCategory('Antenna'), null, 'ant must not match antenna');
});

test('missing or unknown category reads as other', () => {
  assert.equal(repairCategory({ title: 'x' }), 'other');
  assert.equal(repairCategory({ category: 'nonsense' }), 'other');
  assert.equal(repairCategory({ category: 'roof' }), 'roof');
  const h = repairHistory(stateOf([rep({ category: undefined })]), 'Alder Court');
  assert.equal(h.items[0].category, 'other');
  assert.equal(repairTotals(h.items).byCategory[0].label, 'Other');
});

// ------------------------------------------------------------------ properties + slugs
test('propertySlug and unique slugs', () => {
  assert.equal(propertySlug('418 Marlow Street'), '418-marlow-street');
  assert.equal(propertySlug('Café  Row!'), 'cafe-row');
  assert.equal(propertySlug('<img src=x>'), 'img-src-x');
  assert.equal(propertySlug('   '), 'property');
  assert.match(propertySlug('x'.repeat(200)), /^[a-z0-9-]{1,60}$/);
  const ps = repairProperties(stateOf([rep({ property: 'Oak St' }), rep({ property: 'Oak  St.' }), rep({ property: 'oak st' })]), TODAY);
  assert.equal(ps.length, 2, 'same name in any case is one property');
  assert.deepEqual(ps.map(p => p.slug).sort(), ['oak-st', 'oak-st-2']);
  assert.equal(propertyBySlug(stateOf([rep({ property: 'Oak St' })]), 'nope', TODAY), null);
});

test('repairProperties: units, counts, this year, last, open', () => {
  const tenants = { t1: { name: 'A', property: 'Alder Court', unit: '1A', status: 'active' }, t2: { name: 'B', property: 'Fenwick Row', unit: 'No. 2', status: 'past' } };
  const st = stateOf([
    rep({ unit: '2B', completed: '2026-03-01', cost: 20000 }),
    rep({ unit: '', scope: 'building', completed: '2026-11-17', cost: 5000, title: 'Smoke detector' }),
    rep({ unit: '3C', completed: '2025-06-01', cost: 1000 }),
    rep({ unit: '1A', status: 'open', completed: null, reported: '2026-11-20', priority: 'urgent' }),
  ], tenants);
  const [alder, fen] = repairProperties(st, TODAY);
  assert.equal(alder.name, 'Alder Court');
  assert.deepEqual(alder.units, ['1A', '2B', '3C']);
  assert.equal(alder.count, 3);
  assert.equal(alder.total, 26000);
  assert.deepEqual(alder.thisYear, { count: 2, total: 25000 });
  assert.equal(alder.last.title, 'Smoke detector');
  assert.equal(alder.last.building, true);
  assert.equal(alder.open, 1); assert.equal(alder.urgent, 1);
  assert.equal(alder.firstDate, '2025-06-01');
  assert.equal(fen.count, 0); assert.equal(fen.unitCount, 1); assert.equal(fen.last, null);
});

// ------------------------------------------------------------------ history + filters
test('repairHistory: done only, newest first, filters, year groups, totals', () => {
  const st = stateOf([
    rep({ unit: '2B', category: 'plumbing', completed: '2026-05-01', cost: 30000, title: 'Sink leak', notes: 'new trap' }),
    rep({ unit: '2B', category: 'plumbing', completed: '2025-02-01', cost: 10000, paidBy: 'tenant' }),
    rep({ unit: '3C', category: 'pest', completed: '2026-07-01', cost: 5000 }),
    rep({ unit: '', category: 'roof', completed: '2024-09-01', cost: 100000 }),
    rep({ unit: '2B', status: 'scheduled', completed: null, reported: '2026-11-01' }),
    rep({ property: 'Elsewhere' }),
  ]);
  const all = repairHistory(st, 'Alder Court');
  assert.equal(all.count, 4);
  assert.deepEqual(all.items.map(k => k.date), ['2026-07-01', '2026-05-01', '2025-02-01', '2024-09-01']);
  assert.equal(all.total, 145000); assert.equal(all.tenantTotal, 10000); assert.equal(all.ownerTotal, 135000);
  assert.deepEqual(all.years.map(y => [y.year, y.count, y.total]), [['2026', 2, 35000], ['2025', 1, 10000], ['2024', 1, 100000]]);
  assert.equal(all.open.length, 1);
  assert.equal(all.firstDate, '2024-09-01');
  assert.equal(repairHistory(st, 'Alder Court', { unit: '2B', category: 'plumbing' }).count, 2);
  assert.equal(repairHistory(st, 'Alder Court', { unit: REPAIR_BUILDING }).items[0].category, 'roof');
  assert.equal(repairHistory(st, 'Alder Court', { year: '2026' }).count, 2);
  assert.equal(repairHistory(st, 'Alder Court', { q: 'NEW trap' }).count, 1, 'find searches notes, case-insensitive, all words');
  assert.equal(repairHistory(st, 'Alder Court', { q: 'whole building' }).count, 1);
  assert.equal(repairHistory(st, 'alder court').count, 4, 'property name match ignores case');
});

test('repairShowingText reads as a sentence', () => {
  const st = stateOf([
    rep({ unit: '2B', category: 'plumbing', completed: '2026-05-01', cost: 150000 }),
    rep({ unit: '2B', category: 'plumbing', completed: '2026-06-01', cost: 44000 }),
    rep({ unit: '3C', category: 'other', completed: '2026-06-01', cost: 1000 }),
  ]);
  assert.equal(repairShowingText(repairHistory(st, 'Alder Court', { unit: '2B', category: 'plumbing' })), 'Showing 2 plumbing repairs in Unit 2B — $1,940');
  assert.equal(repairShowingText(repairHistory(st, 'Alder Court')), 'Showing all 3 repairs — $1,950');
  assert.equal(repairShowingText(repairHistory(st, 'Alder Court', { category: 'other' })), 'Showing 1 repair marked Other — $10');
  assert.equal(repairShowingText(repairHistory(st, 'Alder Court', { unit: REPAIR_BUILDING, year: '2025' })), 'No repairs for the whole building in 2025');
  assert.equal(repairShowingText(repairHistory(st, 'Alder Court', { category: 'pest', q: 'mice' })), 'No pest repairs matching “mice”');
});

// ------------------------------------------------------------------ totals (chart data)
test('repairTotals: years without gaps up to today, categories and units largest first', () => {
  const list = items([
    rep({ unit: '2B', category: 'plumbing', completed: '2023-05-01', cost: 1000 }),
    rep({ unit: '2B', category: 'plumbing', completed: '2025-05-01', cost: 3000 }),
    rep({ unit: '3C', category: 'pest', completed: '2025-07-01', cost: 9000 }),
    rep({ unit: '', category: 'roof', completed: '2025-08-01', cost: 0 }),
  ]);
  const t = repairTotals(list, { today: TODAY });
  assert.deepEqual(t.byYear.map(y => [y.year, y.count, y.total]), [['2023', 1, 1000], ['2024', 0, 0], ['2025', 3, 12000], ['2026', 0, 0]]);
  assert.deepEqual(t.byCategory.map(c => [c.key, c.count, c.total]), [['pest', 1, 9000], ['plumbing', 2, 4000], ['roof', 1, 0]]);
  assert.deepEqual(t.byUnit.map(u => [u.unitKey, u.count, u.total, u.building]), [['3C', 1, 9000, false], ['2B', 2, 4000, false], [REPAIR_BUILDING, 1, 0, true]]);
  assert.equal(t.byUnit[1].last.date, '2025-05-01');
  assert.deepEqual(t.max, { year: 12000, category: 9000, unit: 9000 });
  assert.equal(t.total, 13000);
  assert.deepEqual(repairTotals([], { today: TODAY }).byYear, []);
});

// ------------------------------------------------------------------ repeat problems
test('repeatProblems: ≥3 same category + unit within 12 months', () => {
  const base = { unit: '2B', category: 'plumbing' };
  const three = items([rep({ ...base, completed: '2026-11-01', cost: 20000 }), rep({ ...base, completed: '2026-06-01', cost: 24000 }), rep({ ...base, completed: '2025-11-25', cost: 20000 })]);
  const r = repeatProblems(three, TODAY);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 3); assert.equal(r[0].windowDays, 365); assert.equal(r[0].total, 64000);
  assert.equal(r[0].text, 'Unit 2B has had 3 plumbing repairs in the last 12 months ($640)');
  // exactly 12 months ago is outside the window
  const edge = items([rep({ ...base, completed: '2026-11-01' }), rep({ ...base, completed: '2026-06-01' }), rep({ ...base, completed: '2025-11-24' })]);
  assert.equal(repeatProblems(edge, TODAY).length, 0);
  // different categories or different units don't add up
  const mixed = items([rep({ ...base, completed: '2026-11-01' }), rep({ ...base, unit: '2C', completed: '2026-06-01' }), rep({ ...base, category: 'electrical', completed: '2026-05-01' })]);
  assert.equal(repeatProblems(mixed, TODAY).length, 0);
});

test('repeatProblems: ≥2 within 90 days, whole building, open repairs count, future ignored', () => {
  const two = items([rep({ unit: 'No. 4', category: 'heating', completed: '2026-11-20', cost: 0 }), rep({ unit: 'No. 4', category: 'heating', completed: '2026-08-26', cost: 15000 })]);
  const r = repeatProblems(two, TODAY);
  assert.equal(r.length, 1); assert.equal(r[0].windowDays, 90);
  assert.equal(r[0].text, 'No. 4 has had 2 heating & cooling repairs in the last 90 days ($150)');
  const tooFar = items([rep({ unit: 'No. 4', category: 'heating', completed: '2026-11-20' }), rep({ unit: 'No. 4', category: 'heating', completed: '2026-08-25' })]);
  assert.equal(repeatProblems(tooFar, TODAY).length, 0, '91 days apart is outside');
  const bld = items([rep({ unit: '', category: 'roof', completed: '2026-10-01' }), rep({ unit: '', scope: 'building', category: 'roof', status: 'open', completed: null, reported: '2026-11-10' })]);
  const rb = repeatProblems(bld, TODAY);
  assert.equal(rb.length, 1);
  assert.match(rb[0].text, /^The whole building has had 2 roof & outside repairs in the last 90 days/);
  const future = items([rep({ completed: '2026-11-20' }), rep({ completed: '2026-12-20' })]);
  assert.equal(repeatProblems(future, TODAY).length, 0);
  // 12-month finding wins over the 90-day one for the same unit + category (one sentence only)
  const both = items(['2026-11-20', '2026-11-10', '2026-03-01'].map(d => rep({ unit: '1A', category: 'pest', completed: d })));
  const rr = repeatProblems(both, TODAY);
  assert.equal(rr.length, 1); assert.equal(rr[0].windowDays, 365); assert.equal(rr[0].count, 3);
});

test('repeatProblems: warranties still running', () => {
  const list = items([
    rep({ unit: '3A', title: 'New dishwasher', vendor: 'Halvorsen Appliance', warrantyUntil: '2027-03-15' }),
    rep({ unit: '3B', title: 'Old fridge', warrantyUntil: '2026-11-23' }),
    rep({ unit: '', title: 'New roof', warrantyUntil: '2036-01-01' }),
  ]);
  const w = repeatProblems(list, TODAY).filter(x => x.kind === 'warranty');
  assert.equal(w.length, 2);
  assert.equal(w[0].text, '“New dishwasher” in Unit 3A is under warranty until March 15, 2027. If it goes wrong, call Halvorsen Appliance first');
  assert.equal(w[1].text, '“New roof” for the whole building is under warranty until January 1, 2036');
});

// ------------------------------------------------------------------ CSV + text
test('repairsCsv and repairsText', () => {
  const list = items([rep({ unit: '2B', title: '=SUM(A1)', category: 'plumbing', vendor: 'Rooter, Inc.', cost: 18550, notes: 'line1\nline2', paidBy: 'tenant', completed: '2026-05-01' }), rep({ unit: '', category: undefined, cost: null, completed: '2026-04-01' })]);
  const c = repairsCsv(list).split('\r\n');
  assert.equal(c[0], 'Date,Property,Unit,What was fixed,Kind of repair,Who fixed it,Cost,Who paid,What was wrong,Notes,Under warranty until');
  assert.equal(c[1], `2026-05-01,Alder Court,2B,'=SUM(A1),Plumbing,"Rooter, Inc.",185.50,Tenant,,"line1\nline2",`);
  assert.equal(c[2], '2026-04-01,Alder Court,Whole building,Repair,Other,,0.00,Owner,,,');
  const t = repairsText(list, { title: 'Alder Court — repairs', showing: 'Showing all 2 repairs — $185.50' });
  assert.match(t, /^Alder Court — repairs\nShowing all 2 repairs — \$185\.50\n\nMay 1, 2026 · =SUM\(A1\) · Unit 2B · Plumbing · Rooter, Inc\. · \$185\.50 · tenant paid\n    line1 line2\n/);
});

// ------------------------------------------------------------------ sample data
test('sample: existing tenants, ledgers and six tickets unchanged (ids + contents) apart from category', async () => {
  const { createHash } = await import('node:crypto');
  const before = JSON.parse(readFileSync(join(HERE, 'fixtures', 'sample-v1-ids.json'), 'utf8'));
  const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  for (const today of Object.keys(before)) {
    const s = RB.sample.generate(today);
    const b = before[today];
    assert.deepEqual(Object.keys(s.tenants), b.tenantIds, today + ' tenant ids');
    assert.deepEqual(Object.values(s.ledgers).flatMap(l => Object.keys(l.entries)), b.entryIds, today + ' ledger entry ids');
    assert.equal(hash({ settings: s.settings, tenants: s.tenants, ledgers: s.ledgers }), b.hash, today + ' tenants/ledgers/settings contents');
    const ids = Object.keys(s.tickets);
    assert.deepEqual(ids.slice(0, 6), b.ticketIds, today + ' original ticket ids come first, unchanged');
    const six = Object.entries(s.tickets).slice(0, 6).map(([id, t]) => { const c = { ...t }; delete c.category; return [id, c]; });
    assert.equal(hash(six), b.ticketHash, today + ' original tickets unchanged apart from category');
    assert.deepEqual(ids.slice(0, 6).map(id => s.tickets[id].category), ['plumbing', 'electrical', 'roof', 'appliance', 'electrical', 'plumbing']);
  }
});

test('sample: ~45 past repairs with the shape SPEC §9 asks for', () => {
  for (const today of ['2026-11-24', '2025-03-01', '2027-07-31']) {
    const s = RB.sample.generate(today);
    const past = Object.entries(s.tickets).slice(6).map(([id, k]) => Mo.repairItem({ id, ...k }));
    assert.equal(past.length, 45);
    assert.ok(past.every(k => k.status === 'done' && k.sample === true && D.isDate(k.completed) && k.completed <= today && k.completed >= D.addMonths(today, -36)));
    assert.ok(past.every(k => Mo.REPAIR_CATEGORY_LABEL[k.category] && k.vendor));
    assert.equal(new Set(past.map(k => k.property)).size, 3);
    assert.ok(past.filter(k => k.building).length >= 8, 'whole-building work');
    assert.ok(past.some(k => k.building && /roof/i.test(k.title)) && past.some(k => k.building && /gutter/i.test(k.title)) && past.some(k => k.building && /boiler/i.test(k.title)));
    assert.equal(past.filter(k => k.warrantyUntil && k.warrantyUntil >= today).length, 1, 'one item under warranty');
    // tenants linked only when they lived there at the time
    for (const k of past.filter(x => x.tenantId)) { const t = s.tenants[k.tenantId]; assert.ok(t.unit === k.unit && t.lease.moveIn <= k.completed); }
    // the clear repeat problem: plumbing in Alder Court 2B — and it is the only one
    const st = { settings: s.settings, tenants: s.tenants, ledgers: {}, tickets: s.tickets };
    const props = repairProperties(st, today);
    const found = props.flatMap(p => repeatProblems(Mo.repairHistory(st, p.name).all.concat(Mo.repairHistory(st, p.name).open), today).filter(x => x.kind === 'repeat').map(x => p.name + ' ' + x.unitKey + ' ' + x.category));
    assert.deepEqual(found, ['Alder Court 2B plumbing'], today);
    assert.deepEqual(RB.sample.generate(today).tickets, s.tickets, 'deterministic');
  }
});

// views/reports.js — four reports chosen from rows. Each report: its key figure, the shared sentence(s) (law 7: the
// amount owed comes from RB.model.owed and is worded by ui.owedSentence, identical to Today, Rent and Tenants), one chart
// where it helps, then the table (desktop) or two-line rows (phone), and "Download for Excel" / "Copy" as text links.
// Totals agree with the sentence: debts and money paid ahead are never netted — "6 tenants owe $8,545 … 1 tenant has
// paid $250 ahead." and the total row says the same two figures. SPEC §8, §10.3.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;
const $ = c => M.fmt(c);

const TABS = [
  ['roll', 'Rent roll', 'Every unit, tenant and rent on one page'],
  ['aging', 'Who owes, and for how long', 'Unpaid rent, sorted by how long ago it was due'],
  ['collection', 'Money collected each month', 'How much of the rent came in, month by month'],
  ['income', 'Income for the year', 'For tax time: what each tenant paid you in a year'],
];
let tab = RB.prefs.get('reports:tab', 'roll');
if (!TABS.some(t => t[0] === tab)) tab = 'roll';
let year = null; // income year (null → current year)
const openGroups = new Set(); // rent roll on phone: properties opened in place
let groupNames = [];
let allRows = false;           // phone: the whole list on long reports (collection, income)
const more = (n, shown) => (n > shown + 1 ? h`<button type="button" class="rows-more" id="rp-more" data-act="allRows" aria-expanded="${String(allRows)}">${allRows ? 'Show fewer' : 'Show all ' + n}</button>` : '');
const cut = (list, shown) => (allRows || list.length <= shown + 1 ? list : list.slice(0, shown));

const pctTxt = r => (r == null ? '—' : Math.round(r * 100) + '%');
/** CSV → tab-separated text that pastes straight into spreadsheet cells. */
function csvToTsv(csv) { return RB.model.parseDelimited(csv).map(r => r.map(c => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n'); }
function niceAxis(max, ticks) {
  if (!(max > 0)) return { max: 100000, step: 25000 };
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw);
  return { max: Math.ceil(max / step) * step, step };
}
function axisMoney(c) {
  const d = c / 100;
  if (d >= 1000) return M.symbol + (d / 1000).toFixed(d % 1000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return M.symbol + Math.round(d);
}
const unitWord = u => (ui.place ? ui.place({ unit: u }) : 'Unit ' + u) || 'No unit';
const monthOf = id => { const lg = S().ledger(id); return lg && lg.current.status !== 'none' ? lg.months[lg.current.period] || null : null; };
/** This month's status as a marker in glossary words ("Part paid — rest is 22 days late"). */
function monthStatus(id) {
  const m = monthOf(id);
  if (!m || m.status === 'none') return ui.status('none', 'No rent this month');
  const kind = m.status === 'late' && m.rentPaid > 0 ? 'partial_late' : m.status;
  return ui.status(kind, ui.statusWords(m, S().today()));
}
const monthWords = id => { const m = monthOf(id); return m && m.status !== 'none' ? ui.statusWords(m, S().today()) : null; };
/** Plain words for a balance: "$675" owed · "$250 paid ahead" · "All paid up" (ink — law 5). */
const balText = c => (c > 0 ? $(c) : c < 0 ? $(-c) + ' paid ahead' : 'All paid up');
const nameLink = (id, name) => h`<a class="rp-name" href="#t-${id}">${name}</a>`;
/** The amount owed, worded once (law 7), plus money paid ahead — never netted against it. */
function owedWords(rows) {
  const o = ui.owed();
  const ahead = rows.filter(r => r.balance < 0);
  const aheadSum = ahead.reduce((s, r) => s - r.balance, 0);
  return { o, ahead: ahead.length, aheadSum, sentence: ui.owedSentence(o) + (ahead.length ? ' ' + (ahead.length === 1 ? '1 tenant has' : ahead.length + ' tenants have') + ' paid ' + $(aheadSum) + ' ahead.' : '') };
}
const fig = (amount, words) => h`<p class="rp-display"><span class="rp-fig t-display" id="rp-fig">${amount}</span> ${words}</p>`;

// ------------------------------------------------------------------ report builders: {title, file, csv, answer, body, extra}
function rentRoll(today) {
  const rr = S().rentRoll();
  const groups = [];
  rr.rows.forEach(r => { let g = groups.find(x => x.property === r.property); if (!g) groups.push(g = { property: r.property, rows: [] }); g.rows.push(r); });
  groups.forEach(g => {
    const cur = g.rows.filter(r => r.status !== 'past');
    g.rent = cur.reduce((s, r) => s + r.rent, 0); g.deposit = g.rows.reduce((s, r) => s + r.deposit, 0);
    g.owed = g.rows.reduce((s, r) => s + Math.max(0, r.balance), 0); g.ahead = g.rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);
    g.occupied = new Set(cur.map(r => r.unit)).size; g.units = new Set(g.rows.map(r => r.unit)).size;
  });
  const occ = rr.occupancy;
  groupNames = groups.map(g => g.property);
  if (groups.length === 1) openGroups.add(groups[0].property);
  const ow = owedWords(rr.rows);
  const owedTotal = rr.rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const end = r => r.status === 'past' ? 'Moved out ' + ui.dateWords(r.moveOut || r.leaseEnd, today) : r.status === 'notice' && r.moveOut ? 'Moving out ' + ui.dateWords(r.moveOut, today) : r.leaseEnd ? 'Ends ' + ui.dateWords(r.leaseEnd, today) : 'Month-to-month';
  const endShort = r => r.status === 'past' ? 'moved out ' + D.fmtLong(r.moveOut || r.leaseEnd).replace(', ' + today.slice(0, 4), '')
    : r.status === 'notice' && r.moveOut ? 'moving out ' + D.fmtLong(r.moveOut).replace(', ' + today.slice(0, 4), '')
    : r.leaseEnd ? 'until ' + D.fmtMonth(D.monthKey(r.leaseEnd)) : 'month-to-month';
  const owesCell = r => (r.balance > 0 ? $(r.balance) : r.balance < 0 ? $(-r.balance) + ' ahead' : h`<span class="rp-dash">—</span>`);
  const totalOwes = (owed, ahead, attr) => h`<span${attr ? h` data-total="owed"` : ''}>${$(owed)}</span>${ahead ? h`<span class="rp-ahead"${attr ? h` data-total="ahead"` : ''}>${$(ahead)} paid ahead</span>` : ''}`;
  const answer = h`${fig($(rr.totals.rent), 'rent each month.')}
    <p>${occ.occupied} of ${occ.units} units have a tenant (${Math.round(occ.rate * 100)}%), and you hold ${$(rr.totals.deposit)} in deposits.</p>
    <p id="rp-owed">${ow.sentence}</p>`;
  const body = h`
    <div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-roll">
      <thead><tr><th>Unit</th><th>Tenant</th><th class="num">Rent each month</th><th>Lease</th><th class="num">Deposit</th><th class="num">Owes</th><th>This month</th></tr></thead>
      ${groups.map(g => h`<tbody>
        <tr class="tbl-group"><td colspan="7">${g.property || 'No property'} — ${g.occupied} of ${g.units} units have a tenant</td></tr>
        ${g.rows.map(r => h`<tr class="${r.status === 'past' ? 'is-muted' : ''}" data-tenant="${r.tenantId}">
          <td>${ui.plate(r.unit)}</td><td>${nameLink(r.tenantId, r.name)}</td>
          <td class="num">${r.status === 'past' ? h`<span class="rp-dash">—</span>` : $(r.rent)}</td>
          <td>${end(r)}</td>
          <td class="num">${r.deposit ? $(r.deposit) : h`<span class="rp-dash">None</span>`}</td>
          <td class="num">${owesCell(r)}</td><td>${r.status === 'past' ? ui.status('none', 'Moved out') : monthStatus(r.tenantId)}</td></tr>`)}
        <tr class="rp-subtotal"><td></td><td>${g.property} in total</td><td class="num">${$(g.rent)}</td><td></td><td class="num">${$(g.deposit)}</td><td class="num">${totalOwes(g.owed, g.ahead)}</td><td></td></tr>
      </tbody>`)}
      <tfoot><tr class="rp-total"><td></td><td>Everyone (${RB.plural(rr.rows.length, 'tenant')})</td><td class="num" data-total="rent">${$(rr.totals.rent)}</td><td></td><td class="num" data-total="deposit">${$(rr.totals.deposit)}</td><td class="num">${totalOwes(owedTotal, ow.aheadSum, true)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="show-phone" id="rp-roll-rows">
      ${groups.map(g => {
        const open = openGroups.has(g.property);
        const owing = g.rows.filter(r => r.balance > 0).length;
        return open ? h`<div class="rp-group" data-group="${g.property}">${ui.rowsHead(g.property || 'No property', g.occupied + ' of ' + g.units + ' let')}
          ${ui.rows(g.rows.map(r => ({
            title: r.name, sub: [unitWord(r.unit), endShort(r)].join(' · '),
            amt: r.status === 'past' ? '' : $(r.rent),
            status: r.balance > 0 ? ui.status(monthOf(r.tenantId) && monthOf(r.tenantId).status === 'late' ? (monthOf(r.tenantId).rentPaid > 0 ? 'partial_late' : 'late') : 'partial', 'Owes ' + $(r.balance))
              : r.balance < 0 ? ui.status('paid', $(-r.balance) + ' paid ahead') : r.status === 'past' ? ui.status('none', 'Moved out') : monthStatus(r.tenantId),
            href: '#t-' + r.tenantId, attrs: { 'data-tenant': r.tenantId },
          })), { inset: true })}
          <button type="button" class="rows-more" data-act="group" data-group="${g.property}" aria-expanded="true">Fold ${g.property} away</button></div>`
          : ui.rows([{ title: g.property || 'No property', sub: g.occupied + ' of ' + g.units + ' units let' + (owing ? ' · ' + owing + ' owe ' + $(g.owed) : ' · nobody owes'), amt: $(g.rent),
            act: 'group', attrs: { 'data-group': g.property, 'aria-expanded': 'false' } }], { inset: true, cls: 'rp-group-rows' });
      })}
      ${groups.length > 1 ? h`<button type="button" class="rows-more" id="rp-roll-all" data-act="allGroups" aria-expanded="${String(openGroups.size === groups.length)}">${openGroups.size === groups.length ? 'Fold every property away' : 'Show every unit'}</button>` : ''}
      <p class="rp-total-line" id="rp-roll-total">Everyone: ${$(rr.totals.rent)} rent each month · owes <span data-total="owed">${$(owedTotal)}</span>${ow.aheadSum ? h` · <span data-total="ahead">${$(ow.aheadSum)}</span> paid ahead` : ''}.</p>
    </div>`;
  const statusWord = r => (r.status === 'past' ? 'Moved out' : r.status === 'notice' ? 'Moving out' : 'Living there');
  const csv = () => RB.model.csv(rr.rows, [
    { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' }, { label: 'Tenant', key: 'name' }, { label: 'Status', get: statusWord },
    { label: 'Rent each month', key: 'rent', money: true }, { label: 'Lease started', key: 'leaseStart' }, { label: 'Lease ends', get: r => r.leaseEnd || 'Month-to-month' },
    { label: 'Deposit', key: 'deposit', money: true }, { label: 'Owes', money: true, get: r => Math.max(0, r.balance) }, { label: 'Paid ahead', money: true, get: r => Math.max(0, -r.balance) },
    { label: 'This month', get: r => (r.status === 'past' ? 'Moved out' : monthWords(r.tenantId) || 'No rent this month') },
  ]);
  return { title: 'Rent roll', file: 'rent-roll', csv, answer, body };
}

const AGES = [['d0_30', 'Under a month'], ['d31_60', '1 to 2 months'], ['d61_90', '2 to 3 months'], ['d90', 'Over 3 months']];
function aging(today) {
  const ag = S().aging();
  const none = S().tenantsList().length - ag.rows.length;
  const cell = v => (v ? $(v) : h`<span class="rp-dash">—</span>`);
  const rows = ag.rows.slice().sort((a, b) => b.total - a.total);
  const ow = owedWords(S().rentRoll().rows);
  let answer;
  if (ag.rows.length) {
    const top = rows[0];
    const lg = S().ledger(top.tenantId);
    const since = lg && lg.oldestOpenDate ? D.monthName(D.monthKey(lg.oldestOpenDate)) + (lg.oldestOpenDate.slice(0, 4) !== today.slice(0, 4) ? ' ' + lg.oldestOpenDate.slice(0, 4) : '') : null;
    answer = h`${fig($(ag.totals.total), 'is owed to you.')}
      <p id="rp-owed">${ow.sentence}</p>
      <p>${top.name} owes the most: ${$(top.total)}${since ? h`, going back to ${since}` : ''}.${ag.totals.d90 ? h` ${$(ag.totals.d90)} has been owed for over 3 months.` : ''} ${none === 1 ? '1 tenant owes' : none + ' tenants owe'} nothing.</p>`;
  } else answer = h`<p id="rp-owed">Nobody owes you anything. Every charge is paid.</p>`;
  const oldest = r => { for (let i = AGES.length - 1; i >= 0; i--) if (r[AGES[i][0]]) return AGES[i]; return AGES[0]; };
  const body = ag.rows.length ? h`
    <figure class="rp-ages" aria-label="How long the money has been owed">
      <div class="rp-agebar">${AGES.map(([k], i) => ag.totals[k] ? h`<span class="rp-age rp-age-${i}" style="flex-grow:${ag.totals[k]}" data-v="${ag.totals[k]}"></span>` : '')}</div>
      <figcaption class="rp-agekeys">${AGES.map(([k, l], i) => h`<span class="rp-agekey rp-age-${i}">${l}: ${$(ag.totals[k])}</span>`)}</figcaption>
    </figure>
    <div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-aging">
      <thead><tr><th>Tenant</th>${AGES.map(([, l]) => h`<th class="num">${l}</th>`)}<th class="num">Total owed</th></tr></thead>
      <tbody>${rows.map(r => h`<tr data-tenant="${r.tenantId}"><td><span class="rp-who">${ui.plate(r.unit)}${nameLink(r.tenantId, r.name)}</span></td>
        ${AGES.map(([k]) => h`<td class="num">${cell(r[k])}</td>`)}<td class="num">${$(r.total)}</td></tr>`)}</tbody>
      <tfoot><tr><td>Everyone</td>${AGES.map(([k]) => h`<td class="num" data-total="${k}">${$(ag.totals[k])}</td>`)}<td class="num" data-total="total">${$(ag.totals.total)}</td></tr></tfoot>
    </table></div>
    <div class="show-phone" id="rp-aging-rows">
      ${ui.rows(rows.map(r => {
        const o = oldest(r);
        return { lead: ui.plate(r.unit), title: r.name, sub: monthWords(r.tenantId) || unitWord(r.unit), amt: $(r.total),
          status: ui.status(o[0] === 'd0_30' ? 'partial' : 'late', o[1]), href: '#t-' + r.tenantId, attrs: { 'data-tenant': r.tenantId } };
      }), { inset: true })}
      <p class="rp-total-line">Everyone: <span data-total="total">${$(ag.totals.total)}</span> owed.</p>
    </div>
    <p class="rp-caption">The marker on each row says how long ago the oldest unpaid amount was due.</p>`
    : '';
  const csv = () => RB.model.csv(rows.concat([Object.assign({ name: 'Everyone', property: '', unit: '' }, ag.totals)]), [
    { label: 'Tenant', key: 'name' }, { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' },
  ].concat(AGES.map(([k, l]) => ({ label: l, key: k, money: true })), [{ label: 'Total owed', key: 'total', money: true }]));
  return { title: 'Who owes, and for how long', file: 'who-owes', csv, answer, body };
}

function collection(today) {
  const rows = S().collectionByMonth(12);
  const tot = rows.reduce((a, r) => ({ charged: a.charged + r.charged, collected: a.collected + r.collected, outstanding: a.outstanding + r.outstanding }), { charged: 0, collected: 0, outstanding: 0 });
  const rate = tot.charged ? tot.collected / tot.charged : null;
  const ax = niceAxis(Math.max(1, ...rows.map(r => Math.max(r.charged, r.collected))), 4);
  const ticks = []; for (let v = 0; v <= ax.max + 1; v += ax.step) ticks.push(v);
  const y = v => (v / ax.max) * 100;
  const fx = n => n.toFixed(3) + '%';
  const curKey = D.monthKey(today);
  const cur = rows[rows.length - 1];
  const answer = h`${fig(pctTxt(rate), 'of the rent came in over the last 12 months.')}
    <p>Over the last 12 months you collected ${$(tot.collected)} of the ${$(tot.charged)} charged — ${pctTxt(rate)}.${cur && cur.period === curKey ? h` ${D.monthName(cur.period)} so far: ${$(cur.collected)} of ${$(cur.charged)}${cur.outstanding ? h`, with ${$(cur.outstanding)} still to come in` : ''}.` : ''}</p>`;
  const monthLabel = k => D.monthName(k) + ' ' + k.slice(0, 4);
  const body = h`
    <figure class="rp-chart" id="rp-chart">
      <div class="rp-chart-plot" data-axis-max="${ax.max}" role="img" aria-label="Rent charged and money collected each month, ${D.fmtMonth(rows[0].period)} to ${D.fmtMonth(rows[rows.length - 1].period)}">
        ${ticks.map(v => h`<div class="rp-tick" style="bottom:${fx(y(v))}"><span class="rp-tick-label">${axisMoney(v)}</span></div>`)}
        <div class="rp-bars">${rows.map(r => h`<div class="rp-month${r.period === curKey ? ' is-current' : ''}">
          <div class="rp-col">
            <span class="rp-charged" style="height:${fx(y(r.charged))}" data-v="${r.charged}"></span>
            <span class="rp-collected" style="height:${fx(y(r.collected))}" data-v="${r.collected}"></span>
            ${r.rate != null ? h`<span class="rp-rate" style="bottom:${fx(y(Math.max(r.charged, r.collected)))}">${Math.round(r.rate * 100)}%</span>` : ''}
          </div>
          <span class="rp-xlab">${D.MON[+r.period.slice(5, 7) - 1]}</span>
        </div>`)}</div>
      </div>
      <figcaption class="rp-legend"><span class="rp-key rp-key-charged">Rent charged</span><span class="rp-key rp-key-collected">Money collected</span>
        <span class="rp-legend-note">The number above each month is how much of that month’s rent came in. ${D.monthName(curKey)} is not finished yet.</span></figcaption>
    </figure>
    <div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-collection">
      <thead><tr><th>Month</th><th class="num">Rent charged</th><th class="num">Money collected</th><th class="num">Still owed</th><th class="num">How much came in</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => h`<tr><td>${monthLabel(r.period)}${r.period === curKey ? ' (so far)' : ''}</td><td class="num">${$(r.charged)}</td><td class="num">${$(r.collected)}</td><td class="num">${r.outstanding ? $(r.outstanding) : h`<span class="rp-dash">—</span>`}</td><td class="num">${pctTxt(r.rate)}</td></tr>`)}</tbody>
      <tfoot><tr><td>12 months</td><td class="num" data-total="charged">${$(tot.charged)}</td><td class="num" data-total="collected">${$(tot.collected)}</td><td class="num">${$(tot.outstanding)}</td><td class="num">${pctTxt(rate)}</td></tr></tfoot>
    </table></div>
    <div class="show-phone">
      ${ui.rows(cut(rows.slice().reverse(), 6).map(r => ({ title: monthLabel(r.period) + (r.period === curKey ? ' (so far)' : ''), sub: 'of ' + $(r.charged) + ' charged — ' + pctTxt(r.rate), amt: $(r.collected) })), { inset: true })}
      ${more(rows.length, 6)}
      <p class="rp-total-line">12 months: <span data-total="collected">${$(tot.collected)}</span> of <span data-total="charged">${$(tot.charged)}</span> — ${pctTxt(rate)}.</p>
    </div>`;
  const csv = () => RB.model.csv(rows, [
    { label: 'Month', get: r => monthLabel(r.period) }, { label: 'Rent charged', key: 'charged', money: true }, { label: 'Money collected', key: 'collected', money: true },
    { label: 'Still owed', key: 'outstanding', money: true }, { label: 'How much came in', get: r => (r.rate == null ? '' : (r.rate * 100).toFixed(1) + '%') },
  ]);
  return { title: 'Money collected each month', file: 'money-collected', csv, answer, body };
}

function firstYear(today) {
  let y = +today.slice(0, 4);
  S().tenantsList().forEach(t => { const f = t.trackFrom || (t.lease || {}).moveIn; if (f && +f.slice(0, 4) < y) y = +f.slice(0, 4); });
  return y;
}
function income(today) {
  const cy = +today.slice(0, 4);
  const lo = Math.min(firstYear(today), cy);
  const yr = year == null ? cy : Math.max(lo, Math.min(cy, year));
  const inc = S().incomeByYear(yr);
  const ytd = yr === cy;
  const answer = h`${fig($(inc.totals.payments), 'received in rent in ' + yr + (ytd ? ' so far.' : '.'))}
    <p>From ${RB.plural(inc.rows.length, 'tenant')}.${inc.totals.credits ? h` You took ${$(inc.totals.credits)} off what tenants owed.` : ''} Counted on the day the money arrived, as the tax office usually wants.</p>`;
  const extra = h`<div class="rp-year" role="group" aria-label="Which year?">
      <button type="button" class="btn-link" id="rp-year-prev" data-act="year" data-d="-1"${yr <= lo ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}<span>Previous year</span></button>
      <span class="rp-year-label" id="rp-year-label">${yr}</span>
      <button type="button" class="btn-link" id="rp-year-next" data-act="year" data-d="1"${yr >= cy ? RB.raw(' disabled') : ''}><span>Next year</span>${ui.icon('chevron-right')}</button></div>`;
  const body = inc.rows.length ? h`<div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-income">
      <thead><tr><th>Tenant</th><th>Property</th><th class="num">Number of payments</th><th class="num">Received</th><th class="num">Money off</th></tr></thead>
      <tbody>${inc.rows.map(r => h`<tr data-tenant="${r.tenantId}"><td><span class="rp-who">${ui.plate(r.unit)}${nameLink(r.tenantId, r.name)}</span></td>
        <td>${r.property}</td><td class="num">${r.count}</td><td class="num">${$(r.payments)}</td><td class="num">${r.credits ? $(r.credits) : h`<span class="rp-dash">—</span>`}</td></tr>`)}</tbody>
      <tfoot><tr><td>Everyone</td><td></td><td class="num">${inc.rows.reduce((s, r) => s + r.count, 0)}</td><td class="num" data-total="payments">${$(inc.totals.payments)}</td><td class="num" data-total="credits">${$(inc.totals.credits)}</td></tr></tfoot>
    </table></div>
    <div class="show-phone">
      ${ui.rows(cut(inc.rows, 10).map(r => ({ lead: ui.plate(r.unit), title: r.name, sub: r.credits ? $(r.credits) + ' taken off' : '', amt: $(r.payments), href: '#t-' + r.tenantId })), { inset: true })}
      ${more(inc.rows.length, 10)}
      <p class="rp-total-line">Everyone: <span data-total="payments">${$(inc.totals.payments)}</span>.</p>
    </div>`
    : ui.empty({ quiet: true, title: 'No payments in ' + yr + '. Payments you record with a date in ' + yr + ' add up here.' });
  const csv = () => RB.model.csv(inc.rows.concat([Object.assign({ name: 'Everyone', property: '', unit: '', count: '' }, inc.totals)]), [
    { label: 'Tenant', key: 'name' }, { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' },
  ].concat(D.MONTHS.map((m, i) => ({ label: m, money: true, get: r => r.byMonth[i] })), [{ label: 'Total received', key: 'payments', money: true }, { label: 'Money off', key: 'credits', money: true }]));
  return { title: 'Income for ' + yr, file: 'income-' + yr, csv, answer, body, extra };
}

const BUILD = { roll: rentRoll, aging, collection, income };

RB.views.register('reports', {
  title: 'Reports',
  render(el, ctx) {
    const rep = BUILD[tab](ctx.today);
    el.innerHTML = String(h`
      <p class="rp-jump show-phone"><a class="btn-link" href="#rp-choose-h" data-act="jump">Choose another report</a></p>
      <nav class="rp-choose" aria-labelledby="rp-choose-h"><h2 class="rows-head" id="rp-choose-h">Reports</h2> aria-label="Which report?">${ui.rows(TABS.map(([k, label, sub]) => ({
        title: label, sub, act: 'tab', cls: 'rp-choice' + (tab === k ? ' is-current' : ''),
        attrs: { id: 'rp-tab-' + k, 'data-tab': k, 'aria-current': tab === k ? 'true' : null },
      })), { cls: 'rp-choose-rows' })}</nav>
      <section class="rp-report" aria-labelledby="rp-title" data-report="${tab}">
        <h2 class="rp-title" id="rp-title">${rep.title}</h2>
        ${rep.extra || ''}
        <div class="rp-answer" id="rp-meta">${rep.answer}</div>
        ${rep.body}
        <p class="rp-actions">
          <button type="button" class="btn-link" id="rp-csv" data-act="csv">Download for Excel</button>
          <button type="button" class="btn-link" id="rp-copy" data-act="copy">Copy for a spreadsheet</button>
        </p>
        <p class="rp-caption rp-actions-note">“Download for Excel” saves this table as a file that opens in Excel, Numbers or Google Sheets.</p>
      </section>`);
    ui.bind(el, {
      jump: (a, e) => { if (e) e.preventDefault(); const t = el.querySelector('#rp-choose-h'); if (t) t.scrollIntoView({ block: 'start' }); const f = el.querySelector('.rp-choice'); if (f) f.focus({ preventScroll: true }); },
      allRows: () => { allRows = !allRows; RB.shell.refresh(); },
      tab: b => { allRows = false; tab = b.dataset.tab; RB.prefs.set('reports:tab', tab); RB.shell.refresh(); const t = el.querySelector('#rp-title'); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: 'start' }); },
      csv: () => RB.actions.downloadFile(rep.file + '-' + ctx.today + '.csv', rep.csv(), 'text/csv'),
      copy: () => ui.copy(csvToTsv(rep.csv()), 'report'),
      group: b => { const g = b.dataset.group; if (openGroups.has(g)) openGroups.delete(g); else openGroups.add(g); RB.shell.refresh(); },
      allGroups: () => { const all = openGroups.size === groupNames.length; openGroups.clear(); if (!all) groupNames.forEach(g => openGroups.add(g)); RB.shell.refresh(); },
      year: b => { const cy = +ctx.today.slice(0, 4); year = (year == null ? cy : year) + +b.dataset.d; RB.shell.refresh(); },
    });
  },
});

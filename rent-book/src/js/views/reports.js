// views/reports.js — four reports chosen with big worded buttons. Each opens with one or two plain sentences that
// state the answer, then the table (cards on phone), captions, and Download for Excel + Copy. SPEC §8.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;
const T = (RB._tn = RB._tn || {});
const W = () => T.W;
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
/** This month's status in glossary words for a tenant (part payments spelled out). */
function monthWords(tenantId, status) {
  const lg = S().ledger(tenantId);
  const p = lg && W().partial(lg, S().today());
  if (p) return p.late ? 'Part paid — rest is ' + W().days(p.daysLate) + ' late' : 'Part paid';
  if (status === 'late') return lg ? W().days(lg.current.daysLate) + ' late' : 'Late';
  return { paid: 'Paid', paid_late: 'Paid late', partial: 'Part paid', due: 'Not paid yet' }[status] || null;
}
const monthPill = (tenantId, status) => { const w = monthWords(tenantId, status); return w ? ui.pill(status, { label: w }) : h`<span class="rp-dash">No rent this month</span>`; };
const balWords = c => (c > 0 ? h`<span class="tone-bad">Owes ${$(c)}</span>` : c < 0 ? h`${$(-c)} paid ahead` : h`<span class="rp-dash">All paid up</span>`);
const partCount = rows => rows.filter(r => { const lg = S().ledger(r.tenantId); return lg && W().partial(lg, S().today()); }).length;
const who = (id, name, unit) => h`<span class="rp-who">${ui.plate(unit)}<button type="button" class="rp-name" data-act="open" data-id="${id}">${name}</button></span>`;

// ------------------------------------------------------------------ report builders: {title, file, csv, answer, body, extra}
function rentRoll(today) {
  const rr = S().rentRoll();
  const groups = [];
  rr.rows.forEach(r => { let g = groups.find(x => x.property === r.property); if (!g) groups.push(g = { property: r.property, rows: [] }); g.rows.push(r); });
  groups.forEach(g => {
    const cur = g.rows.filter(r => r.status !== 'past');
    g.rent = cur.reduce((s, r) => s + r.rent, 0); g.deposit = g.rows.reduce((s, r) => s + r.deposit, 0); g.balance = g.rows.reduce((s, r) => s + r.balance, 0);
    g.occupied = new Set(cur.map(r => r.unit)).size; g.units = new Set(g.rows.map(r => r.unit)).size;
  });
  const occ = rr.occupancy;
  const owing = rr.rows.filter(r => r.balance > 0);
  const owedSum = owing.reduce((a, r) => a + r.balance, 0);
  const parts = partCount(owing);
  const end = r => r.status === 'past' ? h`Moved out ${W().date(r.moveOut || r.leaseEnd, today)}` : r.status === 'notice' && r.moveOut ? h`Moving out ${W().date(r.moveOut, today)}` : r.leaseEnd ? W().date(r.leaseEnd, today) : 'Month-to-month';
  const answer = h`<p><strong>${occ.occupied} of ${occ.units} units</strong> have a tenant (${Math.round(occ.rate * 100)}%). Rent each month comes to <strong>${$(rr.totals.rent)}</strong>, and you hold ${$(rr.totals.deposit)} in deposits.</p>
    <p>${owing.length ? h`${owing.length === 1 ? '1 tenant owes' : owing.length + ' tenants owe'} a total of <strong class="tone-bad">${$(owedSum)}</strong>${parts ? h` — ${parts} of the ${owing.length} ${parts === 1 ? 'has' : 'have'} paid part of this month` : ''}.` : 'Nobody owes anything.'}</p>`;
  const body = h`
    <div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-roll">
      <thead><tr><th>Unit</th><th>Tenant</th><th class="num">Rent each month</th><th>Lease ends</th><th class="num">Deposit</th><th class="num">Owes</th><th>This month</th></tr></thead>
      ${groups.map(g => h`<tbody>
        <tr class="tbl-group"><td colspan="7">${g.property || 'No property'} <span class="rp-group-meta">— ${g.occupied} of ${g.units} units have a tenant</span></td></tr>
        ${g.rows.map(r => h`<tr class="${r.status === 'past' ? 'is-muted' : ''}" data-tenant="${r.tenantId}">
          <td>${ui.plate(r.unit)}</td><td><button type="button" class="rp-name" data-act="open" data-id="${r.tenantId}">${r.name}</button></td>
          <td class="num">${r.status === 'past' ? h`<span class="rp-dash">—</span>` : ui.money(r.rent)}</td>
          <td>${end(r)}</td>
          <td class="num">${r.deposit ? ui.money(r.deposit) : h`<span class="rp-dash">None</span>`}</td>
          <td class="num">${balWords(r.balance)}</td><td>${r.status === 'past' ? h`<span class="rp-dash">Moved out</span>` : monthPill(r.tenantId, r.monthStatus)}</td></tr>`)}
        <tr class="rp-subtotal"><td></td><td>${g.property} in total</td><td class="num">${ui.money(g.rent)}</td><td></td><td class="num">${ui.money(g.deposit)}</td><td class="num">${balWords(g.balance)}</td><td></td></tr>
      </tbody>`)}
      <tfoot><tr class="rp-total"><td></td><td>Everyone (${RB.plural(rr.rows.length, 'tenant')})</td><td class="num" data-total="rent">${ui.money(rr.totals.rent)}</td><td></td><td class="num" data-total="deposit">${ui.money(rr.totals.deposit)}</td><td class="num" data-total="balance">${balWords(rr.totals.balance)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="show-phone rp-cards">
      ${groups.map(g => h`<h3 class="rp-ph-group">${g.property} <span class="rp-group-meta">— ${g.occupied} of ${g.units} units have a tenant</span></h3>
        ${g.rows.map(r => h`<div class="rp-card${r.status === 'past' ? ' is-past' : ''}">
          <div class="rp-card-head">${who(r.tenantId, r.name, r.unit)}</div>
          <dl class="rp-card-facts">
            <div><dt>Rent each month</dt><dd>${r.status === 'past' ? '—' : $(r.rent)}</dd></div>
            <div><dt>Lease ends</dt><dd>${end(r)}</dd></div>
            <div><dt>Deposit</dt><dd>${r.deposit ? $(r.deposit) : 'None'}</dd></div>
            <div><dt>Owes</dt><dd>${balWords(r.balance)}</dd></div>
            ${r.status !== 'past' ? h`<div><dt>This month</dt><dd>${monthPill(r.tenantId, r.monthStatus)}</dd></div>` : ''}
          </dl></div>`)}
        <p class="rp-ph-sub">${g.property} in total: ${$(g.rent)} rent each month.</p>`)}
    </div>`;
  const statusWord = r => (r.status === 'past' ? 'Moved out' : r.status === 'notice' ? 'Moving out' : 'Living there');
  const csv = () => RB.model.csv(rr.rows, [
    { label: 'Property', key: 'property' }, { label: 'Unit', key: 'unit' }, { label: 'Tenant', key: 'name' }, { label: 'Status', get: statusWord },
    { label: 'Rent each month', key: 'rent', money: true }, { label: 'Lease started', key: 'leaseStart' }, { label: 'Lease ends', get: r => r.leaseEnd || 'Month-to-month' },
    { label: 'Deposit', key: 'deposit', money: true }, { label: 'Owes', money: true, get: r => Math.max(0, r.balance) }, { label: 'Paid ahead', money: true, get: r => Math.max(0, -r.balance) },
    { label: 'This month', get: r => (r.status === 'past' ? 'Moved out' : monthWords(r.tenantId, r.monthStatus) || 'No rent this month') },
  ]);
  return { title: 'Rent roll', file: 'rent-roll', csv, answer, body };
}

const AGES = [['d0_30', 'Under a month'], ['d31_60', '1 to 2 months'], ['d61_90', '2 to 3 months'], ['d90', 'Over 3 months']];
function aging(today) {
  const ag = S().aging();
  const none = S().tenantsList().length - ag.rows.length;
  const cell = v => v ? ui.money(v, { tone: 'owed' }) : h`<span class="rp-dash">—</span>`;
  let answer;
  if (ag.rows.length) {
    const top = ag.rows.slice().sort((a, b) => b.total - a.total)[0];
    const lg = S().ledger(top.tenantId);
    const since = lg && lg.oldestOpenDate ? W().monthOf(lg.oldestOpenDate, today) : null;
    const parts = partCount(ag.rows);
    answer = h`<p><strong>${ag.rows.length === 1 ? '1 tenant owes' : ag.rows.length + ' tenants owe'} a total of <span class="tone-bad">${$(ag.totals.total)}</span>.</strong> ${top.name} owes the most: ${$(top.total)}${since ? h`, going back to ${since}` : ''}.</p>
      <p>${parts ? h`${parts} of the ${ag.rows.length} ${parts === 1 ? 'has' : 'have'} paid part of this month. ` : ''}${ag.totals.d90 ? h`${$(ag.totals.d90)} has been owed for over 3 months. ` : ''}${none === 1 ? '1 tenant owes' : none + ' tenants owe'} nothing.</p>`;
  } else answer = h`<p><strong>Nobody owes anything.</strong> Every charge is paid.</p>`;
  const body = ag.rows.length ? h`
    <p class="tn-caption">The columns show how long ago each unpaid amount was due.</p>
    <div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-aging">
      <thead><tr><th>Tenant</th>${AGES.map(([, l]) => h`<th class="num">${l}</th>`)}<th class="num">Total owed</th></tr></thead>
      <tbody>${ag.rows.map(r => h`<tr data-tenant="${r.tenantId}"><td>${who(r.tenantId, r.name, r.unit)}${monthWords(r.tenantId) && W().partial(S().ledger(r.tenantId), today) ? h`<div class="rp-sub">${monthWords(r.tenantId)}</div>` : ''}</td>
        ${AGES.map(([k]) => h`<td class="num">${cell(r[k])}</td>`)}<td class="num strong">${ui.money(r.total, { tone: 'owed' })}</td></tr>`)}</tbody>
      <tfoot><tr><td>Everyone</td>${AGES.map(([k]) => h`<td class="num" data-total="${k}">${ui.money(ag.totals[k])}</td>`)}<td class="num" data-total="total">${ui.money(ag.totals.total)}</td></tr></tfoot>
    </table></div>
    <div class="show-phone rp-cards">${ag.rows.map(r => {
      const p = W().partial(S().ledger(r.tenantId), today);
      return h`<div class="rp-card">
        <div class="rp-card-head">${who(r.tenantId, r.name, r.unit)}<span class="rp-card-total tone-bad">Owes ${$(r.total)}</span></div>
        ${p ? h`<p class="rp-sub">${monthWords(r.tenantId)}</p>` : ''}
        <dl class="rp-card-facts">${AGES.filter(([k]) => r[k]).map(([k, l]) => h`<div><dt>${l}</dt><dd>${$(r[k])}</dd></div>`)}</dl></div>`;
    })}</div>`
    : ui.empty({ icon: 'check', title: 'Nobody owes anything', body: 'Tenants show here as soon as something is not paid on time.' });
  const csv = () => RB.model.csv(ag.rows.concat([Object.assign({ name: 'Everyone', property: '', unit: '' }, ag.totals)]), [
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
  const answer = h`<p>Over the last 12 months you collected <strong>${$(tot.collected)}</strong> of the ${$(tot.charged)} charged — <strong>${pctTxt(rate)}</strong>.</p>
    ${cur && cur.period === curKey ? h`<p>${D.monthName(cur.period)} so far: ${$(cur.collected)} of ${$(cur.charged)}${cur.outstanding ? h`, with ${$(cur.outstanding)} still to come in` : ''}.</p>` : ''}`;
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
          <span class="rp-xlab">${D.MON[+r.period.slice(5, 7) - 1]}${r.period.slice(5) === '01' || r === rows[0] ? h`<span class="rp-xyear">${r.period.slice(0, 4)}</span>` : ''}</span>
        </div>`)}</div>
      </div>
      <figcaption class="rp-legend"><span class="rp-key rp-key-charged">Rent charged</span><span class="rp-key rp-key-collected">Money collected</span>
        <span class="rp-legend-note">The number above each month is how much of that month’s rent came in. The last month is not finished yet.</span></figcaption>
    </figure>
    <div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-collection">
      <thead><tr><th>Month</th><th class="num">Rent charged</th><th class="num">Money collected</th><th class="num">Still owed</th><th class="num">How much came in</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => h`<tr><td>${monthLabel(r.period)}${r.period === curKey ? ' (so far)' : ''}</td><td class="num">${ui.money(r.charged)}</td><td class="num">${ui.money(r.collected)}</td><td class="num">${r.outstanding ? ui.money(r.outstanding, { tone: 'owed' }) : h`<span class="rp-dash">—</span>`}</td><td class="num">${pctTxt(r.rate)}</td></tr>`)}</tbody>
      <tfoot><tr><td>12 months</td><td class="num" data-total="charged">${ui.money(tot.charged)}</td><td class="num" data-total="collected">${ui.money(tot.collected)}</td><td class="num">${ui.money(tot.outstanding)}</td><td class="num">${pctTxt(rate)}</td></tr></tfoot>
    </table></div>
    <ul class="show-phone rp-mlist">${rows.slice().reverse().map(r => h`<li><span class="rp-mlist-m">${monthLabel(r.period)}${r.period === curKey ? ' (so far)' : ''}</span><span>${$(r.collected)} of ${$(r.charged)} — ${pctTxt(r.rate)}</span></li>`)}</ul>`;
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
  const answer = h`<p>In ${yr}${ytd ? ' so far' : ''} you received <strong>${$(inc.totals.payments)}</strong> in rent from ${RB.plural(inc.rows.length, 'tenant')}.${inc.totals.credits ? h` You took ${$(inc.totals.credits)} off what tenants owed.` : ''}</p>
    <p class="tn-caption">This counts money on the day it arrived, whatever month it was for — the way the tax office usually wants it.</p>`;
  const extra = h`<div class="rp-year" role="group" aria-label="Which year?">
      <span class="rp-year-q">Which year?</span>
      <button type="button" class="btn" id="rp-year-prev" data-act="year" data-d="-1"${yr <= lo ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}<span>Previous year</span></button>
      <strong class="rp-year-label" id="rp-year-label">${yr}</strong>
      <button type="button" class="btn" id="rp-year-next" data-act="year" data-d="1"${yr >= cy ? RB.raw(' disabled') : ''}><span>Next year</span>${ui.icon('chevron-right')}</button></div>`;
  const body = inc.rows.length ? h`<div class="tbl-wrap hide-phone"><table class="tbl rp-tbl" id="rp-income">
      <thead><tr><th>Tenant</th><th>Property</th><th class="num">Number of payments</th><th class="num">Received</th><th class="num">Money off</th></tr></thead>
      <tbody>${inc.rows.map(r => h`<tr data-tenant="${r.tenantId}"><td>${who(r.tenantId, r.name, r.unit)}</td>
        <td>${r.property}</td><td class="num">${r.count}</td><td class="num">${ui.money(r.payments)}</td><td class="num">${r.credits ? ui.money(r.credits) : h`<span class="rp-dash">—</span>`}</td></tr>`)}</tbody>
      <tfoot><tr><td>Everyone</td><td></td><td class="num">${inc.rows.reduce((s, r) => s + r.count, 0)}</td><td class="num" data-total="payments">${ui.money(inc.totals.payments)}</td><td class="num" data-total="credits">${ui.money(inc.totals.credits)}</td></tr></tfoot>
    </table></div>
    <ul class="show-phone rp-mlist">${inc.rows.map(r => h`<li>${who(r.tenantId, r.name, r.unit)}<span>${$(r.payments)}</span></li>`)}<li class="rp-mlist-total"><span>Everyone</span><span>${$(inc.totals.payments)}</span></li></ul>`
    : ui.empty({ icon: 'reports', title: 'No payments in ' + yr, body: 'Payments you record with a date in ' + yr + ' add up here.' });
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
      <div class="rp-choose" role="tablist" aria-label="Which report?">${TABS.map(([k, label, sub]) => h`<button type="button" role="tab" class="rp-choice" id="rp-tab-${k}" data-act="tab" data-tab="${k}" aria-selected="${String(tab === k)}" aria-pressed="${String(tab === k)}"><span class="rp-choice-l">${label}</span><span class="rp-choice-s">${sub}</span></button>`)}</div>
      <section class="rp-report" role="tabpanel" aria-labelledby="rp-tab-${tab}" data-report="${tab}">
        <h2 class="rp-title">${rep.title}</h2>
        ${rep.extra || ''}
        <div class="rp-answer" id="rp-meta">${rep.answer}</div>
        <div class="rp-actions">
          <button type="button" class="btn" id="rp-csv" data-act="csv">${ui.icon('download')}<span>Download for Excel</span></button>
          <button type="button" class="btn" id="rp-copy" data-act="copy">${ui.icon('copy')}<span>Copy</span></button>
          <p class="rp-actions-note">“Download for Excel” saves this table as a file that opens in Excel, Numbers or Google Sheets. “Copy” lets you paste it straight into a spreadsheet or an email.</p>
        </div>
        ${rep.body}
      </section>`);
    ui.bind(el, {
      tab: b => { tab = b.dataset.tab; RB.prefs.set('reports:tab', tab); RB.shell.refresh(); },
      csv: () => RB.actions.downloadFile(rep.file + '-' + ctx.today + '.csv', rep.csv(), 'text/csv'),
      copy: () => ui.copy(csvToTsv(rep.csv()), 'report'),
      year: b => { const cy = +ctx.today.slice(0, 4); year = (year == null ? cy : year) + +b.dataset.d; RB.shell.refresh(); },
      open: b => RB.actions.openTenant(b.dataset.id),
    });
  },
});

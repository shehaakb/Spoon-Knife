// views/reports.js — Rent roll · Aging · Collection by month · Income by year. Each with Download CSV and Copy.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;

const TABS = [['roll', 'Rent roll'], ['aging', 'Aging'], ['collection', 'Collection'], ['income', 'Income by year']];
let tab = RB.prefs.get('reports:tab', 'roll');
if (!TABS.some(t => t[0] === tab)) tab = 'roll';
let year = null; // income year (null → current year)

const pctTxt = r => (r == null ? '—' : (r * 100).toFixed(1) + '%');

/** CSV → tab-separated text that pastes straight into spreadsheet cells. */
function csvToTsv(csv) { return RB.model.parseDelimited(csv).map(r => r.map(c => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n'); }

/** Nice axis maximum and step (cents) for a value. */
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

// ------------------------------------------------------------------ report builders: {title, csvName, csv, body, meta}
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
  const end = r => r.status === 'past' ? h`<span class="faint">Moved out ${D.fmt(r.moveOut || r.leaseEnd, today)}</span>` : r.leaseEnd ? D.fmt(r.leaseEnd, today) : h`<span class="faint">Month-to-month</span>`;
  const status = r => h`<span class="rp-status">${r.status === 'past' ? ui.tag('Past', 'quiet') : ui.pill(r.monthStatus, { size: 'sm' })}${r.status === 'notice' ? ui.tag('Notice', 'warn') : ''}</span>`;
  const meta = h`<strong>${occ.occupied} of ${occ.units}</strong> units occupied (${Math.round(occ.rate * 100)}%) · ${ui.money(rr.totals.rent)} monthly rent · ${ui.money(rr.totals.deposit)} in deposits · ${rr.totals.balance > 0 ? h`${ui.money(rr.totals.balance)} owed` : 'nothing owed'}`;
  const body = h`
    <div class="tbl-wrap hide-phone"><table class="tbl tbl-compact rp-tbl" id="rp-roll">
      <thead><tr><th>Unit</th><th>Tenant</th><th class="num">Rent</th><th>Lease start</th><th>Lease end</th><th class="num">Deposit</th><th class="num">Balance</th><th>This month</th></tr></thead>
      ${groups.map(g => h`<tbody>
        <tr class="tbl-group"><td colspan="8">${g.property || 'No property'} <span class="faint rp-group-meta">· ${g.occupied} of ${g.units} occupied</span></td></tr>
        ${g.rows.map(r => h`<tr class="${r.status === 'past' ? 'is-muted' : ''}" data-tenant="${r.tenantId}">
          <td>${ui.plate(r.unit)}</td><td><button type="button" class="rp-name" data-act="open" data-id="${r.tenantId}">${r.name}</button></td>
          <td class="num">${r.status === 'past' ? h`<span class="faint">—</span>` : ui.money(r.rent)}</td>
          <td>${r.leaseStart ? D.fmt(r.leaseStart, today) : '—'}</td><td>${end(r)}</td>
          <td class="num">${r.deposit ? ui.money(r.deposit) : h`<span class="faint">—</span>`}</td>
          <td class="num">${ui.balance(r.balance)}</td><td>${status(r)}</td></tr>`)}
        <tr class="rp-subtotal"><td></td><td>${g.property} subtotal</td><td class="num">${ui.money(g.rent)}</td><td></td><td></td><td class="num">${ui.money(g.deposit)}</td><td class="num">${ui.balance(g.balance)}</td><td></td></tr>
      </tbody>`)}
      <tfoot><tr class="rp-total"><td></td><td>Total · ${RB.plural(rr.rows.length, 'tenant')}</td><td class="num" data-total="rent">${ui.money(rr.totals.rent)}</td><td></td><td></td><td class="num" data-total="deposit">${ui.money(rr.totals.deposit)}</td><td class="num" data-total="balance">${ui.balance(rr.totals.balance)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="show-phone">
      ${groups.map(g => h`<div class="sec sec-sm rp-ph-group"><h3 class="sec-title">${g.property}</h3><span class="sec-meta">${g.occupied} of ${g.units} occupied</span></div>
        <div class="clist">${g.rows.map(r => h`<div class="crow${r.status === 'past' ? ' rp-past' : ''}">
          <span class="crow-lead">${ui.plate(r.unit)}</span>
          <div class="crow-main"><div class="crow-title"><button type="button" class="rp-name" data-act="open" data-id="${r.tenantId}">${r.name}</button></div>
            <div class="crow-sub">${r.leaseStart ? D.fmt(r.leaseStart, today) : '?'} → ${end(r)}${r.deposit ? h` · dep. ${M.fmt(r.deposit)}` : ''}</div></div>
          <div class="crow-aside">${r.status === 'past' ? h`<span class="faint">—</span>` : ui.money(r.rent)}${r.balance ? ui.balance(r.balance) : status(r)}</div>
        </div>`)}
        <div class="rp-ph-sub"><span>Subtotal</span><span>${ui.money(g.rent)} rent · ${ui.balance(g.balance, { zero: '$0 owed' })}</span></div></div>`)}
      <div class="rp-ph-total"><span>Total rent</span>${ui.money(rr.totals.rent)}<span>Deposits</span>${ui.money(rr.totals.deposit)}<span>Balance</span>${ui.balance(rr.totals.balance, { zero: '$0' })}</div>
    </div>`;
  return { title: 'Rent roll', file: 'rent-roll', csv: () => RB.model.rentRollCsv(rr), meta, body };
}

function aging(today) {
  const ag = S().aging();
  const none = S().tenantsList().length - ag.rows.length;
  const cell = v => v ? ui.money(v, { tone: 'owed' }) : h`<span class="faint">—</span>`;
  const meta = ag.rows.length
    ? h`<strong>${ui.money(ag.totals.total)}</strong> owed by ${RB.plural(ag.rows.length, 'tenant')}${ag.totals.d90 ? h` · <span class="tone-bad">${ui.money(ag.totals.d90)} over 90 days</span>` : ''} · ${RB.plural(none, 'tenant')} ${none === 1 ? 'owes' : 'owe'} nothing`
    : h`Nobody owes anything · ${RB.plural(none, 'tenant')} all square`;
  const body = ag.rows.length ? h`<div class="rp-scroll"><table class="tbl tbl-compact rp-tbl rp-sticky" id="rp-aging">
      <thead><tr><th>Tenant</th><th class="num">0–30 days</th><th class="num">31–60</th><th class="num">61–90</th><th class="num">90+</th><th class="num">Total</th></tr></thead>
      <tbody>${ag.rows.map(r => h`<tr data-tenant="${r.tenantId}"><td><span class="rp-who">${ui.plate(r.unit)}<button type="button" class="rp-name truncate" data-act="open" data-id="${r.tenantId}">${r.name}</button></span></td>
        <td class="num">${cell(r.d0_30)}</td><td class="num">${cell(r.d31_60)}</td><td class="num">${cell(r.d61_90)}</td><td class="num">${cell(r.d90)}</td><td class="num strong">${ui.money(r.total, { tone: 'owed' })}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="num" data-total="d0_30">${ui.money(ag.totals.d0_30)}</td><td class="num" data-total="d31_60">${ui.money(ag.totals.d31_60)}</td><td class="num" data-total="d61_90">${ui.money(ag.totals.d61_90)}</td><td class="num" data-total="d90">${ui.money(ag.totals.d90)}</td><td class="num" data-total="total">${ui.money(ag.totals.total)}</td></tr></tfoot>
    </table></div>
    <p class="rp-note">${RB.plural(none, 'tenant')} ${none === 1 ? 'owes' : 'owe'} nothing and ${none === 1 ? 'is' : 'are'} left out. Ages count from each charge’s due date.</p>`
    : ui.empty({ icon: 'check', title: 'Nobody owes anything', body: 'Every charge is paid. Tenants show up here as soon as something is overdue.' });
  return { title: 'Aging', file: 'aging', csv: () => RB.model.agingCsv(ag), meta, body };
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
  const meta = h`<strong>${pctTxt(rate)}</strong> collected over 12 months · ${ui.money(Math.round(tot.collected / 100) * 100)} of ${ui.money(Math.round(tot.charged / 100) * 100)}${tot.outstanding ? h` · ${ui.money(tot.outstanding)} still open` : ''}`;
  const body = h`
    <figure class="rp-chart" id="rp-chart" role="img" aria-label="Charged and collected by month, ${D.fmtMonth(rows[0].period)} to ${D.fmtMonth(rows[rows.length - 1].period)}">
      <div class="rp-chart-plot" data-axis-max="${ax.max}">
        ${ticks.map(v => h`<div class="rp-tick" style="bottom:${fx(y(v))}"><span class="rp-tick-label">${axisMoney(v)}</span></div>`)}
        <div class="rp-bars">${rows.map(r => h`<div class="rp-month${r.period === curKey ? ' is-current' : ''}" title="${D.fmtMonth(r.period)}: ${M.fmt(r.collected)} of ${M.fmt(r.charged)} collected (${pctTxt(r.rate)})">
          <div class="rp-col">
            <span class="rp-charged" style="height:${fx(y(r.charged))}" data-v="${r.charged}"></span>
            <span class="rp-collected" style="height:${fx(y(r.collected))}" data-v="${r.collected}"></span>
            ${r.rate != null ? h`<span class="rp-rate" style="bottom:${fx(y(Math.max(r.charged, r.collected)))}">${Math.round(r.rate * 100)}%</span>` : ''}
          </div>
          <span class="rp-xlab">${D.MON[+r.period.slice(5, 7) - 1]}${r.period.slice(5) === '01' || r === rows[0] ? h`<span class="rp-xyear">${r.period.slice(0, 4)}</span>` : ''}</span>
        </div>`)}</div>
      </div>
      <figcaption class="bar-legend rp-legend"><span class="rp-key rp-key-charged">Charged</span><span class="rp-key rp-key-collected">Collected</span><span class="faint">Percent = collected of charged</span></figcaption>
    </figure>
    <div class="rp-scroll"><table class="tbl tbl-compact rp-tbl" id="rp-collection">
      <thead><tr><th>Month</th><th class="num">Charged</th><th class="num">Collected</th><th class="num hide-phone">Outstanding</th><th class="num">Rate</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => h`<tr><td><span class="hide-phone">${D.fmtMonth(r.period)}</span><span class="show-phone">${D.MON[+r.period.slice(5, 7) - 1] + ' ' + r.period.slice(0, 4)}</span>${r.period === curKey ? h` <span class="faint t-12 hide-phone">so far</span>` : ''}</td><td class="num">${ui.money(r.charged)}</td><td class="num">${ui.money(r.collected)}</td><td class="num hide-phone">${r.outstanding ? ui.money(r.outstanding, { tone: 'owed' }) : h`<span class="faint">—</span>`}</td><td class="num">${pctTxt(r.rate)}</td></tr>`)}</tbody>
      <tfoot><tr><td>12 months</td><td class="num" data-total="charged">${ui.money(tot.charged)}</td><td class="num" data-total="collected">${ui.money(tot.collected)}</td><td class="num hide-phone">${ui.money(tot.outstanding)}</td><td class="num">${pctTxt(rate)}</td></tr></tfoot>
    </table></div>`;
  return { title: 'Collection by month', file: 'collection', csv: () => RB.model.collectionCsv(rows), meta, body };
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
  const meta = h`<strong>${ui.money(inc.totals.payments)}</strong> received in ${yr}${ytd ? ' so far' : ''} from ${RB.plural(inc.rows.length, 'tenant')}${inc.totals.credits ? h` · ${ui.money(inc.totals.credits)} in credits given` : ''}`;
  const stepper = h`<div class="stepper rp-year" role="group" aria-label="Year">
      <button type="button" class="btn btn-ghost btn-icon" id="rp-year-prev" data-act="year" data-d="-1" aria-label="Previous year"${yr <= lo ? RB.raw(' disabled') : ''}>${ui.icon('chevron-left')}</button>
      <span class="stepper-label" id="rp-year-label">${yr}</span>
      <button type="button" class="btn btn-ghost btn-icon" id="rp-year-next" data-act="year" data-d="1" aria-label="Next year"${yr >= cy ? RB.raw(' disabled') : ''}>${ui.icon('chevron-right')}</button></div>`;
  const body = inc.rows.length ? h`<div class="rp-scroll"><table class="tbl tbl-compact rp-tbl" id="rp-income">
      <thead><tr><th>Tenant</th><th class="hide-phone">Property</th><th class="num hide-phone">Payments</th><th class="num">Received</th><th class="num hide-phone">Credits given</th></tr></thead>
      <tbody>${inc.rows.map(r => h`<tr data-tenant="${r.tenantId}"><td><span class="rp-who">${ui.plate(r.unit)}<button type="button" class="rp-name truncate" data-act="open" data-id="${r.tenantId}">${r.name}</button></span></td>
        <td class="hide-phone muted">${r.property}</td><td class="num faint hide-phone">${r.count}</td><td class="num">${ui.money(r.payments)}</td><td class="num hide-phone">${r.credits ? ui.money(r.credits) : h`<span class="faint">—</span>`}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="hide-phone"></td><td class="num hide-phone">${inc.rows.reduce((s, r) => s + r.count, 0)}</td><td class="num" data-total="payments">${ui.money(inc.totals.payments)}</td><td class="num hide-phone" data-total="credits">${ui.money(inc.totals.credits)}</td></tr></tfoot>
    </table></div>
    <p class="rp-note">Cash basis: payments dated in ${yr}, whatever month they paid for. The CSV adds a column for each month.</p>`
    : ui.empty({ icon: 'reports', title: 'No payments in ' + yr, body: 'Payments recorded with a date in ' + yr + ' add up here.' });
  return { title: 'Income ' + yr, file: 'income-' + yr, csv: () => RB.model.incomeCsv(inc), meta, body, extra: stepper };
}

const BUILD = { roll: rentRoll, aging, collection, income };

RB.views.register('reports', {
  title: 'Reports',
  shortcuts: [['1 – 4', 'Switch report'], ['← / →', 'Change year (Income)']],
  render(el, ctx) {
    const rep = BUILD[tab](ctx.today);
    el.innerHTML = String(h`
      <div class="view-head rp-head">
        <div class="seg rp-tabs" role="tablist" aria-label="Report">${TABS.map(([k, label]) => h`<button type="button" role="tab" id="rp-tab-${k}" data-act="tab" data-tab="${k}" aria-selected="${String(tab === k)}" aria-pressed="${String(tab === k)}">${label}</button>`)}</div>
        <span class="spacer"></span>
        ${rep.extra || ''}
        <div class="rp-actions">
          <button type="button" class="btn btn-sm" id="rp-csv" data-act="csv">${ui.icon('download')}<span>Download CSV</span></button>
          <button type="button" class="btn btn-sm btn-ghost" id="rp-copy" data-act="copy">${ui.icon('copy')}<span>Copy</span></button>
        </div>
      </div>
      <section class="rp-report" role="tabpanel" aria-labelledby="rp-tab-${tab}" data-report="${tab}">
        <p class="rp-meta" id="rp-meta">${rep.meta}</p>
        ${rep.body}
      </section>`);
    ui.bind(el, {
      tab: b => { tab = b.dataset.tab; RB.prefs.set('reports:tab', tab); RB.shell.refresh(); },
      csv: () => RB.actions.downloadFile(rep.file + '-' + ctx.today + '.csv', rep.csv(), 'text/csv'),
      copy: () => ui.copy(csvToTsv(rep.csv()), rep.title.toLowerCase() + ' — paste it into a spreadsheet'),
      year: b => { const cy = +ctx.today.slice(0, 4); year = (year == null ? cy : year) + +b.dataset.d; RB.shell.refresh(); },
      open: b => RB.actions.openTenant(b.dataset.id),
    });
  },
  onKey(e) {
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) { tab = TABS[i][0]; RB.prefs.set('reports:tab', tab); RB.shell.refresh(); return true; }
    if (tab === 'income' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const b = document.getElementById(e.key === 'ArrowLeft' ? 'rp-year-prev' : 'rp-year-next');
      if (b && !b.disabled) b.click();
      return true;
    }
    return false;
  },
});

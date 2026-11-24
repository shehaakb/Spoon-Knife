// views/leases.js — Leases (SPEC §10.3): one sentence, then "Ending soon" and "Moving out" as rows whose tap opens
// "What would you like to do?" (Renew the lease · They are moving out · Leave it month-to-month), "Month-to-month" as
// plain rows, and "Later" folded into one control that expands in place. No buttons on rows. The 12-month calendar is
// behind a switch on desktop. Owns RB.actions.renewLease. Words: SPEC §8.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;

let cal = !!RB.prefs.get('leases:cal', false);
let laterOpen = false;

/** "Thursday, December 3" this year, "Thursday, December 3, 2027" otherwise. */
const longDay = (d, today) => ui.dateWords(d, today || S().today());
const place = t => ui.place(t);

// ------------------------------------------------------------------ data
function leaseRows(today) {
  const settings = S().settings();
  return S().tenantsList({ includePast: false }).map(t => {
    const ls = RB.model.leaseState(t, settings, today);
    const l = t.lease || {};
    let group, endDate = null;
    if (ls.noticeGiven || t.status === 'notice' || (l.moveOut && ls.kind !== 'upcoming')) { group = 'moving'; endDate = l.moveOut || l.end; }
    else if (ls.kind === 'mtm') group = 'mtm';
    else { endDate = l.end; group = 'fixed'; }
    const days = endDate ? D.diffDays(today, endDate) : null;
    return { t, ls, group, endDate, days, rent: RB.model.rentOn(t, today) };
  }).sort((a, b) => {
    const ea = a.endDate || '9999-12-31', eb = b.endDate || '9999-12-31';
    return D.cmp(ea, eb) || RB.natCmp(a.t.property, b.t.property) || RB.natCmp(a.t.unit, b.t.unit);
  });
}
const soon = (r, nd) => r.group === 'fixed' && r.days != null && r.days <= nd;
function groups(rows, nd) {
  const g = { soon: [], moving: [], mtm: [], later: [] };
  rows.forEach(r => { g[r.group === 'moving' ? 'moving' : r.group === 'mtm' ? 'mtm' : soon(r, nd) ? 'soon' : 'later'].push(r); });
  return g;
}

// ------------------------------------------------------------------ actions
function goMonthToMonth(id) {
  if (!S().canWrite()) { ui.toast('This rent book is view only — you can look, but not change anything.', { tone: 'bad' }); return; }
  const t = S().tenant(id); if (!t) return;
  const prev = (t.lease || {}).end || null;
  S().updateTenant(id, { lease: { end: null } }).catch(() => {});
  ui.toast(t.name + ' is now month-to-month.', { undo: () => S().updateTenant(id, { lease: { end: prev } }) });
}

/** Renew the lease: plain questions, one summary sentence. Resolves true if saved. */
function renewLease(tenantId) {
  if (!S().canWrite()) { ui.toast('This rent book is view only — you can look, but not change anything.', { tone: 'bad' }); return Promise.resolve(false); }
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(false);
  const today = S().today();
  const l = t.lease || {};
  const curEnd = l.end && l.end >= today ? l.end : null;
  const defEnd = D.addMonths(curEnd || today, 12);
  const curRent = RB.model.rentOn(t, today);
  const defFrom = curEnd ? D.addDays(curEnd, 1) : D.monthStart(D.addMonthKey(D.monthKey(today), 1));
  const changing = v => v.change === 'yes' && v.rent != null && v.rent !== curRent;
  return new Promise(resolve => {
    let ok = false;
    const summary = v => {
      const bits = [h`${t.name}’s lease will end on ${v.end && D.valid(v.end) ? longDay(v.end, today) : '…'}${curEnd ? h` instead of ${longDay(curEnd, today)}` : ''}.`];
      bits.push(changing(v) ? h` The rent goes from ${M.fmt(curRent)} to ${M.fmt(v.rent)} a month on ${v.from && D.valid(v.from) ? longDay(v.from, today) : '…'}.` : h` The rent stays ${M.fmt(curRent)} a month.`);
      if (l.noticeDate || t.status === 'notice') bits.push(' They are no longer moving out.');
      return h`${bits}`;
    };
    ui.sheet({
      title: 'Renew the lease', sub: t.name + ' — ' + place(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-col">
          <p class="lz-lead">${curEnd ? h`The lease ends ${longDay(curEnd, today)} — ${D.rel(curEnd, today)}.` : 'They are month-to-month now.'}</p>
          ${ui.dateField({ name: 'end', id: 'lz-renew-end', label: 'New end date?', value: defEnd, required: true, requiredMsg: 'Choose the new end date', hint: 'Usually a year later.' })}
          ${ui.field({ name: 'change', id: 'lz-renew-change', label: 'Is the rent changing?', type: 'choice', value: 'no', options: [{ value: 'no', label: 'No — it stays ' + M.fmt(curRent) }, { value: 'yes', label: 'Yes' }] })}
          <div id="lz-renew-rentwrap" class="form-col">
            ${ui.field({ name: 'rent', id: 'lz-renew-rent', label: 'What will the new rent be?', type: 'money', placeholder: M.input(curRent) })}
            ${ui.dateField({ name: 'from', id: 'lz-renew-from', label: 'From when?', value: defFrom, hint: 'Months before this keep the old rent.' })}
          </div>
          <p class="lz-sum" id="lz-renew-sum" aria-live="polite"></p>
        </div>`);
        const upd = () => {
          const r = ui.readForm(el).values;
          el.querySelector('#lz-renew-rentwrap').hidden = r.change !== 'yes';
          el.querySelector('#lz-renew-sum').innerHTML = String(summary(r));
          sh.setAction('save', { label: changing(r) ? 'Renew at ' + M.fmt(r.rent) : 'Renew the lease' });
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd);
        upd();
      },
      actions: [{ id: 'save', label: 'Renew the lease', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({
          end: v.end && v.end <= today ? 'Choose a date after today' : v.end && l.start && v.end <= l.start ? 'Choose a date after the lease started' : '',
          rent: v.change === 'yes' && v.rent == null ? 'Write the new rent, or choose No' : v.change === 'yes' && v.rent <= 0 ? 'Write an amount above zero' : '',
          from: v.change === 'yes' && v.rent != null && !v.from ? 'Choose when the new rent starts' : '',
        }) });
        if (!v) return false;
        const before = { lease: { end: l.end || null, noticeDate: l.noticeDate || null, moveOut: l.moveOut || null }, rent: RB.clone(t.rent || []), status: t.status || 'active' };
        const patch = { lease: { end: v.end } };
        if (changing(v)) {
          const sched = (t.rent || []).filter(r => r && r.from !== v.from).map(r => ({ from: r.from, amount: r.amount }));
          sched.push({ from: v.from, amount: v.rent });
          sched.sort((a, b) => D.cmp(a.from, b.from));
          patch.rent = sched;
        }
        if (l.noticeDate || t.status === 'notice') { patch.lease.noticeDate = null; patch.lease.moveOut = null; patch.status = 'active'; }
        S().updateTenant(tenantId, patch).catch(() => {});
        ok = true;
        ui.toast('Renewed ' + t.name + '’s lease to ' + longDay(v.end, today) + (patch.rent ? ' at ' + M.fmt(v.rent) + ' a month' : '') + '.', { undo: () => S().updateTenant(tenantId, before) });
      } }],
      onClose: () => resolve(ok),
    });
  });
}
RB.actions.renewLease = renewLease;

// ------------------------------------------------------------------ "What would you like to do?"
function choose(r) {
  const t = r.t, l = t.lease || {}, today = S().today();
  const id = t.id;
  let sub;
  if (r.group === 'moving') sub = l.moveOut && l.moveOut < today ? 'Was moving out ' + longDay(l.moveOut, today) + '.' : 'Moving out ' + longDay(r.endDate, today) + ' — ' + D.rel(r.endDate, today) + '.';
  else if (r.group === 'mtm') sub = 'Month-to-month — no end date. ' + M.fmt(r.rent) + ' a month.';
  else sub = 'Lease ends ' + longDay(r.endDate, today) + ' — ' + (r.days === 0 ? 'today' : D.rel(r.endDate, today)) + '.';
  const items = [];
  if (r.group === 'moving') {
    items.push({ id: 'lz-c-moveout', label: l.moveOut && l.moveOut <= today ? 'Finish the move-out' : 'Change the moving-out day', write: true, run: () => RB.actions.moveOut(id) });
    items.push({ id: 'lz-c-renew', label: 'They are staying — renew the lease', write: true, run: () => renewLease(id) });
  } else {
    items.push({ id: 'lz-c-renew', label: 'Renew the lease', sub: 'Choose a new end date, and the rent if it changes', write: true, run: () => renewLease(id) });
    items.push({ id: 'lz-c-moveout', label: 'They are moving out', sub: 'Write down the day they leave', write: true, run: () => RB.actions.moveOut(id) });
    if (r.group === 'fixed') items.push({ id: 'lz-c-mtm', label: 'Leave it month-to-month', sub: 'No end date — they pay month by month', write: true, run: () => goMonthToMonth(id) });
  }
  items.push({ id: 'lz-c-open', label: 'See their page', run: () => RB.actions.openTenant(id) });
  ui.choices({ title: t.name, sub: place(t) + '. ' + sub, items });
}

// ------------------------------------------------------------------ the list
function row(r, today, kind) {
  const t = r.t, l = t.lease || {};
  let sub = place(t), status = '';
  if (kind === 'moving') {
    const past = l.moveOut && l.moveOut < today;
    sub += past ? ' · was moving out ' + longDay(l.moveOut, today) : ' · moving out ' + longDay(r.endDate, today);
    status = ui.status(past ? 'late' : 'warn', past ? 'Finish the move-out' : (r.days === 0 ? 'Today' : D.rel(r.endDate, today).replace(/^in /, 'In ')));
  } else if (kind === 'mtm') {
    sub += r.ls.holdover && l.end ? ' · since ' + longDay(l.end, today) : '';
  } else {
    sub += ' · ends ' + longDay(r.endDate, today);
    if (kind === 'soon') status = ui.status('warn', r.days === 0 ? 'Ends today' : 'In ' + D.days(r.days));
  }
  return ui.row({ lead: ui.plate(t.unit, { property: t.property }), title: t.name, sub, amt: kind === 'mtm' ? M.fmt(r.rent) : '', status,
    act: 'choose', attrs: { 'data-id': t.id, 'data-tenant': t.id, id: 'lz-row-' + t.id } });
}
function list(g, today, nd) {
  const sec = (k, title, body) => h`<section class="lz-sec" id="lz-sec-${k}" aria-labelledby="lz-h-${k}">
    <h2 class="rows-head" id="lz-h-${k}">${title} <span class="rows-count">${g[k].length}</span></h2>${body}</section>`;
  const rows = k => h`<ul class="rows rows-inset">${g[k].map(r => row(r, today, k))}</ul>`;
  return h`
    ${sec('soon', 'Ending soon', g.soon.length ? rows('soon') : h`<p class="lz-empty">No lease ends in the next ${nd} days. Nothing to decide.</p>`)}
    ${g.moving.length ? sec('moving', 'Moving out', rows('moving')) : ''}
    ${g.mtm.length ? sec('mtm', 'Month-to-month', rows('mtm')) : ''}
    ${g.later.length ? h`<section class="lz-sec" id="lz-sec-later" aria-label="Leases that end later">
      ${laterOpen ? h`<h2 class="rows-head" id="lz-h-later">Later <span class="rows-count">${g.later.length}</span></h2>${rows('later')}` : ''}
      <button type="button" class="rows-more" id="lz-later" data-act="later" aria-expanded="${String(laterOpen)}">${laterOpen ? 'Hide the later leases' : RB.plural(g.later.length, 'lease ends', 'leases end') + ' later — Show them'}</button>
    </section>` : ''}`;
}

// ------------------------------------------------------------------ calendar (desktop only)
function timeline(rows, today, nd) {
  const curKey = D.monthKey(today);
  const w0 = D.monthStart(curKey);
  const w1 = D.monthStart(D.addMonthKey(curKey, 12));
  const span = D.diffDays(w0, w1);
  const pct = d => Math.max(0, Math.min(100, (D.diffDays(w0, d) / span) * 100));
  const fx = n => n.toFixed(3) + '%';
  const todayX = pct(today);
  const nwEnd = D.addDays(today, nd);
  const months = Array.from({ length: 12 }, (_, i) => {
    const k = D.addMonthKey(curKey, i);
    const mon = D.MON[+k.slice(5, 7) - 1];
    const label = i === 0 || k.slice(5) === '01' ? h`${mon}<span class="lz-yr">${' ' + k.slice(0, 4)}</span>` : mon;
    return { k, x: pct(D.monthStart(k)), w: (D.daysInMonth(k) / span) * 100, label };
  });
  const bar = r => {
    const l = r.t.lease || {};
    const startD = D.max(l.start || l.moveIn || w0, w0);
    const left = pct(startD);
    let right, cls = 'lz-bar', open = false, off = false;
    if (r.group === 'mtm') { right = 100; cls += ' lz-bar-mtm'; open = true; }
    else if (r.endDate >= w1) { right = 100; off = true; cls += ' lz-bar-off'; }
    else { right = pct(D.addDays(r.endDate, 1)); }
    if (r.group === 'moving') cls += ' lz-bar-moving';
    else if (r.group === 'fixed' && r.days <= nd) cls += ' lz-bar-due';
    const width = Math.max(0.6, right - left);
    const label = r.group === 'mtm' ? 'Month-to-month' : r.group === 'moving' ? 'Moving out ' + D.fmt(r.endDate, today) : 'Ends ' + D.fmt(r.endDate, today);
    const inside = open || off || right > 72;
    return h`<div class="${cls}${inside ? ' lz-bar-in' : ''}" style="left:${fx(left)};width:${fx(width)}" data-start="${startD}" data-end="${r.group === 'mtm' ? '' : r.endDate}">
        ${inside ? h`<span class="lz-label">${label}</span>` : ''}</div>
      ${inside ? '' : h`<span class="lz-label lz-label-out" style="left:calc(${fx(right)} + 8px)">${label}</span>`}`;
  };
  return h`<p class="lz-cap lz-cal-cap">Each bar is one lease, from when it started to when it ends. The line is today; the shaded band is the next ${nd} days. Choose a name to decide what happens next.</p>
  <div class="lz-tl" role="table" aria-label="Lease calendar, ${D.fmtMonth(curKey)} to ${D.fmtMonth(D.addMonthKey(curKey, 11))}">
    <div class="lz-head" role="row">
      <div class="lz-cname lz-head-name" role="columnheader">${RB.plural(rows.length, 'lease')}</div>
      <div class="lz-track lz-months" role="columnheader">${months.map(m => h`<span class="lz-month${m.k.slice(5) === '01' ? ' is-year' : ''}" style="left:${fx(m.x)};width:${fx(m.w)}">${m.label}</span>`)}</div>
    </div>
    <div class="lz-body">
      <div class="lz-grid" aria-hidden="true">
        ${months.slice(1).map(m => h`<i class="lz-gl" style="left:${fx(m.x)}"></i>`)}
        <i class="lz-window" style="left:${fx(todayX)};width:${fx(pct(nwEnd) - todayX)}"></i>
        <i class="lz-today" style="left:${fx(todayX)}"></i>
      </div>
      ${rows.map(r => h`<div class="lz-row" role="row" data-tenant="${r.t.id}">
        <div class="lz-cname" role="cell"><button type="button" class="lz-who" data-act="choose" data-id="${r.t.id}">${ui.plate(r.t.unit, { property: r.t.property })}<span class="lz-who-name">${r.t.name}</span></button></div>
        <div class="lz-track" role="cell">${bar(r)}</div>
      </div>`)}
    </div>
    <div class="lz-foot" aria-hidden="true">
      <div class="lz-cname"></div>
      <div class="lz-track"><span class="lz-today-label" style="left:${fx(todayX)}">Today, ${D.fmt(today, today)}</span></div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ view
RB.views.register('leases', {
  title: 'Leases',
  render(el, ctx) {
    const nd = ctx.state.settings.leaseNoticeDays;
    const rows = leaseRows(ctx.today);
    const g = groups(rows, nd);
    const showCal = cal && !ui.isPhone();
    const n = (c, one, many) => (c === 1 ? '1 ' + one : c + ' ' + many);
    el.innerHTML = String(h`
      <div class="lz-top">
        <p class="lz-summary" id="lz-summary">${g.soon.length ? n(g.soon.length, 'lease ends', 'leases end') : 'No lease ends'} in the next ${nd} days. ${n(g.mtm.length, 'tenant is', 'tenants are')} month-to-month. ${n(g.moving.length, 'tenant is', 'tenants are')} moving out.</p>
        <label class="check lz-calswitch hide-phone"><input type="checkbox" id="lz-cal" data-change="cal"${cal ? RB.raw(' checked') : ''}><span>Show as a calendar</span></label>
      </div>
      ${rows.length ? (showCal ? h`<div class="hide-phone">${timeline(rows, ctx.today, nd)}</div>` : list(g, ctx.today, nd))
        : ui.empty({ icon: 'leases', title: 'No leases yet', body: 'Add a tenant and their lease shows up here.' })}`);
    ui.bind(el, {
      cal: c => { cal = !!c.checked; RB.prefs.set('leases:cal', cal); RB.shell.refresh(); },
      later: () => { laterOpen = !laterOpen; RB.shell.refresh(); if (!laterOpen) { const b = el.querySelector('#lz-later'); if (b) b.focus(); } },
      choose: b => { const r = leaseRows(S().today()).find(x => x.t.id === b.dataset.id); if (r) choose(r); },
    });
  },
  destroy() { laterOpen = false; },
});

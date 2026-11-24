// views/leases.js — Leases: a plain list first ("Leases ending soon" with worded choices, then Moving out,
// Month-to-month, Later). The 12-month calendar is behind a worded switch on desktop. Owns RB.actions.renewLease.
// Plain-language rules: docs/SPEC.md §8. Wording helpers come from tenant-detail.js (RB._tn.W) at render time.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;
const T = (RB._tn = RB._tn || {});
const W = () => T.W;

let cal = !!RB.prefs.get('leases:cal', false);

// ------------------------------------------------------------------ data
function leaseRows(today, settings) {
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

// ------------------------------------------------------------------ actions
function goMonthToMonth(id) {
  if (!S().canWrite()) { ui.toast('This rent book is view only — you can look, but not change anything.', { tone: 'bad' }); return; }
  const t = S().tenant(id); if (!t) return;
  const prev = (t.lease || {}).end || null;
  S().updateTenant(id, { lease: { end: null } }).catch(() => {});
  ui.toast(t.name + ' is now month-to-month.', { undo: () => S().updateTenant(id, { lease: { end: prev } }), duration: 10000 });
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
      const bits = [h`${t.name}’s lease will end on <strong>${v.end && D.valid(v.end) ? D.fmtLong(v.end) : '…'}</strong>${curEnd ? h` instead of ${D.fmtLong(curEnd)}` : ''}.`];
      bits.push(changing(v) ? h` The rent goes from ${M.fmt(curRent)} to <strong>${M.fmt(v.rent)}</strong> a month on ${v.from && D.valid(v.from) ? D.fmtLong(v.from) : '…'}.` : h` The rent stays ${M.fmt(curRent)} a month.`);
      if (l.noticeDate || t.status === 'notice') bits.push(' They are no longer moving out.');
      return h`${bits}`;
    };
    ui.sheet({
      title: 'Renew the lease', sub: t.name + ' — ' + T.place(t), cancel: 'Close',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="tn-form">
          <p class="tn-lead">${curEnd ? h`The lease ends ${D.fmtLong(curEnd)} — ${W().rel(curEnd, today)}.` : 'They are month-to-month now.'}</p>
          ${ui.field({ name: 'end', id: 'lz-renew-end', label: 'New end date?', type: 'date', value: defEnd, required: true, requiredMsg: 'Choose the new end date', hint: 'Usually a year later.' })}
          ${T.pick({ name: 'change', id: 'lz-renew-change', label: 'Is the rent changing?', value: 'no', options: [{ value: 'no', label: 'No — it stays ' + M.fmt(curRent) }, { value: 'yes', label: 'Yes' }] })}
          <div id="lz-renew-rentwrap" class="tn-form">
            ${ui.field({ name: 'rent', id: 'lz-renew-rent', label: 'What will the new rent be?', type: 'money', placeholder: M.input(curRent) })}
            ${ui.field({ name: 'from', id: 'lz-renew-from', label: 'From when?', type: 'date', value: defFrom, hint: 'Months before this keep the old rent.' })}
          </div>
          <p class="tn-summary-text" id="lz-renew-sum" aria-live="polite"></p>
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
        ui.toast('Renewed ' + t.name + '’s lease to ' + D.fmt(v.end, today) + (patch.rent ? ' at ' + M.fmt(v.rent) + ' a month' : '') + '.', { undo: () => S().updateTenant(tenantId, before), duration: 10000 });
      } }],
      onClose: () => resolve(ok),
    });
  });
}
RB.actions.renewLease = renewLease;

// ------------------------------------------------------------------ the plain list
function who(r) { return h`<button type="button" class="lz-name" data-act="open" data-id="${r.t.id}">${r.t.name}</button>`; }
function item(r, today, kind) {
  const t = r.t, l = t.lease || {};
  let line;
  if (kind === 'moving') line = l.moveOut && l.moveOut < today ? h`was moving out ${W().date(l.moveOut, today)} — finish the move-out` : h`moving out ${W().date(r.endDate, today)}, ${W().rel(r.endDate, today)}`;
  else if (kind === 'mtm') line = r.ls.holdover && l.end ? h`month-to-month since the lease ended ${W().date(l.end, today)}` : 'month-to-month';
  else line = h`lease ends ${W().date(r.endDate, today)}, ${r.days === 0 ? 'today' : W().rel(r.endDate, today)}`;
  let acts;
  if (kind === 'soon') acts = h`<button type="button" class="btn btn-primary" data-act="renew" data-id="${t.id}" data-write>Renew the lease</button>
      <button type="button" class="btn" data-act="moveout" data-id="${t.id}" data-write>They are moving out</button>
      <button type="button" class="btn btn-ghost lz-quiet" data-act="mtm" data-id="${t.id}" data-write>Leave it month-to-month</button>`;
  else if (kind === 'moving') acts = h`<button type="button" class="btn" data-act="moveout" data-id="${t.id}" data-write>${l.moveOut && l.moveOut <= today ? 'Finish the move-out' : 'Change the moving-out day'}</button>
      <button type="button" class="btn btn-ghost" data-act="renew" data-id="${t.id}" data-write>They are staying — renew</button>`;
  else acts = h`<button type="button" class="btn" data-act="renew" data-id="${t.id}" data-write>Renew the lease</button>
      <button type="button" class="btn btn-ghost" data-act="moveout" data-id="${t.id}" data-write>They are moving out</button>`;
  return h`<li class="lz-item${kind === 'soon' ? ' is-soon' : ''}" data-tenant="${t.id}">
    ${ui.plate(t.unit, { property: t.property })}
    <div class="lz-item-main">
      <p class="lz-item-text">${who(r)}, ${T.unitWord(t.unit)} — <span class="${kind === 'soon' || kind === 'moving' ? 'tone-warn' : ''}">${line}</span></p>
      <p class="lz-item-sub">${t.property} · ${M.fmt(r.rent)} a month</p>
      <div class="lz-item-acts">${acts}</div>
    </div>
  </li>`;
}
function list(rows, today, settings) {
  const nd = settings.leaseNoticeDays;
  const g = { soon: [], moving: [], mtm: [], later: [] };
  rows.forEach(r => { g[r.group === 'moving' ? 'moving' : r.group === 'mtm' ? 'mtm' : soon(r, nd) ? 'soon' : 'later'].push(r); });
  const sec = (k, title, note, empty) => h`<section class="lz-sec" aria-labelledby="lz-h-${k}"><h2 class="lz-sec-title" id="lz-h-${k}">${title} <span class="lz-sec-n">(${g[k].length})</span></h2>
    ${note ? h`<p class="tn-caption">${note}</p>` : ''}
    ${g[k].length ? h`<ul class="lz-items">${g[k].map(r => item(r, today, k))}</ul>` : h`<p class="lz-empty">${empty}</p>`}</section>`;
  return h`${sec('soon', 'Leases ending soon', 'Ending in the next ' + nd + ' days. Choose what happens next for each one.', 'No lease ends in the next ' + nd + ' days. Nothing to decide.')}
    ${g.moving.length ? sec('moving', 'Moving out', null, '') : ''}
    ${sec('mtm', 'Month-to-month', 'No end date. They pay month by month until someone gives notice.', 'Nobody is month-to-month.')}
    ${g.later.length ? sec('later', 'Later', null, '') : ''}`;
}

// ------------------------------------------------------------------ calendar (desktop only)
function timeline(rows, today, settings) {
  const curKey = D.monthKey(today);
  const w0 = D.monthStart(curKey);
  const w1 = D.monthStart(D.addMonthKey(curKey, 12));
  const span = D.diffDays(w0, w1);
  const pct = d => Math.max(0, Math.min(100, (D.diffDays(w0, d) / span) * 100));
  const fx = n => n.toFixed(3) + '%';
  const nd = settings.leaseNoticeDays;
  const todayX = pct(today);
  const nwEnd = D.addDays(today, nd);
  const months = Array.from({ length: 12 }, (_, i) => {
    const k = D.addMonthKey(curKey, i);
    const mon = D.MON[+k.slice(5, 7) - 1];
    const label = i === 0 || k.slice(5) === '01' ? h`${mon}<span class="lz-yr">${' ' + k.slice(0, 4)}</span>` : mon;
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
        ${r.group === 'moving' ? h`<span class="lz-cap" aria-hidden="true"></span>` : ''}${off ? h`<span class="lz-arrow" aria-hidden="true">${ui.icon('arrow-right', { size: 12 })}</span>` : ''}
        ${inside ? h`<span class="lz-label">${label}</span>` : ''}</div>
      ${inside ? '' : h`<span class="lz-label lz-label-out" style="left:calc(${fx(right)} + 8px)">${label}</span>`}`;
  };
  return h`<p class="tn-caption lz-cal-cap">Each bar is one lease, from when it started to when it ends. The blue line is today. The shaded band is the next ${nd} days — leases ending inside it need a decision. Dashed bars are month-to-month; a bar running off the right edge ends after ${D.fmtMonth(D.addMonthKey(curKey, 11))}.</p>
  <div class="lz-tl" role="table" aria-label="Lease calendar, ${D.fmtMonth(curKey)} to ${D.fmtMonth(D.addMonthKey(curKey, 11))}">
    <div class="lz-head" role="row">
      <div class="lz-cname lz-head-name" role="columnheader">${RB.plural(rows.length, 'lease')}</div>
      <div class="lz-track lz-months" role="columnheader">${months.map(m => h`<span class="lz-month${m.k.slice(5) === '01' ? ' is-year' : ''}" style="left:${fx(m.x)};width:${fx(m.w)}">${m.label}</span>`)}</div>
      <div class="lz-act"></div>
    </div>
    <div class="lz-body">
      <div class="lz-grid" aria-hidden="true">
        ${months.slice(1).map(m => h`<i class="lz-gl${m.k.slice(5) === '01' ? ' is-year' : ''}" style="left:${fx(m.x)}"></i>`)}
        <i class="lz-window" style="left:${fx(todayX)};width:${fx(pct(nwEnd) - todayX)}"></i>
        <i class="lz-today" style="left:${fx(todayX)}"></i>
      </div>
      ${rows.map(r => h`<div class="lz-row" role="row" data-tenant="${r.t.id}">
        <div class="lz-cname" role="cell"><button type="button" class="lz-who" data-act="open" data-id="${r.t.id}">${ui.plate(r.t.unit, { property: r.t.property })}<span class="lz-who-name truncate">${r.t.name}</span></button></div>
        <div class="lz-track" role="cell">${bar(r)}</div>
        <div class="lz-act" role="cell"><button type="button" class="btn" data-act="decide" data-id="${r.t.id}" aria-haspopup="menu" data-write>Choices</button></div>
      </div>`)}
    </div>
    <div class="lz-foot" aria-hidden="true">
      <div class="lz-cname"></div>
      <div class="lz-track">
        <span class="lz-today-label" style="left:${fx(todayX)}">Today, ${D.fmt(today, today)}</span>
      </div>
      <div class="lz-act"></div>
    </div>
  </div>`;
}
function decideMenu(anchor, r) {
  const id = r.t.id;
  const items = [{ label: 'Renew the lease', icon: 'calendar', write: true, onSelect: () => renewLease(id) }];
  if (r.group === 'fixed') items.push({ label: 'Leave it month-to-month', icon: 'sync', write: true, onSelect: () => goMonthToMonth(id) });
  items.push({ label: r.group === 'moving' ? 'Change the moving-out day' : 'They are moving out', icon: 'door', write: true, onSelect: () => RB.actions.moveOut(id) });
  items.push({ sep: true }, { label: 'Open their page', icon: 'arrow-right', onSelect: () => RB.actions.openTenant(id) });
  ui.menu(anchor, items, { align: 'end' });
}

// ------------------------------------------------------------------ view
RB.views.register('leases', {
  title: 'Leases',
  render(el, ctx) {
    const settings = ctx.state.settings;
    const rows = leaseRows(ctx.today, settings);
    const nd = settings.leaseNoticeDays;
    const ending = rows.filter(r => soon(r, nd)).length;
    const mtm = rows.filter(r => r.group === 'mtm').length;
    const moving = rows.filter(r => r.group === 'moving').length;
    const showCal = cal && !ui.isPhone();
    el.innerHTML = String(h`
      <div class="lz-top">
        <p class="lz-summary" id="lz-summary">${ending ? h`<strong>${ending === 1 ? '1 lease ends' : ending + ' leases end'}</strong> in the next ${nd} days.` : h`No lease ends in the next ${nd} days.`} ${mtm === 1 ? '1 tenant is' : mtm + ' tenants are'} month-to-month. ${moving === 1 ? '1 tenant is' : moving + ' tenants are'} moving out.</p>
        <label class="check lz-calswitch hide-phone"><input type="checkbox" id="lz-cal" data-change="cal"${cal ? RB.raw(' checked') : ''}><span>Show as a calendar</span></label>
      </div>
      ${rows.length ? (showCal ? h`<div class="hide-phone">${timeline(rows, ctx.today, settings)}</div>` : list(rows, ctx.today, settings))
        : ui.empty({ icon: 'leases', title: 'No leases yet', body: 'Add a tenant and their lease shows up here.' })}`);
    const byId = id => rows.find(r => r.t.id === id);
    ui.bind(el, {
      cal: c => { cal = !!c.checked; RB.prefs.set('leases:cal', cal); RB.shell.refresh(); },
      open: b => RB.actions.openTenant(b.dataset.id),
      renew: b => renewLease(b.dataset.id),
      moveout: b => RB.actions.moveOut(b.dataset.id),
      mtm: b => goMonthToMonth(b.dataset.id),
      decide: b => { const r = byId(b.dataset.id); if (r) decideMenu(b, r); },
    });
  },
});

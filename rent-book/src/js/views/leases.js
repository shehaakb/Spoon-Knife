// views/leases.js — Leases: 12-month timeline (desktop) / grouped list (phone + List mode), renew / month-to-month / notice.
// Owns the RB.actions.renewLease hook.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;

let mode = RB.prefs.get('leases:mode', 'timeline'); // 'timeline' | 'list'

// ------------------------------------------------------------------ data
/** Classify every current tenant's lease for the view. */
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

function bucket(r, noticeDays) {
  if (r.group === 'moving') return 'moving';
  if (r.group === 'mtm') return 'mtm';
  if (r.days <= 30) return 'd30';
  if (r.days <= 60) return 'd60';
  if (r.days <= 90) return 'd90';
  return 'later';
}
const GROUPS = [['d30', 'Ending in 30 days'], ['d60', 'Ending in 31–60 days'], ['d90', 'Ending in 61–90 days'], ['later', 'Later'], ['mtm', 'Month-to-month'], ['moving', 'Moving out']];

/** "Renew" is the one primary for fixed leases in or near the notice window (within notice days + 30). */
function isRenewDue(r, noticeDays) { return r.group === 'fixed' && r.days != null && r.days <= noticeDays + 30; }

// ------------------------------------------------------------------ actions
function noticeGiven(id) { if (typeof RB.actions.giveNotice === 'function') return RB.actions.giveNotice(id); return RB.actions.openTenant(id); }
function moveOut(id) { if (typeof RB.actions.moveOut === 'function') return RB.actions.moveOut(id); return RB.actions.openTenant(id); }

function goMonthToMonth(id) {
  if (!S().canWrite()) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return; }
  const t = S().tenant(id); if (!t) return;
  const prev = (t.lease || {}).end || null;
  S().updateTenant(id, { lease: { end: null } }).catch(() => {});
  ui.toast(RB.actions.who(t) + ' is now month-to-month', { undo: () => S().updateTenant(id, { lease: { end: prev } }) });
}

/** Renew sheet: new end date (+12 months), optional new rent from an effective date, one-line summary. Resolves true if saved. */
function renewLease(tenantId) {
  if (!S().canWrite()) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return Promise.resolve(false); }
  const t = S().tenant(tenantId); if (!t) return Promise.resolve(false);
  const today = S().today();
  const l = t.lease || {};
  const curEnd = l.end && l.end >= today ? l.end : null;
  const base = curEnd || today;
  const defEnd = D.addMonths(base, 12);
  const curRent = RB.model.rentOn(t, today);
  const defFrom = curEnd ? D.addDays(curEnd, 1) : D.monthStart(D.addMonthKey(D.monthKey(today), 1));
  const who = RB.actions.who(t);
  return new Promise(resolve => {
    let ok = false;
    const summary = v => {
      const parts = [];
      parts.push(curEnd ? h`Lease end moves from <strong>${D.fmt(curEnd, today)}</strong> to <strong>${v.end ? D.fmt(v.end, today) : '…'}</strong>` : h`Lease becomes fixed-term, ending <strong>${v.end ? D.fmt(v.end, today) : '…'}</strong>`);
      if (v.rent != null && v.rent !== curRent) parts.push(h`rent ${M.fmt(curRent)} → <strong>${M.fmt(v.rent)}</strong> from ${v.from ? D.fmt(v.from, today) : '…'}`);
      else parts.push(h`rent stays ${M.fmt(curRent)}`);
      if (l.noticeDate || t.status === 'notice') parts.push(h`notice is withdrawn`);
      return RB.html.join(parts, ' · ');
    };
    ui.sheet({
      title: 'Renew lease', sub: t.name + ' · ' + RB.model.unitLabel(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-grid">
          ${ui.field({ name: 'end', id: 'lz-renew-end', label: 'New end date', type: 'date', value: defEnd, required: true, hint: curEnd ? 'Currently ' + D.fmt(curEnd, today) : 'Currently month-to-month' })}
          <div class="field"></div>
          ${ui.field({ name: 'rent', id: 'lz-renew-rent', label: 'New rent', type: 'money', optional: true, placeholder: M.input(curRent), hint: 'Leave empty to keep ' + M.fmt(curRent) })}
          ${ui.field({ name: 'from', id: 'lz-renew-from', label: 'New rent starts', type: 'date', value: defFrom, hint: 'Added to the rent schedule; earlier months keep the old rent' })}
        </div>
        <p class="lz-renew-sum mt-4" id="lz-renew-sum"></p>`);
        const upd = () => {
          const r = ui.readForm(el).values;
          el.querySelector('#lz-renew-sum').innerHTML = String(summary(r));
          sh.setAction('save', { label: r.rent != null && r.rent !== curRent ? 'Renew at ' + M.fmt(r.rent) : 'Renew lease' });
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd);
        upd();
      },
      actions: [{ id: 'save', label: 'Renew lease', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({
          end: v.end && v.end <= today ? 'Pick a date after today' : v.end && l.start && v.end <= l.start ? 'Must be after the lease start' : '',
          rent: v.rent != null && v.rent <= 0 ? 'Enter an amount above zero' : '',
          from: v.rent != null && !v.from ? 'When does the new rent start?' : '',
        }) });
        if (!v) return false;
        const before = { lease: { end: l.end || null, noticeDate: l.noticeDate || null, moveOut: l.moveOut || null }, rent: RB.clone(t.rent || []), status: t.status || 'active' };
        const patch = { lease: { end: v.end } };
        if (v.rent != null && v.rent !== curRent) {
          const sched = (t.rent || []).filter(r => r && r.from !== v.from).map(r => ({ from: r.from, amount: r.amount }));
          sched.push({ from: v.from, amount: v.rent });
          sched.sort((a, b) => D.cmp(a.from, b.from));
          patch.rent = sched;
        }
        if (l.noticeDate || t.status === 'notice') { patch.lease.noticeDate = null; patch.lease.moveOut = null; patch.status = 'active'; }
        S().updateTenant(tenantId, patch).catch(() => {});
        ok = true;
        ui.toast('Renewed ' + who + ' to ' + D.fmt(v.end, today) + (patch.rent ? ' at ' + M.fmt(v.rent) : ''), { undo: () => S().updateTenant(tenantId, before) });
      } }],
      onClose: () => resolve(ok),
    });
  });
}
RB.actions.renewLease = renewLease;

function decideMenu(anchor, r) {
  const id = r.t.id;
  const items = [];
  items.push({ label: r.group === 'mtm' ? 'Renew with an end date…' : 'Renew…', icon: 'calendar', write: true, onSelect: () => renewLease(id) });
  if (r.group === 'fixed') items.push({ label: 'Go month-to-month', icon: 'sync', write: true, onSelect: () => goMonthToMonth(id) });
  if (r.group !== 'moving') items.push({ label: 'Notice given…', icon: 'door', write: true, onSelect: () => noticeGiven(id) });
  else items.push({ label: 'Plan move-out…', icon: 'door', write: true, onSelect: () => moveOut(id) });
  items.push({ sep: true }, { label: 'Open tenant', icon: 'arrow-right', onSelect: () => RB.actions.openTenant(id) });
  ui.menu(anchor, items, { align: 'end' });
}

// ------------------------------------------------------------------ rendering helpers
function actionCell(r, noticeDays, phone) {
  const id = r.t.id;
  if (r.group === 'moving') return h`<button type="button" class="btn btn-sm${phone ? '' : ' btn-ghost'}" data-act="moveout" data-id="${id}" data-write>Plan move-out</button>`;
  if (isRenewDue(r, noticeDays)) {
    return h`<span class="btn-group"><button type="button" class="btn btn-sm btn-primary" data-act="renew" data-id="${id}" data-write>Renew</button><button type="button" class="btn btn-sm btn-primary btn-caret" data-act="decide" data-id="${id}" aria-label="Other choices for ${r.t.name}" aria-haspopup="menu" data-write>${ui.icon('chevron-down')}</button></span>`;
  }
  return h`<button type="button" class="btn btn-sm" data-act="decide" data-id="${id}" aria-haspopup="menu" data-write><span>Decide</span>${ui.icon('chevron-down')}</button>`;
}

function endText(r, today) {
  if (r.group === 'mtm') return r.ls.holdover && r.t.lease.end ? 'month-to-month · lease ended ' + D.fmt(r.t.lease.end, today) : 'month-to-month';
  if (r.group === 'moving') return 'moves out ' + D.fmt(r.endDate, today) + ' · ' + (r.days >= 0 ? r.days + ' d' : 'moved');
  return D.fmt(r.endDate, today) + ' · ' + (r.days === 0 ? 'today' : r.days + ' d');
}

// ------------------------------------------------------------------ timeline
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
    const label = i === 0 || k.slice(5) === '01' ? D.fmtMonthShort(k, today, { year: true }) : D.MON[+k.slice(5, 7) - 1];
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
    // label: after the bar if there is room, otherwise inside its right end
    const label = r.group === 'mtm' ? 'month-to-month' : r.group === 'moving' ? 'Moves out ' + D.fmt(r.endDate, today) + ' · ' + r.days + ' d' : off ? 'ends ' + D.fmt(r.endDate, today) : D.fmt(r.endDate, today) + ' · ' + (r.days === 0 ? 'today' : r.days + ' d');
    const inside = open || off || right > 78;
    const title = r.t.name + ' — ' + (l.start ? D.fmt(l.start, today) : '?') + ' to ' + (r.group === 'mtm' ? 'month-to-month' : D.fmt(r.endDate, today));
    return h`<div class="${cls}${inside ? ' lz-bar-in' : ''}" style="left:${fx(left)};width:${fx(width)}" data-start="${startD}" data-end="${r.group === 'mtm' ? '' : r.endDate}" title="${title}">
        ${r.group === 'moving' ? h`<span class="lz-cap" aria-hidden="true"></span>` : ''}${off ? h`<span class="lz-arrow" aria-hidden="true">${ui.icon('arrow-right', { size: 12 })}</span>` : ''}
        ${inside ? h`<span class="lz-label">${label}</span>` : ''}</div>
      ${inside ? '' : h`<span class="lz-label lz-label-out" style="left:calc(${fx(right)} + 8px)">${label}</span>`}`;
  };
  return h`<div class="lz-tl" role="table" aria-label="Lease timeline, ${D.fmtMonth(curKey)} to ${D.fmtMonth(D.addMonthKey(curKey, 11))}">
    <div class="lz-head" role="row">
      <div class="lz-name lz-head-name" role="columnheader">${RB.plural(rows.length, 'lease')}</div>
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
        <div class="lz-name" role="cell"><button type="button" class="lz-who" data-act="open" data-id="${r.t.id}">${ui.plate(r.t.unit, { property: r.t.property })}<span class="lz-who-text"><span class="lz-who-name truncate">${r.t.name}</span><span class="lz-who-sub truncate">${r.t.property}</span></span></button></div>
        <div class="lz-track" role="cell"><span class="vh">${endText(r, today)}</span>${bar(r)}</div>
        <div class="lz-act" role="cell">${actionCell(r, settings.leaseNoticeDays)}</div>
      </div>`)}
    </div>
    <div class="lz-foot" aria-hidden="true">
      <div class="lz-name"></div>
      <div class="lz-track">
        <span class="lz-today-label" style="left:${fx(todayX)}">Today · ${D.fmt(today, today)}</span>
        <span class="lz-window-label" style="left:${fx(pct(nwEnd))}">Notice window ends ${D.fmt(nwEnd, today)} (${nd} d)</span>
      </div>
      <div class="lz-act"></div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ list
function list(rows, today, settings) {
  const by = {};
  rows.forEach(r => { (by[bucket(r, settings.leaseNoticeDays)] = by[bucket(r, settings.leaseNoticeDays)] || []).push(r); });
  const rel = r => r.group === 'mtm' ? (r.ls.holdover ? 'lease ended ' + D.fmt(r.t.lease.end, today) : 'no end date') : r.days < 0 ? -r.days + ' d ago' : r.days === 0 ? 'today' : 'in ' + r.days + ' d';
  const endCell = r => r.group === 'mtm' ? h`<span class="muted">Month-to-month</span>` : h`<span class="medium">${D.fmt(r.endDate, today)}</span>`;
  const tone = r => (r.group === 'fixed' && r.days <= 30) || (r.group === 'moving' && r.days <= 30) ? ' tone-warn' : '';
  return h`${GROUPS.filter(([k]) => by[k]).map(([k, label]) => h`
    <div class="sec sec-sm lz-group"><h2 class="sec-title">${label}</h2><span class="sec-meta">${by[k].length}</span></div>
    <div class="tbl-wrap hide-phone"><table class="tbl lz-list-tbl">
      <thead><tr><th>Tenant</th><th>${k === 'moving' ? 'Moves out' : 'Lease ends'}</th><th></th><th class="num">Rent</th><th class="shrink"></th></tr></thead>
      <tbody>${by[k].map(r => h`<tr data-tenant="${r.t.id}">
        <td><button type="button" class="lz-who" data-act="open" data-id="${r.t.id}">${ui.plate(r.t.unit, { property: r.t.property })}<span class="lz-who-text"><span class="lz-who-name truncate">${r.t.name}</span><span class="lz-who-sub truncate">${r.t.property}</span></span></button></td>
        <td>${endCell(r)}</td><td class="faint${tone(r)}">${rel(r)}</td>
        <td class="num">${ui.money(r.rent)}</td>
        <td class="shrink">${actionCell(r, settings.leaseNoticeDays)}</td></tr>`)}</tbody>
    </table></div>
    <div class="clist show-phone">${by[k].map(r => h`<div class="crow" data-tenant="${r.t.id}">
      <span class="crow-lead">${ui.plate(r.t.unit)}</span>
      <div class="crow-main"><div class="crow-title"><button type="button" class="lz-link" data-act="open" data-id="${r.t.id}">${r.t.name}</button></div>
        <div class="crow-sub">${r.group === 'mtm' ? 'Month-to-month' : (r.group === 'moving' ? 'Moves out ' : 'Ends ') + D.fmt(r.endDate, today)} · <span class="${tone(r).trim()}">${rel(r)}</span></div></div>
      ${r.group === 'moving' || isRenewDue(r, settings.leaseNoticeDays)
        ? h`<div class="crow-aside"><span>${ui.money(r.rent)}<span class="faint t-12"> /mo</span></span></div>
          <div class="crow-actions">${actionCell(r, settings.leaseNoticeDays, true)}</div>`
        : h`<div class="crow-aside"><span>${ui.money(r.rent)}<span class="faint t-12"> /mo</span></span>
          <button type="button" class="btn btn-sm btn-ghost lz-decide-ph" data-act="decide" data-id="${r.t.id}" aria-haspopup="menu" aria-label="Decide on ${r.t.name}’s lease" data-write><span>Decide</span>${ui.icon('chevron-down')}</button></div>`}
    </div>`)}</div>`)}`;
}

// ------------------------------------------------------------------ view
RB.views.register('leases', {
  title: 'Leases',
  shortcuts: [['t', 'Timeline'], ['l', 'List']],
  render(el, ctx) {
    const settings = ctx.state.settings;
    const rows = leaseRows(ctx.today, settings);
    const nd = settings.leaseNoticeDays;
    const ending = rows.filter(r => r.group === 'fixed' && r.days <= nd).length;
    const mtm = rows.filter(r => r.group === 'mtm').length;
    const moving = rows.filter(r => r.group === 'moving').length;
    const parts = [h`<strong>${RB.plural(ending, 'lease')}</strong> ${ending === 1 ? 'ends' : 'end'} in the next ${nd} days`, h`<strong>${mtm}</strong> month-to-month`, h`<strong>${moving}</strong> moving out`];
    el.innerHTML = String(h`
      <div class="view-head lz-head-row">
        <p class="lz-summary">${RB.html.join(parts, h`<span class="lz-dot" aria-hidden="true"> · </span>`)}</p>
        <span class="spacer"></span>
        <div class="seg hide-phone" role="group" aria-label="Layout">
          <button type="button" id="lz-mode-timeline" data-act="mode" data-mode="timeline" aria-pressed="${String(mode === 'timeline')}">Timeline</button>
          <button type="button" id="lz-mode-list" data-act="mode" data-mode="list" aria-pressed="${String(mode === 'list')}">List</button>
        </div>
      </div>
      ${rows.length ? h`
        ${mode === 'timeline' ? h`<div class="hide-phone">${timeline(rows, ctx.today, settings)}</div>` : ''}
        <div class="${mode === 'timeline' ? 'show-phone' : ''}">${list(rows, ctx.today, settings)}</div>`
        : ui.empty({ icon: 'leases', title: 'No current leases', body: 'Add a tenant with lease dates and it shows up here.' })}`);
    const byId = id => rows.find(r => r.t.id === id);
    ui.bind(el, {
      mode: b => { mode = b.dataset.mode; RB.prefs.set('leases:mode', mode); RB.shell.refresh(); },
      open: b => RB.actions.openTenant(b.dataset.id),
      renew: b => renewLease(b.dataset.id),
      decide: b => { const r = byId(b.dataset.id); if (r) decideMenu(b, r); },
      moveout: b => moveOut(b.dataset.id),
    });
  },
  onKey(e) {
    if (e.key === 't' || e.key === 'l') { mode = e.key === 't' ? 'timeline' : 'list'; RB.prefs.set('leases:mode', mode); RB.shell.refresh(); return true; }
    return false;
  },
});

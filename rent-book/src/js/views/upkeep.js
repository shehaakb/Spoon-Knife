// views/upkeep.js — Upkeep: Open · Scheduled · Done columns (desktop) / segmented list (phone); add/edit sheet.
// Owns the RB.actions.addTicket and RB.actions.openTicket hooks.
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;

let phoneTab = RB.prefs.get('upkeep:tab', 'open');   // open | scheduled | done
let propFilter = RB.prefs.get('upkeep:prop', '');
let showOlder = false;
let inline = null;                                     // {id, kind:'schedule'|'done', date, cost, charge}

const PRIO = { urgent: 'Urgent', normal: 'Normal', low: 'Low' };
const STATUS = [['open', 'Open'], ['scheduled', 'Scheduled'], ['done', 'Done']];

function guard() {
  if (!S().canWrite()) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return false; }
  return true;
}
const where = k => [k.property, k.unit].filter(Boolean).join(' ') || 'Common area';
const tenantName = k => { const t = k.tenantId && S().tenant(k.tenantId); return t ? t.name : ''; };
const canCharge = k => k.paidBy === 'tenant' && k.tenantId && S().tenant(k.tenantId) && k.cost > 0 && !k.chargeId;

/** Post the ticket's cost to the tenant ledger as a damage charge. Returns the entry id. */
function postCharge(k, cost, date) {
  const id = RB.id();
  S().addEntry(k.tenantId, { id, type: 'charge', category: 'damage', date, period: D.monthKey(date), amount: cost, memo: (k.title || 'Repair') + ' (upkeep)' }).catch(() => {});
  return id;
}

// ------------------------------------------------------------------ status moves (Undo, not confirm)
function snapshot(k) { return { status: k.status, scheduled: k.scheduled || null, completed: k.completed || null, cost: k.cost == null ? null : k.cost, chargeId: k.chargeId || null }; }
function schedule(id, date) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const before = snapshot(k);
  S().updateTicket(id, { status: 'scheduled', scheduled: date }).catch(() => {});
  ui.toast('Scheduled “' + k.title + '” for ' + D.fmt(date, S().today()), { undo: () => S().updateTicket(id, before) });
}
function markDone(id, cost, charge) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const today = S().today();
  const before = snapshot(k);
  const patch = { status: 'done', completed: today };
  if (cost !== undefined) patch.cost = cost;
  let chargeId = null;
  const after = Object.assign({}, k, patch);
  if (charge && canCharge(after)) { chargeId = postCharge(after, after.cost, today); patch.chargeId = chargeId; }
  S().updateTicket(id, patch).catch(() => {});
  const t = chargeId && S().tenant(k.tenantId);
  ui.toast(chargeId ? 'Done · added ' + M.fmt(after.cost) + ' charge to ' + RB.actions.who(t) : 'Marked “' + k.title + '” done', {
    undo: () => { S().updateTicket(id, before); if (chargeId) S().undoEntry(k.tenantId, chargeId); },
  });
}
function reopen(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const before = snapshot(k);
  S().updateTicket(id, { status: k.scheduled ? 'scheduled' : 'open', completed: null }).catch(() => {});
  ui.toast('Reopened “' + k.title + '”', { undo: () => S().updateTicket(id, before) });
}
function chargeTenant(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k || !canCharge(k)) return;
  const cid = postCharge(k, k.cost, k.completed || S().today());
  S().updateTicket(id, { chargeId: cid }).catch(() => {});
  const t = S().tenant(k.tenantId);
  ui.toast('Added ' + M.fmt(k.cost) + ' charge to ' + RB.actions.who(t), { undo: () => { S().undoEntry(k.tenantId, cid); S().updateTicket(id, { chargeId: null }); } });
}

// ------------------------------------------------------------------ add / edit sheet
function ticketSheet(id, prefill) {
  if (!guard()) return Promise.resolve(null);
  const today = S().today();
  const k = id ? S().ticket(id) : null;
  if (id && !k) { ui.toast('That upkeep request no longer exists.'); return Promise.resolve(null); }
  const p = Object.assign({ tenantId: null, property: '', unit: '', title: '', detail: '', priority: 'normal', status: 'open', reported: today, scheduled: null, completed: null, vendor: '', cost: null, paidBy: 'owner' }, k || prefill || {});
  if (!k && p.tenantId) { const t = S().tenant(p.tenantId); if (t) { p.property = p.property || t.property; p.unit = p.unit || t.unit; } }
  const tenants = S().tenantsList({ includePast: false });
  if (p.tenantId && !tenants.some(t => t.id === p.tenantId)) { const t = S().tenant(p.tenantId); if (t) tenants.push(t); }
  const props = Array.from(new Set(S().tenantsList().map(t => t.property).concat(S().ticketsList().map(x => x.property)).filter(Boolean))).sort(RB.natCmp);
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: k ? 'Edit upkeep request' : 'New upkeep request', size: 'wide',
      sub: k ? where(k) + ' · reported ' + D.fmt(k.reported, today) : '',
      body: (el, sh) => {
        el.innerHTML = String(h`<fieldset class="fieldset"><legend class="fieldset-title">What and where</legend><div class="form-grid">
            ${ui.field({ name: 'title', id: 'uk-title', label: 'What needs doing', value: p.title, required: true, placeholder: 'No hot water, leaking tap…', span: 2 })}
            ${ui.field({ name: 'tenantId', id: 'uk-tenant', label: 'Tenant', type: 'select', value: p.tenantId || '', span: 2,
              options: [{ value: '', label: 'No tenant — common area or vacant unit' }].concat(tenants.map(t => ({ value: t.id, label: t.name + ' · ' + RB.model.unitLabel(t) }))) })}
            ${ui.field({ name: 'property', id: 'uk-property', label: 'Property', value: p.property, attrs: { list: 'uk-props' }, required: true })}
            ${ui.field({ name: 'unit', id: 'uk-unit', label: 'Unit or area', value: p.unit, placeholder: '2B, basement, roof…', optional: true })}
            ${ui.field({ name: 'detail', id: 'uk-detail', label: 'Details', type: 'textarea', value: p.detail, optional: true, rows: 3, span: 2 })}
            ${ui.field({ name: 'priority', id: 'uk-priority', label: 'Priority', type: 'seg', value: p.priority, options: [{ value: 'urgent', label: 'Urgent', icon: 'triangle' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }] })}
            ${ui.field({ name: 'reported', id: 'uk-reported', label: 'Reported', type: 'date', value: p.reported, required: true, max: today })}
          </div><datalist id="uk-props">${props.map(x => h`<option value="${x}"></option>`)}</datalist></fieldset>
          <fieldset class="fieldset"><legend class="fieldset-title">Progress and cost</legend><div class="form-grid">
            ${ui.field({ name: 'status', id: 'uk-status', label: 'Status', type: 'seg', value: p.status, options: STATUS.map(([value, label]) => ({ value, label })), span: 2 })}
            ${ui.field({ name: 'scheduled', id: 'uk-scheduled', label: 'Scheduled for', type: 'date', value: p.scheduled || '', optional: true })}
            ${ui.field({ name: 'completed', id: 'uk-completed', label: 'Done on', type: 'date', value: p.completed || '', optional: true })}
            ${ui.field({ name: 'vendor', id: 'uk-vendor', label: 'Vendor', value: p.vendor, optional: true, placeholder: 'Who is doing the work' })}
            ${ui.field({ name: 'cost', id: 'uk-cost', label: 'Cost', type: 'money', value: p.cost, optional: true })}
            ${ui.field({ name: 'paidBy', id: 'uk-paidby', label: 'Who pays', type: 'seg', value: p.paidBy, options: [{ value: 'owner', label: 'Owner' }, { value: 'tenant', label: 'Tenant' }], span: 2 })}
            <div class="span-2" id="uk-charge-slot"></div>
          </div></fieldset>`);
        const slot = el.querySelector('#uk-charge-slot');
        let chargeChecked = true;
        const sync = e => {
          const v = ui.readForm(el).values;
          if (e && e.target && e.target.id === 'uk-tenant') {
            const t = S().tenant(v.tenantId);
            if (t) { ui.setValue(el, 'property', t.property); ui.setValue(el, 'unit', t.unit); }
          }
          el.querySelector('[data-field="completed"]').hidden = v.status !== 'done';
          el.querySelector('[data-field="scheduled"]').hidden = v.status === 'open' && !v.scheduled;
          const t = v.tenantId && S().tenant(v.tenantId);
          const already = k && k.chargeId;
          const offer = v.status === 'done' && v.paidBy === 'tenant' && v.cost > 0 && t && !already;
          const cb = slot.querySelector('#uk-charge'); if (cb) chargeChecked = cb.checked;
          slot.innerHTML = offer ? String(ui.field({ name: 'charge', id: 'uk-charge', type: 'checkbox', value: chargeChecked, label: h`Add ${M.fmt(v.cost)} charge to ${t.name}’s ledger` })) : already && v.paidBy === 'tenant' ? String(h`<div class="form-note">${ui.icon('check', { size: 12 })} Already charged to the tenant’s ledger.</div>`) : v.paidBy === 'tenant' && !t ? String(h`<div class="form-note">Pick a tenant to charge the cost to their ledger.</div>`) : '';
          sh.setAction('save', { label: k ? 'Save changes' : v.status === 'done' ? 'Add as done' : 'Add request' });
        };
        el.addEventListener('change', sync);
        el.addEventListener('input', e => { if (e.target.id === 'uk-cost') sync(e); });
        sync();
      },
      actions: [].concat(k ? [{ id: 'delete', label: 'Delete', kind: 'danger-soft', onClick: () => { del(k.id); } }] : [], [{ id: 'save', label: k ? 'Save changes' : 'Add request', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({
          cost: v.cost != null && v.cost < 0 ? 'Cost can’t be negative' : '',
          scheduled: v.status === 'scheduled' && !v.scheduled ? 'When is it booked for?' : '',
        }) });
        if (!v) return false;
        const data = { tenantId: v.tenantId || null, property: v.property, unit: v.unit, title: v.title, detail: v.detail, priority: v.priority || 'normal',
          status: v.status || 'open', reported: v.reported, scheduled: v.scheduled || null, completed: v.status === 'done' ? (v.completed || today) : null,
          vendor: v.vendor, cost: v.cost, paidBy: v.paidBy || 'owner' };
        let chargeId = null;
        if (v.charge && canCharge(Object.assign({}, k || {}, data))) { chargeId = postCharge(data, data.cost, data.completed); data.chargeId = chargeId; }
        const undoCharge = () => { if (chargeId) S().undoEntry(data.tenantId, chargeId); };
        if (k) {
          const before = {}; Object.keys(data).forEach(key => { before[key] = k[key] === undefined ? null : k[key]; });
          S().updateTicket(k.id, data).catch(() => {});
          saved = k.id;
          ui.toast('Saved “' + data.title + '”' + (chargeId ? ' · charged ' + M.fmt(data.cost) : ''), { undo: () => { S().updateTicket(k.id, before); undoCharge(); } });
        } else {
          const nid = RB.id();
          S().addTicket(Object.assign({ id: nid }, data)).catch(() => {});
          saved = nid;
          ui.toast('Added “' + data.title + '”' + (chargeId ? ' · charged ' + M.fmt(data.cost) : ''), { undo: () => { S().deleteTicket(nid); undoCharge(); } });
        }
      } }]),
      initialFocus: k ? '#uk-title' : '#uk-title',
      onClose: () => resolve(saved),
    });
  });
}
function del(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const copy = RB.clone(k);
  S().deleteTicket(id).catch(() => {});
  ui.toast('Deleted “' + k.title + '”', { undo: () => S().addTicket(copy) });
}
RB.actions.addTicket = prefill => ticketSheet(null, prefill);
RB.actions.openTicket = id => ticketSheet(id);

// ------------------------------------------------------------------ rendering
function sorted(list, status, today) {
  if (status === 'done') return list.slice().sort((a, b) => D.cmp(b.completed || '', a.completed || '') || D.cmp(b.reported, a.reported));
  if (status === 'scheduled') return list.slice().sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || D.cmp(a.scheduled || '9', b.scheduled || '9') || D.cmp(a.reported, b.reported));
  return list.slice().sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || D.cmp(a.reported, b.reported) || (a.priority === 'low') - (b.priority === 'low'));
}

function card(k, today) {
  const age = k.reported ? D.diffDays(k.reported, today) : 0;
  const tn = tenantName(k);
  let when;
  if (k.status === 'done') when = h`Done ${D.fmt(k.completed, today)}${k.reported && k.completed ? ' · took ' + Math.max(0, D.diffDays(k.reported, k.completed)) + ' d' : ''}`;
  else if (k.status === 'scheduled') when = h`<span class="${k.scheduled && k.scheduled < today ? 'tone-warn medium' : ''}">${k.scheduled ? (k.scheduled < today ? 'Was due ' : 'Booked ') + D.fmt(k.scheduled, today) + ' · ' + D.rel(k.scheduled, today) : 'No date'}</span> · ${age} d open`;
  else when = h`<span class="${age >= 7 ? 'tone-warn medium' : ''}">${age === 0 ? 'Reported today' : age + ' d open'}</span>`;
  const isInline = inline && inline.id === k.id;
  const chargeOffer = k.status === 'done' && canCharge(k);
  return h`<article class="uk-card${k.priority === 'urgent' && k.status !== 'done' ? ' is-urgent' : ''}" data-ticket="${k.id}">
    <div class="uk-card-top">
      <span class="uk-plate">${ui.plate(k.unit || '—', { property: k.property })}</span>
      <button type="button" class="uk-title" data-act="edit" data-id="${k.id}">${k.title || 'Untitled request'}</button>
      ${k.priority === 'urgent' && k.status !== 'done' ? h`<span class="tag tag-bad uk-prio">${ui.icon('triangle', { size: 12 })}Urgent</span>` : k.priority === 'low' ? h`<span class="uk-prio-low" title="Low priority">${ui.icon('chevron-down', { size: 12 })}Low</span>` : ''}
    </div>
    <div class="uk-meta">${k.property || 'No property'}${tn ? h` · ${tn}` : ''}</div>
    <div class="uk-meta">${when}</div>
    ${k.vendor || k.cost != null ? h`<div class="uk-meta uk-money">${k.vendor ? h`<span>${k.vendor}</span>` : ''}${k.cost != null ? h`<span>${ui.money(k.cost)}${k.paidBy === 'tenant' ? h` <span class="faint">· tenant pays${k.chargeId ? ', charged' : ''}</span>` : ''}</span>` : ''}</div>` : ''}
    ${isInline ? inlineForm(k, today) : h`<div class="uk-actions">
      ${k.status === 'open' ? h`<button type="button" class="btn btn-sm" data-act="sched" data-id="${k.id}" data-write>${ui.icon('calendar')}<span>Schedule</span></button><button type="button" class="btn btn-sm btn-ghost" data-act="done" data-id="${k.id}" data-write>${ui.icon('check')}<span>Mark done</span></button>` : ''}
      ${k.status === 'scheduled' ? h`<button type="button" class="btn btn-sm" data-act="done" data-id="${k.id}" data-write>${ui.icon('check')}<span>Mark done</span></button><button type="button" class="btn btn-sm btn-ghost" data-act="sched" data-id="${k.id}" data-write>Reschedule</button>` : ''}
      ${k.status === 'done' ? h`${chargeOffer ? h`<button type="button" class="btn btn-sm btn-soft" data-act="charge" data-id="${k.id}" data-write>Charge ${M.fmt(k.cost)} to tenant</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-act="reopen" data-id="${k.id}" data-write>Reopen</button>` : ''}
    </div>`}
  </article>`;
}

function inlineForm(k, today) {
  if (inline.kind === 'schedule') {
    return h`<form class="uk-inline" data-submit="inlineSave" data-id="${k.id}">
      <label class="field-label" for="uk-in-date">Booked for</label>
      <div class="row"><input class="input" type="date" id="uk-in-date" data-kind="date" value="${inline.date}" min="${k.reported || ''}" data-input="inlineDate" required>
        <button type="submit" class="btn btn-sm btn-primary" data-write>Schedule</button>
        <button type="button" class="btn btn-sm btn-ghost btn-icon" data-act="inlineCancel" aria-label="Cancel">${ui.icon('x')}</button></div>
    </form>`;
  }
  const t = k.tenantId && S().tenant(k.tenantId);
  const offer = k.paidBy === 'tenant' && t && !k.chargeId;
  const c = M.parse(inline.cost);
  return h`<form class="uk-inline" data-submit="inlineSave" data-id="${k.id}">
    <label class="field-label" for="uk-in-cost">Final cost <span class="opt">optional</span></label>
    <div class="row"><span class="money-input grow"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" data-kind="money" id="uk-in-cost" value="${inline.cost}" placeholder="0.00" data-input="inlineCost" autocomplete="off"></span>
      <button type="submit" class="btn btn-sm btn-primary" data-write>Mark done</button>
      <button type="button" class="btn btn-sm btn-ghost btn-icon" data-act="inlineCancel" aria-label="Cancel">${ui.icon('x')}</button></div>
    ${offer ? h`<label class="check uk-inline-charge"><input type="checkbox" id="uk-in-charge" data-change="inlineCharge"${inline.charge ? RB.raw(' checked') : ''}><span id="uk-in-charge-label">${c > 0 ? 'Add ' + M.fmt(c) + ' charge to ' + t.name + '’s ledger' : 'Charge the cost to ' + t.name + '’s ledger'}</span></label>` : ''}
  </form>`;
}

function column(status, label, items, today, extra) {
  return h`<section class="uk-col" aria-labelledby="uk-col-${status}">
    <div class="uk-col-head"><h2 class="uk-col-title" id="uk-col-${status}">${label}</h2><span class="uk-col-count">${items.length}</span></div>
    <div class="uk-col-body">${items.length ? items.map(k => card(k, today)) : h`<div class="uk-empty">${status === 'open' ? 'Nothing waiting. ' : status === 'scheduled' ? 'Nothing booked.' : 'Nothing finished in the last 30 days.'}</div>`}${extra || ''}</div>
  </section>`;
}

RB.views.register('upkeep', {
  title: 'Upkeep',
  firstRun: false,
  shortcuts: [['c', 'New upkeep request']],
  render(el, ctx) {
    const today = ctx.today;
    const all = S().ticketsList();
    const props = Array.from(new Set(all.map(k => k.property).filter(Boolean))).sort(RB.natCmp);
    if (propFilter && !props.includes(propFilter)) propFilter = '';
    const list = all.filter(k => !propFilter || k.property === propFilter);
    const by = { open: [], scheduled: [], done: [] };
    list.forEach(k => (by[k.status] || by.open).push(k));
    const cutoff = D.addDays(today, -30);
    const doneRecent = by.done.filter(k => (k.completed || k.reported) >= cutoff);
    const older = by.done.length - doneRecent.length;
    const doneShown = sorted(showOlder ? by.done : doneRecent, 'done', today);
    const notDone = by.open.concat(by.scheduled);
    const urgent = notDone.filter(k => k.priority === 'urgent').length;
    const oldest = notDone.reduce((m, k) => Math.max(m, k.reported ? D.diffDays(k.reported, today) : 0), 0);
    const cols = { open: sorted(by.open, 'open', today), scheduled: sorted(by.scheduled, 'scheduled', today), done: doneShown };
    const olderBtn = older ? h`<button type="button" class="linkbtn linkbtn-muted uk-older" data-act="older">${showOlder ? 'Hide older' : 'Show ' + RB.plural(older, 'older request')}</button>` : '';
    const countLine = notDone.length ? h`<strong>${notDone.length}</strong> open${by.scheduled.length ? h` (${by.scheduled.length} scheduled)` : ''}${urgent ? h` · <span class="tone-bad medium">${urgent} urgent</span>` : ''} · oldest ${oldest} d` : h`Nothing open`;
    const chipCount = p => all.filter(k => k.status !== 'done' && (!p || k.property === p)).length;
    el.innerHTML = String(h`
      <div class="view-head uk-head">
        <p class="uk-count" id="uk-count">${countLine}</p>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" data-act="add" id="uk-add" data-write>${ui.icon('plus')}<span>New request</span></button>
      </div>
      ${props.length > 1 ? h`<div class="chips chips-scroll uk-filter" role="group" aria-label="Filter by property">
        <button type="button" class="chip" data-act="prop" data-prop="" aria-pressed="${String(!propFilter)}">All properties<span class="chip-count">${chipCount('')}</span></button>
        ${props.map(p => h`<button type="button" class="chip" data-act="prop" data-prop="${p}" aria-pressed="${String(propFilter === p)}">${p}<span class="chip-count">${chipCount(p)}</span></button>`)}
      </div>` : ''}
      ${all.length ? h`
        <div class="seg uk-tabs show-phone" role="group" aria-label="Status">${STATUS.map(([s, label]) => h`<button type="button" data-act="tab" data-tab="${s}" aria-pressed="${String(phoneTab === s)}">${label} <span class="faint">${s === 'done' ? cols.done.length : cols[s].length}</span></button>`)}</div>
        <div class="uk-cols" data-tab="${phoneTab}">
          ${column('open', 'Open', cols.open, today)}
          ${column('scheduled', 'Scheduled', cols.scheduled, today)}
          ${column('done', showOlder ? 'Done' : 'Done · last 30 days', cols.done, today, olderBtn)}
        </div>`
        : ui.empty({ icon: 'wrench', title: 'No upkeep requests', body: 'Log repairs and maintenance here so nothing slips — who reported it, who’s fixing it, what it cost.', actions: [{ label: 'New request', kind: 'primary', act: 'add', icon: 'plus', write: true }] })}`);
    ui.bind(el, {
      add: () => ticketSheet(null, propFilter ? { property: propFilter } : null),
      edit: b => ticketSheet(b.dataset.id),
      prop: b => { propFilter = b.dataset.prop; RB.prefs.set('upkeep:prop', propFilter); RB.shell.refresh(); },
      tab: b => { phoneTab = b.dataset.tab; RB.prefs.set('upkeep:tab', phoneTab); RB.shell.refresh(); },
      older: () => { showOlder = !showOlder; RB.shell.refresh(); },
      sched: b => { const k = S().ticket(b.dataset.id); inline = { id: b.dataset.id, kind: 'schedule', date: (k && k.scheduled) || D.addDays(today, 2) }; RB.shell.refresh(); focusInline(el, '#uk-in-date'); },
      done: b => { const k = S().ticket(b.dataset.id); inline = { id: b.dataset.id, kind: 'done', cost: k && k.cost != null ? M.input(k.cost) : '', charge: true }; RB.shell.refresh(); focusInline(el, '#uk-in-cost'); },
      inlineCancel: () => { inline = null; RB.shell.refresh(); },
      inlineDate: b => { if (inline) inline.date = b.value; },
      inlineCost: b => {
        if (!inline) return; inline.cost = b.value;
        const lab = el.querySelector('#uk-in-charge-label'); const k = S().ticket(inline.id); const t = k && S().tenant(k.tenantId); const c = M.parse(b.value);
        if (lab && t) lab.textContent = c > 0 ? 'Add ' + M.fmt(c) + ' charge to ' + t.name + '’s ledger' : 'Charge the cost to ' + t.name + '’s ledger';
      },
      inlineCharge: b => { if (inline) inline.charge = b.checked; },
      inlineSave: f => {
        const id = f.dataset.id; const cur = inline; if (!cur) return;
        if (cur.kind === 'schedule') {
          if (!D.valid(cur.date || '')) { el.querySelector('#uk-in-date').focus(); return; }
          inline = null; schedule(id, cur.date);
        } else {
          const raw = String(cur.cost || '').trim(); const c = raw ? M.parse(raw) : undefined;
          if (raw && (c === null || c < 0)) { ui.toast('Enter a cost like 185.50', { tone: 'bad' }); return; }
          inline = null; markDone(id, c === undefined ? undefined : c, cur.charge);
        }
        RB.shell.refresh();
      },
      reopen: b => reopen(b.dataset.id),
      charge: b => chargeTenant(b.dataset.id),
    });
  },
  onKey(e) { if (e.key === 'c') { ticketSheet(null); return true; } return false; },
  destroy() { inline = null; },
});
function focusInline(el, sel) { const x = el.querySelector(sel); if (x) { x.focus(); if (x.select && x.type !== 'date') x.select(); } }

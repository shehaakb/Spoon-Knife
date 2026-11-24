// views/repairs.js — Repairs (#repairs; #upkeep is kept as an alias). Two worded tabs:
//   "To do"               — the Needs doing · Booked · Done board (one column at a time on phone);
//   "History by property" — one large card per property, each opening that property's history (#p-<slug>, views/property.js).
// Owns the hooks RB.actions.addTicket / openTicket / addPastRepair / openProperty, and RB.repairs (shared with
// views/property.js and the tenant page: RB.repairs.unitSection(tenant)). Words follow SPEC §8 (repair, not ticket/request).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;
const Mo = RB.model;
const BUILDING = Mo.REPAIR_BUILDING;
const OTHER_UNIT = '*other';

let tab = RB.prefs.get('repairs:tab', 'todo');          // todo | history
let phoneTab = RB.prefs.get('upkeep:tab', 'open');      // open | scheduled | done
let propFilter = RB.prefs.get('upkeep:prop', '');
let inline = null;                                      // {id, kind:'schedule'|'done', date, cost, charge}

const STATUS = [['open', 'Needs doing'], ['scheduled', 'Booked'], ['done', 'Done']];
const PRIO = [{ value: 'urgent', label: 'Urgent', icon: 'triangle' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Can wait' }];

function guard() {
  if (!S().canWrite()) { ui.toast('View only — you can’t change this rent book.', { tone: 'bad' }); return false; }
  return true;
}
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isBuilding = k => k.scope === 'building' || !String(k.unit || '').trim();
/** "Unit 2B" / "No. 4" / "Whole building" (capitalised, for labels). */
const unitLabel = k => (isBuilding(k) ? 'Whole building' : Mo.unitWords(k.unit));
/** "November 17" this year, "November 17, 2025" otherwise. */
function longDay(d, today) {
  if (!D.isDate(d)) return '';
  return D.fmtLong(d).replace(', ' + (today || S().today()).slice(0, 4), '');
}
const canCharge = k => k.paidBy === 'tenant' && k.tenantId && S().tenant(k.tenantId) && k.cost > 0 && !k.chargeId;

// memo: repairProperties per store version
let propsMemo = { v: -1, today: '', list: [] };
function properties() {
  const v = S().version, today = S().today();
  if (propsMemo.v !== v || propsMemo.today !== today) propsMemo = { v, today, list: Mo.repairProperties(S().state, today) };
  return propsMemo.list;
}
const propertyNamed = name => properties().find(p => sameName(p.name, name)) || null;
function vendors() { return Array.from(new Set(S().ticketsList().map(k => String(k.vendor || '').trim()).filter(Boolean))).sort(RB.natCmp); }
/** The tenant who lives (or lived, on `date`) at property + unit, if any. */
function tenantAt(property, unit, date) {
  if (!property || !String(unit || '').trim()) return null;
  const list = S().tenantsList().filter(t => sameName(t.property, property) && sameName(t.unit, unit));
  if (!date) return list.find(t => t.status !== 'past') || null;
  return list.find(t => { const l = t.lease || {}; const from = l.moveIn || l.start || ''; return (!from || from <= date) && (!l.moveOut || l.moveOut >= date); }) || null;
}

/** Post a repair's cost to the tenant's payment history as a charge. Returns the entry id. */
function postCharge(k, cost, date) {
  const id = RB.id();
  S().addEntry(k.tenantId, { id, type: 'charge', category: 'damage', date, period: D.monthKey(date), amount: cost, memo: (k.title || 'Repair') + ' (repair)' }).catch(() => {});
  return id;
}
const chargeWords = (cost, t) => 'Add a ' + M.fmt(cost) + ' charge to ' + t.name + '’s payment history';

// ------------------------------------------------------------------ status moves (Undo, not confirm)
function snapshot(k) { return { status: k.status, scheduled: k.scheduled || null, completed: k.completed || null, cost: k.cost == null ? null : k.cost, chargeId: k.chargeId || null }; }
function schedule(id, date) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const before = snapshot(k);
  S().updateTicket(id, { status: 'scheduled', scheduled: date }).catch(() => {});
  ui.toast('Booked “' + k.title + '” for ' + longDay(date) + '.', { undo: () => S().updateTicket(id, before) });
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
  ui.toast(chargeId ? 'Marked “' + k.title + '” done and added a ' + M.fmt(after.cost) + ' charge for ' + t.name + '.' : 'Marked “' + k.title + '” done.', {
    undo: () => { S().updateTicket(id, before); if (chargeId) S().undoEntry(k.tenantId, chargeId); },
  });
}
function reopen(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const before = snapshot(k);
  S().updateTicket(id, { status: k.scheduled ? 'scheduled' : 'open', completed: null }).catch(() => {});
  ui.toast('Moved “' + k.title + '” back to the to-do list.', { undo: () => S().updateTicket(id, before) });
}
/** Charge a done, tenant-paid repair's cost to the tenant (works for past repairs too). */
function chargeTenant(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k || !canCharge(k)) return;
  const cid = postCharge(k, k.cost, k.completed || S().today());
  S().updateTicket(id, { chargeId: cid }).catch(() => {});
  const t = S().tenant(k.tenantId);
  ui.toast('Added a ' + M.fmt(k.cost) + ' charge for ' + t.name + ' (' + k.title + ').', { undo: () => { S().undoEntry(k.tenantId, cid); S().updateTicket(id, { chargeId: null }); } });
}
function del(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const copy = RB.clone(k);
  S().deleteTicket(id).catch(() => {});
  ui.toast('Deleted the repair “' + k.title + '”.', { undo: () => S().addTicket(copy) });
}

// ------------------------------------------------------------------ shared form pieces
/** Category choices: a row of large tappable buttons + hidden input name="category". */
function catField(id, value, label) {
  return h`<div class="field rp-catfield" data-field="category">
    <div class="field-label" id="${id}-label">${label || 'What kind of repair is it?'}</div>
    <input type="hidden" name="category" id="${id}" value="${value}">
    <div class="rp-cats" role="radiogroup" aria-labelledby="${id}-label" data-cats-for="${id}">${Mo.REPAIR_CATEGORIES.map(c => h`<button type="button" class="rp-cat" role="radio" data-cat="${c.key}" aria-checked="${String(c.key === value)}">${c.label}</button>`)}</div>
    <div class="field-hint rp-cat-hint" id="${id}-hint" aria-live="polite"></div>
  </div>`;
}
/** Wire catField: tapping picks; typing in titleInput suggests until the person picks one themselves. */
function wireCats(root, id, titleInput, auto) {
  let picked = !auto;
  const hidden = root.querySelector('#' + id), hint = root.querySelector('#' + id + '-hint'), box = root.querySelector('[data-cats-for="' + id + '"]');
  const api = {
    get: () => hidden.value || 'other',
    set(key, guessed) {
      hidden.value = key;
      box.querySelectorAll('.rp-cat').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cat === key)));
      hint.textContent = guessed ? 'Guessed from what you typed — tap another if it’s wrong.' : '';
      if (api.onChange) api.onChange(key, guessed);
    },
    reset() { picked = false; api.set('other', false); },
    guess() { if (picked) return; const s = Mo.suggestCategory(titleInput ? titleInput.value : ''); api.set(s || 'other', !!s); },
    onChange: null,
  };
  box.addEventListener('click', e => { const b = e.target.closest('.rp-cat'); if (!b) return; picked = true; api.set(b.dataset.cat, false); });
  if (titleInput) titleInput.addEventListener('input', () => api.guess());
  if (auto && titleInput && titleInput.value) api.guess();
  return api;
}

/** Property (select, or fixed) + unit (select with Whole building and "Another unit"). */
function placeFields(pfx, p, fixedProperty) {
  const names = properties().map(x => x.name);
  if (p.property && !names.some(n => sameName(n, p.property))) names.push(p.property);
  const prop = fixedProperty
    ? ''
    : names.length
      ? ui.field({ name: 'property', id: pfx + '-property', label: 'Which property?', type: 'select', value: p.property || '', required: true, requiredMsg: 'Choose the property',
        options: [{ value: '', label: 'Choose a property' }].concat(names.map(n => ({ value: n, label: n }))) })
      : ui.field({ name: 'property', id: pfx + '-property', label: 'Which property?', value: p.property || '', required: true, requiredMsg: 'Type the property name', placeholder: 'For example: Alder Court' });
  return h`${prop}
    <div class="field" data-field="unitSel">
      <label class="field-label" for="${pfx}-unit">Which unit?</label>
      <span class="select"><select class="input" id="${pfx}-unit" name="unitSel" required data-required-msg="Choose a unit, or Whole building" aria-describedby="${pfx}-unit-err">${unitOptions(fixedProperty || p.property, p.unitSel)}</select></span>
      <div class="field-error" id="${pfx}-unit-err" aria-live="polite"></div>
    </div>
    <div class="field" data-field="unitOther"${p.unitSel === OTHER_UNIT ? '' : RB.raw(' hidden')}>
      <label class="field-label" for="${pfx}-unit-other">Type the unit</label>
      <input class="input" id="${pfx}-unit-other" name="unitOther" value="${p.unitOther || ''}" placeholder="For example: 4C or Basement" autocomplete="off" aria-describedby="${pfx}-unit-other-err">
      <div class="field-error" id="${pfx}-unit-other-err" aria-live="polite"></div>
    </div>`;
}
function unitOptions(property, sel) {
  const p = property ? propertyNamed(property) : null;
  const units = p ? p.units.slice() : [];
  if (sel && sel !== BUILDING && sel !== OTHER_UNIT && !units.includes(sel)) units.push(sel);
  return h`<option value="">Choose a unit</option>${units.map(u => h`<option value="${u}"${u === sel ? RB.raw(' selected') : ''}>${Mo.unitWords(u)}</option>`)}
    <option value="${BUILDING}"${sel === BUILDING ? RB.raw(' selected') : ''}>Whole building (roof, boiler, gutters…)</option>
    <option value="${OTHER_UNIT}"${sel === OTHER_UNIT ? RB.raw(' selected') : ''}>Another unit — I’ll type it</option>`;
}
function wirePlace(root, pfx, fixedProperty, onChange) {
  const unit = root.querySelector('#' + pfx + '-unit');
  const otherWrap = root.querySelector('[data-field="unitOther"]');
  const propEl = root.querySelector('#' + pfx + '-property');
  const api = {
    property: () => fixedProperty || (propEl ? propEl.value.trim() : ''),
    read(values) {
      const sel = values.unitSel;
      const building = sel === BUILDING;
      const unit = building ? '' : sel === OTHER_UNIT ? String(values.unitOther || '').trim() : sel;
      return { property: fixedProperty || values.property, unit, scope: building ? 'building' : 'unit' };
    },
    errors(values) { return values.unitSel === OTHER_UNIT && !String(values.unitOther || '').trim() ? { unitOther: 'Type the unit, like 4C' } : {}; },
    reset() { unit.value = ''; otherWrap.hidden = true; root.querySelector('#' + pfx + '-unit-other').value = ''; },
  };
  unit.addEventListener('change', () => { otherWrap.hidden = unit.value !== OTHER_UNIT; if (unit.value === OTHER_UNIT) root.querySelector('#' + pfx + '-unit-other').focus(); if (onChange) onChange(); });
  if (propEl) propEl.addEventListener('change', () => { const keep = unit.value; unit.innerHTML = String(unitOptions(propEl.value, keep)); if (onChange) onChange(); });
  return api;
}
const unitSelOf = p => (p.unitSel !== undefined ? p.unitSel : p.scope === 'building' ? BUILDING : String(p.unit || '').trim());
function moreToggle(id, open) {
  return h`<button type="button" class="btn btn-ghost rp-more-btn" id="${id}-btn" aria-expanded="${String(!!open)}" aria-controls="${id}">${ui.icon(open ? 'chevron-up' : 'chevron-down')}<span>${open ? 'Hide the extra details' : 'Add more details (optional)'}</span></button>`;
}
function wireMore(root, id) {
  const btn = root.querySelector('#' + id + '-btn'), box = root.querySelector('#' + id);
  const set = open => { box.hidden = !open; btn.outerHTML = String(moreToggle(id, open)); root.querySelector('#' + id + '-btn').addEventListener('click', () => set(box.hidden)); };
  btn.addEventListener('click', () => set(box.hidden));
  return { open: () => set(true), close: () => set(false) };
}

// ------------------------------------------------------------------ "Log a repair" / change a repair (sheet)
function ticketSheet(id, prefill) {
  if (!guard()) return Promise.resolve(null);
  const today = S().today();
  const k = id ? S().ticket(id) : null;
  if (id && !k) { ui.toast('That repair no longer exists.'); return Promise.resolve(null); }
  const p = Object.assign({ tenantId: null, property: '', unit: '', scope: '', title: '', detail: '', notes: '', category: '', priority: 'normal', status: 'open',
    reported: today, scheduled: null, completed: null, vendor: '', cost: null, paidBy: 'owner', warrantyUntil: null }, k || prefill || {});
  if (!k && p.tenantId) { const t = S().tenant(p.tenantId); if (t) { p.property = p.property || t.property; p.unit = p.unit || t.unit; } }
  const fixedProperty = !k && prefill && prefill.fixedProperty ? p.property : '';
  if (!k && !p.property && properties().length === 1) p.property = properties()[0].name;
  p.unitSel = k ? (isBuilding(k) ? BUILDING : String(k.unit).trim()) : unitSelOf(p);
  const cat = k ? Mo.repairCategory(k) : p.category || Mo.suggestCategory(p.title) || 'other';
  const tenants = S().tenantsList({ includePast: false });
  if (p.tenantId && !tenants.some(t => t.id === p.tenantId)) { const t = S().tenant(p.tenantId); if (t) tenants.push(t); }
  const moreOpen = !!(k && (k.vendor || k.detail || k.notes || k.warrantyUntil || k.paidBy === 'tenant' || k.tenantId));
  const vlist = vendors();
  const title = k ? 'Change this repair' : 'Log a repair';
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title, size: 'wide',
      sub: k ? (k.property || '') + ' · ' + unitLabel(k) + ' · reported ' + longDay(k.reported, today) : fixedProperty ? fixedProperty + ' — something to fix now, or already booked' : 'Something that needs fixing, or is booked in',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="rp-form stack stack-5">
          ${ui.field({ name: 'title', id: 'uk-title', label: 'What needs fixing?', value: p.title, required: true, requiredMsg: 'Say what needs fixing, like “Kitchen tap dripping”', placeholder: 'For example: Kitchen tap dripping' })}
          ${catField('uk-category', cat)}
          ${placeFields('uk', p, fixedProperty)}
          ${ui.field({ name: 'priority', id: 'uk-priority', label: 'How urgent is it?', type: 'seg', value: p.priority, options: PRIO })}
          ${ui.field({ name: 'status', id: 'uk-status', label: 'Where is it up to?', type: 'seg', value: p.status, options: STATUS.map(([value, label]) => ({ value, label: value === 'scheduled' ? 'Booked in' : label })) })}
          ${ui.field({ name: 'scheduled', id: 'uk-scheduled', label: 'Booked for which day?', type: 'date', value: p.scheduled || '' })}
          ${ui.field({ name: 'completed', id: 'uk-completed', label: 'When was it done?', type: 'date', value: p.completed || today, max: today })}
          ${ui.field({ name: 'cost', id: 'uk-cost', label: 'What did it cost?', type: 'money', value: p.cost, optional: true, hint: 'Leave empty if you don’t know yet' })}
          <div id="uk-charge-slot"></div>
          ${moreToggle('uk-more', moreOpen)}
          <div class="rp-more stack stack-5" id="uk-more"${moreOpen ? '' : RB.raw(' hidden')}>
            ${ui.field({ name: 'tenantId', id: 'uk-tenant', label: 'Which tenant is it for?', type: 'select', value: p.tenantId || '', hint: 'Filled in for you from the unit',
              options: [{ value: '', label: 'Nobody — empty unit or shared area' }].concat(tenants.map(t => ({ value: t.id, label: t.name + ' · ' + RB.model.unitLabel(t) }))) })}
            ${ui.field({ name: 'vendor', id: 'uk-vendor', label: 'Who is fixing it?', value: p.vendor, optional: true, placeholder: 'For example: Rooter Bros. Plumbing', attrs: { list: 'uk-vendors' } })}
            ${ui.field({ name: 'paidBy', id: 'uk-paidby', label: 'Who pays for it?', type: 'seg', value: p.paidBy, options: [{ value: 'owner', label: 'I do (the owner)' }, { value: 'tenant', label: 'The tenant' }] })}
            ${ui.field({ name: 'reported', id: 'uk-reported', label: 'When was it reported?', type: 'date', value: p.reported, required: true, requiredMsg: 'Choose the day it was reported', max: today })}
            ${ui.field({ name: 'detail', id: 'uk-detail', label: 'What’s wrong?', type: 'textarea', value: p.detail, optional: true, rows: 2 })}
            ${ui.field({ name: 'notes', id: 'uk-notes', label: 'What was done?', type: 'textarea', value: p.notes, optional: true, rows: 2, placeholder: 'For example: replaced the washer and both supply lines' })}
            ${ui.field({ name: 'warrantyUntil', id: 'uk-warranty', label: 'Under warranty until', type: 'date', value: p.warrantyUntil || '', optional: true })}
          </div>
          <datalist id="uk-vendors">${vlist.map(x => h`<option value="${x}"></option>`)}</datalist>
        </div>`);
        const cats = wireCats(el, 'uk-category', el.querySelector('#uk-title'), !k && !p.category);
        const tenantSel = el.querySelector('#uk-tenant');
        let tenantAuto = !p.tenantId;
        tenantSel.addEventListener('change', () => { tenantAuto = false; });
        const place = wirePlace(el, 'uk', fixedProperty, () => {
          if (!tenantAuto) return;
          const v = ui.readForm(el).values; const pl = place.read(v);
          const t = tenantAt(pl.property, pl.unit);
          tenantSel.value = t ? t.id : '';
          sync();
        });
        wireMore(el, 'uk-more');
        const slot = el.querySelector('#uk-charge-slot');
        let chargeChecked = true;
        const sync = () => {
          const v = ui.readForm(el).values;
          el.querySelector('[data-field="completed"]').hidden = v.status !== 'done';
          el.querySelector('[data-field="scheduled"]').hidden = v.status !== 'scheduled';
          el.querySelector('[data-field="cost"]').hidden = v.status === 'open' && v.cost == null;
          el.querySelector('#uk-cost-label').firstChild.textContent = v.status === 'done' ? 'What did it cost?' : 'What will it cost?';
          const t = v.tenantId && S().tenant(v.tenantId);
          const already = k && k.chargeId;
          const offer = v.status === 'done' && v.paidBy === 'tenant' && v.cost > 0 && t && !already;
          const cb = slot.querySelector('#uk-charge'); if (cb) chargeChecked = cb.checked;
          slot.innerHTML = offer ? String(ui.field({ name: 'charge', id: 'uk-charge', type: 'checkbox', value: chargeChecked, label: chargeWords(v.cost, t) }))
            : already && v.paidBy === 'tenant' ? String(h`<div class="form-note">${ui.icon('check', { size: 14 })} Already added to the tenant’s payment history as a charge.</div>`)
            : v.paidBy === 'tenant' && !t ? String(h`<div class="form-note">Choose the tenant under “Which tenant is it for?” to charge them for it.</div>`) : '';
          sh.setAction('save', { label: k ? 'Save changes' : v.status === 'done' ? 'Save this repair' : 'Log this repair' });
        };
        el.addEventListener('change', sync);
        el.addEventListener('input', e => { if (e.target.id === 'uk-cost') sync(); });
        sync();
        sh._cats = cats; sh._place = place;
      },
      actions: [].concat(k ? [{ id: 'delete', label: 'Delete this repair', kind: 'danger-soft', onClick: () => { del(k.id); } }] : [], [{ id: 'save', label: k ? 'Save changes' : 'Log this repair', kind: 'primary', onClick: s => {
        const place = s._place;
        const v = ui.form(s.body, { validate: v => Object.assign({
          cost: v.cost != null && v.cost < 0 ? 'A cost can’t be below zero' : '',
          scheduled: v.status === 'scheduled' && !v.scheduled ? 'Which day is it booked for?' : '',
          completed: v.status === 'done' && v.completed && v.completed > today ? 'That day hasn’t happened yet' : '',
        }, place.errors(v)) });
        if (!v) return false;
        const pl = place.read(v);
        const data = { tenantId: v.tenantId || null, property: pl.property, unit: pl.unit, scope: pl.scope, title: v.title, detail: v.detail, notes: v.notes,
          category: s._cats.get(), priority: v.priority || 'normal', status: v.status || 'open', reported: v.reported,
          scheduled: v.status === 'scheduled' || (v.status === 'done' && v.scheduled) ? v.scheduled || null : null,
          completed: v.status === 'done' ? (v.completed || today) : null, vendor: v.vendor, cost: v.cost, paidBy: v.paidBy || 'owner', warrantyUntil: v.warrantyUntil || null };
        let chargeId = null;
        if (v.charge && canCharge(Object.assign({}, k || {}, data))) { chargeId = postCharge(data, data.cost, data.completed); data.chargeId = chargeId; }
        const undoCharge = () => { if (chargeId) S().undoEntry(data.tenantId, chargeId); };
        const extra = chargeId ? ' and added a ' + M.fmt(data.cost) + ' charge for ' + S().tenant(data.tenantId).name : '';
        if (k) {
          const before = {}; Object.keys(data).forEach(key => { before[key] = k[key] === undefined ? null : k[key]; });
          S().updateTicket(k.id, data).catch(() => {});
          saved = k.id;
          ui.toast('Saved your changes to “' + data.title + '”' + extra + '.', { undo: () => { S().updateTicket(k.id, before); undoCharge(); } });
        } else {
          const nid = RB.id();
          S().addTicket(Object.assign({ id: nid }, data)).catch(() => {});
          saved = nid;
          ui.toast((data.status === 'done' ? 'Saved “' : 'Logged “') + data.title + '” for ' + (pl.scope === 'building' ? 'the whole building' : Mo.unitWords(pl.unit)) + extra + '.', { undo: () => { S().deleteTicket(nid); undoCharge(); } });
        }
      } }]),
      initialFocus: '#uk-title',
      onClose: () => resolve(saved),
    });
  });
}

// ------------------------------------------------------------------ "Add a past repair" — the fast form
let lastPastDate = '';
function pastRepairSheet(prefill) {
  if (!guard()) return Promise.resolve(0);
  const today = S().today();
  const pre = Object.assign({ property: '', unit: '' }, prefill || {});
  if (!pre.property && properties().length === 1) pre.property = properties()[0].name;
  const fixedProperty = pre.property || '';
  let count = 0;
  return new Promise(resolve => {
    ui.sheet({
      title: 'Add a past repair', size: 'wide', cancel: 'Close',
      sub: (fixedProperty ? fixedProperty + ' · ' : '') + 'For old invoices and notes. After you save, the form stays open for the next one.',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="rp-saved" id="pr-saved" role="status" hidden></div>
          <div class="rp-form stack stack-5">
          ${ui.field({ name: 'title', id: 'pr-title', label: 'What was fixed?', required: true, requiredMsg: 'Say what was fixed, like “Boiler service”', placeholder: 'For example: Boiler service', hint: 'We’ll sort it into a kind of repair for you.' })}
          ${ui.field({ name: 'date', id: 'pr-date', label: 'When was it done?', type: 'date', value: lastPastDate, max: today, required: true, requiredMsg: 'Choose the day it was done' })}
          ${placeFields('pr', { property: fixedProperty, unitSel: unitSelOf(pre) }, fixedProperty)}
          ${ui.field({ name: 'cost', id: 'pr-cost', label: 'What did it cost?', type: 'money', optional: true, hint: 'Leave empty if it cost nothing' })}
          ${moreToggle('pr-more', false)}
          <div class="rp-more stack stack-5" id="pr-more" hidden>
            ${ui.field({ name: 'vendor', id: 'pr-vendor', label: 'Who fixed it?', optional: true, placeholder: 'For example: Keller Heating & Air', attrs: { list: 'pr-vendors' } })}
            ${catField('pr-category', 'other')}
            ${ui.field({ name: 'paidBy', id: 'pr-paidby', label: 'Who paid?', type: 'seg', value: 'owner', options: [{ value: 'owner', label: 'I did (the owner)' }, { value: 'tenant', label: 'The tenant' }] })}
            ${ui.field({ name: 'notes', id: 'pr-notes', label: 'Notes — what was done', type: 'textarea', optional: true, rows: 2 })}
            ${ui.field({ name: 'warrantyUntil', id: 'pr-warranty', label: 'Under warranty until', type: 'date', optional: true })}
          </div>
          <datalist id="pr-vendors">${vendors().map(x => h`<option value="${x}"></option>`)}</datalist>
        </div>`);
        const titleEl = el.querySelector('#pr-title');
        const hintEl = el.querySelector('#pr-title-hint');
        const cats = wireCats(el, 'pr-category', titleEl, true);
        cats.onChange = (key, guessed) => {
          hintEl.textContent = key === 'other' && !guessed ? 'We’ll sort it into a kind of repair for you.'
            : 'Filed under ' + Mo.REPAIR_CATEGORY_LABEL[key] + (guessed ? ' — change it under “Add more details”.' : '.');
        };
        const place = wirePlace(el, 'pr', fixedProperty);
        const more = wireMore(el, 'pr-more');
        sh._pr = { cats, place, more, titleEl };
      },
      actions: [{ id: 'save', label: 'Save this repair', kind: 'primary', onClick: s => {
        const { cats, place, more, titleEl } = s._pr;
        const v = ui.form(s.body, { validate: v => Object.assign({
          cost: v.cost != null && v.cost < 0 ? 'A cost can’t be below zero' : '',
          date: v.date && v.date > today ? 'That day hasn’t happened yet' : '',
        }, place.errors(v)) });
        if (!v) return false;
        const pl = place.read(v);
        const t = tenantAt(pl.property, pl.unit, v.date);
        const nid = RB.id();
        const data = { id: nid, tenantId: t ? t.id : null, property: pl.property, unit: pl.unit, scope: pl.scope, title: v.title, detail: '', notes: v.notes || '',
          category: cats.get(), priority: 'normal', status: 'done', reported: v.date, scheduled: null, completed: v.date,
          vendor: v.vendor || '', cost: v.cost, paidBy: v.paidBy || 'owner', warrantyUntil: v.warrantyUntil || null };
        S().addTicket(data).catch(() => {});
        count++;
        lastPastDate = v.date;
        const what = '“' + v.title + '” — ' + (pl.scope === 'building' ? 'whole building' : Mo.unitWords(pl.unit)) + ', ' + longDay(v.date, today) + (v.cost ? ', ' + M.fmt(v.cost) : '');
        const box = s.body.querySelector('#pr-saved');
        const undo = () => {
          S().deleteTicket(nid);
          count = Math.max(0, count - 1);
          box.hidden = false;
          box.innerHTML = String(h`<div class="rp-saved-text">${ui.icon('undo')}<span>Took back ${what}. Nothing else changed.</span></div>`);
        };
        ui.toast('Saved ' + what + '.', { undo });
        box.hidden = false;
        box.innerHTML = String(h`<div class="rp-saved-text">${ui.icon('check')}<span><strong>Saved.</strong> ${what}. Add another?${count > 1 ? h` <span class="muted">(${count} saved so far)</span>` : ''}</span></div>
          <button type="button" class="btn btn-sm" id="pr-undo">${ui.icon('undo')}<span>Undo</span></button>`);
        box.querySelector('#pr-undo').addEventListener('click', undo);
        // keep the date (and property); clear the rest for the next invoice
        ['title', 'cost', 'vendor', 'notes', 'warrantyUntil'].forEach(n => ui.setValue(s.body, n, n === 'cost' ? null : ''));
        ui.setValue(s.body, 'paidBy', 'owner');
        ui.showErrors(s.body, {}, { focus: false });
        place.reset(); cats.reset(); more.close();
        const closeBtn = s.el.querySelector('.sheet-foot [data-close]'); if (closeBtn) closeBtn.textContent = 'Done';
        titleEl.focus();
        return false;
      } }],
      initialFocus: '#pr-title',
      onClose: () => resolve(count),
    });
  });
}

// ------------------------------------------------------------------ hooks + shared API
function openProperty(name, opts) {
  const p = propertyNamed(name);
  const slug = p ? p.slug : Mo.propertySlug(name);
  const o = opts || {};
  RB.shell.go('p-' + slug, { unit: o.unit == null ? '' : String(o.unit), category: o.category || '', year: o.year || '', q: '' });
}
function showHistory() { tab = 'history'; RB.prefs.set('repairs:tab', tab); RB.shell.go('repairs', 'history'); }
function showTodo(property) { tab = 'todo'; RB.prefs.set('repairs:tab', tab); if (property !== undefined) { propFilter = property || ''; RB.prefs.set('upkeep:prop', propFilter); } RB.shell.go('repairs', 'todo'); }

/** Short "Repairs in this unit" block for the tenant page (SafeHTML): last 3 repairs + "See all repairs for Unit 2B". */
function unitSection(tenant) {
  if (!tenant || !tenant.property) return h``;
  const today = S().today();
  const unit = String(tenant.unit || '').trim();
  const list = S().ticketsList().filter(k => sameName(k.property, tenant.property) && !isBuilding(k) && sameName(k.unit, unit))
    .map(Mo.repairItem).sort((a, b) => D.cmp(b.date, a.date)).slice(0, 3);
  const who = Mo.unitWords(unit);
  const state = k => (k.done ? (k.cost ? ui.money(k.cost) : h`<span class="muted">No cost</span>`) : k.status === 'scheduled' ? ui.tag('Booked', 'accent') : ui.tag('Needs doing', 'warn'));
  return h`<section class="rp-unit" aria-label="Repairs in this unit">
    <h3 class="rp-unit-title">Repairs in this unit</h3>
    ${list.length ? h`<ul class="rp-unit-list">${list.map(k => h`<li class="rp-unit-row"><span class="rp-unit-date">${longDay(k.date, today)}</span>
      <span class="rp-unit-what">${k.title || 'Repair'} <span class="muted">· ${Mo.REPAIR_CATEGORY_LABEL[k.category]}</span></span><span class="rp-unit-cost">${state(k)}</span></li>`)}</ul>`
      : h`<p class="muted rp-unit-none">No repairs written down for ${who} yet.</p>`}
    <div class="rp-unit-actions">
      ${list.length ? h`<button type="button" class="btn" data-rp-history data-property="${tenant.property}" data-unit="${unit}">${ui.icon('upkeep')}<span>See all repairs for ${who}</span></button>` : ''}
      <button type="button" class="btn btn-ghost" data-rp-log data-property="${tenant.property}" data-unit="${unit}" data-tenant="${tenant.id || ''}" data-write>${ui.icon('plus')}<span>Log a repair</span></button>
    </div>
  </section>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-rp-history]');
  if (b) { e.preventDefault(); openProperty(b.getAttribute('data-property'), { unit: b.getAttribute('data-unit') || '' }); return; }
  const l = e.target.closest && e.target.closest('[data-rp-log]');
  if (l) { e.preventDefault(); RB.actions.addTicket({ property: l.getAttribute('data-property'), unit: l.getAttribute('data-unit'), tenantId: l.getAttribute('data-tenant') || null }); }
});

RB.actions.addTicket = prefill => ticketSheet(null, prefill);
RB.actions.openTicket = id => ticketSheet(id);
RB.actions.addPastRepair = prefill => pastRepairSheet(prefill);
RB.actions.openProperty = openProperty;
RB.repairs = Object.assign(RB.repairs || {}, {
  unitSection, openProperty, showHistory, showTodo, properties, longDay, unitLabel, canCharge, chargeTenant, remove: del,
  logRepair: prefill => ticketSheet(null, prefill), addPastRepair: pastRepairSheet, openRepair: id => ticketSheet(id),
});
RB.commands.register({ id: 'repair:past', label: 'Add a past repair', group: 'Actions', icon: 'upkeep', write: true, keywords: 'old repair invoice history maintenance upkeep', run: () => pastRepairSheet() });
RB.commands.register({ id: 'repairs:history', label: 'Repair history by property', group: 'Go to', icon: 'upkeep', keywords: 'repairs history property building maintenance upkeep', run: showHistory });

// ------------------------------------------------------------------ To do board
function sorted(list, status) {
  if (status === 'done') return list.slice().sort((a, b) => D.cmp(b.completed || '', a.completed || '') || D.cmp(b.reported, a.reported));
  if (status === 'scheduled') return list.slice().sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || D.cmp(a.scheduled || '9', b.scheduled || '9') || D.cmp(a.reported, b.reported));
  return list.slice().sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || D.cmp(a.reported, b.reported) || (a.priority === 'low') - (b.priority === 'low'));
}

function card(k, today) {
  const age = k.reported ? Math.max(0, D.diffDays(k.reported, today)) : 0;
  const t = k.tenantId && S().tenant(k.tenantId);
  let when;
  if (k.status === 'done') when = h`Done ${longDay(k.completed, today)}${k.reported && k.completed ? ' · took ' + D.days(Math.max(0, D.diffDays(k.reported, k.completed))) : ''}`;
  else if (k.status === 'scheduled') when = h`<span class="${k.scheduled && k.scheduled < today ? 'tone-warn medium' : ''}">${k.scheduled ? (k.scheduled < today ? 'Was booked for ' : 'Booked for ') + longDay(k.scheduled, today) + ' (' + D.rel(k.scheduled, today) + ')' : 'Booked — no day set'}</span>`;
  else when = h`<span class="${age >= 7 ? 'tone-warn medium' : ''}">${age === 0 ? 'Reported today' : 'Waiting ' + D.days(age)}</span>`;
  const isInline = inline && inline.id === k.id;
  const chargeOffer = k.status === 'done' && canCharge(k);
  const cat = Mo.repairCategory(k);
  return h`<article class="uk-card${k.priority === 'urgent' && k.status !== 'done' ? ' is-urgent' : ''}" data-ticket="${k.id}">
    <div class="uk-card-top">
      <span class="uk-plate">${isBuilding(k) ? h`<span class="rp-whole">Whole building</span>` : ui.plate(k.unit, { property: k.property })}</span>
      ${k.priority === 'urgent' && k.status !== 'done' ? h`<span class="tag tag-bad uk-prio">${ui.icon('triangle', { size: 14 })}Urgent</span>` : k.priority === 'low' && k.status !== 'done' ? h`<span class="tag tag-quiet uk-prio">Can wait</span>` : ''}
    </div>
    <button type="button" class="uk-title" data-act="edit" data-id="${k.id}">${k.title || 'Repair'}</button>
    <div class="uk-meta">${k.property || 'No property'}${t ? h` · ${t.name}` : ''} · ${Mo.REPAIR_CATEGORY_LABEL[cat]}</div>
    <div class="uk-meta">${when}</div>
    ${k.vendor || k.cost != null ? h`<div class="uk-meta uk-money">${k.vendor ? h`<span>${k.vendor}</span>` : ''}${k.cost != null ? h`<span>${ui.money(k.cost)}${k.paidBy === 'tenant' ? h` <span class="muted">· the tenant pays${k.chargeId ? ' (charged)' : ''}</span>` : ''}</span>` : ''}</div>` : ''}
    ${isInline ? inlineForm(k, today) : h`<div class="uk-actions">
      ${k.status === 'open' ? h`<button type="button" class="btn" data-act="sched" data-id="${k.id}" data-write>${ui.icon('calendar')}<span>Book a day</span></button><button type="button" class="btn" data-act="done" data-id="${k.id}" data-write>${ui.icon('check')}<span>Mark done</span></button>` : ''}
      ${k.status === 'scheduled' ? h`<button type="button" class="btn" data-act="done" data-id="${k.id}" data-write>${ui.icon('check')}<span>Mark done</span></button><button type="button" class="btn btn-ghost" data-act="sched" data-id="${k.id}" data-write>${ui.icon('calendar')}<span>Change the day</span></button>` : ''}
      ${k.status === 'done' ? h`${chargeOffer ? h`<button type="button" class="btn btn-soft" data-act="charge" data-id="${k.id}" data-write>Charge ${M.fmt(k.cost)} to ${S().tenant(k.tenantId).name}</button>` : ''}<button type="button" class="btn btn-ghost" data-act="reopen" data-id="${k.id}" data-write>${ui.icon('undo')}<span>Not done after all</span></button>` : ''}
      <button type="button" class="btn btn-ghost" data-act="edit" data-id="${k.id}">${ui.icon('edit')}<span>Change</span></button>
    </div>`}
  </article>`;
}

function inlineForm(k, today) {
  if (inline.kind === 'schedule') {
    return h`<form class="uk-inline" data-submit="inlineSave" data-id="${k.id}">
      <label class="field-label" for="uk-in-date">Booked for which day?</label>
      <input class="input" type="date" id="uk-in-date" data-kind="date" value="${inline.date}" min="${k.reported || ''}" data-input="inlineDate" required>
      <div class="uk-inline-btns"><button type="submit" class="btn btn-primary" data-write>${ui.icon('calendar')}<span>Book it</span></button>
        <button type="button" class="btn btn-ghost" data-act="inlineCancel">Cancel</button></div>
    </form>`;
  }
  const t = k.tenantId && S().tenant(k.tenantId);
  const offer = k.paidBy === 'tenant' && t && !k.chargeId;
  const c = M.parse(inline.cost);
  return h`<form class="uk-inline" data-submit="inlineSave" data-id="${k.id}">
    <label class="field-label" for="uk-in-cost">What did it cost? <span class="opt">optional</span></label>
    <span class="money-input"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" data-kind="money" id="uk-in-cost" value="${inline.cost}" placeholder="0.00" data-input="inlineCost" autocomplete="off"></span>
    ${offer ? h`<label class="check uk-inline-charge"><input type="checkbox" id="uk-in-charge" data-change="inlineCharge"${inline.charge ? RB.raw(' checked') : ''}><span id="uk-in-charge-label">${c > 0 ? chargeWords(c, t) : 'Charge the cost to ' + t.name}</span></label>` : ''}
    <div class="uk-inline-btns"><button type="submit" class="btn btn-primary" data-write>${ui.icon('check')}<span>Mark done</span></button>
      <button type="button" class="btn btn-ghost" data-act="inlineCancel">Cancel</button></div>
  </form>`;
}

function column(status, label, items, today, extra) {
  const empty = status === 'open' ? 'Nothing waiting. Well done.' : status === 'scheduled' ? 'Nothing booked in.' : 'Nothing finished in the last 30 days.';
  return h`<section class="uk-col" aria-labelledby="uk-col-${status}">
    <div class="uk-col-head"><h2 class="uk-col-title" id="uk-col-${status}">${label}</h2><span class="uk-col-count">${items.length}</span></div>
    <div class="uk-col-body">${items.length ? items.map(k => card(k, today)) : h`<div class="uk-empty">${empty}</div>`}${extra || ''}</div>
  </section>`;
}

function todoTab(today) {
  const all = S().ticketsList();
  const props = Array.from(new Set(all.filter(k => k.status !== 'done').map(k => k.property).concat(propFilter ? [propFilter] : []).filter(Boolean))).sort(RB.natCmp);
  if (propFilter && !all.some(k => sameName(k.property, propFilter))) propFilter = '';
  const list = all.filter(k => !propFilter || sameName(k.property, propFilter));
  const by = { open: [], scheduled: [], done: [] };
  list.forEach(k => (by[k.status] || by.open).push(k));
  const cutoff = D.addDays(today, -30);
  const doneRecent = by.done.filter(k => (k.completed || k.reported) >= cutoff);
  const older = by.done.length - doneRecent.length;
  const notDone = by.open.concat(by.scheduled);
  const urgent = notDone.filter(k => k.priority === 'urgent').length;
  const oldest = notDone.reduce((m, k) => Math.max(m, k.reported ? D.diffDays(k.reported, today) : 0), 0);
  const cols = { open: sorted(by.open, 'open'), scheduled: sorted(by.scheduled, 'scheduled'), done: sorted(doneRecent, 'done') };
  const olderBtn = older ? h`<button type="button" class="btn btn-ghost uk-older" data-act="tabHistory">${ui.icon('arrow-right')}<span>See ${RB.plural(older, 'older repair')} in History by property</span></button>` : '';
  const countLine = notDone.length
    ? h`<strong>${RB.plural(notDone.length, 'repair')}</strong> to do${by.scheduled.length ? h` (${by.scheduled.length} booked in)` : ''}${urgent ? h` · <span class="tone-bad medium">${urgent} urgent</span>` : ''}${oldest ? h` · the oldest has waited ${D.days(oldest)}` : ''}`
    : h`Nothing to do — every repair is done.`;
  const chipCount = p => all.filter(k => k.status !== 'done' && (!p || sameName(k.property, p))).length;
  return h`
    <div class="view-head uk-head">
      <p class="view-summary uk-count" id="uk-count">${countLine}</p>
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary" data-act="add" id="uk-add" data-write>${ui.icon('plus')}<span>Log a repair</span></button>
    </div>
    ${props.length > 1 ? h`<div class="chips uk-filter" role="group" aria-label="Show repairs at">
      <button type="button" class="chip" data-act="prop" data-prop="" aria-pressed="${String(!propFilter)}">All properties<span class="chip-count">${chipCount('')}</span></button>
      ${props.map(p => h`<button type="button" class="chip" data-act="prop" data-prop="${p}" aria-pressed="${String(sameName(propFilter, p))}">${p}<span class="chip-count">${chipCount(p)}</span></button>`)}
    </div>` : ''}
    ${all.length ? h`
      <div class="seg uk-tabs show-phone" role="group" aria-label="Show">${STATUS.map(([s, label]) => h`<button type="button" data-act="tab" data-tab="${s}" aria-pressed="${String(phoneTab === s)}">${label} <span class="uk-tab-n">${cols[s].length}</span></button>`)}</div>
      <div class="uk-cols" data-tab="${phoneTab}">
        ${column('open', 'Needs doing', cols.open, today)}
        ${column('scheduled', 'Booked in', cols.scheduled, today)}
        ${column('done', 'Done in the last 30 days', cols.done, today, olderBtn)}
      </div>`
      : ui.empty({ icon: 'wrench', title: 'No repairs yet', body: 'Write repairs down here so nothing slips: what needs fixing, who is doing it and what it cost.', actions: [{ label: 'Log a repair', kind: 'primary', act: 'add', icon: 'plus', write: true }, { label: 'Add a past repair', act: 'past', write: true }] })}`;
}

// ------------------------------------------------------------------ History by property (landing)
function historyTab(today) {
  const props = properties();
  if (!props.length) {
    return ui.empty({ icon: 'wrench', title: 'No properties yet', body: 'Add a tenant or log a repair, and its property appears here with its repair history.',
      actions: [{ label: 'Log a repair', kind: 'primary', act: 'add', icon: 'plus', write: true }] });
  }
  const count = props.reduce((s, p) => s + p.count, 0), total = props.reduce((s, p) => s + p.total, 0);
  const first = props.map(p => p.firstDate).filter(Boolean).sort()[0];
  const year = today.slice(0, 4);
  return h`
    <div class="view-head uk-head">
      <p class="view-summary" id="rp-hist-sum">${count ? h`<strong>${RB.plural(count, 'repair')}</strong> written down at ${RB.plural(props.length, 'property', 'properties')} · <strong>${M.fmt(total)}</strong> spent${first ? ' since ' + first.slice(0, 4) : ''}` : h`No past repairs written down yet. Add old invoices to build each property’s history.`}</p>
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary" data-act="past" id="rp-past" data-write>${ui.icon('plus')}<span>Add a past repair</span></button>
    </div>
    <p class="rp-lede">Choose a property to see everything that was fixed there, what it cost, and anything that keeps going wrong.</p>
    <div class="rp-props">${props.map(p => h`<a class="rp-prop" href="#p-${p.slug}" data-slug="${p.slug}">
      <span class="rp-prop-name">${p.name}</span>
      <span class="rp-prop-units">${p.unitCount ? RB.plural(p.unitCount, 'unit') : 'No units written down'}</span>
      <span class="rp-prop-line">${p.thisYear.count ? h`This year: <strong>${RB.plural(p.thisYear.count, 'repair')}</strong>, costing <strong>${M.fmt(p.thisYear.total)}</strong>` : h`No repairs yet in ${year}`}</span>
      <span class="rp-prop-line">${p.last ? h`Last: ${p.last.title || 'Repair'}, ${p.last.building ? 'whole building' : Mo.unitWords(p.last.unitKey)}, ${D.fmt(p.last.date, today)}` : 'No repairs written down yet'}</span>
      ${p.open ? h`<span class="rp-prop-open">${ui.tag(RB.plural(p.open, 'repair') + ' still to do', p.urgent ? 'bad' : 'warn', p.urgent ? 'triangle' : 'clock')}</span>` : ''}
      <span class="rp-prop-go"><span>See repair history</span>${ui.icon('arrow-right')}</span>
    </a>`)}</div>`;
}

RB.views.register('repairs', {
  title: 'Repairs',
  firstRun: false,
  shortcuts: [['c', 'Log a repair']],
  render(el, ctx) {
    const today = ctx.today;
    el.classList.toggle('is-property', !!ctx.param);
    if (ctx.param) { inline = null; return RB.repairs.renderProperty(el, ctx); }
    if (RB.repairs.leaveProperty) { if (ctx.reason === 'route') window.scrollTo(0, 0); RB.repairs.leaveProperty(); }
    if (ctx.intent === 'history' || ctx.intent === 'todo') { tab = ctx.intent; RB.prefs.set('repairs:tab', tab); }
    if (tab !== 'history') tab = 'todo';
    el.innerHTML = String(h`
      <div class="rp-tabs" role="tablist" aria-label="Repairs">
        <button type="button" class="rp-tab" role="tab" id="rp-tab-todo" aria-selected="${String(tab === 'todo')}" aria-controls="rp-panel" data-act="mainTab" data-tab="todo">${ui.icon('upkeep')}<span>To do</span></button>
        <button type="button" class="rp-tab" role="tab" id="rp-tab-history" aria-selected="${String(tab === 'history')}" aria-controls="rp-panel" data-act="mainTab" data-tab="history">${ui.icon('reports')}<span>History by property</span></button>
      </div>
      <div id="rp-panel" role="tabpanel" aria-labelledby="rp-tab-${tab}">${tab === 'history' ? historyTab(today) : todoTab(today)}</div>`);
    ui.bind(el, {
      mainTab: b => { tab = b.dataset.tab; RB.prefs.set('repairs:tab', tab); inline = null; RB.shell.refresh(); },
      tabHistory: () => { tab = 'history'; RB.prefs.set('repairs:tab', tab); RB.shell.refresh(); window.scrollTo(0, 0); },
      add: () => ticketSheet(null, propFilter && tab === 'todo' ? { property: propFilter } : null),
      past: () => pastRepairSheet(),
      edit: b => ticketSheet(b.dataset.id),
      prop: b => { propFilter = b.dataset.prop; RB.prefs.set('upkeep:prop', propFilter); RB.shell.refresh(); },
      tab: b => { phoneTab = b.dataset.tab; RB.prefs.set('upkeep:tab', phoneTab); RB.shell.refresh(); },
      sched: b => { const k = S().ticket(b.dataset.id); inline = { id: b.dataset.id, kind: 'schedule', date: (k && k.scheduled) || D.addDays(today, 2) }; RB.shell.refresh(); focusInline(el, '#uk-in-date'); },
      done: b => { const k = S().ticket(b.dataset.id); inline = { id: b.dataset.id, kind: 'done', cost: k && k.cost != null ? M.input(k.cost) : '', charge: true }; RB.shell.refresh(); focusInline(el, '#uk-in-cost'); },
      inlineCancel: () => { inline = null; RB.shell.refresh(); },
      inlineDate: b => { if (inline) inline.date = b.value; },
      inlineCost: b => {
        if (!inline) return; inline.cost = b.value;
        const lab = el.querySelector('#uk-in-charge-label'); const k = S().ticket(inline.id); const t = k && S().tenant(k.tenantId); const c = M.parse(b.value);
        if (lab && t) lab.textContent = c > 0 ? chargeWords(c, t) : 'Charge the cost to ' + t.name;
      },
      inlineCharge: b => { if (inline) inline.charge = b.checked; },
      inlineSave: f => {
        const id = f.dataset.id; const cur = inline; if (!cur) return;
        if (cur.kind === 'schedule') {
          if (!D.valid(cur.date || '')) { el.querySelector('#uk-in-date').focus(); return; }
          inline = null; schedule(id, cur.date);
        } else {
          const raw = String(cur.cost || '').trim(); const c = raw ? M.parse(raw) : undefined;
          if (raw && (c === null || c < 0)) { ui.toast('Type a cost like 185.50', { tone: 'bad' }); return; }
          inline = null; markDone(id, c === undefined ? undefined : c, cur.charge);
        }
        RB.shell.refresh();
      },
      reopen: b => reopen(b.dataset.id),
      charge: b => chargeTenant(b.dataset.id),
    });
  },
  onKey(e) { if (e.key === 'c') { ticketSheet(null); return true; } return false; },
  destroy() { inline = null; if (RB.repairs.leaveProperty) RB.repairs.leaveProperty(); },
});
function focusInline(el, sel) { const x = el.querySelector(sel); if (x) { x.focus(); if (x.select && x.type !== 'date') x.select(); } }

// views/repairs.js — Repairs (#repairs; #upkeep is kept as an alias). SPEC §10.3:
//   view switch "To do · History" (one row);
//   To do   — a sentence, the one filled "Log a repair", an optional property select, then "Needs doing", "Booked in",
//             "Done lately" as headings with rows. Tapping a row opens "What would you like to do?" (Book a day · Mark it
//             done · Change · Delete); each choice uses at most one short sheet — never a sheet on a sheet;
//   History — one row per property, the year's cost as the amount, opening that property's history (#p-<slug>, property.js).
// Owns the hooks RB.actions.addTicket / openTicket / addPastRepair / openProperty, and RB.repairs (shared with
// views/property.js and the tenant page: RB.repairs.unitSection(tenant)). Words follow SPEC §8 (repair, not ticket/request).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const S = () => RB.store;
const Mo = RB.model;
const BUILDING = Mo.REPAIR_BUILDING;
const OTHER_UNIT = '*other';

let tab = RB.prefs.get('repairs:tab', 'todo');          // todo | history
let propFilter = RB.prefs.get('upkeep:prop', '');
let doneAll = false;                                    // "Done lately" expanded in place
const DONE_SHOWN = 3;

function guard() {
  if (!S().canWrite()) { ui.toast('This rent book is view only — you can look, but not change anything.', { tone: 'bad' }); return false; }
  return true;
}
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isBuilding = k => k.scope === 'building' || !String(k.unit || '').trim();
/** "Unit 2B" / "No. 4" / "Whole building" (capitalised, for labels). */
const unitLabel = k => (isBuilding(k) ? 'Whole building' : Mo.unitWords(k.unit));
/** "Unit 2B at Alder Court" / "Whole building at Alder Court". */
const placeWords = k => unitLabel(k) + (k.property ? ' at ' + k.property : '');
/** "Tuesday, November 17" this year, "Tuesday, November 17, 2025" otherwise. */
const longDay = (d, today) => ui.dateWords(d, today || S().today());
/** "November 17" this year, "November 17, 2025" otherwise (for dense lines). */
function shortDay(d, today) {
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
/** Kind of repair: a select (9 kinds), guessed from what was typed until the person picks one themselves. */
function catField(id, value, label) {
  return ui.field({ name: 'category', id, label: label || 'What kind of repair is it?', type: 'select', value,
    options: Mo.REPAIR_CATEGORIES.map(c => ({ value: c.key, label: c.label })) });
}
function wireCats(root, id, titleInput, auto) {
  let picked = !auto;
  const sel = root.querySelector('#' + id);
  let hint = root.querySelector('#' + id + '-hint');
  if (!hint) { hint = document.createElement('div'); hint.className = 'field-hint'; hint.id = id + '-hint'; hint.setAttribute('aria-live', 'polite'); sel.closest('.field').appendChild(hint); }
  const api = {
    get: () => sel.value || 'other',
    set(key, guessed) {
      sel.value = key;
      hint.textContent = guessed ? 'Guessed from what you typed — choose another if it’s wrong.' : '';
      if (api.onChange) api.onChange(key, guessed);
    },
    reset() { picked = false; api.set('other', false); },
    guess() { if (picked) return; const s = Mo.suggestCategory(titleInput ? titleInput.value : ''); api.set(s || 'other', !!s); },
    onChange: null,
  };
  sel.addEventListener('change', () => { picked = true; api.set(sel.value, false); });
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
    read(values) {
      const sel = values.unitSel;
      const building = sel === BUILDING;
      const u = building ? '' : sel === OTHER_UNIT ? String(values.unitOther || '').trim() : sel;
      return { property: fixedProperty || values.property, unit: u, scope: building ? 'building' : 'unit' };
    },
    errors(values) { return values.unitSel === OTHER_UNIT && !String(values.unitOther || '').trim() ? { unitOther: 'Type the unit, like 4C' } : {}; },
    reset() { unit.value = ''; otherWrap.hidden = true; root.querySelector('#' + pfx + '-unit-other').value = ''; },
  };
  unit.addEventListener('change', () => { otherWrap.hidden = unit.value !== OTHER_UNIT; if (unit.value === OTHER_UNIT) root.querySelector('#' + pfx + '-unit-other').focus(); if (onChange) onChange(); });
  if (propEl) propEl.addEventListener('change', () => { const keep = unit.value; unit.innerHTML = String(unitOptions(propEl.value, keep)); if (onChange) onChange(); });
  return api;
}
const unitSelOf = p => (p.unitSel !== undefined ? p.unitSel : p.scope === 'building' ? BUILDING : String(p.unit || '').trim());
/** "Add more details (optional)" — the shared disclosure; returns {open(), close()}. */
function wireMore(root, id) {
  const d = root.querySelector('#' + id);
  return { open: () => { d.open = true; }, close: () => { d.open = false; } };
}
/** A date field with the day written out beside it (SPEC §10.1 law 11). */
const dateField = o => ui.dateField(o);

// ------------------------------------------------------------------ "Log a repair" / "Change this repair" (form)
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
  // Law 9: what is already known is shown once ("For Unit 2B at Alder Court — Change"), not asked again.
  const known = !!(p.property && (p.unitSel || p.tenantId));
  const knownWords = known ? (p.unitSel === BUILDING ? 'Whole building' : Mo.unitWords(p.unitSel)) + ' at ' + p.property : '';
  const cat = k ? Mo.repairCategory(k) : p.category || Mo.suggestCategory(p.title) || 'other';
  const tenants = S().tenantsList({ includePast: false });
  if (p.tenantId && !tenants.some(t => t.id === p.tenantId)) { const t = S().tenant(p.tenantId); if (t) tenants.push(t); }
  const moreOpen = !!(k && (k.status !== 'open' || k.vendor || k.detail || k.notes || k.warrantyUntil || k.paidBy === 'tenant' || k.cost != null));
  const vlist = vendors();
  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: k ? 'Change this repair' : 'Log a repair', size: 'wide',
      sub: k ? 'Reported ' + longDay(k.reported, today) : '',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="rp-form form-col">
          ${known ? h`<p class="rp-for" id="uk-for">For ${knownWords} — <button type="button" class="linkbtn" id="uk-place-change" aria-expanded="false" aria-controls="uk-place">Change</button></p>`
            : fixedProperty ? h`<p class="rp-for" id="uk-for">At ${fixedProperty}</p>` : ''}
          <div class="form-col" id="uk-place"${known ? RB.raw(' hidden') : ''}>
            ${placeFields('uk', p, fixedProperty)}
            ${ui.field({ name: 'tenantId', id: 'uk-tenant', label: 'Which tenant is it for?', type: 'select', value: p.tenantId || '', hint: 'Filled in for you from the unit',
              options: [{ value: '', label: 'Nobody — empty unit or shared area' }].concat(tenants.map(t => ({ value: t.id, label: t.name + ' · ' + RB.model.unitLabel(t) }))) })}
          </div>
          ${ui.field({ name: 'title', id: 'uk-title', label: 'What needs fixing?', value: p.title, required: true, requiredMsg: 'Say what needs fixing, like “Kitchen tap dripping”', placeholder: 'For example: Kitchen tap dripping' })}
          ${catField('uk-category', cat)}
          ${ui.field({ name: 'urgent', id: 'uk-urgent', type: 'checkbox', value: p.priority === 'urgent', label: 'This is urgent' })}
          ${ui.moreDetails(h`<div class="form-col">
            ${ui.field({ name: 'status', id: 'uk-status', label: 'Where is it up to?', type: 'choice', value: p.status, options: [{ value: 'open', label: 'Needs doing' }, { value: 'scheduled', label: 'Booked in' }, { value: 'done', label: 'Done' }] })}
            ${dateField({ name: 'scheduled', id: 'uk-scheduled', label: 'Booked for which day?', value: p.scheduled || '' })}
            ${dateField({ name: 'completed', id: 'uk-completed', label: 'When was it done?', value: p.completed || today, max: today })}
            ${ui.field({ name: 'cost', id: 'uk-cost', label: 'What did it cost?', type: 'money', value: p.cost, optional: true, hint: 'Leave empty if you don’t know yet' })}
            <div id="uk-charge-slot"></div>
            ${ui.field({ name: 'vendor', id: 'uk-vendor', label: 'Who is fixing it?', value: p.vendor, optional: true, placeholder: 'For example: Rooter Bros. Plumbing', attrs: { list: 'uk-vendors' } })}
            ${ui.field({ name: 'paidBy', id: 'uk-paidby', label: 'Who pays for it?', type: 'choice', value: p.paidBy, options: [{ value: 'owner', label: 'I do (the owner)' }, { value: 'tenant', label: 'The tenant' }] })}
            ${dateField({ name: 'reported', id: 'uk-reported', label: 'When was it reported?', value: p.reported, required: true, requiredMsg: 'Choose the day it was reported', max: today })}
            ${ui.field({ name: 'detail', id: 'uk-detail', label: 'What’s wrong?', type: 'textarea', value: p.detail, optional: true, rows: 2 })}
            ${ui.field({ name: 'notes', id: 'uk-notes', label: 'What was done?', type: 'textarea', value: p.notes, optional: true, rows: 2, placeholder: 'For example: replaced the washer and both supply lines' })}
            ${dateField({ name: 'warrantyUntil', id: 'uk-warranty', label: 'Under warranty until', value: p.warrantyUntil || '', optional: true })}
          </div>`, { id: 'uk-more', open: moreOpen })}
          <datalist id="uk-vendors">${vlist.map(x => h`<option value="${x}"></option>`)}</datalist>
        </div>`);
        const cats = wireCats(el, 'uk-category', el.querySelector('#uk-title'), !k && !p.category);
        const tenantSel = el.querySelector('#uk-tenant');
        let tenantAuto = !p.tenantId;
        tenantSel.addEventListener('change', () => { tenantAuto = false; });
        const chg = el.querySelector('#uk-place-change');
        if (chg) chg.addEventListener('click', () => { const box = el.querySelector('#uk-place'); box.hidden = false; chg.setAttribute('aria-expanded', 'true'); el.querySelector('#uk-for').hidden = true; const f = box.querySelector('select, input'); if (f) f.focus(); });
        const place = wirePlace(el, 'uk', fixedProperty, () => {
          if (!tenantAuto) return;
          const v = ui.readForm(el).values; const pl = place.read(v);
          const t = tenantAt(pl.property, pl.unit);
          tenantSel.value = t ? t.id : '';
          sync();
        });
        const slot = el.querySelector('#uk-charge-slot');
        let chargeChecked = true;
        const sync = () => {
          const v = ui.readForm(el).values;
          el.querySelector('[data-field="completed"]').hidden = v.status !== 'done';
          el.querySelector('[data-field="scheduled"]').hidden = v.status !== 'scheduled';
          const cl = el.querySelector('#uk-cost-label'); if (cl && cl.firstChild) cl.firstChild.textContent = v.status === 'done' ? 'What did it cost?' : 'What will it cost?';
          const t = v.tenantId && S().tenant(v.tenantId);
          const already = k && k.chargeId;
          const offer = v.status === 'done' && v.paidBy === 'tenant' && v.cost > 0 && t && !already;
          const cb = slot.querySelector('#uk-charge'); if (cb) chargeChecked = cb.checked;
          slot.innerHTML = offer ? String(ui.field({ name: 'charge', id: 'uk-charge', type: 'checkbox', value: chargeChecked, label: chargeWords(v.cost, t) }))
            : already && v.paidBy === 'tenant' ? String(h`<p class="rp-note">Already added to the tenant’s payment history as a charge.</p>`)
            : v.paidBy === 'tenant' && !t ? String(h`<p class="rp-note">Choose the tenant under “Which tenant is it for?” to charge them for it.</p>`) : '';
          sh.setAction('save', { label: k ? 'Save changes' : v.status === 'done' ? 'Save this repair' : 'Log this repair' });
        };
        el.addEventListener('change', sync);
        el.addEventListener('input', e => { if (e.target.id === 'uk-cost') sync(); });
        sync();
        sh._cats = cats; sh._place = place;
      },
      actions: [{ id: 'save', label: k ? 'Save changes' : 'Log this repair', kind: 'primary', onClick: s => {
        const place = s._place;
        const placeBox = s.body.querySelector('#uk-place');
        const v = ui.form(s.body, { validate: v => Object.assign({
          cost: v.cost != null && v.cost < 0 ? 'A cost can’t be below zero' : '',
          scheduled: v.status === 'scheduled' && !v.scheduled ? 'Which day is it booked for?' : '',
          completed: v.status === 'done' && v.completed && v.completed > today ? 'That day hasn’t happened yet' : '',
        }, place.errors(v)) });
        if (!v) { if (placeBox.hidden && placeBox.querySelector('.is-invalid')) { placeBox.hidden = false; } return false; }
        const pl = place.read(v);
        const priority = v.urgent ? 'urgent' : (p.priority === 'urgent' ? 'normal' : p.priority || 'normal');
        const data = { tenantId: v.tenantId || null, property: pl.property, unit: pl.unit, scope: pl.scope, title: v.title, detail: v.detail, notes: v.notes,
          category: s._cats.get(), priority, status: v.status || 'open', reported: v.reported || today,
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
      } }],
      initialFocus: '#uk-title',
      onClose: () => resolve(saved),
    });
  });
}

// ------------------------------------------------------------------ short sheets: book a day, mark it done
function bookSheet(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const today = S().today();
  ui.sheet({
    title: k.status === 'scheduled' ? 'Change the day' : 'Book a day', sub: k.title + ' — ' + placeWords(k),
    body: h`<div class="form-col">${dateField({ name: 'date', id: 'uk-in-date', label: 'Which day is it booked for?', value: k.scheduled || D.addDays(today, 2), required: true, requiredMsg: 'Choose the day it is booked for' })}</div>`,
    actions: [{ id: 'save', label: 'Book it', kind: 'primary', onClick: s => {
      const v = ui.form(s.body); if (!v) return false;
      schedule(id, v.date);
    } }],
    initialFocus: '#uk-in-date',
  });
}
function doneSheet(id) {
  if (!guard()) return;
  const k = S().ticket(id); if (!k) return;
  const t = k.tenantId && S().tenant(k.tenantId);
  const offer = k.paidBy === 'tenant' && t && !k.chargeId;
  ui.sheet({
    title: 'Mark it done', sub: k.title + ' — ' + placeWords(k),
    body: (el, sh) => {
      el.innerHTML = String(h`<div class="form-col">
        ${ui.field({ name: 'cost', id: 'uk-in-cost', label: 'What did it cost?', type: 'money', value: k.cost, optional: true, hint: 'Leave empty if you don’t know yet' })}
        ${offer ? h`<div class="field" data-field="charge"><label class="check"><input type="checkbox" id="uk-in-charge" name="charge" checked><span id="uk-in-charge-label">Charge the cost to ${t.name}</span></label></div>` : ''}
      </div>`);
      const upd = () => { const lab = el.querySelector('#uk-in-charge-label'); const c = ui.readForm(el).values.cost; if (lab) lab.textContent = c > 0 ? chargeWords(c, t) : 'Charge the cost to ' + t.name; };
      el.addEventListener('input', upd); upd();
    },
    actions: [{ id: 'save', label: 'Mark it done', kind: 'primary', onClick: s => {
      const v = ui.form(s.body, { validate: v => ({ cost: v.cost != null && v.cost < 0 ? 'A cost can’t be below zero' : '' }) });
      if (!v) return false;
      markDone(id, v.cost == null ? undefined : v.cost, !!v.charge);
    } }],
    initialFocus: '#uk-in-cost',
  });
}

// ------------------------------------------------------------------ "What would you like to do?" for one repair
/** The facts of a repair in one plain sentence (for the choices sheet). */
function facts(k, today) {
  const it = Mo.repairItem(k);
  const bits = [];
  if (k.status === 'done') bits.push('Done ' + longDay(k.completed || k.reported, today));
  else if (k.status === 'scheduled') bits.push(k.scheduled ? 'Booked for ' + longDay(k.scheduled, today) : 'Booked — no day set');
  else bits.push('Reported ' + longDay(k.reported, today) + (k.reported ? ' — waiting ' + D.days(Math.max(0, D.diffDays(k.reported, today))) : ''));
  bits.push(placeWords(k));
  bits.push(Mo.REPAIR_CATEGORY_LABEL[it.category]);
  if (k.priority === 'urgent' && k.status !== 'done') bits.push('urgent');
  if (k.vendor) bits.push('fixed by ' + k.vendor);
  if (k.cost != null) {
    const t = k.tenantId && S().tenant(k.tenantId);
    bits.push(M.fmt(k.cost) + (k.cost ? (k.paidBy === 'tenant' ? ', paid by the tenant' + (t ? ' (' + t.name + ')' : '') + (k.chargeId ? ', charged to them' : '') : ', paid by you') : ''));
  }
  let s = bits.join(' · ') + '.';
  if (k.notes) s += ' ' + k.notes;
  if (k.warrantyUntil) s += ' ' + (k.warrantyUntil >= today ? 'Under warranty until ' : 'Warranty ended ') + longDay(k.warrantyUntil, today) + '.';
  return s;
}
function openRepair(id) {
  const k = S().ticket(id);
  if (!k) { ui.toast('That repair no longer exists.'); return; }
  const today = S().today();
  const items = [];
  if (k.status === 'open') items.push({ id: 'rp-c-book', label: 'Book a day', write: true, run: () => bookSheet(id) });
  if (k.status !== 'done') items.push({ id: 'rp-c-done', label: 'Mark it done', write: true, run: () => doneSheet(id) });
  if (k.status === 'scheduled') items.push({ id: 'rp-c-book', label: 'Change the day', write: true, run: () => bookSheet(id) });
  if (k.status === 'done' && canCharge(k)) items.push({ id: 'rp-c-charge', label: 'Charge ' + M.fmt(k.cost) + ' to ' + S().tenant(k.tenantId).name, sub: 'Adds it to their payment history', write: true, run: () => chargeTenant(id) });
  if (k.status === 'done' && (k.completed || '') >= D.addDays(today, -30)) items.push({ id: 'rp-c-reopen', label: 'Not done after all', write: true, run: () => reopen(id) });
  items.push({ id: 'rp-c-change', label: 'Change', sub: 'What it is, where, the cost and the notes', write: true, run: () => ticketSheet(id) });
  items.push({ id: 'rp-c-delete', label: 'Delete', sub: 'You can undo it straight after', write: true, run: () => del(id) });
  ui.choices({ title: k.title || 'Repair', sub: facts(k, today), items });
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
      sub: (fixedProperty ? fixedProperty + '. ' : '') + 'For old invoices. After you save, the form stays open for the next one.',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="rp-saved" id="pr-saved" role="status" hidden></div>
          <div class="rp-form form-col">
          ${ui.field({ name: 'title', id: 'pr-title', label: 'What was fixed?', required: true, requiredMsg: 'Say what was fixed, like “Boiler service”', placeholder: 'For example: Boiler service', hint: 'We’ll sort it into a kind of repair for you.' })}
          ${dateField({ name: 'date', id: 'pr-date', label: 'When was it done?', value: lastPastDate, max: today, required: true, requiredMsg: 'Choose the day it was done' })}
          ${placeFields('pr', { property: fixedProperty, unitSel: unitSelOf(pre) }, fixedProperty)}
          ${ui.field({ name: 'cost', id: 'pr-cost', label: 'What did it cost?', type: 'money', optional: true, hint: 'Leave empty if it cost nothing' })}
          ${ui.moreDetails(h`<div class="form-col">
            ${ui.field({ name: 'vendor', id: 'pr-vendor', label: 'Who fixed it?', optional: true, placeholder: 'For example: Keller Heating & Air', attrs: { list: 'pr-vendors' } })}
            ${catField('pr-category', 'other')}
            ${ui.field({ name: 'paidBy', id: 'pr-paidby', label: 'Who paid?', type: 'choice', value: 'owner', options: [{ value: 'owner', label: 'I did (the owner)' }, { value: 'tenant', label: 'The tenant' }] })}
            ${ui.field({ name: 'notes', id: 'pr-notes', label: 'Notes — what was done', type: 'textarea', optional: true, rows: 2 })}
            ${dateField({ name: 'warrantyUntil', id: 'pr-warranty', label: 'Under warranty until', optional: true })}
          </div>`, { id: 'pr-more' })}
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
        const what = '“' + v.title + '” — ' + (pl.scope === 'building' ? 'whole building' : Mo.unitWords(pl.unit)) + ', ' + shortDay(v.date, today) + (v.cost ? ', ' + M.fmt(v.cost) : '');
        const box = s.body.querySelector('#pr-saved');
        const undo = () => {
          S().deleteTicket(nid);
          count = Math.max(0, count - 1);
          box.hidden = false;
          box.innerHTML = String(h`<p class="rp-saved-text">Took back ${what}. Nothing else changed.</p>`);
        };
        ui.toast('Saved ' + what + '.', { undo });
        box.hidden = false;
        box.innerHTML = String(h`<p class="rp-saved-text">${ui.status('ok', 'Saved.')} ${what}. Add another?${count > 1 ? h` (${count} saved so far)` : ''}</p>
          <button type="button" class="linkbtn rp-saved-undo" id="pr-undo">Undo</button>`);
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

/** One repair as a canonical row (to-do list, tenant page). `act`/`attrs` say what a tap does. */
function repairRow(k, today, o) {
  const age = k.reported ? Math.max(0, D.diffDays(k.reported, today)) : 0;
  const where = o.where === false ? '' : isBuilding(k) ? 'Whole building' + (k.property ? ' at ' + k.property : '') : (k.property || 'No property');
  let when;
  if (k.status === 'done') when = 'done ' + shortDay(k.completed || k.reported, today);
  else if (k.status === 'scheduled') when = k.scheduled ? (k.scheduled < today ? 'was booked for ' : 'booked for ') + longDay(k.scheduled, today) : 'booked — no day set';
  else when = age === 0 ? 'reported today' : 'waiting ' + D.days(age);
  const sub = [where, when].filter(Boolean).join(' · ');
  return ui.row({
    lead: isBuilding(k) ? h`<span class="rp-whole" title="Whole building">${ui.icon('home')}</span>` : ui.plate(k.unit, { property: k.property }),
    title: k.title || 'Repair', sub,
    amt: k.status === 'done' && k.cost != null ? M.fmt(k.cost) : '',
    status: k.priority === 'urgent' && k.status !== 'done' ? ui.status('urgent', 'Urgent') : '',
    act: o.act, attrs: Object.assign({ 'data-ticket': k.id }, o.attrs || {}),
  });
}

/** "Repairs in this unit" for the tenant page (SafeHTML): one heading, up to 3 rows, at most one text link beneath. */
function unitSection(tenant) {
  if (!tenant || !tenant.property) return h``;
  const today = S().today();
  const unit = String(tenant.unit || '').trim();
  const list = S().ticketsList().filter(k => sameName(k.property, tenant.property) && !isBuilding(k) && sameName(k.unit, unit))
    .sort((a, b) => D.cmp(Mo.repairItem(b).date, Mo.repairItem(a).date));
  const who = Mo.unitWords(unit);
  return h`<section class="rp-unit" aria-labelledby="rp-unit-h">
    <h3 class="rows-head" id="rp-unit-h">Repairs in this unit</h3>
    ${list.length ? h`<ul class="rows rp-unit-rows">${list.slice(0, 3).map(k => repairRow(k, today, { where: false, act: 'rpOpen', attrs: { 'data-rp-open': k.id } }))}</ul>
      <button type="button" class="btn-link rp-unit-link" data-rp-history data-property="${tenant.property}" data-unit="${unit}">See all ${RB.plural(list.length, 'repair')} for ${who}</button>`
      : h`<p class="rp-unit-none">No repairs written down for ${who} yet.</p>
      <button type="button" class="btn-link rp-unit-link" data-rp-log data-property="${tenant.property}" data-unit="${unit}" data-tenant="${tenant.id || ''}" data-write>Log a repair for ${who}</button>`}
  </section>`;
}
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  const o = e.target.closest('[data-rp-open]');
  if (o) { e.preventDefault(); openRepair(o.getAttribute('data-rp-open')); return; }
  const b = e.target.closest('[data-rp-history]');
  if (b) { e.preventDefault(); openProperty(b.getAttribute('data-property'), { unit: b.getAttribute('data-unit') || '' }); return; }
  const l = e.target.closest('[data-rp-log]');
  if (l) { e.preventDefault(); RB.actions.addTicket({ property: l.getAttribute('data-property'), unit: l.getAttribute('data-unit'), tenantId: l.getAttribute('data-tenant') || null }); }
});

RB.actions.addTicket = prefill => ticketSheet(null, prefill);
RB.actions.openTicket = id => openRepair(id);
RB.actions.addPastRepair = prefill => pastRepairSheet(prefill);
RB.actions.openProperty = openProperty;
RB.repairs = Object.assign(RB.repairs || {}, {
  unitSection, openProperty, showHistory, showTodo, properties, longDay, shortDay, unitLabel, canCharge, chargeTenant, remove: del, facts,
  logRepair: prefill => ticketSheet(null, prefill), addPastRepair: pastRepairSheet, openRepair, changeRepair: id => ticketSheet(id),
});
RB.commands.register({ id: 'repair:past', label: 'Add a past repair', group: 'Actions', icon: 'upkeep', write: true, keywords: 'old repair invoice history maintenance upkeep', run: () => pastRepairSheet() });
RB.commands.register({ id: 'repairs:history', label: 'Repair history by property', group: 'Go to', icon: 'upkeep', keywords: 'repairs history property building maintenance upkeep', run: showHistory });

// ------------------------------------------------------------------ To do
function sorted(list, status) {
  if (status === 'done') return list.slice().sort((a, b) => D.cmp(b.completed || '', a.completed || '') || D.cmp(b.reported, a.reported));
  if (status === 'scheduled') return list.slice().sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || D.cmp(a.scheduled || '9', b.scheduled || '9') || D.cmp(a.reported, b.reported));
  return list.slice().sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || D.cmp(a.reported, b.reported) || (a.priority === 'low') - (b.priority === 'low'));
}

function todoTab(today) {
  const all = S().ticketsList();
  const props = Array.from(new Set(all.map(k => k.property).concat(propFilter ? [propFilter] : []).filter(Boolean))).sort(RB.natCmp);
  if (propFilter && !all.some(k => sameName(k.property, propFilter))) propFilter = '';
  const list = all.filter(k => !propFilter || sameName(k.property, propFilter));
  const by = { open: [], scheduled: [], done: [] };
  list.forEach(k => (by[k.status] || by.open).push(k));
  const cutoff = D.addDays(today, -30);
  const doneRecent = sorted(by.done.filter(k => (k.completed || k.reported) >= cutoff), 'done');
  const notDone = by.open.concat(by.scheduled);
  const urgent = notDone.filter(k => k.priority === 'urgent').length;
  const oldest = notDone.reduce((m, k) => Math.max(m, k.reported ? D.diffDays(k.reported, today) : 0), 0);
  const sentence = notDone.length
    ? h`${RB.plural(notDone.length, 'repair')} to do${by.scheduled.length || urgent ? h` — ${[by.scheduled.length ? by.scheduled.length + ' booked in' : '', urgent ? urgent + ' urgent' : ''].filter(Boolean).join(', ')}` : ''}.${oldest ? h` The oldest has waited ${D.days(oldest)}.` : ''}`
    : h`Nothing to do — every repair is done.`;
  const sec = (key, title, items, empty, more) => h`<section class="rp-sec" aria-labelledby="uk-col-${key}">
    <h2 class="rows-head" id="uk-col-${key}">${title} <span class="rows-count">${items.length}</span></h2>
    ${items.length ? h`<ul class="rows rows-inset">${(more ? items.slice(0, more) : items).map(k => repairRow(k, today, { act: 'open', attrs: { 'data-id': k.id } }))}</ul>` : h`<p class="rp-empty">${empty}</p>`}
  </section>`;
  const doneShown = doneAll ? doneRecent.length : DONE_SHOWN;
  return h`
    <p class="rp-sum" id="uk-count">${sentence}</p>
    <div class="rp-bar">
      <button type="button" class="btn btn-primary" data-act="add" id="uk-add" data-write>${ui.icon('plus')}<span>Log a repair</span></button>
      ${props.length > 1 ? h`<label class="vh" for="uk-prop">Which property?</label><span class="select rp-prop-sel"><select class="input" id="uk-prop" data-change="prop">
        <option value="">All properties</option>${props.map(p => h`<option value="${p}"${sameName(propFilter, p) ? RB.raw(' selected') : ''}>${p}</option>`)}</select></span>` : ''}
    </div>
    ${all.length ? h`
      ${sec('open', 'Needs doing', sorted(by.open, 'open'), 'Nothing waiting.')}
      ${sec('scheduled', 'Booked in', sorted(by.scheduled, 'scheduled'), 'Nothing booked in.')}
      ${sec('done', 'Done lately', doneRecent, 'Nothing finished in the last 30 days.', doneShown)}
      ${doneRecent.length > DONE_SHOWN ? h`<button type="button" class="rows-more" id="uk-done-more" data-act="doneMore" aria-expanded="${String(doneAll)}">${doneAll ? 'Show fewer' : 'Show all ' + doneRecent.length}</button>` : ''}
      <button type="button" class="btn-link rp-older" data-act="tabHistory">See older repairs in History</button>`
      : ui.empty({ title: 'No repairs yet', body: 'Write repairs down here so nothing slips: what needs fixing, who is doing it and what it cost.', actions: [{ label: 'Add a past repair', act: 'past', write: true }] })}`;
}

// ------------------------------------------------------------------ History (landing)
function historyTab(today) {
  const props = properties();
  if (!props.length) {
    return ui.empty({ title: 'No properties yet', body: 'Add a tenant or log a repair, and its property appears here with its repair history.',
      actions: [{ label: 'Log a repair', kind: 'primary', act: 'add', write: true }] });
  }
  const count = props.reduce((s, p) => s + p.count, 0), total = props.reduce((s, p) => s + p.total, 0);
  const first = props.map(p => p.firstDate).filter(Boolean).sort()[0];
  const year = today.slice(0, 4);
  return h`
    <p class="rp-sum" id="rp-hist-sum">${count ? h`${RB.plural(count, 'repair')} written down at ${RB.plural(props.length, 'property', 'properties')} — ${M.fmt(total)} spent${first ? ' since ' + first.slice(0, 4) : ''}. Choose a property to see its history.` : h`No past repairs written down yet. Add old invoices to build each property’s history.`}</p>
    <div class="rp-bar">
      <button type="button" class="btn btn-primary" data-act="add" id="uk-add" data-write>${ui.icon('plus')}<span>Log a repair</span></button>
      <button type="button" class="btn btn-outline" data-act="past" id="rp-past" data-write>Add a past repair</button>
    </div>
    <h2 class="rows-head">Properties <span class="rows-count">${props.length}</span></h2>
    <ul class="rows rows-inset rp-props">${props.map(p => ui.row({
      title: p.name,
      sub: [p.unitCount ? RB.plural(p.unitCount, 'unit') : 'No units written down', RB.plural(p.thisYear.count, 'repair') + ' in ' + year].join(' · '),
      amt: M.fmt(p.thisYear.total),
      status: p.open ? ui.status(p.urgent ? 'urgent' : 'warn', p.open + ' still to do') : '',
      href: '#p-' + p.slug, attrs: { 'data-slug': p.slug },
    }))}</ul>
    <p class="rp-caption">The amount is what was spent on repairs there in ${year}.</p>`;
}

RB.views.register('repairs', {
  title: 'Repairs',
  firstRun: false,
  shortcuts: [['c', 'Log a repair']],
  render(el, ctx) {
    const today = ctx.today;
    el.classList.toggle('is-property', !!ctx.param);
    if (ctx.param) return RB.repairs.renderProperty(el, ctx);
    if (RB.repairs.leaveProperty) { if (ctx.reason === 'route') window.scrollTo(0, 0); RB.repairs.leaveProperty(); }
    if (ctx.intent === 'history' || ctx.intent === 'todo') { tab = ctx.intent; RB.prefs.set('repairs:tab', tab); }
    if (tab !== 'history') tab = 'todo';
    el.innerHTML = String(h`
      <div class="seg rp-switch" role="tablist" aria-label="Repairs">
        <button type="button" role="tab" id="rp-tab-todo" aria-selected="${String(tab === 'todo')}" aria-pressed="${String(tab === 'todo')}" aria-controls="rp-panel" data-act="mainTab" data-tab="todo">To do</button>
        <button type="button" role="tab" id="rp-tab-history" aria-selected="${String(tab === 'history')}" aria-pressed="${String(tab === 'history')}" aria-controls="rp-panel" data-act="mainTab" data-tab="history">History</button>
      </div>
      <div id="rp-panel" role="tabpanel" aria-labelledby="rp-tab-${tab}">${tab === 'history' ? historyTab(today) : todoTab(today)}</div>`);
    ui.bind(el, {
      mainTab: b => { tab = b.dataset.tab; RB.prefs.set('repairs:tab', tab); RB.shell.refresh(); },
      tabHistory: () => { tab = 'history'; RB.prefs.set('repairs:tab', tab); RB.shell.refresh(); window.scrollTo(0, 0); },
      add: () => ticketSheet(null, propFilter && tab === 'todo' ? { property: propFilter } : null),
      past: () => pastRepairSheet(),
      open: b => openRepair(b.dataset.id),
      prop: s => { propFilter = s.value; RB.prefs.set('upkeep:prop', propFilter); RB.shell.refresh(); },
      doneMore: () => { doneAll = !doneAll; RB.shell.refresh(); },
    });
  },
  onKey(e) { if (e.key === 'c') { ticketSheet(null); return true; } return false; },
  destroy() { doneAll = false; if (RB.repairs.leaveProperty) RB.repairs.leaveProperty(); },
});

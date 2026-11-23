// views/tenant-forms.js — tenant sheets: add / edit details, change rent, give notice, move out, settle deposit,
// delete, edit note. Assigns the shared hooks RB.actions.addTenant / editTenant / changeRent / giveNotice /
// moveOut / settleDeposit (renewLease belongs to the Leases view).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});
const S = () => RB.store;
const A = () => RB.actions;
const sub = t => [t.name, [t.property, t.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
let repSeq = 0;
const show = (el, on) => { if (el) el.hidden = !on; };

// ------------------------------------------------------------------ repeaters (co-tenants, recurring charges, links, deductions)
const REP = {
  co: { label: 'co-tenant', cols: [['name', 'text', 'Name'], ['phone', 'tel', 'Phone'], ['email', 'email', 'Email']] },
  rec: { label: 'charge', cols: [['label', 'text', 'What (parking, pet rent…)'], ['amount', 'money', 'Per month'], ['from', 'date', 'From'], ['to', 'date', 'Until (optional)']] },
  link: { label: 'link', cols: [['label', 'text', 'Label (Lease PDF…)'], ['url', 'url', 'https://…']] },
  ded: { label: 'deduction', cols: [['reason', 'text', 'Reason (cleaning, repairs…)'], ['amount', 'money', 'Amount']] },
};
function repRow(kind, v) {
  const n = ++repSeq;
  const cfg = REP[kind];
  v = v || {};
  return h`<div class="tn-rep-row tn-rep-${kind}" data-rep="${kind}" data-rid="${v.id || ''}">${cfg.cols.map(([k, type, ph]) => {
    const id = 'tf-' + kind + '-' + k + '-' + n;
    const label = h`<label class="vh" for="${id}">${ph}</label>`;
    if (type === 'money') return h`<span class="money-input tn-rep-${k}">${label}<span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" data-kind="money" data-k="${k}" id="${id}" placeholder="0.00" value="${v[k] != null && v[k] !== '' ? M.input(v[k]) : ''}" autocomplete="off"></span>`;
    if (type === 'date') return h`<span class="tn-rep-${k}">${label}<input class="input" type="date" data-k="${k}" id="${id}" value="${v[k] || ''}" title="${ph}"></span>`;
    return h`<span class="tn-rep-${k}">${label}<input class="input" type="${type === 'url' ? 'url' : type}" data-k="${k}" id="${id}" placeholder="${ph}" value="${v[k] || ''}" autocomplete="off"></span>`;
  })}<button type="button" class="btn btn-ghost btn-icon btn-sm tn-rep-x" data-rep-remove aria-label="Remove this ${cfg.label}" title="Remove">${ui.icon('x')}</button></div>`;
}
function repeater(kind, rows, addLabel, id) {
  return h`<div class="tn-rep" data-rep-list="${kind}">${(rows || []).map(r => repRow(kind, r))}</div>
    <div class="field-error tn-rep-err" data-rep-err="${kind}" aria-live="polite"></div>
    <button type="button" class="linkbtn tn-rep-add" data-rep-add="${kind}" id="${id}">${ui.icon('plus', { size: 14 })}${addLabel}</button>`;
}
function wireRepeaters(root) {
  root.addEventListener('click', e => {
    const add = e.target.closest('[data-rep-add]');
    if (add) {
      const kind = add.dataset.repAdd;
      const list = root.querySelector('[data-rep-list="' + kind + '"]');
      list.insertAdjacentHTML('beforeend', String(repRow(kind, kind === 'rec' ? { from: S().today() } : null)));
      const first = list.lastElementChild.querySelector('input');
      if (first) first.focus();
      root.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const rm = e.target.closest('[data-rep-remove]');
    if (rm) { const row = rm.closest('.tn-rep-row'); const next = row.nextElementSibling || row.previousElementSibling; row.remove(); root.dispatchEvent(new Event('input', { bubbles: true })); const f = next && next.querySelector('input'); if (f) f.focus(); }
  });
}
function readRep(root, kind) {
  return Array.from(root.querySelectorAll('[data-rep="' + kind + '"]')).map(row => {
    const o = { _row: row, id: row.dataset.rid || null };
    row.querySelectorAll('[data-k]').forEach(inp => {
      const k = inp.dataset.k;
      if (inp.dataset.kind === 'money') { const s = inp.value.trim(); o[k] = s ? M.parse(s) : null; o['_' + k + 'Bad'] = !!s && o[k] === null; }
      else o[k] = inp.value.trim();
    });
    return o;
  });
}
function repError(root, kind, msg, row) {
  const e = root.querySelector('[data-rep-err="' + kind + '"]');
  if (e) e.textContent = msg || '';
  root.querySelectorAll('[data-rep="' + kind + '"] .input').forEach(i => i.removeAttribute('aria-invalid'));
  if (row && msg) { const i = row.querySelector('.input'); row.querySelectorAll('.input').forEach(x => x.setAttribute('aria-invalid', 'true')); if (i) i.focus(); }
}

// ------------------------------------------------------------------ add / edit tenant
function defaultTrackFrom(moveIn, today) {
  if (!moveIn) return today;
  const ms = D.monthStart(D.monthKey(today));
  return moveIn >= ms ? moveIn : ms;
}

/** Full add/edit form. id = null → add. section: contact | cotenants | emergency | lease | terms | recurring | deposit | insurance | links | about | money */
function tenantForm(id, section, preset) {
  if (!T.guard()) return Promise.resolve(null);
  const edit = !!id;
  const t0 = edit ? S().tenant(id) : null;
  if (edit && !t0) return Promise.resolve(null);
  const today = S().today();
  const settings = S().settings();
  const p = preset || {};
  const t = t0 || {
    name: p.name || '', phone: p.phone || '', email: p.email || '', property: p.property || '', unit: p.unit || '',
    lease: { start: p.start || today, end: p.end || null, moveIn: p.moveIn || null, dueDay: null, graceDays: null },
    rent: p.rent ? [{ from: p.start || today, amount: p.rent }] : [], coTenants: [], emergency: { name: '', phone: '' },
    recurring: [], deposit: { amount: p.deposit || null, received: null, heldAt: '' }, opening: p.opening ? { amount: p.opening } : null,
    insurance: null, links: [], about: '', trackFrom: null,
  };
  const l = t.lease || {};
  const props = Array.from(new Set(S().tenantsList().map(x => x.property).filter(Boolean))).sort(RB.natCmp);
  const sched = (t.rent || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  const rentEditable = !edit || sched.length <= 1;
  const moveIn0 = l.moveIn || l.start || today;
  const track0 = edit ? (t.trackFrom || moveIn0) : defaultTrackFrom(moveIn0, today);
  const ins = t.insurance || {};
  const dep = t.deposit || {};
  const em = t.emergency || {};
  const moreOpen = edit || ['contact', 'cotenants', 'emergency', 'terms', 'recurring', 'insurance', 'links', 'about'].includes(section);

  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: edit ? 'Edit details' : 'Add tenant', sub: edit ? sub(t0) : 'The minimum to start — everything else can wait.', size: 'wide',
      body: (el, sh) => {
        el.innerHTML = String(h`
          <fieldset class="fieldset" data-sec="who"><legend class="fieldset-title">Tenant and home</legend><div class="form-grid">
            ${ui.field({ name: 'name', id: 'tf-name', label: 'Name', value: t.name, required: true, span: 2, placeholder: 'Full name as on the lease' })}
            ${ui.field({ name: 'property', id: 'tf-property', label: 'Property', value: t.property || (edit ? '' : props[0] || ''), required: true, attrs: { list: 'tf-props' }, placeholder: 'Alder Court', hint: props.length ? 'Pick one you already have or type a new one' : null })}
            ${ui.field({ name: 'unit', id: 'tf-unit', label: 'Unit', value: t.unit, required: true, placeholder: '2B, 101, No. 4' })}
          </div><datalist id="tf-props">${props.map(x => h`<option value="${x}"></option>`)}</datalist></fieldset>

          <fieldset class="fieldset" data-sec="lease"><legend class="fieldset-title">Lease</legend><div class="form-grid">
            ${ui.field({ name: 'start', id: 'tf-start', label: 'Lease start', type: 'date', value: l.start || today, required: true })}
            ${ui.field({ name: 'term', id: 'tf-term', label: 'Term', type: 'seg', value: l.end || (!edit && !p.mtm) ? 'fixed' : 'mtm', options: [{ value: 'fixed', label: 'Fixed end date' }, { value: 'mtm', label: 'Month-to-month' }] })}
            ${ui.field({ name: 'end', id: 'tf-end', label: 'Lease end', type: 'date', value: l.end || (edit ? '' : D.addDays(D.addMonths(l.start || today, 12), -1)) })}
            ${ui.field({ name: 'moveIn', id: 'tf-movein', label: 'Move-in', type: 'date', value: l.moveIn || l.start || today, required: true, hint: 'Usually the lease start' })}
          </div></fieldset>

          <fieldset class="fieldset" data-sec="money"><legend class="fieldset-title">Rent and money</legend><div class="form-grid">
            ${rentEditable
              ? ui.field({ name: 'rent', id: 'tf-rent', label: 'Monthly rent', type: 'money', value: sched.length ? sched[0].amount : null, required: true })
              : h`<div class="field"><span class="field-label">Monthly rent</span><div class="tn-static">${ui.money(RB.model.rentOn(t, today))} <span class="faint">· ${RB.plural(sched.length, 'amount')} on file</span></div><div class="field-hint">History is kept. <button type="button" class="linkbtn" data-tf="changerent">Change rent from a date…</button></div></div>`}
            ${ui.field({ name: 'deposit', id: 'tf-deposit', label: 'Security deposit', type: 'money', value: dep.amount || null, optional: true })}
            ${ui.field({ name: 'trackFrom', id: 'tf-track', label: 'Start tracking rent from', type: 'date', value: track0, required: true })}
            ${ui.field({ name: 'opening', id: 'tf-opening', label: 'Opening balance', type: 'money', value: t.opening ? t.opening.amount : null, optional: true, placeholder: '0.00', hint: 'Owed on that date. Negative = credit.' })}
            <div class="form-note span-2" id="tf-track-note"></div>
          </div></fieldset>

          ${edit ? '' : h`<button type="button" class="tn-more-toggle" id="tf-more" aria-expanded="${moreOpen}" aria-controls="tf-more-body">${ui.icon('chevron-down', { size: 14 })}<span>More details</span><span class="faint">phone, email, co-tenants, emergency contact, due day, recurring charges, insurance, links, notes</span></button>`}
          <div class="tn-more-body" id="tf-more-body"${moreOpen ? '' : RB.raw(' hidden')}>
            <fieldset class="fieldset" data-sec="contact"><legend class="fieldset-title">Contact</legend><div class="form-grid">
              ${ui.field({ name: 'phone', id: 'tf-phone', label: 'Phone', type: 'tel', value: t.phone, optional: true })}
              ${ui.field({ name: 'email', id: 'tf-email', label: 'Email', type: 'email', value: t.email, optional: true })}
            </div></fieldset>
            <fieldset class="fieldset" data-sec="cotenants"><legend class="fieldset-title">Co-tenants</legend>
              ${repeater('co', (t.coTenants || []).filter(Boolean), 'Add co-tenant', 'tf-co-add')}
            </fieldset>
            <fieldset class="fieldset" data-sec="emergency"><legend class="fieldset-title">Emergency contact</legend><div class="form-grid">
              ${ui.field({ name: 'emName', id: 'tf-em-name', label: 'Name', value: em.name, optional: true })}
              ${ui.field({ name: 'emPhone', id: 'tf-em-phone', label: 'Phone', type: 'tel', value: em.phone, optional: true })}
            </div></fieldset>
            <fieldset class="fieldset" data-sec="terms"><legend class="fieldset-title">Due day and grace</legend><div class="form-grid">
              ${ui.field({ name: 'dueDay', id: 'tf-dueday', label: 'Rent due on day', type: 'number', value: l.dueDay, min: 1, max: 31, optional: true, placeholder: String(settings.dueDay), hint: 'Leave empty to use the ' + T.ordinal(settings.dueDay) + ' (Setup)' })}
              ${ui.field({ name: 'graceDays', id: 'tf-grace', label: 'Grace days', type: 'number', value: l.graceDays, min: 0, max: 31, optional: true, placeholder: String(settings.graceDays), hint: 'Leave empty to use ' + RB.plural(settings.graceDays, 'day') })}
            </div></fieldset>
            <fieldset class="fieldset" data-sec="recurring"><legend class="fieldset-title">Recurring charges</legend>
              ${repeater('rec', (t.recurring || []).filter(Boolean), 'Add recurring charge', 'tf-rec-add')}
            </fieldset>
            <fieldset class="fieldset" data-sec="deposit"><legend class="fieldset-title">Deposit details</legend><div class="form-grid">
              ${ui.field({ name: 'depReceived', id: 'tf-dep-received', label: 'Received on', type: 'date', value: dep.received || '', optional: true, hint: 'Defaults to move-in' })}
              ${ui.field({ name: 'heldAt', id: 'tf-heldat', label: 'Held at', value: dep.heldAt || '', optional: true, placeholder: 'Bank, escrow account…' })}
            </div></fieldset>
            <fieldset class="fieldset" data-sec="insurance"><legend class="fieldset-title">Renter’s insurance</legend><div class="form-grid form-grid-3">
              ${ui.field({ name: 'insCarrier', id: 'tf-ins-carrier', label: 'Insurer', value: ins.carrier || '', optional: true })}
              ${ui.field({ name: 'insPolicy', id: 'tf-ins-policy', label: 'Policy no.', value: ins.policy || '', optional: true })}
              ${ui.field({ name: 'insExpires', id: 'tf-ins-expires', label: 'Expires', type: 'date', value: ins.expires || '', optional: true })}
            </div></fieldset>
            <fieldset class="fieldset" data-sec="links"><legend class="fieldset-title">Links</legend>
              ${repeater('link', (t.links || []).filter(Boolean), 'Add link', 'tf-link-add')}
              <div class="field-hint mt-2">Secure links only (https://) — they open in a new tab.</div>
            </fieldset>
            <fieldset class="fieldset" data-sec="about"><legend class="fieldset-title">About</legend>
              ${ui.field({ name: 'about', id: 'tf-about', label: 'Notes', type: 'textarea', value: t.about || '', optional: true, rows: 3, placeholder: 'Pets, vehicles, quirks, gate codes…' })}
            </fieldset>
          </div>`);
        wireRepeaters(el);
        const $ = s => el.querySelector(s);
        let moveInTouched = edit, trackTouched = edit;
        const sync = () => {
          const mtm = $('#tf-term').value === 'mtm';
          show($('[data-field="end"]'), !mtm);
          const start = $('#tf-start').value;
          if (!moveInTouched && start) $('#tf-movein').value = start;
          const mi = $('#tf-movein').value;
          if (!trackTouched && mi) $('#tf-track').value = defaultTrackFrom(mi, today);
          const tf = $('#tf-track').value;
          const note = $('#tf-track-note');
          if (tf && D.valid(tf)) {
            const prorate = mi && tf === mi && D.parts(tf).d !== 1;
            note.innerHTML = String(h`${ui.icon('calendar', { size: 14, cls: 'tn-inline-ico' })}Rent charges are generated from <strong>${D.fmt(tf, today)}</strong>${prorate ? ' (first month prorated)' : ''}. Anything already owed before then goes in <em>Opening balance</em>.`);
          } else note.textContent = 'Rent charges are generated from this date. Anything already owed before it goes in Opening balance.';
        };
        el.addEventListener('input', e => { if (e.target.id === 'tf-movein') moveInTouched = true; if (e.target.id === 'tf-track') trackTouched = true; sync(); });
        el.addEventListener('change', e => { if (e.target.id === 'tf-movein') moveInTouched = true; if (e.target.id === 'tf-track') trackTouched = true; sync(); });
        sync();
        const more = $('#tf-more');
        if (more) more.addEventListener('click', () => { const open = more.getAttribute('aria-expanded') !== 'true'; more.setAttribute('aria-expanded', String(open)); $('#tf-more-body').hidden = !open; if (open) { const f = $('#tf-phone'); f.scrollIntoView({ block: 'nearest' }); f.focus(); } });
        const cr = el.querySelector('[data-tf="changerent"]');
        if (cr) cr.addEventListener('click', () => { sh.close(); setTimeout(() => A().changeRent(id), 0); });
        if (section) {
          const target = { contact: '#tf-phone', cotenants: '#tf-co-add', emergency: '#tf-em-name', lease: '#tf-start', terms: '#tf-dueday', recurring: '#tf-rec-add', deposit: '#tf-deposit', insurance: '#tf-ins-carrier', links: '#tf-link-add', about: '#tf-about', money: rentEditable ? '#tf-rent' : '#tf-deposit' }[section];
          requestAnimationFrame(() => requestAnimationFrame(() => {
            let f = target && $(target);
            if (f && f.dataset.repAdd && !el.querySelector('[data-rep="' + f.dataset.repAdd + '"]')) { f.click(); return; }
            if (f && f.dataset.repAdd) f = el.querySelector('[data-rep="' + f.dataset.repAdd + '"] input') || f;
            if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
          }));
        }
      },
      initialFocus: section ? '#tf-name' : '#tf-name',
      actions: [{ id: 'save', label: edit ? 'Save changes' : 'Add tenant', kind: 'primary', onClick: s => {
        const root = s.body;
        const mtm = root.querySelector('#tf-term').value === 'mtm';
        const others = S().tenantsList().filter(x => x.id !== id && x.status === 'active');
        const v = ui.form(root, { validate: v => ({
          end: !mtm && !v.end ? 'Add the end date, or choose Month-to-month' : !mtm && v.end && v.start && v.end <= v.start ? 'The lease has to end after it starts (' + D.fmt(v.start, today) + ')' : '',
          rent: rentEditable && v.rent !== null && v.rent <= 0 ? 'Enter the monthly rent, like 1,450' : '',
          deposit: v.deposit !== null && v.deposit < 0 ? 'A deposit can’t be negative' : '',
          trackFrom: v.trackFrom && v.moveIn && v.trackFrom < v.moveIn ? 'Tracking can’t start before move-in — use ' + D.fmt(v.moveIn, today) + ' or later' : '',
          unit: v.unit && v.property && others.some(x => RB.natCmp(x.property, v.property) === 0 && RB.natCmp(x.unit, v.unit) === 0) ? (others.find(x => RB.natCmp(x.property, v.property) === 0 && RB.natCmp(x.unit, v.unit) === 0).name || 'Someone') + ' already lives in ' + v.property + ' ' + v.unit + '. Give them notice first, or check the unit.' : '',
          dueDay: v.dueDay !== null && !(v.dueDay >= 1 && v.dueDay <= 31 && Number.isInteger(v.dueDay)) ? 'Use a day from 1 to 31' : '',
          graceDays: v.graceDays !== null && !(v.graceDays >= 0 && v.graceDays <= 31 && Number.isInteger(v.graceDays)) ? 'Use 0 to 31 days' : '',
          email: v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? 'That doesn’t look like an email address — check for typos' : '',
        }) });
        if (!v) { const more = root.querySelector('#tf-more'); const bad = root.querySelector('.field.is-invalid'); if (more && bad && bad.closest('#tf-more-body') && root.querySelector('#tf-more-body').hidden) { more.click(); bad.querySelector('input,select,textarea').focus(); } return false; }
        // repeaters
        const co = readRep(root, 'co').filter(r => r.name || r.phone || r.email);
        const badCo = co.find(r => !r.name);
        repError(root, 'co', badCo ? 'Give each co-tenant a name (or remove the row)' : '', badCo && badCo._row);
        const rec = readRep(root, 'rec').filter(r => r.label || r.amount !== null || r._amountBad);
        const badRec = rec.find(r => !r.label || r._amountBad || !(r.amount > 0) || (r.to && r.from && r.to < r.from));
        repError(root, 'rec', badRec ? (!badRec.label ? 'Say what each recurring charge is for' : badRec.to && badRec.from && badRec.to < badRec.from ? '“Until” must be after “From”' : 'Enter a monthly amount above zero, like 35') : '', badRec && badRec._row);
        const links = readRep(root, 'link').filter(r => r.label || r.url);
        const badLink = links.find(r => !RB.safeUrl(r.url));
        repError(root, 'link', badLink ? 'Links must be full secure addresses starting with https://' : '', badLink && badLink._row);
        if (badCo || badRec || badLink) { const more = root.querySelector('#tf-more'); if (more && root.querySelector('#tf-more-body').hidden) more.click(); return false; }
        const moveIn = v.moveIn || v.start;
        const insurance = v.insCarrier || v.insPolicy || v.insExpires ? { carrier: v.insCarrier, policy: v.insPolicy, expires: v.insExpires || null } : null;
        const data = {
          name: v.name, phone: v.phone, email: v.email, property: v.property, unit: v.unit,
          coTenants: co.map(r => ({ name: r.name, phone: r.phone, email: r.email })),
          emergency: { name: v.emName, phone: v.emPhone },
          lease: { start: v.start, end: mtm ? null : v.end, moveIn, dueDay: v.dueDay, graceDays: v.graceDays },
          recurring: rec.map(r => ({ id: r.id || RB.id(8), label: r.label, amount: r.amount, from: r.from || moveIn, to: r.to || null })),
          trackFrom: v.trackFrom, opening: v.opening ? { amount: v.opening } : null,
          deposit: { amount: v.deposit || 0, received: v.depReceived || (v.deposit ? (edit ? dep.received || moveIn : moveIn) : null), heldAt: v.heldAt },
          insurance, links: links.map(r => ({ id: r.id || RB.id(8), label: r.label || r.url.replace(/^https:\/\//, '').slice(0, 40), url: r.url })), about: v.about,
        };
        if (rentEditable) data.rent = [{ from: D.min(v.start, moveIn), amount: v.rent }];
        if (!edit) {
          const nid = RB.id();
          data.lease = Object.assign({ noticeDate: null, moveOut: null }, data.lease);
          data.deposit.returned = null;
          S().addTenant(Object.assign({ id: nid, status: 'active', log: {} }, data)).catch(() => {});
          saved = nid;
          location.hash = 't-' + nid;
          ui.toast('Added ' + v.name + ' · ' + [v.property, v.unit].join(' '), { undo: () => { S().deleteTenant(nid).catch(() => {}); if (location.hash === '#t-' + nid) location.hash = 'tenants'; } });
        } else {
          const prev = {};
          Object.keys(data).forEach(k => { prev[k] = t0[k] === undefined ? null : RB.clone(t0[k]); });
          S().updateTenant(id, data).catch(() => {});
          saved = id;
          ui.toast('Saved changes to ' + v.name, { undo: () => S().updateTenant(id, prev) });
        }
      } }],
      onClose: () => resolve(saved),
    });
  });
}

// ------------------------------------------------------------------ change rent
function changeRent(id) {
  if (!T.guard()) return Promise.resolve(false);
  const t = S().tenant(id); if (!t) return Promise.resolve(false);
  const today = S().today();
  const sched = (t.rent || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  const last = sched[sched.length - 1];
  let from0 = D.monthStart(D.addMonthKey(D.monthKey(today), 1));
  if (last && from0 <= last.from) from0 = D.monthStart(D.addMonthKey(D.monthKey(last.from), 1));
  const cur = RB.model.rentOn(t, today);
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: 'Change rent', sub: sub(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-grid">
          ${ui.field({ name: 'amount', id: 'cr-amount', label: 'New monthly rent', type: 'money', value: null, required: true, hint: 'Now ' + M.fmt(cur) })}
          ${ui.field({ name: 'from', id: 'cr-from', label: 'Starting', type: 'date', value: from0, required: true, hint: last ? 'After ' + D.fmt(last.from, today) + ', the last change' : null })}
        </div>
        <div class="form-note mt-4" id="cr-sum" aria-live="polite"></div>`);
        const upd = () => {
          const a = M.parse(el.querySelector('#cr-amount').value);
          const f = el.querySelector('#cr-from').value;
          const was = f && D.valid(f) ? RB.model.rentOn(t, f) : cur;
          const box = el.querySelector('#cr-sum');
          if (a > 0 && f && D.valid(f)) {
            const diff = a - was;
            box.innerHTML = String(h`Rent changes from <strong>${M.fmt(was)}</strong> to <strong>${M.fmt(a)}</strong> on <strong>${D.fmtLong(f)}</strong>${diff ? h` <span class="faint">(${M.fmt(diff, { sign: true })} a month${was ? ', ' + (Math.round(diff / was * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%' : ''})</span>` : ''}.${f <= today ? h`<br><span class="tone-warn">That date has passed — charges already posted from ${D.fmt(f, today)} will use the new amount.</span>` : ''} Earlier months keep the old rent.`);
            sh.setAction('save', { label: 'Change rent to ' + M.fmt(a) });
          } else { box.textContent = 'Earlier months keep the old rent — the change is added to the rent history.'; sh.setAction('save', { label: 'Change rent' }); }
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
      },
      actions: [{ id: 'save', label: 'Change rent', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({
          amount: v.amount !== null && v.amount <= 0 ? 'Enter the new monthly rent, like 1,450' : v.amount !== null && v.from && v.amount === RB.model.rentOn(t, v.from) ? 'That’s already the rent on that date' : '',
          from: last && v.from && v.from <= last.from ? 'Pick a date after ' + D.fmt(last.from, today) + ' — the last change starts then, and history isn’t rewritten' : '',
        }) });
        if (!v) return false;
        const prev = RB.clone(t.rent || []);
        S().updateTenant(id, { rent: prev.concat([{ from: v.from, amount: v.amount }]) }).catch(() => {});
        ok = true;
        ui.toast('Rent changes to ' + M.fmt(v.amount) + ' on ' + D.fmt(v.from, today), { undo: () => S().updateTenant(id, { rent: prev }) });
      } }],
      onClose: () => resolve(ok),
    });
  });
}

// ------------------------------------------------------------------ give notice
function giveNotice(id) {
  if (!T.guard()) return Promise.resolve(false);
  const t = S().tenant(id); if (!t) return Promise.resolve(false);
  const today = S().today();
  const l = t.lease || {};
  const mo0 = l.moveOut || (l.end && l.end >= today ? l.end : D.monthEnd(D.addMonthKey(D.monthKey(today), 1)));
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: 'Give notice', sub: sub(t),
      body: el => {
        el.innerHTML = String(h`<div class="form-grid">
          ${ui.field({ name: 'noticeDate', id: 'gn-notice', label: 'Notice given on', type: 'date', value: l.noticeDate || today, required: true })}
          ${ui.field({ name: 'moveOut', id: 'gn-moveout', label: 'Moving out on', type: 'date', value: mo0, required: true, hint: l.end ? 'Lease ends ' + D.fmt(l.end, today) : 'Month-to-month' })}
        </div><div class="form-note mt-4" id="gn-sum"></div>`);
        const upd = () => {
          const mo = el.querySelector('#gn-moveout').value;
          const box = el.querySelector('#gn-sum');
          if (!mo || !D.valid(mo)) { box.textContent = ''; return; }
          const last = D.monthKey(mo);
          const pr = mo !== D.monthEnd(last);
          box.innerHTML = String(h`They’ll show as <strong>Notice given</strong>. Rent is charged through ${D.fmtLong(mo)}${pr ? h` — ${D.monthName(last)} is prorated to ${D.parts(mo).d} of ${D.daysInMonth(last)} days` : ''}. Record the actual move-out when they leave.`);
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
      },
      actions: [{ id: 'save', label: 'Record notice', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({
          moveOut: v.moveOut && v.noticeDate && v.moveOut < v.noticeDate ? 'Move-out can’t be before the notice date' : v.moveOut && l.moveIn && v.moveOut < l.moveIn ? 'Move-out can’t be before move-in (' + D.fmt(l.moveIn, today) + ')' : '',
        }) });
        if (!v) return false;
        const prev = { status: t.status || 'active', lease: { noticeDate: l.noticeDate || null, moveOut: l.moveOut || null } };
        const lid = RB.id();
        S().updateTenant(id, { status: 'notice', lease: { noticeDate: v.noticeDate, moveOut: v.moveOut } }).catch(() => {});
        S().addLog(id, { id: lid, kind: 'notice', text: 'Notice given — moving out ' + D.fmtLong(v.moveOut) + '.', followUp: null, done: false }).catch(() => {});
        ok = true;
        ui.toast('Notice recorded — ' + T.who(t) + ' moves out ' + D.fmt(v.moveOut, today), { undo: () => { S().updateTenant(id, prev); S().deleteLog(id, lid); } });
      } }],
      onClose: () => resolve(ok),
    });
  });
}

// ------------------------------------------------------------------ move out
function moveOut(id) {
  if (!T.guard()) return Promise.resolve(false);
  const t = S().tenant(id); if (!t) return Promise.resolve(false);
  const today = S().today();
  const settings = S().settings();
  const l = t.lease || {};
  const dep = t.deposit || {};
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: 'Move out', sub: sub(t), size: 'wide',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="form-grid">
          ${ui.field({ name: 'moveOut', id: 'mo-date', label: 'Moved out on', type: 'date', value: l.moveOut || today, required: true, hint: l.noticeDate ? 'Notice given ' + D.fmt(l.noticeDate, today) : null })}
        </div><div class="tn-sum mt-4" id="mo-sum" aria-live="polite"></div>`);
        const upd = () => {
          const mo = el.querySelector('#mo-date').value;
          const box = el.querySelector('#mo-sum');
          if (!mo || !D.valid(mo) || (l.moveIn && mo < l.moveIn)) { box.innerHTML = ''; sh.setAction('save', { label: 'Move out' }); return; }
          const pv = RB.model.moveOutPreview(t, S().entries(id), settings, today, mo);
          const fr = pv.finalRows;
          const rentRow = fr.find(r => r.kind === 'rent');
          box.innerHTML = String(h`
            <div class="tn-sum-row"><span>Final month</span><span class="tn-sum-val">${rentRow ? h`${D.monthName(pv.period)} rent${rentRow.prorate ? h` <span class="faint">· ${rentRow.prorate.days} of ${rentRow.prorate.ofDays} days × ${M.fmt(rentRow.prorate.full)}</span>` : h` <span class="faint">· full month</span>`}` : h`<span class="faint">no rent charged in ${D.monthName(pv.period)}</span>`}</span><strong>${ui.money(pv.finalTotal)}</strong></div>
            ${fr.filter(r => r.kind === 'recurring').map(r => h`<div class="tn-sum-row tn-sum-minor"><span></span><span class="tn-sum-val">${r.label}</span><span>${ui.money(r.amount)}</span></div>`)}
            <div class="tn-sum-row tn-sum-total"><span>${pv.balance >= 0 ? 'Still owed at move-out' : 'Credit at move-out'}</span><span class="tn-sum-val faint">${pv.balance !== pv.balanceNow ? 'if nothing more is paid · owed today ' + M.fmt(Math.max(0, pv.balanceNow)) : 'if nothing more is paid'}</span><strong>${pv.balance > 0 ? ui.money(pv.balance, { tone: 'owed' }) : pv.balance < 0 ? ui.money(-pv.balance) : ui.money(0)}</strong></div>
            ${+dep.amount > 0 && !dep.returned ? h`<div class="tn-sum-row"><span>Deposit held</span><span class="tn-sum-val">return by ${D.fmtLong(pv.depositDueDate)} <span class="faint">(${settings.depositReturnDays} days after move-out)</span></span><strong>${ui.money(dep.amount)}</strong></div>` : ''}
            ${mo > today ? h`<div class="form-note mt-2">${ui.icon('alert', { size: 14, cls: 'tn-inline-ico' })}That date is still ahead. To plan a future move-out, use <button type="button" class="linkbtn" id="mo-notice">Give notice</button> instead.</div>` : ''}`);
          const gn = box.querySelector('#mo-notice');
          if (gn) gn.addEventListener('click', () => { sh.close(); setTimeout(() => A().giveNotice(id), 0); });
          sh.setAction('save', { label: 'Move out on ' + D.fmt(mo, today) });
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
      },
      actions: [{ id: 'save', label: 'Move out', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({ moveOut: v.moveOut && l.moveIn && v.moveOut < l.moveIn ? 'Move-out can’t be before move-in (' + D.fmt(l.moveIn, today) + ')' : '' }) });
        if (!v) return false;
        const prev = { status: t.status || 'active', lease: { moveOut: l.moveOut || null } };
        S().updateTenant(id, { status: 'past', lease: { moveOut: v.moveOut } }).catch(() => {});
        ok = true;
        ui.toast(t.name + ' moved out ' + D.fmt(v.moveOut, today), { undo: () => S().updateTenant(id, prev) });
        if (+dep.amount > 0 && !dep.returned) setTimeout(() => settleDeposit(id, { afterMoveOut: true }), 220);
      } }],
      onClose: () => resolve(ok),
    });
  });
}

// ------------------------------------------------------------------ settle deposit
function settlementText(t, st, date, settings) {
  const W = 46;
  const line = (a, b) => { a = String(a); b = String(b); return a + ' '.repeat(Math.max(1, W - a.length - b.length)) + b; };
  const m = c => M.fmt(c, { cents: 'always' });
  const out = [];
  out.push((settings.portfolioName ? settings.portfolioName + ' — ' : '') + 'Security deposit statement');
  out.push('');
  out.push('Tenant:     ' + t.name);
  out.push('Unit:       ' + RB.model.unitLabel(t));
  if (t.lease && t.lease.moveOut) out.push('Moved out:  ' + D.fmtLong(t.lease.moveOut));
  out.push('-'.repeat(W));
  out.push(line('Deposit held', m(st.deposit)));
  st.lines.forEach(d => out.push(line('Less: ' + (d.reason || 'Deduction').slice(0, 30), '−' + m(d.amount))));
  if (st.applied) out.push(line('Applied to unpaid rent', '−' + m(st.applied)));
  out.push('-'.repeat(W));
  out.push(line('Refund to tenant', m(st.refund)));
  if (st.shortfall) out.push(line('Still owed beyond the deposit', m(st.shortfall)));
  out.push('');
  out.push('Returned on ' + (date && D.valid(date) ? D.fmtLong(date) : '—'));
  return out.join('\n');
}

function settleDeposit(id, opts) {
  if (!T.guard()) return Promise.resolve(false);
  const t = S().tenant(id); if (!t) return Promise.resolve(false);
  const today = S().today();
  const settings = S().settings();
  const dep = t.deposit || {};
  if (!(+dep.amount > 0)) { ui.toast('No deposit is recorded for ' + t.name + ' — add one in Edit details.'); return Promise.resolve(false); }
  if (dep.returned) { ui.toast('The deposit was already settled on ' + D.fmt(dep.returned.date, today) + '.'); return Promise.resolve(false); }
  const l = t.lease || {};
  const dueDate = l.moveOut ? D.addDays(l.moveOut, +settings.depositReturnDays || 0) : null;
  let cur = null;
  return new Promise(resolve => {
    let ok = false;
    const sh = ui.sheet({
      title: 'Settle deposit', size: 'wide',
      sub: (opts && opts.afterMoveOut ? 'Moved out · ' : '') + sub(t),
      body: (el, sh2) => {
        sh2.el.classList.add('tn-settle-sheet');
        const bal0 = S().ledger(id).balance;
        el.innerHTML = String(h`
          ${opts && opts.afterMoveOut ? h`<p class="muted mb-4">Moved out. Settle the deposit now, or close this and do it later from the tenant page.</p>` : ''}
          <div class="tn-dep-head">
            <div><div class="micro">Deposit held</div><div class="tn-dep-amt">${ui.money(dep.amount, { size: 'md' })}</div><div class="faint t-12">${dep.received ? 'Received ' + D.fmt(dep.received, today) : ''}${dep.heldAt ? ' · ' + dep.heldAt : ''}</div></div>
            <div><div class="micro">Return by</div>${dueDate ? h`<div class="tn-dep-due ${dueDate < today ? 'tone-bad' : D.diffDays(today, dueDate) <= 7 ? 'tone-warn' : ''}">${D.fmtLong(dueDate)}</div><div class="faint t-12">${settings.depositReturnDays} days after move-out · <span class="nowrap">${dueDate < today ? -D.diffDays(today, dueDate) + ' d overdue' : D.rel(dueDate, today)}</span></div>` : h`<div class="faint">No move-out date yet</div>`}</div>
          </div>
          <div class="mt-5"><fieldset class="fieldset"><legend class="fieldset-title">Deductions</legend>
            ${repeater('ded', [], 'Add deduction', 'sd-add')}
          </fieldset></div>
          <div class="stack stack-3 mt-4">
            ${bal0 > 0 ? ui.field({ name: 'apply', id: 'sd-apply', type: 'checkbox', value: true, label: h`Apply the deposit to the unpaid balance (${M.fmt(bal0)} owed)` }) : ''}
            <div id="sd-short-wrap" hidden>${ui.field({ name: 'chargeShort', id: 'sd-short', type: 'checkbox', value: true, label: 'Add what the deductions exceed the deposit by to the ledger as a charge' })}</div>
          </div>
          <div class="form-grid mt-4">
            ${ui.field({ name: 'date', id: 'sd-date', label: 'Returned on', type: 'date', value: today, required: true })}
          </div>
          <div class="tn-sum mt-5" id="sd-sum" aria-live="polite"></div>`);
        wireRepeaters(el);
        el.querySelector('[data-rep-list="ded"]').insertAdjacentHTML('beforeend', String(repRow('ded')));
        const upd = () => {
          const ded = readRep(el, 'ded');
          const apply = el.querySelector('#sd-apply');
          const bal = S().ledger(id).balance;
          cur = RB.model.depositSettlement({ deposit: +dep.amount, deductions: ded.map(d => ({ reason: d.reason, amount: d.amount })), balance: bal, applyToBalance: !!(apply && apply.checked) });
          show(el.querySelector('#sd-short-wrap'), cur.shortfall > 0);
          el.querySelector('#sd-sum').innerHTML = String(h`
            <div class="tn-sum-row"><span>Deposit</span><span></span>${ui.money(cur.deposit)}</div>
            ${cur.lines.map(d => h`<div class="tn-sum-row tn-sum-minor"><span>Less</span><span class="tn-sum-val">${d.reason || 'Deduction'}</span><span>−${ui.money(d.amount)}</span></div>`)}
            ${cur.applied ? h`<div class="tn-sum-row tn-sum-minor"><span>Less</span><span class="tn-sum-val">applied to unpaid balance</span><span>−${ui.money(cur.applied)}</span></div>` : ''}
            <div class="tn-sum-row tn-sum-total"><span>Refund to tenant</span><span></span><strong>${ui.money(cur.refund, { size: 'md' })}</strong></div>
            ${cur.shortfall ? h`<div class="tn-sum-row tn-sum-minor tone-bad"><span>Beyond the deposit</span><span class="tn-sum-val">still owed by the tenant</span>${ui.money(cur.shortfall)}</div>` : ''}
            ${cur.balanceAfter > 0 ? h`<div class="tn-sum-row tn-sum-minor"><span>Ledger after</span><span class="tn-sum-val">still owed</span>${ui.money(cur.balanceAfter, { tone: 'owed' })}</div>` : ''}`);
          sh2.setAction('save', { label: cur.refund > 0 ? 'Record refund of ' + M.fmt(cur.refund) : 'Settle deposit' });
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
      },
      actions: [
        { id: 'copy', label: 'Copy itemized statement', kind: '', onClick: s => {
          const date = s.body.querySelector('#sd-date').value;
          ui.copy(settlementText(S().tenant(id) || t, cur, date, settings), 'itemized statement');
          return false;
        } },
        { id: 'save', label: 'Settle deposit', kind: 'primary', onClick: s => {
          const root = s.body;
          const v = ui.form(root);
          if (!v) return false;
          const ded = readRep(root, 'ded').filter(d => d.reason || d.amount !== null || d._amountBad);
          const bad = ded.find(d => d._amountBad || !(d.amount > 0) || !d.reason);
          repError(root, 'ded', bad ? (!bad.reason ? 'Say what each deduction is for — it goes on the statement' : 'Enter an amount above zero, like 150') : '', bad && bad._row);
          if (bad) return false;
          const st = cur;
          const entryIds = [];
          if (st.applied > 0) { const eid = RB.id(); entryIds.push(eid); S().addEntry(id, { id: eid, type: 'credit', date: v.date, amount: st.applied, memo: 'Security deposit applied to balance' }).catch(() => {}); }
          if (st.shortfall > 0 && v.chargeShort) { const eid = RB.id(); entryIds.push(eid); S().addEntry(id, { id: eid, type: 'charge', date: v.date, amount: st.shortfall, category: 'damage', period: D.monthKey(v.date), memo: 'Deductions beyond the deposit' }).catch(() => {}); }
          S().updateTenant(id, { deposit: { returned: { date: v.date, refund: st.refund, deductions: st.lines, applied: st.applied } } }).catch(() => {});
          ok = true;
          ui.toast('Deposit settled — ' + (st.refund ? M.fmt(st.refund) + ' refund to ' + t.name : 'nothing to refund'), { undo: () => { S().updateTenant(id, { deposit: { returned: null } }); entryIds.forEach(eid => S().undoEntry(id, eid)); } });
        } },
      ],
      onClose: () => resolve(ok),
    });
    return sh;
  });
}

// ------------------------------------------------------------------ delete tenant (confirm — irreversible)
T.deleteTenant = async function deleteTenant(id) {
  if (!T.guard()) return false;
  const t = S().tenant(id); if (!t) return false;
  const n = Object.keys(S().entries(id)).length;
  const notes = T.logList(t).length;
  const ok = await ui.confirm({
    title: 'Delete ' + (t.name || 'this tenant') + '?',
    body: h`<p class="muted">This permanently removes <strong>${t.name}</strong> (${RB.model.unitLabel(t)}), their ledger${n ? h` with <strong>${RB.plural(n, 'recorded payment or charge', 'recorded payments and charges')}</strong>` : ''}${notes ? h` and <strong>${RB.plural(notes, 'note')}</strong>` : ''}. It can’t be undone.</p>
      <p class="muted mt-2">${t.status !== 'past' ? h`If they’ve left, <strong>Move out</strong> keeps their history instead. ` : ''}Download the ledger CSV first if you need a record.</p>`,
    confirmLabel: 'Delete ' + (t.name || 'tenant'), danger: true,
  });
  if (!ok) return false;
  if (location.hash === '#t-' + id) location.hash = 'tenants';
  try { await S().deleteTenant(id); ui.toast('Deleted ' + t.name); return true; } catch (e) { return false; }
};

// ------------------------------------------------------------------ edit a timeline note
T.editNote = function editNote(id, lid) {
  if (!T.guard()) return;
  const t = S().tenant(id); const e = t && t.log && t.log[lid]; if (!e) return;
  ui.sheet({
    title: 'Edit note', sub: sub(t),
    body: h`<div class="form-grid">
      ${ui.field({ name: 'kind', id: 'en-kind', label: 'Kind', type: 'seg', value: e.kind || 'note', options: RB.actions.LOG_KINDS, span: 2 })}
      ${ui.field({ name: 'text', id: 'en-text', label: 'What happened', type: 'textarea', value: e.text || '', required: true, span: 2, rows: 4 })}
      ${ui.field({ name: 'followUp', id: 'en-followup', label: 'Follow up on', type: 'date', value: e.followUp || '', optional: true })}
    </div>`,
    initialFocus: '#en-text',
    actions: [{ id: 'save', label: 'Save note', kind: 'primary', onClick: s => {
      const v = ui.form(s.body);
      if (!v) return false;
      const prev = { kind: e.kind || 'note', text: e.text || '', followUp: e.followUp || null, done: !!e.done };
      const patch = { kind: v.kind || 'note', text: v.text, followUp: v.followUp || null };
      if (patch.followUp !== prev.followUp) patch.done = false;
      S().updateLog(id, lid, patch).catch(() => {});
      ui.toast('Note saved', { undo: () => S().updateLog(id, lid, prev) });
    } }],
  });
};

// ------------------------------------------------------------------ hooks
Object.assign(RB.actions, {
  addTenant: preset => tenantForm(null, null, preset),
  editTenant: (id, section) => tenantForm(id, section || null),
  changeRent,
  giveNotice,
  moveOut,
  settleDeposit: id => settleDeposit(id),
});

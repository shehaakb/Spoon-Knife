// views/tenant-forms.js — tenant sheets in plain words: Add a tenant (3-step guide), Edit their details, Raise or
// change the rent, They are moving out (one guided flow: when → what they owe → the deposit), Give back the
// deposit, Remove this tenant. Assigns the shared hooks RB.actions.addTenant / editTenant / changeRent /
// giveNotice / moveOut / settleDeposit (renewLease belongs to the Leases view).
const RB = globalThis.RB;
const { html: h, ui, date: D, money: M } = RB;
const T = (RB._tn = RB._tn || {});
const S = () => RB.store;
const A = () => RB.actions;
const W = () => T.W;
const $ = c => M.fmt(c);
const sub = t => [t.name, T.place(t)].filter(Boolean).join(' — ');
let repSeq = 0;
const show = (el, on) => { if (el) el.hidden = !on; };
const firstName = t => String(t.name || 'The tenant').trim().split(/\s+/)[0];

// ------------------------------------------------------------------ step-by-step guide
/**
 * Guided steps on RB.ui.steps ("Step 2 of 3", Back / Next, summary). Our steps: {title, body(el, data),
 * validate(data) → {field: message} | null}; bodies render from `data` and keep it up to date themselves, so Back
 * never loses what was typed. opts.doneLabel(data) → button text on the summary. Resolves data when saved, null
 * when closed. A small local stand-in is used only if the shared helper is missing.
 */
T.steps = function steps(o) {
  let lastData = o.data || {};
  let finished = false, resolveP;
  const done = new Promise(r => { resolveP = r; });
  const conf = {
    title: o.title, size: 'wide', data: o.data,
    steps: o.steps.map(st => ({
      title: st.title,
      body: (el, d) => { lastData = d; el.classList.add('tn-form'); st.body(el, d); },
      validate: (vals, d) => { d = d || lastData; Object.assign(d, vals); const e = st.validate ? st.validate(d) : null; return e || {}; },
    })),
    summary: d => { lastData = d; return h`<div class="tn-summary-box">${o.summary(d)}</div>`; },
    get doneLabel() { return o.doneLabel ? o.doneLabel(lastData) : 'Save'; },
    onDone: async d => { const r = await o.onDone(d); if (r === false) return false; finished = true; resolveP(d); return undefined; },
  };
  if (typeof ui.steps === 'function') {
    const hd = ui.steps(conf);
    if (hd && hd.el) hd.el.classList.add('tn-steps-sheet');
    if (hd && typeof hd.close === 'function') { const c = hd.close; hd.close = r => { c.call(hd, r); if (!finished) resolveP(null); }; }
    return done;
  }
  // stand-in
  const data = Object.assign({}, o.data || {});
  const total = conf.steps.length;
  let i = 0, sh = null, box = null;
  const paint = () => {
    const body = sh.body;
    if (i < total) {
      body.innerHTML = String(h`<div class="tn-stephead"><div class="tn-stepcount">Step ${i + 1} of ${total}</div><h3 class="tn-steptitle">${conf.steps[i].title}</h3></div><div class="tn-stepbody"></div>`);
      box = body.querySelector('.tn-stepbody');
      conf.steps[i].body(box, data);
    } else {
      body.innerHTML = String(h`<div class="tn-stephead"><h3 class="tn-steptitle">Is this right?</h3></div><div class="tn-stepbody">${conf.summary(data)}</div>`);
      box = body.querySelector('.tn-stepbody');
    }
    const back = sh.action('back'); if (back) back.hidden = i === 0;
    sh.setAction('next', { label: i < total ? 'Next' : conf.doneLabel });
  };
  ui.sheet({
    title: o.title, size: 'wide', cancel: 'Cancel',
    body: (el, handle) => { sh = handle; handle.el.classList.add('tn-steps-sheet'); paint(); },
    actions: [
      { id: 'next', label: 'Next', kind: 'primary', onClick: async () => {
        if (i < total) {
          const v = ui.form(box, { validate: vals => conf.steps[i].validate(vals, data) });
          if (!v) return false;
          i++; paint(); return false;
        }
        return conf.onDone(data);
      } },
      { id: 'back', label: 'Back', kind: '', onClick: () => { if (i > 0) i--; paint(); return false; } },
    ],
    onClose: () => { if (!finished) resolveP(null); },
  });
  return done;
};
/** Keep `data` in step with a step's controls. */
const syncData = (el, data, after) => { const f = () => { Object.assign(data, ui.readForm(el).values); if (after) after(); }; el.addEventListener('input', f); el.addEventListener('change', f); return f; };

// ------------------------------------------------------------------ repeaters (co-tenants, monthly charges, links, deductions)
const REP = {
  co: { label: 'person', cols: [['name', 'text', 'Name'], ['phone', 'tel', 'Phone'], ['email', 'email', 'Email']] },
  rec: { label: 'charge', cols: [['label', 'text', 'What for (parking, pet…)'], ['amount', 'money', 'How much a month'], ['from', 'date', 'Starting'], ['to', 'date', 'Ending (if it ends)']] },
  link: { label: 'link', cols: [['label', 'text', 'Name (for example: Lease)'], ['url', 'url', 'Web address (https://…)']] },
  ded: { label: 'amount', cols: [['reason', 'text', 'What for (for example: cleaning)'], ['amount', 'money', 'How much']] },
};
function repRow(kind, v) {
  const n = ++repSeq;
  const cfg = REP[kind];
  v = v || {};
  return h`<div class="tn-rep-row tn-rep-${kind}" data-rep="${kind}" data-rid="${v.id || ''}">${cfg.cols.map(([k, type, ph]) => {
    const id = 'tf-' + kind + '-' + k + '-' + n;
    const label = h`<label class="tn-rep-label" for="${id}">${ph}</label>`;
    if (type === 'money') return h`<span class="tn-rep-cell tn-rep-${k}">${label}<span class="money-input"><span class="money-sym" aria-hidden="true">${M.symbol}</span><input class="input" type="text" inputmode="decimal" data-kind="money" data-k="${k}" id="${id}" placeholder="0" value="${v[k] != null && v[k] !== '' ? M.input(v[k]) : ''}" autocomplete="off"></span></span>`;
    if (type === 'date') return h`<span class="tn-rep-cell tn-rep-${k}">${label}<input class="input" type="date" data-k="${k}" id="${id}" value="${v[k] || ''}"></span>`;
    return h`<span class="tn-rep-cell tn-rep-${k}">${label}<input class="input" type="${type === 'url' ? 'url' : type}" data-k="${k}" id="${id}" value="${v[k] || ''}" autocomplete="off"></span>`;
  })}<button type="button" class="btn tn-rep-x" data-rep-remove>Remove this ${cfg.label}</button></div>`;
}
function repeater(kind, rows, addLabel, id) {
  return h`<div class="tn-rep" data-rep-list="${kind}">${(rows || []).map(r => repRow(kind, r))}</div>
    <div class="field-error tn-rep-err" data-rep-err="${kind}" aria-live="polite"></div>
    <button type="button" class="btn tn-rep-add" data-rep-add="${kind}" id="${id}">${ui.icon('plus')}<span>${addLabel}</span></button>`;
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

// ------------------------------------------------------------------ add a tenant (3 steps)
function defaultTrackFrom(moveIn, today) {
  if (!moveIn) return today;
  const ms = D.monthStart(D.monthKey(today));
  return moveIn >= ms ? moveIn : ms;
}
const propertiesList = () => Array.from(new Set(S().tenantsList().map(x => x.property).filter(Boolean))).sort(RB.natCmp);
const OTHER = '__other__';
function unitTaken(property, unit, exceptId) {
  if (!property || !unit) return null;
  return S().tenantsList().find(x => x.id !== exceptId && x.status === 'active' && RB.natCmp(x.property, property) === 0 && RB.natCmp(x.unit, unit) === 0) || null;
}
const propOf = d => (d.propPick === OTHER || !d.propPick ? String(d.propNew || '').trim() : d.propPick);

function addTenant(preset) {
  if (!T.guard()) return Promise.resolve(null);
  const today = S().today();
  const p = preset || {};
  const props = propertiesList();
  const data = {
    name: p.name || '', phone: p.phone || '', email: p.email || '',
    propPick: p.property ? (props.includes(p.property) ? p.property : OTHER) : props.length ? '' : OTHER, propNew: p.property && !props.includes(p.property) ? p.property : '',
    unit: p.unit || '', rent: p.rent || null, hasEnd: p.mtm ? 'no' : p.end ? 'yes' : '', end: p.end || null,
    moveIn: p.moveIn || p.start || today, deposit: p.deposit || null,
  };
  let nid = null;
  return T.steps({
    title: 'Add a tenant',
    data,
    steps: [
      { title: 'Who is it?',
        body: (el, d) => {
          el.innerHTML = String(h`
            ${ui.field({ name: 'name', id: 'tf-name', label: 'Their full name', value: d.name, required: true, requiredMsg: 'Write their name', placeholder: 'For example: Maya Okafor' })}
            ${ui.field({ name: 'phone', id: 'tf-phone', label: 'Phone number', type: 'tel', value: d.phone, optional: true, hint: 'You can add this later.' })}
            ${ui.field({ name: 'email', id: 'tf-email', label: 'Email address', type: 'email', value: d.email, optional: true, hint: 'You can add this later.' })}`);
          syncData(el, d);
        },
        validate: d => ({
          name: !String(d.name || '').trim() ? 'Write their name' : '',
          email: d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? 'That doesn’t look like an email address — check it, or leave it empty' : '',
        }) },
      { title: 'Where do they live?',
        body: (el, d) => {
          const opts = props.map(x => ({ value: x, label: x })).concat([{ value: OTHER, label: props.length ? 'A different property' : 'A new property' }]);
          el.innerHTML = String(h`
            ${T.pick({ name: 'propPick', id: 'tf-proppick', label: 'Which property?', value: d.propPick, options: opts, stack: true })}
            <div id="tf-propnew-wrap">${ui.field({ name: 'propNew', id: 'tf-property', label: 'What is the property called?', value: d.propNew, placeholder: 'For example: 12 Elm Street' })}</div>
            ${ui.field({ name: 'unit', id: 'tf-unit', label: 'Which unit?', value: d.unit, hint: 'For example: 2B, 101 or No. 4' })}`);
          const upd = () => show(el.querySelector('#tf-propnew-wrap'), d.propPick === OTHER);
          syncData(el, d, upd); upd();
          el.querySelector('#tf-proppick').addEventListener('change', () => { if (d.propPick === OTHER) { const f = el.querySelector('#tf-property'); if (f) f.focus(); } });
        },
        validate: d => {
          const prop = propOf(d);
          const clash = unitTaken(prop, String(d.unit || '').trim());
          return {
            propPick: !d.propPick ? 'Choose the property' : '',
            propNew: d.propPick === OTHER && !prop ? 'Write the name of the property' : '',
            unit: !String(d.unit || '').trim() ? 'Write the unit' : clash ? (clash.name || 'Someone') + ' already lives in ' + T.unitWord(d.unit) + ' at ' + prop + '. Check the unit — or move them out first.' : '',
          };
        } },
      { title: 'The rent',
        body: (el, d) => {
          if (!d.end && d.moveIn) d.end = D.addDays(D.addMonths(d.moveIn, 12), -1);
          el.innerHTML = String(h`
            ${ui.field({ name: 'rent', id: 'tf-rent', label: 'How much is the rent each month?', type: 'money', value: d.rent, placeholder: 'For example: 1,325' })}
            ${T.pick({ name: 'hasEnd', id: 'tf-hasend', label: 'Is there a lease end date?', value: d.hasEnd, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No — month-to-month' }] })}
            <div id="tf-end-wrap">${ui.field({ name: 'end', id: 'tf-end', label: 'When does the lease end?', type: 'date', value: d.end })}</div>
            ${ui.field({ name: 'moveIn', id: 'tf-movein', label: 'When did they move in?', type: 'date', value: d.moveIn, hint: 'Or when they will move in.' })}
            ${ui.field({ name: 'deposit', id: 'tf-deposit', label: 'How much deposit did they pay?', type: 'money', value: d.deposit, optional: true, hint: 'Leave it empty if there was no deposit.' })}`);
          const upd = () => show(el.querySelector('#tf-end-wrap'), d.hasEnd === 'yes');
          syncData(el, d, upd); upd();
        },
        validate: d => ({
          rent: !(d.rent > 0) ? 'Write the monthly rent, for example 1,325' : '',
          hasEnd: !d.hasEnd ? 'Choose Yes or No' : '',
          end: d.hasEnd === 'yes' && !d.end ? 'Choose the date the lease ends' : d.hasEnd === 'yes' && d.moveIn && d.end <= d.moveIn ? 'The lease has to end after they move in (' + D.fmt(d.moveIn, today) + ')' : '',
          moveIn: !d.moveIn ? 'Choose the day they moved in' : '',
          deposit: d.deposit !== null && d.deposit < 0 ? 'A deposit can’t be less than zero' : '',
        }) },
    ],
    summary: d => {
      const prop = propOf(d);
      const track = defaultTrackFrom(d.moveIn, today);
      return h`<p class="tn-summary-text" id="tf-summary">${d.name}, ${T.unitWord(String(d.unit).trim())} at ${prop}, ${$(d.rent)} a month from ${W().date(d.moveIn, today)}.</p>
        <p class="tn-summary-more">${d.hasEnd === 'yes' ? h`The lease ends ${D.fmtLong(d.end)}.` : 'Month-to-month — no end date.'}${d.deposit ? h` They paid a ${$(d.deposit)} deposit.` : ''}</p>
        ${track !== d.moveIn ? h`<p class="tn-summary-more">Rent is counted from ${W().date(track, today)}. If they already owed you money before that, add it later under “Edit their details”.</p>` : ''}`;
    },
    doneLabel: d => 'Add ' + (String(d.name || '').trim() || 'this tenant'),
    onDone: d => {
      const prop = propOf(d);
      const moveIn = d.moveIn;
      nid = RB.id();
      const name = String(d.name).trim(), unit = String(d.unit).trim();
      S().addTenant({
        id: nid, status: 'active', log: {}, name, phone: d.phone || '', email: d.email || '', property: prop, unit,
        coTenants: [], emergency: { name: '', phone: '' }, recurring: [], insurance: null, links: [], about: '',
        lease: { start: moveIn, end: d.hasEnd === 'yes' ? d.end : null, moveIn, noticeDate: null, moveOut: null, dueDay: null, graceDays: null },
        rent: [{ from: moveIn, amount: d.rent }], trackFrom: defaultTrackFrom(moveIn, today), opening: null,
        deposit: { amount: d.deposit || 0, received: d.deposit ? moveIn : null, heldAt: '', returned: null },
      }).catch(() => {});
      location.hash = 't-' + nid;
      const id = nid;
      ui.toast('Added ' + name + ', ' + T.unitWord(unit) + ' at ' + prop + '.', { duration: 10000, undo: () => { S().deleteTenant(id).catch(() => {}); if (location.hash === '#t-' + id) location.hash = 'tenants'; } });
    },
  }).then(r => (r ? nid : null));
}

// ------------------------------------------------------------------ edit their details
const MORE_SECTIONS = ['track', 'money', 'opening', 'recurring', 'cotenants', 'emergency', 'terms', 'deposit', 'insurance', 'links', 'about'];
/** Edit sheet. section: contact | lease | money | cotenants | emergency | terms | recurring | deposit | insurance | links | about */
function editTenant(id, section) {
  if (!id) return addTenant();
  if (!T.guard()) return Promise.resolve(null);
  const t = S().tenant(id);
  if (!t) return Promise.resolve(null);
  const today = S().today();
  const settings = S().settings();
  const l = t.lease || {};
  const props = propertiesList();
  const sched = (t.rent || []).filter(r => r && D.isDate(r.from)).slice().sort((a, b) => D.cmp(a.from, b.from));
  const rentEditable = sched.length <= 1;
  const moveIn0 = l.moveIn || l.start || today;
  const ins = t.insurance || {};
  const dep = t.deposit || {};
  const em = t.emergency || {};
  const moreOpen = MORE_SECTIONS.includes(section);

  return new Promise(resolve => {
    let saved = null;
    ui.sheet({
      title: 'Edit their details', sub: sub(t), size: 'wide',
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="tn-form">
          ${ui.field({ name: 'name', id: 'tf-name', label: 'Their full name', value: t.name, required: true, requiredMsg: 'Write their name' })}
          ${ui.field({ name: 'phone', id: 'tf-phone', label: 'Phone number', type: 'tel', value: t.phone, optional: true })}
          ${ui.field({ name: 'email', id: 'tf-email', label: 'Email address', type: 'email', value: t.email, optional: true })}
          ${ui.field({ name: 'property', id: 'tf-property', label: 'Which property?', value: t.property, required: true, requiredMsg: 'Write the property', attrs: { list: 'tf-props' } })}
          <datalist id="tf-props">${props.map(x => h`<option value="${x}"></option>`)}</datalist>
          ${ui.field({ name: 'unit', id: 'tf-unit', label: 'Which unit?', value: t.unit, required: true, requiredMsg: 'Write the unit' })}
          ${rentEditable
            ? ui.field({ name: 'rent', id: 'tf-rent', label: 'Rent each month', type: 'money', value: sched.length ? sched[0].amount : null, required: true, requiredMsg: 'Write the monthly rent' })
            : h`<div class="field"><span class="field-label">Rent each month</span><div class="tn-static">${$(RB.model.rentOn(t, today))}</div><div class="field-hint">The rent has changed before, so earlier amounts are kept. <button type="button" class="btn" data-tf="changerent">Raise or change the rent</button></div></div>`}
          ${T.pick({ name: 'hasEnd', id: 'tf-hasend', label: 'Is there a lease end date?', value: l.end ? 'yes' : 'no', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No — month-to-month' }] })}
          <div id="tf-end-wrap">${ui.field({ name: 'end', id: 'tf-end', label: 'When does the lease end?', type: 'date', value: l.end || D.addDays(D.addMonths(moveIn0, 12), -1) })}</div>
          ${ui.field({ name: 'moveIn', id: 'tf-movein', label: 'When did they move in?', type: 'date', value: moveIn0, required: true, requiredMsg: 'Choose the day they moved in' })}
          ${ui.field({ name: 'deposit', id: 'tf-deposit', label: 'Deposit they paid', type: 'money', value: dep.amount || null, optional: true })}

          <button type="button" class="tn-more-toggle" id="tf-more" aria-expanded="${String(moreOpen)}" aria-controls="tf-more-body">${ui.icon('chevron-down')}<span>Add more details (optional)</span></button>
          <div class="tn-more-body tn-form" id="tf-more-body"${moreOpen ? '' : RB.raw(' hidden')}>
            <p class="tn-caption">Most people never need these. Each one is explained underneath.</p>
            ${ui.field({ name: 'start', id: 'tf-start', label: 'When the lease started', type: 'date', value: l.start || moveIn0, hint: 'Usually the day they moved in.' })}
            ${ui.field({ name: 'trackFrom', id: 'tf-track', label: 'Start counting rent from', type: 'date', value: t.trackFrom || moveIn0, required: true, requiredMsg: 'Choose the day to start counting rent from', hint: 'Rent is added for every month from this day. Anything they owed before it goes in the next box.' })}
            ${ui.field({ name: 'opening', id: 'tf-opening', label: 'What they already owed', type: 'money', value: t.opening ? t.opening.amount : null, optional: true, placeholder: '0', hint: 'Money they owed you on that day. Put a minus sign in front (−250) if they had paid ahead.' })}
            <div class="field" data-sec="recurring"><span class="field-label">Other monthly charges</span><div class="field-hint">Extra amounts added every month with the rent, such as parking or a pet.</div>
              ${repeater('rec', (t.recurring || []).filter(Boolean), 'Add a monthly charge', 'tf-rec-add')}</div>
            <div class="field" data-sec="cotenants"><span class="field-label">Other people on the lease</span><div class="field-hint">A partner or roommate who signed the lease too.</div>
              ${repeater('co', (t.coTenants || []).filter(Boolean), 'Add a person', 'tf-co-add')}</div>
            ${ui.field({ name: 'emName', id: 'tf-em-name', label: 'Who to call in an emergency', value: em.name, optional: true, hint: 'Their name — a relative or friend.' })}
            ${ui.field({ name: 'emPhone', id: 'tf-em-phone', label: 'Their phone number', type: 'tel', value: em.phone, optional: true })}
            ${ui.field({ name: 'dueDay', id: 'tf-dueday', label: 'Rent is due on day…', type: 'number', value: l.dueDay, min: 1, max: 31, optional: true, placeholder: String(settings.dueDay), hint: 'Only if this tenant pays on a different day. Empty means the ' + T.ordinal(settings.dueDay) + ', like everyone else.' })}
            ${ui.field({ name: 'graceDays', id: 'tf-grace', label: 'Days before rent counts as late', type: 'number', value: l.graceDays, min: 0, max: 31, optional: true, placeholder: String(settings.graceDays), hint: 'Only if this tenant is different. Empty means ' + RB.plural(settings.graceDays, 'day') + ', like everyone else.' })}
            ${ui.field({ name: 'depReceived', id: 'tf-dep-received', label: 'Day the deposit was paid', type: 'date', value: dep.received || '', optional: true, hint: 'Empty means the day they moved in.' })}
            ${ui.field({ name: 'heldAt', id: 'tf-heldat', label: 'Where the deposit is kept', value: dep.heldAt || '', optional: true, hint: 'For example: savings account at Coastal Bank.' })}
            ${ui.field({ name: 'insCarrier', id: 'tf-ins-carrier', label: 'Their renter’s insurance company', value: ins.carrier || '', optional: true, hint: 'If they have insurance, you can be reminded before it runs out.' })}
            ${ui.field({ name: 'insPolicy', id: 'tf-ins-policy', label: 'Insurance policy number', value: ins.policy || '', optional: true })}
            ${ui.field({ name: 'insExpires', id: 'tf-ins-expires', label: 'Insurance runs out on', type: 'date', value: ins.expires || '', optional: true })}
            <div class="field" data-sec="links"><span class="field-label">Links to documents</span><div class="field-hint">For example a copy of the lease saved online. Only addresses that start with https:// work.</div>
              ${repeater('link', (t.links || []).filter(Boolean), 'Add a link', 'tf-link-add')}</div>
            ${ui.field({ name: 'about', id: 'tf-about', label: 'About them', type: 'textarea', value: t.about || '', optional: true, rows: 3, hint: 'Anything worth remembering: pets, cars, gate codes.' })}
          </div></div>`);
        wireRepeaters(el);
        const q = s => el.querySelector(s);
        const upd = () => show(q('#tf-end-wrap'), q('#tf-hasend').value === 'yes');
        el.addEventListener('change', upd); upd();
        const more = q('#tf-more');
        const setMore = open => { more.setAttribute('aria-expanded', String(open)); q('#tf-more-body').hidden = !open; };
        more.addEventListener('click', () => { const open = more.getAttribute('aria-expanded') !== 'true'; setMore(open); if (open) { const f = q('#tf-start'); f.scrollIntoView({ block: 'nearest' }); f.focus(); } });
        const cr = el.querySelector('[data-tf="changerent"]');
        if (cr) cr.addEventListener('click', () => { sh.close(); setTimeout(() => A().changeRent(id), 0); });
        if (section) {
          const target = { contact: '#tf-phone', lease: '#tf-end', money: rentEditable ? '#tf-rent' : '#tf-deposit', track: '#tf-track', opening: '#tf-opening', cotenants: '#tf-co-add', emergency: '#tf-em-name', terms: '#tf-dueday', recurring: '#tf-rec-add', deposit: '#tf-dep-received', insurance: '#tf-ins-carrier', links: '#tf-link-add', about: '#tf-about' }[section];
          requestAnimationFrame(() => requestAnimationFrame(() => {
            let f = target && q(target);
            if (section === 'lease' && q('#tf-hasend').value !== 'yes') f = q('#tf-hasend-label') ? el.querySelector('[data-seg-for="tf-hasend"] button[aria-pressed="true"]') : f;
            if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
          }));
        }
      },
      initialFocus: '#tf-name',
      actions: [{ id: 'save', label: 'Save the changes', kind: 'primary', onClick: s => {
        const root = s.body;
        const mtm = root.querySelector('#tf-hasend').value !== 'yes';
        const v = ui.form(root, { validate: v => {
          const clash = unitTaken(v.property, v.unit, id);
          return {
            end: !mtm && !v.end ? 'Choose the date the lease ends, or choose No' : !mtm && v.end && v.moveIn && v.end <= D.min(v.moveIn, v.start || v.moveIn) ? 'The lease has to end after it starts' : '',
            rent: rentEditable && v.rent !== null && v.rent <= 0 ? 'Write the monthly rent, for example 1,450' : '',
            deposit: v.deposit !== null && v.deposit < 0 ? 'A deposit can’t be less than zero' : '',
            trackFrom: v.trackFrom && v.moveIn && v.trackFrom < v.moveIn ? 'This can’t be before they moved in — use ' + D.fmt(v.moveIn, today) + ' or later' : '',
            unit: clash ? (clash.name || 'Someone') + ' already lives in ' + T.unitWord(v.unit) + ' at ' + v.property + '. Check the unit.' : '',
            dueDay: v.dueDay !== null && !(v.dueDay >= 1 && v.dueDay <= 31 && Number.isInteger(v.dueDay)) ? 'Use a day from 1 to 31, or leave it empty' : '',
            graceDays: v.graceDays !== null && !(v.graceDays >= 0 && v.graceDays <= 31 && Number.isInteger(v.graceDays)) ? 'Use a number from 0 to 31, or leave it empty' : '',
            email: v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? 'That doesn’t look like an email address — check it' : '',
          };
        } });
        const openMore = () => { const more = root.querySelector('#tf-more'); if (more.getAttribute('aria-expanded') !== 'true') more.click(); };
        if (!v) { const bad = root.querySelector('.field.is-invalid'); if (bad && bad.closest('#tf-more-body')) { openMore(); const f = bad.querySelector('input,select,textarea'); if (f) f.focus(); } return false; }
        const co = readRep(root, 'co').filter(r => r.name || r.phone || r.email);
        const badCo = co.find(r => !r.name);
        repError(root, 'co', badCo ? 'Write a name for each person (or remove the row)' : '', badCo && badCo._row);
        const rec = readRep(root, 'rec').filter(r => r.label || r.amount !== null || r._amountBad);
        const badRec = rec.find(r => !r.label || r._amountBad || !(r.amount > 0) || (r.to && r.from && r.to < r.from));
        repError(root, 'rec', badRec ? (!badRec.label ? 'Say what each monthly charge is for' : badRec.to && badRec.from && badRec.to < badRec.from ? 'The ending date must be after the starting date' : 'Write how much a month, for example 35') : '', badRec && badRec._row);
        const links = readRep(root, 'link').filter(r => r.label || r.url);
        const badLink = links.find(r => !RB.safeUrl(r.url));
        repError(root, 'link', badLink ? 'Links must start with https://' : '', badLink && badLink._row);
        if (badCo || badRec || badLink) { openMore(); return false; }
        const moveIn = v.moveIn;
        const start = v.start || moveIn;
        const insurance = v.insCarrier || v.insPolicy || v.insExpires ? { carrier: v.insCarrier, policy: v.insPolicy, expires: v.insExpires || null } : null;
        const data = {
          name: v.name, phone: v.phone, email: v.email, property: v.property, unit: v.unit,
          coTenants: co.map(r => ({ name: r.name, phone: r.phone, email: r.email })),
          emergency: { name: v.emName, phone: v.emPhone },
          lease: { start, end: mtm ? null : v.end, moveIn, dueDay: v.dueDay, graceDays: v.graceDays },
          recurring: rec.map(r => ({ id: r.id || RB.id(8), label: r.label, amount: r.amount, from: r.from || moveIn, to: r.to || null })),
          trackFrom: v.trackFrom, opening: v.opening ? { amount: v.opening } : null,
          deposit: { amount: v.deposit || 0, received: v.depReceived || (v.deposit ? dep.received || moveIn : null), heldAt: v.heldAt },
          insurance, links: links.map(r => ({ id: r.id || RB.id(8), label: r.label || r.url.replace(/^https:\/\//, '').slice(0, 40), url: r.url })), about: v.about,
        };
        if (rentEditable) data.rent = [{ from: D.min(start, moveIn), amount: v.rent }];
        const prev = {};
        Object.keys(data).forEach(k => { prev[k] = t[k] === undefined ? null : RB.clone(t[k]); });
        S().updateTenant(id, data).catch(() => {});
        saved = id;
        ui.toast('Saved the changes to ' + v.name + '.', { undo: () => S().updateTenant(id, prev), duration: 10000 });
      } }],
      onClose: () => resolve(saved),
    });
  });
}

// ------------------------------------------------------------------ raise or change the rent
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
      title: 'Raise or change the rent', sub: sub(t),
      body: (el, sh) => {
        el.innerHTML = String(h`<div class="tn-form">
          <p class="tn-lead">The rent is ${$(cur)} a month now.</p>
          ${ui.field({ name: 'amount', id: 'cr-amount', label: 'What will the new rent be?', type: 'money', value: null, required: true, requiredMsg: 'Write the new monthly rent', placeholder: 'For example: ' + M.input(Math.round(cur * 1.03 / 2500) * 2500 || 145000) })}
          ${ui.field({ name: 'from', id: 'cr-from', label: 'From what date?', type: 'date', value: from0, required: true, requiredMsg: 'Choose when the new rent starts', hint: 'Usually the 1st of a month.' })}
          <p class="tn-summary-text" id="cr-sum" aria-live="polite"></p>
        </div>`);
        const upd = () => {
          const a = M.parse(el.querySelector('#cr-amount').value);
          const f = el.querySelector('#cr-from').value;
          const was = f && D.valid(f) ? RB.model.rentOn(t, f) : cur;
          const box = el.querySelector('#cr-sum');
          if (a > 0 && f && D.valid(f)) {
            const diff = a - was;
            box.innerHTML = String(h`Rent changes from <strong>${$(was)}</strong> to <strong>${$(a)}</strong> on <strong>${D.fmtLong(f)}</strong>${diff ? ` (${diff > 0 ? 'up' : 'down'} ${$(Math.abs(diff))} a month)` : ''}. Months before that keep the old rent.${f <= today ? h` <span class="tone-warn">That date has already passed, so months from ${D.fmt(f, today)} will use the new rent.</span>` : ''}`);
            sh.setAction('save', { label: 'Change the rent to ' + $(a) });
          } else { box.textContent = 'Months before the date you choose keep the old rent.'; sh.setAction('save', { label: 'Change the rent' }); }
        };
        el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
      },
      actions: [{ id: 'save', label: 'Change the rent', kind: 'primary', onClick: s => {
        const v = ui.form(s.body, { validate: v => ({
          amount: v.amount !== null && v.amount <= 0 ? 'Write the new monthly rent, for example 1,450' : v.amount !== null && v.from && v.amount === RB.model.rentOn(t, v.from) ? 'That is already the rent on that date' : '',
          from: last && v.from && v.from <= last.from ? 'Choose a date after ' + D.fmt(last.from, today) + ' — the last change starts then' : '',
        }) });
        if (!v) return false;
        const prev = RB.clone(t.rent || []);
        S().updateTenant(id, { rent: prev.concat([{ from: v.from, amount: v.amount }]) }).catch(() => {});
        ok = true;
        ui.toast('The rent for ' + t.name + ' changes to ' + $(v.amount) + ' on ' + D.fmt(v.from, today) + '.', { undo: () => S().updateTenant(id, { rent: prev }), duration: 10000 });
      } }],
      onClose: () => resolve(ok),
    });
  });
}

// ------------------------------------------------------------------ deposit sums (shared by the move-out flow and "Give back the deposit")
function depositSums(t, data, balance) {
  const dep = +(t.deposit || {}).amount || 0;
  const ded = data.keep === 'yes' ? (data.ded || []).filter(d => d.reason || d.amount) : [];
  return RB.model.depositSettlement({ deposit: dep, deductions: ded.map(d => ({ reason: d.reason, amount: d.amount || 0 })), balance, applyToBalance: data.useForRent !== 'no' });
}
/** "Deposit $1,250 − cleaning $120 = $1,130 to give back, due by Nov 30" */
function depositSentence(st, dueDate, today) {
  const parts = ['Deposit ' + $(st.deposit)];
  st.lines.forEach(d => parts.push('− ' + (d.reason || 'other').toLowerCase() + ' ' + $(d.amount)));
  if (st.applied) parts.push('− unpaid rent ' + $(st.applied));
  if (st.creditRefunded) parts.push('+ money they paid ahead ' + $(st.creditRefunded));
  let s = parts.join(' ') + ' = ' + $(st.refund) + ' to give back';
  if (dueDate) s += ', due by ' + D.fmt(dueDate, today);
  s += '.';
  if (st.shortfall) s += ' What you are keeping is ' + $(st.shortfall) + ' more than the deposit — they still owe that.';
  else if (st.balanceAfter > 0) s += ' They will still owe ' + $(st.balanceAfter) + '.';
  return s;
}
function depositBody(el, data, t, balance, dueDate, today) {
  el.innerHTML = String(h`<div class="tn-form">
    <p class="tn-lead">They paid a deposit of ${$(+t.deposit.amount)}.${dueDate ? h` You need to give back what you don’t keep by <strong>${D.fmtLong(dueDate)}</strong>.` : ''}</p>
    ${T.pick({ name: 'keep', id: 'sd-keep', label: 'Do you need to keep any of it?', value: data.keep, options: [{ value: 'no', label: 'No — give it all back' }, { value: 'yes', label: 'Yes, some of it' }] })}
    <div class="field" id="sd-ded-wrap" data-field="_ded"><span class="field-label">What are you keeping it for?</span><div class="field-hint">For example cleaning, a repair, or a missing key.</div>
      ${repeater('ded', (data.ded && data.ded.length ? data.ded : [{}]), 'Add another amount', 'sd-add')}</div>
    ${balance > 0 ? T.pick({ name: 'useForRent', id: 'sd-apply', label: 'They still owe ' + $(balance) + '. Use the deposit to pay it?', value: data.useForRent, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }) : ''}
    ${balance < 0 ? h`<p class="tn-caption">They have ${$(-balance)} paid ahead. That is added to what you give back.</p>` : ''}
    <p class="tn-summary-text" id="sd-sum" aria-live="polite"></p>
  </div>`);
  wireRepeaters(el);
  const upd = () => {
    const vals = ui.readForm(el).values;
    data.keep = vals.keep; if (vals.useForRent !== undefined) data.useForRent = vals.useForRent;
    data.ded = readRep(el, 'ded').map(d => ({ reason: d.reason, amount: d.amount, _bad: d._amountBad }));
    show(el.querySelector('#sd-ded-wrap'), data.keep === 'yes');
    const st = depositSums(t, data, balance);
    el.querySelector('#sd-sum').textContent = depositSentence(st, dueDate, today);
  };
  el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
}
function depositErrors(el, data) {
  if (data.keep !== 'yes') return null;
  const ded = readRep(el, 'ded');
  const filled = ded.filter(d => d.reason || d.amount !== null || d._amountBad);
  const bad = filled.find(d => d._amountBad || !(d.amount > 0) || !d.reason);
  const msg = !filled.length ? 'Write what you are keeping and how much — or choose “No”' : bad ? (!bad.reason ? 'Say what each amount is for — it goes on the statement' : 'Write an amount above zero, for example 150') : '';
  repError(el, 'ded', msg, bad ? bad._row : null);
  return msg ? { _ded: msg } : null;
}
/** Write a deposit settlement (entries + deposit.returned). Returns an undo function. */
function writeSettlement(id, st, date) {
  const entryIds = [];
  if (st.applied > 0) { const eid = RB.id(); entryIds.push(eid); S().addEntry(id, { id: eid, type: 'credit', date, amount: st.applied, memo: 'Deposit used for unpaid rent' }).catch(() => {}); }
  if (st.creditRefunded > 0) { const eid = RB.id(); entryIds.push(eid); S().addEntry(id, { id: eid, type: 'charge', date, amount: st.creditRefunded, category: 'other', period: D.monthKey(date), memo: 'Money paid ahead, given back with the deposit' }).catch(() => {}); }
  if (st.shortfall > 0) { const eid = RB.id(); entryIds.push(eid); S().addEntry(id, { id: eid, type: 'charge', date, amount: st.shortfall, category: 'damage', period: D.monthKey(date), memo: 'Kept beyond the deposit' }).catch(() => {}); }
  S().updateTenant(id, { deposit: { returned: { date, refund: st.refund, deductions: st.lines, applied: st.applied, creditRefunded: st.creditRefunded } } }).catch(() => {});
  return () => { S().updateTenant(id, { deposit: { returned: null } }); entryIds.forEach(eid => S().undoEntry(id, eid)); };
}

// ------------------------------------------------------------------ they are moving out (one flow; also "give notice")
function moveOutFlow(id) {
  if (!T.guard()) return Promise.resolve(false);
  const t = S().tenant(id); if (!t) return Promise.resolve(false);
  const today = S().today();
  const settings = S().settings();
  const l = t.lease || {};
  const dep = t.deposit || {};
  const holdsDeposit = +dep.amount > 0 && !dep.returned;
  const data = { moveOut: l.moveOut || (l.end && l.end >= today && t.status === 'active' ? l.end : today), keep: 'no', useForRent: 'yes', ded: [] };
  const preview = d => RB.model.moveOutPreview(t, S().entries(id), settings, today, d.moveOut);
  const dueOf = d => D.addDays(d.moveOut, +settings.depositReturnDays || 0);
  let ok = false;
  return T.steps({
    title: 'They are moving out',
    data,
    steps: [
      { title: 'When are they moving out?',
        body: (el, d) => {
          el.innerHTML = String(h`
            <p class="tn-lead">${t.name}, ${T.place(t)}.${l.end ? h` Their lease ends ${D.fmtLong(l.end)}.` : ' They are month-to-month.'}</p>
            ${ui.field({ name: 'moveOut', id: 'mo-date', label: 'Moving-out day', type: 'date', value: d.moveOut, hint: 'If they have already gone, choose the day they left.' })}
            <p class="tn-caption" id="mo-when"></p>`);
          const upd = () => {
            const box = el.querySelector('#mo-when');
            box.textContent = !d.moveOut || !D.valid(d.moveOut) ? '' : d.moveOut > today ? 'That is ' + W().rel(d.moveOut, today) + '. They stay on your list until then, marked “Moving out”.' : 'They will be marked “Moved out”. Next you’ll see what they still owe' + (holdsDeposit ? ' and sort out the deposit.' : '.');
          };
          syncData(el, d, upd); upd();
        },
        validate: d => ({ moveOut: !d.moveOut ? 'Choose the moving-out day' : l.moveIn && d.moveOut < l.moveIn ? 'That is before they moved in (' + D.fmt(l.moveIn, today) + ')' : '' }) },
      { title: 'What they still owe',
        body: (el, d) => {
          const pv = preview(d);
          const rentRow = pv.finalRows.find(r => r.kind === 'rent');
          const lines = pv.finalRows.map(r => r.kind === 'rent'
            ? h`<li>${D.monthName(pv.period)} rent${r.prorate ? h`: ${r.prorate.days} of ${r.prorate.ofDays} days, so ${$(r.amount)} instead of ${$(r.prorate.full)}` : h`: ${$(r.amount)} (the whole month)`}</li>`
            : h`<li>${r.label}${r.prorate ? h`: ${r.prorate.days} of ${r.prorate.ofDays} days,` : ':'} ${$(r.amount)}</li>`);
          el.innerHTML = String(h`<div class="tn-sum" id="mo-sum">
            ${rentRow ? h`<p class="tn-lead">Their last rent is for ${D.monthName(pv.period)}:</p><ul class="tn-sumlist">${lines}</ul>` : h`<p class="tn-lead">There is no more rent to add for ${D.monthName(pv.period)}.</p>`}
            <p class="tn-summary-text" id="mo-owed">${pv.balance > 0 ? h`If nothing more is paid, they will owe <strong>${$(pv.balance)}</strong> when they leave.` : pv.balance < 0 ? h`They will have <strong>${$(-pv.balance)}</strong> paid ahead when they leave.` : h`When they leave, they will be <strong>all paid up</strong>.`}${pv.balanceNow > 0 && pv.balanceNow !== pv.balance ? h` Today they owe ${$(pv.balanceNow)}.` : ''}</p>
          </div>`);
        } },
      { title: holdsDeposit ? 'The deposit' : 'Anything else',
        body: (el, d) => {
          if (!holdsDeposit) { el.innerHTML = String(h`<p class="tn-lead">${+dep.amount > 0 ? 'The deposit has already been sorted out.' : 'No deposit is recorded, so there is nothing to give back.'}</p>`); return; }
          if (d.moveOut > today) { el.innerHTML = String(h`<p class="tn-lead">They paid a ${$(+dep.amount)} deposit. Sort it out after they leave: on or after ${D.fmtLong(d.moveOut)}, open their page and choose “Give back the deposit”. Today will remind you.</p>`); return; }
          depositBody(el, d, t, preview(d).balance, dueOf(d), today);
          Object.defineProperty(d, '_el', { value: el, writable: true, configurable: true, enumerable: false });
        },
        validate: d => {
          if (!holdsDeposit || d.moveOut > today) return null;
          return d._el && d._el.isConnected ? depositErrors(d._el, d) : null;
        } },
    ],
    summary: d => {
      const pv = preview(d);
      if (d.moveOut > today) return h`<p class="tn-summary-text" id="mo-summary">${t.name} is moving out on ${D.fmtLong(d.moveOut)} (${W().rel(d.moveOut, today)}).</p>
        <p class="tn-summary-more">${pv.balance > 0 ? h`If nothing more is paid, they will owe ${$(pv.balance)} then.` : 'They will be all paid up by then.'} You can finish the move-out on that day from their page or from Today.</p>`;
      const st = holdsDeposit ? depositSums(t, d, pv.balance) : null;
      return h`<p class="tn-summary-text" id="mo-summary">${t.name} moved out on ${D.fmtLong(d.moveOut)}.</p>
        ${st ? h`<p class="tn-summary-more" id="mo-deposit">${depositSentence(st, dueOf(d), today)}</p>` : h`<p class="tn-summary-more">${pv.balance > 0 ? 'They still owe ' + $(pv.balance) + '.' : 'They are all paid up.'}</p>`}`;
    },
    doneLabel: d => (d.moveOut > today ? 'Save — moving out ' + D.fmt(d.moveOut, today) : 'Finish the move-out'),
    onDone: d => {
      ok = true;
      if (d.moveOut > today) {
        const prevN = { status: t.status || 'active', lease: { noticeDate: l.noticeDate || null, moveOut: l.moveOut || null } };
        const lid = RB.id();
        S().updateTenant(id, { status: 'notice', lease: { noticeDate: l.noticeDate || today, moveOut: d.moveOut } }).catch(() => {});
        S().addLog(id, { id: lid, kind: 'notice', text: 'Moving out ' + D.fmtLong(d.moveOut) + '.', followUp: null, done: false }).catch(() => {});
        ui.toast(firstName(t) + ' is moving out on ' + D.fmt(d.moveOut, today) + '.', { undo: () => { S().updateTenant(id, prevN); S().deleteLog(id, lid); }, duration: 10000 });
        return;
      }
      const prev = { status: t.status || 'active', lease: { moveOut: l.moveOut || null } };
      S().updateTenant(id, { status: 'past', lease: { moveOut: d.moveOut } }).catch(() => {});
      let undoDep = null;
      let st = null;
      if (holdsDeposit) { st = depositSums(t, d, S().ledger(id).balance); undoDep = writeSettlement(id, st, today); }
      ui.toast(t.name + ' moved out on ' + D.fmt(d.moveOut, today) + (st ? '. Give back ' + $(st.refund) + ' of the deposit.' : '.'), { undo: () => { if (undoDep) undoDep(); S().updateTenant(id, prev); }, duration: 10000 });
    },
  }).then(r => !!r && ok);
}

// ------------------------------------------------------------------ give back the deposit (after they have gone)
function settlementText(t, st, date, settings) {
  const W2 = 46;
  const line = (a, b) => { a = String(a); b = String(b); return a + ' '.repeat(Math.max(1, W2 - a.length - b.length)) + b; };
  const m = c => M.fmt(c, { cents: 'always' });
  const out = [];
  out.push((settings.portfolioName ? settings.portfolioName + ' — ' : '') + 'Deposit statement');
  out.push('');
  out.push('Tenant:     ' + t.name);
  out.push('Unit:       ' + RB.model.unitLabel(t));
  if (t.lease && t.lease.moveOut) out.push('Moved out:  ' + D.fmtLong(t.lease.moveOut));
  out.push('-'.repeat(W2));
  out.push(line('Deposit paid', m(st.deposit)));
  st.lines.forEach(d => out.push(line('Kept for: ' + (d.reason || 'other').slice(0, 30), '−' + m(d.amount))));
  if (st.applied) out.push(line('Used for unpaid rent', '−' + m(st.applied)));
  if (st.creditRefunded) out.push(line('Plus money paid ahead', '+' + m(st.creditRefunded)));
  out.push('-'.repeat(W2));
  out.push(line('Given back to tenant', m(st.refund)));
  if (st.shortfall) out.push(line('Still owed beyond the deposit', m(st.shortfall)));
  out.push('');
  out.push('Given back on ' + (date && D.valid(date) ? D.fmtLong(date) : '—'));
  return out.join('\n');
}

function settleDeposit(id) {
  if (!T.guard()) return Promise.resolve(false);
  const t = S().tenant(id); if (!t) return Promise.resolve(false);
  const today = S().today();
  const settings = S().settings();
  const dep = t.deposit || {};
  if (!(+dep.amount > 0)) { ui.toast('No deposit is recorded for ' + t.name + '. You can add one under Edit their details.'); return Promise.resolve(false); }
  if (dep.returned) { ui.toast('The deposit was already sorted out on ' + D.fmt(dep.returned.date, today) + '.'); return Promise.resolve(false); }
  const l = t.lease || {};
  const dueDate = l.moveOut ? D.addDays(l.moveOut, +settings.depositReturnDays || 0) : null;
  const data = { keep: 'no', useForRent: 'yes', ded: [] };
  return new Promise(resolve => {
    let ok = false;
    ui.sheet({
      title: 'Give back the deposit', size: 'wide', sub: sub(t),
      body: (el, sh) => {
        sh.el.classList.add('tn-settle-sheet');
        const inner = document.createElement('div');
        el.appendChild(inner);
        depositBody(inner, data, t, S().ledger(id).balance, dueDate, today);
        el.insertAdjacentHTML('beforeend', String(h`<div class="tn-form mt-4">${ui.field({ name: 'date', id: 'sd-date', label: 'When did you give it back?', type: 'date', value: today, required: true, requiredMsg: 'Choose the day you gave it back' })}</div>`));
      },
      actions: [
        { id: 'copy', label: 'Copy the deposit sums', kind: '', onClick: s => {
          ui.copy(settlementText(S().tenant(id) || t, depositSums(t, data, S().ledger(id).balance), s.body.querySelector('#sd-date').value, settings), 'deposit sums');
          return false;
        } },
        { id: 'save', label: 'Save', kind: 'primary', onClick: s => {
          const v = ui.form(s.body);
          if (!v) return false;
          if (depositErrors(s.body, data)) return false;
          const st = depositSums(t, data, S().ledger(id).balance);
          const undo = writeSettlement(id, st, v.date);
          ok = true;
          ui.toast('Saved the deposit for ' + t.name + (st.refund ? ': ' + $(st.refund) + ' given back.' : '.'), { undo, duration: 10000 });
        } },
      ],
      onClose: () => resolve(ok),
    });
  });
}

// ------------------------------------------------------------------ remove this tenant (rule 8 confirm)
T.deleteTenant = async function deleteTenant(id) {
  if (!T.guard()) return false;
  const t = S().tenant(id); if (!t) return false;
  const n = Object.keys(S().entries(id)).length;
  const notes = T.logList(t).length;
  const ok = await ui.confirm({
    title: 'Remove ' + (t.name || 'this tenant') + '?',
    body: h`<p>This deletes <strong>${t.name}</strong> (${T.place(t)}) and their whole payment history${n ? h` — ${RB.plural(n, 'payment or charge', 'payments and charges')}` : ''}${notes ? h` and ${RB.plural(notes, 'note')}` : ''}. It cannot be undone.</p>
      ${t.status !== 'past' ? h`<p class="mt-2">If they have simply left, choose <strong>They are moving out</strong> instead — that keeps their history.</p>` : ''}`,
    confirmLabel: 'Remove ' + (t.name || 'this tenant'), danger: true,
  });
  if (!ok) return false;
  if (location.hash === '#t-' + id) location.hash = 'tenants';
  try { await S().deleteTenant(id); ui.toast('Removed ' + t.name + '.', { duration: 10000 }); return true; } catch (e) { return false; }
};

// ------------------------------------------------------------------ hooks
Object.assign(RB.actions, {
  addTenant: preset => addTenant(preset),
  editTenant: (id, section) => editTenant(id, section || null),
  changeRent,
  giveNotice: id => moveOutFlow(id),
  moveOut: id => moveOutFlow(id),
  settleDeposit: id => settleDeposit(id),
});

// 25-sample.js — RB.sample.generate(today): deterministic, realistic sample portfolio relative to `today`.
// Pure (no DOM, no store). Every tenant and ticket has sample:true.
const RB = (globalThis.RB = globalThis.RB || {});
const D = RB.date;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// unit, name, rent ($), role/profile flags. Names are invented.
const UNITS = [
  // Alder Court — 12 flats
  ['Alder Court', '1A', 'Maya Okafor', 1325, { profile: 'early', raise: [6, 50], method: 'Zelle', co: [['Dev Okafor']] }],
  ['Alder Court', '1B', 'Tomasz Wolski', 1250, { role: 'delinquent', profile: 'late', method: 'Cash' }],
  ['Alder Court', '1C', 'Hannah Becker', 1180, { profile: 'lateish', method: 'Venmo' }],
  ['Alder Court', '1D', 'Marcus Bell', 1150, { role: 'unpaid', profile: 'ontime', method: 'Check' }],
  ['Alder Court', '2A', 'Lucía Fernández', 1395, { role: 'partial', profile: 'ontime', method: 'Zelle' }],
  ['Alder Court', '2B', 'Owen Gallagher', 1375, { profile: 'ontime', method: 'ACH', pet: true }],
  ['Alder Court', '2C', 'Aisha Rahman', 1420, { role: 'ending', endIn: 51, profile: 'early', method: 'Zelle' }],
  ['Alder Court', '2D', 'Jonah Weiss', 1400, { role: 'newer', moveInMonthsAgo: 4, moveInDay: 15, profile: 'ontime', method: 'Venmo' }],
  ['Alder Court', '3A', 'Grace Liu', 1450, { role: 'mtm', profile: 'early', method: 'Check' }],
  ['Alder Court', '3B', 'Samuel Adeyemi', 1290, { profile: 'ontime', raise: [3, 40], method: 'ACH' }],
  ['Alder Court', '3C', 'Elena Petrova', 1225, { role: 'unpaid', profile: 'lateish', method: 'Money order' }],
  ['Alder Court', '3D', 'Ravi Menon', 1310, { profile: 'ontime', method: 'Zelle', co: [['Anjali Menon']] }],
  // 418 Marlow Street — 9 flats
  ['418 Marlow Street', '101', 'Claire Dubois', 1385, { role: 'mtm', profile: 'ontime', method: 'Check' }],
  ['418 Marlow Street', '102', 'Theo Lindqvist', 1520, { profile: 'early', method: 'ACH', parking: true, insSoon: true }],
  ['418 Marlow Street', '103', 'Nadia Haddad', 1475, { role: 'partial', profile: 'lateish', method: 'Venmo' }],
  ['418 Marlow Street', '201', 'Victor Alvarez', 1600, { profile: 'ontime', raise: [4, 75], method: 'Zelle' }],
  ['418 Marlow Street', '202', 'Imogen Hart', 1550, { role: 'unpaid', profile: 'lateish', method: 'Check' }],
  ['418 Marlow Street', '203', 'Kenji Watanabe', 1640, { role: 'notice', profile: 'early', method: 'ACH' }],
  ['418 Marlow Street', '301', 'Rosa Delgado', 1725, { role: 'ending', endIn: 24, profile: 'ontime', method: 'Zelle', parking: true }],
  ['418 Marlow Street', '302', 'Femi Okonkwo', 1680, { role: 'newer', moveInMonthsAgo: 7, moveInDay: 9, profile: 'ontime', method: 'ACH' }],
  ['418 Marlow Street', '303', 'Beatrix Novak', 1750, { profile: 'early', method: 'Check' }],
  // Fenwick Row — 6 houses
  ['Fenwick Row', 'No. 2', 'Arjun Kapoor', 2250, { profile: 'ontime', raise: [8, 100], method: 'ACH', co: [['Meera Kapoor', true]] }],
  ['Fenwick Row', 'No. 4', 'Lena Fischer', 1950, { role: 'mtm', profile: 'ontime', method: 'Zelle' }],
  ['Fenwick Row', 'No. 6', 'Diego Santos', 2100, { profile: 'lateish', method: 'Check', pet: true, co: [['Paula Santos', true]] }],
  ['Fenwick Row', 'No. 8', 'Ruth Abernathy', 2400, { role: 'credit', profile: 'early', method: 'ACH' }],
  ['Fenwick Row', 'No. 10', 'Callum Reid', 2050, { role: 'past', profile: 'ontime', method: 'Zelle' }],
  ['Fenwick Row', 'No. 12', 'Priya Natarajan', 2300, { profile: 'early', method: 'ACH', co: [['Sunil Natarajan', true]] }],
];

// Past repairs: [property, unit ('' = whole building), title, category, vendor, [cost lo, hi] dollars ([0,0] = no cost),
// about how many days ago, notes, extra(doneDate) → more fields]. Alder Court 2B has a clear repeat plumbing problem.
const PAST_REPAIRS = [
  ['Alder Court', '2B', 'Kitchen sink leaking under the cabinet', 'plumbing', 'Rooter Bros. Plumbing', [160, 240], 48, 'Replaced the P-trap and both supply lines. Plumber says the pipes in this stack are old.'],
  ['Alder Court', '2B', 'Bathroom tap dripping', 'plumbing', 'Rooter Bros. Plumbing', [110, 160], 165, 'New cartridge in the bath mixer tap.'],
  ['Alder Court', '2B', 'Toilet running all night', 'plumbing', 'Owner', [25, 45], 290, 'Replaced the flapper and fill valve myself.'],
  ['Alder Court', '2B', 'Leak into 1B ceiling from 2B bathroom', 'plumbing', 'Rooter Bros. Plumbing', [380, 520], 520, 'Failed wax seal under the toilet. Reset the toilet and patched the 1B ceiling.'],
  ['Alder Court', '', 'Boiler yearly service', 'heating', 'Keller Heating & Air', [260, 320], 40, 'Cleaned burners, checked flue and pressure. All good.'],
  ['Alder Court', '', 'Boiler yearly service', 'heating', 'Keller Heating & Air', [240, 300], 400, 'Replaced the pressure relief valve.'],
  ['Alder Court', '', 'Boiler yearly service', 'heating', 'Keller Heating & Air', [230, 280], 770, ''],
  ['Alder Court', '', 'Roof patch over the stairwell', 'roof', 'Summit Roofing', [650, 900], 610, 'Replaced the flashing around the vent stack.'],
  ['Alder Court', '', 'Clean gutters and downspouts', 'roof', 'Clearline Gutters', [180, 220], 380, ''],
  ['Alder Court', '', 'Hallway lights out on the second floor', 'electrical', 'Brightline Electric', [210, 260], 120, 'New LED fixtures on a shared switch.'],
  ['Alder Court', '1C', 'New dishwasher installed', 'appliance', 'Halvorsen Appliance', [620, 700], 210, 'Bosch, 2-year parts and labor warranty. Receipt in the blue folder.', d => ({ warrantyUntil: D.addDays(D.addMonths(d, 24), -1) })],
  ['Alder Court', '1C', 'Garbage disposal jammed', 'appliance', 'Owner', [0, 0], 700, 'Freed it with the hex key. No parts needed.'],
  ['Alder Court', '3D', 'Bedroom window latch broken', 'doors', 'Northgate Locksmiths', [85, 120], 230, ''],
  ['Alder Court', '2A', 'Rekey front door between tenants', 'doors', 'Northgate Locksmiths', [110, 140], 860, ''],
  ['Alder Court', '3C', 'Mice in the kitchen cabinets', 'pest', 'Brightside Pest Control', [180, 240], 330, 'Sealed gaps behind the stove. Two follow-up visits included.'],
  ['Alder Court', '1D', 'Repaint living room and hallway', 'painting', 'Novak Painting', [900, 1200], 900, 'Between tenants. Eggshell, color Swiss Coffee.'],
  ['Alder Court', '2D', 'Refinish hardwood floors', 'painting', 'Oak & Grain Floors', [1400, 1800], 140, 'Between tenants. Two coats, satin.'],
  ['Alder Court', '1B', 'Bathroom outlet not working', 'electrical', 'Brightline Electric', [140, 190], 260, 'Replaced with a GFCI outlet.'],
  ['Alder Court', '3B', 'Thermostat not holding temperature', 'heating', 'Keller Heating & Air', [120, 160], 75, 'New programmable thermostat.'],
  ['418 Marlow Street', '', 'Rear roof section replaced', 'roof', 'Summit Roofing', [8400, 9600], 980, '30-year shingles. Summit gives 10 years on their workmanship.'],
  ['418 Marlow Street', '', 'Boiler yearly service', 'heating', 'Keller Heating & Air', [260, 320], 55, ''],
  ['418 Marlow Street', '', 'Boiler yearly service', 'heating', 'Keller Heating & Air', [250, 300], 420, 'Circulator pump is getting noisy — keep an eye on it.'],
  ['418 Marlow Street', '', 'Clean gutters', 'roof', 'Clearline Gutters', [160, 200], 395, ''],
  ['418 Marlow Street', '', 'Front entry door closer replaced', 'doors', 'Northgate Locksmiths', [150, 190], 260, ''],
  ['418 Marlow Street', '', 'Repaint stairwell and lobby', 'painting', 'Novak Painting', [2200, 2800], 880, ''],
  ['418 Marlow Street', '202', 'Water heater replaced', 'plumbing', 'Rooter Bros. Plumbing', [1100, 1400], 610, '40-gallon gas heater.'],
  ['418 Marlow Street', '101', 'Smoke detectors replaced', 'electrical', 'Brightline Electric', [180, 220], 450, '10-year sealed battery type, all rooms.'],
  ['418 Marlow Street', '102', 'Fridge not cooling', 'appliance', 'Halvorsen Appliance', [210, 280], 190, 'Replaced the evaporator fan motor.'],
  ['418 Marlow Street', '103', 'Kitchen window pane broken', 'doors', 'City Glass & Glazing', [240, 300], 95, 'A guest of the tenant broke it. Tenant agreed to pay.', () => ({ paidBy: 'tenant' })],
  ['418 Marlow Street', '201', 'Bedroom ceiling repainted after a leak', 'painting', 'Novak Painting', [350, 450], 330, ''],
  ['418 Marlow Street', '301', 'Dishwasher door seal', 'appliance', 'Halvorsen Appliance', [120, 160], 730, ''],
  ['418 Marlow Street', '303', 'Bed bug treatment', 'pest', 'Brightside Pest Control', [700, 900], 1010, 'Heat treatment, whole unit. Checked 302 as well: clear.'],
  ['418 Marlow Street', '302', 'Bathroom fan replaced', 'electrical', 'Brightline Electric', [160, 210], 520, ''],
  ['Fenwick Row', 'No. 2', 'Furnace not starting', 'heating', 'Keller Heating & Air', [280, 380], 330, 'Replaced the flame sensor.'],
  ['Fenwick Row', 'No. 2', 'Furnace tune-up', 'heating', 'Keller Heating & Air', [140, 180], 700, ''],
  ['Fenwick Row', 'No. 4', 'Back fence panels blown down', 'roof', 'Ridgeway Fencing', [600, 800], 280, 'Three panels and one post.'],
  ['Fenwick Row', 'No. 4', 'Roof shingles replaced after a storm', 'roof', 'Summit Roofing', [1800, 2400], 980, 'Insurance claim HL-22817. Cost shown is the $1,000 deductible plus extras.'],
  ['Fenwick Row', 'No. 6', 'Clean gutters', 'roof', 'Clearline Gutters', [200, 240], 375, ''],
  ['Fenwick Row', 'No. 6', 'Ants in the kitchen', 'pest', 'Brightside Pest Control', [120, 150], 545, ''],
  ['Fenwick Row', 'No. 8', 'Washer drain hose split', 'appliance', 'Halvorsen Appliance', [90, 130], 150, ''],
  ['Fenwick Row', 'No. 8', 'Outside tap froze and split', 'plumbing', 'Rooter Bros. Plumbing', [180, 240], 690, 'Fitted a frost-free spigot.'],
  ['Fenwick Row', 'No. 10', 'Repaint after move-out', 'painting', 'Novak Painting', [1600, 2000], 22, ''],
  ['Fenwick Row', 'No. 10', 'Deep clean carpets', 'other', 'FreshStep Carpet Care', [260, 320], 20, 'Move-out clean.'],
  ['Fenwick Row', 'No. 12', 'Garage door spring snapped', 'doors', 'Overhead Door Pros', [240, 300], 600, ''],
  ['Fenwick Row', 'No. 12', 'Sump pump replaced', 'plumbing', 'Rooter Bros. Plumbing', [480, 620], 900, ''],
];

const ABOUT = {
  '1A': 'Works nights at the hospital — text, don’t call before noon. Bike stored in the basement cage.',
  '1B': 'Cat (Pierogi). Hours cut at work in the spring; promised to catch up.',
  '2B': 'Dog, 30 lb beagle mix (Juniper). Pet rent since lease start.',
  '3A': 'Has been here since 2019. Prefers paper checks, drops them in the mailbox.',
  '102': 'Parking space P4. Silver hatchback.',
  '203': 'Relocating for work. Very tidy; expect a clean move-out.',
  'No. 2': 'Two kids, one dog. Mows the lawn themselves.',
  'No. 6': 'Two cats. Asked about a vegetable bed in the back yard — said yes.',
  'No. 8': 'Pays a little ahead most months.',
};

function generate(today) {
  today = today || D.today();
  const rand = mulberry32(0x5eed1e55);
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const curKey = D.monthKey(today);
  const windowKey = D.addMonthKey(curKey, -11);
  const windowStart = D.monthStart(windowKey);
  const at = (date, time) => date + 'T' + (time || '16:00') + ':00.000Z';
  const ids = {};
  const mkId = n => { let id; do { id = Array.from({ length: 12 }, () => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rand() * 57)]).join(''); } while (ids[id]); ids[id] = 1; return id; };

  const settings = {
    portfolioName: 'Calder & Vane Rentals', currency: 'USD', dueDay: 1, graceDays: 5,
    lateFee: { type: 'flat', amount: 5000 }, depositReturnDays: 30, leaseNoticeDays: 60,
    methods: ['Check', 'Cash', 'Zelle', 'Venmo', 'ACH', 'Money order'], hasSample: true,
  };
  const tenants = {}, ledgers = {}, tickets = {};
  const byUnit = {};
  let checkNo = 1040;
  let phoneN = 100;

  UNITS.forEach(([property, unit, name, rentDollars, o], idx) => {
    const id = mkId();
    byUnit[unit] = id;
    const rent = rentDollars * 100;
    // ---- lease dates
    let start, end, moveIn, moveOut = null, noticeDate = null, status = 'active';
    if (o.role === 'newer') {
      moveIn = D.dayIn(D.addMonthKey(curKey, -o.moveInMonthsAgo), o.moveInDay);
      start = moveIn; end = D.addDays(D.addMonths(start, 12), -1);
    } else if (o.role === 'mtm') {
      moveIn = D.monthStart(D.addMonthKey(curKey, -(30 + idx * 3)));
      start = D.monthStart(D.addMonthKey(curKey, -(18 + (idx % 5)))); end = null;
    } else if (o.role === 'ending') {
      end = D.addDays(today, o.endIn); start = D.addDays(D.addMonths(end, -12), 1);
      moveIn = D.addMonths(start, -12 * (1 + (idx % 2)));
    } else if (o.role === 'notice') {
      moveOut = D.dayIn(D.addMonthKey(curKey, 1), 15);
      end = moveOut; start = D.addDays(D.addMonths(end, -12), 1);
      moveIn = D.addMonths(start, -12); noticeDate = D.addDays(today, -19); status = 'notice';
    } else if (o.role === 'past') {
      moveOut = D.monthEnd(D.addMonthKey(curKey, -1));
      end = moveOut; start = D.addDays(D.addMonths(end, -12), 1);
      moveIn = D.addMonths(start, -24); noticeDate = D.addDays(moveOut, -45); status = 'past';
    } else {
      // regular fixed lease ending 75..330 days out
      end = D.monthEnd(D.monthKey(D.addDays(today, 75 + ((idx * 37) % 255))));
      start = D.addDays(D.addMonths(end, -12), 1);
      moveIn = D.addMonths(start, -12 * (idx % 4));
    }
    const trackFrom = moveIn > windowStart ? moveIn : windowStart;
    const rentRows = [];
    if (o.raise) {
      const from = D.monthStart(D.addMonthKey(curKey, -o.raise[0]));
      rentRows.push({ from: D.min(moveIn, trackFrom), amount: rent - o.raise[1] * 100 }, { from, amount: rent });
    } else rentRows.push({ from: D.min(moveIn, trackFrom), amount: rent });
    const recurring = [];
    if (o.pet) recurring.push({ id: 'pet' + idx, label: 'Pet rent', amount: 3500, from: D.min(moveIn, trackFrom), to: null });
    if (o.parking) recurring.push({ id: 'park' + idx, label: 'Parking', amount: 5000, from: D.min(moveIn, trackFrom), to: null });

    const first = name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const last = name.split(' ').slice(-1)[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const phone = n => '(555) 01' + String(n).slice(-2) + '-' + String(1000 + ((n * 7919) % 9000)).slice(0, 4);
    const t = {
      name, phone: phone(phoneN++), email: first + '.' + last + '@example.com',
      coTenants: (o.co || []).map(([cn, withContact]) => ({ name: cn, phone: withContact ? phone(phoneN++) : '', email: withContact ? cn.split(' ')[0].toLowerCase() + '.' + last + '@example.net' : '' })),
      emergency: { name: pick(['Ada', 'Ben', 'Carmen', 'Dmitri', 'Eve', 'Felix', 'Gwen', 'Hugo']) + ' ' + last.charAt(0).toUpperCase() + last.slice(1), phone: phone(phoneN++) },
      property, unit, status,
      lease: { start, end, moveIn, noticeDate, moveOut, dueDay: null, graceDays: null },
      rent: rentRows, recurring, trackFrom, opening: null,
      deposit: { amount: rentRows[0].amount, received: moveIn, heldAt: 'Escrow account', returned: null },
      insurance: idx % 3 === 0 || o.insSoon ? { carrier: pick(['Lakeshore Mutual', 'Keystone Home', 'Northwind Insurance']), policy: 'RT-' + (40000 + idx * 731), expires: o.insSoon ? D.addDays(today, 12) : D.addDays(today, 60 + idx * 9) } : null,
      links: idx % 4 === 0 ? [{ id: 'lnk' + idx, label: 'Signed lease (PDF)', url: 'https://example.com/leases/' + unit.replace(/\W/g, '').toLowerCase() + '.pdf' }] : [],
      about: ABOUT[unit] || '',
      log: {},
      sample: true, createdAt: at(trackFrom), updatedAt: at(D.addDays(today, -ri(1, 20))),
    };
    if (unit === '1D') t.opening = { amount: 15000 }; // carried-in balance, paid off later
    tenants[id] = t;

    // ---- ledger
    const entries = {};
    const add = e => { const eid = mkId(); entries[eid] = Object.assign({ void: false, createdAt: at(e.date, '18:' + String(ri(10, 59))) }, e); return eid; };
    const ref = method => method === 'Check' ? String(checkNo++) : method === 'Zelle' || method === 'ACH' ? String(ri(100000, 999999)) : method === 'Money order' ? 'MO' + ri(10000, 99999) : '';
    const tenantDoc = Object.assign({ id }, t);
    const chargedFor = k => {
      const lg = RB.model.buildLedger(tenantDoc, entries, settings, today);
      return lg.months[k] ? lg.months[k].charged : 0;
    };
    const offset = (k, isCur) => {
      if (o.profile === 'early') return -ri(1, 4);
      if (o.profile === 'late') return ri(3, 12);
      if (o.profile === 'lateish') { const late = (D.diffMonths(k, curKey) % 3 === 1) && !isCur; return late ? ri(8, 13) : ri(1, 4); }
      return ri(0, 3);
    };
    const lastKey = moveOut && D.monthKey(moveOut) < curKey ? D.monthKey(moveOut) : curKey;
    for (let k = D.monthKey(t.trackFrom); k <= lastKey; k = D.addMonthKey(k, 1)) {
      const isCur = k === curKey;
      const back = D.diffMonths(k, curKey);
      const due = D.dayIn(k, settings.dueDay);
      let amount = chargedFor(k);
      if (!amount) continue;
      const method = rand() < 0.88 ? o.method : pick(['Check', 'Zelle', 'Cash']);
      let date = D.addDays(due, offset(k, isCur));
      if (k === D.monthKey(t.trackFrom) && date < t.trackFrom) date = t.trackFrom;
      if (date > today) date = today;
      if (o.role === 'delinquent') {
        if (back === 0 || back === 1) {
          if (back === 1) add({ type: 'charge', date: D.addDays(due, 6), amount: 5000, category: 'late_fee', period: k, memo: 'Late fee — ' + D.monthName(k) });
          continue;
        }
        if (back === 2) { amount = 50000; date = D.addDays(due, 9); }
      }
      if (isCur && o.role === 'unpaid') continue;
      if (isCur && o.role === 'partial') amount = Math.round(amount * 0.55 / 5000) * 5000;
      if (isCur && o.role === 'credit') amount += 25000;
      if (date > today) date = today;
      // one historic late fee for a late-ish payer, paid with the rent
      if (o.profile === 'lateish' && back === 4 && D.diffDays(due, date) > settings.graceDays) {
        add({ type: 'charge', date: D.addDays(due, settings.graceDays + 1), amount: 5000, category: 'late_fee', period: k, memo: 'Late fee — ' + D.monthName(k) });
        amount += 5000;
      }
      if (unit === '1D' && k === D.monthKey(t.trackFrom)) amount += 15000; // pays off the carried-in balance with the first rent
      add({ type: 'payment', date, amount, method, ref: ref(method), memo: '' });
    }
    // a utility recharge for one flat
    if (unit === '3D') {
      const k = D.addMonthKey(curKey, -2);
      add({ type: 'charge', date: D.dayIn(k, 18), amount: 8640, category: 'utility', period: k, memo: 'Water & sewer — shared meter' });
      add({ type: 'payment', date: D.dayIn(k, 24) > today ? today : D.dayIn(k, 24), amount: 8640, method: 'Zelle', ref: String(ri(100000, 999999)), memo: 'Water' });
    }
    // a voided mistake
    if (unit === '201') {
      const k = D.addMonthKey(curKey, -3);
      add({ type: 'payment', date: D.dayIn(k, 2), amount: 160000, method: 'Zelle', ref: 'dup', memo: 'Entered twice', void: true });
    }
    ledgers[id] = { entries };
  });

  // ---- log notes (exactly one follow-up due today-or-earlier and not done)
  const note = (unit, daysAgo, kind, text, followUp, done) => {
    const t = tenants[byUnit[unit]];
    const lid = mkId();
    t.log[lid] = { at: at(D.addDays(today, -daysAgo), '1' + ri(4, 9) + ':' + ri(10, 59)), kind, text, followUp: followUp || null, done: !!done };
  };
  note('1B', 24, 'call', 'Called about last month. Says hours were cut; can pay $500 now and the rest with the next paycheck.', null, false);
  note('1B', 6, 'text', 'Texted a reminder about the balance. No reply yet.', D.addDays(today, -1), false);
  note('3C', 2, 'text', 'Asked if paying on the 10th is OK this month. Told her the late fee applies after the 6th.', null, false);
  note('203', 19, 'notice', 'Gave written notice. Moving out mid-month; asked for a walkthrough the week before.', D.addDays(today, 9), false);
  note('2B', 40, 'visit', 'Annual smoke detector check. All good; replaced one battery.', null, false);
  note('301', 12, 'email', 'Sent renewal offer at the same rent for 12 months. Waiting to hear back.', D.addDays(today, 3), false);
  note('No. 6', 33, 'note', 'Okayed a small vegetable bed along the back fence.', D.addDays(today, -20), true);
  note('102', 8, 'email', 'Reminded about renter’s insurance renewal.', null, false);

  // ---- upkeep tickets
  const tk = (unit, title, detail, priority, status, reportedAgo, extra) => {
    const tid = mkId();
    const tid2 = byUnit[unit];
    const tn = tenants[tid2];
    tickets[tid] = Object.assign({
      tenantId: tid2 || null, property: tn.property, unit, title, detail, priority, status,
      reported: D.addDays(today, -reportedAgo), scheduled: null, completed: null, vendor: '', cost: null, paidBy: 'owner',
      sample: true, createdAt: at(D.addDays(today, -reportedAgo)), updatedAt: at(D.addDays(today, -Math.max(0, reportedAgo - 1))),
    }, extra || {});
  };
  tk('202', 'No hot water', 'Water heater pilot keeps going out. Tenant has been heating water on the stove.', 'urgent', 'open', 1, { vendor: '', category: 'plumbing' });
  tk('2B', 'Bathroom fan rattles', 'Loud rattle when the fan runs; probably a loose housing.', 'normal', 'open', 9, { category: 'electrical' });
  tk('No. 6', 'Clean gutters before winter', 'Front and back gutters, downspout at the garage is clogged.', 'normal', 'scheduled', 12, { scheduled: D.addDays(today, 4), vendor: 'Clearline Gutters', cost: 22000, category: 'roof' });
  tk('3A', 'Replace dishwasher', 'Leaks from the door seal; unit is 14 years old.', 'normal', 'scheduled', 6, { scheduled: D.addDays(today, 2), vendor: 'Halvorsen Appliance', cost: 64900, category: 'appliance' });
  tk('101', 'Smoke detector chirping', 'Hallway detector chirps at night.', 'low', 'done', 8, { completed: D.addDays(today, -6), vendor: 'Owner', cost: 1800, category: 'electrical' });
  tk('1C', 'Kitchen sink clogged', 'Slow drain, then fully blocked. Grease buildup.', 'normal', 'done', 19, { completed: D.addDays(today, -17), vendor: 'Rooter Bros. Plumbing', cost: 18500, paidBy: 'tenant', category: 'plumbing' });

  // ---- past repairs (SPEC §9): ~45 completed repairs over the last three years. A SEPARATE seeded PRNG, run after
  // everything above, so the ids and contents of the tenants, ledgers and the six tickets above never change.
  const prand = mulberry32(0x0b0e5ea1);
  const pri = (a, b) => a + Math.floor(prand() * (b - a + 1));
  const pid = () => { let id; do { id = Array.from({ length: 12 }, () => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(prand() * 57)]).join(''); } while (ids[id]); ids[id] = 1; return id; };
  PAST_REPAIRS.forEach(([property, unit, title, category, vendor, [lo, hi], daysAgo, notes, extra]) => {
    const done = D.addDays(today, -(daysAgo + pri(0, 6)));
    const cost = hi ? (lo + pri(0, hi - lo)) * 100 : null;
    const tid = unit ? byUnit[unit] : null;
    const tn = tid && tenants[tid];
    const lived = tn && tn.lease.moveIn <= done && (!tn.lease.moveOut || tn.lease.moveOut >= done);
    const id = pid();
    tickets[id] = Object.assign({
      tenantId: lived ? tid : null, property, unit, scope: unit ? 'unit' : 'building', title, detail: '', priority: 'normal', status: 'done',
      reported: D.addDays(done, -pri(1, 9)), scheduled: null, completed: done, vendor, cost, paidBy: 'owner', category, notes: notes || '',
      sample: true, createdAt: at(done), updatedAt: at(done),
    }, extra ? extra(done) : {});
  });

  return { settings, tenants, ledgers, tickets };
}

RB.sample = { generate };

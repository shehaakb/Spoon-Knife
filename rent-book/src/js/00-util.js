// 00-util.js — RB namespace, escaping, html templating, ids, dates, money, small helpers.
// Pure where possible; loadable in node (attaches to globalThis.RB).
const RB = (globalThis.RB = globalThis.RB || {});

// ---------------------------------------------------------------- escaping
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
RB.esc = function esc(v) {
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[&<>"']/g, c => ESC[c]);
};

// SafeHTML: a string that is already markup. Produced by RB.html, RB.raw and every RB.ui renderer.
class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
  valueOf() { return this.s; }
}
RB.SafeHTML = SafeHTML;
RB.raw = s => new SafeHTML(s == null ? '' : String(s));
RB.isSafe = v => v instanceof SafeHTML;

function interp(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(interp).join('');
  return RB.esc(v);
}
// Tagged template: escapes every interpolation unless it is SafeHTML (RB.html / RB.raw / RB.ui.*).
// Arrays are flattened (each item treated the same way) — pass arrays, do NOT .join('') them.
// null/undefined/false/true render as ''.
RB.html = function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += interp(vals[i]) + strings[i + 1];
  return new SafeHTML(out);
};
RB.html.join = (items, sep = '') => new SafeHTML(items.map(interp).join(interp(sep)));

// Attribute-safe URL: only https:// links are allowed, anything else → null.
RB.safeUrl = function safeUrl(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[^\s<>"']+$/i.test(s) ? s : null;
};

// ---------------------------------------------------------------- ids
// Letters and digits only, so ids are valid in #t-<id> hashes (spec: letters, digits, hyphens) and db path segments.
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
RB.id = function id(n = 12) {
  let s = '';
  while (s.length < n) {
    let bytes;
    try { bytes = globalThis.crypto.getRandomValues(new Uint8Array(n * 2)); }
    catch (e) { bytes = Array.from({ length: n * 2 }, () => Math.floor(Math.random() * 256)); }
    for (let i = 0; i < bytes.length && s.length < n; i++) if (bytes[i] < 248) s += ID_CHARS[bytes[i] % 62]; // 248 = 4×62: unbiased
  }
  return s;
};

// ---------------------------------------------------------------- dates (YYYY-MM-DD strings, no UTC maths)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map(m => m.slice(0, 3));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = n => (n < 10 ? '0' : '') + n;

// days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm)
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = s => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
function parts(s) { return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) }; }
function make(y, m, d) { return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d); }
function dim(y, m) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

const D = (RB.date = {
  MONTHS, MON,
  isDate, isMonth,
  /** Today's local calendar date. */
  today() { const n = new Date(); return make(n.getFullYear(), n.getMonth() + 1, n.getDate()); },
  /** ISO datetime for timestamps (createdAt, log.at). */
  nowIso() { return new Date().toISOString(); },
  /** True if s is a real calendar date (rejects 2026-02-30). */
  valid(s) { if (!isDate(s)) return false; const p = parts(s); return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= dim(p.y, p.m); },
  parts,
  make,
  toDays(s) { const p = parts(s); return daysFromCivil(p.y, p.m, p.d); },
  fromDays(n) { const c = civilFromDays(n); return make(c.y, c.m, c.d); },
  addDays(s, n) { return D.fromDays(D.toDays(s) + n); },
  /** Add calendar months, clamping the day (Jan 31 + 1 → Feb 28/29). */
  addMonths(s, n) {
    const p = parts(s); let mi = p.y * 12 + (p.m - 1) + n;
    const y = Math.floor(mi / 12), m = (mi % 12) + 1;
    return make(y, m, Math.min(p.d, dim(y, m)));
  },
  /** Days from a to b (b − a). diffDays('2026-11-01','2026-11-10') === 9 */
  diffDays(a, b) { return D.toDays(b) - D.toDays(a); },
  cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
  min(a, b) { return !a ? b : !b ? a : (a < b ? a : b); },
  max(a, b) { return !a ? b : !b ? a : (a > b ? a : b); },
  /** 'YYYY-MM' of a date. */
  monthKey(s) { return s.slice(0, 7); },
  /** Add n months to a 'YYYY-MM' key. */
  addMonthKey(k, n) { let mi = +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1) + n; return String(Math.floor(mi / 12)).padStart(4, '0') + '-' + pad2((mi % 12) + 1); },
  /** Whole months from key a to key b (b − a). */
  diffMonths(a, b) { return (+b.slice(0, 4) * 12 + +b.slice(5, 7)) - (+a.slice(0, 4) * 12 + +a.slice(5, 7)); },
  monthStart(k) { return k.slice(0, 7) + '-01'; },
  monthEnd(k) { const y = +k.slice(0, 4), m = +k.slice(5, 7); return make(y, m, dim(y, m)); },
  /** daysInMonth('2026-02') or daysInMonth(2026, 2) */
  daysInMonth(a, b) { if (b === undefined) return dim(+String(a).slice(0, 4), +String(a).slice(5, 7)); return dim(+a, +b); },
  /** Clamp day-of-month into a month: dayIn('2026-02', 31) → '2026-02-28' */
  dayIn(k, day) { const y = +k.slice(0, 4), m = +k.slice(5, 7); return make(y, m, Math.min(Math.max(1, day), dim(y, m))); },
  weekday(s) { const n = D.toDays(s); return DOW[((n % 7) + 11) % 7]; },
  /** "Nov 3" in the current year, "Nov 3, 2025" otherwise. Pass today to fix "current year". */
  fmt(s, today) {
    if (!isDate(s)) return '';
    const p = parts(s); const ty = (today || D.today()).slice(0, 4);
    return MON[p.m - 1] + ' ' + p.d + (String(p.y) === ty ? '' : ', ' + p.y);
  },
  /** "November 3, 2026" */
  fmtLong(s) { if (!isDate(s)) return ''; const p = parts(s); return MONTHS[p.m - 1] + ' ' + p.d + ', ' + p.y; },
  /** "11/03" — compact, for mono ledger columns ("Nov 03" with {mon:true}) */
  fmtNum(s, opts) { if (!isDate(s)) return ''; const p = parts(s); return opts && opts.mon ? MON[p.m - 1] + ' ' + pad2(p.d) : pad2(p.m) + '/' + pad2(p.d); },
  /** "November 2026" */
  fmtMonth(k) { if (!k) return ''; return MONTHS[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4); },
  /** "Nov" in the current year, "Nov ’25" otherwise; {year:true} → "Nov 2026" */
  fmtMonthShort(k, today, opts) {
    if (!k) return '';
    const m = MON[+k.slice(5, 7) - 1];
    if (opts && opts.year) return m + ' ' + k.slice(0, 4);
    return k.slice(0, 4) === (today || D.today()).slice(0, 4) ? m : m + ' ’' + k.slice(2, 4);
  },
  /** Month name only: "November" */
  monthName(k) { return MONTHS[+k.slice(5, 7) - 1]; },
  /**
   * Relative phrase for deadlines from today's point of view:
   * "today", "tomorrow", "yesterday", "in 12 days", "9 days ago". {style:'late'} → "9 days late" for past dates.
   */
  rel(s, today, opts) {
    if (!isDate(s)) return '';
    const n = D.diffDays(today || D.today(), s);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return opts && opts.style === 'late' ? '1 day late' : 'yesterday';
    if (n > 0) return 'in ' + D.days(n);
    return D.days(-n) + (opts && opts.style === 'late' ? ' late' : ' ago');
  },
  /** "1 day" / "9 days" — never abbreviated (v2 glossary). */
  days(n) { return n + (n === 1 ? ' day' : ' days'); },
  /** Parse loose user/CSV input into YYYY-MM-DD or null: 2026-11-03, 11/3/2026, 11/3/26, Nov 3 2026, 3 Nov 2026. */
  parseLoose(input, today) {
    const s = String(input || '').trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { const r = make(+m[1], +m[2], +m[3]); return D.valid(r) ? r : null; }
    if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      const r = make(y, +m[1], +m[2]); return D.valid(r) ? r : null; // US order m/d/y
    }
    const mon = i => MON.findIndex(x => x.toLowerCase() === i.slice(0, 3).toLowerCase()) + 1;
    if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})?$/))) {
      const mm = mon(m[1]); if (!mm) return null;
      const r = make(m[3] ? +m[3] : +(today || D.today()).slice(0, 4), mm, +m[2]); return D.valid(r) ? r : null;
    }
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s*(\d{4})?$/))) {
      const mm = mon(m[2]); if (!mm) return null;
      const r = make(m[3] ? +m[3] : +(today || D.today()).slice(0, 4), mm, +m[1]); return D.valid(r) ? r : null;
    }
    return null;
  },
});

// ---------------------------------------------------------------- money (integer cents)
const SYMBOLS = { USD: '$', CAD: '$', AUD: '$', NZD: '$', EUR: '€', GBP: '£' };
const M = (RB.money = {
  /** Currency symbol used by fmt(); the store sets this from settings.currency. */
  symbol: '$',
  setCurrency(code) { M.symbol = SYMBOLS[code] || (code ? String(code) + ' ' : '$'); },
  /** Digits only: 145050 → "1,450.50", 145000 → "1,450" (opts.cents:'always' → "1,450.00") */
  digits(cents, opts) {
    const c = Math.abs(Math.round(cents || 0));
    const whole = Math.floor(c / 100), frac = c % 100;
    const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const showCents = (opts && opts.cents === 'always') || (frac !== 0 && !(opts && opts.cents === 'never'));
    return showCents ? w + '.' + pad2(frac) : w;
  },
  /**
   * Format cents per spec: "$1,450", "$1,450.50", "−$120" (U+2212). opts.sign:true → "+$50" for positives.
   * opts.cents: 'auto' (default) | 'always' | 'never'
   */
  fmt(cents, opts) {
    const n = Math.round(cents || 0);
    const sign = n < 0 ? '−' : opts && opts.sign && n > 0 ? '+' : '';
    return sign + M.symbol + M.digits(n, opts);
  },
  /** For CSV / inputs: 145050 → "1450.50" (always 2 decimals, '-' for negatives, no symbol/commas). */
  plain(cents) { const n = Math.round(cents || 0); return (n < 0 ? '-' : '') + Math.floor(Math.abs(n) / 100) + '.' + pad2(Math.abs(n) % 100); },
  /** For input fields: 145050 → "1,450.50", 145000 → "1,450" */
  input(cents) { if (cents === null || cents === undefined || cents === '') return ''; return (cents < 0 ? '-' : '') + M.digits(cents); },
  /**
   * Parse user text → integer cents, or null when not a number.
   * Accepts "1450", "1,450.50", "$1,450.5", " 1450.00 ", "-120", "(120)", "−$120", "1.450,50" is NOT supported.
   */
  parse(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
    let s = String(input == null ? '' : input).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[−‒–]/g, '-');
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    s = s.replace(/^[^\d.,-]*?(?=[\d.])/, '').replace(/\s/g, ''); // drop leading currency symbols / codes
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
    const [w, f = ''] = s.replace(/,/g, '').split('.');
    const cents = (+(w || 0)) * 100 + +(f + '00').slice(0, 2) + (f.length > 2 && +f[2] >= 5 ? 1 : 0);
    return neg ? -cents : cents;
  },
  /** Round a cents amount (useful after percentage maths). */
  round(x) { return Math.round(x); },
});

// ---------------------------------------------------------------- misc helpers
RB.clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
RB.isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

RB.debounce = function debounce(fn, ms = 200) {
  let t = null;
  const d = function (...args) { clearTimeout(t); t = setTimeout(() => { t = null; fn.apply(this, args); }, ms); };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.flush = (...args) => { clearTimeout(t); t = null; fn(...args); };
  return d;
};

/** Natural compare for unit labels: "2B" < "10A", "No. 4" < "No. 12". */
RB.natCmp = function natCmp(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
};

/** "1 tenant" / "3 tenants" */
RB.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

/**
 * Copy text to the clipboard. Must be called inside the click handler (user activation).
 * Resolves true on success, false when the browser refused (caller should show the text selectable).
 */
RB.copyText = function copyText(text) {
  const s = String(text == null ? '' : text);
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, s.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); return ok;
    } catch (e) { return false; }
  };
  try {
    if (globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(() => true, () => fallback());
    }
  } catch (e) { /* fall through */ }
  return Promise.resolve(fallback());
};

/** Per-viewer conveniences in localStorage (namespaced "rb:"). Never throws. */
RB.prefs = {
  get(key, dflt) {
    try { const v = globalThis.localStorage.getItem('rb:' + key); return v === null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  },
  set(key, val) {
    try { if (val === undefined) globalThis.localStorage.removeItem('rb:' + key); else globalThis.localStorage.setItem('rb:' + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  },
  remove(key) { try { globalThis.localStorage.removeItem('rb:' + key); } catch (e) { /* ignore */ } },
};

/** Tiny event bus: RB.on('name', fn) → off(); RB.emit('name', data) */
const handlers = {};
RB.on = function on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); return () => { handlers[name] = (handlers[name] || []).filter(f => f !== fn); }; };
RB.emit = function emit(name, data) { (handlers[name] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };

/** querySelector shorthands */
RB.$ = (sel, root) => (root || document).querySelector(sel);
RB.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** Text size (per device): 'normal' | 'lg' | 'xl' → data-text on the root element. Every size token multiplies by --text-scale. */
RB.textSize = {
  OPTIONS: [{ value: 'normal', label: 'Normal', scale: 1 }, { value: 'lg', label: 'Large', scale: 1.12 }, { value: 'xl', label: 'Extra large', scale: 1.25 }],
  get() { const v = RB.prefs.get('textSize', 'normal'); return RB.textSize.OPTIONS.some(o => o.value === v) ? v : 'normal'; },
  apply(v) { try { const el = document.documentElement; if (v && v !== 'normal') el.setAttribute('data-text', v); else el.removeAttribute('data-text'); } catch (e) { /* node */ } },
  set(v) { if (!RB.textSize.OPTIONS.some(o => o.value === v)) v = 'normal'; RB.prefs.set('textSize', v); RB.textSize.apply(v); RB.emit('textsize', v); },
};
if (globalThis.document) RB.textSize.apply(RB.textSize.get());

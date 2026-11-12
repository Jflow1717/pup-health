// =====================================================================
//  The app's arithmetic: dates, "last given", what's due, ages
// =====================================================================
//  Nothing in here touches the screen or the database. It only takes
//  records in and hands answers back, so it can be checked on its own
//  (tests/logic.test.mjs).
//
//  Dates are always plain text like "2026-11-08" (year-month-day), the
//  same way the database stores them. That avoids time-zone surprises.
// =====================================================================

// "Due soon" means due within this many days.
export const DUE_SOON_DAYS = 14;

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Today's date on this phone or computer, as "2026-11-08".
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Turns "2026-11-08" into a count of days, so dates can be subtracted.
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// "2026-11-08" plus 30 days -> "2026-12-08".
export function addDays(iso, days) {
  return new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10);
}

// How many days from the first date to the second (negative if earlier).
export function daysBetween(fromIso, toIso) {
  return Math.round(dayNumber(toIso) - dayNumber(fromIso));
}

// Is this text a real date like "2026-11-08"?
export function isDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return addDays(text, 0) === text;   // catches "2026-02-30"
}

// "2026-11-08" -> "Nov 8, 2026". With short: true, the year is left
// off when it's this year ("Nov 8").
export function formatDate(iso, { short = false, today = todayISO() } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const sameYear = String(y) === today.slice(0, 4);
  return short && sameYear ? `${MONTHS[m - 1]} ${d}` : `${MONTHS[m - 1]} ${d}, ${y}`;
}

// "Born 2026-06-21" -> "4 months" (or "1 year, 2 months").
export function ageText(birthIso, today = todayISO()) {
  if (!birthIso) return '';
  const [by, bm, bd] = birthIso.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) return '';
  if (months < 3) {
    const weeks = Math.floor(daysBetween(birthIso, today) / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  const years = Math.floor(months / 12);
  months -= years * 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.join(', ');
}


// ---------------------------------------------------------------------
//  Due dates
// ---------------------------------------------------------------------
// Sorts a due date into one of four buckets:
//   overdue  the date has passed           (red)
//   soon     due within 14 days, or today  (amber)
//   ok       further out than that         (green)
//   none     no next due date was entered  (gray)
// "text" is the short phrase shown next to it.
export function dueStatus(nextDue, today = todayISO()) {
  if (!nextDue) return { level: 'none', days: null, text: 'No due date' };
  const days = daysBetween(today, nextDue);
  if (days < 0) {
    const late = -days;
    return { level: 'overdue', days, text: `${late} day${late === 1 ? '' : 's'} overdue` };
  }
  if (days === 0) return { level: 'soon', days, text: 'Due today' };
  if (days === 1) return { level: 'soon', days, text: 'Due tomorrow' };
  if (days <= DUE_SOON_DAYS) return { level: 'soon', days, text: `Due in ${days} days` };
  return { level: 'ok', days, text: `Due in ${days} days` };
}

export const STATUS_WORDS = { overdue: 'Overdue', soon: 'Due soon', ok: 'OK', none: 'No due date' };

// The same four buckets for renewal dates (town license, insurance),
// worded for renewals: "Expired 3 days ago", "Renew in 10 days",
// "Good until Jun 30, 2027".
export function renewalStatus(expiresOn, today = todayISO()) {
  const s = dueStatus(expiresOn, today);
  if (s.level === 'none') return { ...s, text: 'No renewal date' };
  if (s.level === 'overdue') return { ...s, text: `Expired ${-s.days} day${s.days === -1 ? '' : 's'} ago` };
  if (s.days === 0) return { ...s, text: 'Renew today' };
  if (s.level === 'soon') return { ...s, text: `Renew in ${s.days} day${s.days === 1 ? '' : 's'}` };
  return { ...s, text: `Good until ${formatDate(expiresOn)}` };
}

// IDs with a renewal date that has passed or is within 14 days, for the
// dashboard's "Coming up" list. Only the newest of each kind counts
// (last year's license doesn't need renewing once this year's is in).
export function idRenewals(data, today = todayISO()) {
  const out = [];
  for (const dog of sortedDogs(data.dogs)) {
    const newest = new Map();
    for (const id of data.identifiers.filter((i) => i.dog_id === dog.id)) {
      const held = newest.get(id.kind);
      if (!held || idNewerFirst(id, held) < 0) newest.set(id.kind, id);
    }
    for (const id of newest.values()) {
      const status = renewalStatus(id.expires_on, today);
      if (status.level === 'overdue' || status.level === 'soon') out.push({ dog, id, status });
    }
  }
  return out.sort((a, b) => a.status.days - b.status.days);
}

// Newest ID first: by issue date, then by when it was typed in.
export function idNewerFirst(a, b) {
  const ai = a.issued_on || '', bi = b.issued_on || '';
  if (ai !== bi) return ai < bi ? 1 : -1;
  return (a.created_at || '') < (b.created_at || '') ? 1 : -1;
}


// ---------------------------------------------------------------------
//  Last given, and the history underneath it
// ---------------------------------------------------------------------
// Newest first. Two doses on the same day: the one entered later wins.
export function newestFirst(a, b) {
  if (a.date_given !== b.date_given) return a.date_given < b.date_given ? 1 : -1;
  return (a.created_at || '') < (b.created_at || '') ? 1 : -1;
}

// Every dose of one treatment for one dog, newest first.
export function dosesFor(doses, dogId, treatmentId) {
  return doses
    .filter((d) => d.dog_id === dogId && d.treatment_id === treatmentId)
    .sort(newestFirst);
}

// Everything the screens need to know about one treatment for one dog:
//   last     the most recent dose (or null if never given)
//   history  every dose, newest first
//   status   based on the last dose's next due date
export function treatmentSummary(data, dogId, treatment, today = todayISO()) {
  const history = dosesFor(data.doses, dogId, treatment.id);
  const last = history[0] || null;
  const status = last ? dueStatus(last.next_due, today) : { level: 'none', days: null, text: 'Not given yet' };
  return { treatment, last, history, status };
}

// Treatments in the order the screens show them: vaccines, then
// medications, each by sort_order then name.
export function sortedTreatments(treatments) {
  const kindOrder = { vaccine: 0, medication: 1 };
  return [...treatments].sort((a, b) =>
    (kindOrder[a.kind] - kindOrder[b.kind]) ||
    ((a.sort_order ?? 0) - (b.sort_order ?? 0)) ||
    a.name.localeCompare(b.name));
}

// Treatments worth showing for a dog: active ones, plus inactive ones
// that this dog has history for (history is never hidden).
export function treatmentsToShow(data, dogId) {
  return sortedTreatments(data.treatments).filter((t) =>
    t.active || data.doses.some((d) => d.dog_id === dogId && d.treatment_id === t.id));
}

// Dogs in their chosen order.
export function sortedDogs(dogs) {
  return [...dogs].sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || a.name.localeCompare(b.name));
}

// The "Coming up" list on the dashboard: everything overdue or due
// within 14 days. When both dogs need the same thing on the same date
// (the usual case), they're grouped into one line.
export function comingUp(data, today = todayISO()) {
  const groups = new Map();
  for (const dog of sortedDogs(data.dogs)) {
    for (const t of data.treatments.filter((t) => t.active)) {
      const s = treatmentSummary(data, dog.id, t, today);
      if (s.status.level !== 'overdue' && s.status.level !== 'soon') continue;
      const key = t.id + '|' + s.last.next_due;
      if (!groups.has(key)) groups.set(key, { treatment: t, next_due: s.last.next_due, status: s.status, dogs: [] });
      groups.get(key).dogs.push(dog);
    }
  }
  return [...groups.values()].sort((a, b) => a.status.days - b.status.days);
}

// The next thing due after the "Coming up" list, for the "all clear" line.
export function nextOkItem(data, today = todayISO()) {
  let best = null;
  for (const dog of data.dogs) {
    for (const t of data.treatments.filter((t) => t.active)) {
      const s = treatmentSummary(data, dog.id, t, today);
      if (s.status.level === 'ok' && (!best || s.status.days < best.status.days)) best = { ...s, dog };
    }
  }
  return best;
}


// ---------------------------------------------------------------------
//  Weights and product sizes
// ---------------------------------------------------------------------
// The most recent weight entry for a dog (or null).
export function latestWeight(weights, dogId) {
  return weights
    .filter((w) => w.dog_id === dogId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

// The product size that fits a weight, like Heartgard "Green".
// Returns null if the treatment has no sizes or nothing fits.
export function bandForWeight(treatment, lbs) {
  if (lbs == null) return null;
  const bands = treatment.weight_bands || [];
  // Product boxes say "26-50 lb" and mean up to 50.9, so a weight that
  // falls in a gap between sizes goes to the smaller size it just passed.
  let pick = null;
  for (const b of [...bands].sort((a, b) => a.min_lbs - b.min_lbs)) {
    if (lbs >= b.min_lbs) pick = b;
  }
  return pick && lbs <= pick.max_lbs + 1 ? pick : null;
}

// "Green (26-50.9 lb)"
export function bandLabel(band) {
  return band ? `${band.label} (${band.min_lbs}-${band.max_lbs} lb)` : '';
}

// One dog's weights, oldest first (the order a chart draws them).
export function weightsFor(weights, dogId) {
  return weights.filter((w) => w.dog_id === dogId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// How fast a dog is growing, in pounds per day, measured from the
// earliest weigh-in in the 60 days before the latest one (at least a
// week apart, so one scale reading can't swing it). Null if there
// isn't enough to go on.
export function growthRate(weights, dogId) {
  const list = weightsFor(weights, dogId);
  if (list.length < 2) return null;
  const last = list[list.length - 1];
  const start = list.find((w) => {
    const gap = daysBetween(w.date, last.date);
    return gap >= 7 && gap <= 60;
  });
  if (!start) return null;
  const days = daysBetween(start.date, last.date);
  return { perDay: (Number(last.weight_lbs) - Number(start.weight_lbs)) / days, from: start, to: last, days };
}

// Finds the size named in a dose's "size" box: "Green (26-50 lb)" -> Green.
export function bandFromSizeText(treatment, sizeText) {
  const text = (sizeText || '').trim().toLowerCase();
  if (!text) return null;
  return (treatment.weight_bands || []).find((b) => text.startsWith(b.label.toLowerCase())) || null;
}


// ---------------------------------------------------------------------
//  "Time for the next size?" (Heartgard Plus, NexGard)
// ---------------------------------------------------------------------
// A dog gets a warning when its weight is within 5 lb of the top of its
// current size, or when its growth puts it past the top within the
// next 30 days (or before the next dose, if that's later).
export const SIZE_MARGIN_LBS = 5;
export const SIZE_LOOKAHEAD_DAYS = 30;

// Returns null for meds without sizes (or no weight yet). Otherwise:
//   level      'over' (already above the top), 'near', or 'ok'
//   band       the current size (from the last dose, else from weight)
//   next       the next size up, if there is one
//   lbs, weighed       latest weight and its date
//   perDay, since      growth rate and where it was measured from
//   reachDate  the estimated day it passes the top of the size
//   nextDose   when the next dose is due (today if it's overdue)
//   message    one plain sentence saying what to do
export function sizeCheck(data, dog, treatment, today = todayISO()) {
  const bands = [...(treatment.weight_bands || [])].sort((a, b) => a.min_lbs - b.min_lbs);
  const weight = latestWeight(data.weights, dog.id);
  if (bands.length === 0 || !weight) return null;
  const lbs = Number(weight.weight_lbs);
  const last = dosesFor(data.doses, dog.id, treatment.id)[0];
  const band = bandFromSizeText(treatment, last && last.size) || bandForWeight(treatment, lbs);
  if (!band) return null;

  const next = bands.find((b) => b.min_lbs > band.max_lbs) || null;
  const rate = growthRate(data.weights, dog.id);
  const perDay = rate && rate.perDay > 0 ? rate.perDay : null;
  const nextDose = last && last.next_due && last.next_due > today ? last.next_due : today;
  const lookahead = addDays(today, SIZE_LOOKAHEAD_DAYS);
  const horizon = nextDose > lookahead ? nextDose : lookahead;
  const reachDate = perDay && lbs <= band.max_lbs
    ? addDays(weight.date, Math.ceil((band.max_lbs - lbs) / perDay)) : null;

  let level = 'ok';
  if (lbs > band.max_lbs) level = 'over';
  else if (band.max_lbs - lbs <= SIZE_MARGIN_LBS || (reachDate && reachDate <= horizon)) level = 'near';

  const name = dog.short_name || dog.name;
  const size = `${treatment.name} ${band.label}`;
  const switchTo = next ? `switch to ${next.label} (${next.min_lbs}-${next.max_lbs} lb)` : 'ask the vet which size to use';
  const dueWords = nextDose === today ? 'the next dose' : `the ${formatDate(nextDose, { short: true, today })} dose`;
  let message;
  if (level === 'over') {
    message = `${name} weighed ${lbs} lb on ${formatDate(weight.date, { short: true, today })}, above ${size} ` +
      `(up to ${band.max_lbs} lb). For the next dose, ${switchTo}.`;
  } else if (level === 'near' && reachDate) {
    message = `${name} is on track to pass ${band.max_lbs} lb, the top of ${size}, around ` +
      `${formatDate(reachDate, { short: true, today })}. Weigh before ${dueWords}; if over ${band.max_lbs} lb, ${switchTo}.`;
  } else if (level === 'near') {
    message = `${name} is ${round1(band.max_lbs - lbs)} lb under the top of ${size} (${band.max_lbs} lb). ` +
      `Weigh before ${dueWords}; if over ${band.max_lbs} lb, ${switchTo}.`;
  } else {
    message = `${size} fits: ${lbs} lb, and the size goes up to ${band.max_lbs} lb.`;
  }
  return {
    treatment, dog, level, band, next, lbs, weighed: weight.date,
    perDay, since: rate && rate.from.date, reachDate, nextDose, message,
  };
}

// Every sized med for every dog that needs a look (near or over),
// most urgent first. Used by the dashboard.
export function sizeWarnings(data, today = todayISO()) {
  const out = [];
  for (const dog of sortedDogs(data.dogs)) {
    for (const t of sortedTreatments(data.treatments).filter((t) => t.active)) {
      const check = sizeCheck(data, dog, t, today);
      if (check && check.level !== 'ok') out.push(check);
    }
  }
  const rank = { over: 0, near: 1 };
  return out.sort((a, b) => (rank[a.level] - rank[b.level]) || ((a.reachDate || '') < (b.reachDate || '') ? -1 : 1));
}

export const round1 = (n) => Math.round(n * 10) / 10;


// ---------------------------------------------------------------------
//  "Mark as given" for monthly medications
// ---------------------------------------------------------------------
// The new dose to save when someone taps "Mark as given": given on the
// chosen day (today by default), next due repeat_days later (30), and
// the size picked from the dog's latest weight.
export function markGivenDose({ dog, treatment, data, date = todayISO() }) {
  const last = dosesFor(data.doses, dog.id, treatment.id)[0];
  const weight = latestWeight(data.weights, dog.id);
  const band = bandForWeight(treatment, weight && Number(weight.weight_lbs));
  return {
    dog_id: dog.id,
    treatment_id: treatment.id,
    date_given: date,
    next_due: addDays(date, treatment.repeat_days),
    duration: `${treatment.repeat_days} days`,
    size: band ? bandLabel(band) : (last && last.size) || null,
    product_name: (last && last.product_name) || null,
    clinic: 'Home',
  };
}

// Is there already a dose of this treatment for this dog on this day?
// (The database refuses those, so the app checks first and says so.)
export function findSameDayDose(doses, { dog_id, treatment_id, date_given }, ignoreId = null) {
  return doses.find((d) => d.id !== ignoreId && d.dog_id === dog_id &&
    d.treatment_id === treatment_id && d.date_given === date_given) || null;
}


// ---------------------------------------------------------------------
//  Vet findings
// ---------------------------------------------------------------------
// {"temp": 99, "body_condition_score": 5} -> ["Temp 99°F", "Body condition 5/9"]
const VITAL_NAMES = {
  temp: (v) => `Temp ${v}°F`,
  body_condition_score: (v) => `Body condition ${v}/9`,
  heart_rate: (v) => `Heart rate ${v}/min`,
  resp_rate: (v) => `Breathing ${v}/min`,
  safe_to_vaccinate: (v) => `Safe to vaccinate: ${v ? 'yes' : 'no'}`,
};
export function vitalsList(vitals) {
  return Object.entries(vitals || {})
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => (VITAL_NAMES[k] ? VITAL_NAMES[k](v) : `${k.replace(/_/g, ' ')}: ${v}`));
}


// ---------------------------------------------------------------------
//  Vet summary and backups
// ---------------------------------------------------------------------
// The "next due" words on the printed vet summary, which may be read
// in black and white: "Oct 29, 2027", or "OVERDUE (was due Oct 31, 2026)".
export function summaryDueText(nextDue, today = todayISO()) {
  if (!nextDue) return '';
  const s = dueStatus(nextDue, today);
  return s.level === 'overdue' ? `OVERDUE (was due ${formatDate(nextDue)})` : formatDate(nextDue);
}

// The dashboard suggests a backup when there's never been one, or the
// last was this many days ago or more.
export const BACKUP_EVERY_DAYS = 30;

// lastAt: when the last backup was downloaded (a timestamp), or null.
// Returns { day, days, due }: the date of the last backup ("2026-11-12"),
// how many days ago that was, and whether it's time for another.
export function backupAge(lastAt, today = todayISO()) {
  if (!lastAt) return { day: null, days: null, due: true };
  const day = todayISO(new Date(lastAt));
  const days = daysBetween(day, today);
  return { day, days, due: days >= BACKUP_EVERY_DAYS };
}

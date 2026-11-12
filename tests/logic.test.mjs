// Checks the app's arithmetic (js/logic.js) against the starter records
// in private/seed.json: last-given dates, due-date colors, "Mark as
// given", sizes by weight. Runs on this computer; nothing goes online.
//
//   cd tests
//   npm run test:logic
import { readFileSync } from 'node:fs';
import * as L from '../js/logic.js';

const root = process.argv[2] || '..';
const seed = JSON.parse(readFileSync(root + '/private/seed.json', 'utf8')).tables;
const TODAY = '2026-11-08';   // fixed, so the answers don't change day to day

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};
const same = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(name, ok, ok ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const dog = (short) => seed.dogs.find((d) => d.short_name === short);
const treatment = (name) => seed.treatments.find((t) => t.name.startsWith(name));
const sunny = dog('Sunny'), chomper = dog('Chomper');

// --- Dates ---
same('add 30 days across a month', L.addDays('2026-11-02', 30), '2026-12-02');
same('add 30 days across a year', L.addDays('2026-12-15', 30), '2027-01-14');
same('days between', L.daysBetween('2026-11-08', '2026-11-26'), 18);
same('real date accepted', L.isDate('2026-10-29'), true);
same('impossible date refused', L.isDate('2026-02-30'), false);
same('US-style date refused', L.isDate('10/29/2026'), false);
same('date format', L.formatDate('2027-10-29'), 'Oct 29, 2027');
same('short date drops this year', L.formatDate('2026-10-29', { short: true, today: TODAY }), 'Oct 29');
same('short date keeps next year', L.formatDate('2027-10-29', { short: true, today: TODAY }), 'Oct 29, 2027');
same('age at 4 months', L.ageText('2026-06-21', TODAY), '4 months');
same('age in weeks when tiny', L.ageText('2026-06-21', '2026-08-02'), '6 weeks');
same('age past a year', L.ageText('2026-06-21', '2027-08-25'), '1 year, 2 months');

// --- Due-date colors ---
same('yesterday is overdue', L.dueStatus('2026-11-07', TODAY).level, 'overdue');
same('today is due soon', L.dueStatus(TODAY, TODAY).text, 'Due today');
same('14 days out is due soon', L.dueStatus('2026-11-22', TODAY).level, 'soon');
same('15 days out is OK', L.dueStatus('2026-11-23', TODAY).level, 'ok');
same('no date is gray', L.dueStatus(null, TODAY).level, 'none');

// --- Last given, from the starter records ---
for (const d of [sunny, chomper]) {
  const rabies = L.treatmentSummary(seed, d.id, treatment('Rabies'), TODAY);
  same(`${d.short_name}: rabies last given`, rabies.last.date_given, '2026-10-29');
  same(`${d.short_name}: rabies lot`, rabies.last.lot_number, '886750');
  same(`${d.short_name}: rabies OK`, rabies.status.level, 'ok');

  const dhpp = L.treatmentSummary(seed, d.id, treatment('5-in-1'), TODAY);
  same(`${d.short_name}: 5-in-1 has both doses, newest first`,
    dhpp.history.map((x) => x.date_given), ['2026-10-29', '2026-10-01']);
  same(`${d.short_name}: 5-in-1 next due`, dhpp.last.next_due, '2027-10-29');

  const hg = L.treatmentSummary(seed, d.id, treatment('Heartgard'), TODAY);
  same(`${d.short_name}: Heartgard last given at home 10/3`, hg.last.date_given, '2026-10-03');
  same(`${d.short_name}: Heartgard 6 days overdue`, hg.status.text, '6 days overdue');

  const ng = L.treatmentSummary(seed, d.id, treatment('NexGard'), TODAY);
  same(`${d.short_name}: NexGard 8 days overdue`, ng.status.text, '8 days overdue');

  const lyme = L.treatmentSummary(seed, d.id, treatment('Lyme'), TODAY);
  same(`${d.short_name}: Lyme booster due 11/26, OK today`, [lyme.last.next_due, lyme.status.level], ['2026-11-26', 'ok']);
  same(`${d.short_name}: Lyme turns amber on 11/12`, L.treatmentSummary(seed, d.id, treatment('Lyme'), '2026-11-12').status.level, 'soon');

  const pyr = L.treatmentSummary(seed, d.id, treatment('Pyrantel'), TODAY);
  same(`${d.short_name}: dewormer has no due date`, pyr.status.level, 'none');

  same(`${d.short_name}: latest weight`, Number(L.latestWeight(seed.weights, d.id).weight_lbs), 38);
}

// --- Coming up: both dogs grouped on one line ---
const soon = L.comingUp(seed, TODAY);
same('coming up: NexGard first (most overdue), then Heartgard',
  soon.map((g) => g.treatment.name), ['NexGard', 'Heartgard Plus']);
same('coming up: both dogs on each line', soon.map((g) => g.dogs.length), [2, 2]);
same('next OK item is the Lyme booster', L.nextOkItem(seed, TODAY).treatment.name, 'Lyme');

// --- Sizes by weight ---
same('38 lb -> Heartgard Green', L.bandForWeight(treatment('Heartgard'), 38).label, 'Green');
same('50.9 lb -> still Green', L.bandForWeight(treatment('Heartgard'), 50.9).label, 'Green');
same('51 lb -> Brown', L.bandForWeight(treatment('Heartgard'), 51).label, 'Brown');
same('38 lb -> NexGard Purple', L.bandForWeight(treatment('NexGard'), 38).label, 'Purple');
same('no sizes -> nothing', L.bandForWeight(treatment('Rabies'), 38), null);

// --- Mark as given ---
const given = L.markGivenDose({ dog: sunny, treatment: treatment('NexGard'), data: seed, date: TODAY });
same('mark given: today', given.date_given, TODAY);
same('mark given: next due +30 days', given.next_due, '2026-12-08');
same('mark given: size from weight', given.size, 'Purple (24.1-60 lb)');
same('mark given: given at home', given.clinic, 'Home');

// --- Same-day duplicate check ---
const hgSunny = { dog_id: sunny.id, treatment_id: treatment('Heartgard').id };
check('same-day dose found', !!L.findSameDayDose(seed.doses, { ...hgSunny, date_given: '2026-10-03' }));
check('different day is fine', !L.findSameDayDose(seed.doses, { ...hgSunny, date_given: TODAY }));
const existing = L.findSameDayDose(seed.doses, { ...hgSunny, date_given: '2026-10-03' });
check('editing a dose does not clash with itself',
  !L.findSameDayDose(seed.doses, { ...hgSunny, date_given: '2026-10-03' }, existing.id));

// --- Growth ---
const sunnyRate = L.growthRate(seed.weights, sunny.id);
same('Sunny growth: 27 -> 38 lb over 28 days', [sunnyRate.from.date, sunnyRate.days, L.round1(sunnyRate.perDay * 7)], ['2026-10-01', 28, 2.8]);
const chomperRate = L.growthRate(seed.weights, chomper.id);
same('Chomper growth: 28.88 -> 38 lb', L.round1(chomperRate.perDay * 7), 2.3);
same('weights oldest first', L.weightsFor(seed.weights, sunny.id).map((w) => w.date), ['2026-10-01', '2026-10-26', '2026-10-29']);
same('one weigh-in is not enough for a rate', L.growthRate(seed.weights.filter((w) => w.date === '2026-10-29'), sunny.id), null);

// --- Time for the next size? ---
same('size from dose text "Green (26-50 lb)"', L.bandFromSizeText(treatment('Heartgard'), 'Green (26-50 lb)').label, 'Green');
const hgSunnyCheck = L.sizeCheck(seed, sunny, treatment('Heartgard'), TODAY);
same('Sunny Heartgard: near the top of Green', [hgSunnyCheck.level, hgSunnyCheck.band.label, hgSunnyCheck.next.label], ['near', 'Green', 'Brown']);
same('Sunny passes 50.9 lb around Dec 1', hgSunnyCheck.reachDate, '2026-12-01');
const hgChomperCheck = L.sizeCheck(seed, chomper, treatment('Heartgard'), TODAY);
same('Chomper passes 50.9 lb around Dec 8', [hgChomperCheck.level, hgChomperCheck.reachDate], ['near', '2026-12-08']);
const ngSunnyCheck = L.sizeCheck(seed, sunny, treatment('NexGard'), TODAY);
same('Sunny NexGard Purple (to 60 lb) is fine for now', [ngSunnyCheck.level, ngSunnyCheck.band.label], ['ok', 'Purple']);
same('no sizes -> no check', L.sizeCheck(seed, sunny, treatment('Rabies'), TODAY), null);
same('dashboard size warnings: Heartgard for both, Sunny first',
  L.sizeWarnings(seed, TODAY).map((c) => `${c.dog.short_name} ${c.treatment.name}`), ['Sunny Heartgard Plus', 'Chomper Heartgard Plus']);

// A dog weighed above the top of its size is flagged "over".
const heavier = { ...seed, weights: [...seed.weights, { dog_id: sunny.id, date: '2026-11-07', weight_lbs: 52 }] };
const over = L.sizeCheck(heavier, sunny, treatment('Heartgard'), TODAY);
same('52 lb on Green -> over, switch to Brown', [over.level, over.next.label], ['over', 'Brown']);
check('over message says to switch', over.message.includes('switch to Brown (51-100 lb)'), over.message);

// Within 5 lb of the top, even with no growth rate, is "near".
const close = { ...seed, weights: [{ dog_id: sunny.id, date: '2026-11-07', weight_lbs: 47 }] };
same('47 lb on Green (top 50.9) -> near', L.sizeCheck(close, sunny, treatment('Heartgard'), TODAY).level, 'near');
const roomy = { ...seed, weights: [{ dog_id: sunny.id, date: '2026-11-07', weight_lbs: 40 }] };
same('40 lb, no growth rate -> ok', L.sizeCheck(roomy, sunny, treatment('Heartgard'), TODAY).level, 'ok');

// --- Renewal dates (town license, insurance) ---
same('renewal passed', L.renewalStatus('2026-11-01', TODAY).text, 'Expired 7 days ago');
same('renewal soon', L.renewalStatus('2026-11-18', TODAY).text, 'Renew in 10 days');
same('renewal far off', L.renewalStatus('2027-06-30', TODAY).text, 'Good until Jun 30, 2027');
same('no renewal date', L.renewalStatus(null, TODAY).level, 'none');
same('starter records: nothing to renew', L.idRenewals(seed, TODAY), []);
const withLicense = {
  ...seed,
  identifiers: [...seed.identifiers,
    { id: 'old', dog_id: sunny.id, kind: 'town_license', value: '2025-1', issued_on: '2025-07-01', expires_on: '2026-06-30' },
    { id: 'new', dog_id: sunny.id, kind: 'town_license', value: '2026-7', issued_on: '2026-07-01', expires_on: '2026-11-15' }],
};
same('only the newest license counts', L.idRenewals(withLicense, TODAY).map((r) => [r.id.value, r.status.text]), [['2026-7', 'Renew in 7 days']]);

// --- Vet findings ---
const visit = seed.events.find((e) => e.dog_id === sunny.id && e.date === '2026-10-29' && e.kind === 'vet_visit');
same('vitals read out', L.vitalsList(visit.vitals), ['Temp 99°F', 'Body condition 5/9', 'Safe to vaccinate: yes']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

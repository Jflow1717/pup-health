// Checks the Import screen's reading and checking (js/importer.js)
// against the starter records in private/seed.json: finding the JSON in
// a messy paste, matching names, flagging what's already saved, and
// planning exactly what Save would add. Runs on this computer; nothing
// goes online.
//
//   cd tests
//   npm run test:import
//
// (No real ID numbers are written in this file. Anything "already
// saved" is built from the starter records themselves.)
import { readFileSync } from 'node:fs';
import * as I from '../js/importer.js';

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

// Paste -> drafts -> checks, in one go.
function run(pasted, data = seed) {
  const { blocks, error } = I.readPaste(pasted);
  if (error) throw new Error(error);
  const drafts = I.makeDrafts(blocks, data, TODAY);
  return { drafts, results: I.checkDrafts(drafts, data, TODAY) };
}
const items = (drafts) => drafts.flatMap((b) => b.items);
const effects = ({ drafts, results }) => items(drafts).map((it) => `${it.key}:${results.get(it.key).effect}`);
const messages = (results, key) => results.get(key).messages.map((m) => m.text).join(' | ');

// A block for a new visit on 11/6, used by several checks below.
const newVisit = (name = 'Sunny') => ({
  dog: name,
  visit: { date: '2026-11-06', clinic: 'Test Clinic', vet: 'Dr. Test', weight_lbs: 41.2,
           vitals: { temp: 101.4, body_condition_score: 5 } },
  doses: [
    { type: 'medication', name: 'Heartgard Plus Green (26-50.9 lb)', date_given: '2026-11-06' },
    { type: 'vaccine', name: 'Canine Influenza', date_given: '2026-11-06', next_due: '2026-11-27', lot: 'CI1' },
  ],
  ids: [{ kind: 'town license', value: 'TEST-1', expires_on: '2027-01-31' }],
  notes: 'Ear a little red.',
});


// --- Finding the JSON in a paste ---
const one = JSON.stringify(newVisit());
same('a plain block', I.readPaste(one).blocks.length, 1);
same('a list of blocks', I.readPaste(`[${one}, ${JSON.stringify(newVisit('Chomper'))}]`).blocks.length, 2);
same('words and ``` fences around two blocks',
  I.readPaste('Here you go:\n```json\n' + one + '\n```\nAnd for Chomper:\n```json\n' + JSON.stringify(newVisit('Chomper')) + '\n```').blocks.length, 2);
same('a list wrapped as {"blocks": [...]}', I.readPaste(`{"blocks": [${one}, ${one}]}`).blocks.length, 2);
same('curly quotes and a stray comma are fixed', I.readPaste('{“dog”: “Sunny”, “notes”: “hi”,}').blocks, [{ dog: 'Sunny', notes: 'hi' }]);
check('a missing comma says which line',
  /near line 3/.test(I.readPaste('{"dog": "Sunny",\n "doses": [\n  {"name": "Lyme" "date_given": "2026-11-06"}\n ]}').error ?? ''),
  I.readPaste('{"dog": "Sunny",\n "doses": [\n  {"name": "Lyme" "date_given": "2026-11-06"}\n ]}').error);
check('a cut-off block is caught', /cut off/.test(I.readPaste('{"dog": "Sunny", "notes": "a"').error ?? ''));
check('no block at all is caught', /no \{ \.\.\. \} block/.test(I.readPaste('Sorry, I could not read it.').error ?? ''));
check('a block with nothing to import is caught', /doesn't look like the import format/.test(I.readPaste('{"dog": "Sunny"}').error ?? ''));
check('an empty paste is caught', /Paste the block/.test(I.readPaste('   ').error ?? ''));

// --- Reading values ---
same('US date', I.toISODate('10/29/2026'), '2026-10-29');
same('US date, 2-digit year', I.toISODate('10/29/26'), '2026-10-29');
same('written-out date', I.toISODate('Oct 29, 2026'), '2026-10-29');
same('date with a time', I.toISODate('2026-10-29T00:00:00Z'), '2026-10-29');
same('impossible date left as is (and flagged later)', I.toISODate('2026-02-30'), '2026-02-30');
same('duration of a year', I.durationText('2026-10-29', '2027-10-29'), '1 year');
same('duration of 3 years', I.durationText('2026-10-29', '2029-10-29'), '3 years');
same('duration in days', I.durationText('2026-10-29', '2026-11-26'), '28 days');
same('ID kinds from loose wording',
  ['Microchip', 'rabies tag', 'Town license', 'Pet insurance policy', 'AKC registration', 'city tag'].map(I.idKind),
  ['microchip', 'rabies_tag', 'town_license', 'insurance', 'akc', 'other']);
same('vitals back to numbers and yes/no', I.parseVitals({ temp: '101.4', safe_to_vaccinate: 'yes', note: 'calm', bcs: '' }),
  { temp: 101.4, safe_to_vaccinate: true, note: 'calm' });

// --- Matching names ---
same('dog by short name', I.matchDog('Chomper', seed.dogs)?.id, chomper.id);
same('dog by full name, any case', I.matchDog('chomper kelce', seed.dogs)?.id, chomper.id);
same('dog with a last name added', I.matchDog('Sunny Kelce', seed.dogs)?.id, sunny.id);
same('unknown dog', I.matchDog('Buddy', seed.dogs), null);
const tname = (n, type) => I.matchTreatment(n, seed.treatments, type)?.treatment.name ?? null;
same('brand in brackets', tname('Rabies (Nobivac)'), 'Rabies');
same('name inside a longer name', tname('Nobivac 1-Rabies'), 'Rabies');
same('another name (DHPP)', tname('DHPP'), '5-in-1 (DA2PP/Parvo)');
same('name plus size', tname('Heartgard Plus Green (26-50.9 lb)'), 'Heartgard Plus');
same('longest match wins', tname('Strongid/Pyrantel Pamoate dewormer'), 'Pyrantel dewormer (Strongid)');
same('a new vaccine matches nothing', tname('Canine Influenza'), null);
check('a combination shot is flagged as maybe two things',
  (I.matchTreatment('DHPP + Lepto', seed.treatments)?.others.length ?? 0) === 1);
same('product from brackets', I.productFromName('Rabies (Nobivac)', treatment('Rabies')), 'Nobivac');
same('no product when the brackets are another name', I.productFromName('Strongid (pyrantel pamoate)', treatment('Pyrantel')), '');
same('no product when it is just name plus size', I.productFromName('Heartgard Plus Green (26-50.9 lb)', treatment('Heartgard')), '');
same('a brand name is kept as the product', I.productFromName('Vanguard Plus 5', treatment('5-in-1')), 'Vanguard Plus 5');
same('size from the name', I.sizeFromName('NexGard Purple (24.1-60 lb)', treatment('NexGard')), 'Purple (24.1-60 lb)');

// --- A new visit ---
const fresh = run(one);
same('new visit: everything is new', effects(fresh).every((e) => e.endsWith(':add')), true);
same('new visit: the unknown vaccine must be picked first', I.blockingProblems(fresh.drafts, fresh.results).map((p) => p.key), ['b0-dose-1']);
const hg = items(fresh.drafts).find((it) => it.key === 'b0-dose-0');
same('Heartgard: next due filled in 30 days later', [hg.fields.next_due, hg.fields.duration], ['2026-12-06', '30 days']);
same('Heartgard: size taken from the name', hg.fields.size, 'Green (26-50.9 lb)');
same('Heartgard: vet and clinic from the visit', [hg.fields.vet, hg.fields.clinic], ['Dr. Test', 'Test Clinic']);
same('visit title from the doses', items(fresh.drafts)[0].fields.title, 'Heartgard Plus, Canine Influenza');
same('notes go in the visit details', items(fresh.drafts)[0].fields.details, 'Ear a little red.');

// Add the flu shot as new, with the same block for Chomper too: one new
// vaccine, shared by both dogs' doses.
const both = run(`[${one}, ${JSON.stringify(newVisit('Chomper'))}]`);
const flu = items(both.drafts).find((it) => it.key === 'b0-dose-1');
flu.fields.treatment_id = '__new';
same('the other dog\'s matching dose follows "add as new"', I.followNewTreatment(both.drafts, flu).map((it) => it.key), ['b1-dose-1']);
const bothResults = I.checkDrafts(both.drafts, seed, TODAY);
same('both dogs: nothing left to fix', I.blockingProblems(both.drafts, bothResults), []);
const plan = I.planSave(both.drafts, bothResults, seed);
same('plan: one new vaccine, two visits, four doses, two weights, two IDs',
  [plan.treatments.length, plan.events.length, plan.doses.length, plan.weights.length, plan.identifiers.length, plan.updates.length],
  [1, 2, 4, 2, 2, 0]);
same('plan: the flu doses point at the new vaccine',
  plan.doses.filter((d) => typeof d.treatment_id === 'object').map((d) => d.treatment_id.$ref), ['treatment:canine influenza', 'treatment:canine influenza']);
same('plan: doses and weights point at their own new visit',
  [...plan.doses, ...plan.weights].map((r) => r.event_id?.$ref), ['b0-event-0', 'b0-event-0', 'b1-event-0', 'b1-event-0', 'b0-event-0', 'b1-event-0']);
same('plan: vitals saved as numbers', plan.events[0].row.vitals, { temp: 101.4, body_condition_score: 5 });
same('plan: words for the confirm', I.countWords(plan.perDog[0].counts), '1 visit, 2 doses, 1 weight and 1 ID');
same('fillRefs swaps in the saved IDs',
  I.fillRefs(plan.doses[1], { 'treatment:canine influenza': 'T1', 'b0-event-0': 'E1' }).treatment_id + '/' +
  I.fillRefs(plan.doses[1], { 'treatment:canine influenza': 'T1', 'b0-event-0': 'E1' }).event_id, 'T1/E1');

// --- Pasting what's already saved (built from the starter records) ---
const savedVisit = seed.events.find((e) => e.dog_id === sunny.id && e.date === '2026-10-29' && e.kind === 'vet_visit');
const savedRabies = seed.doses.find((d) => d.dog_id === sunny.id && d.treatment_id === treatment('Rabies').id);
const savedTag = seed.identifiers.find((x) => x.dog_id === sunny.id && x.kind === 'rabies_tag');
const savedWeight = seed.weights.find((w) => w.dog_id === sunny.id && w.date === '2026-10-29');
const again = {
  dog: 'Sunny',
  visit: { date: savedVisit.date, clinic: savedVisit.clinic, vet: savedVisit.vet, weight_lbs: Number(savedWeight.weight_lbs),
           vitals: { temp: savedVisit.vitals.temp, body_condition_score: savedVisit.vitals.body_condition_score } },
  doses: [{ type: 'vaccine', name: 'Rabies (Nobivac)', date_given: savedRabies.date_given, next_due: savedRabies.next_due,
            lot: savedRabies.lot_number, lot_expires: savedRabies.lot_expires }],
  ids: [{ kind: 'rabies_tag', value: savedTag.value }],
  notes: '',
};
const repeat = run(JSON.stringify(again));
same('same paperwork again: visit uses the saved one, the rest is skipped', effects(repeat),
  ['b0-event-0:link', 'b0-weight-0:skip', 'b0-dose-0:skip', 'b0-id-0:skip']);
same('same paperwork again: nothing to save', I.planSave(repeat.drafts, repeat.results, seed).total, 0);
same('"Nobivac" vs saved "Nobivac (Merck)" is not a difference', repeat.results.get('b0-dose-0').same, true);
same('a date the app filled in is not a difference', repeat.results.get('b0-id-0').same, true);

// A different lot number: flagged, kept as saved unless "update" is picked.
const lot = run(JSON.stringify({ ...again, doses: [{ ...again.doses[0], lot: 'OTHER-LOT' }] }));
const lotResult = lot.results.get('b0-dose-0');
same('different lot: listed as a change', lotResult.changes.map((c) => c.label), ['Lot number']);
same('different lot: kept as saved by default', lotResult.effect, 'skip');
items(lot.drafts).find((it) => it.key === 'b0-dose-0').action = 'update';
const lotPlan = I.planSave(lot.drafts, I.checkDrafts(lot.drafts, seed, TODAY), seed);
same('different lot: "update" changes only the lot', lotPlan.updates.map((u) => [u.table, u.id, u.changes]),
  [['doses', savedRabies.id, { lot_number: 'OTHER-LOT' }]]);

// The same visit with a new note and a new finding: added to the saved visit.
const extra = run(JSON.stringify({ ...again, visit: { ...again.visit, vitals: { ...again.visit.vitals, heart_rate: 110 } }, notes: 'Calm.' }));
const extraPlan = I.planSave(extra.drafts, extra.results, seed);
same('saved visit: only adds what it\'s missing', extraPlan.updates.map((u) => [u.table, u.changes.details?.endsWith('Calm.'), u.changes.vitals?.heart_rate, u.changes.vitals?.temp]),
  [['events', true, 110, savedVisit.vitals.temp]]);

const heavier = run(JSON.stringify({ ...again, visit: { ...again.visit, weight_lbs: 39 } }));
same('a different weight on a saved day is offered as an update', heavier.results.get('b0-weight-0').changes.map((c) => `${c.from} -> ${c.to}`), ['38 lb -> 39 lb']);

// --- The same thing twice in one paste ---
const twice = run(`[${one}, ${one}]`);
same('second copy starts unticked', items(twice.drafts).filter((it) => it.block === 1 && it.type !== 'event').map((it) => it.include), [false, false, false, false]);
items(twice.drafts).find((it) => it.key === 'b1-dose-0').include = true;
check('ticking both copies is an error', /also in block 1/.test(messages(I.checkDrafts(twice.drafts, seed, TODAY), 'b1-dose-0')));

// --- Mistakes and warnings ---
const odd = run(JSON.stringify({
  dog: 'Sunny',
  visit: { date: '2026-11-06', weight_lbs: 83, vitals: { temp: 99 } },
  doses: [
    { name: 'Lyme', date_given: '2026-11-20' },
    { name: 'Rabies', date_given: '2026-11-06', next_due: '2026-11-01' },
    { name: 'Heartgard Plus', date_given: '2026-11-07' },
  ],
}));
check('temperature 99 gets a "check this"', /unusual/.test(messages(odd.results, 'b0-event-0')));
check('83 lb a week after 38 lb gets a "check this"', /big change from 38 lb/.test(messages(odd.results, 'b0-weight-0')));
check('a future date is refused', /can't be in the future/.test(messages(odd.results, 'b0-dose-0')));
check('next due before given is refused', /can't be before/.test(messages(odd.results, 'b0-dose-1')));
check('a dose a few days from a saved one gets a "check this"',
  /isn't the same dose/.test(messages(run(JSON.stringify({ dog: 'Sunny', doses: [{ name: 'Heartgard', date_given: '2026-10-06' }] })).results, 'b0-dose-0')));
check('an unknown dog must be picked', /isn't one of the dogs/.test(messages(run('{"dog": "Buddy", "notes": "x"}').results, 'block-0')));
check('boxes the app has no place for are listed',
  /weight_kg: 17/.test(messages(run('{"dog": "Sunny", "notes": "x", "weight_kg": 17}').results, 'block-0')));

// --- Changing the visit date moves the dates that matched it ---
const moved = run(JSON.stringify({ ...newVisit(), visit: { ...newVisit().visit, date: '2025-11-06' },
  doses: [{ name: 'Heartgard Plus', date_given: '2025-11-06' }], ids: [{ kind: 'rabies_tag', value: 'TEST-TAG' }] }));
const block = moved.drafts[0];
block.items[0].fields.date = '2026-11-06';
same('moving the visit date moves the dose and weight', I.moveVisitDate(block, '2025-11-06', '2026-11-06').map((c) => c.key), ['b0-weight-0', 'b0-dose-0']);
for (const it of block.items) I.fillAutoFields(it, block, seed);
same('...and the next due and tag date follow', [block.items[2].fields.next_due, block.items[3].fields.issued_on], ['2026-12-06', '2026-11-06']);

// --- The request for Claude ---
const request = I.claudeRequest(seed);
check('request names both dogs and the app\'s vaccines', ['Sunny', 'Chomper Kelce', 'Heartgard Plus', 'Leptospirosis 4-way'].every((w) => request.includes(w)));
check('request holds no real ID numbers', seed.identifiers.every((x) => !request.includes(x.value)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

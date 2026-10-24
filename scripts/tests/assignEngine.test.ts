// Run with: npx tsx scripts/tests/assignEngine.test.ts  (no database)
import { inScope, isPlaceholderCounselor, needsReview, normLocation, resolveAssignment, ruleIsLive, ruleProblems, type CounselorInfo, type Rule } from '../../src/lib/assignEngine';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-10-24T10:00:00Z');
const C = (...xs: [string, string, boolean?][]) => new Map<string, CounselorInfo>(xs.map(([k, name, active]) => [k, { name, active: active !== false }]));
const counselors = C(['abraham', 'MR Abraham'], ['robert', 'MR ROBERT'], ['lydia', 'mrs Lydia'], ['paul', 'Mr Paul'], ['tomo', 'Tomo'], ['gone', 'Mr Gone', false]);
let n = 0;
const R = (o: Partial<Rule> & Pick<Rule, 'scope' | 'counselor_key'>): Rule => ({ id: `r${++n}`, workspace: 'uk', kind: 'application', school_key: null, location_key: null, role: 'primary', active: true, paused_until: null, ...o });
const school = (key: string, counselor_key: string, extra: Partial<Rule> = {}) => R({ scope: 'school', school_key: key, school_name: key.toUpperCase(), counselor_key, ...extra });
const country = (counselor_key: string, extra: Partial<Rule> = {}) => R({ scope: 'country', counselor_key, ...extra });
const place = (key: string, counselor_key: string, extra: Partial<Rule> = {}) => R({ scope: 'location', location_key: key, location_name: key, counselor_key, ...extra });
const app = (o: Partial<{ workspace: string; school: string | null; city: string | null }> = {}) => ({ workspace: 'uk', school: 'Canterbury Christ Church University (CCCU)', city: 'Lagos', ...o });
const d = (rules: Rule[], a = app(), cs = counselors, kind: 'application' | 'documents' = 'application') => resolveAssignment(rules, a, cs, { kind, now: NOW });

// ---- the priority: school, then destination, then location, then the queue ----
{
  const rules = [school('cccu', 'abraham'), country('robert'), place('lagos', 'lydia')];
  let r: any = d(rules); eq([r.kind, r.counselor_key, r.level], ['assigned', 'abraham', 'school'], 'school rule beats country and location');
  ok(/CCCU/.test(r.reason) && /school rule/.test(r.reason), 'reason names the school and the kind of rule: ' + r.reason);
  r = d(rules, app({ school: 'Regent College London (RCL)' })); eq([r.counselor_key, r.level], ['robert', 'country'], 'no school rule: the destination rule');
  ok(/no school rule applied/.test(r.reason), 'reason says no school rule applied: ' + r.reason);
  r = d([school('cccu', 'abraham'), place('lagos', 'lydia')], app({ school: 'BPP University' })); eq([r.counselor_key, r.level], ['lydia', 'location'], 'no school or country rule: the location rule');
  ok(/no school or destination rule applied/.test(r.reason), 'reason: ' + r.reason);
  r = d([school('cccu', 'abraham')], app({ school: 'BPP University', city: 'Abuja' })); eq(r.kind, 'queue', 'nothing applies: the queue'); ok(/No assignment rule/.test(r.reason), 'queue reason: ' + r.reason);
  eq(d([]).kind, 'queue', 'no rules at all: the queue');
}

// ---- school matching understands the portal's school names ----
{
  const rules = [school('rcl', 'robert')];
  for (const s of ['Regent College London (RCL)', 'RCL', 'regent college london']) eq((d(rules, app({ school: s })) as any).counselor_key, 'robert', `"${s}" is Regent`);
  eq(d(rules, app({ school: null })).kind, 'queue', 'an application with no school does not match a school rule');
  eq(d(rules, app({ school: 'Some Other College' })).kind, 'queue', 'a different school does not match');
}

// ---- a school not in the code: any school, any destination ----
{
  const rules = [R({ workspace: 'jp', scope: 'country', counselor_key: 'tomo' }), R({ workspace: 'jp', scope: 'school', school_key: 'waseda', school_name: 'Waseda', counselor_key: 'paul' })];
  eq((d(rules, { workspace: 'jp', school: 'Waseda University', city: 'Osaka' }) as any).counselor_key, 'tomo' === 'tomo' ? 'tomo' : '', 'a school-name that is not a known key falls to the destination rule');
  eq((d(rules, { workspace: 'jp', school: 'Waseda', city: 'Osaka' }) as any).counselor_key, 'paul', 'a school key made from an unknown school works with no code change');
  eq((d(rules, { workspace: 'jp', school: 'Keio', city: 'Tokyo' }) as any).counselor_key, 'tomo', 'a new destination routes to its own counselor');
  eq(d(rules, app()).kind, 'queue', 'rules of one destination never apply to another');
  ok((d(rules, { workspace: 'jp', school: 'Keio', city: null }) as any).reason.includes('destination rule'), 'reason names the destination rule');
}

// ---- primaries, backups, conflicts ----
{
  let r: any = d([school('cccu', 'abraham'), school('cccu', 'robert', { role: 'backup' })]); eq([r.counselor_key, r.role], ['abraham', 'primary'], 'primary beats backup');
  r = d([school('cccu', 'abraham', { paused_until: '2026-11-01' }), school('cccu', 'robert', { role: 'backup' })]); eq([r.counselor_key, r.role], ['robert', 'backup'], 'primary paused: the backup takes it');
  ok(/backup for CCCU/.test(r.reason) && /unavailable/.test(r.reason), 'reason says why the backup: ' + r.reason);
  r = d([school('cccu', 'abraham', { paused_until: '2026-10-25' })]); eq(r.kind, 'queue', 'paused until tomorrow and nobody else: queue');
  r = d([school('cccu', 'abraham', { paused_until: '2026-10-24' })]); eq(r.kind, 'assigned', 'paused until today: back on today');
  r = d([school('cccu', 'abraham', { paused_until: '2026-10-23' })]); eq(r.kind, 'assigned', 'paused until yesterday: live again');
  r = d([school('cccu', 'abraham', { active: false }), country('lydia')]); eq([r.counselor_key, r.level], ['lydia', 'country'], 'a switched-off school rule falls through to the destination');
  ok(/skipped/.test(r.reason), 'the reason says the school rule was skipped: ' + r.reason);
  r = d([school('cccu', 'gone'), country('lydia')]); eq(r.counselor_key, 'lydia', 'a counselor who is switched off is skipped');
  r = d([school('cccu', 'nobody-known'), country('lydia')]); eq(r.counselor_key, 'lydia', 'a rule for a counselor the portal does not know is skipped');
  r = d([school('cccu', 'abraham'), school('cccu', 'robert')]); eq(r.kind, 'conflict', 'two primaries: a conflict, not a random pick');
  eq(r.candidates.map((c: any) => c.counselor_key).sort(), ['abraham', 'robert'], 'the conflict lists both');
  r = d([school('cccu', 'abraham'), school('cccu', 'abraham', { role: 'backup' })]); eq(r.kind, 'assigned', 'the same counselor twice is not a conflict');
  r = d([school('cccu', 'abraham', { role: 'backup' }), school('cccu', 'robert', { role: 'backup' })]); eq(r.kind, 'conflict', 'two backups and no primary: a conflict');
  r = d([school('cccu', 'abraham'), school('cccu', 'robert'), country('lydia')]); eq(r.kind, 'conflict', 'a conflict at the school level is not quietly settled by the country rule');
  r = d([country('abraham'), country('robert')]); eq([r.kind, r.level], ['conflict', 'country'], 'two destination primaries conflict too');
}

// ---- documents are a separate responsibility ----
{
  const rules = [school('cccu', 'abraham'), school('cccu', 'paul', { kind: 'documents' }), school('rcl', 'paul', { kind: 'documents' })];
  eq((d(rules) as any).counselor_key, 'abraham', 'the application owner ignores document rules');
  eq((d(rules, app(), counselors, 'documents') as any).counselor_key, 'paul', 'documents go to the documents counselor');
  eq((d(rules, app({ school: 'Regent College London (RCL)' }), counselors, 'documents') as any).counselor_key, 'paul', 'one counselor can handle documents for several schools');
  ok(/receives documents for/.test((d(rules, app(), counselors, 'documents') as any).reason), 'documents reason wording');
  eq(d(rules, app({ school: 'BPP University' }), counselors, 'documents').kind, 'queue', 'no documents rule: nobody');
}

// ---- locations ----
{
  eq(['Lagos', 'LAGOS', 'lagos state', ' Lagos. ', 'Lagos City'].map(normLocation), ['lagos', 'lagos', 'lagos', 'lagos', 'lagos'], 'location spellings that are the same place');
  eq(normLocation(null), '', 'no city, no location');
  const rules = [place('lagos', 'lydia')];
  for (const c of ['Lagos', 'LAGOS', 'lagos state']) eq((d(rules, app({ city: c })) as any).counselor_key, 'lydia', `${c} matches the Lagos rule`);
  eq(d(rules, app({ city: 'Abuja' })).kind, 'queue', 'a different city does not match');
  eq(d(rules, app({ city: null })).kind, 'queue', 'no city, no match');
}

// ---- helpers ----
ok(['', null, 'None', 'N/A', "I don't have a counselor yet", 'i dont have a counselor', 'No counselor', '-'].every(isPlaceholderCounselor), 'placeholders are not owners');
ok(!['MR Abraham', 'Peaceable', 'Ms Cherish'].some(isPlaceholderCounselor), 'real names are owners');
ok(ruleIsLive(school('a', 'abraham'), NOW) && !ruleIsLive(school('a', 'abraham', { active: false }), NOW) && !ruleIsLive(school('a', 'abraham', { paused_until: '2026-12-01' }), NOW), 'rule on/off/paused');

// ---- problems an admin sees ----
{
  const rules = [school('cccu', 'abraham'), school('cccu', 'robert'), school('rcl', 'lydia', { role: 'backup' }), school('bpp', 'gone'), school('york', 'ghost'), school('lse', 'paul', { paused_until: '2026-12-01' })];
  const p = ruleProblems(rules, counselors, NOW);
  ok(p.some((x) => x.level === 'conflict' && /both primary for CCCU/.test(x.text)), 'duplicate primaries reported');
  ok(p.some((x) => /backup .* but no primary/.test(x.text)), 'backup without primary reported');
  ok(p.some((x) => /switched off as a counselor/.test(x.text)), 'inactive counselor reported');
  ok(p.some((x) => /not a counselor in the portal/.test(x.text)), 'unknown counselor reported');
  ok(p.some((x) => x.level === 'info' && /paused until 2026-12-01/.test(x.text)), 'paused rule reported');
  eq(ruleProblems([school('cccu', 'abraham'), school('cccu', 'robert', { role: 'backup' })], counselors, NOW), [], 'a clean primary + backup has no problems');
}

// ---- who needs a second look ----
{
  const rules = [school('cccu', 'abraham')];
  const a = (counselor: string | null) => ({ ...app(), counselor });
  eq(needsReview(rules, a('MR Abraham'), counselors, NOW).review, null, 'the right counselor: fine');
  const w = needsReview(rules, a('MR ROBERT'), counselors, NOW); eq([w.review, w.expected], ['wrong-counselor', 'MR Abraham'], 'a different counselor than the rules say: flagged, with who was expected');
  eq(needsReview(rules, a('Mr Gone'), counselors, NOW).review, 'counselor-unavailable', 'a counselor switched off: flagged');
  eq(needsReview(rules, a('Someone New'), counselors, NOW).review, 'counselor-unavailable', 'a name the portal does not know: flagged');
  eq(needsReview(rules, a("I don't have a counselor yet"), counselors, NOW).review, 'queue', 'the form placeholder counts as unassigned');
  eq(needsReview([], a('MR ROBERT'), counselors, NOW).review, null, 'no rules, nothing to compare with');
}

// ---- head scopes ----
{
  const s = [{ workspace: 'uk', scope: 'school' as const, school_key: 'cccu', location_key: null }, { workspace: 'uk', scope: 'location' as const, school_key: null, location_key: 'abuja' }, { workspace: 'jp', scope: 'country' as const, school_key: null, location_key: null }];
  ok(inScope(s, app()), 'a school scope covers its school'); ok(!inScope(s, app({ school: 'Regent College London (RCL)', city: 'Lagos' })), 'and not another school');
  ok(inScope(s, app({ school: 'Regent College London (RCL)', city: 'ABUJA' })), 'a location scope covers the place whatever the spelling');
  ok(inScope(s, { workspace: 'jp', school: 'Keio', city: 'Tokyo' }), 'a destination scope covers everything in it'); ok(!inScope(s, { workspace: 'ca', school: 'Keio', city: 'Tokyo' }), 'but only in that destination');
  ok(!inScope([], app()), 'no scope, no access');
}

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

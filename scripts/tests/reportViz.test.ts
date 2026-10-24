// Run with: npx tsx scripts/tests/reportViz.test.ts  (pure: no database)
import { addDays, buildCalendar, buildFlow, buildInsights, buildPace, buildPortfolios, buildQuiet, buildViz, buildWeekly, daysBetween, mondayOf, phaseOf, previousRange, scopeFacts, stageTracks, weekdayOf } from '../../src/lib/vizData';
import { compact, niceTicks, sankeyLayout, smoothPath } from '../../src/lib/vizLayout';
import type { App, Facts } from '../../src/lib/funnel';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-10-24T12:00:00Z');
const app = (id: string, o: Partial<App> = {}): App => ({ application_id: id, workspace: 'uk', status: 'Submitted', counselor: 'MR Abraham', school: 'Canterbury Christ Church University (CCCU)', day: '2026-10-20', source: null, lastActivity: '2026-10-23T10:00:00Z', ...o });
const facts = (apps: App[], extra: Partial<Facts> = {}): Facts => ({ apps, leads: [], firstOffer: new Map(), firstEnrolled: new Map(), timeline: new Map(), ...extra });

// ---- phases ----
eq(['New Lead', 'Offer Received', 'Interview Passed', 'CAS Request', 'CAS Received', 'Visa Applied', 'Enrolled', 'Rejected', 'Withdrawn', null, 'Something new'].map(phaseOf), ['start', 'offer', 'offer', 'cas', 'cas', 'visa', 'enrolled', 'closed', 'closed', 'start', 'start'], 'every status lands in the right phase; unknown and none are getting started');

// ---- dates ----
eq([weekdayOf('2026-10-19'), weekdayOf('2026-10-25'), mondayOf('2026-10-25'), addDays('2026-10-31', 1), daysBetween('2026-10-01', '2026-10-24')], [0, 6, '2026-10-19', '2026-11-01', 23], 'Monday-first weeks and day arithmetic');
eq(previousRange({ from: '2026-10-01', to: '2026-10-30' }), { from: '2026-09-01', to: '2026-09-30' }, 'the previous period is the same number of days straight before');

// ---- calendar ----
{
  const days = new Map([['2026-10-20', 3], ['2026-10-21', 5], ['2026-10-27', 2]]);
  const c = buildCalendar(days, { from: '2026-10-14', to: '2026-10-28' });
  eq([c.weeks.length, c.weeks[0].start, c.weeks[0].cells.length], [3, '2026-10-12', 7], 'weeks start on the Monday on or before the first day');
  eq([c.weeks[0].cells[0], c.weeks[0].cells[2]?.day, c.weeks[2].cells[4]], [null, '2026-10-14', null], 'days outside the period are empty slots');
  eq([c.total, c.max, c.busiest, c.weekday], [10, 5, { day: '2026-10-21', n: 5 }, [0, 5, 5, 0, 0, 0, 0]], 'totals, peak, busiest day and the weekday profile');
  ok(c.months.length >= 1 && c.months[0].label === 'Oct', 'month labels sit above the first week of each month');
  const empty = buildCalendar(new Map(), { from: '2026-10-01', to: '2026-10-07' });
  eq([empty.max, empty.busiest, empty.total], [0, null, 0], 'an empty period has no peak');
}

// ---- weekly columns by university ----
{
  const rows = [['2026-10-19', 'cccu', 'CCCU'], ['2026-10-20', 'cccu', 'CCCU'], ['2026-10-21', 'rcl', 'RCL'], ['2026-10-28', 'rcl', 'RCL'], ['2026-10-29', 'zzz', 'Zed'], ['2026-10-30', 'yyy', 'Why']].map(([day, key, label]) => ({ day, key, label }));
  const w = buildWeekly(rows, { from: '2026-10-19', to: '2026-11-01' }, ['rcl', 'cccu', 'bpp', 'ysj', 'zzz', 'yyy']);
  eq(w.groups.map((g) => [g.key, g.slot, g.total]), [['rcl', 1, 2], ['cccu', 2, 2], ['__other', 0, 2]], 'the first four by all-time rank keep their own colour slot; the rest become Other');
  eq([w.weeks.length, w.weeks[0].by, w.weeks[1].by, w.max], [2, [1, 2, 0], [1, 0, 2], 3], 'each week splits across the groups');
  const w2 = buildWeekly(rows.filter((r) => r.key === 'cccu'), { from: '2026-10-19', to: '2026-11-01' }, ['rcl', 'cccu']);
  eq(w2.groups.map((g) => [g.key, g.slot]), [['cccu', 2]], 'a filter that hides universities does not repaint the survivors');
}

// ---- journey ----
{
  const apps = [...Array.from({ length: 9 }, (_, i) => app(`a${i}`, { school: i < 5 ? 'Regent College London (RCL)' : i < 8 ? 'BPP University' : 'York St John University', status: i % 3 === 0 ? 'Offer Received' : 'Submitted' })), app('z1', { school: 'Leeds Trinity University' })];
  const key = (a: App) => ({ id: a.school || '?', label: a.school || '?' });
  const f = buildFlow(apps, 'school', key, 3);
  eq(f.left.map((l) => l.label), ['Regent College London (RCL)', 'BPP University', 'Everyone else'], 'only the biggest groups get their own bar, the rest are folded');
  eq(f.links.reduce((s, l) => s + l.n, 0), 10, 'every application is counted exactly once');
  ok(f.links.every((l) => ['Submitted', 'Offer Received'].includes(l.to)), 'links end at the exact status the application is in now');
  eq(f.right.map((r) => [r.id, r.phase]), [['Submitted', 'start'], ['Offer Received', 'offer']], 'the right side lists only the statuses in use, in pipeline order, each with its phase');
  eq(buildFlow([app('n1', { status: null }), app('n2', { status: 'Odd new status' }), app('n3', { status: 'Enrolled' })], 'school', () => ({ id: 'x', label: 'x' })).right.map((r) => r.id), ['(none)', 'Enrolled', 'Odd new status'], 'no status comes first and an unknown status goes last, never dropped');
}

// ---- sankey geometry ----
{
  const links = [{ from: 'a', to: 'x', n: 6 }, { from: 'a', to: 'y', n: 2 }, { from: 'b', to: 'x', n: 1 }, { from: 'b', to: 'z', n: 1 }, { from: 'c', to: 'y', n: 0 }];
  const s = sankeyLayout({ left: ['a', 'b', 'c'], right: ['x', 'y', 'z'], links, width: 600, height: 300 });
  eq(s.nodes.map((n) => n.id), ['a', 'b', 'x', 'y', 'z'], 'a node with nothing flowing through it is left out');
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  ok(s.nodes.every((n) => n.y >= -0.1 && n.y + n.h <= 300.3), 'every node stays inside the picture');
  const thick = (id: string, side: 'from' | 'to') => s.ribbons.filter((r) => r[side] === id).reduce((t, r) => t + r.h, 0);
  ok(Math.abs(thick('a', 'from') - 8 * s.k) < 0.5 && thick('a', 'from') <= byId.get('a')!.h + 0.2, 'ribbons leaving a node add up to its height');
  ok(Math.abs(thick('x', 'to') - 7 * s.k) < 0.5, 'ribbons arriving at a node add up to its height');
  const col = (side: 'l' | 'r') => s.nodes.filter((n) => n.side === side).sort((p, q) => p.y - q.y);
  ok(col('l').every((n, i, a) => i === 0 || n.y >= a[i - 1].y + a[i - 1].h), 'nodes in a column never overlap');
  ok(col('r').every((n, i, a) => i === 0 || n.y >= a[i - 1].y + a[i - 1].h), 'nodes in the other column never overlap either');
  ok(s.ribbons.every((r) => /^M[\d.]+,[\d.]+ C.* Z$/.test(r.d) && !/NaN/.test(r.d)), 'ribbon paths are well-formed');
  const tiny = sankeyLayout({ left: ['a', 'b'], right: ['x'], links: [{ from: 'a', to: 'x', n: 500 }, { from: 'b', to: 'x', n: 1 }], width: 400, height: 120 });
  ok(tiny.nodes.every((n) => n.h >= 3) && tiny.nodes.every((n) => n.y + n.h <= 120.5), 'a tiny group still gets a visible bar without pushing the rest out');
  eq(sankeyLayout({ left: ['a'], right: ['x'], links: [], width: 100, height: 100 }).nodes, [], 'no links, nothing drawn');
}

// ---- portfolios and quiet ----
{
  const apps = [app('1'), app('2', { status: 'Enrolled' }), app('3', { counselor: "I don't have a counselor yet" }), app('4', { counselor: 'mr abraham', lastActivity: '2026-09-01T00:00:00Z' }), app('5', { counselor: 'mrs Lydia', status: 'Rejected' })];
  const p = buildPortfolios(apps, NOW);
  eq(p.map((x) => [x.label, x.total, x.active, x.quiet]), [['MR Abraham', 3, 2, 1], ['mrs Lydia', 1, 0, 0], ['Not assigned yet', 1, 1, 0]], 'counselors are merged by normalised name, the unassigned come last, finished ones are not active');
  eq([p[0].byPhase.start, p[0].byPhase.enrolled], [2, 1], 'each portfolio splits by phase');
  const many = buildPortfolios(Array.from({ length: 20 }, (_, i) => app(`m${i}`, { counselor: `Counselor ${i}` })), NOW, 5);
  eq([many.length, many.at(-1)!.label, many.reduce((s, x) => s + x.total, 0)], [5, 'Everyone else', 20], 'a long tail is folded into one row without losing anyone');
  const q = buildQuiet(apps, NOW);
  eq([q.active, q.quiet, q.buckets.filter((b) => b.hot).reduce((s, b) => s + b.n, 0), q.buckets.reduce((s, b) => s + b.n, 0)], [3, 1, 1, 3], 'quiet buckets cover every active application; a week or more is the hot part');
}

// ---- pace ----
{
  const apps = [app('p1', { day: '2026-09-01' }), app('p2', { day: '2026-09-01' }), app('p3', { day: '2026-09-01' }), app('p4')];
  const at = (iso: string) => Date.parse(iso);
  const f = facts(apps, { firstOffer: new Map([['p1', at('2026-09-04T10:00:00Z')], ['p2', at('2026-09-20T10:00:00Z')], ['p4', at('2026-10-01T00:00:00Z')]]), firstEnrolled: new Map([['p1', at('2026-10-01T00:00:00Z')]]) });
  const p = buildPace(apps, f);
  eq([p.toOffer.n, p.toOffer.median, p.toOffer.buckets.map((b) => b.n)], [2, 11, [1, 0, 1, 0, 0]], 'days to the first offer, only for applications with a recorded change (an offer before the application date is ignored)');
  eq([p.toEnrolled.n, p.toEnrolled.median], [1, 30], 'days to enrolment');
}

// ---- the whole report ----
{
  const mk = (n: number, day: string, o: Partial<App> = {}) => Array.from({ length: n }, (_, i) => app(`${day}-${i}-${o.school || ''}${o.workspace || ''}`, { day, ...o }));
  const apps = [...mk(6, '2026-10-20'), ...mk(4, '2026-10-21', { school: 'Regent College London (RCL)', status: 'Offer Received' }), ...mk(3, '2026-10-05', { status: 'Enrolled' }), ...mk(5, '2026-09-20'), ...mk(2, '2026-10-22', { workspace: 'jp', school: 'Waseda' })];
  const spaces = [{ key: 'uk', name: 'UK' }, { key: 'jp', name: 'Japan' }];
  const all = buildViz({ facts: facts(apps), spaces, range: { from: '2026-10-01', to: '2026-10-24' }, ws: 'all', now: NOW, headHref: '/head' });
  eq([all.hero.value, all.hero.prev, all.hero.delta], [15, 5, 200], 'hero number, the same period before, and the change');
  eq(all.phases.map((p) => p.n), [8, 4, 0, 0, 3, 0], 'where the cohort is now, phase by phase');
  const uk = buildViz({ facts: facts(apps), spaces, range: { from: '2026-10-01', to: '2026-10-24' }, ws: 'uk', now: NOW });
  eq(uk.hero.value, 13, 'one country shows only its own applications');
  ok(scopeFacts(facts(apps), 'jp').apps.every((a) => a.workspace === 'jp'), 'scopeFacts keeps only that country');
  eq(all.flows.map((f) => f.key), ['school', 'counselor'], 'the source view only appears once at least two sources are recorded');
  const withSrc = buildViz({ facts: facts(apps.map((a, i) => ({ ...a, source: i % 2 ? 'Instagram' : 'Referral' }))), spaces, range: { from: '2026-10-01', to: '2026-10-24' }, ws: 'all', now: NOW });
  eq(withSrc.flows.map((f) => f.key), ['school', 'counselor', 'source'], '...and then it does');
  ok(all.calendar.total === all.hero.value, 'the calendar counts the same applications as the hero number');
  ok(all.weekly.weeks.reduce((s, w) => s + w.total, 0) === all.hero.value, 'so do the weekly columns');
  ok(all.flows.every((f) => f.links.reduce((s, l) => s + l.n, 0) === all.hero.value), 'and the journey');
  ok(all.insights.length >= 2 && all.insights.length <= 6, 'a handful of sentences, not a wall');
  ok(all.insights.some((i) => /up 200%/.test(i.text)), 'the change on the previous period is written out');
  const none = buildViz({ facts: facts([]), spaces, range: { from: '2026-10-01', to: '2026-10-24' }, ws: 'all', now: NOW });
  eq([none.hero.value, none.hero.delta, none.insights.length], [0, null, 1], 'an empty period says so instead of inventing numbers');
  // small samples stay quiet
  const small = buildInsights({ ...none, hero: { value: 3, prev: 1, delta: null, spark: [] }, calendar: { ...none.calendar, weekday: [3, 0, 0, 0, 0, 0, 0] }, quiet: { buckets: [], active: 3, quiet: 0, median: 1 } } as never, null);
  ok(small.every((i) => !/busiest day|brings the most/.test(i.text)), 'no "pattern" sentence is written from three applications');
}

// ---- stage tracks ----
{
  const board = { schools: [{ key: 'rcl', name: 'Regent College London', stages: [{ key: 'docs', name: 'Documents', conditional: false }, { key: 'tb', name: 'TB test', conditional: true }, { key: 'visa', name: 'Visa', conditional: false }], cards: [{ id: 'a', stageKey: 'docs', delayed: 3 }, { id: 'b', stageKey: 'docs', delayed: 0 }, { id: 'c', stageKey: null, delayed: 0 }, { id: 'd', stageKey: 'visa', delayed: 0 }] }, { key: 'x', name: 'Empty', stages: [], cards: [{ id: 'q', stageKey: null, delayed: 0 }] }] };
  const t = stageTracks([{ workspace: 'uk', board }], new Set(['a', 'b', 'c', 'd']));
  eq(t.length, 1, 'a university with nobody from this cohort is left out');
  eq([t[0].stages.map((s) => s.key), t[0].total, t[0].late, t[0].unplaced], [['docs', 'visa'], 4, 1, 1], 'unused conditional stages are hidden; late and unplaced are counted');
}

// ---- small helpers ----
eq([compact(950), compact(1284), compact(12900), compact(2000)], ['950', '1.3K', '13K', '2K'], 'compact numbers');
eq(niceTicks(7), [0, 2, 4, 6, 8], 'axis ticks are clean numbers'); eq(niceTicks(0), [0, 1], 'an empty axis still has ticks');
ok(/^M1,2 C/.test(smoothPath([[1, 2], [5, 4], [9, 3]])) && !/NaN/.test(smoothPath([[1, 2], [5, 4], [9, 3]])), 'sparkline path');

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

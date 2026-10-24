// Turns the applications, chats and recorded status changes into the shapes the report charts draw. Pure: no database, no DOM, no clock
// unless `now` is passed, so every number on the Reports page can be tested and reproduced.
//
// Everything is about one cohort: the applications that STARTED in the chosen period (and the chats started in it), followed to where they are now.
import { FINAL_STATUSES, PROGRESS, STALE_DAYS } from './constants';
import { counselorKey, schoolKey, schoolShort } from './docs';
import { isPlaceholderCounselor } from './assignEngine';
import { funnelFrom, type App, type Facts, type Funnel } from './funnelCore';

const DAY = 864e5;
export type Range = { from: string; to: string };

// ---------- phases: the road an application travels ----------
export type PhaseKey = 'start' | 'offer' | 'cas' | 'visa' | 'enrolled' | 'closed';
export const PHASES: { key: PhaseKey; label: string; hint: string }[] = [
  { key: 'start', label: 'Getting started', hint: 'New, documents, submitted, CF gotten' },
  { key: 'offer', label: 'Offer stage', hint: 'Offer, interview, unconditional offer' },
  { key: 'cas', label: 'CAS', hint: 'CAS requested, applied or received' },
  { key: 'visa', label: 'Visa', hint: 'Visa applied' },
  { key: 'enrolled', label: 'Enrolled', hint: 'Enrolled' },
  { key: 'closed', label: 'Closed', hint: 'Rejected or withdrawn' },
];
const PHASE_OF: Record<string, PhaseKey> = {
  'New Lead': 'start', 'Documents Requested': 'start', 'Submitted': 'start', 'CF Gotten': 'start',
  'Offer Received': 'offer', 'Interview Taken': 'offer', 'Interview Passed': 'offer', 'Unconditional Offer': 'offer',
  'Awaiting CAS': 'cas', 'CAS Request': 'cas', 'CAS Applied': 'cas', 'CAS Received': 'cas',
  'Visa Applied': 'visa', 'Enrolled': 'enrolled', 'Rejected': 'closed', 'Withdrawn': 'closed',
};
/** An application with no status yet has not started its road, so it counts as getting started. */
export const phaseOf = (status: string | null | undefined): PhaseKey => PHASE_OF[status || ''] ?? 'start';
const isFinal = (s: string | null) => !!s && FINAL_STATUSES.includes(s);

// ---------- dates (all UTC, Monday first) ----------
const t0 = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoDay(t0(iso) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((t0(b) - t0(a)) / DAY);
export const weekdayOf = (iso: string) => (new Date(t0(iso)).getUTCDay() + 6) % 7;
export const mondayOf = (iso: string) => addDays(iso, -weekdayOf(iso));
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTH = (iso: string) => new Date(t0(iso)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
export const prettyDay = (iso: string) => new Date(t0(iso)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** The same number of days immediately before this period, for "compared with before". */
export function previousRange(r: Range): Range {
  const len = daysBetween(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- the calendar heat map ----------
export type CalCell = { day: string; n: number } | null;
export type Calendar = { weeks: { start: string; cells: CalCell[] }[]; max: number; total: number; weekday: number[]; busiest: { day: string; n: number } | null; months: { label: string; week: number }[] };

/** One column per week (Monday to Sunday), one row per weekday; days outside the period are empty slots so the grid stays rectangular. */
export function buildCalendar(days: Map<string, number>, range: Range): Calendar {
  const weeks: Calendar['weeks'] = [];
  let max = 0, total = 0, busiest: Calendar['busiest'] = null;
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  for (let start = mondayOf(range.from); start <= range.to && weeks.length < 60; start = addDays(start, 7)) {
    const cells: CalCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      if (day < range.from || day > range.to) { cells.push(null); continue; }
      const n = days.get(day) || 0;
      cells.push({ day, n }); total += n; weekday[i] += n;
      if (n > max) max = n;
      if (n > 0 && (!busiest || n > busiest.n)) busiest = { day, n };
    }
    weeks.push({ start, cells });
  }
  const months: Calendar['months'] = [];
  let last = '';
  weeks.forEach((w, i) => { const first = w.cells.find(Boolean); if (!first) return; const m = first.day.slice(0, 7); if (m !== last) { months.push({ label: MONTH(first.day), week: i }); last = m; } });
  return { weeks, max, total, weekday, busiest, months };
}

// ---------- weekly columns, split by university ----------
export type WeeklyGroup = { key: string; label: string; slot: number; total: number };
export type Weekly = { weeks: { start: string; total: number; by: number[] }[]; groups: WeeklyGroup[]; max: number };

/**
 * `rank` is every university in the viewer's scope ordered by all-time volume, so a university keeps its colour whatever period or country is shown.
 * The first four get their own colour, the rest are one grey "Other".
 */
export function buildWeekly(apps: { day: string; key: string; label: string }[], range: Range, rank: string[], slots = 4): Weekly {
  const top = rank.slice(0, slots);
  const names = new Map(apps.map((a) => [a.key, a.label]));
  const present = top.filter((k) => apps.some((a) => a.key === k));
  const hasOther = apps.some((a) => !top.includes(a.key));
  const groups: WeeklyGroup[] = [...present.map((k) => ({ key: k, label: names.get(k) || k, slot: top.indexOf(k) + 1, total: 0 })), ...(hasOther ? [{ key: '__other', label: 'Other', slot: 0, total: 0 }] : [])];
  const idx = new Map(groups.map((g, i) => [g.key, i]));
  const weeks: Weekly['weeks'] = [];
  for (let start = mondayOf(range.from); start <= range.to && weeks.length < 60; start = addDays(start, 7)) weeks.push({ start, total: 0, by: groups.map(() => 0) });
  const col = new Map(weeks.map((w, i) => [w.start, i]));
  for (const a of apps) {
    if (!inRange(a.day, range)) continue;
    const w = weeks[col.get(mondayOf(a.day))!], g = idx.get(top.includes(a.key) ? a.key : '__other');
    if (!w || g === undefined) continue;
    w.by[g]++; w.total++; groups[g].total++;
  }
  return { weeks, groups, max: Math.max(0, ...weeks.map((w) => w.total)) };
}

// ---------- the journey: who goes where ----------
/** The order statuses are shown in, top to bottom, on the right of the journey. Unknown ones follow the known ones. */
export const STATUS_ORDER = ['(none)', 'New Lead', 'Documents Requested', 'Submitted', 'CF Gotten', 'Offer Received', 'Interview Taken', 'Interview Passed', 'Unconditional Offer', 'Awaiting CAS', 'CAS Request', 'CAS Applied', 'CAS Received', 'Visa Applied', 'Enrolled', 'Rejected', 'Withdrawn'];
export const statusId = (s: string | null | undefined) => (s && s.trim() ? s.trim() : '(none)');
export const statusLabel = (id: string) => (id === '(none)' ? 'No status yet' : id);

export type FlowKey = 'school' | 'counselor' | 'source';
export type Flow = { key: FlowKey; label: string; left: { id: string; label: string }[]; right: { id: string; label: string; phase: PhaseKey }[]; links: { from: string; to: string; n: number }[]; total: number };

/** Groups the cohort by one dimension (at most `max` groups, the rest folded into "Everyone else") and counts which status each group's applications are in now. */
export function buildFlow(apps: App[], key: FlowKey, id: (a: App) => { id: string; label: string }, max = 7): Flow {
  const groups = new Map<string, { id: string; label: string; n: number }>();
  for (const a of apps) { const g = id(a), cur = groups.get(g.id); if (cur) cur.n++; else groups.set(g.id, { ...g, n: 1 }); }
  const ordered = [...groups.values()].sort((x, y) => y.n - x.n || x.label.localeCompare(y.label));
  const keep = ordered.slice(0, ordered.length > max ? max - 1 : max), keepIds = new Set(keep.map((g) => g.id));
  const left = [...keep.map((g) => ({ id: g.id, label: g.label })), ...(ordered.length > max ? [{ id: '__rest', label: 'Everyone else' }] : [])];
  const counts = new Map<string, number>(), seen = new Set<string>();
  for (const a of apps) { const gid = keepIds.has(id(a).id) ? id(a).id : '__rest', st = statusId(a.status), k = `${gid}\u0000${st}`; seen.add(st); counts.set(k, (counts.get(k) || 0) + 1); }
  const links = [...counts].map(([k, n]) => { const [from, to] = k.split('\u0000'); return { from, to, n }; });
  const rank = (st: string) => { const i = STATUS_ORDER.indexOf(st); return i < 0 ? STATUS_ORDER.length : i; };
  const right = [...seen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((st) => ({ id: st, label: statusLabel(st), phase: phaseOf(st === '(none)' ? null : st) }));
  const label = key === 'school' ? 'University' : key === 'counselor' ? 'Counselor' : 'Where they heard about us';
  return { key, label, left, right, links, total: apps.length };
}

// ---------- counselor portfolios ----------
export type Portfolio = { key: string; label: string; byPhase: Record<PhaseKey, number>; total: number; active: number; quiet: number };
export function buildPortfolios(apps: App[], now: number, max = 12): Portfolio[] {
  const by = new Map<string, Portfolio>();
  for (const a of apps) {
    const unassigned = isPlaceholderCounselor(a.counselor), key = unassigned ? '(unassigned)' : counselorKey(a.counselor);
    const p = by.get(key) || by.set(key, { key, label: unassigned ? 'Not assigned yet' : (a.counselor || '').trim(), byPhase: { start: 0, offer: 0, cas: 0, visa: 0, enrolled: 0, closed: 0 }, total: 0, active: 0, quiet: 0 }).get(key)!;
    p.byPhase[phaseOf(a.status)]++; p.total++;
    if (!isFinal(a.status)) { p.active++; if (quietDays(a, now) >= STALE_DAYS) p.quiet++; }
  }
  const list = [...by.values()].sort((a, b) => Number(a.key === '(unassigned)') - Number(b.key === '(unassigned)') || b.active - a.active || b.total - a.total || a.label.localeCompare(b.label));
  if (list.length <= max) return list;
  const rest = list.slice(max - 1), merged: Portfolio = { key: '__rest', label: 'Everyone else', byPhase: { start: 0, offer: 0, cas: 0, visa: 0, enrolled: 0, closed: 0 }, total: 0, active: 0, quiet: 0 };
  for (const p of rest) { merged.total += p.total; merged.active += p.active; merged.quiet += p.quiet; (Object.keys(p.byPhase) as PhaseKey[]).forEach((k) => (merged.byPhase[k] += p.byPhase[k])); }
  return [...list.slice(0, max - 1), merged];
}

// ---------- how long things sit ----------
/** Whole days since anything happened on the application (or since it was submitted, when nothing has). */
export function quietDays(a: App, now: number): number {
  const last = a.lastActivity ? Date.parse(a.lastActivity) : t0(a.day);
  return Math.max(0, Math.floor((now - (Number.isFinite(last) ? last : t0(a.day))) / DAY));
}
export type Bucket = { label: string; n: number; hot: boolean };
const QUIET_EDGES: [string, number, number][] = [['Today or yesterday', 0, 1], ['3 to 6 days', 2, 6], ['1 to 2 weeks', 7, 13], ['2 to 4 weeks', 14, 29], ['A month or more', 30, Infinity]];
/** Active applications by how long since anything happened. From a week up is "quiet" (STALE_DAYS) and is the part to look at. */
export function buildQuiet(apps: App[], now: number): { buckets: Bucket[]; active: number; quiet: number; median: number | null } {
  const active = apps.filter((a) => !isFinal(a.status)), days = active.map((a) => quietDays(a, now));
  return {
    buckets: QUIET_EDGES.map(([label, lo, hi]) => ({ label, n: days.filter((d) => d >= lo && d <= hi).length, hot: lo >= STALE_DAYS })),
    active: active.length, quiet: days.filter((d) => d >= STALE_DAYS).length, median: median(days),
  };
}

/** Days from application to first offer / to enrolment, for the ones whose status changes were recorded. */
export function buildPace(apps: App[], f: Facts) {
  const toOffer: number[] = [], toEnrolled: number[] = [];
  for (const a of apps) {
    const start = t0(a.day), o = f.firstOffer.get(a.application_id), e = f.firstEnrolled.get(a.application_id);
    if (o !== undefined && o >= start) toOffer.push(Math.round((o - start) / DAY));
    if (e !== undefined && e >= start) toEnrolled.push(Math.round((e - start) / DAY));
  }
  const edges: [string, number, number][] = [['Within a week', 0, 7], ['1 to 2 weeks', 8, 14], ['2 to 4 weeks', 15, 30], ['1 to 2 months', 31, 60], ['Over 2 months', 61, Infinity]];
  const bin = (xs: number[]) => edges.map(([label, lo, hi]) => ({ label, n: xs.filter((d) => d >= lo && d <= hi).length }));
  return { toOffer: { n: toOffer.length, median: median(toOffer), buckets: bin(toOffer) }, toEnrolled: { n: toEnrolled.length, median: median(toEnrolled), buckets: bin(toEnrolled) } };
}

/** Average days an application sat in each status before moving on, from the recorded changes (the slowest is the bottleneck). */
export function buildDwell(apps: App[], f: Facts) {
  const acc = new Map<string, number[]>();
  for (const a of apps) {
    const line = f.timeline.get(a.application_id) || [];
    for (let i = 0; i < line.length - 1; i++) { const d = (line[i + 1].at - line[i].at) / DAY; if (d >= 0) (acc.get(line[i].to) || acc.set(line[i].to, []).get(line[i].to)!).push(d); }
  }
  const order = [...Object.keys(PROGRESS), 'Awaiting CAS', 'CAS Request'];
  return order.filter((s) => acc.has(s)).map((s) => { const v = acc.get(s)!; return { label: s, avg: Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10, n: v.length }; });
}

// ---------- the whole report ----------
export type Insight = { tone: 'good' | 'watch' | 'info'; icon: string; text: string; href?: string };
export type Tile = { key: string; label: string; value: number; sub?: string; tone?: 'good' | 'watch' | 'info'; href?: string };
export type Viz = {
  range: Range; prev: Range; days: number;
  hero: { value: number; prev: number; delta: number | null; spark: number[] };
  tiles: Tile[]; insights: Insight[];
  funnel: Funnel; phases: { key: PhaseKey; label: string; hint: string; n: number }[];
  calendar: Calendar; weekly: Weekly; flows: Flow[];
  portfolios: Portfolio[]; quiet: ReturnType<typeof buildQuiet>; pace: ReturnType<typeof buildPace>; dwell: ReturnType<typeof buildDwell>;
  cohortIds: string[]; waiting: number;
};

/** Everything for the viewer's countries, narrowed to one with `ws` (or "all"). */
export function scopeFacts(f: Facts, ws: string): Facts {
  if (ws === 'all') return f;
  return { ...f, apps: f.apps.filter((a) => a.workspace === ws), leads: f.leads.filter((l) => l.workspace === ws) };
}

export function buildViz(o: { facts: Facts; spaces: { key: string; name: string }[]; range: Range; ws: string; now?: number; headHref?: string | null }): Viz {
  const now = o.now ?? Date.now(), facts = scopeFacts(o.facts, o.ws), prev = previousRange(o.range);
  const keys = o.ws === 'all' ? o.spaces.map((s) => s.key) : [o.ws];
  const cohort = facts.apps.filter((a) => inRange(a.day, o.range)), before = facts.apps.filter((a) => inRange(a.day, prev));
  const funnel = funnelFrom(facts, o.spaces, o.range, keys);

  const days = new Map<string, number>();
  cohort.forEach((a) => days.set(a.day, (days.get(a.day) || 0) + 1));
  const calendar = buildCalendar(days, o.range);

  // universities by all-time volume in scope, so a colour never moves when the period changes
  const volume = new Map<string, number>(), label = new Map<string, string>();
  for (const a of facts.apps) { const k = schoolKey(a.school) || 'unknown'; volume.set(k, (volume.get(k) || 0) + 1); if (!label.has(k)) label.set(k, schoolShort(a.school) || 'No school set'); }
  const rank = [...volume].filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);   // students with no school fold into Other
  const school = (a: App) => { const k = schoolKey(a.school) || 'unknown'; return { id: k, label: label.get(k) || 'No school set' }; };
  const weekly = buildWeekly(cohort.map((a) => ({ day: a.day, key: school(a).id, label: school(a).label })), o.range, rank);

  const recorded = cohort.filter((a) => a.source);
  const flows: Flow[] = [
    buildFlow(cohort, 'school', school),
    buildFlow(cohort, 'counselor', (a) => (isPlaceholderCounselor(a.counselor) ? { id: '(unassigned)', label: 'Not assigned yet' } : { id: counselorKey(a.counselor), label: (a.counselor || '').trim() })),
    ...(new Set(recorded.map((a) => a.source)).size >= 2 ? [buildFlow(cohort, 'source', (a) => ({ id: a.source || '(not recorded)', label: a.source || 'Not recorded' }))] : []),
  ];

  const phaseCount = new Map<PhaseKey, number>();
  cohort.forEach((a) => phaseCount.set(phaseOf(a.status), (phaseCount.get(phaseOf(a.status)) || 0) + 1));
  const phases = PHASES.map((p) => ({ ...p, n: phaseCount.get(p.key) || 0 }));
  const quiet = buildQuiet(cohort, now), active = cohort.filter((a) => !isFinal(a.status));
  const waiting = active.filter((a) => isPlaceholderCounselor(a.counselor)).length;
  const weekSpark = calendar.weeks.map((w) => w.cells.reduce((s, c) => s + (c ? c.n : 0), 0));
  const delta = before.length >= 5 ? Math.round(((cohort.length - before.length) / before.length) * 100) : null;

  const tiles: Tile[] = [
    { key: 'active', label: 'Still active', value: active.length, sub: cohort.length ? `${pct(active.length, cohort.length)}% of applications` : undefined },
    { key: 'offers', label: 'Reached an offer', value: funnel.total.offers, sub: cohort.length ? `${pct(funnel.total.offers, cohort.length)}% of applications` : undefined, tone: 'good' },
    { key: 'enrolled', label: 'Enrolled', value: funnel.total.enrolled, sub: cohort.length ? `${pct(funnel.total.enrolled, cohort.length)}% of applications` : undefined, tone: 'good' },
    { key: 'quiet', label: `Quiet ${STALE_DAYS}+ days`, value: quiet.quiet, sub: quiet.active ? `of ${quiet.active} active applications` : undefined, tone: quiet.quiet ? 'watch' : 'info', href: o.headHref ? `${o.headHref}?show=quiet` : undefined },
    { key: 'waiting', label: 'Waiting for a counselor', value: waiting, sub: waiting ? 'Open the Team Head page' : 'Everyone has one', tone: waiting ? 'watch' : 'good', href: waiting && o.headHref ? o.headHref : undefined },
  ];

  const v: Viz = {
    range: o.range, prev, days: daysBetween(o.range.from, o.range.to) + 1,
    hero: { value: cohort.length, prev: before.length, delta, spark: weekSpark },
    tiles, insights: [], funnel, phases, calendar, weekly, flows,
    portfolios: buildPortfolios(cohort, now), quiet, pace: buildPace(cohort, facts), dwell: buildDwell(cohort, facts),
    cohortIds: cohort.map((a) => a.application_id), waiting,
  };
  v.insights = buildInsights(v, o.headHref ?? null);
  return v;
}

// ---------- the story in words ----------
/** A few plain sentences for the top of the page. Each one is only written when there is enough behind it to say it. */
export function buildInsights(v: Viz, headHref: string | null): Insight[] {
  const out: Insight[] = [], total = v.hero.value;
  if (!total) return [{ tone: 'info', icon: 'spark', text: 'No applications started in this period. Try a longer one.' }];
  if (v.hero.delta !== null) out.push({ tone: v.hero.delta >= 0 ? 'good' : 'watch', icon: 'trend', text: `${total} application${total === 1 ? '' : 's'} started: ${v.hero.delta >= 0 ? 'up' : 'down'} ${Math.abs(v.hero.delta)}% on the ${v.days} days before (${v.hero.prev}).` });
  const top = v.calendar.weekday.reduce((b, n, i) => (n > v.calendar.weekday[b] ? i : b), 0);
  if (total >= 20 && v.calendar.weekday[top] / total >= 0.25) out.push({ tone: 'info', icon: 'clock', text: `${WEEKDAYS[top]}s are the busiest day: ${pct(v.calendar.weekday[top], total)}% of applications arrive then.` });
  if (v.calendar.busiest && v.calendar.busiest.n >= 5) out.push({ tone: 'info', icon: 'spark', text: `The single busiest day was ${prettyDay(v.calendar.busiest.day)} with ${v.calendar.busiest.n} applications.` });
  const big = [...v.weekly.groups].filter((g) => g.slot > 0).sort((a, b) => b.total - a.total)[0];
  if (big && total >= 10 && v.weekly.groups.length >= 2) out.push({ tone: 'info', icon: 'graduation', text: `${big.label} brings the most: ${pct(big.total, total)}% of applications.` });
  if (total >= 10) out.push({ tone: v.funnel.total.offers ? 'good' : 'info', icon: 'check-circle', text: `${v.funnel.total.offers} of ${total} (${pct(v.funnel.total.offers, total)}%) have reached an offer${v.funnel.total.enrolled ? ` and ${v.funnel.total.enrolled} enrolled` : ''}.` });
  if (v.quiet.quiet > 0) out.push({ tone: 'watch', icon: 'clock', text: `${v.quiet.quiet} active application${v.quiet.quiet === 1 ? ' has' : 's have'} had nothing happen for ${STALE_DAYS}+ days.`, href: headHref ? `${headHref}?show=quiet` : undefined });
  if (v.waiting > 0) out.push({ tone: 'watch', icon: 'alert', text: `${v.waiting} application${v.waiting === 1 ? ' is' : 's are'} still waiting for a counselor.`, href: headHref || undefined });
  const src = v.flows.find((f) => f.key === 'source');
  if (src) { const best = src.left.map((l) => ({ l, n: src.links.filter((k) => k.from === l.id).reduce((s, k) => s + k.n, 0) })).sort((a, b) => b.n - a.n)[0]; if (best && best.l.id !== '(not recorded)' && best.n / total >= 0.3) out.push({ tone: 'info', icon: 'globe', text: `${best.l.label} is the biggest source: ${pct(best.n, total)}% of applications.` }); }
  return out.slice(0, 6);
}

// ---------- stage tracks (from the school workflows) ----------
export type Track = { id: string; school: string; workspace: string; stages: { key: string; name: string; n: number; late: number }[]; total: number; late: number; unplaced: number };
type BoardLike = { schools: { key: string; name: string; stages: { key: string; name: string; conditional: boolean }[]; cards: { id: string; stageKey: string | null; delayed: number }[] }[] };

/** For each university with a workflow: how many of the cohort sit at each stage and how many are past the time that stage allows. */
export function stageTracks(boards: { workspace: string; board: BoardLike }[], cohort: Set<string>): Track[] {
  const out: Track[] = [];
  for (const { workspace, board } of boards) {
    for (const s of board.schools) {
      const cards = s.cards.filter((c) => cohort.has(c.id));
      if (!cards.length) continue;
      const stages = s.stages.map((st) => { const here = cards.filter((c) => c.stageKey === st.key); return { key: st.key, name: st.name, n: here.length, late: here.filter((c) => c.delayed > 0).length, conditional: st.conditional }; })
        .filter((st) => !st.conditional || st.n > 0).map(({ conditional: _c, ...st }) => st);
      out.push({ id: `${workspace}:${s.key}`, school: s.name, workspace, stages, total: cards.length, late: stages.reduce((n, st) => n + st.late, 0), unplaced: cards.filter((c) => !c.stageKey).length });
    }
  }
  return out.sort((a, b) => b.total - a.total || a.school.localeCompare(b.school));
}

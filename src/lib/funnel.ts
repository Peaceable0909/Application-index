import { admin } from './supabase';
import { FINAL_STATUSES, PROGRESS } from './constants';
import { counselorKey } from './docs';
import { listWorkspaces } from './workspace';
import type { Range } from './reports';

const DAY = 864e5;

/** Statuses that mean "has an offer, or is further along". Rejected / Withdrawn are decided from the history instead. */
export const OFFER_STATUSES: string[] = [...Object.keys(PROGRESS).filter((s) => PROGRESS[s] >= PROGRESS['Offer Received']), 'Awaiting CAS', 'CAS Request'];
const atOrPastOffer = (s: string | null | undefined) => !!s && OFFER_STATUSES.includes(s);

type App = { application_id: string; workspace: string; status: string | null; counselor: string | null; day: string };
type Lead = { id: string; workspace: string; status: string; converted_app: string | null; day: string };
type Facts = { apps: App[]; leads: Lead[]; firstOffer: Map<string, number>; firstEnrolled: Map<string, number> };

async function pages<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await q(from, from + 999);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Everything the funnel needs for these workspaces, read once: students, chats, and the first time each student reached an offer / enrolled. */
async function loadFacts(keys: string[]): Promise<Facts> {
  const db = admin();
  if (!keys.length) return { apps: [], leads: [], firstOffer: new Map(), firstEnrolled: new Map() };
  const [apps, leads, events] = await Promise.all([
    pages<{ application_id: string; workspace: string; status: string | null; counselor: string | null; submitted_at: string | null; created_at: string }>((a, b) => db.from('portal_applications').select('application_id, workspace, status, counselor, submitted_at, created_at').in('workspace', keys).order('application_id').range(a, b)),
    pages<{ id: string; workspace: string; status: string; converted_app: string | null; created_at: string }>((a, b) => db.from('portal_leads').select('id, workspace, status, converted_app, created_at').in('workspace', keys).order('id').range(a, b)),
    pages<{ application_id: string; detail: { to?: string } | null; created_at: string }>((a, b) => db.from('portal_activity').select('application_id, detail, created_at, portal_applications!inner(workspace)').eq('kind', 'status_change').in('portal_applications.workspace', keys).order('id').range(a, b)),
  ]);
  const firstOffer = new Map<string, number>(), firstEnrolled = new Map<string, number>();
  for (const e of events) {
    const to = e.detail?.to, t = Date.parse(e.created_at);
    if (!to || !Number.isFinite(t)) continue;
    if (OFFER_STATUSES.includes(to) && t < (firstOffer.get(e.application_id) ?? Infinity)) firstOffer.set(e.application_id, t);
    if (to === 'Enrolled' && t < (firstEnrolled.get(e.application_id) ?? Infinity)) firstEnrolled.set(e.application_id, t);
  }
  return {
    apps: apps.map((a) => ({ application_id: a.application_id, workspace: a.workspace, status: a.status, counselor: a.counselor, day: (a.submitted_at || a.created_at).slice(0, 10) })),
    leads: leads.map((l) => ({ id: l.id, workspace: l.workspace, status: l.status, converted_app: l.converted_app, day: l.created_at.slice(0, 10) })),
    firstOffer, firstEnrolled,
  };
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

// ---- from chat to enrolment (students who started in a period, followed to where they are now) ----
export type Line = { chats: number; fromChats: number; students: number; offers: number; enrolled: number };
export type Funnel = {
  range: Range; total: Line;
  byWorkspace: ({ key: string; name: string } & Line)[];
  byCounselor: { label: string; students: number; offers: number; enrolled: number }[];
};

export async function buildFunnel(range: Range, keys: string[]): Promise<Funnel> {
  const [f, spaces] = await Promise.all([loadFacts(keys), listWorkspaces()]);
  return funnelFrom(f, spaces, range, keys);
}

function funnelFrom(f: Facts, spaces: { key: string; name: string }[], range: Range, keys: string[]): Funnel {
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const apps = f.apps.filter((a) => inRange(a.day)), leads = f.leads.filter((l) => inRange(l.day));
  const offered = (a: App) => atOrPastOffer(a.status) || f.firstOffer.has(a.application_id);
  const enrolled = (a: App) => a.status === 'Enrolled' || f.firstEnrolled.has(a.application_id);
  const line = (as: App[], ls: Lead[]): Line => ({ chats: ls.length, fromChats: ls.filter((l) => l.status === 'converted' || !!l.converted_app).length, students: as.length, offers: as.filter(offered).length, enrolled: as.filter(enrolled).length });
  const names = new Map(spaces.map((w) => [w.key, w.name]));
  const byCounselor = new Map<string, { label: string; students: number; offers: number; enrolled: number }>();
  for (const a of apps) {
    const k = counselorKey(a.counselor) || '(unassigned)';
    const c = byCounselor.get(k) || byCounselor.set(k, { label: a.counselor?.trim() || '(unassigned)', students: 0, offers: 0, enrolled: 0 }).get(k)!;
    c.students++; if (offered(a)) c.offers++; if (enrolled(a)) c.enrolled++;
  }
  return {
    range, total: line(apps, leads),
    byWorkspace: keys.map((k) => ({ key: k, name: names.get(k) || k, ...line(apps.filter((a) => a.workspace === k), leads.filter((l) => l.workspace === k)) })),
    byCounselor: [...byCounselor.values()].sort((a, b) => b.students - a.students),
  };
}

const cell = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function funnelCsv(f: Funnel, kind: string): string {
  const rows: (string | number)[][] = kind === 'funnel_counselor'
    ? [['Counselor', 'Students', 'Reached an offer', 'Enrolled', 'Offer rate %', 'Enrolment rate %'], ...f.byCounselor.map((c) => [c.label, c.students, c.offers, c.enrolled, pct(c.offers, c.students), pct(c.enrolled, c.students)])]
    : [['Country', 'Chats started', 'Chats that became students', 'Chat conversion %', 'Applications', 'Reached an offer', 'Enrolled', 'Offer rate %', 'Enrolment rate %'], ...f.byWorkspace.map((w) => [w.name, w.chats, w.fromChats, pct(w.fromChats, w.chats), w.students, w.offers, w.enrolled, pct(w.offers, w.students), pct(w.enrolled, w.students)])];
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

// ---- the week (what happened in the last 7 days, next to the 7 before) ----
export type Week = { chats: number; students: number; offers: number; enrolled: number };
export type Weekly = {
  now: string; thisWeek: Week; lastWeek: Week; active: number;
  byWorkspace: ({ key: string; name: string; thisWeek: Week; lastWeek: Week; active: number })[];
  recent: Funnel;
};

export async function buildWeekly(keys: string[], now = new Date()): Promise<Weekly> {
  const [f, spaces] = await Promise.all([loadFacts(keys), listWorkspaces()]);
  const t1 = now.getTime(), t0 = t1 - 7 * DAY, tp = t1 - 14 * DAY;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const week = (key: string | null, from: number, to: number): Week => {
    const mine = (w: string) => key === null || w === key;
    const within = (ms: number) => ms >= from && ms < to;
    const dayIn = (d: string) => d >= day(from) && d < day(to);
    const ids = new Set(f.apps.filter((a) => mine(a.workspace)).map((a) => a.application_id));
    return {
      chats: f.leads.filter((l) => mine(l.workspace) && dayIn(l.day)).length,
      students: f.apps.filter((a) => mine(a.workspace) && dayIn(a.day)).length,
      offers: [...f.firstOffer].filter(([id, ms]) => ids.has(id) && within(ms)).length,
      enrolled: [...f.firstEnrolled].filter(([id, ms]) => ids.has(id) && within(ms)).length,
    };
  };
  const activeIn = (key: string | null) => f.apps.filter((a) => (key === null || a.workspace === key) && !(a.status && FINAL_STATUSES.includes(a.status))).length;
  const names = new Map(spaces.map((w) => [w.key, w.name]));
  const since = new Date(t1 - 90 * DAY);
  return {
    now: now.toISOString(), thisWeek: week(null, t0, t1 + 1), lastWeek: week(null, tp, t0), active: activeIn(null),
    byWorkspace: keys.map((k) => ({ key: k, name: names.get(k) || k, thisWeek: week(k, t0, t1 + 1), lastWeek: week(k, tp, t0), active: activeIn(k) })),
    recent: funnelFrom(f, spaces, { from: since.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }, keys),
  };
}

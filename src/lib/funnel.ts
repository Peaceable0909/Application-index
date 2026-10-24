import { admin } from './supabase';
import { FINAL_STATUSES, OFFER_STATUSES } from './constants';
import { listWorkspaces } from './workspace';
import { funnelFrom, pct, type App, type Facts, type Funnel, type Lead, type Range } from './funnelCore';
export { funnelFrom, pct };
export type { App, Facts, Funnel, Lead, Line } from './funnelCore';

const DAY = 864e5;

export { OFFER_STATUSES };


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
export async function loadFacts(keys: string[]): Promise<Facts> {
  const db = admin();
  if (!keys.length) return { apps: [], leads: [], firstOffer: new Map(), firstEnrolled: new Map(), timeline: new Map() };
  const [apps, leads, events] = await Promise.all([
    pages<{ application_id: string; workspace: string; status: string | null; counselor: string | null; school: string | null; submitted_at: string | null; created_at: string; source: string | null; last_activity_at: string | null }>((a, b) => db.from('portal_applications').select('application_id, workspace, status, counselor, school, submitted_at, created_at, source, last_activity_at').in('workspace', keys).order('application_id').range(a, b)),
    pages<{ id: string; workspace: string; status: string; converted_app: string | null; created_at: string; source: string | null }>((a, b) => db.from('portal_leads').select('id, workspace, status, converted_app, created_at, source').in('workspace', keys).order('id').range(a, b)),
    pages<{ application_id: string; detail: { to?: string } | null; created_at: string }>((a, b) => db.from('portal_activity').select('application_id, detail, created_at, portal_applications!inner(workspace)').eq('kind', 'status_change').in('portal_applications.workspace', keys).order('id').range(a, b)),
  ]);
  const firstOffer = new Map<string, number>(), firstEnrolled = new Map<string, number>(), timeline = new Map<string, { to: string; at: number }[]>();
  for (const e of events) {
    const to = e.detail?.to, t = Date.parse(e.created_at);
    if (!to || !Number.isFinite(t)) continue;
    (timeline.get(e.application_id) || timeline.set(e.application_id, []).get(e.application_id)!).push({ to, at: t });
    if (OFFER_STATUSES.includes(to) && t < (firstOffer.get(e.application_id) ?? Infinity)) firstOffer.set(e.application_id, t);
    if (to === 'Enrolled' && t < (firstEnrolled.get(e.application_id) ?? Infinity)) firstEnrolled.set(e.application_id, t);
  }
  return {
    apps: apps.map((a) => ({ application_id: a.application_id, workspace: a.workspace, status: a.status, counselor: a.counselor, school: a.school, day: (a.submitted_at || a.created_at).slice(0, 10), source: a.source, lastActivity: a.last_activity_at })),
    leads: leads.map((l) => ({ id: l.id, workspace: l.workspace, status: l.status, converted_app: l.converted_app, day: l.created_at.slice(0, 10), source: l.source })),
    firstOffer, firstEnrolled, timeline: new Map([...timeline].map(([k, v]) => [k, v.sort((a, b) => a.at - b.at)])),
  };
}


export async function buildFunnel(range: Range, keys: string[]): Promise<Funnel> {
  const [f, spaces] = await Promise.all([loadFacts(keys), listWorkspaces()]);
  return funnelFrom(f, spaces, range, keys);
}

const cell = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function funnelCsv(f: Funnel, kind: string): string {
  const rows: (string | number)[][] = kind === 'funnel_source'
    ? [['Where they heard about us', 'Chats started', 'Chats that became students', 'Applications', 'Reached an offer', 'Enrolled', 'Offer rate %', 'Enrolment rate %'], ...f.bySource.map((x) => [x.source, x.chats, x.fromChats, x.students, x.offers, x.enrolled, pct(x.offers, x.students), pct(x.enrolled, x.students)])]
    : kind === 'funnel_counselor'
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

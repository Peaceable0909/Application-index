// The numbers behind the road from chat to enrolment. Pure (no database), so the Reports page, its tests and the weekly email count the same way.
import { OFFER_STATUSES } from './constants';
import { counselorKey } from './docs';

export type Range = { from: string; to: string };
const atOrPastOffer = (s: string | null | undefined) => !!s && OFFER_STATUSES.includes(s);

export type App = { application_id: string; workspace: string; status: string | null; counselor: string | null; school: string | null; day: string; source: string | null; lastActivity: string | null };
export type Lead = { id: string; workspace: string; status: string; converted_app: string | null; day: string; source: string | null };
/** `timeline` is every recorded status change of an application, oldest first (what the pace charts measure). */
export type Facts = { apps: App[]; leads: Lead[]; firstOffer: Map<string, number>; firstEnrolled: Map<string, number>; timeline: Map<string, { to: string; at: number }[]> };
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
// ---- from chat to enrolment (students who started in a period, followed to where they are now) ----
export type Line = { chats: number; fromChats: number; students: number; offers: number; enrolled: number };
export type Funnel = {
  range: Range; total: Line;
  byWorkspace: ({ key: string; name: string } & Line)[];
  byCounselor: { label: string; students: number; offers: number; enrolled: number }[];
  bySource: ({ source: string } & Line)[];
};

export function funnelFrom(f: Facts, spaces: { key: string; name: string }[], range: Range, keys: string[]): Funnel {
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
  const NONE = '(not recorded)';
  const places = [...new Set([...apps.map((a) => a.source || NONE), ...leads.map((l) => l.source || NONE)])];
  const bySource = places.map((p) => ({ source: p, ...line(apps.filter((a) => (a.source || NONE) === p), leads.filter((l) => (l.source || NONE) === p)) }))
    .sort((a, b) => Number(a.source === NONE) - Number(b.source === NONE) || b.students + b.chats - (a.students + a.chats));
  return {
    range, total: line(apps, leads), bySource,
    byWorkspace: keys.map((k) => ({ key: k, name: names.get(k) || k, ...line(apps.filter((a) => a.workspace === k), leads.filter((l) => l.workspace === k)) })),
    byCounselor: [...byCounselor.values()].sort((a, b) => b.students - a.students),
  };
}

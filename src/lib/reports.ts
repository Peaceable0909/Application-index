import { admin } from './supabase';
import { loadStudents, type SRow } from './overview';
import { FINAL_STATUSES, PROGRESS, STATUSES } from './constants';
import { schoolShort, counselorKey } from './docs';
import { isPaid } from './requests';

const DAY = 864e5;
export type Range = { from: string; to: string };
export const defaultRange = (): Range => { const to = new Date(), from = new Date(to.getFullYear(), to.getMonth() - 11, 1); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; };
const when = (r: SRow) => (r.a.submitted_at || r.a.created_at).slice(0, 10);

export type Report = {
  range: Range; total: number; active: number; enrolled: number; rejected: number; conversion: number; paid: number; unpaid: number; complete: number; incomplete: number;
  bySchool: { label: string; total: number; enrolled: number; active: number }[];
  byCounselor: { label: string; total: number; active: number; enrolled: number; attention: number; missing: number }[];
  byMonth: { label: string; n: number }[];
  funnel: { label: string; n: number }[];
  stageDays: { label: string; avg: number; n: number }[];
};

export async function buildReport(range: Range, restrictKey?: string | null): Promise<Report> {
  const { rows: everyone } = await loadStudents();
  const rows = everyone.filter((r) => when(r) >= range.from && when(r) <= range.to && (!restrictKey || counselorKey(r.a.counselor) === restrictKey));
  const isFinal = (s: string | null) => !!s && FINAL_STATUSES.includes(s);
  const enrolled = rows.filter((r) => r.a.status === 'Enrolled').length, rejected = rows.filter((r) => r.a.status === 'Rejected' || r.a.status === 'Withdrawn').length;
  const active = rows.filter((r) => !isFinal(r.a.status));
  const group = <T,>(keyFn: (r: SRow) => string, mk: (k: string, list: SRow[]) => T) => { const m = new Map<string, SRow[]>(); rows.forEach((r) => { const k = keyFn(r); (m.get(k) || m.set(k, []).get(k)!).push(r); }); return [...m].map(([k, l]) => mk(k, l)); };

  const bySchool = group((r) => schoolShort(r.a.school) || 'Unknown', (label, l) => ({ label, total: l.length, enrolled: l.filter((r) => r.a.status === 'Enrolled').length, active: l.filter((r) => !isFinal(r.a.status)).length })).sort((a, b) => b.total - a.total);
  const byCounselor = group((r) => r.a.counselor || '(unassigned)', (label, l) => ({ label, total: l.length, active: l.filter((r) => !isFinal(r.a.status)).length, enrolled: l.filter((r) => r.a.status === 'Enrolled').length, attention: l.filter((r) => !isFinal(r.a.status) && r.reasons.length).length, missing: l.filter((r) => !isFinal(r.a.status) && r.judged && r.missing.length).length })).sort((a, b) => b.total - a.total);

  const months: string[] = []; { const d = new Date(range.from + 'T00:00:00'); d.setDate(1); const end = new Date(range.to + 'T00:00:00'); while (d <= end && months.length < 36) { months.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } }
  const mc = new Map<string, number>(); rows.forEach((r) => mc.set(when(r).slice(0, 7), (mc.get(when(r).slice(0, 7)) || 0) + 1));
  const byMonth = months.map((m) => ({ label: new Date(m + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), n: mc.get(m) || 0 }));

  const order = [...Object.keys(PROGRESS), ...STATUSES.filter((s) => !(s in PROGRESS))];
  const funnel = [...order.map((s) => ({ label: s, n: rows.filter((r) => r.a.status === s).length })), { label: '(no status)', n: rows.filter((r) => !r.a.status).length }].filter((x) => x.n > 0);

  // average days spent in each stage, from the status-change history
  const { data: ev } = await admin().from('portal_activity').select('application_id, detail, created_at').eq('kind', 'status_change').order('created_at', { ascending: true }).limit(8000);
  const ids = new Set(rows.map((r) => r.a.application_id));
  const by = new Map<string, { to: string; at: number }[]>();
  (ev || []).forEach((e) => { if (!ids.has(e.application_id)) return; const to = (e.detail as { to?: string })?.to; if (to) (by.get(e.application_id) || by.set(e.application_id, []).get(e.application_id)!).push({ to, at: new Date(e.created_at).getTime() }); });
  const acc = new Map<string, number[]>();
  by.forEach((list) => { for (let i = 0; i < list.length - 1; i++) { const d = (list[i + 1].at - list[i].at) / DAY; if (d >= 0) (acc.get(list[i].to) || acc.set(list[i].to, []).get(list[i].to)!).push(d); } });
  const stageDays = order.filter((s) => acc.has(s)).map((s) => { const a = acc.get(s)!; return { label: s, avg: Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10, n: a.length }; });

  const reg = rows.filter((r) => r.a.in_regent);
  return {
    range, total: rows.length, active: active.length, enrolled, rejected, conversion: rows.length ? Math.round((enrolled / rows.length) * 100) : 0,
    paid: reg.filter((r) => isPaid(r.a.payment)).length, unpaid: reg.filter((r) => !isPaid(r.a.payment)).length,
    complete: active.filter((r) => r.judged && !r.missing.length).length, incomplete: active.filter((r) => r.judged && r.missing.length).length,
    bySchool, byCounselor, byMonth, funnel, stageDays,
  };
}

const cell = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function reportCsv(r: Report, kind: string): string {
  const tables: Record<string, [string[], (string | number)[][]]> = {
    university: [['University', 'Students', 'Active', 'Enrolled'], r.bySchool.map((x) => [x.label, x.total, x.active, x.enrolled])],
    counselor: [['Counselor', 'Students', 'Active', 'Enrolled', 'Need attention', 'Missing documents'], r.byCounselor.map((x) => [x.label, x.total, x.active, x.enrolled, x.attention, x.missing])],
    month: [['Month', 'Applications'], r.byMonth.map((x) => [x.label, x.n])],
    stage: [['Stage', 'Students now', 'Avg days in stage', 'Moves measured'], r.funnel.map((x) => { const d = r.stageDays.find((s) => s.label === x.label); return [x.label, x.n, d ? d.avg : '', d ? d.n : '']; })],
  };
  const [head, body] = tables[kind] || tables.university;
  return '﻿' + [head, ...body].map((l) => l.map(cell).join(',')).join('\r\n');
}

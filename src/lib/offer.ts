import { admin } from './supabase';

export type Condition = { text: string; met: boolean; due?: string | null };
export type Offer = {
  application_id: string; offer_type: 'Conditional' | 'Unconditional' | null; offer_date: string | null; offer_doc_id: string | null; conditions: Condition[]; deposit_due: string | null;
  cas_status: string | null; cas_applied_date: string | null; cas_received_date: string | null; visa_status: string | null; visa_applied_date: string | null; visa_biometrics_date: string | null; visa_decision_date: string | null;
  student_note: string | null; visible_to_student: boolean; updated_by: string | null; updated_at: string;
};

export async function getOffer(applicationId: string): Promise<Offer | null> {
  const { data } = await admin().from('portal_offers').select('*').eq('application_id', applicationId).maybeSingle();
  return data ? ({ ...data, conditions: (data.conditions as Condition[]) || [] } as Offer) : null;
}

/** One row per milestone, in order, for the timeline the student (and staff) see. */
export function milestones(o: Offer | null) {
  const d = (v: string | null) => v;
  const rows: { key: string; label: string; state: 'done' | 'now' | 'todo' | 'bad'; date: string | null; detail?: string }[] = [];
  const hasOffer = !!(o?.offer_type || o?.offer_date);
  const unmet = (o?.conditions || []).filter((c) => !c.met).length;
  rows.push({ key: 'offer', label: o?.offer_type ? `${o.offer_type} offer` : 'University offer', state: hasOffer ? 'done' : 'todo', date: d(o?.offer_date ?? null) });
  if (o?.offer_type === 'Conditional' || (o?.conditions || []).length) rows.push({ key: 'cond', label: 'Offer conditions', state: unmet === 0 && (o?.conditions || []).length ? 'done' : hasOffer ? 'now' : 'todo', date: null, detail: (o?.conditions || []).length ? `${(o!.conditions).length - unmet} of ${o!.conditions.length} met` : undefined });
  if (o?.deposit_due) rows.push({ key: 'deposit', label: 'Deposit due', state: 'todo', date: o.deposit_due });
  const cas = o?.cas_status || 'Not started';
  rows.push({ key: 'cas', label: 'CAS', state: cas === 'Received' ? 'done' : cas === 'Requested' ? 'now' : 'todo', date: d(o?.cas_received_date ?? o?.cas_applied_date ?? null), detail: cas === 'Not started' ? undefined : cas });
  const visa = o?.visa_status || 'Not started';
  rows.push({ key: 'visa', label: 'Visa', state: visa === 'Approved' ? 'done' : visa === 'Refused' ? 'bad' : visa === 'Not started' ? 'todo' : 'now', date: d(o?.visa_decision_date ?? o?.visa_applied_date ?? null), detail: visa === 'Not started' ? undefined : visa });
  if (o?.visa_biometrics_date) rows.push({ key: 'bio', label: 'Biometrics appointment', state: new Date(o.visa_biometrics_date + 'T23:59:59') < new Date() ? 'done' : 'now', date: o.visa_biometrics_date });
  return rows;
}

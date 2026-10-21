'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { guardApp, requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { canonicalSource } from '@/lib/sources';

/** A team member records (or corrects) where a student first heard about WhiteRock. A person's choice is never overwritten by the sheet sync. */
export async function setLeadSource(f: FormData) {
  const staff = await requireStaff();
  const id = String(f.get('id') || ''), raw = String(f.get('source') || '').trim();
  await guardApp(staff, id);
  const source = canonicalSource(raw);
  await admin().from('portal_applications').update({ source, source_by: source ? staff.email : null }).eq('application_id', id);
  await audit(staff.email, 'source_set', id, { source });
  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${encodeURIComponent(id)}?msg=${encodeURIComponent(source ? `Saved: they heard about us through ${source}.` : 'Lead source cleared.')}`);
}

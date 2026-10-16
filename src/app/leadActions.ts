'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { workspacesFor, currentWorkspace } from '@/lib/workspace';
import { sendMail } from '@/lib/mail';
import { site } from '@/lib/emailTemplate';
import { findEmail, findPhone } from '@/lib/leads';

const txt = (f: FormData, k: string) => String(f.get(k) || '').trim();
const go = (lead: string | null, msg: string, err = false) => { revalidatePath('/leads'); redirect(`/leads?${lead ? `lead=${lead}&` : ''}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`); };

async function mine(f: FormData) {
  const staff = await requireTeam();
  const id = txt(f, 'leadId');
  const { data: lead } = await admin().from('portal_leads').select('*').eq('id', id).maybeSingle();
  if (!lead || !(await workspacesFor(staff)).some((w) => w.key === lead.workspace)) return go(null, 'That lead was not found.', true) as never;
  return { staff, lead };
}

/** A person writes to the visitor. The assistant stops answering that chat from now on. */
export async function replyLead(f: FormData) {
  const { staff, lead } = await mine(f);
  const body = txt(f, 'body').slice(0, 2000);
  if (!body) return go(lead.id, 'Write a message first.', true);
  const db = admin(), now = new Date().toISOString();
  await db.from('portal_lead_msgs').insert({ lead_id: lead.id, from_lead: false, by_ai: false, sender: staff.email, body });
  await db.from('portal_leads').update({ ai_paused: true, needs_human: false, status: lead.status === 'new' ? 'contacted' : lead.status, last_message_at: now, staff_read_at: now }).eq('id', lead.id);
  let sent = '';
  if (lead.email) {
    try { await sendMail({ to: lead.email, subject: 'A reply from WhiteRock', body, replyTo: staff.email, eyebrow: 'Message', title: 'A reply to your question', greeting: `Hi ${(lead.name || '').split(/\s+/)[0] || 'there'},`, cta: { label: 'Continue the chat', href: `${site()}/hello/${lead.workspace}` } }); sent = ` Also emailed to ${lead.email}.`; }
    catch { sent = ' (The email could not be sent.)'; }
  }
  go(lead.id, `Sent.${sent}`);
}

/** Fix or add the details the assistant picked up. */
export async function saveLeadDetails(f: FormData) {
  const { lead } = await mine(f);
  const name = txt(f, 'name').slice(0, 80) || null, email = txt(f, 'email').toLowerCase() || null, phone = txt(f, 'phone').slice(0, 30) || null, interest = txt(f, 'interest').slice(0, 200) || null;
  if (email && !findEmail(email)) return go(lead.id, 'That email doesn’t look right.', true);
  if (phone && !findPhone(phone)) return go(lead.id, 'That phone number doesn’t look right.', true);
  await admin().from('portal_leads').update({ name, email, phone, interest }).eq('id', lead.id);
  go(lead.id, 'Saved.');
}

export async function setLeadStatus(f: FormData) {
  const { lead } = await mine(f);
  const status = txt(f, 'status');
  if (!['new', 'contacted', 'closed'].includes(status)) return go(lead.id, 'Pick a status.', true);
  await admin().from('portal_leads').update({ status }).eq('id', lead.id);
  go(lead.id, 'Status updated.');
}

export async function toggleLeadAi(f: FormData) {
  const { lead } = await mine(f);
  await admin().from('portal_leads').update({ ai_paused: !lead.ai_paused }).eq('id', lead.id);
  go(lead.id, lead.ai_paused ? 'The assistant is answering this chat again.' : 'The assistant is paused for this chat. Only people reply now.');
}

export async function deleteLead(f: FormData) {
  const { staff, lead } = await mine(f);
  if (staff.role !== 'admin') return go(lead.id, 'Only admins can delete a chat.', true);
  await admin().from('portal_leads').delete().eq('id', lead.id);
  await audit(staff.email, 'lead_deleted', lead.id);
  go(null, 'Chat deleted.');
}

/** Admins: opens or closes the public chat for this country. It starts closed. */
export async function setLeadChatOpen(f: FormData) {
  const staff = await requireTeam();
  if (staff.role !== 'admin') return go(null, 'Only admins can change this.', true);
  const on = txt(f, 'on') === '1', ws = await currentWorkspace();
  await admin().from('portal_workspaces').update({ lead_chat: on }).eq('key', ws);
  await audit(staff.email, on ? 'lead_chat_on' : 'lead_chat_off', ws);
  go(null, on ? 'The new-student chat is open. Share the link below.' : 'The new-student chat is closed.');
}

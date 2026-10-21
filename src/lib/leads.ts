import { createHmac, randomBytes } from 'node:crypto';
import { admin } from './supabase';
import { generateOnce, generateText } from './ai';
import { relevantPassages } from './brainDocs';
import { brainEnabled } from './brain';
import { sendPush } from './push';
import { sendMail, signFor } from './mail';
import { site } from './emailTemplate';
import { requiredDocs } from './workspace';
import { runLeadTurn, type LeadIO, type LeadRow, type Handover } from './leadEngine';
import { FIELDS, FIELD_LABEL, type Profile } from './leadProfile';

// The new-student chat: people who are not in the portal yet talk to an assistant that knows the country (brief, notes, uploaded files),
// answers what it can, learns about them gradually and, when a person is really needed, hands over to the team. The conversation logic is in
// leadEngine.ts; this file connects it to the database, the model and the notifications. Public, so it is rate limited, has its own daily AI
// budget, needs consent before the first message, and never sees any student's data.
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PORTAL_TOKEN || 'dev';
export const newToken = () => randomBytes(24).toString('base64url');
export const tokenHash = (t: string) => createHmac('sha256', secret()).update('lead:' + t).digest('hex');
export const ipHash = (ip: string) => createHmac('sha256', secret()).update('ip:' + ip).digest('hex').slice(0, 32);
export const cookieName = (ws: string) => `hl_${ws}`;

export const LIMITS = { perHour: 30, perLead: 200, newPerIpDay: 8, maxChars: 600 };
const LEAD_DAILY = () => Number(process.env.LEAD_DAILY_LIMIT || 150);

export type LeadMsg = { id: string; mine: boolean; body: string; at: string; ai: boolean; staff: boolean };
export const shapeLead = (rows: { id: string; from_lead: boolean; by_ai: boolean; sender: string | null; body: string; created_at: string }[]): LeadMsg[] =>
  rows.map((r) => ({ id: r.id, mine: r.from_lead, body: r.body, at: r.created_at, ai: r.by_ai, staff: !r.from_lead && !r.by_ai }));

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s().-]{7,17}\d/;
export const findEmail = (t: string) => t.match(EMAIL)?.[0].toLowerCase() || null;
export const findPhone = (t: string) => { const m = t.match(PHONE)?.[0]; return m && m.replace(/\D/g, '').length >= 8 ? m.trim() : null; };
const strip = (t: string) => t.replace(new RegExp(EMAIL.source, 'g'), '[email]').replace(new RegExp(PHONE.source, 'g'), '[number]').replace(/https?:\/\/\S+|www\.\S+/g, '[link]');

async function leadAiToday(): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await admin().from('portal_ai_usage').select('id', { count: 'exact', head: true }).eq('kind', 'lead').gte('created_at', since.toISOString());
  return count || 0;
}

export async function staffEmailsFor(ws: string): Promise<string[]> {
  const { data } = await admin().from('portal_staff').select('email, role, workspaces');
  return (data || []).filter((s) => s.role === 'admin' || (s.role !== 'counselor' && (s.workspaces || ['uk']).includes(ws))).map((s) => s.email);
}

export type { LeadRow };

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** The real connections for one chat turn. */
function realIO(): LeadIO {
  const db = admin();
  return {
    now: () => Date.now(),
    async loadConvo(leadId) {
      const { data } = await db.from('portal_lead_msgs').select('from_lead, by_ai, body, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(24);
      return (data || []).reverse();
    },
    async saveReply(leadId, body) { await db.from('portal_lead_msgs').insert({ lead_id: leadId, from_lead: false, by_ai: true, body }); },
    async updateLead(leadId, patch) { await db.from('portal_leads').update(patch).eq('id', leadId); },
    async knowledge(lead, query) {
      const [{ data: w }, { data: notes }, files, docs] = await Promise.all([
        db.from('portal_workspaces').select('name, brief').eq('key', lead.workspace).maybeSingle(),
        db.from('portal_brain_notes').select('title, body').eq('workspace', lead.workspace).eq('active', true).limit(80),
        relevantPassages(lead.workspace, undefined, query),
        requiredDocs(lead.workspace).catch(() => [] as string[]),
      ]);
      const parts: string[] = [];
      if (w?.brief) parts.push(`Country brief:\n${w.brief}`);
      if (notes?.length) parts.push('Notes from our team:\n' + notes.map((n) => `- ${n.title}: ${clip(n.body, 2600)}`).join('\n'));
      if (files.length) parts.push('Excerpts from our documents:\n' + files.map((f) => `- (${f.source}) ${f.excerpt}`).join('\n'));
      if (docs.length) parts.push(`Documents our team normally collects for an application: ${docs.join(', ')}.`);
      return { country: w?.name || 'a country we serve', text: clip(parts.join('\n\n'), 16000) };
    },
    aiEnabled: () => brainEnabled(),
    budgetLeft: async () => (await leadAiToday()) < LEAD_DAILY(),
    reply: (system, messages) => generateText({ kind: 'lead', system, messages, maxTokens: 450, temperature: 0.5 }),
    extract: async (system, user) => {
      try { return await generateOnce<Record<string, unknown>>({ kind: 'lead_x', system, user, maxTokens: 450, temperature: 0.1, validate: (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null) }); }
      catch { return null; }
    },
    async notifyHandover(lead, profile, summary, recent): Promise<Handover> {
      const emails = await staffEmailsFor(lead.workspace);
      const who = profile.name || lead.name || 'A visitor', link = `${site()}/leads?lead=${lead.id}`;
      const facts = FIELDS.filter((f) => profile[f]).map((f) => `${FIELD_LABEL[f]}: ${profile[f]}`);
      const body = [`${who} asked to speak to a counsellor.`, '', ...facts, ...(summary ? ['', `What the assistant understood: ${summary}`] : []), '', 'Their latest messages:', ...recent.map((m) => `- ${clip(m, 300)}`), '', `Open the chat: ${link}`].join('\n');
      const sign = await signFor(null, 'WhiteRock Educational Services');
      const [push, mails] = await Promise.all([
        sendPush({ emails, title: 'A chat visitor wants a counsellor', body: clip(`${who}${lead.interest ? ` · ${lead.interest}` : ''}`, 120), url: `/leads?lead=${lead.id}`, tag: `lead-${lead.id}`, calmMs: 600_000 }).catch(() => ({ sent: 0 })),
        Promise.allSettled(emails.slice(0, 8).map((to) => sendMail({
          to, subject: `New chat enquiry: ${who}`, body, eyebrow: 'New student enquiry', title: `${who} wants to speak to a counsellor`, sign,
          blocks: [{ type: 'list', items: facts.length ? facts : ['No details were collected yet.'] }, ...(summary ? [{ type: 'p' as const, text: summary }] : []), { type: 'quote', from: 'Latest messages', text: recent.map((m) => clip(m, 300)).join('\n') }],
          cta: { label: 'Open the chat', href: link },
        }))),
      ]);
      const emailSent = mails.filter((r) => r.status === 'fulfilled').length;
      return { delivered: push.sent > 0 || emailSent > 0, pushSent: push.sent, emailSent };
    },
    async notifyContact(lead, profile: Profile) {
      const emails = await staffEmailsFor(lead.workspace);
      await sendPush({ emails, title: 'New lead shared contact details', body: `${profile.name || lead.name || 'A visitor'} on the new-student chat`, url: `/leads?lead=${lead.id}`, tag: `lead-${lead.id}`, skipIfActiveMs: 30_000, calmMs: 3600_000 }).catch(() => ({ sent: 0 }));
    },
    async recordGap(workspace, leadId, question) {
      const q = question.replace(/\s+/g, ' ').trim().slice(0, 200);
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await db.from('portal_chat_gaps').select('id').eq('workspace', workspace).eq('resolved', false).ilike('question', q.replace(/[\\%_]/g, '\\$&')).gte('created_at', since).limit(1);
      if (!data?.length) await db.from('portal_chat_gaps').insert({ workspace, question: q, lead_id: leadId });
    },
  };
}

/** Writes the assistant's next message for a lead and updates what we know about them. */
export async function leadTurn(lead: LeadRow): Promise<void> {
  await runLeadTurn(lead, realIO());
}

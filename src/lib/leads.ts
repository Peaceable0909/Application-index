import { createHmac, randomBytes } from 'node:crypto';
import { admin } from './supabase';
import { generateOnce, numbersWithin } from './ai';
import { relevantPassages } from './brainDocs';
import { brainEnabled } from './brain';
import { sendPush } from './push';

// The new-student chat: people who are not in the portal yet talk to an assistant that knows the country (brief, notes, uploaded files),
// answers what it can, and asks for their name and contact details so a counselor can follow up. Public, so it is rate limited,
// has its own daily AI budget, needs consent before the first message, and never sees any student's data.
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

const SYSTEM = (country: string) =>
  `You are Extravel's AI assistant, chatting with someone who is thinking about studying in: ${country}. They are not a student of ours yet. ` +
  'Use ONLY the "countryBrief", "teamNotes" and "fileExcerpts" in the JSON for facts about studying, schools, costs, requirements and deadlines. If the answer is not there, do not guess: say a counselor will confirm it, and set needsHuman to true. ' +
  'Be warm, clear and short (at most 90 words), like a helpful text message, in plain English, with at most one emoji. Ask at most one question at a time. ' +
  'Your goals: help with what they ask; learn what they want to study, where, and when, and their current qualification; and, once you have been helpful, ask once, naturally, for their name and an email or WhatsApp number so a counselor can follow up. Do not repeat back their email or number. ' +
  'If asked, say you are an AI assistant and that a counselor can take over. NEVER invent dates, fees, links, phone numbers or emails, and NEVER promise or hint at admission, an offer, a visa or any outcome. Do not give legal or immigration advice. Tell people not to share passport numbers or bank details in the chat. ' +
  'Reply as JSON: {"reply": "<message>", "needsHuman": true|false, "name": "<their name if they said it, else null>", "interest": "<short phrase: what/where/when they want to study, else null>", "summary": "<at most 400 characters: who they are, what they want, what is still open>", "needs": ["<up to 6 short things they need or asked for>"]}.';

export type LeadRow = { id: string; workspace: string; name: string | null; email: string | null; phone: string | null; interest: string | null; summary: string | null; needs: string[]; ai_paused: boolean; needs_human: boolean };

/** Writes the assistant's next message for a lead and updates what we know about them. Returns the saved messages. */
export async function leadTurn(lead: LeadRow): Promise<void> {
  const db = admin();
  const { data: rows } = await db.from('portal_lead_msgs').select('from_lead, by_ai, body, created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(20);
  const convo = (rows || []).reverse();
  const leadText = convo.filter((m) => m.from_lead).map((m) => m.body).join('\n');
  const put = async (body: string) => { await db.from('portal_lead_msgs').insert({ lead_id: lead.id, from_lead: false, by_ai: true, body }); };

  // contact details come from what they typed, never from the model
  const email = lead.email || findEmail(leadText), phone = lead.phone || findPhone(leadText);
  const gotContact = (!lead.email && !!email) || (!lead.phone && !!phone);
  const patch: Record<string, unknown> = { ...(email && !lead.email ? { email } : {}), ...(phone && !lead.phone ? { phone } : {}) };

  if (!brainEnabled() || (await leadAiToday()) >= LEAD_DAILY()) {
    await put('Thanks for your message. A counselor will get back to you soon.');
    await db.from('portal_leads').update({ ...patch, needs_human: true, last_message_at: new Date().toISOString() }).eq('id', lead.id);
    await notify(lead, 'needs a person', gotContact || !lead.needs_human);
    return;
  }

  const { data: w } = await db.from('portal_workspaces').select('name, brief').eq('key', lead.workspace).maybeSingle();
  const { data: notes } = await db.from('portal_brain_notes').select('title, body').eq('workspace', lead.workspace).eq('active', true).limit(80);
  const asked = convo.filter((m) => m.from_lead).slice(-3).map((m) => m.body).join(' ');
  const files = await relevantPassages(lead.workspace, undefined, asked);
  const userJson = JSON.stringify({
    countryBrief: w?.brief || null, teamNotes: (notes || []).map((n) => ({ topic: n.title, info: n.body })), fileExcerpts: files,
    alreadyKnown: { name: lead.name, interest: lead.interest, haveEmail: !!email, haveWhatsAppOrPhone: !!phone },
    conversation: convo.map((m) => ({ from: m.from_lead ? 'visitor' : 'assistant', text: strip(m.body).slice(0, 600) })),
  });
  const allowed = (userJson.match(/\d+/g) || []).map(Number);
  type Out = { reply: string; needsHuman: boolean; name: string | null; interest: string | null; summary: string; needs: string[] };
  let out: Out | null = null;
  try {
    out = await generateOnce<Out>({
      kind: 'lead', maxTokens: 500, system: SYSTEM(w?.name || 'a country we serve'), user: userJson,
      validate: (raw) => {
        const d = raw as Record<string, unknown>;
        if (typeof d?.reply !== 'string') return null;
        const reply = d.reply.trim();
        if (reply.length < 6 || reply.length > 800) return null;
        if (/https?:\/\/|www\.|@|\+?\d[\d\s-]{7,}/.test(reply)) return null;
        if (/guarantee|you (have been|are) (admitted|accepted)|offer (has been|is) (approved|granted)|visa (is|will be) (approved|granted)|definitely (get|receive)/i.test(reply)) return null;
        if (!numbersWithin(reply, allowed)) return null;
        const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
        const name = str(d.name, 60);
        return {
          reply, needsHuman: d.needsHuman === true,
          name: name && /^[\p{L}][\p{L} .'-]*$/u.test(name) && leadText.toLowerCase().includes(name.split(' ')[0].toLowerCase()) ? name : null,
          interest: str(d.interest, 200), summary: str(d.summary, 500) || '',
          needs: Array.isArray(d.needs) ? d.needs.filter((x): x is string => typeof x === 'string' && x.length > 2).map((x) => x.slice(0, 100)).slice(0, 6) : [],
        };
      },
    });
  } catch { out = null; }

  if (!out) {
    await put('Thanks, I’ve passed your message to a counselor and they’ll reply soon.');
    await db.from('portal_leads').update({ ...patch, needs_human: true, last_message_at: new Date().toISOString() }).eq('id', lead.id);
    await notify(lead, 'needs a person', true);
    return;
  }
  await put(out.reply);
  await db.from('portal_leads').update({
    ...patch, ...(out.name && !lead.name ? { name: out.name } : {}), ...(out.interest ? { interest: out.interest } : {}),
    summary: out.summary || lead.summary, needs: out.needs.length ? out.needs : lead.needs, needs_human: lead.needs_human || out.needsHuman, last_message_at: new Date().toISOString(),
  }).eq('id', lead.id);
  if (gotContact) await notify({ ...lead, name: out.name || lead.name }, 'shared contact details', true);
  else if (out.needsHuman && !lead.needs_human) await notify({ ...lead, name: out.name || lead.name }, 'needs a person', true);
}

async function notify(lead: LeadRow, why: string, go: boolean) {
  if (!go) return;
  try {
    const emails = await staffEmailsFor(lead.workspace);
    await sendPush({ emails, title: `New lead ${why}`, body: `${lead.name || 'A visitor'} on the new-student chat`, url: `/leads?lead=${lead.id}`, tag: `lead-${lead.id}`, skipIfActiveMs: 30_000, calmMs: 3600_000 });
  } catch { /* the Leads page shows it anyway */ }
}

import { NextResponse } from 'next/server';
import { canonicalSource } from '@/lib/sources';
import { admin } from '@/lib/supabase';
import { LIMITS, cookieName, ipHash, leadTurn, newToken, shapeLead, tokenHash, type LeadRow } from '@/lib/leads';

export const maxDuration = 30;
const no = { 'Cache-Control': 'no-store' };
const COLS = 'id, workspace, name, email, phone, interest, summary, needs, ai_paused, needs_human';

async function findLead(req: Request, ws: string) {
  // Inside the chat bubble on another website the browser may refuse our cookie, so that case sends the same secret in a header instead.
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(cookieName(ws) + '='));
  const token = (req.headers.get('x-lead-token') || '').slice(0, 200) || (m ? decodeURIComponent(m.slice(m.indexOf('=') + 1)) : '');
  if (!token) return null;
  const { data } = await admin().from('portal_leads').select(COLS).eq('token_hash', tokenHash(token)).eq('workspace', ws).maybeSingle();
  return (data as LeadRow | null) || null;
}
async function open(ws: string) {
  const { data } = await admin().from('portal_workspaces').select('key, name, active, lead_chat').eq('key', ws).maybeSingle();
  return data && data.active && data.lead_chat ? data : null;
}
const messages = async (leadId: string) => shapeLead(((await admin().from('portal_lead_msgs').select('id, from_lead, by_ai, sender, body, created_at').eq('lead_id', leadId).order('created_at').limit(300)).data || []));

/** The visitor's own chat (found by their cookie), so it survives a refresh and shows a counselor's replies. */
export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  if (!(await open(ws))) return NextResponse.json({ error: 'closed' }, { status: 404, headers: no });
  const lead = await findLead(req, ws);
  return NextResponse.json({ messages: lead ? await messages(lead.id) : [] }, { headers: no });
}

export async function POST(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const w = await open(ws);
  if (!w) return NextResponse.json({ error: 'This chat is not open right now.' }, { status: 404, headers: no });
  const j = (await req.json().catch(() => null)) as { body?: string; consent?: boolean; website?: string; src?: string } | null;
  if (!j || j.website) return NextResponse.json({ error: 'Something went wrong.' }, { status: 400, headers: no });   // the hidden field is only ever filled by bots
  const body = String(j.body || '').replace(/\s+/g, ' ').trim();
  if (!body) return NextResponse.json({ error: 'Write a message first.' }, { status: 400, headers: no });
  if (body.length > LIMITS.maxChars) return NextResponse.json({ error: `Please keep messages under ${LIMITS.maxChars} characters.` }, { status: 400, headers: no });
  const db = admin();
  const ip = ipHash((req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown');

  let lead = await findLead(req, ws), token: string | null = null;
  if (!lead) {
    if (j.consent !== true) return NextResponse.json({ error: 'Please tick the box to agree before we start.' }, { status: 400, headers: no });
    const { count } = await db.from('portal_leads').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', new Date(Date.now() - 864e5).toISOString());
    if ((count || 0) >= LIMITS.newPerIpDay) return NextResponse.json({ error: 'Too many chats started from here today. Please try again tomorrow.' }, { status: 429, headers: no });
    token = newToken();
    const { data, error } = await db.from('portal_leads').insert({ workspace: ws, token_hash: tokenHash(token), ip_hash: ip, consent_at: new Date().toISOString(), source: canonicalSource(j.src) }).select(COLS).single();
    if (error || !data) return NextResponse.json({ error: 'Could not start the chat. Please try again.' }, { status: 500, headers: no });
    lead = data as LeadRow;
  } else {
    const hour = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: lastHour }, { count: total }] = await Promise.all([
      db.from('portal_lead_msgs').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('from_lead', true).gte('created_at', hour),
      db.from('portal_lead_msgs').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('from_lead', true),
    ]);
    if ((lastHour || 0) >= LIMITS.perHour || (total || 0) >= LIMITS.perLead) return NextResponse.json({ error: 'That’s a lot of messages. A counselor will reply to you soon.' }, { status: 429, headers: no });
  }

  await db.from('portal_lead_msgs').insert({ lead_id: lead.id, from_lead: true, body });
  await db.from('portal_leads').update({ last_message_at: new Date().toISOString(), staff_read_at: null }).eq('id', lead.id);
  if (!lead.ai_paused) await leadTurn(lead);          // a counselor who took over has paused it

  const res = NextResponse.json({ ok: true, messages: await messages(lead.id), ...(token && req.headers.get('x-lead-embed') === '1' ? { token } : {}) }, { headers: no });
  if (token) res.cookies.set(cookieName(ws), token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 90 * 864e2 });
  return res;
}

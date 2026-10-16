import { NextResponse } from 'next/server';
import { currentStaff, canAccessApp } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { brainEnabled, suggestReply } from '@/lib/brain';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };

/** Staff only: drafts a reply for the counselor to read, edit and send themselves. Nothing is sent here. */
export async function POST(req: Request) {
  const me = await currentStaff();
  const j = (await req.json().catch(() => null)) as { appId?: string; question?: string; instruction?: string } | null;
  const appId = String(j?.appId || '');
  if (!me || !appId || !(await canAccessApp(me, appId))) return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  if (!brainEnabled()) return NextResponse.json({ error: 'The AI Brain is switched off. An admin can turn it on from the AI Brain page.' }, { status: 409, headers: no });
  try {
    const r = await suggestReply(appId, { question: j?.question, instruction: j?.instruction });
    await admin().from('portal_activity').insert({ application_id: appId, actor: me.email, kind: 'brain_suggested', detail: { needsHuman: r.needsHuman } });
    return NextResponse.json(r, { headers: no });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502, headers: no }); }
}

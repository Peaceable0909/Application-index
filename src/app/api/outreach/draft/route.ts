import { NextResponse } from 'next/server';
import { currentStaff, canAccessApp } from '@/lib/auth';
import { brainEnabled, suggestReply } from '@/lib/brain';
import { instructionFor, outreachList } from '@/lib/outreach';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };

/** Staff only: the Brain drafts the follow-up message for one student on the list. Nothing is sent. */
export async function POST(req: Request) {
  const me = await currentStaff();
  const j = (await req.json().catch(() => null)) as { appId?: string } | null;
  const appId = String(j?.appId || '');
  if (!me || !appId || !(await canAccessApp(me, appId))) return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  if (!brainEnabled()) return NextResponse.json({ error: 'The AI Brain is switched off, so write the message yourself.' }, { status: 409, headers: no });
  const n = (await outreachList(me)).find((x) => x.appId === appId);
  if (!n) return NextResponse.json({ error: 'There is nothing to follow up with this student right now.' }, { status: 404, headers: no });
  try {
    const r = await suggestReply(appId, { instruction: instructionFor(n), mustMention: n.reasons.some((x) => x.kind === 'docs') ? n.missing : undefined });
    return NextResponse.json(r, { headers: no });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502, headers: no }); }
}

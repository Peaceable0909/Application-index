import { NextResponse } from 'next/server';
import { currentStaff, canAccessApp } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { brainEnabled } from '@/lib/brain';

const no = { 'Cache-Control': 'no-store' };

async function who(appId: string) {
  const me = await currentStaff();
  if (!me || !appId || !(await canAccessApp(me, appId))) return null;
  const { data: app } = await admin().from('portal_applications').select('email, workspace').eq('application_id', appId).maybeSingle();
  return app?.email ? { me, email: app.email.toLowerCase(), ws: app.workspace as string } : null;
}

/** Is automatic reply on for this student's workspace, and has a counselor paused it for this student? */
export async function GET(req: Request) {
  const w = await who(new URL(req.url).searchParams.get('app') || '');
  if (!w) return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  const db = admin();
  const [{ data: ws }, { data: ch }] = await Promise.all([db.from('portal_workspaces').select('auto_reply').eq('key', w.ws).maybeSingle(), db.from('portal_brain_chat').select('paused').eq('student_email', w.email).maybeSingle()]);
  return NextResponse.json({ auto: brainEnabled() && !!ws?.auto_reply, paused: !!ch?.paused }, { headers: no });
}

/** Pause or resume automatic replies for one student. */
export async function POST(req: Request) {
  const j = (await req.json().catch(() => null)) as { appId?: string; paused?: boolean } | null;
  const w = await who(String(j?.appId || ''));
  if (!w || typeof j?.paused !== 'boolean') return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  await admin().from('portal_brain_chat').upsert({ student_email: w.email, paused: j.paused, updated_by: w.me.email, updated_at: new Date().toISOString() }, { onConflict: 'student_email' });
  return NextResponse.json({ ok: true }, { headers: no });
}

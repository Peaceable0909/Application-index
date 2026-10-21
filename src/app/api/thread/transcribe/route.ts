import { NextResponse } from 'next/server';
import { actor } from '@/lib/thread';
import { admin } from '@/lib/supabase';
import { transcribeMessage } from '@/lib/voice';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };

// A team member asks for one voice note in a student's chat to be written down.
export async function POST(req: Request) {
  const j = (await req.json().catch(() => null)) as { appId?: string; id?: string } | null;
  const a = j ? await actor(String(j.appId || '')) : null;
  if (!j || !a || a.role !== 'staff') return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401, headers: no });
  // the message must belong to the chat this person is allowed to open
  const { data: m } = await admin().from('portal_student_msgs').select('id').eq('id', String(j.id || '')).eq('student_email', a.studentEmail).maybeSingle();
  if (!m) return NextResponse.json({ ok: false, error: 'Message not found.' }, { status: 404, headers: no });
  const r = await transcribeMessage(m.id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: no });
}

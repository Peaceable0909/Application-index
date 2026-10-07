import { NextResponse } from 'next/server';
import { canSee, currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';

// Students the signed-in person may share in a chat (counselors: only their own). Optional ?q= filters by name.
export async function GET(req: Request) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ students: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') || '').toLowerCase().trim();
  const { data } = await admin().from('portal_applications').select('application_id, name, school, programme, status, counselor').order('name').limit(600);
  const seen = new Set<string>();
  const students = (data || []).filter((a) => canSee(me, a.counselor) && (!q || a.name.toLowerCase().includes(q) || (a.school || '').toLowerCase().includes(q)))
    .filter((a) => { const k = `${a.name}|${a.school}`; return seen.has(k) ? false : (seen.add(k), true); }).slice(0, 60)
    .map((a) => ({ id: a.application_id, name: a.name, school: a.school, programme: a.programme, status: a.status }));
  return NextResponse.json({ students });
}

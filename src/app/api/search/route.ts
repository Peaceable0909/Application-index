import { NextResponse } from 'next/server';
import { canSee, currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';

// Powers the ⌘K search box. Staff only; returns at most 8 students.
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json([], { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') || '').replace(/[%,()*]/g, ' ').trim();
  if (q.length < 2) return NextResponse.json([]);
  const { data } = await admin().from('portal_applications')
    .select('application_id,name,email,school,programme,status,student_key,counselor')
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,programme.ilike.%${q}%,school.ilike.%${q}%,opp_id.ilike.%${q}%,student_ref.ilike.%${q}%,phone.ilike.%${q}%`)
    .order('submitted_at', { ascending: false, nullsFirst: false }).limit(40);
  const seen = new Set<string>();
  const out = (data || []).filter((r) => r.email !== 'test@example.com').filter((r) => canSee(staff, r.counselor)).filter((r) => (seen.has(r.student_key) ? false : (seen.add(r.student_key), true))).slice(0, 8)
    .map((r) => ({ id: r.application_id, name: r.name, email: r.email, school: r.school, programme: r.programme, status: r.status }));
  return NextResponse.json(out);
}

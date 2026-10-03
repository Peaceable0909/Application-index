import { NextResponse } from 'next/server';
import { canSee, currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';

// Students the signed-in person may tag in a chat (counselors: only their own).
export async function GET() {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ students: [] }, { status: 401 });
  const { data } = await admin().from('portal_applications').select('application_id, name, counselor').order('name').limit(500);
  return NextResponse.json({ students: (data || []).filter((a) => canSee(me, a.counselor)).map((a) => ({ id: a.application_id, name: a.name })) });
}

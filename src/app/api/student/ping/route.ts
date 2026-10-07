import { NextResponse } from 'next/server';
import { currentStudent } from '@/lib/student';
import { admin } from '@/lib/supabase';

export async function POST() {
  const me = await currentStudent();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  await admin().from('portal_student_seen').upsert({ email: me.email, last_active_at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}

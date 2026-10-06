import { NextResponse } from 'next/server';
import { currentStudent } from '@/lib/student';
import { noticesFor } from '@/lib/notices';
import { admin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await currentStudent();
  if (!me) return NextResponse.json({ notices: [] }, { status: 401 });
  return NextResponse.json({ notices: await noticesFor(me) });
}

// Opening the bell marks everything as read.
export async function POST() {
  const me = await currentStudent();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  await admin().from('portal_student_notices').update({ read_at: new Date().toISOString() }).eq('email', me.email).is('read_at', null);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { vapid } from '@/lib/push';
import { pushUser } from '@/lib/pushUser';

export async function GET() {
  if (!(await pushUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json({ key: (await vapid()).publicKey }, { headers: { 'Cache-Control': 'private, max-age=300' } }); }
  catch { return NextResponse.json({ error: 'Push is not available right now.' }, { status: 500 }); }
}

import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { unreadTotal } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Heartbeat: "this person is in the portal right now" (so we don't email them what they can already see) + unread chat count.
export async function GET() {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ unread: 0 }, { status: 401 });
  await admin().from('portal_staff').update({ last_active_at: new Date().toISOString() }).eq('email', me.email);
  return NextResponse.json({ unread: await unreadTotal(me.email).catch(() => 0) });
}

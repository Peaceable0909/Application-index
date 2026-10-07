import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { membership } from '@/lib/chat';

// Attachments are private: only members of the room get a short-lived link.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: m } = await admin().from('portal_chat_msgs').select('room_id, att_path, att_name, deleted_at').eq('id', (await params).id).maybeSingle();
  if (!m?.att_path || m.deleted_at || !(await membership(m.room_id, me.email))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data } = await admin().storage.from('chat-files').createSignedUrl(m.att_path, 120, { download: false });
  if (!data?.signedUrl) return NextResponse.json({ error: 'File unavailable' }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=60' } });
}

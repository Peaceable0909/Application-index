import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { actor } from '@/lib/thread';

// Attachments are private: only the student and staff who can see that student get a short-lived link.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = new URL(req.url);
  const a = await actor(u.searchParams.get('app'));
  if (!a) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: m } = await admin().from('portal_student_msgs').select('att_path, att_name, deleted_at').eq('id', (await params).id).eq('student_email', a.studentEmail).maybeSingle();
  if (!m?.att_path || m.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data } = await admin().storage.from('chat-files').createSignedUrl(m.att_path, 300, u.searchParams.get('download') ? { download: m.att_name || true } : undefined);
  if (!data?.signedUrl) return NextResponse.json({ error: 'File unavailable' }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=120' } });
}

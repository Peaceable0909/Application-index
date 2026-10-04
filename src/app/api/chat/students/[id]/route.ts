import { NextResponse } from 'next/server';
import { canAccessApp, currentStaff } from '@/lib/auth';
import { decodeId } from '@/lib/format';
import { effType } from '@/lib/docs';
import { admin } from '@/lib/supabase';

// A student's documents, for picking one to share in a chat.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ docs: [] }, { status: 401 });
  const id = decodeId((await params).id);
  if (!(await canAccessApp(me, id))) return NextResponse.json({ docs: [] }, { status: 404 });
  const { data } = await admin().from('portal_documents').select('drive_file_id, name, doc_type, type_override').eq('application_id', id).order('created_at', { ascending: false });
  return NextResponse.json({ docs: (data || []).map((d) => ({ f: d.drive_file_id, name: d.name, type: effType(d) })) });
}

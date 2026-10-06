import { NextResponse } from 'next/server';
import { canAccessApp, currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// The stored text for one document (same access rules as the document itself).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ row: null }, { status: 401 });
  const { data } = await admin().from('portal_doc_text').select('application_id, text, chars, truncated, error, method, extracted_at').eq('drive_file_id', (await params).id).maybeSingle();
  if (!data || !(await canAccessApp(me, data.application_id))) return NextResponse.json({ row: null }, { status: 404 });
  return NextResponse.json({ row: { text: data.text, chars: data.chars, truncated: data.truncated, error: data.error, method: data.method, at: data.extracted_at } });
}

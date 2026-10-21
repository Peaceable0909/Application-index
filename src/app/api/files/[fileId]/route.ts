import { NextResponse, after } from 'next/server';
import { canAccessApp, currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { callScript } from '@/lib/appsScript';
import { currentStudent } from '@/lib/student';
import { audit } from '@/lib/audit';
import { effType } from '@/lib/docs';

/** Writes "who opened which document" to the admin log. The same person opening the same file again within 10 minutes (a page reload, a PDF fetched twice) is one line. */
async function logOpen(email: string, doc: { drive_file_id: string; application_id: string; name: string; doc_type: string; type_override: string | null }, download: boolean) {
  try {
    const action = download ? 'doc_downloaded' : 'doc_opened', db = admin();
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: recent } = await db.from('portal_audit').select('id').eq('actor', email).eq('action', action).contains('detail', { file_id: doc.drive_file_id }).gte('created_at', since).limit(1);
    if (recent?.length) return;
    const { data: app } = await db.from('portal_applications').select('name').eq('application_id', doc.application_id).maybeSingle();
    await audit(email, action, `${app?.name || 'Student'} · ${doc.name}`, { file_id: doc.drive_file_id, application_id: doc.application_id, type: effType(doc), file: doc.name });
  } catch { /* the log must never stop a document from opening */ }
}

// Streams a document from Drive to signed-in staff only. Only files that
// belong to a known application can be fetched, so the Apps Script token can
// never be used to read arbitrary Drive files through this route.
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const staff = await currentStaff();
  const student = staff ? null : await currentStudent();
  if (!staff && !student) return new NextResponse('Unauthorized', { status: 401 });
  const { fileId } = await params;
  const { data: doc } = await admin().from('portal_documents').select('drive_file_id, size_bytes, application_id, name, doc_type, type_override').eq('drive_file_id', fileId).maybeSingle();
  if (!doc || !(staff ? await canAccessApp(staff, doc.application_id) : student!.ids.includes(doc.application_id))) return new NextResponse('Not found', { status: 404 });
  if (staff) after(logOpen(staff.email, doc, new URL(req.url).searchParams.get('download') === '1'));
  if ((doc.size_bytes || 0) > 4 * 1024 * 1024) return new NextResponse('Too large to stream here; open it in Drive', { status: 413 });
  try {
    const f = await callScript<{ name: string; mimeType: string; base64: string }>('getFile', { fileId });
    const download = new URL(req.url).searchParams.get('download') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'Content-Type': f.mimeType,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) { return new NextResponse((e as Error).message, { status: 502 }); }
}

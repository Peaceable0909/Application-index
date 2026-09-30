import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { callScript } from '@/lib/appsScript';

// Streams a document from Drive to signed-in staff only. Only files that
// belong to a known application can be fetched, so the Apps Script token can
// never be used to read arbitrary Drive files through this route.
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  if (!(await currentStaff())) return new NextResponse('Unauthorized', { status: 401 });
  const { fileId } = await params;
  const { data: doc } = await admin().from('portal_documents').select('drive_file_id').eq('drive_file_id', fileId).maybeSingle();
  if (!doc) return new NextResponse('Not found', { status: 404 });
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

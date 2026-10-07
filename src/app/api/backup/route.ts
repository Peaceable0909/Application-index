import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { audit } from '@/lib/audit';

// Admin-only: short-lived download link for one backup file.
export async function GET(req: Request) {
  const me = await currentStaff();
  if (!me || me.role !== 'admin') return new NextResponse('Admins only', { status: 403 });
  const file = new URL(req.url).searchParams.get('file') || '';
  if (!/^portal-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(file)) return new NextResponse('Bad file name', { status: 400 });
  const { data } = await admin().storage.from('backups').createSignedUrl(file, 60, { download: file });
  if (!data?.signedUrl) return new NextResponse('Not found', { status: 404 });
  await audit(me.email, 'backup_downloaded', file);
  return NextResponse.redirect(data.signedUrl);
}

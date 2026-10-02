import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { effType, missingDocs } from '@/lib/docs';
import { decodeId } from '@/lib/format';
import DocViewer, { ViewerDoc } from './DocViewer';

export default async function Documents({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ file?: string; msg?: string; err?: string }> }) {
  await requireStaff();
  const id = decodeId((await params).id);
  const sp = await searchParams;
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('application_id,has_raw,submitted_at,name,school,programme,student_key,drive_folder_id,drive_folder_url').eq('application_id', id).maybeSingle();
  if (!app) notFound();
  const { data: sibs } = await db.from('portal_applications').select('application_id').eq('student_key', app.student_key);
  const { data: rows } = await db.from('portal_documents').select('*').in('application_id', (sibs || []).map((s) => s.application_id)).order('created_at', { ascending: false });

  const docs: ViewerDoc[] = (rows || []).map((d) => ({
    id: d.drive_file_id, name: d.name, type: effType(d), path: d.folder_path, size: Number(d.size_bytes || 0), mime: d.mime_type || '',
    driveUrl: d.drive_url, fromOther: d.application_id !== id, added: new Date(d.created_at).toLocaleDateString('en-GB'),
  }));
  const missing = (app.has_raw && app.submitted_at) || app.drive_folder_id ? missingDocs(docs.map((d) => d.type)) : [];

  return (
    <>
      <Link href={`/applications/${id}?tab=documents`} className="crumb">← {app.name}</Link>
      <div className="head"><h1>Documents</h1>{app.drive_folder_url && <a href={app.drive_folder_url} target="_blank">Drive folder ↗</a>}</div>
      <p className="sub">{app.name} · {[app.school, app.programme].filter(Boolean).join(' · ')}</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}
      <DocViewer appId={id} docs={docs} missing={missing} initial={sp.file || null} canUpload={!!app.drive_folder_id} />
    </>
  );
}

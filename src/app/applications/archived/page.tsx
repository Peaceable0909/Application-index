import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { currentWorkspace } from '@/lib/workspace';
import { restoreArchivedStudent } from '@/app/actions';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

type Search = { msg?: string; err?: string };
type ArchivedRow = {
  application_id: string; student_key: string; name: string; email: string | null;
  school: string | null; programme: string | null; archived_at: string | null; archived_by: string | null;
};

export default async function ArchivedStudents({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireTeam();
  const [ws, sp] = await Promise.all([currentWorkspace(), searchParams]);
  const { data, error } = await admin().from('portal_applications')
    .select('application_id, student_key, name, email, school, programme, archived_at, archived_by')
    .eq('workspace', ws).not('archived_at', 'is', null).order('archived_at', { ascending: false }).limit(5000);

  const byStudent = new Map<string, { row: ArchivedRow; submissions: number }>();
  for (const row of (data || []) as ArchivedRow[]) {
    const key = row.student_key || row.application_id;
    const existing = byStudent.get(key);
    if (existing) existing.submissions++;
    else byStudent.set(key, { row, submissions: 1 });
  }
  const students = [...byStudent.values()];

  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between' }}>
        <div><h1>Archived students</h1><p className="sub" style={{ marginBottom: 0 }}>{students.length} archived student{students.length === 1 ? '' : 's'} in this workspace</p></div>
        <Link href="/applications" className="btn ghost sm"><Icon n="left" size={14} /> Back to Applications</Link>
      </div>
      <div className="card" style={{ margin: '12px 0', padding: '14px 16px' }}>
        Archived students are hidden from active portal lists. A successful sync automatically archives a previously source-backed student only when they are missing from all connected sources; removing them from just one source is not enough. If a sync-archived student returns in a connected source, the next sync restores them automatically. Archiving does not delete anything from Sheets or Drive, and portal access and history are preserved. Admins can also restore a student here; if they are still absent from every source, the next successful sync will archive them again.
      </div>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {(sp.err || error) && <div className="card err">{sp.err || `Could not load archived students: ${error?.message}`}</div>}
      <div className="card tablecard">
        <div className="scroll">
          <table className="mcards">
            <thead><tr><th>Student</th><th>University / Programme</th><th>Archived</th><th>Records</th><th>Action</th></tr></thead>
            <tbody>
              {students.map(({ row, submissions }) => (
                <tr key={row.student_key || row.application_id} className="row">
                  <td className="mc-name" data-l="Student"><b>{row.name}</b><div className="muted">{row.email || ''}</div></td>
                  <td data-l="University">{row.school || '—'}<div className="muted">{row.programme || ''}</div></td>
                  <td data-l="Archived">{row.archived_at ? new Date(row.archived_at).toLocaleString('en-GB') : '—'}<div className="muted">{row.archived_by || ''}</div></td>
                  <td data-l="Records">{submissions} submission{submissions === 1 ? '' : 's'}</td>
                  <td data-l="Action">
                    {staff.role === 'admin' ? <form action={restoreArchivedStudent}>
                      <input type="hidden" name="id" value={row.application_id} />
                      <Btn className="ghost sm"><Icon n="rotate" size={14} /> Restore</Btn>
                    </form> : <span className="muted">Ask an admin to restore</span>}
                  </td>
                </tr>
              ))}
              {!students.length && <tr><td colSpan={5} className="muted" style={{ padding: 40, textAlign: 'center' }}>{error ? 'The archive could not be loaded.' : 'There are no archived students in this workspace.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

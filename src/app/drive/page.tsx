import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import Btn from '@/components/Btn';
import { dismissSuggestion, linkExactMatches, linkFolder, scanDrive } from '../actions';

export const maxDuration = 60;

export default async function DriveMatches({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const [{ data: sugg }, { count: noFolder }, { count: scanned }] = await Promise.all([
    db.from('portal_folder_suggestions').select('*, portal_applications(application_id, name, school, programme, email)').eq('status', 'new').order('score', { ascending: false }),
    db.from('portal_applications').select('application_id', { count: 'exact', head: true }).is('drive_folder_id', null),
    db.from('portal_applications').select('application_id', { count: 'exact', head: true }).is('drive_folder_id', null).not('drive_scan_at', 'is', null),
  ]);
  type App = { application_id: string; name: string; school: string | null; programme: string | null; email: string | null };
  const groups = new Map<string, { app: App; items: NonNullable<typeof sugg> }>();
  (sugg || []).forEach((x) => {
    const app = x.portal_applications as App | null; if (!app) return;
    (groups.get(app.application_id) || groups.set(app.application_id, { app, items: [] }).get(app.application_id)!).items.push(x);
  });
  const exactOnes = [...groups.values()].filter((g) => g.items.filter((i) => i.exact).length === 1).length;

  return (
    <>
      <div className="head"><h1>Drive matches</h1></div>
      <p className="sub">Connect each student to their Google Drive folder so their documents can be checked. Nothing is linked until you confirm.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card"><div className="stat-l">Students with no Drive folder</div><div className="stat">{noFolder ?? 0}</div></div>
        <div className="card"><div className="stat-l">Already searched</div><div className="stat">{scanned ?? 0}</div></div>
        <div className="card"><div className="stat-l">Folders waiting for you</div><div className="stat">{(sugg || []).length}</div></div>
      </div>

      <div className="card filters">
        <form action={scanDrive}><Btn>Search Drive for the next 12 students</Btn></form>
        <form action={linkExactMatches}><Btn className="gold" disabled={!exactOnes}>Link {exactOnes} exact name match{exactOnes === 1 ? '' : 'es'}</Btn></form>
        <span className="muted">“Exact” means the folder name contains every word of the student’s name and there’s only one such folder.</span>
      </div>

      {[...groups.values()].map(({ app, items }) => (
        <div key={app.application_id} className="card">
          <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div><Link href={`/applications/${app.application_id}?tab=documents`}><b>{app.name}</b></Link> <span className="muted">· {[app.school, app.programme].filter(Boolean).join(' · ')}</span></div>
          </div>
          {items.map((i) => (
            <div key={i.id} className="filters" style={{ padding: '8px 0', borderTop: '1px solid var(--line)', justifyContent: 'space-between' }}>
              <div>
                <a href={i.folder_url || '#'} target="_blank">{i.folder_name}</a>{' '}
                {i.exact ? <span className="badge green">name matches</span> : <span className="badge amber">partial</span>}
                <div className="muted">{i.parent_name ? `in ${i.parent_name} · ` : ''}{i.file_count ?? 0} file{i.file_count === 1 ? '' : 's'}{i.modified_at ? ` · updated ${new Date(i.modified_at).toLocaleDateString('en-GB')}` : ''}</div>
              </div>
              <div className="filters">
                <form action={linkFolder}><input type="hidden" name="id" value={app.application_id} /><input type="hidden" name="folder" value={i.folder_id} /><input type="hidden" name="returnTo" value="/drive" /><Btn className="sm">Link</Btn></form>
                <form action={dismissSuggestion}><input type="hidden" name="id" value={app.application_id} /><input type="hidden" name="sid" value={i.id} /><input type="hidden" name="returnTo" value="/drive" /><Btn className="ghost sm">Not them</Btn></form>
              </div>
            </div>
          ))}
        </div>
      ))}
      {!groups.size && <div className="card muted" style={{ textAlign: 'center', padding: 40 }}>No suggestions yet. Press “Search Drive” to look for folders.</div>}
    </>
  );
}

import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { workspacesFor } from '@/lib/workspace';
import { headViewFor, loadHeadBoard } from '@/lib/headBoard';
import { loadCounselors } from '@/lib/assignCore';
import HeadDashboard from '@/components/HeadDashboard';

export const maxDuration = 60;
type SP = { msg?: string; err?: string; show?: string; counselor?: string; school?: string };

export default async function HeadPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireStaff();
  const mine = await workspacesFor(staff);
  const view = await headViewFor(staff, mine.map((w) => w.key));
  if (!view) redirect(staff.role === 'counselor' ? '/my' : '/');   // not an admin or a Team Head: nothing to oversee
  const sp = await searchParams;

  const db = admin();
  const [board, counselors, scopeRows] = await Promise.all([
    loadHeadBoard(view),
    loadCounselors(db),
    staff.role === 'admin' ? Promise.resolve([]) : db.from('portal_head_scopes').select('workspace, scope, school_name, location_name').eq('email', staff.email.toLowerCase()).then((r) => r.data || []),
  ]);
  const wsName = new Map(mine.map((w) => [w.key, w.name]));
  const scopeText = staff.role === 'admin'
    ? `You are an admin, so you see every application in ${view.workspaces.map((w) => wsName.get(w) || w).join(', ')}.`
    : `You oversee: ${scopeRows.map((s) => s.scope === 'country' ? `all of ${wsName.get(s.workspace) || s.workspace}` : s.scope === 'school' ? `${s.school_name} (${wsName.get(s.workspace) || s.workspace})` : `${s.location_name} (${wsName.get(s.workspace) || s.workspace})`).join(' · ')}. You only see and change students inside this.`;
  const people = [...counselors].filter(([, c]) => c.active).map(([key, c]) => ({ key, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  const schools = [...new Set(board.apps.map((a) => a.school).filter(Boolean) as string[])].sort();

  return (
    <>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      <HeadDashboard board={board} counselors={people} scopeText={scopeText} isAdmin={staff.role === 'admin'} filter={{ show: sp.show || 'all', counselor: sp.counselor || '', school: sp.school || '' }} schools={schools} />
    </>
  );
}

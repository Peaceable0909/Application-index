import { requireTeam } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { admin } from '@/lib/supabase';
import { schoolKey } from '@/lib/docs';
import { loadAdminData } from '@/lib/assignAdmin';
import { bulkCandidates } from '@/lib/assignCore';
import { normLocation } from '@/lib/assignEngine';
import AssignmentsAdmin from '@/components/AssignmentsAdmin';

export const maxDuration = 60;
type SP = { msg?: string; err?: string; bulk?: string; workspace?: string; from?: string; school?: string; location?: string };

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireTeam();
  if (staff.role !== 'admin') redirect('/?err=' + encodeURIComponent('Only an admin can change who is responsible for what.'));
  const sp = await searchParams;
  const data = await loadAdminData();
  // the preview of a bulk move: exactly the applications the confirm button will move
  const wanted = sp.bulk && sp.workspace && sp.from && data.workspaces.some((w) => w.key === sp.workspace);
  const bulk = wanted ? {
    workspace: sp.workspace!, from: sp.from!, school: sp.school || '', location: sp.location || '',
    apps: await bulkCandidates(admin(), { workspace: sp.workspace!, from: sp.from!, school: sp.school ? schoolKey(sp.school) : null, location: sp.location ? normLocation(sp.location) || null : null }),
  } : null;
  return (
    <>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      <AssignmentsAdmin data={data} bulk={bulk} />
    </>
  );
}

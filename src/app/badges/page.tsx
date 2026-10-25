import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { loadBadgeDefs, loadHolders } from '@/lib/badgeData';
import { profileLocks } from '@/lib/profileLocks';
import BadgesAdmin from '@/components/BadgesAdmin';
import FlashScroll from '@/components/FlashScroll';

type SP = { msg?: string; err?: string };

export default async function BadgesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireStaff();
  if (me.role !== 'admin') redirect('/?err=' + encodeURIComponent('Only an admin can manage badges.'));
  const sp = await searchParams;
  const [defs, holders, locks, { data: people }] = await Promise.all([
    loadBadgeDefs(), loadHolders(), profileLocks(),
    admin().from('portal_staff').select('email, role, display_name, avatar_url, color, title').order('display_name'),
  ]);
  return (
    <>
      <div className="head"><h1>Badges</h1><span className="badge plain">{defs.filter((d) => d.enabled).length} on</span></div>
      <p className="sub">Create badges, say what each one means, and give them to people. A badge appears beside a name and explains itself when you point at it. It is only a label: it never changes what anyone can open.</p>
      {sp.msg && <div className="card ok" data-flash>{sp.msg}</div>}{sp.err && <div className="card err" data-flash>{sp.err}</div>}
      <FlashScroll />
      <BadgesAdmin defs={defs} holders={holders} people={(people || []) as never[]} locks={locks} />
    </>
  );
}

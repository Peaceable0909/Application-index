import { requireStaff } from '@/lib/auth';
import { brainEnabled } from '@/lib/brain';
import { outreachList } from '@/lib/outreach';
import Icon from '@/components/Icon';
import NudgeCard from '@/components/NudgeCard';

export const metadata = { title: 'Follow-ups' };
export const maxDuration = 60;

export default async function Outreach() {
  const staff = await requireStaff();
  const list = await outreachList(staff);
  const waiting = list.filter((n) => n.reasons.some((r) => r.kind === 'reply')).length;
  return (
    <>
      <div className="head"><h1>Follow-ups</h1>{list.length > 0 && <span className="badge blue">{list.length}</span>}</div>
      <p className="sub">Students who need a message today, and why. Pick one, let the Brain write it, read it, then send. Nothing goes out on its own.</p>
      {list.length === 0
        ? <div className="card" style={{ textAlign: 'center', padding: 36 }}><Icon n="check-circle" size={28} /><p style={{ margin: '10px 0 0' }}><b>You’re all caught up.</b></p><p className="muted" style={{ margin: 0 }}>Nobody needs a message right now. Reminders you send or skip stay hidden for a few days.</p></div>
        : <>
          {waiting > 0 && <p className="muted" style={{ margin: '0 0 10px' }}><b style={{ color: 'var(--red-ink)' }}>{waiting}</b> student{waiting === 1 ? ' is' : 's are'} waiting for an answer. They’re at the top.</p>}
          <div className="grid" style={{ gap: 12 }}>
            {list.map((n) => <NudgeCard key={n.appId} brain={brainEnabled()} n={{ appId: n.appId, name: n.name, school: n.school, email: n.email, reasons: n.reasons }} />)}
          </div>
        </>}
    </>
  );
}

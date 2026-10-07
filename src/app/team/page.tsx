import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { gradient, roleLabel, shownName } from '@/lib/profile';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';

export default async function Team() {
  const me = await requireStaff();
  const { data } = await admin().from('portal_staff').select('email, role, display_name, avatar_url, title, phone, bio, color, last_seen_at').order('role').order('display_name');
  const people = (data || []).sort((a, b) => shownName(a).localeCompare(shownName(b)));
  const online = (t: string | null) => !!t && Date.now() - new Date(t).getTime() < 10 * 60_000;
  return (
    <>
      <div className="head"><h1>Team</h1><span className="badge plain">{people.length} people</span></div>
      <p className="sub">Everyone with access to the portal.</p>
      <div className="grid g3">
        {people.map((p, i) => {
          const name = shownName(p), you = p.email === me.email;
          return (
            <div key={p.email} className="card tmember rise" style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
              <div className="tcover" style={{ background: gradient(p.color) }} />
              <div className="tface"><Avatar name={name} url={p.avatar_url} color={p.color} size={72} />{online(p.last_seen_at) && <i className="live" title="Active now" />}</div>
              <h3>{name}{you && <span className="badge plain" style={{ marginLeft: 8 }}>You</span>}</h3>
              <div className="muted">{p.title || roleLabel(p.role)}</div>
              {p.bio && <p className="tbio">{p.bio}</p>}
              <div className="tlinks">
                <a href={`mailto:${p.email}`}><Icon n="mail" size={14} /> {p.email}</a>
                {p.phone && <a href={`tel:${p.phone}`}><Icon n="phone" size={14} /> {p.phone}</a>}
              </div>
              {you && <Link href="/profile" className="btn ghost sm" style={{ marginTop: 12 }}>Edit my profile</Link>}
            </div>
          );
        })}
      </div>
    </>
  );
}

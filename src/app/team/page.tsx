import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { roleLabel, shownName } from '@/lib/profile';
import { headline } from '@/lib/profileHandles';
import { loadBadgeMap } from '@/lib/badgeData';
import { loadHandlesMap } from '@/lib/profileData';
import Avatar from '@/components/Avatar';
import Cover from '@/components/Cover';
import Icon from '@/components/Icon';
import { Seals } from '@/components/Seal';

export default async function Team() {
  const me = await requireStaff();
  const [{ data }, badges, handles] = await Promise.all([
    admin().from('portal_staff').select('email, role, display_name, avatar_url, title, phone, bio, color, last_seen_at, cover_url, cover_pos, cover_preset').order('role').order('display_name'),
    loadBadgeMap(), loadHandlesMap(),
  ]);
  const people = (data || []).sort((a, b) => shownName(a).localeCompare(shownName(b)));
  const online = (t: string | null) => !!t && Date.now() - new Date(t).getTime() < 10 * 60_000;
  return (
    <>
      <div className="head"><h1>Team</h1><span className="badge plain">{people.length} people</span></div>
      <p className="sub">Everyone with access to the portal. Open a profile to see what they handle.</p>
      <div className="grid g3">
        {people.map((p, i) => {
          const name = shownName(p), you = p.email === me.email;
          const line = headline(handles.get(p.email.toLowerCase()) ?? { countries: [], schools: [], locations: [], oversees: [], any: false });
          return (
            <div key={p.email} className="card tmember rise" style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
              <Cover className="tcover" url={p.cover_url} pos={p.cover_pos} preset={p.cover_preset} color={p.color} />
              <div className="tface"><Avatar name={name} url={p.avatar_url} color={p.color} size={76} />{online(p.last_seen_at) && <i className="live" title="Active now" />}</div>
              <h3><Link href={`/team/${encodeURIComponent(p.email)}`} className="tm-name">{name}</Link><Seals list={badges.get(p.email.toLowerCase())} size={18} max={3} />{you && <span className="badge plain" style={{ marginLeft: 8 }}>You</span>}</h3>
              <div className="muted">{p.title || roleLabel(p.role)}</div>
              {line && <div className="tm-handles"><Icon n="globe" size={13} /> {line}</div>}
              {p.bio && <p className="tbio">{p.bio}</p>}
              <div className="tlinks">
                <a href={`mailto:${p.email}`}><Icon n="mail" size={14} /> {p.email}</a>
                {p.phone && <a href={`tel:${p.phone}`}><Icon n="phone" size={14} /> {p.phone}</a>}
              </div>
              <div className="tm-acts">
                <Link href={`/team/${encodeURIComponent(p.email)}`} className="btn ghost sm">View profile</Link>
                {you && <Link href="/profile" className="btn ghost sm">Edit my profile</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

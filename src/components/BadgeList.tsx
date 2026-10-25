import Seal from './Seal';
import Icon from './Icon';
import type { BadgeLite } from '@/lib/staffBadges';

/** A person's badges with the meaning the admin wrote for each. Nothing here claims more than that. */
export default function BadgeList({ badges, who = 'They' }: { badges: BadgeLite[]; who?: 'You' | 'They' }) {
  return (
    <div className="card bl-card">
      <h2><Icon n="seal" size={17} /> Badges</h2>
      {badges.length ? (
        <ul className="bl-list">
          {badges.map((b) => <li key={b.id}><Seal b={b} size={26} quiet /><div><b>{b.name}</b>{b.description && <small>{b.description}</small>}</div></li>)}
        </ul>
      ) : <p className="muted" style={{ margin: '4px 0 0' }}>{who === 'You' ? 'You have no badges yet.' : 'No badges.'}</p>}
      <p className="hd-note">Badges are labels an admin gives out. They are shown beside a name and do not change what anyone can open.</p>
    </div>
  );
}

import Link from 'next/link';
import Icon from './Icon';
import { roleLine, type Handles } from '@/lib/profileHandles';

const when = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** What someone handles, read from the assignment records. It has no edit button on purpose: change it on the Responsibilities page and every screen agrees. */
export default function HandlesCard({ handles, admin = false, who = 'They' }: { handles: Handles; admin?: boolean; who?: 'You' | 'They' }) {
  const rows = (items: Handles['schools'], icon: string) => items.map((x) => (
    <li key={x.id}>
      <span className="hd-ic"><Icon n={icon} size={16} /></span>
      <div><b>{x.label}</b><small>{x.scope === 'country' ? roleLine(x.by) : `${x.workspaceName} · ${roleLine(x.by)}`}{x.pausedUntil ? ` · paused until ${when(x.pausedUntil)}` : ''}</small></div>
    </li>
  ));
  return (
    <div className="card hd-card">
      <h2><Icon n="globe" size={17} /> What {who === 'You' ? 'you' : 'they'} handle</h2>
      {handles.any ? (
        <>
          {handles.countries.length > 0 && <><div className="hd-h">Countries</div><ul className="hd-list">{rows(handles.countries, 'globe')}</ul></>}
          {handles.schools.length > 0 && <><div className="hd-h">Schools</div><ul className="hd-list">{rows(handles.schools, 'graduation')}</ul></>}
          {handles.locations.length > 0 && <><div className="hd-h">Locations</div><ul className="hd-list">{rows(handles.locations, 'pin')}</ul></>}
          {handles.oversees.length > 0 && (
            <><div className="hd-h">Oversees as Team Head</div>
              <ul className="hd-list">{handles.oversees.map((o) => <li key={o.id}><span className="hd-ic"><Icon n="users" size={16} /></span><div><b>{o.label}</b><small>{o.scope === 'country' ? 'Whole country' : o.workspaceName}</small></div></li>)}</ul></>
          )}
        </>
      ) : <p className="muted" style={{ margin: '4px 0 0' }}>Nothing is assigned yet. New applications are routed by the responsibilities admins set, and none point here.</p>}
      <p className="hd-note"><Icon n="lock" size={13} className="ic-in" /> This comes from the Responsibilities page, so it always matches where applications really go. {admin ? <Link href="/assignments">Change it there</Link> : 'Ask an admin to change it.'}</p>
    </div>
  );
}

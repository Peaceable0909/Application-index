import Avatar from './Avatar';
import Btn from './Btn';
import Icon from './Icon';
import Seal from './Seal';
import { assignBadge, deleteBadge, revokeBadge, saveBadge, saveProfileLocks } from '@/app/badgeActions';
import { BADGE_COLORS, BADGE_ROLES, COLOR_LABEL, DESC_MAX, NAME_MAX, ROLE_LABEL, mayHold, type BadgeDef } from '@/lib/staffBadges';
import type { Holder } from '@/lib/badgeData';
import { LOCKABLE, LOCK_KEYS, type LockKey } from '@/lib/profileRules';
import { shownName } from '@/lib/profile';

export type Person = { email: string; role: string; display_name: string | null; avatar_url: string | null; color: string | null; title: string | null };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** The fields shared by "New badge" and "Edit badge". */
function Fields({ d }: { d?: BadgeDef }) {
  const colour = d?.color || 'blue', roles = d?.eligible_roles || [...BADGE_ROLES];
  return (
    <>
      {d && <input type="hidden" name="id" value={d.id} />}
      <div className="pgrid">
        <label>Name<input name="name" defaultValue={d?.name || ''} maxLength={NAME_MAX} required placeholder="e.g. Country manager" /></label>
        <fieldset className="bg-fs">
          <legend>Colour</legend>
          <div className="bg-colors">
            {BADGE_COLORS.map((c) => (
              <label key={c} className="bgc">
                <input type="radio" name="color" value={c} defaultChecked={c === colour} />
                <span className="bgc-box"><Seal b={{ id: c, name: COLOR_LABEL[c], description: '', color: c }} size={22} plain />{COLOR_LABEL[c]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>What it means <span className="muted">(people see this when they point at the badge)</span>
        <textarea name="description" defaultValue={d?.description || ''} maxLength={DESC_MAX} rows={2} placeholder="e.g. Leads the UK desk and signs off offers." style={{ width: '100%', height: 'auto', padding: '10px 12px' }} />
      </label>
      <fieldset className="bg-fs" style={{ marginTop: 12 }}>
        <legend>Who can hold it</legend>
        <div className="bg-roles">
          {BADGE_ROLES.map((r) => <label key={r} className="bg-chk"><input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} /> {ROLE_LABEL[r]}</label>)}
        </div>
      </fieldset>
      <div className="bg-switches">
        <label className="switch-row"><span>Show it<small className="muted">While off, nobody sees it. People keep it, so you can switch it back on.</small></span><input type="checkbox" name="enabled" defaultChecked={d?.enabled ?? false} /></label>
        <label className="switch-row"><span>Students can see it<small className="muted">Shown next to the counselor’s name on the student side.</small></span><input type="checkbox" name="show_students" defaultChecked={d?.show_students ?? false} /></label>
      </div>
    </>
  );
}

export default function BadgesAdmin({ defs, holders, people, locks }: { defs: BadgeDef[]; holders: Holder[]; people: Person[]; locks: LockKey[] }) {
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p]));
  return (
    <>
      <div className="bg-grid">
        {defs.map((d) => {
          const mine = holders.filter((h) => h.badge_id === d.id);
          const mineSet = new Set(mine.map((h) => h.email));
          return (
            <article key={d.id} className={`card bg-card ${d.enabled ? '' : 'is-off'}`}>
              <header className="bg-head">
                <Seal b={d} size={44} quiet />
                <div className="bg-title"><h3>{d.name}</h3><p>{d.description || <em className="muted">No meaning written yet. Add one before switching it on.</em>}</p></div>
                <span className={`badge plain ${d.enabled ? 'green' : ''}`}>{d.enabled ? 'On' : 'Off'}</span>
              </header>
              <div className="bg-facts">
                <span>{COLOR_LABEL[d.color]}</span><span>Open to {d.eligible_roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(', ')}</span><span>{d.show_students ? 'Students can see it' : 'Team only'}</span><span>{mine.length} {mine.length === 1 ? 'holder' : 'holders'}</span>
              </div>

              <div className="bg-sec">
                <div className="hd-h">Held by</div>
                {mine.length ? (
                  <ul className="bg-holders">
                    {mine.map((h) => {
                      const p = byEmail.get(h.email), hidden = p && !mayHold(d, p.role);
                      return (
                        <li key={h.email}>
                          <Avatar name={p ? shownName(p) : h.email} url={p?.avatar_url} color={p?.color} size={30} />
                          <div><b>{p ? shownName(p) : h.email}</b><small>{p?.title || p?.role}{h.assigned_at ? ` · since ${day(h.assigned_at)}` : ''}{hidden ? ' · hidden, their role is no longer eligible' : ''}</small></div>
                          <form action={revokeBadge} data-busy="Taking the badge back…">
                            <input type="hidden" name="badge_id" value={d.id} /><input type="hidden" name="email" value={h.email} />
                            <Btn className="btn ghost sm" data-busy="Taking the badge back…" aria-label={`Take ${d.name} back from ${p ? shownName(p) : h.email}`}>Take back</Btn>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="muted" style={{ margin: 0 }}>Nobody holds this badge yet.</p>}
              </div>

              <details className="bg-det">
                <summary><Icon n="user-plus" size={15} /> Give to people</summary>
                <form action={assignBadge} data-busy="Giving the badge…">
                  <input type="hidden" name="badge_id" value={d.id} />
                  <ul className="bg-pick">
                    {people.filter((p) => !mineSet.has(p.email.toLowerCase())).map((p) => {
                      const ok = mayHold(d, p.role);
                      return (
                        <li key={p.email} className={ok ? '' : 'off'}>
                          <label><input type="checkbox" name="emails" value={p.email} disabled={!ok} /><Avatar name={shownName(p)} url={p.avatar_url} color={p.color} size={26} /><span><b>{shownName(p)}</b><small>{ok ? (p.title || p.role) : `Not open to ${p.role}s`}</small></span></label>
                        </li>
                      );
                    })}
                    {!people.some((p) => !mineSet.has(p.email.toLowerCase())) && <li className="muted">Everyone already has it.</li>}
                  </ul>
                  <div className="filters"><Btn className="btn sm" data-busy="Giving the badge…">Give “{d.name}”</Btn></div>
                </form>
              </details>

              <details className="bg-det">
                <summary><Icon n="edit" size={15} /> Edit this badge</summary>
                <form action={saveBadge} data-busy="Saving the badge…">
                  <Fields d={d} />
                  <div className="filters" style={{ marginTop: 12 }}><Btn className="btn sm" data-busy="Saving the badge…">Save changes</Btn></div>
                </form>
              </details>

              <details className="bg-det bg-danger">
                <summary><Icon n="trash" size={15} /> Delete</summary>
                <form action={deleteBadge} data-busy="Deleting the badge…">
                  <input type="hidden" name="id" value={d.id} />
                  <p className="muted" style={{ margin: '0 0 10px' }}>This removes “{d.name}” for good{mine.length ? ` and takes it from ${mine.length} ${mine.length === 1 ? 'person' : 'people'}` : ''}. To hide it but keep who has it, switch it off instead.</p>
                  <Btn className="btn ghost sm" data-busy="Deleting the badge…">Delete this badge</Btn>
                </form>
              </details>
            </article>
          );
        })}
      </div>

      <form action={saveBadge} className="card bg-new" data-busy="Creating the badge…">
        <h2><Icon n="seal" size={17} /> New badge</h2>
        <Fields />
        <div className="filters" style={{ marginTop: 12 }}><Btn className="btn" data-busy="Creating the badge…">Create badge</Btn></div>
      </form>

      <form action={saveProfileLocks} className="card" data-busy="Saving…">
        <h2><Icon n="lock" size={17} /> Who can edit what on a profile</h2>
        <p className="muted">Everyone edits their own name, photo, phone and accent colour. For the fields ticked below, only an admin can make changes (on that person’s profile page). Admins are never locked out.</p>
        <div className="bg-roles">
          {LOCK_KEYS.map((k) => <label key={k} className="bg-chk"><input type="checkbox" name="lock" value={k} defaultChecked={locks.includes(k)} /> {LOCKABLE[k]}</label>)}
        </div>
        <div className="filters" style={{ marginTop: 14 }}><Btn className="btn" data-busy="Saving…">Save</Btn></div>
      </form>
    </>
  );
}

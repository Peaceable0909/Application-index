import Btn from './Btn';
import Icon from './Icon';
import { assignApp } from '@/app/assignActions';
import type { AssignInfo } from '@/lib/assignCore';
import { actorName, LEVEL_LABEL, LOG_LABEL, stateLine } from '@/lib/assignText';
import { dateTime, shortDate } from '@/lib/format';

export type PersonOption = { key: string; name: string };

/** Who owns this application, why, who receives its documents, any decision waiting for a person, and the full history. */
export default function AssignmentCard({ appId, info, counselors, canAssign, returnTo }: { appId: string; info: AssignInfo; counselors: PersonOption[]; canAssign: boolean; returnTo: string }) {
  const st = stateLine(info.state, info.owner);
  const conflict = !info.owner && info.candidates.length > 0;
  const expectedKey = info.expected ? counselors.find((c) => c.name === info.expected!.name)?.key || '' : '';
  const hidden = <><input type="hidden" name="id" value={appId} /><input type="hidden" name="returnTo" value={returnTo} /></>;
  return (
    <section className="card as-card" aria-label="Assignment">
      <div className="as-top">
        <div>
          <span className="as-eyebrow">Assignment</span>
          <h2>{info.owner || (conflict ? 'More than one counselor could take this' : 'Waiting for a counselor')}</h2>
        </div>
        <span className={`badge plain tone-${st.tone}`}>{st.label}</span>
      </div>

      {conflict && (
        <div className="as-banner is-stop" role="status">
          <Icon n="alert" size={18} />
          <div>
            <span>{info.reason || 'The rules give two counselors equal standing. Nothing was assigned; a person has to choose.'}</span>
            {canAssign && (
              <div className="as-pick">
                {info.candidates.map((c) => (
                  <form key={c.counselor_key} action={assignApp}>
                    {hidden}<input type="hidden" name="counselor" value={c.counselor_key} /><input type="hidden" name="reason" value="Chosen between equal counselors" />
                    <Btn className="sm">Assign to {c.name}{c.role === 'backup' ? ' (backup)' : ''}</Btn>
                  </form>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {!conflict && !info.owner && (
        <div className="as-banner is-warn" role="status">
          <Icon n="alert" size={18} />
          <div>
            <span>{info.reason || 'No rule covers this application yet, so it is waiting for a Team Head or an admin.'}</span>
            {canAssign && info.expected && expectedKey && (
              <div className="as-pick"><form action={assignApp}>{hidden}<input type="hidden" name="counselor" value={expectedKey} /><input type="hidden" name="reason" value={`Followed the ${LEVEL_LABEL[info.expected.level] || 'rule'}`} /><Btn className="sm">Assign to {info.expected.name}</Btn></form></div>
            )}
          </div>
        </div>
      )}
      {info.owner && info.expected && (
        <div className="as-banner" role="status">
          <Icon n="swap" size={18} />
          <div>
            <span>The current rules would give this to <b>{info.expected.name}</b> ({LEVEL_LABEL[info.expected.level] || 'rule'}). Existing owners are never changed by the rules.</span>
            {canAssign && expectedKey && <div className="as-pick"><form action={assignApp}>{hidden}<input type="hidden" name="counselor" value={expectedKey} /><input type="hidden" name="reason" value="Moved to follow the current rules" /><Btn className="sm">Move to {info.expected.name}</Btn></form></div>}
          </div>
        </div>
      )}

      <div className="as-facts">
        <div><small>Counselor</small><b>{info.owner || 'Nobody yet'}</b>{info.assignedAt && <em>since {shortDate(info.assignedAt)}{info.assignedBy ? ` · by ${actorName(info.assignedBy)}` : ''}</em>}</div>
        <div><small>Receives the documents</small><b>{info.docHandler || (info.owner ? `${info.owner} (the counselor)` : 'Nobody yet')}</b>{!info.docHandler && <em>No separate document responsibility applies</em>}</div>
        <div><small>Why</small><b>{info.reason ? (info.reason.length > 150 ? info.reason.slice(0, 148) + '…' : info.reason) : 'Not recorded'}</b></div>
      </div>

      {canAssign && (
        <details className="as-more">
          <summary><Icon n="swap" size={15} /> {info.owner ? 'Reassign' : 'Assign'}</summary>
          <form action={assignApp} className="as-reassign">
            {hidden}
            <label>Counselor<select name="counselor" defaultValue="" required><option value="" disabled>Choose…</option>{counselors.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
            <label>Why (kept in the history)<input name="reason" maxLength={300} placeholder="For example: knows the family" /></label>
            <Btn className="sm primary">Save</Btn>
          </form>
          <p className="as-note">Only the counselor changes. The application, its documents and its stage stay as they are.</p>
        </details>
      )}

      <details className="as-more" open={info.history.length > 0 && info.history.length <= 3}>
        <summary><Icon n="clock" size={15} /> History ({info.history.length})</summary>
        {info.history.length ? (
          <ul className="as-hist">
            {info.history.map((h) => (
              <li key={h.id}>
                <time dateTime={h.at} title={dateTime(h.at)}>{shortDate(h.at)}</time>
                <div>
                  <b>{LOG_LABEL[h.kind] || h.kind}{h.to ? `: ${h.from ? `${h.from} to ${h.to}` : h.to}` : h.from ? `: from ${h.from}` : ''}</b>
                  <span>{h.reason || ''}{h.reason ? ' · ' : ''}by {actorName(h.actor)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="as-note">Nothing recorded yet. Applications that arrived before assignment rules were added only start a history from their next change.</p>}
      </details>
    </section>
  );
}

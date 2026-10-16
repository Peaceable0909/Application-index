import Icon from './Icon';

/** A page being read: lines on a sheet, a scanning beam sweeping over it, and the facts "lifting off" as chips. */
export function ScanLoader({ label = 'Reading documents…', sub }: { label?: string; sub?: string }) {
  return (
    <div className="ldr ldr-scan" role="status" aria-live="polite">
      <div className="ldr-sheet" aria-hidden="true">
        <i className="ln w70" /><i className="ln w90" /><i className="ln w55" /><i className="ln w80" /><i className="ln w40" /><i className="ln w85" />
        <b className="ldr-beam" />
        <span className="ldr-chip c1"><Icon n="check" size={11} /></span><span className="ldr-chip c2"><Icon n="check" size={11} /></span><span className="ldr-chip c3"><Icon n="check" size={11} /></span>
      </div>
      <div className="ldr-txt"><b>{label}</b>{sub && <small>{sub}</small>}</div>
    </div>
  );
}

/** Two people connecting: a line draws between them and pulses, with a ring on the "call" in the middle. */
export function InterviewLoader({ label = 'Getting your interview ready…', sub = 'Setting up the room' }: { label?: string; sub?: string }) {
  return (
    <div className="ldr ldr-int" role="status" aria-live="polite">
      <div className="ldr-stage" aria-hidden="true">
        <span className="ldr-who a"><Icon n="user" size={22} /></span>
        <span className="ldr-link"><i /><i /><i /></span>
        <span className="ldr-mid"><Icon n="video" size={20} /></span>
        <span className="ldr-link r"><i /><i /><i /></span>
        <span className="ldr-who b"><Icon n="user" size={22} /></span>
      </div>
      <div className="ldr-txt"><b>{label}</b><small>{sub}</small></div>
    </div>
  );
}

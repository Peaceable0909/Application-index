import Link from 'next/link';
import Icon from './Icon';
import type { Tracker } from '@/lib/studentStages';

const day = (t: string | null) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ASK_WORD = { needed: 'Needed', checking: 'Received, being checked', done: 'Done', again: 'Please send a new copy' } as const;

/** The student's step-by-step tracker for one school: what is done, where they are now, what is coming, and what is asked of them. */
export default function StudentStages({ t, i = 0 }: { t: Tracker; i?: number }) {
  const left = t.asks.filter((a) => !a.optional && a.state !== 'done');
  return (
    <section className="st-card st-stages" style={{ ['--i' as string]: i }} aria-label={`${t.school} application stages`}>
      <div className="st-eyebrow">{t.school} · your application stages</div>
      <h2>{t.started ? t.current : 'Your application is being prepared'}</h2>
      <p className="st-sub" style={{ margin: '2px 0 0' }}>
        {t.started
          ? <>Stage {t.index} of {t.total}{t.since ? ` · since ${day(t.since)}` : ''}{t.next ? <> · next: <b>{t.next}</b></> : ' · this is the last stage'}</>
          : 'These are the stages your application will go through. We will update this as it moves forward.'}
      </p>
      <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={t.total} aria-valuenow={t.index} aria-label="Application progress">
        {t.stages.map((s) => <i key={s.key} className={s.state} title={s.name} />)}
      </div>

      {t.started && t.note && <div className="st-note" style={{ marginTop: 14 }}><b>What this stage means</b>{t.note}</div>}

      {t.asks.length > 0 && (
        <div className="st-asks-box">
          <h3>{left.length ? 'What we need from you' : 'Your documents for this stage'}</h3>
          <ul className="st-list">
            {t.asks.map((a) => (
              <li key={a.label} className={`st-row ${a.state === 'done' ? 'got' : a.state === 'checking' ? '' : 'need'}`}>
                <span className="st-ico"><Icon n={a.state === 'done' ? 'check' : a.state === 'checking' ? 'clock' : 'alert'} size={18} /></span>
                <div className="st-grow"><b>{a.label}{a.optional ? ' (optional)' : ''}</b><small>{ASK_WORD[a.state]}</small></div>
              </li>
            ))}
          </ul>
          {left.length > 0 && <Link href="/student/documents" className="st-btn sm" style={{ marginTop: 12 }}><Icon n="upload" size={15} /> Upload documents</Link>}
        </div>
      )}

      <details className="st-all" open>
        <summary>All stages for {t.school}</summary>
        <div className="st-line">
          {t.stages.map((s) => (
            <div key={s.key} className={`st-ms ${s.state === 'done' ? 'done' : s.state === 'current' ? 'now' : ''}`} aria-current={s.state === 'current' ? 'step' : undefined}>
              <i>{s.state === 'done' ? <Icon n="check" size={15} /> : null}</i>
              <div><b>{s.name}</b><small>{s.state === 'done' ? 'Completed' : s.state === 'current' ? 'You are here' : s.state === 'next' ? 'Up next' : 'Coming up'}</small></div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

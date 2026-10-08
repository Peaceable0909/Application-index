import { redirect } from 'next/navigation';
import Link from 'next/link';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { loadStudentData, nextUp } from '@/lib/studentData';
import { FINAL_STATUSES } from '@/lib/constants';
import { schoolShort } from '@/lib/docs';
import { STEPS, stepIndex } from '@/lib/format';
import { milestones } from '@/lib/offer';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Greeting from '@/components/Greeting';
import ProgressRing from '@/components/ProgressRing';
import LocalTime from '@/components/LocalTime';
import ChecklistPanel from '@/components/ChecklistPanel';
import PushToggle from '@/components/PushToggle';

export const maxDuration = 60;
const fmtD = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function StudentHome() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const d = await loadStudentData(me);
  const nu = nextUp(d), up = d.interview.upcoming[0];
  let i = 0;
  return (
    <div className="st-page">
      <div style={{ ['--i' as string]: i++ }}><Greeting name={d.first} /><p className="st-lede">Here is where your application stands, and what to do next.</p></div>

      {d.cards.map((c) => {
        const idx = stepIndex(c.a.status), final = !!c.a.status && FINAL_STATUSES.includes(c.a.status) && c.a.status !== 'Enrolled';
        const pct = c.a.progress ?? Math.round((idx / (STEPS.length - 1)) * 100);
        const left = c.a.deadline ? Math.ceil((new Date(c.a.deadline + 'T23:59:59').getTime() - Date.now()) / 864e5) : null;
        return (
          <section key={c.a.student_key} className="st-card st-hero" style={{ ['--i' as string]: i++ }}>
            <ProgressRing percent={final ? 0 : pct} label={final ? 'closed' : 'complete'} />
            <div>
              <div className="st-eyebrow">{schoolShort(c.a.school) || 'Your application'}</div>
              <h2 style={{ fontSize: 'clamp(21px,3.4vw,27px)', margin: '0 0 8px' }}>{c.a.programme && c.a.programme.toUpperCase() !== 'N/A' ? c.a.programme : 'Your programme'}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'inherit' }}>
                {c.a.status && <span className={`st-chip ${final ? 'red' : c.a.status === 'Enrolled' ? 'green' : ''}`}>{c.a.status}</span>}
                {c.a.intake && <span className="st-chip amber">Intake {new Date(c.a.intake + '-01').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>}
                {left !== null && left >= 0 && <span className={`st-chip ${left <= 14 ? 'amber' : ''}`}>{left === 0 ? 'Deadline today' : `${left} day${left === 1 ? '' : 's'} to deadline`}</span>}
              </div>
              {!final && <div className="st-steps">{STEPS.map((st, n) => <div key={st} className={`st-step ${n < idx ? 'done' : n === idx ? 'now' : ''}`}><i>{n < idx ? '✓' : n + 1}</i>{st}</div>)}</div>}
            </div>
          </section>
        );
      })}

      <PushToggle banner />

      <section className={`st-card st-next ${nu.tone === 'clear' ? 'clear' : ''}`} style={{ ['--i' as string]: i++ }}>
        <div><div className="st-eyebrow">{nu.tone === 'clear' ? 'All good' : 'Next up'}</div><h2>{nu.title}</h2><p>{nu.sub}</p></div>
        <Link href={nu.href} className="st-btn light">{nu.cta} <Icon n="arrow" size={16} /></Link>
      </section>

      {me.apps.some((a) => a.in_regent) && (
        <Link href="/student/interview/credibility" className="st-card cr-entry" style={{ ['--i' as string]: i++ }}>
          <span className="ic"><Icon n="video" size={24} /></span>
          <span className="tx"><b>Credibility Test Training</b><small>Watch the video and practise your interview answers.</small></span>
          <Icon n="right" size={20} />
        </Link>
      )}

      {up && (
        <section className="st-card" style={{ ['--i' as string]: i++ }}>
          <div className="st-row" style={{ boxShadow: 'none', background: '#f3f7ff' }}>
            <span className="st-ico"><Icon n="video" size={20} /></span>
            <div className="st-grow"><b>Interview training</b><small><LocalTime iso={up.starts_at} long /> · {up.duration_min} min · {up.provider}</small></div>
            <a className="st-btn sm" href={up.teams_url} target="_blank" rel="noreferrer">Join</a>
          </div>
        </section>
      )}

      {d.checklist.length > 0 && <div style={{ ['--i' as string]: i++ }}><ChecklistPanel items={d.checklist} /></div>}

      {d.cards.map((c) => c.offer && (c.offer.offer_type || c.offer.cas_status || c.offer.visa_status || c.offer.conditions?.length) ? (
        <section key={`o${c.a.student_key}`} id="offer" className="st-card" style={{ ['--i' as string]: i++ }}>
          <h2>Offer &amp; visa</h2><p className="st-sub">{schoolShort(c.a.school)} · your progress step by step</p>
          <div className="st-line">{milestones(c.offer).map((m) => <div key={m.key} className={`st-ms ${m.state}`}><i>{m.state === 'done' ? '✓' : m.state === 'bad' ? '✕' : ''}</i><div><b>{m.label}</b><small>{[m.detail, m.date ? fmtD(m.date) : ''].filter(Boolean).join(' · ') || 'Not yet'}</small></div></div>)}</div>
          {(c.offer.conditions || []).length > 0 && <ul className="st-list" style={{ marginTop: 16 }}>{c.offer.conditions.map((cd, n) => <li key={n} className={`st-row ${cd.met ? 'got' : 'need'}`}><span className="st-ico">{cd.met ? '✓' : '!'}</span><div className="st-grow"><b>{cd.text}</b><small>{cd.met ? 'Met' : 'Still to do'}{cd.due ? ` · by ${fmtD(cd.due)}` : ''}</small></div></li>)}</ul>}
          {c.offer.offer_doc_id && c.docs.some((x) => x.id === c.offer!.offer_doc_id) && <a className="st-btn ghost sm" style={{ marginTop: 16 }} href={`/api/files/${encodeURIComponent(c.offer.offer_doc_id)}`} target="_blank" rel="noreferrer"><Icon n="eye" size={15} /> View my offer letter</a>}
          {c.offer.student_note && <div className="st-note" style={{ marginTop: 16 }}><b>Note from your counselor</b>{c.offer.student_note}</div>}
        </section>
      ) : null)}

      <section className="st-card" style={{ ['--i' as string]: i++ }}>
        <h2>Your counselor</h2>
        {d.counselor ? (
          <div className="st-person" style={{ marginTop: 12 }}>
            <Avatar name={d.counselor.display} url={d.counselor.avatar_url} color={d.counselor.color} size={56} />
            <div style={{ flex: 1 }}><b>{d.counselor.display}</b><small>{d.counselor.title}</small></div>
            <Link href="/student/messages" className="st-btn sm"><Icon n="chat" size={15} /> Message</Link>
          </div>
        ) : <p className="st-sub" style={{ margin: '8px 0 0' }}>A counselor will be assigned to you soon.</p>}
      </section>
    </div>
  );
}

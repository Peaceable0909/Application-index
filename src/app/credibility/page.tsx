import Link from 'next/link';
import { requireStaff, appIdsFor } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { CATEGORY_LABEL, CRITERIA, bandFor, loadQuestions, loadSettings, summarise, type Attempt } from '@/lib/credibility';
import { saveVideo } from '../credibility-actions';
import CredQuestionAdmin from '@/components/CredQuestionAdmin';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

export const maxDuration = 60;
const TABS = [['video', 'Video'], ['questions', 'Questions'], ['students', 'Student progress']] as const;
const TONE: Record<string, string> = { excellent: '#16a34a', verygood: '#0d9488', good: '#2458d6', improve: '#d97706', poor: '#dc2626' };
const col = (n: number) => TONE[bandFor(n).tone];
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const Pill = ({ n }: { n: number | null }) => (n === null ? <span className="muted">—</span> : <span style={{ display: 'inline-block', minWidth: 34, textAlign: 'center', padding: '2px 9px', borderRadius: 99, color: '#fff', fontWeight: 700, fontSize: 13, background: col(n) }}>{n}</span>);

export default async function Credibility({ searchParams }: { searchParams: Promise<{ tab?: string; s?: string; msg?: string; err?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'video';
  const db = admin();
  const [settings, allQ] = await Promise.all([loadSettings(), loadQuestions(false)]);
  const activeQ = allQ.filter((q) => q.active);

  // everyone's attempts (a counselor only sees their own students)
  let aq = db.from('portal_cred_attempts').select('*').order('created_at', { ascending: false }).limit(3000);
  if (staff.role === 'counselor') { const ids = await appIdsFor(staff.counselor_key); aq = ids.length ? aq.in('application_id', ids) : aq.eq('application_id', '__none__'); }
  const attempts = ((await aq).data || []) as Attempt[];
  const byStudent = new Map<string, Attempt[]>();
  for (const a of attempts) byStudent.set(a.student_email, [...(byStudent.get(a.student_email) || []), a]);
  const appIds = [...new Set(attempts.map((a) => a.application_id).filter(Boolean))] as string[];
  const { data: apps } = appIds.length ? await db.from('portal_applications').select('application_id, name, school, programme, counselor').in('application_id', appIds) : { data: [] };
  const nameOf = (e: string) => { const a = byStudent.get(e)?.find((x) => x.application_id); const ap = (apps || []).find((p) => p.application_id === a?.application_id); return { name: ap?.name || e, school: ap?.school || '', programme: ap?.programme || '', counselor: ap?.counselor || '' }; };
  const rows = [...byStudent.entries()].map(([email, list]) => ({ email, ...nameOf(email), list, st: summarise(list, activeQ) })).sort((a, b) => b.list[0].created_at.localeCompare(a.list[0].created_at));
  const cohortAvg = attempts.length ? Math.round(attempts.reduce((t, a) => t + a.score, 0) / attempts.length) : null;
  const sel = sp.s ? rows.find((r) => r.email === sp.s) : null;
  const dup = (a: Attempt) => (a.flags || []).includes('internal:identical-to-other-student');

  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between' }}><h1>Credibility Test Training</h1><Link href="/credibility/preview" className="btn ghost sm"><Icon n="eye" size={14} /> Preview as student</Link></div>
      <p className="sub">Manage the training video and practice questions every student sees, and follow how they are doing. The questions are the same for everyone; only the video changes.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      <div className="grid g3" style={{ marginBottom: 6 }}>
        <div className="card"><div className="stat-l">Students practising</div><div className="stat">{rows.length}</div></div>
        <div className="card"><div className="stat-l">Practice attempts</div><div className="stat">{attempts.length}</div></div>
        <div className="card"><div className="stat-l">Average score</div><div className="stat" style={cohortAvg !== null ? { color: col(cohortAvg) } : undefined}>{cohortAvg ?? '—'}</div></div>
      </div>
      <div className="tabs" role="tablist">{TABS.map(([k, label]) => <Link key={k} href={`/credibility?tab=${k}`} scroll={false} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`}>{label}{k === 'students' && rows.length ? <span className="n">{rows.length}</span> : null}{k === 'questions' ? <span className="n">{activeQ.length}</span> : null}</Link>)}</div>

      {tab === 'video' && (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <form action={saveVideo} className="card grid" style={{ gap: 12 }}>
            <h2 style={{ margin: 0 }}>Training video</h2>
            <label>YouTube link<input name="url" defaultValue={settings.video_url || ''} required placeholder="https://youtu.be/…" style={{ width: '100%', marginTop: 6 }} /><small className="muted">Paste any normal YouTube link. It plays inside the student page, so students never leave the portal.</small></label>
            <label>Title shown to students<input name="title" defaultValue={settings.title || ''} required maxLength={140} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>Short description<textarea name="description" defaultValue={settings.description || ''} rows={4} maxLength={600} style={{ width: '100%', marginTop: 6 }} /></label>
            <div className="filters"><Btn data-busy="Saving…">Save video</Btn>{settings.updated_at && <small className="muted">Last changed {fmt(settings.updated_at)}{settings.updated_by ? ` by ${settings.updated_by}` : ''}</small>}</div>
          </form>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>What students see</h2>
            {settings.video_id ? <div style={{ position: 'relative', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', background: '#0b1530' }}><iframe src={`https://www.youtube-nocookie.com/embed/${settings.video_id}?rel=0`} title="Preview" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} allowFullScreen loading="lazy" /></div> : <p className="muted">No video set yet.</p>}
            <h3 style={{ marginBottom: 4 }}>{settings.title}</h3><p className="muted" style={{ marginTop: 0 }}>{settings.description}</p>
          </div>
        </div>
      )}

      {tab === 'questions' && <CredQuestionAdmin questions={allQ} />}

      {tab === 'students' && !sel && (
        rows.length === 0 ? <div className="card muted">No student has practised yet. Scores will appear here as soon as they do.</div> : (
          <div className="card tablecard" style={{ padding: 0, overflow: 'auto' }}>
            <table className="mcards">
              <thead><tr><th>Student</th><th>Attempts</th><th>Done</th><th>Average</th><th>Best</th><th>Latest</th><th>Focus areas</th><th>Last practised</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.email}>
                  <td><Link href={`/credibility?tab=students&s=${encodeURIComponent(r.email)}`}><b>{r.name}</b></Link>{r.list.some(dup) && <span className="badge amber plain" style={{ marginLeft: 8 }} title="At least one answer is word-for-word the same as another student's">Identical answer</span>}<div className="muted" style={{ fontSize: 12.5 }}>{r.counselor}</div></td>
                  <td>{r.st.attempts}</td><td>{r.st.completed}/{r.st.totalQuestions}</td><td><Pill n={r.st.average} /></td><td><Pill n={r.st.best} /></td><td><Pill n={r.st.latest} /></td>
                  <td>{r.st.weak.length ? r.st.weak.map((w) => w.label).join(', ') : <span className="muted">—</span>}</td><td className="muted">{fmt(r.list[0].created_at)}</td>
                </tr>))}</tbody>
            </table>
          </div>)
      )}

      {tab === 'students' && sel && (() => {
        const st = sel.st, chron = [...sel.list].sort((a, b) => a.created_at.localeCompare(b.created_at));
        const perQ = activeQ.map((q) => ({ q, v: st.byQuestion[q.id] }));
        return (
          <div className="grid" style={{ gap: 16 }}>
            <div><Link href="/credibility?tab=students" className="btn ghost sm"><Icon n="left" size={14} /> All students</Link></div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{sel.name}</h2>
              <p className="muted" style={{ marginTop: 0 }}>{[sel.school, sel.programme, sel.counselor && `Counselor: ${sel.counselor}`].filter(Boolean).join(' · ')}</p>
              <div className="grid g5" style={{ gap: 12 }}>
                <div><div className="stat-l">Attempts</div><div className="stat" style={{ fontSize: 26 }}>{st.attempts}</div></div>
                <div><div className="stat-l">Questions done</div><div className="stat" style={{ fontSize: 26 }}>{st.completed}/{st.totalQuestions}</div></div>
                <div><div className="stat-l">Average</div><div className="stat" style={{ fontSize: 26, color: st.average !== null ? col(st.average) : undefined }}>{st.average ?? '—'}</div></div>
                <div><div className="stat-l">Best</div><div className="stat" style={{ fontSize: 26, color: st.best !== null ? col(st.best) : undefined }}>{st.best ?? '—'}</div></div>
                <div><div className="stat-l">Latest</div><div className="stat" style={{ fontSize: 26, color: st.latest !== null ? col(st.latest) : undefined }}>{st.latest ?? '—'}</div></div>
              </div>
              <h3>Progress over time</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 84 }}>{chron.slice(-30).map((a) => <div key={a.id} title={`${a.score} · ${fmt(a.created_at)}`} style={{ flex: 1, maxWidth: 26, height: `${Math.max(6, a.score)}%`, background: col(a.score), borderRadius: '5px 5px 2px 2px', opacity: 0.9 }} />)}</div>
              <h3>Weak areas</h3>
              {st.weak.length ? <div className="grid" style={{ gap: 6 }}>{st.weak.map((w) => <div key={w.key} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Pill n={w.avg} /> {w.label}</div>)}</div> : <p className="muted" style={{ margin: 0 }}>None identified yet (needs a few attempts).</p>}
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>By question</h3>
              <div className="grid" style={{ gap: 8 }}>{perQ.map(({ q, v }) => <div key={q.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div style={{ flex: 1, minWidth: 0 }}>{q.question}</div>{v ? <><small className="muted">{v.n}×</small><Pill n={v.best} /></> : <span className="badge gray plain">Not tried</span>}</div>)}</div>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Every answer</h3>
              {sel.list.map((a) => (
                <details key={a.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
                  <summary style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Pill n={a.score} /><b style={{ flex: 1, minWidth: 200 }}>{a.question_text}</b>{dup(a) && <span className="badge amber plain">Identical to another student</span>}<small className="muted">{fmt(a.created_at)}{a.mode === 'basic' ? ' · quick check' : ''}</small></summary>
                  <div style={{ paddingTop: 10 }} className="grid">
                    <div className="callout" style={{ background: '#f7f9fe', borderColor: 'var(--line)' }}><div style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</div></div>
                    <div><b>{bandFor(a.score).label}.</b> {a.summary}</div>
                    <div className="grid g3" style={{ gap: 12 }}>
                      <div><b>Did well</b><ul>{(a.did_well || []).map((x) => <li key={x}>{x}</li>)}</ul></div>
                      <div><b>Missing</b><ul>{(a.missing || []).map((x) => <li key={x}>{x}</li>)}</ul></div>
                      <div><b>Improve</b><ul>{(a.improve || []).map((x) => <li key={x}>{x}</li>)}</ul></div>
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>{CRITERIA.filter((c) => typeof a.criteria?.[c.key] === 'number').map((c) => `${c.label} ${a.criteria[c.key]}`).join(' · ')} · {CATEGORY_LABEL[a.category] || a.category}</div>
                  </div>
                </details>))}
            </div>
          </div>
        );
      })()}
    </>
  );
}

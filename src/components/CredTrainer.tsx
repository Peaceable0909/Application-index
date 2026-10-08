'use client';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { BANDS, CATEGORY_LABEL, CRITERIA, bandFor, type CriterionKey, type Stats } from '@/lib/credShared';

export type CQuestion = { id: string; question: string; category: string; guidance: string | null; model: string | null };
export type CAttempt = { id: string; question_id: string | null; answer: string; score: number; band: string; criteria: Partial<Record<CriterionKey, number | null>>; did_well: string[]; missing: string[]; improve: string[]; suggestions: string[]; summary: string | null; flags: string[]; mode: string; created_at: string };
type Video = { id: string | null; title: string | null; description: string | null };

const TONE: Record<string, string> = { excellent: '#16a34a', verygood: '#0d9488', good: '#2458d6', improve: '#d97706', poor: '#dc2626' };
const toneOf = (score: number) => bandFor(score).tone;
const colour = (score: number) => TONE[toneOf(score)];
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const TIP: Record<string, string> = {
  relevance: 'Listen for what is really being asked, and answer that first.',
  specificity: 'Add details only you would know: names, figures, dates, real examples.',
  reasoning: 'Use “because” to explain each choice in your own words.',
  naturalVoice: 'Speak about yourself, not in general phrases. Say it aloud, then write what you said.',
  courseKnowledge: 'Read your module list again and note what each module covers.',
  institutionKnowledge: 'Find reasons that belong to Regent specifically, not any university.',
  careerCoherence: 'Make your past, your course and your career plan read as one story.',
  financeKnowledge: 'Know your exact fees, living costs, sponsor and where the funds came from.',
  consistency: 'Check your answer against what is in your application and documents.',
};
const LEARN = [
  { icon: 'link', t: 'Connect the dots', d: 'Your past study or work, the course, its modules, Regent, the UK and your career should read as one plan.' },
  { icon: 'user', t: 'Make it yours', d: 'Interviewers hear the same memorised answers again and again. Unique, personal reasons stand out.' },
  { icon: 'file', t: 'Know your course', d: 'Learn what each module really covers and which skills it gives you. Do not guess.' },
  { icon: 'trend', t: 'Know your money', d: 'Fees, living costs, your sponsor and where the funds came from. Be accurate and honest.' },
  { icon: 'check-circle', t: 'Be honest', d: 'Everything is checked. Say only what is true, and keep it consistent with your application.' },
];

function Ring({ score, size = 132, label }: { score: number; size?: number; label?: string }) {
  const [v, setV] = useState(0), R = 52, C = 2 * Math.PI * R;
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(score); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 1100); setV(Math.round(score * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [score]);
  const col = colour(score);
  return (
    <div className="cr-ring" style={{ width: size, height: size }} role="img" aria-label={`${score} out of 100`}>
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r={R} className="bg" /><circle cx="60" cy="60" r={R} className="fg" style={{ stroke: col, strokeDasharray: C, strokeDashoffset: C * (1 - score / 100) }} /></svg>
      <div className="num"><b style={{ color: col }}>{v}</b><small>{label || 'out of 100'}</small></div>
    </div>
  );
}

function Spark({ points }: { points: { score: number }[] }) {
  if (points.length < 2) return <div className="cr-spark empty">Your progress line appears after your second attempt.</div>;
  const W = 300, H = 70, P = 6, xs = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1), ys = (v: number) => H - P - (v / 100) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.score).toFixed(1)}`).join(' ');
  return (
    <svg className="cr-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scores over time">
      <path d={`${d} L${xs(points.length - 1)} ${H} L${xs(0)} ${H} Z`} className="area" /><path d={d} className="line" pathLength={1} />
      {points.map((p, i) => <circle key={i} cx={xs(i)} cy={ys(p.score)} r={i === points.length - 1 ? 4.5 : 2.6} style={{ fill: colour(p.score) }} />)}
    </svg>
  );
}

function Video({ v }: { v: Video }) {
  const [play, setPlay] = useState(false), [thumb, setThumb] = useState(false);
  useEffect(() => { if (!v.id) return; const im = new Image(); im.onload = () => setThumb(true); im.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`; }, [v.id]);
  if (!v.id) return <section className="st-card cr-video empty"><Icon n="video" size={28} /><b>The training video is coming soon.</b><span>Your counselor will add it here.</span></section>;
  return (
    <section className="st-card cr-video" style={{ ['--i' as string]: 1 }}>
      <div className="frame">
        {play ? <iframe src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`} title={v.title || 'Training video'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : <button className="poster" onClick={() => setPlay(true)} aria-label={`Play video: ${v.title || 'Training video'}`}>
            {thumb && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" />}
            <span className="shade" /><span className="play"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M8 5v14l11-7z" fill="currentColor" /></svg></span><span className="tag"><Icon n="video" size={14} /> Watch first</span>
          </button>}
      </div>
      <div className="meta"><h2>{v.title || 'Credibility test training'}</h2>{v.description && <p>{v.description}</p>}</div>
    </section>
  );
}

function Result({ a, onRetry }: { a: CAttempt; onRetry?: () => void }) {
  const band = bandFor(a.score), shown = CRITERIA.filter((c) => typeof a.criteria?.[c.key] === 'number');
  return (
    <div className="cr-result" data-tone={band.tone}>
      <div className="top">
        <Ring score={a.score} />
        <div className="head"><span className="band" style={{ background: colour(a.score) }}>{band.label}</span>{a.mode === 'basic' && <span className="quick" title="Detailed AI feedback was unavailable, so this is an estimate.">Quick check</span>}
          {a.summary && <p>{a.summary}</p>}</div>
      </div>
      {a.flags.length > 0 && <div className="cr-flag"><Icon n="alert" size={16} /><div>{a.flags.map((f) => <p key={f}>{f}</p>)}</div></div>}
      <div className="cols">
        <div className="col good"><h4><Icon n="check-circle" size={16} /> What you did well</h4>{a.did_well.length ? <ul>{a.did_well.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="none">Nothing stood out yet. Use the tips and try again.</p>}</div>
        <div className="col miss"><h4><Icon n="alert" size={16} /> What is missing</h4>{a.missing.length ? <ul>{a.missing.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="none">Nothing important is missing.</p>}</div>
        <div className="col fix"><h4><Icon n="trend" size={16} /> What to improve</h4>{a.improve.length ? <ul>{a.improve.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="none">No major problems found.</p>}</div>
      </div>
      {a.suggestions.length > 0 && <div className="sug"><h4><Icon n="spark" size={16} /> Make it stronger</h4><ul>{a.suggestions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {shown.length > 0 && <div className="crit">{shown.map((c, i) => { const v = a.criteria[c.key] as number; return (
        <div key={c.key} className="row"><span>{c.label}</span><div className="cbar"><i style={{ width: `${v}%`, background: colour(v), animationDelay: `${i * 70}ms` }} /></div><b>{v}</b></div>); })}</div>}
      {onRetry && <div className="act"><button className="st-btn" onClick={onRetry}>Improve and try again</button></div>}
    </div>
  );
}

export default function CredTrainer({ video, questions: qs, attempts: initAttempts, stats: initStats, canPractise, preview = false }: { video: Video; questions: CQuestion[]; attempts: CAttempt[]; stats: Stats; canPractise: boolean; preview?: boolean }) {
  const [attempts, setAttempts] = useState(initAttempts);
  const [stats, setStats] = useState(initStats);
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => { try { const d = JSON.parse(localStorage.getItem('cred-drafts') || '{}'); if (d && typeof d === 'object') setDrafts(d); } catch { /* optional */ } }, []);
  const setDraft = (id: string, t: string) => setDrafts((d) => { const n = { ...d, [id]: t }; try { localStorage.setItem('cred-drafts', JSON.stringify(n)); } catch { /* optional */ } return n; });

  const forQ = (id: string) => attempts.filter((a) => a.question_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const stage = stats.attempts === 0 ? 0 : (stats.latest ?? 0) < 75 ? 5 : 2;

  async function submit(q: CQuestion) {
    const answer = (drafts[q.id] || '').trim();
    if (answer.length < 10 || busy) return;
    setBusy(q.id); setErr('');
    try {
      const r = await fetch('/api/credibility/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: q.id, answer }) });
      const d = (await r.json()) as { ok: boolean; error?: string; attempt?: CAttempt & { flags: string[] }; stats?: Stats };
      if (!d.ok || !d.attempt || !d.stats) throw new Error(d.error || 'Could not check your answer.');
      const a = { ...d.attempt, flags: (d.attempt.flags || []).filter((f) => !f.startsWith('internal:')) };
      setAttempts((l) => [...l, a]); setStats(d.stats);
      if (q.model) setModels((m) => ({ ...m, [q.id]: q.model! }));
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }

  const STEPS = ['Watch', 'Learn', 'Practise', 'Answer', 'Get scored', 'Improve', 'Try again'];
  return (
    <>
      <section className="cr-hero" style={{ ['--i' as string]: 0 }}>
        <div><span className="eyebrow"><Icon n="spark" size={14} /> Regent College London</span><h1 className="st-h1">Credibility Test Training</h1>
          <p className="st-sub">Learn what the interviewer looks for, then practise in your own words and see exactly how to improve.</p></div>
        <ol className="cr-flow" aria-label="How this works">{STEPS.map((s, i) => <li key={s} className={i === stage ? 'on' : i < stage ? 'done' : ''} style={{ ['--k' as string]: i }}><span>{i + 1}</span>{s}</li>)}</ol>
      </section>

      <Video v={video} />

      <section className="cr-learn" style={{ ['--i' as string]: 2 }} aria-label="Key ideas">
        {LEARN.map((l, i) => <article key={l.t} style={{ ['--k' as string]: i }}><span className="ic"><Icon n={l.icon} size={20} /></span><h3>{l.t}</h3><p>{l.d}</p></article>)}
      </section>

      <section className="st-card cr-progress" style={{ ['--i' as string]: 3 }}>
        <div className="hd"><h2>Your progress</h2>{stats.attempts > 0 && <span className="chip">{stats.attempts} attempt{stats.attempts === 1 ? '' : 's'}</span>}</div>
        {stats.attempts === 0 ? <div className="empty"><Icon n="bolt" size={26} /><b>Start with any question below.</b><span>Your scores, average and areas to improve will show here.</span></div> : (
          <div className="grid">
            <div className="ringbox"><Ring score={stats.average ?? 0} size={120} label="average" /></div>
            <div className="stats">
              <div><b>{stats.completed}<small>/{stats.totalQuestions}</small></b><span>Questions done</span></div>
              <div><b style={{ color: colour(stats.best ?? 0) }}>{stats.best}</b><span>Highest score</span></div>
              <div><b style={{ color: colour(stats.latest ?? 0) }}>{stats.latest}</b><span>Latest score</span></div>
            </div>
            <div className="trend"><h4>Progress over time</h4><Spark points={stats.trend} /></div>
            <div className="weak"><h4>Where to focus</h4>{stats.weak.length === 0 ? <p className="ok">{stats.attempts < 2 ? 'Practise a couple more questions to see your focus areas.' : 'No weak areas right now. Keep practising different questions.'}</p> : stats.weak.map((w) => (
              <div key={w.key} className="w"><div className="r"><span>{w.label}</span><b>{w.avg}</b></div><div className="cbar"><i style={{ width: `${w.avg}%`, background: colour(w.avg) }} /></div><p>{TIP[w.key]}</p></div>))}</div>
          </div>)}
      </section>

      <div className="cr-qhead" style={{ ['--i' as string]: 4 }}><h2>Practice questions</h2><span>{qs.length} questions</span></div>
      {!canPractise && <div className="st-card">{preview ? 'Preview mode: this is exactly what a Regent student sees. They type an answer under each question, press “Check my answer” and get a score with feedback.' : 'Practice is available once your application is linked to Regent College London.'}</div>}
      <div className="cr-qs">
        {qs.map((q, n) => {
          const list = forQ(q.id), last = list[0], isOpen = open === q.id, draft = drafts[q.id] || '', words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
          return (
            <article key={q.id} className={`cr-q ${isOpen ? 'open' : ''}`} style={{ ['--k' as string]: n }}>
              <button className="qh" onClick={() => { setOpen(isOpen ? null : q.id); setErr(''); }} aria-expanded={isOpen}>
                <span className="qn">{n + 1}</span>
                <span className="qt"><b>{q.question}</b><small>{CATEGORY_LABEL[q.category] || 'General'}</small></span>
                {last ? <span className="pill" style={{ background: colour(last.score) }}>{last.score}</span> : <span className="pill new">New</span>}
                <span className="chev"><Icon n="down" size={18} /></span>
              </button>
              {isOpen && (
                <div className="qb">
                  {q.guidance && <div className="tips"><h4><Icon n="spark" size={15} /> A strong answer</h4><ul>{q.guidance.split('\n').filter(Boolean).map((t) => <li key={t}>{t}</li>)}</ul></div>}
                  {canPractise && <>
                    <label className="ans"><span className="sr">Your answer</span>
                      <textarea ref={(el) => { refs.current[q.id] = el; }} value={draft} maxLength={1500} rows={5} placeholder="Write it the way you would say it. Short, specific and honest is best." onChange={(e) => setDraft(q.id, e.target.value)} disabled={busy === q.id} />
                      <small>{words} words · {draft.length}/1500</small></label>
                    {err && open === q.id && <div className="st-err">{err}</div>}
                    {busy === q.id ? <div className="cr-busy" role="status"><span className="dots"><i /><i /><i /></span> Reading your answer and checking it against your application…<div className="sk"><i /><i /><i /></div></div>
                      : <button className="st-btn" disabled={draft.trim().length < 10} onClick={() => submit(q)}>{last ? 'Check this version' : 'Check my answer'}<Icon n="arrow" size={16} /></button>}
                  </>}
                  {last && busy !== q.id && <Result a={last} onRetry={() => { refs.current[q.id]?.focus(); refs.current[q.id]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} />}
                  {last && (q.model || models[q.id]) && (
                    <div className="model">
                      <button className="lnk" onClick={() => setModel(model === q.id ? null : q.id)}>{model === q.id ? 'Hide' : 'See'} an example answer</button>
                      {model === q.id && <div className="box"><p>{q.model || models[q.id]}</p><small>Use this to see the structure only. Your answer must come from your own life and research. Interviewers can tell when an answer is memorised.</small></div>}
                    </div>)}
                  {list.length > 1 && (
                    <div className="hist"><button className="lnk" onClick={() => setHist(hist === q.id ? null : q.id)}>{hist === q.id ? 'Hide' : 'Show'} previous attempts ({list.length - 1})</button>
                      {hist === q.id && <ul>{list.slice(1).map((a) => <li key={a.id}><div className="r"><span className="pill" style={{ background: colour(a.score) }}>{a.score}</span><span>{a.band}</span><small>{when(a.created_at)}</small></div><p>{a.answer}</p></li>)}</ul>}
                    </div>)}
                </div>)}
            </article>
          );
        })}
      </div>
      <p className="cr-note">Practice only. Scores are guidance from an automated coach, not an official UKVI or university result. Your answers are analysed by an AI service and shared with your counselor so they can help you.</p>
      <div className="cr-bands" aria-label="Score guide">{[...BANDS].reverse().map((b) => <span key={b.label}><i style={{ background: TONE[b.tone] }} />{b.min}–{b.max} {b.label}</span>)}</div>
    </>
  );
}

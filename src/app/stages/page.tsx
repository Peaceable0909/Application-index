import Link from 'next/link';
import { requireStaff, canSee } from '@/lib/auth';
import { currentWorkspace } from '@/lib/workspace';
import { loadStageBoard, type BoardCard } from '@/lib/stageBoard';
import Icon from '@/components/Icon';
import PlaceByStatusButton from '@/components/PlaceByStatusButton';

export const maxDuration = 60;

type SP = { school?: string; q?: string; counselor?: string; only?: string };

const chips = (c: BoardCard) => (
  <div className="chips">
    {c.delayed > 0 && <span className="badge plain red">{c.delayed}d overdue</span>}
    {c.openDocs > 0 && <span className="badge plain amber">{c.openDocs} doc{c.openDocs === 1 ? '' : 's'} open</span>}
    {c.open > c.openDocs && <span className="badge plain amber">{c.open - c.openDocs} to confirm</span>}
    {c.stageKey && c.ready && <span className="badge plain green">Ready</span>}
    {!c.stageKey && c.suggest && <span className="badge plain blue">Looks like “{c.suggest.name}”</span>}
  </div>
);

export default async function Stages({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const ws = await currentWorkspace();
  const board = await loadStageBoard(ws, (c) => canSee(staff, c));
  const school = board.schools.find((s) => s.key === sp.school) || board.schools.find((s) => s.cards.length) || board.schools[0];
  const q = (sp.q || '').toLowerCase();
  const counselors = school ? [...new Set(school.cards.map((c) => c.counselor).filter(Boolean))].sort() as string[] : [];
  const cards = school ? school.cards.filter((c) =>
    (!q || [c.name, c.programme, c.counselor].filter(Boolean).join(' ').toLowerCase().includes(q)) &&
    (!sp.counselor || (sp.counselor === '__none' ? !c.counselor : c.counselor === sp.counselor)) &&
    (sp.only === 'late' ? c.delayed > 0 : sp.only === 'docs' ? c.openDocs > 0 : sp.only === 'ready' ? c.stageKey && c.ready : sp.only === 'new' ? !c.stageKey : true)) : [];
  const all = school?.cards || [];
  const stats = { total: all.length, late: all.filter((c) => c.delayed > 0).length, docs: all.filter((c) => c.openDocs > 0).length, ready: all.filter((c) => c.stageKey && c.ready).length, fresh: all.filter((c) => !c.stageKey).length };
  const placeable = board.schools.flatMap((s) => s.cards).filter((c) => !c.stageKey && c.suggest).length;
  const href = (o: Partial<SP>) => { const p = new URLSearchParams(); const m = { school: school?.key, q: sp.q, counselor: sp.counselor, only: sp.only, ...o }; Object.entries(m).forEach(([k, v]) => v && p.set(k, v)); const s = p.toString(); return `/stages${s ? `?${s}` : ''}`; };
  const byStage = new Map<string, BoardCard[]>();
  cards.forEach((c) => { const k = c.stageKey || ''; (byStage.get(k) || byStage.set(k, []).get(k)!).push(c); });

  return (
    <>
      <div className="head"><h1>Stages</h1><span className="badge plain">{all.length} application{all.length === 1 ? '' : 's'}</span></div>
      <p className="sub">Where every application is on its school’s own route, what is still open, and which ones are stuck.{staff.role === 'counselor' ? ' You see your own students.' : ''}</p>

      {!board.schools.length ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No school has a stage workflow in this workspace yet.{staff.role === 'admin' ? <> <Link href="/workflows">Set one up on the Workflows page</Link>.</> : ' Ask an admin to set one up.'}</p></div>
      ) : (
        <>
          <nav className="sg-schools" aria-label="Schools">
            {board.schools.map((s) => <Link key={s.key} href={`/stages?school=${s.key}`} className={school?.key === s.key ? 'on' : ''} scroll={false}>{s.name.replace(/\s*\(.*\)\s*$/, '') === s.name ? s.name : (s.name.match(/\(([^)]+)\)/)?.[1] || s.name)} <span className="c">{s.cards.length}</span></Link>)}
            {staff.role === 'admin' && <Link href="/workflows" className="c" style={{ background: 'transparent', border: '1px dashed var(--line)' }}><Icon n="settings" size={14} /> Edit workflows</Link>}
          </nav>

          <div className="sg-stats">
            <div><small>In this workflow</small><b>{stats.total}</b></div>
            <div className={stats.late ? 'bad' : ''}><small>Overdue in stage</small><b>{stats.late}</b></div>
            <div><small>Documents open</small><b>{stats.docs}</b></div>
            <div><small>Ready to move on</small><b>{stats.ready}</b></div>
            <div><small>Not started</small><b>{stats.fresh}</b></div>
          </div>

          <form className="card toolbar filters" method="get">
            <input type="hidden" name="school" value={school?.key || ''} />
            <div className="search"><input name="q" placeholder="Search students…" defaultValue={sp.q} /></div>
            {staff.role !== 'counselor' && <select name="counselor" defaultValue={sp.counselor || ''}><option value="">All counselors</option><option value="__none">(unassigned)</option>{counselors.map((c) => <option key={c}>{c}</option>)}</select>}
            <select name="only" defaultValue={sp.only || ''}><option value="">Everything</option><option value="late">Overdue only</option><option value="docs">With documents open</option><option value="ready">Ready to move on</option><option value="new">Not started</option></select>
            <button className="btn">Filter</button>
            {(sp.q || sp.counselor || sp.only) && <Link href={href({ q: undefined, counselor: undefined, only: undefined })} className="btn ghost">Clear</Link>}
            {staff.role === 'admin' && placeable > 0 && <PlaceByStatusButton count={placeable} />}
          </form>

          {school && (
            <div className="sg-board" aria-label={`${school.name} stages`}>
              {byStage.has('') && (
                <section className="sg-col">
                  <header><b>Not started</b><span>{byStage.get('')!.length}</span></header>
                  {byStage.get('')!.map((c) => <Link key={c.id} href={`/applications/${encodeURIComponent(c.id)}?tab=stage`} className="sg-app"><b>{c.name}</b><small>{[c.programme, c.counselor].filter(Boolean).join(' · ') || 'No programme'}</small><small>Status: {c.status || 'not set'}</small>{chips(c)}</Link>)}
                </section>
              )}
              {school.stages.map((s) => {
                const list = byStage.get(s.key) || [];
                return (
                  <section key={s.key} className={`sg-col${list.length ? '' : ' off'}`}>
                    <header><b>{s.name}</b><span>{list.length}</span></header>
                    {list.map((c) => <Link key={c.id} href={`/applications/${encodeURIComponent(c.id)}?tab=stage`} className="sg-app"><b>{c.name}</b><small>{[c.programme, c.counselor].filter(Boolean).join(' · ') || 'No programme'}</small><small>{c.days === 0 ? 'Moved today' : `${c.days} day${c.days === 1 ? '' : 's'} here`}{s.delay_days ? ` · allowed ${s.delay_days}` : ''}</small>{chips(c)}{c.labels.length > 0 && <small>Needs: {c.labels.join(', ')}{c.open > c.labels.length ? '…' : ''}</small>}</Link>)}
                    {!list.length && <small className="muted" style={{ padding: '2px 6px 6px' }}>Nobody here</small>}
                  </section>
                );
              })}
            </div>
          )}

          {(board.noWorkflow.length > 0 || board.noSchool > 0) && (
            <div className="card" style={{ marginTop: 8 }}>
              <h2 style={{ marginTop: 0 }}>Without a stage workflow</h2>
              <p className="muted" style={{ marginTop: -6 }}>These keep using their pipeline status until their school has a workflow.</p>
              <div className="chips">
                {board.noWorkflow.map((n) => staff.role === 'admin'
                  ? <Link key={n.school} href={`/workflows?new=${encodeURIComponent(n.school)}`} className="badge plain amber">{n.school} · {n.count}</Link>
                  : <span key={n.school} className="badge plain amber">{n.school} · {n.count}</span>)}
                {board.noSchool > 0 && <span className="badge plain">No school set · {board.noSchool}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

import { currentWorkspace } from '@/lib/workspace';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { brainEnabled } from '@/lib/brain';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import BrainTest from '@/components/BrainTest';
import { addBrainNote, deleteBrainNote, toggleBrainNote } from '../brainActions';

export const metadata = { title: 'AI Brain' };

export default async function Brain({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireTeam();
  const sp = await searchParams;
  const db = admin(), ws = await currentWorkspace();
  const [{ data: notes }, { data: schools }] = await Promise.all([
    db.from('portal_brain_notes').select('*').eq('workspace', ws).order('updated_at', { ascending: false }),
    db.from('portal_applications').select('school').eq('workspace', ws).not('school', 'is', null).limit(1500),
  ]);
  const schoolList = [...new Set((schools || []).map((s) => (s.school || '').trim()).filter(Boolean))].sort().slice(0, 80);
  const on = brainEnabled();
  return (
    <>
      <div className="head"><h1>AI Brain</h1></div>
      <p className="sub">Helps your team answer and inform students: it reads one student’s file and the notes you write here, then drafts a message for a person to check and send.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}

      <div className="card">
        <h2>Status <span className={`badge plain ${on ? 'green' : ''}`} style={{ marginLeft: 6 }}>{on ? 'on' : 'off'}</span></h2>
        {on
          ? <p className="muted" style={{ margin: 0 }}>On. Open any student chat and press <b>Suggest a reply</b>. It only fills the message box; a person reads it, edits it and sends it.</p>
          : <><p className="muted" style={{ marginTop: 0 }}>Off. Turning it on sends the student’s recent chat messages and file facts (never their name, email or phone) to Qwen to write a draft. Use it only if your students have agreed to that.</p>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}><li>In Vercel add the variable <code>AI_BRAIN</code> = <code>on</code> and redeploy.</li></ol></>}
      </div>

      <div className="card">
        <h2>How it behaves</h2>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>It uses only the student’s file, the notes below and the recent chat. If the answer isn’t there it says the team will check, and flags the draft for a closer look.</li>
          <li>It never invents dates, fees, links, phone numbers or emails, and never promises an offer, admission or visa. Drafts that try are thrown away.</li>
          <li>It never sends anything. Every message goes out only when a person presses send.</li>
          <li>Each draft uses one of the daily AI calls (limit in Settings → AI usage).</li>
        </ul>
      </div>

      <div className="card">
        <h2><Icon n="note" size={17} /> What the Brain knows</h2>
        <p className="muted" style={{ marginTop: 0 }}>Write facts once and the Brain uses them in every reply: requirements, how to pay, visa steps, office hours. Pick a school to make a note apply to that school’s students only. Don’t put phone numbers or personal data here.</p>
        <form action={addBrainNote} className="grid" style={{ gap: 8, marginBottom: 16 }}>
          <div className="filters"><input name="title" placeholder="Title, e.g. RCL entry requirements" required minLength={2} maxLength={80} style={{ flex: 1, minWidth: 220 }} />
            <select name="school" defaultValue=""><option value="">All schools</option>{schoolList.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <textarea name="body" rows={3} maxLength={1500} required placeholder="What should the Brain know? Plain sentences work best." />
          <div><Btn>Add note</Btn></div>
        </form>
        <div className="grid" style={{ gap: 10 }}>
          {(notes || []).map((n) => (
            <div key={n.id} className="callout" style={{ opacity: n.active ? 1 : .55, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}><b>{n.title}</b> <span className="badge plain">{n.school || 'All schools'}</span>{!n.active && <> <span className="badge plain amber">off</span></>}
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{n.body}</p></div>
              <div className="filters">
                <form action={toggleBrainNote}><input type="hidden" name="id" value={n.id} /><Btn className="ghost sm">{n.active ? 'Switch off' : 'Switch on'}</Btn></form>
                <form action={deleteBrainNote}><input type="hidden" name="id" value={n.id} /><Btn className="ghost sm">Delete</Btn></form>
              </div>
            </div>))}
          {!(notes || []).length && <p className="muted" style={{ margin: 0 }}>No notes yet. Without notes the Brain can only talk about the student’s own file (their stage, documents and what’s missing).</p>}
        </div>
      </div>

      <BrainTest on={on} />
    </>
  );
}

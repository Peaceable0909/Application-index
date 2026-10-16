import { currentWorkspace } from '@/lib/workspace';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { brainEnabled } from '@/lib/brain';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import BrainTest from '@/components/BrainTest';
import { addBrainNote, deleteBrainDoc, deleteBrainNote, saveCountryBrief, saveRequiredDocs, setAutoReply, toggleBrainDoc, toggleBrainNote } from '../brainActions';
import BrainLearn from '@/components/BrainLearn';
import { requiredDocs } from '@/lib/workspace';

export const metadata = { title: 'AI Brain' };

export default async function Brain({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const db = admin(), ws = await currentWorkspace();
  const { data: wsRow } = await db.from('portal_workspaces').select('name, brief, required_docs, auto_reply').eq('key', ws).maybeSingle();
  const required = await requiredDocs(ws);
  const { data: docs } = await db.from('portal_brain_docs').select('id, title, school, chars, active, created_at, created_by').eq('workspace', ws).order('created_at', { ascending: false });
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
        <h2><Icon n="chat" size={17} /> Automatic replies <span className={`badge plain ${wsRow?.auto_reply ? 'green' : ''}`} style={{ marginLeft: 6 }}>{wsRow?.auto_reply ? 'on' : 'off'}</span></h2>
        <p className="muted" style={{ marginTop: 0 }}>{wsRow?.auto_reply
          ? 'On for this country. When a student writes, the Brain answers by itself if it is sure, and labels the message “AI assistant”. If it is not sure it tells the student a counselor will reply, and leaves it to you.'
          : 'Off. Today the Brain only drafts and a person sends. You can let it answer by itself, the way an assistant on WhatsApp Business does.'}</p>
        <ul style={{ margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>It steps back for 30 minutes whenever a person writes in that chat, and you can pause it for one student from the chat itself.</li>
          <li>It ignores “ok” and “thanks”, sends at most 6 automatic messages per student a day, and hands over to a person when a student sounds upset or worried about money.</li>
          <li>Every automatic message is labelled, and you can read all of them in the chat.</li>
        </ul>
        {me.role === 'admin'
          ? <form action={setAutoReply}><input type="hidden" name="on" value={wsRow?.auto_reply ? '0' : '1'} /><Btn className={wsRow?.auto_reply ? 'ghost' : 'primary'}>{wsRow?.auto_reply ? 'Turn automatic replies off' : `Turn on for ${wsRow?.name || 'this country'}`}</Btn></form>
          : <p className="muted" style={{ margin: 0 }}>Only admins can change this.</p>}
      </div>

      <div className="card">
        <h2>How it behaves</h2>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>It uses only the student’s file, the notes and files below, and the recent chat. If the answer isn’t there it says the team will check, and flags the draft for a closer look.</li>
          <li>It never invents dates, fees, links, phone numbers or emails, and never promises an offer, admission or visa. Drafts that try are thrown away.</li>
          <li>Unless automatic replies are on, it never sends anything: every message goes out only when a person presses send.</li>
          <li>Each draft uses one of the daily AI calls (limit in Settings → AI usage).</li>
        </ul>
      </div>

      <div className="card">
        <h2><Icon n="globe" size={17} /> About {wsRow?.name || 'this country'}</h2>
        <p className="muted" style={{ marginTop: 0 }}>A short overview the Brain reads before every reply for this workspace: how applying works here, the usual steps, who the students are, how you want it to sound.</p>
        <form action={saveCountryBrief} className="grid" style={{ gap: 8 }}>
          <textarea name="brief" rows={5} maxLength={3000} defaultValue={wsRow?.brief || ''} placeholder="e.g. Students apply to Canadian colleges through ... The usual order is: documents, offer letter, study permit ..." />
          <div><Btn>Save</Btn></div>
        </form>
      </div>

      <div className="card">
        <h2><Icon n="file" size={17} /> Documents students need{wsRow?.name ? ` · ${wsRow.name}` : ''}</h2>
        <p className="muted" style={{ marginTop: 0 }}>One per line. These decide what counts as “missing”, what students are asked to upload, and what the Brain says is still needed. Leave it empty to use the original list.{wsRow?.required_docs ? '' : ' Right now it is the original list.'}</p>
        <form action={saveRequiredDocs} className="grid" style={{ gap: 8 }}>
          <textarea name="docs" rows={7} maxLength={900} defaultValue={required.join('\n')} placeholder={'Passport\nTranscript\nBank statement'} />
          <div><Btn>Save the list</Btn></div>
        </form>
      </div>

      <div className="card">
        <h2><Icon n="upload" size={17} /> Teach from a file</h2>
        <p className="muted" style={{ marginTop: 0 }}>Upload a school handbook, a requirements sheet or a price list. The Brain keeps the text and quotes the parts that match what a student asks. Pick a school to use it only for that school’s students.</p>
        <BrainLearn schools={schoolList} />
        {(docs || []).length > 0 && (
          <div className="grid" style={{ gap: 10, marginTop: 16 }}>
            {(docs || []).map((d) => (
              <div key={d.id} className="callout" style={{ opacity: d.active ? 1 : .55, alignItems: 'center' }}>
                <div style={{ flex: 1 }}><b>{d.title}</b> <span className="badge plain">{d.school || 'All schools'}</span>{!d.active && <> <span className="badge plain amber">off</span></>}
                  <div className="muted" style={{ fontSize: 12.5 }}>{d.chars.toLocaleString()} characters · added {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div></div>
                <div className="filters">
                  <form action={toggleBrainDoc}><input type="hidden" name="id" value={d.id} /><Btn className="ghost sm">{d.active ? 'Switch off' : 'Switch on'}</Btn></form>
                  <form action={deleteBrainDoc}><input type="hidden" name="id" value={d.id} /><Btn className="ghost sm">Delete</Btn></form>
                </div>
              </div>))}
          </div>
        )}
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

import { requireTeam, twoStepPolicy } from '@/lib/auth';
import { twoStepStatus } from '@/lib/twoStep';
import { IDLE_MIN, MAX_HOURS } from '@/lib/session';
import { resetTwoStep, setTwoStepPolicy } from '../twoStepActions';
import { weeklyConfig } from '@/lib/weeklyReport';
import { previewWeeklySummary, saveWeeklySummary } from '../reportActions';
import Btn from '@/components/Btn';
import { admin } from '@/lib/supabase';
import Link from 'next/link';
import { addStaff, backupNow, removeStaff, sendTestEmails, testConnection } from '../actions';
import { createWorkspace, setStaffWorkspaces } from '../workspaceActions';
import { listWorkspaces } from '@/lib/workspace';
import { listBackups } from '@/lib/backup';
import Icon from '@/components/Icon';
import PrivacyCheck from '@/components/PrivacyCheck';

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const db = admin();
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const { data: usage } = await db.from('portal_ai_usage').select('kind,tokens,ok').gte('created_at', day.toISOString());
  const calls = (usage || []).length, tokens = (usage || []).reduce((n, u) => n + (u.tokens || 0), 0), failed = (usage || []).filter((u) => !u.ok).length;
  const workspaces = await listWorkspaces();
  const counts: Record<string, number> = {};
  await Promise.all(workspaces.map(async (w) => { counts[w.key] = (await db.from('portal_applications').select('application_id', { count: 'exact', head: true }).eq('workspace', w.key)).count || 0; }));
  const [{ data: staff }, policy, weekly, twoSteps] = await Promise.all([
    db.from('portal_staff').select('*').order('email'),
    twoStepPolicy(),
    weeklyConfig(),
    me.role === 'admin' ? twoStepStatus().catch(() => new Map<string, boolean>()) : Promise.resolve(new Map<string, boolean>()),
  ]);
  return (
    <>
      <h1>Settings</h1>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="card">
        <h2>Apps Script connection</h2>
        <p className="muted" style={{ marginTop: 0 }}>Checks that the portal can reach your Google Apps Script web app (the link behind the sheets, Drive and AI features).</p>
        <form action={testConnection}><Btn className="ghost">Test connection</Btn></form>
      </div>

      <div className="card">
        <h2>Instant updates &amp; private documents</h2>
        <p className="muted" style={{ marginTop: 0 }}>Two background jobs inside your Apps Script keep the portal fresh and your students’ files private — no changes to your form script needed.</p>
        <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>In Apps Script, open <b>PortalApi</b> and find <code>PORTAL_SITE_URL</code> and <code>PORTAL_CRON_SECRET</code> (near <i>Background triggers</i>).</li>
          <li>Set <code>PORTAL_SITE_URL</code> to <code>{process.env.NEXT_PUBLIC_SITE_URL || 'your portal address'}</code> and <code>PORTAL_CRON_SECRET</code> to the same value as <code>CRON_SECRET</code> in Vercel. Save.</li>
          <li>Choose <b>portalInstallTriggers</b> in the function dropdown, click <b>Run</b>, and approve the permissions.</li>
          <li>(Once) run <b>lockDownExistingFolders</b> to make all earlier student folders private too.</li>
        </ol>
        <p className="muted" style={{ marginBottom: 0 }}>After that: new applications and sheet edits show up within about a minute, and any new student folder is made team-only within ten minutes.</p>
      </div>

      <div className="card">
        <h2><Icon n="download" size={17} /> Backups</h2>
        <p className="muted">Every night the portal saves a private, compressed copy of its own data (students, notes, activity, messages, chat, staff). The newest 14 are kept. Your Google Sheet and Drive files are not copied; they keep their own version history.</p>
        {me.role === 'admin' ? (
          <>
            <form action={backupNow}><Btn data-busy="Backing up…">Back up now</Btn></form>
            <table style={{ marginTop: 12 }}><tbody>
              {(await listBackups().catch(() => [])).map((b) => <tr key={b.name}><td>{b.name}</td><td className="muted">{b.size ? `${Math.round(b.size / 1024)} KB` : ''}</td><td><a href={`/api/backup?file=${b.name}`}>Download</a></td></tr>)}
            </tbody></table>
          </>
        ) : <p className="muted">Admins can create and download backups.</p>}
      </div>
      <div className="card">
        <h2><Icon n="mail" size={17} /> Email design</h2>
        <p className="muted">Every email the portal sends (document requests, digests, messages to students and counselors) uses the same branded layout, signed with your name, title and photo from <Link href="/profile">My profile</Link>.</p>
        <div className="filters">
          <a className="btn ghost sm" href="/api/email/preview?kind=student" target="_blank">Preview: document request</a>
          <a className="btn ghost sm" href="/api/email/preview?kind=digest" target="_blank">Preview: counselor digest</a>
          <a className="btn ghost sm" href="/api/email/preview?kind=custom" target="_blank">Preview: a message</a>
        </div>
        <form action={sendTestEmails} style={{ marginTop: 14 }}><Btn data-busy="Sending…">Send me the 3 sample emails</Btn></form>
      </div>
      <div className="card">
        <h2>Weekly counselor digest <span className={`badge plain ${process.env.WEEKLY_DIGEST === 'on' ? 'green' : ''}`} style={{ marginLeft: 6 }}>{process.env.WEEKLY_DIGEST === 'on' ? 'on' : 'off'}</span></h2>
        <p className="muted">Every Monday morning each counselor with an email saved gets one email listing their students who need attention. Nothing is sent when they have none. It is off until you turn it on:</p>
        <ol><li>In Vercel add the variable <code>WEEKLY_DIGEST</code> = <code>on</code> and redeploy.</li></ol>
      </div>
      <div className="card">
        <h2>AI document check <span className={`badge plain ${process.env.AI_DOC_SCAN === 'on' ? 'green' : ''}`} style={{ marginLeft: 6 }}>{process.env.AI_DOC_SCAN === 'on' ? 'on' : 'off'}</span></h2>
        <p className="muted" style={{ marginTop: 0 }}>An opt-in helper that reads one document at a time and flags a wrong type, a mismatched name or a passport near expiry. Because it sends the document’s text to Qwen (Alibaba Cloud), it is <b>off by default</b>. Use it only if your students have agreed to that.</p>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>In Apps Script: <b>Services (+) → Drive API → Add</b>, then run any function once to approve the new permissions.</li>
          <li>In Vercel add the variable <code>AI_DOC_SCAN</code> = <code>on</code> and redeploy.</li>
        </ol>
      </div>

      <div className="card">
        <h2>AI usage today</h2>
        <dl className="kv wide-k">
          <dt>Qwen calls</dt><dd><b>{calls}</b> of {process.env.AI_DAILY_LIMIT || 60} allowed</dd>
          <dt>Tokens used</dt><dd>{tokens.toLocaleString()}</dd>
          <dt>Rejected / failed</dt><dd>{failed} <span className="muted">(replies that failed the safety checks or errored)</span></dd>
        </dl>
        <p className="muted" style={{ marginBottom: 0 }}>The limit and key live in your settings: <code>AI_DAILY_LIMIT</code> (Vercel) and <code>QWEN_API_KEY</code> (Apps Script).</p>
      </div>

      {me.role === 'admin' && <PrivacyCheck />}

      {me.role === 'admin' && (
        <div className="card" id="security">
          <h2><Icon n="lock" size={17} /> Sign-in security</h2>
          <p className="muted" style={{ marginTop: 0 }}>Team sign-ins end by themselves after <b>{IDLE_MIN} minutes</b> without use, and after <b>{MAX_HOURS} hours</b> in any case. Every time a person opens or downloads a student’s document it is written to the <Link href="/activity?tab=admin&act=docs">admin log</Link> (who, which file, when).</p>
          <form action={setTwoStepPolicy} className="filters">
            <label>Authenticator code (two-step) is required for&nbsp;
              <select name="who" defaultValue={policy}>
                <option value="off">nobody (optional)</option>
                <option value="admins">admins</option>
                <option value="everyone">everyone on the team and all counselors</option>
              </select>
            </label>
            <Btn className="ghost" data-busy="Saving…">Save</Btn>
          </form>
          <p className="muted">Turn it on for your own account first (<Link href="/profile#two-step">My profile</Link>). Anyone required to use it who has not set it up is taken to a short setup screen at their next page.</p>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Email</th><th>Role</th><th>Two-step</th><th /></tr></thead>
            <tbody>{(staff || []).map((s) => {
              const st = twoSteps.get(String(s.email).toLowerCase());
              return <tr key={s.email}><td>{s.email}</td><td>{s.role}</td><td>{st === undefined ? <span className="muted">never signed in</span> : st ? <span className="badge plain green">on</span> : <span className="badge plain">off</span>}</td>
                <td>{st && s.email !== me.email && <form action={resetTwoStep}><input type="hidden" name="email" value={s.email} /><Btn className="ghost sm" data-busy="Resetting…">Reset (lost phone)</Btn></form>}</td></tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {me.role === 'admin' && (
        <div className="card" id="weekly">
          <h2><Icon n="mail" size={17} /> Weekly summary for management <span className={`badge plain ${weekly.on ? 'green' : ''}`} style={{ marginLeft: 6 }}>{weekly.on ? 'on' : 'off'}</span></h2>
          <p className="muted" style={{ marginTop: 0 }}>Every Monday morning a short email goes to the people below: new chats, new students, offers and enrolments for the last 7 days (next to the 7 before), by country, with a link to the full <Link href="/reports">report</Link>.</p>
          <form action={saveWeeklySummary} className="grid" style={{ gap: 10, maxWidth: 460 }}>
            <label>Send to (up to 5 email addresses, separated by commas or spaces)
              <textarea name="emails" rows={2} defaultValue={weekly.emails.join(', ')} placeholder="boss@example.com, manager@example.com" style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="on" value="1" defaultChecked={weekly.on} /> Send it every Monday</label>
            <div className="filters"><Btn data-busy="Saving…">Save</Btn></div>
          </form>
          <form action={previewWeeklySummary} style={{ marginTop: 10 }}><Btn className="ghost" data-busy="Sending…">Send me a preview now</Btn></form>
          {weekly.last_sent && <p className="muted" style={{ marginBottom: 0 }}>Last sent: {new Date(weekly.last_sent).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>}
        </div>
      )}

      <div className="card">
        <h2>Counselors</h2>
        <p className="muted" style={{ marginTop: 0 }}>Counselor emails, assignments and digests now live on their own page.</p>
        <Link href="/counselors" className="btn ghost">Manage counselors →</Link>
      </div>

      {me.role === 'admin' && (
        <div className="card">
          <h2><Icon n="globe" size={17} /> Workspaces (countries)</h2>
          <p className="muted" style={{ marginTop: 0 }}>Each workspace is its own list of students, documents, chats and AI Brain notes. Staff only see the workspaces you give them, and a switcher appears at the top once they have more than one.</p>
          <table>
            <thead><tr><th>Name</th><th>Sheet tab</th><th>Students</th></tr></thead>
            <tbody>{workspaces.map((w) => <tr key={w.key}><td><b>{w.name}</b> <span className="muted">({w.key})</span></td><td>{w.master_tab}{w.extra_tab ? ` + ${w.extra_tab}` : ''}</td><td>{counts[w.key] || 0}</td></tr>)}</tbody>
          </table>
          <form action={createWorkspace} className="filters" style={{ marginTop: 12 }}>
            <input name="name" placeholder="Country, e.g. Canada" required minLength={2} maxLength={60} />
            <input name="tab" placeholder="Sheet tab, e.g. Canada" required />
            <Btn className="ghost">Create workspace</Btn>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Portal staff</h2>
        <table>
          <thead><tr><th>Email</th><th>Role</th>{workspaces.length > 1 && <th>Workspaces</th>}<th /></tr></thead>
          <tbody>
            {(staff || []).map((s) => (
              <tr key={s.email}><td>{s.email}</td><td>{s.role}</td>
                {workspaces.length > 1 && <td>{s.role === 'admin' ? <span className="muted">all</span> : me.role === 'admin' ? <form action={setStaffWorkspaces} className="filters" style={{ gap: 8 }}><input type="hidden" name="email" value={s.email} />{workspaces.map((w) => <label key={w.key} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" name="ws" value={w.key} defaultChecked={(s.workspaces || ['uk']).includes(w.key)} />{w.name}</label>)}<Btn className="ghost sm">Save</Btn></form> : (s.workspaces || ['uk']).join(', ')}</td>}
                <td>{me.role === 'admin' && s.email !== me.email && <form action={removeStaff}><input type="hidden" name="email" value={s.email} /><Btn className="ghost">Remove</Btn></form>}</td></tr>
            ))}
          </tbody>
        </table>
        {me.role === 'admin' ? (
          <form action={addStaff} className="filters" style={{ marginTop: 12 }}>
            <input name="email" type="email" placeholder="staff@example.com" required />
            <select name="role"><option value="staff">staff</option><option value="admin">admin</option></select>
            <Btn className="ghost">Allow access</Btn>
            <span className="muted">They also need a login created in Supabase Auth.</span>
          </form>
        ) : <p className="muted">Only admins can add staff.</p>}
      </div>
    </>
  );
}

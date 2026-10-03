import { requireTeam } from '@/lib/auth';
import Btn from '@/components/Btn';
import { admin } from '@/lib/supabase';
import Link from 'next/link';
import { addStaff, removeStaff, testConnection } from '../actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const db = admin();
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const { data: usage } = await db.from('portal_ai_usage').select('kind,tokens,ok').gte('created_at', day.toISOString());
  const calls = (usage || []).length, tokens = (usage || []).reduce((n, u) => n + (u.tokens || 0), 0), failed = (usage || []).filter((u) => !u.ok).length;
  const [{ data: staff }] = await Promise.all([
    
    db.from('portal_staff').select('*').order('email'),
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

      <div className="card">
        <h2>Counselors</h2>
        <p className="muted" style={{ marginTop: 0 }}>Counselor emails, assignments and digests now live on their own page.</p>
        <Link href="/counselors" className="btn ghost">Manage counselors →</Link>
      </div>

      <div className="card">
        <h2>Portal staff</h2>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>
            {(staff || []).map((s) => (
              <tr key={s.email}><td>{s.email}</td><td>{s.role}</td>
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

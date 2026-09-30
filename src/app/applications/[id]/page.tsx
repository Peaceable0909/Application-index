import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { attentionReasons, AppRow } from '@/lib/attention';
import { missingDocs, counselorKey, effType } from '@/lib/docs';
import { ALL_DOC_TYPES, STATUSES } from '@/lib/constants';
import { addNote, refreshDocuments, sendCounselorEmail, updateCounselor, updateStatus, uploadDocument } from '../../actions';

type SP = { msg?: string; err?: string; preview?: string };
const FIELDS: [string, string][] = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['school', 'University'], ['programme', 'Programme'], ['country', 'Country'], ['city', 'City'], ['gender', 'Gender'], ['dob', 'Date of birth'], ['age', 'Age'], ['counselor', 'Counselor'], ['status', 'Status'], ['notes', 'Notes']];
const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

function describe(kind: string, d: Record<string, string>) {
  switch (kind) {
    case 'new_application': return 'Application received';
    case 'status_change': return `Status: ${d.from || '—'} → ${d.to}`;
    case 'counselor_change': return `Counselor: ${d.from || '—'} → ${d.to || '—'}`;
    case 'note': return `Note: ${d.preview}`;
    case 'email_sent': return `Emailed ${d.to}: ${d.subject}`;
    case 'doc_uploaded': return `Uploaded ${d.name}`;
    case 'doc_retyped': return `Marked ${d.name} as ${d.type}`;
    default: return kind;
  }
}

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('*').eq('application_id', id).maybeSingle();
  if (!app) notFound();

  const [{ data: siblings }, { data: notes }, { data: activity }, { data: counselors }] = await Promise.all([
    db.from('portal_applications').select('application_id,submitted_at').eq('student_key', app.student_key).order('submitted_at', { ascending: false }),
    db.from('portal_notes').select('*').eq('application_id', id).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    db.from('portal_activity').select('*').eq('application_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('portal_counselors').select('name,email,active').order('name'),
  ]);
  const sibIds = (siblings || []).map((s) => s.application_id);
  const { data: docs } = await db.from('portal_documents').select('*').in('application_id', sibIds).order('created_at', { ascending: false });

  const missing = missingDocs((docs || []).map(effType));
  const reasons = attentionReasons(app as AppRow, missing, (docs || []).length);
  const counselor = (counselors || []).find((c) => counselorKey(c.name) === counselorKey(app.counselor));
  const previewDoc = sp.preview ? (docs || []).find((d) => d.drive_file_id === sp.preview) : null;

  const defaultBody =
    `Hi ${app.counselor || ''},\n\nUpdate on your student ${app.name} (${app.school} – ${app.programme}).\n` +
    `Status: ${app.status || 'not set'}\n` +
    (missing.length ? `Missing documents: ${missing.join(', ')}\n` : 'All required documents received.\n') +
    `\nThanks,`;

  return (
    <>
      <p><Link href="/">← All applications</Link></p>
      <h1>{app.name} {app.status && <span className="badge">{app.status}</span>}</h1>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}
      {reasons.length > 0 && <div className="card">{reasons.map((r) => <span key={r} className="badge red" style={{ marginRight: 6 }}>{r}</span>)}</div>}

      <div className="grid g2">
        <div className="card">
          <h2>Application</h2>
          <dl className="kv">
            <dt>University</dt><dd>{app.school}</dd><dt>Programme</dt><dd>{app.programme}</dd>
            <dt>Email</dt><dd>{app.email}</dd><dt>Phone</dt><dd>{app.phone}</dd>
            <dt>Country / City</dt><dd>{app.country} {app.city && `· ${app.city}`}</dd>
            <dt>Gender / DOB / Age</dt><dd>{[app.gender, app.dob, app.age].filter(Boolean).join(' · ')}</dd>
            <dt>Submitted</dt><dd>{app.submitted_at && fmt(app.submitted_at)}</dd>
            <dt>Drive folder</dt><dd>{app.drive_folder_url ? <a href={app.drive_folder_url} target="_blank">Open in Drive ↗</a> : '—'}</dd>
            {(siblings || []).length > 1 && (<><dt>Submissions</dt><dd>{(siblings || []).map((s) => s.application_id === id ? <b key={s.application_id}>this </b> : <Link key={s.application_id} href={`/applications/${s.application_id}`}>{s.submitted_at && new Date(s.submitted_at).toLocaleDateString('en-GB')} </Link>)}</dd></>)}
          </dl>
        </div>
        <div className="card">
          <h2>Manage</h2>
          <form action={updateStatus} className="filters"><input type="hidden" name="id" value={id} />
            <select name="status" defaultValue={app.status || ''}><option value="" disabled>Set status…</option>
              {app.status && !(STATUSES as readonly string[]).includes(app.status) && <option disabled>{app.status}</option>}{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <button>Update status</button></form>
          <form action={updateCounselor} className="filters" style={{ marginTop: 10 }}><input type="hidden" name="id" value={id} />
            <select name="counselor" defaultValue={app.counselor || ''}><option value="">Unassigned</option>
              {(counselors || []).filter((c) => c.active || c.name === app.counselor).map((c) => <option key={c.name}>{c.name}</option>)}</select>
            <button>Assign counselor</button></form>
          <p className="muted">Changes are written to {app.in_master ? 'your master sheet (Sheet1)' : 'the Applications sheet'}. Notes are added underneath, never overwriting yours.</p>
        </div>
      </div>

      <div className="card">
        <h2>Sources</h2>
        <p className="muted">
          {app.in_master ? 'Master sheet (Sheet1) is the curated record for status, counselor, notes and programme.' : <b>Not in the master sheet yet — only the raw form data exists.</b>}{' '}
          {app.has_raw ? 'The form log (Applications) supplies documents and submission details.' : <b>No form submission found for this student.</b>}
        </p>
        <table className="cmp">
          <thead><tr><th>Field</th><th>Master sheet (curated)</th><th>Form log (raw)</th></tr></thead>
          <tbody>
            {FIELDS.map(([k, label]) => {
              const m = String((app.master_data as Record<string, string> | null)?.[k] ?? ''), r = String((app.raw_data as Record<string, string> | null)?.[k] ?? '');
              const differs = app.in_master && app.has_raw && m.trim().toLowerCase() !== r.trim().toLowerCase() && m && r;
              return <tr key={k} className={differs ? 'diff' : ''}><td className="muted">{label}</td><td>{m || '—'}</td><td>{r || '—'}</td></tr>;
            })}
            {app.student_ref && <tr><td className="muted">Student ID</td><td>{app.student_ref}</td><td>—</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Documents <Link href={`/applications/${id}/documents`} style={{ fontSize: 13, marginLeft: 8 }}>Open document viewer →</Link></h2>
        <table>
          <thead><tr><th>Type</th><th>File</th><th>Added</th><th>Location</th><th /></tr></thead>
          <tbody>
            {(docs || []).map((d) => (
              <tr key={d.drive_file_id}>
                <td><span className="badge">{effType(d)}</span></td>
                <td>{d.name} <span className="muted">{kb(d.size_bytes)}</span>{d.application_id !== id && <span className="badge"> other submission</span>}{d.source === 'portal' && <span className="badge"> uploaded in portal</span>}</td>
                <td className="muted">{fmt(d.created_at)}</td>
                <td><a href={d.drive_url} target="_blank">Drive ↗</a> <span className="muted">· Whiterock Admissions / {app.name} …</span></td>
                <td><Link href={`/applications/${id}/documents?file=${d.drive_file_id}`}>View</Link> · <a href={`/api/files/${d.drive_file_id}?download=1`}>Download</a></td>
              </tr>
            ))}
            {!(docs || []).length && <tr><td colSpan={5} className="muted">No documents found.</td></tr>}
          </tbody>
        </table>
        {previewDoc && (
          <div style={{ marginTop: 12 }}>
            <b>{previewDoc.name}</b> · <Link href="?">close</Link>
            {previewDoc.mime_type?.startsWith('image/')
              ? <img src={`/api/files/${previewDoc.drive_file_id}`} alt={previewDoc.name} style={{ maxWidth: '100%', marginTop: 8 }} />
              : <iframe className="preview" src={`/api/files/${previewDoc.drive_file_id}`} />}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <b>Missing: </b>{missing.length ? missing.map((m) => <span key={m} className="badge amber" style={{ marginRight: 4 }}>{m}</span>) : <span className="badge green">nothing — complete</span>}
        </div>
        {app.drive_folder_id ? <form action={uploadDocument} className="filters" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={id} />
          <select name="docType" defaultValue={missing[0] || 'Other'}>{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input type="file" name="file" required />
          <button>Upload to Drive</button>
        </form> : <p className="muted">No Drive folder yet — this student hasn't submitted through the form.</p>}
        {app.drive_folder_id && <form action={refreshDocuments} style={{ marginTop: 8 }}><input type="hidden" name="id" value={id} /><button className="ghost">Refresh from Drive</button></form>}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Message counselor</h2>
          {!counselor?.email && <p className="err">No email saved for {app.counselor || 'a counselor'}. <Link href="/settings">Add it in Settings</Link>, or type one below.</p>}
          <form action={sendCounselorEmail} className="grid">
            <input type="hidden" name="id" value={id} />
            <input name="to" type="email" placeholder="Counselor email" defaultValue={counselor?.email || ''} className="wide" required />
            <input name="subject" defaultValue={`Update: ${app.name} – ${app.school}`} className="wide" required />
            <textarea name="body" defaultValue={defaultBody} required />
            <button>Send email</button>
          </form>
        </div>
        <div className="card">
          <h2>Notes</h2>
          <form action={addNote} className="grid"><input type="hidden" name="id" value={id} />
            <textarea name="body" placeholder="Add a note or important update…" required />
            <label><input type="checkbox" name="pinned" /> pin to top</label><button>Add note</button></form>
          <ul className="tl">
            {(notes || []).map((n) => <li key={n.id}>{n.pinned && '📌 '}{n.body}<div className="muted">{n.author} · {fmt(n.created_at)}</div></li>)}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Activity</h2>
        <ul className="tl">
          {(activity || []).map((a) => <li key={a.id}>{describe(a.kind, a.detail)}<div className="muted">{a.actor} · {fmt(a.created_at)}</div></li>)}
          {!(activity || []).length && <li className="muted">No activity yet.</li>}
        </ul>
      </div>
    </>
  );
}

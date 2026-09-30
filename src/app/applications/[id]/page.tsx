import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { attentionReasons, AppRow } from '@/lib/attention';
import { missingDocs, counselorKey, effType } from '@/lib/docs';
import { ALL_DOC_TYPES, STATUSES } from '@/lib/constants';
import { statusTone } from '@/lib/ui';
import Btn from '@/components/Btn';
import { addNote, addToMaster, refreshDocuments, sendCounselorEmail, updateCounselor, updateStatus, uploadDocument } from '../../actions';

type SP = { msg?: string; err?: string; preview?: string; tab?: string };
const TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['sources', 'Sources'], ['notes', 'Notes & activity']] as const;
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
    case 'moved_to_master': return `Added to master sheet as ${d.status}`;
    case 'doc_retyped': return `Marked ${d.name} as ${d.type}`;
    default: return kind;
  }
}

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'overview';
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('*').eq('application_id', id).maybeSingle();
  if (!app) notFound();

  const [{ data: siblings }, { data: notes }, { data: activity }, { data: counselors }] = await Promise.all([
    db.from('portal_applications').select('application_id,submitted_at').eq('student_key', app.student_key).order('submitted_at', { ascending: false }),
    db.from('portal_notes').select('*').eq('application_id', id).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    db.from('portal_activity').select('*').eq('application_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('portal_counselors').select('name,email,active').order('name'),
  ]);
  const { data: docs } = await db.from('portal_documents').select('*').in('application_id', (siblings || []).map((s) => s.application_id)).order('created_at', { ascending: false });

  const missing = missingDocs((docs || []).map(effType));
  const reasons = attentionReasons(app as AppRow, missing, (docs || []).length);
  const counselor = (counselors || []).find((c) => counselorKey(c.name) === counselorKey(app.counselor));
  const previewDoc = sp.preview ? (docs || []).find((d) => d.drive_file_id === sp.preview) : null;
  const tabHref = (k: string) => `/applications/${id}${k === 'overview' ? '' : `?tab=${k}`}`;
  const counts: Record<string, number> = { documents: (docs || []).length, notes: (notes || []).length };

  const defaultBody =
    `Hi ${app.counselor || ''},\n\nUpdate on your student ${app.name} (${app.school} – ${app.programme}).\n` +
    `Status: ${app.status || 'not set'}\n` +
    (missing.length ? `Missing documents: ${missing.join(', ')}\n` : 'All required documents received.\n') +
    `\nThanks,`;

  return (
    <>
      <Link href="/" className="crumb">← All applications</Link>
      <div className="head">
        <h1>{app.name}</h1>
        {app.status && <span className={`badge tone-${statusTone(app.status)}`}>{app.status}</span>}
        {app.progress != null && <span className="muted">{app.progress}% through pipeline</span>}
      </div>
      <p className="sub">{[app.school, app.programme].filter(Boolean).join(' · ')}</p>

      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}
      {reasons.length > 0 && <div className="chips" style={{ marginBottom: 14 }}>{reasons.map((r) => <span key={r} className="badge red">{r}</span>)}</div>}

      {!app.in_master && app.has_raw && (
        <div className="card gold">
          <h2>Not in the master sheet yet</h2>
          <form action={addToMaster} className="filters">
            <input type="hidden" name="id" value={id} />
            <select name="status" defaultValue="New Lead">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <select name="counselor" defaultValue={app.counselor || ''}><option value="">Counselor…</option>
              {(counselors || []).filter((c) => c.active).map((c) => <option key={c.name}>{c.name}</option>)}</select>
            <Btn className="gold">Move to master sheet</Btn>
            <span className="muted">Adds a row at the bottom of Sheet1.</span>
          </form>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <Link key={k} href={tabHref(k)} scroll={false} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`}>
            {label}{counts[k] ? <span className="n">{counts[k]}</span> : null}
          </Link>
        ))}
      </div>

      <div className="panel" key={tab}>
        {tab === 'overview' && (
          <div className="grid g2">
            <div className="card">
              <h2>Details</h2>
              <dl className="kv">
                <dt>Email</dt><dd>{app.email || '—'}</dd><dt>Phone</dt><dd>{app.phone || '—'}</dd>
                <dt>Country / City</dt><dd>{[app.country, app.city].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>Gender / DOB / Age</dt><dd>{[app.gender, app.dob, app.age].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>Counselor</dt><dd>{app.counselor || '—'}</dd>
                <dt>Submitted</dt><dd>{app.submitted_at ? fmt(app.submitted_at) : '—'}</dd>
                <dt>Drive folder</dt><dd>{app.drive_folder_url ? <a href={app.drive_folder_url} target="_blank">Open in Drive ↗</a> : '—'}</dd>
                {(siblings || []).length > 1 && (<><dt>Submissions</dt><dd>{(siblings || []).map((s) => s.application_id === id ? <b key={s.application_id}>this · </b> : <Link key={s.application_id} href={`/applications/${s.application_id}`}>{s.submitted_at && new Date(s.submitted_at).toLocaleDateString('en-GB')} · </Link>)}</dd></>)}
              </dl>
            </div>
            <div className="grid" style={{ alignContent: 'start' }}>
              <div className="card">
                <h2>Manage</h2>
                <form action={updateStatus} className="filters"><input type="hidden" name="id" value={id} />
                  <select name="status" defaultValue={app.status || ''}><option value="" disabled>Set status…</option>
                    {app.status && !(STATUSES as readonly string[]).includes(app.status) && <option disabled>{app.status}</option>}{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                  <Btn>Update status</Btn></form>
                <form action={updateCounselor} className="filters" style={{ marginTop: 10 }}><input type="hidden" name="id" value={id} />
                  <select name="counselor" defaultValue={app.counselor || ''}><option value="">Unassigned</option>
                    {(counselors || []).filter((c) => c.active || c.name === app.counselor).map((c) => <option key={c.name}>{c.name}</option>)}</select>
                  <Btn className="ghost">Assign counselor</Btn></form>
                <p className="muted" style={{ marginBottom: 0 }}>Saved to {app.in_master ? 'your master sheet (Sheet1)' : 'the Applications sheet'}. Existing notes are never overwritten.</p>
              </div>
              <div className="card">
                <h2>Message counselor</h2>
                {!counselor?.email && <p className="err" style={{ marginTop: 0 }}>No email saved for {app.counselor || 'this counselor'}. <Link href="/settings">Add it in Settings</Link>, or type one below.</p>}
                <form action={sendCounselorEmail} className="grid" style={{ gap: 10 }}>
                  <input type="hidden" name="id" value={id} />
                  <input name="to" type="email" placeholder="Counselor email" defaultValue={counselor?.email || ''} className="wide" required />
                  <input name="subject" defaultValue={`Update: ${app.name} – ${app.school}`} className="wide" required />
                  <textarea name="body" defaultValue={defaultBody} required />
                  <div><Btn>Send email</Btn></div>
                </form>
              </div>
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="card">
            <div className="filters" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Documents</h2>
              <Link href={`/applications/${id}/documents`} className="btn ghost sm">Open document viewer →</Link>
            </div>
            <div className="scroll" style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Type</th><th>File</th><th>Added</th><th>Location</th><th /></tr></thead>
                <tbody>
                  {(docs || []).map((d) => (
                    <tr key={d.drive_file_id} className="row">
                      <td><span className="badge plain">{effType(d)}</span></td>
                      <td>{d.name} <span className="muted">{kb(d.size_bytes)}</span>{d.application_id !== id && <> <span className="badge plain">other submission</span></>}{d.source === 'portal' && <> <span className="badge plain">added here</span></>}</td>
                      <td className="muted">{fmt(d.created_at)}</td>
                      <td><a href={d.drive_url} target="_blank">Drive ↗</a>{d.folder_path && <span className="muted"> · {d.folder_path}</span>}</td>
                      <td><Link href={`/applications/${id}/documents?file=${d.drive_file_id}`}>View</Link> · <a href={`/api/files/${d.drive_file_id}?download=1`}>Download</a></td>
                    </tr>
                  ))}
                  {!(docs || []).length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>No documents found.</td></tr>}
                </tbody>
              </table>
            </div>
            {previewDoc && (
              <div style={{ marginTop: 14 }}>
                <b>{previewDoc.name}</b> · <Link href={tabHref('documents')}>close</Link>
                {previewDoc.mime_type?.startsWith('image/')
                  ? <img src={`/api/files/${previewDoc.drive_file_id}`} alt={previewDoc.name} style={{ maxWidth: '100%', marginTop: 8 }} />
                  : <iframe className="preview" src={`/api/files/${previewDoc.drive_file_id}`} />}
              </div>
            )}
            <div style={{ marginTop: 16 }} className="chips">
              <b>Missing</b>{missing.length ? missing.map((m) => <span key={m} className="badge amber">{m}</span>) : <span className="badge green">nothing — complete</span>}
            </div>
            {app.drive_folder_id ? (
              <div className="filters" style={{ marginTop: 16 }}>
                <form action={uploadDocument} className="filters">
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={tabHref('documents')} />
                  <select name="docType" defaultValue={missing[0] || 'Other'}>{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <input type="file" name="file" required />
                  <Btn>Upload to Drive</Btn>
                </form>
                <form action={refreshDocuments}><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={tabHref('documents')} /><Btn className="ghost">Refresh from Drive</Btn></form>
              </div>
            ) : <p className="muted">No Drive folder yet — this student hasn’t submitted through the form.</p>}
          </div>
        )}

        {tab === 'sources' && (
          <div className="card">
            <h2>Master sheet vs form log</h2>
            <p className="muted" style={{ marginTop: -6 }}>
              {app.in_master ? 'Sheet1 is the curated record for status, counselor, notes and programme.' : <b>Not in the master sheet yet — only the raw form data exists.</b>}{' '}
              {app.has_raw ? 'The Applications log supplies documents and submission details.' : <b>No form submission found for this student.</b>} Highlighted rows disagree.
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
        )}

        {tab === 'notes' && (
          <div className="grid g2">
            <div className="card">
              <h2>Notes</h2>
              <form action={addNote} className="grid" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={tabHref('notes')} />
                <textarea name="body" placeholder="Add a note or important update…" required />
                <div className="filters"><Btn>Add note</Btn><label className="muted"><input type="checkbox" name="pinned" /> pin to top</label></div>
              </form>
              <ul className="tl" style={{ marginTop: 14 }}>
                {(notes || []).map((n) => <li key={n.id}>{n.pinned && '📌 '}{n.body}<div className="muted">{n.author} · {fmt(n.created_at)}</div></li>)}
                {!(notes || []).length && <li className="muted">No notes yet.</li>}
              </ul>
            </div>
            <div className="card">
              <h2>Activity</h2>
              <ul className="tl">
                {(activity || []).map((a) => <li key={a.id}>{describe(a.kind, a.detail)}<div className="muted">{a.actor} · {fmt(a.created_at)}</div></li>)}
                {!(activity || []).length && <li className="muted">No activity yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

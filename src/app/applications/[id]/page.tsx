import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { attentionReasons, AppRow, isFormSubmission } from '@/lib/attention';
import { missingDocs, counselorKey, effType, schoolShort } from '@/lib/docs';
import { ALL_DOC_TYPES, REQUIRED_DOCS, STATUSES } from '@/lib/constants';
import { statusTone } from '@/lib/ui';
import { ago, dateTime, decodeId, describeActivity, initials, shortDate, STEPS, stepIndex } from '@/lib/format';
import { hashOf } from '@/lib/ai';
import { PURPOSES, TONES, Draft } from '@/lib/draft';
import { docScanEnabled, Scan } from '@/lib/docscan';
import { studentFacts, AppFull, StudentSummary } from '@/lib/overview';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { niceName } from '@/components/UserMenu';
import { addNote, addReminder, addToMaster, completeReminder, createDraft, scanDocs, setDocType, dismissSuggestion, generateSummary, linkFolder, refreshDocuments, scanStudent, sendCounselorEmail, unlinkFolder, updateCounselor, updateRegent, updateStatus, uploadDocument } from '../../actions';

type SP = { msg?: string; err?: string; preview?: string; tab?: string; compose?: string; draft?: string };
const TABS = ['overview', 'documents', 'notes', 'activity', 'messages', 'regent', 'sources'] as const;
const FIELDS: [string, string][] = [['oppId', 'OPP ID'], ['payment', 'Payment'], ['interview', 'Interview booking'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['school', 'University'], ['programme', 'Programme'], ['country', 'Country'], ['city', 'City'], ['gender', 'Gender'], ['dob', 'Date of birth'], ['age', 'Age'], ['counselor', 'Counselor'], ['status', 'Status'], ['notes', 'Notes']];
const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');
const ext = (n: string) => (n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const ftClass = (e: string) => (e === 'pdf' ? '' : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(e) ? 'img' : ['doc', 'docx'].includes(e) ? 'doc' : 'doc');

export const maxDuration = 60;

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const staff = await requireStaff();
  const id = decodeId((await params).id);
  const sp = await searchParams;
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('*').eq('application_id', id).maybeSingle();
  if (!app) notFound();

  const [{ data: siblings }, { data: notes }, { data: activity }, { data: counselors }, { data: suggestions }, { data: messages }, { data: reminders }] = await Promise.all([
    db.from('portal_applications').select('application_id,submitted_at').eq('student_key', app.student_key).order('submitted_at', { ascending: false }),
    db.from('portal_notes').select('*').eq('application_id', id).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    db.from('portal_activity').select('*').eq('application_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('portal_counselors').select('name,email,active').order('name'),
    db.from('portal_folder_suggestions').select('*').eq('application_id', id).eq('status', 'new').order('score', { ascending: false }),
    db.from('portal_messages').select('*').eq('application_id', id).order('created_at', { ascending: false }).limit(50),
    db.from('portal_reminders').select('*').eq('application_id', id).eq('status', 'pending').order('due_on'),
  ]);
  const { data: docs } = await db.from('portal_documents').select('*').in('application_id', (siblings || []).map((s) => s.application_id)).order('created_at', { ascending: false });

  const judged = isFormSubmission(app) || !!app.drive_folder_id;
  const scanOn = docScanEnabled();
  const { data: scanRows } = await db.from('portal_doc_scans').select('*').in('drive_file_id', (docs || []).map((d) => d.drive_file_id));
  const scans = new Map((scanRows || []).map((r) => [r.drive_file_id as string, r as Scan]));
  const types = (docs || []).map(effType);
  const missing = judged ? missingDocs(types) : [];
  const presentRequired = REQUIRED_DOCS.filter((d) => types.includes(d)).length;
  const reasons = attentionReasons(app as AppRow, missing, (docs || []).length);
  const counselor = (counselors || []).find((c) => counselorKey(c.name) === counselorKey(app.counselor));
  const rawFolder = (app.raw_data as { driveFolderId?: string } | null)?.driveFolderId || null;
  const linkedFolders = [...new Set([rawFolder, ...(app.extra_folder_ids || [])].filter(Boolean) as string[])];
  const tab = (TABS as readonly string[]).includes(sp.tab || '') && !(sp.tab === 'regent' && !app.in_regent) ? sp.tab! : 'overview';
  const tabHref = (k: string) => `/applications/${id}${k === 'overview' ? '' : `?tab=${k}`}`;
  const previewDoc = sp.preview ? (docs || []).find((d) => d.drive_file_id === sp.preview) : null;

  const facts = studentFacts(app as AppFull, { have: new Set(types), docCount: (docs || []).length, missing, judged, submissions: (siblings || []).length });
  const { data: cached } = await db.from('portal_ai_cache').select('output,input_hash,created_at').eq('cache_key', `student:${id}`).maybeSingle();
  const summary = cached?.output as StudentSummary | undefined;
  const summaryStale = !!cached && cached.input_hash !== hashOf(facts);

  // Latest file per document type, for the cards.
  const latest = new Map<string, NonNullable<typeof docs>[number]>();
  (docs || []).forEach((d) => { const t = effType(d); if (!latest.has(t)) latest.set(t, d); });
  const cardTypes = [...(judged ? REQUIRED_DOCS : []), ...[...latest.keys()].filter((t) => !(REQUIRED_DOCS as readonly string[]).includes(t) || !judged)];

  // Timeline: the key moments we know about.
  const ev: { title: string; at: string }[] = [];
  if (app.submitted_at) ev.push({ title: 'Application Submitted', at: app.submitted_at });
  const firstDoc = [...(docs || [])].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0];
  if (firstDoc) ev.push({ title: 'Documents Received', at: firstDoc.created_at });
  [...(activity || [])].reverse().forEach((a) => {
    if (['counselor_change', 'status_change', 'moved_to_master', 'email_sent', 'doc_uploaded', 'payment_change', 'interview_change'].includes(a.kind)) {
      const d = describeActivity(a.kind, a.detail as Record<string, string>);
      ev.push({ title: d.title.replace(/^Counselor assigned · /, 'Assigned to ').replace(/^Status updated · /, ''), at: a.created_at });
    }
  });
  ev.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const steps = ev.slice(-6);
  const lastStatusChange = (activity || []).find((a) => a.kind === 'status_change');
  const step = stepIndex(app.status);

  const { data: draftRow } = sp.draft ? await db.from('portal_ai_cache').select('output').eq('cache_key', `draft:${id}:${staff.email}`).maybeSingle() : { data: null };
  const draft = (draftRow?.output as Draft | undefined) || null;

  const first = niceName(app.name);
  const fillTo = (kind: 'student' | 'counselor') => kind === 'student' ? (app.email || '') : (counselor?.email || '');
  const composeMissing = sp.compose === 'missing';
  const defaultSubject = draft ? draft.subject : composeMissing ? 'Documents needed for your application' : `Update: ${app.name} – ${app.school || ''}`;
  const defaultBody = draft ? draft.body : composeMissing
    ? `Dear ${first},\n\nThank you for applying${app.programme && app.programme !== 'N/A' ? ` for ${app.programme}` : ''}${app.school ? ` at ${app.school}` : ''}. To continue processing your application we still need:\n\n${(missing.length ? missing : ['—']).map((m) => `  • ${m}`).join('\n')}\n\nPlease reply to this email with clear scans or photos of each document.\n\nKind regards,\n${niceName(staff.email)}\nAdmissions Team`
    : `Hi ${app.counselor || ''},\n\nUpdate on your student ${app.name} (${app.school || ''} – ${app.programme || ''}).\nStatus: ${app.status || 'not set'}\n${missing.length ? `Missing documents: ${missing.join(', ')}\n` : 'All required documents received.\n'}\nThanks,\n${niceName(staff.email)}`;
  const ret = (k: string) => tabHref(k);

  const statusForm = (
    <form action={updateStatus} className="filters" style={{ flexWrap: 'nowrap' }}>
      <input type="hidden" name="id" value={id} />
      <select name="status" defaultValue={app.status || ''} style={{ flex: 1 }}><option value="" disabled>Set status…</option>
        {app.status && !(STATUSES as readonly string[]).includes(app.status) && <option disabled>{app.status}</option>}{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
      <Btn className="sm">Update</Btn>
    </form>
  );
  const notesBlock = (limit?: number) => (
    <>
      {(notes || []).slice(0, limit).map((n) => (
        <div key={n.id} className="note"><span className="avatar sm">{initials(niceName(n.author))}</span><div><b>{niceName(n.author)} {n.pinned && '📌'}</b><small>{dateTime(n.created_at)}</small><p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p></div></div>
      ))}
      {!(notes || []).length && <p className="muted" style={{ margin: 0 }}>No notes yet.</p>}
    </>
  );

  return (
    <>
      <Link href="/applications" className="crumb"><Icon n="left" size={15} /> Back to Applications</Link>

      <div className="sh">
        <span className="avatar lg">{initials(app.name)}</span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>{app.name}</h1>
          <div className="meta">{[app.programme && app.programme.toUpperCase() !== 'N/A' ? app.programme : null, schoolShort(app.school), app.city].filter(Boolean).join('  ·  ') || 'No programme set'}</div>
        </div>
        <div className="chips">
          {judged && missing.length > 0 && <span className="badge plain red">Missing Docs</span>}
          {app.status && <span className={`badge plain tone-${statusTone(app.status)}`}>{app.status}</span>}
          {app.counselor && <span className="badge plain purple"><Icon n="users" size={13} /> Assigned: {app.counselor}</span>}
          {app.in_regent && app.payment && <span className={`badge plain ${/^paid/i.test(app.payment) ? 'green' : 'amber'}`}>{app.payment}</span>}
          <details className="dd">
            <summary className="iconbtn" style={{ width: 36, height: 36 }} aria-label="More"><Icon n="more" size={18} /></summary>
            <div className="menu" style={{ minWidth: 220 }}>
              {app.drive_folder_url && <a href={app.drive_folder_url} target="_blank"><Icon n="folder" /> Open Drive folder</a>}
              <Link href={tabHref('documents')}><Icon n="link" /> Manage Drive folders</Link>
              {app.drive_folder_id && <form action={refreshDocuments}><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={tabHref('documents')} /><button className="item"><Icon n="upload" /> Refresh from Drive</button></form>}
            </div>
          </details>
        </div>
      </div>

      <div className="mrow">
        <div><span className="ico"><Icon n="file" size={16} /></span><span><small>Application ID</small><b>{app.opp_id || app.student_ref || `PP-${id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`}</b></span></div>
        <div><span className="ico"><Icon n="mail" size={16} /></span><span><small>Student Email</small><b>{app.email || '—'}</b></span></div>
        <div><span className="ico"><Icon n="folder" size={16} /></span><span><small>City / Country</small><b>{[app.city, app.country].filter(Boolean).join(', ') || '—'}</b></span></div>
        <div><span className="ico"><Icon n="clock" size={16} /></span><span><small>Submitted</small><b>{app.submitted_at ? shortDate(app.submitted_at) : '—'}</b></span></div>
      </div>

      {sp.msg && <div className="card ok" style={{ marginTop: 16 }}>{sp.msg}</div>}
      {sp.err && <div className="card err" style={{ marginTop: 16 }}>{sp.err}</div>}
      {!app.in_master && app.has_raw && (
        <div className="card gold" style={{ marginTop: 16 }}>
          <h2>Not in the master sheet yet</h2>
          <form action={addToMaster} className="filters">
            <input type="hidden" name="id" value={id} />
            <select name="status" defaultValue="New Lead">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <select name="counselor" defaultValue={app.counselor || ''}><option value="">Counselor…</option>{(counselors || []).filter((c) => c.active).map((c) => <option key={c.name}>{c.name}</option>)}</select>
            <Btn className="gold">Move to master sheet</Btn><span className="muted">Adds a row at the bottom of Sheet1.</span>
          </form>
        </div>
      )}

      <div className="tabs" role="tablist">
        {([['overview', 'Overview', null], ['documents', 'Documents', judged ? `${presentRequired}/${REQUIRED_DOCS.length}` : null], ['notes', 'Notes', (notes || []).length || null], ['activity', 'Activity', null], ['messages', 'Messages', (messages || []).length || null], ...(app.in_regent ? [['regent', 'Regent', null]] : []), ['sources', 'Sources', null]] as [string, string, string | number | null][]).map(([k, label, n]) => (
          <Link key={k} href={tabHref(k)} scroll={false} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`}>{label}{n ? <span className="n">{n}</span> : null}</Link>
        ))}
      </div>

      <div className="panel" key={tab}>
        {tab === 'overview' && (
          <div className="split">
            <div>
              <div className="grid g2" style={{ marginBottom: 16 }}>
                <div className="card ai">
                  <h2><span className="spark">✦</span> AI Application Review <span className="badge blue plain" style={{ marginLeft: 6 }}>beta</span></h2>
                  {!judged ? (
                    <div className="callout" style={{ background: '#f4f6fb', borderColor: 'var(--line)' }}><Icon n="folder" className="ci" /><div><b style={{ color: 'var(--ink)' }}>Documents not checked</b><p>Link this student’s Drive folder so their documents can be reviewed.</p></div></div>
                  ) : missing.length ? (
                    <div className="callout"><Icon n="alert" className="ci" /><div><b>{missing.length} document{missing.length > 1 ? 's are' : ' is'} missing</b><p>This application is {presentRequired >= REQUIRED_DOCS.length / 2 ? 'mostly complete' : 'incomplete'}. Please request the missing documents to proceed.</p></div></div>
                  ) : (
                    <div className="callout good"><Icon n="check-circle" className="ci" /><div><b>All required documents received</b><p>This application is ready for the next stage.</p></div></div>
                  )}
                  {judged && missing.length > 0 && (
                    <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink)' }}>Missing Documents</div>
                      {missing.map((m, i) => <Link key={m} href={`${tabHref('messages')}${tabHref('messages').includes('?') ? '&' : '?'}compose=missing`} className="mrow2"><span className="x">!</span>{i + 1}. {m}<Icon n="right" size={15} /></Link>)}
                    </div>
                  )}
                  <details style={{ marginTop: 14 }} open={!!summary}>
                    <summary className="btn primary wide-btn lg" style={{ listStyle: 'none', cursor: 'pointer' }}><Icon n="spark" size={16} /> View AI Findings <Icon n="arrow" size={16} /></summary>
                    <div style={{ paddingTop: 14 }}>
                      <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                        <span className="badge amber plain">AI observations · needs human review</span>
                        <form action={generateSummary}><input type="hidden" name="id" value={id} /><Btn className="ghost sm">{summary ? 'Refresh' : 'Generate'}</Btn></form>
                      </div>
                      {summary ? (
                        <>
                          <ul className="tl">{summary.observations.map((o) => <li key={o}>{o}</li>)}</ul>
                          {summary.recommendedActions.length > 0 && <><b>Suggested admin actions</b><ol style={{ margin: '6px 0 8px', paddingLeft: 18 }}>{summary.recommendedActions.map((o) => <li key={o}>{o}</li>)}</ol></>}
                          {summary.uncertainty && <p className="muted" style={{ margin: 0 }}>Can’t tell from the data: {summary.uncertainty}</p>}
                          {summaryStale && <p className="err" style={{ margin: '8px 0 0', fontSize: 12.5 }}>This student’s data changed since — refresh the notes.</p>}
                        </>
                      ) : <p className="muted" style={{ margin: 0 }}>No AI notes yet — generated only when you ask.</p>}
                      <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>The AI never changes anything or decides. It only sees portal facts — no name, email, phone or document contents.</p>
                    </div>
                  </details>
                </div>

                <div className="card">
                  <h2><Icon n="file" size={17} /> Application Summary</h2>
                  <dl className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
                    <dt>Student Name</dt><dd>{app.name}</dd>
                    <dt>Program</dt><dd>{app.programme && app.programme.toUpperCase() !== 'N/A' ? app.programme : '—'}</dd>
                    <dt>School</dt><dd>{app.school || '—'}</dd>
                    <dt>City</dt><dd>{app.city || '—'}</dd>
                    <dt>Phone</dt><dd>{app.phone || '—'}</dd>
                    <dt>Application Status</dt><dd>{app.status ? <span className={`badge plain tone-${statusTone(app.status)}`}>{app.status}</span> : '—'}{judged && missing.length > 0 && <> <span className="badge plain red">Missing Docs</span></>}</dd>
                  </dl>
                  <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 14 }}>
                    <div className="stat-l" style={{ marginBottom: 10 }}><Icon n="users" size={14} /> Counselor</div>
                    <div className="filters" style={{ justifyContent: 'space-between' }}>
                      <div className="who-c"><span className="avatar">{initials(app.counselor || '—')}</span><div><b>{app.counselor || 'Unassigned'}</b><div className="muted" style={{ fontSize: 12.5 }}>{counselor?.email || (app.counselor ? 'no email saved' : 'Assigned Counselor')}</div></div></div>
                      <details className="dd"><summary className="btn ghost sm" style={{ listStyle: 'none' }}>Change</summary>
                        <div className="menu" style={{ minWidth: 260, padding: 12 }}>
                          <form action={updateCounselor} className="grid" style={{ gap: 8 }}><input type="hidden" name="id" value={id} />
                            <select name="counselor" defaultValue={app.counselor || ''}><option value="">Unassigned</option>{(counselors || []).filter((c) => c.active || c.name === app.counselor).map((c) => <option key={c.name}>{c.name}</option>)}</select>
                            <Btn className="sm">Assign counselor</Btn></form>
                        </div></details>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
                  <h2 style={{ margin: 0 }}><Icon n="folder" size={17} /> Documents</h2>
                  {judged ? <div style={{ minWidth: 200 }}><div className="muted" style={{ fontSize: 12.5, textAlign: 'right' }}>{presentRequired} of {REQUIRED_DOCS.length} uploaded</div><div className="bar wide" style={{ marginLeft: 'auto' }}><i style={{ width: `${Math.round((presentRequired / REQUIRED_DOCS.length) * 100)}%` }} /></div></div> : <Link href={tabHref('documents')} className="btn ghost sm">Link a Drive folder</Link>}
                </div>
                <div className="docs">
                  {cardTypes.map((t) => {
                    const d = latest.get(t);
                    if (!d) return (
                      <div key={t} className="dcard missing"><div className="top"><span className="ft none">—</span><div><b>{t}</b><small>Not received</small></div></div>
                        <div className="ft2"><span className="badge plain red">Missing</span><Link href={`${tabHref('messages')}${tabHref('messages').includes('?') ? '&' : '?'}compose=missing`} className="iact" title="Request it"><Icon n="send" size={16} /></Link></div></div>
                    );
                    const e = ext(d.name);
                    return (
                      <div key={t} className="dcard"><div className="top"><span className={`ft ${ftClass(e)}`}>{(e || 'file').slice(0, 4).toUpperCase()}</span><div><b>{t}</b><small title={d.name}>{d.name.split(' - ').pop()}</small></div></div>
                        <div className="ft2"><span className="badge plain green">Uploaded</span>
                          <span><Link href={`/applications/${id}/documents?file=${d.drive_file_id}`} className="iact" title="View"><Icon n="eye" size={16} /></Link><a href={`/api/files/${d.drive_file_id}?download=1`} className="iact" title="Download"><Icon n="download" size={16} /></a></span></div></div>
                    );
                  })}
                  {!cardTypes.length && <p className="muted" style={{ margin: 0 }}>No documents yet.</p>}
                </div>
                <p style={{ margin: '14px 0 0' }}><Link href={`/applications/${id}/documents`}>Open document viewer →</Link></p>
              </div>

              <div className="card">
                <h2><Icon n="clock" size={17} /> Application Timeline</h2>
                <div className="htl">
                  {steps.map((s, i) => <div key={i} className={`st ${i === steps.length - 1 ? 'cur' : ''}`}><i /><b>{s.title}</b><small>{dateTime(s.at)}</small></div>)}
                  {!steps.length && <p className="muted" style={{ margin: 0 }}>No events recorded yet.</p>}
                </div>
              </div>
            </div>

            <div>
              <div className="card">
                <h2><Icon n="check-circle" size={17} /> Application Status</h2>
                <div className="stepper">
                  {STEPS.map((s, i) => <div key={s} className={`s ${i < step ? 'done' : i === step ? 'cur' : ''}`}><i>{i < step ? <Icon n="check" size={12} /> : null}</i>{s}</div>)}
                </div>
                <div className="filters" style={{ justifyContent: 'space-between' }}>
                  <div><div className="muted" style={{ fontSize: 12.5 }}>Current Stage</div><span className={`badge plain tone-${statusTone(app.status)}`} style={{ marginTop: 4 }}>{app.status || 'Not set'}</span></div>
                  <div style={{ textAlign: 'right' }}><div className="muted" style={{ fontSize: 12.5 }}>{lastStatusChange ? 'Updated' : 'Submitted'}</div><div style={{ marginTop: 4 }}>{shortDate(lastStatusChange?.created_at || app.submitted_at)}</div></div>
                </div>
              </div>

              <div className="card">
                <h2><Icon n="bolt" size={17} /> Quick Actions</h2>
                <Link href={tabHref('messages')} className="qa"><span className="ico"><Icon n="mail" size={19} /></span><span><b>Send Email</b><small>Contact the student or counselor</small></span><Icon n="right" size={16} /></Link>
                <Link href={tabHref('messages')} className="qa"><span className="ico purple"><Icon n="spark" size={19} /></span><span><b>Draft Email with AI</b><small>Qwen writes it, you review</small></span><Icon n="right" size={16} /></Link>
                {missing.length > 0
                  ? <Link href={`${tabHref('messages')}${tabHref('messages').includes('?') ? '&' : '?'}compose=missing`} className="qa"><span className="ico amber"><Icon n="file" size={19} /></span><span><b>Request Missing Documents</b><small>Send a friendly reminder</small></span><Icon n="right" size={16} /></Link>
                  : <div className="qa" style={{ opacity: .6, cursor: 'default' }}><span className="ico green"><Icon n="check-circle" size={19} /></span><span><b>Documents complete</b><small>Nothing to request</small></span></div>}
                <details className="qa-d"><summary className="qa"><span className="ico purple"><Icon n="clock" size={19} /></span><span><b>Update Status</b><small>Change application status</small></span><Icon n="down" size={16} /></summary><div className="body">{statusForm}</div></details>
                <details className="qa-d"><summary className="qa"><span className="ico amber"><Icon n="clock" size={19} /></span><span><b>Set Reminder</b><small>Follow up on a date</small></span><Icon n="down" size={16} /></summary>
                  <div className="body">
                    <form action={addReminder} className="grid" style={{ gap: 8 }}>
                      <input type="hidden" name="id" value={id} />
                      <input name="due" type="date" required min={new Date().toISOString().slice(0, 10)} defaultValue={new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)} />
                      <input name="note" placeholder="e.g. Chase for passport copy" required maxLength={300} />
                      <Btn className="sm">Set reminder</Btn>
                    </form>
                  </div></details>
                <Link href="#note-input" className="qa"><span className="ico green"><Icon n="note" size={19} /></span><span><b>Add Note</b><small>Add a private note</small></span><Icon n="right" size={16} /></Link>
              </div>

              {(reminders || []).length > 0 && (
                <div className="card">
                  <h2><Icon n="clock" size={17} /> Reminders</h2>
                  {(reminders || []).map((r) => (
                    <div key={r.id} className="filters" style={{ padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'nowrap' }}>
                      <div style={{ flex: 1 }}>{r.note}<div className="muted" style={{ fontSize: 12.5 }}>{new Date(r.due_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{r.due_on < new Date().toISOString().slice(0, 10) ? ' · overdue' : ''}</div></div>
                      <form action={completeReminder}><input type="hidden" name="reminderId" value={r.id} /><input type="hidden" name="returnTo" value={tabHref('overview')} /><Btn className="ghost sm">Done</Btn></form>
                    </div>
                  ))}
                </div>
              )}

              <div className="card">
                <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h2 style={{ margin: 0 }}><Icon n="note" size={17} /> Notes</h2><Link href={tabHref('notes')}>View all →</Link></div>
                {notesBlock(2)}
                <form action={addNote} className="addnote"><input type="hidden" name="id" value={id} /><input id="note-input" name="body" placeholder="Add a note…" required /><Btn className="primary sm" aria-label="Add note"><Icon n="send" size={15} /></Btn></form>
              </div>
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="card">
            <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Documents</h2>
              <Link href={`/applications/${id}/documents`} className="btn ghost sm">Open document viewer →</Link>
            </div>
            <div className="scroll" style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Type</th><th>File</th>{scanOn && <th>AI check</th>}<th>Added</th><th>Location</th><th /></tr></thead>
                <tbody>
                  {(docs || []).map((d) => (
                    <tr key={d.drive_file_id} className="row">
                      <td><span className="badge plain">{effType(d)}</span></td>
                      <td>{d.name} <span className="muted">{kb(d.size_bytes)}</span>{d.application_id !== id && <> <span className="badge plain">other submission</span></>}{d.source === 'portal' && <> <span className="badge plain">added here</span></>}</td>
                      {scanOn && (
                        <td style={{ minWidth: 200 }}>
                          {(() => { const sc = scans.get(d.drive_file_id); if (!sc) return (
                            <form action={scanDocs}><input type="hidden" name="id" value={id} /><input type="hidden" name="fileId" value={d.drive_file_id} /><input type="hidden" name="returnTo" value={ret('documents')} /><Btn className="ghost sm" data-busy="Reading the document and asking the AI…">AI check</Btn></form>); 
                            if (!sc.flags.length) return <span className="badge plain green" title={`Detected: ${sc.detected_type}`}>Looks fine</span>;
                            return <div className="grid" style={{ gap: 6 }}>{sc.flags.map((fl, i) => (
                              <div key={i}><span className="badge plain amber" style={{ whiteSpace: 'normal' }}>{fl.text}</span>
                                {fl.kind === 'type' && fl.detected && <form action={setDocType} style={{ marginTop: 4 }}><input type="hidden" name="id" value={id} /><input type="hidden" name="fileId" value={d.drive_file_id} /><input type="hidden" name="docType" value={fl.detected} /><input type="hidden" name="returnTo" value={ret('documents')} /><Btn className="ghost sm">Use “{fl.detected}”</Btn></form>}
                              </div>))}</div>; })()}
                        </td>
                      )}
                      <td className="muted">{dateTime(d.created_at)}</td>
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
                {previewDoc.mime_type?.startsWith('image/') ? <img src={`/api/files/${previewDoc.drive_file_id}`} alt={previewDoc.name} style={{ maxWidth: '100%', marginTop: 8 }} /> : <iframe className="preview" src={`/api/files/${previewDoc.drive_file_id}`} />}
              </div>
            )}
            {scanOn && (docs || []).length > 0 && (
              <div className="callout" style={{ background: 'var(--blue-soft)', borderColor: '#cfdcfa', marginTop: 16 }}>
                <Icon n="spark" className="ci" /><div style={{ flex: 1 }}><b style={{ color: 'var(--blue)' }}>AI document check <span className="badge blue plain">opt-in</span></b>
                  <p style={{ color: 'var(--text)' }}>Reads each document and flags a wrong type, a name that doesn’t match, or a passport close to expiry. It’s an observation for you to review — never a decision. The document’s text is sent to Qwen to do this.</p>
                  <form action={scanDocs}><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={ret('documents')} /><Btn className="primary sm" data-busy="Reading documents and asking the AI — this takes a few seconds each…">AI-check unchecked documents</Btn></form></div>
              </div>
            )}
            <div style={{ marginTop: 16 }} className="chips"><b>Missing</b>{!judged ? <span className="muted">not checked — link a Drive folder</span> : missing.length ? missing.map((m) => <span key={m} className="badge amber">{m}</span>) : <span className="badge green">nothing — complete</span>}</div>
            {app.drive_folder_id && (
              <div className="filters" style={{ marginTop: 16 }}>
                <form action={uploadDocument} className="filters"><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={ret('documents')} />
                  <select name="docType" defaultValue={missing[0] || 'Other'}>{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select><input type="file" name="file" required /><Btn>Upload to Drive</Btn></form>
                <form action={refreshDocuments}><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={ret('documents')} /><Btn className="ghost">Refresh from Drive</Btn></form>
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 20, paddingTop: 16 }}>
              <h2>Google Drive folders</h2>
              {linkedFolders.length ? linkedFolders.map((fid) => (
                <div key={fid} className="filters" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                  <span><a href={`https://drive.google.com/drive/folders/${fid}`} target="_blank">{fid === rawFolder ? 'Form folder' : 'Linked folder'} ↗</a> <span className="muted">{fid}</span></span>
                  {fid !== rawFolder && <form action={unlinkFolder}><input type="hidden" name="id" value={id} /><input type="hidden" name="folderId" value={fid} /><Btn className="ghost sm">Unlink</Btn></form>}
                </div>
              )) : <p className="muted" style={{ marginTop: 0 }}>No Drive folder linked yet, so this student’s documents can’t be checked.</p>}
              {(suggestions || []).length > 0 && (
                <div style={{ margin: '12px 0' }}><b>Possible matches in your Drive</b>
                  {(suggestions || []).map((x) => (
                    <div key={x.id} className="filters" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)', marginTop: 6 }}>
                      <div><a href={x.folder_url || '#'} target="_blank">{x.folder_name}</a> {x.exact ? <span className="badge green plain">name matches</span> : <span className="badge amber plain">partial</span>}<div className="muted">{x.parent_name ? `in ${x.parent_name} · ` : ''}{x.file_count ?? 0} files</div></div>
                      <div className="filters"><form action={linkFolder}><input type="hidden" name="id" value={id} /><input type="hidden" name="folder" value={x.folder_id} /><Btn className="sm">Link</Btn></form>
                        <form action={dismissSuggestion}><input type="hidden" name="id" value={id} /><input type="hidden" name="sid" value={x.id} /><input type="hidden" name="returnTo" value={ret('documents')} /><Btn className="ghost sm">Not them</Btn></form></div>
                    </div>
                  ))}
                </div>
              )}
              <div className="filters" style={{ marginTop: 10 }}>
                <form action={scanStudent}><input type="hidden" name="id" value={id} /><Btn className="ghost">Find in Drive</Btn></form>
                <form action={linkFolder} className="filters" style={{ flex: 1 }}><input type="hidden" name="id" value={id} /><input name="folder" placeholder="…or paste a Google Drive folder link or ID" style={{ flex: 1, minWidth: 240 }} required /><Btn>Link folder</Btn></form>
              </div>
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="card">
            <h2>Notes</h2>
            <form action={addNote} className="grid" style={{ gap: 10, marginBottom: 14 }}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={ret('notes')} />
              <textarea name="body" placeholder="Add a note or important update…" required />
              <div className="filters"><Btn>Add note</Btn><label className="muted"><input type="checkbox" name="pinned" /> pin to top</label></div>
            </form>
            {notesBlock()}
          </div>
        )}

        {tab === 'activity' && (
          <div className="card">
            <h2>Activity</h2>
            <ul className="feed">
              {(activity || []).map((a) => { const d = describeActivity(a.kind, a.detail as Record<string, string>); return <li key={a.id}><span className={`ico ${d.tone}`}><Icon n={d.icon} size={17} /></span><div><b>{d.title}</b><small>{a.actor}</small></div><time>{dateTime(a.created_at)}</time></li>; })}
              {!(activity || []).length && <li className="muted">No activity yet.</li>}
            </ul>
          </div>
        )}

        {tab === 'messages' && (
          <div className="grid g2" style={{ alignItems: 'start' }}>
            <div>
            <div className="card ai">
              <h2><span className="spark">✦</span> Draft with AI <span className="badge blue plain" style={{ marginLeft: 6 }}>beta</span></h2>
              <form action={createDraft} className="grid" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={id} />
                <div className="filters" style={{ flexWrap: 'nowrap' }}>
                  <select name="purpose" defaultValue={draft?.purpose || (missing.length ? 'missing_docs' : 'status_update')} style={{ flex: 1 }}>{Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                  <select name="tone" defaultValue={draft?.tone || 'friendly'}>{Object.entries(TONES).map(([k]) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select>
                </div>
                <input name="instruction" placeholder="Optional: anything specific to include (don’t paste personal details)" className="wide" maxLength={400} />
                <div className="filters"><Btn className="primary">{draft ? 'Redraft' : 'Draft email'}</Btn><span className="muted" style={{ fontSize: 12.5 }}>Drafts only — you review and send. The AI never sees the student’s name, email or phone.</span></div>
              </form>
            </div>
            <div className="card" style={{ marginTop: 16 }}>
              {draft && <div className="callout good" style={{ marginBottom: 14, background: 'var(--blue-soft)', borderColor: '#cfdcfa' }}><Icon n="spark" className="ci" /><div><b style={{ color: 'var(--blue)' }}>AI draft — review before sending</b><p style={{ color: 'var(--text)' }}>Check the wording and details, edit anything, then press Send. Written by AI from the facts in the portal.</p></div></div>}
              <h2>{draft ? PURPOSES[draft.purpose].label : composeMissing ? 'Request missing documents' : 'Send an email'}</h2>
              <form action={sendCounselorEmail} className="grid" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={ret('messages')} />
                <select name="to" defaultValue={draft ? (draft.recipient === 'counselor' ? fillTo('counselor') : fillTo('student')) : composeMissing ? fillTo('student') : fillTo('counselor') || fillTo('student')}>
                  {app.email && <option value={app.email}>Student — {app.email}</option>}
                  {counselor?.email && <option value={counselor.email}>Counselor — {app.counselor} ({counselor.email})</option>}
                  <option value="">Other (type below)…</option>
                </select>
                <input name="custom" type="email" placeholder="…or another email address" className="wide" />
                {!counselor?.email && app.counselor && <p className="err" style={{ margin: 0 }}>No email saved for {app.counselor}. Add it under <Link href="/counselors">Counselors</Link>.</p>}
                <input name="subject" defaultValue={defaultSubject} className="wide" required />
                <textarea name="body" defaultValue={defaultBody} style={{ minHeight: 200 }} required />
                <div className="filters"><Btn>Send email</Btn><span className="muted">Sent from your admissions Gmail; replies go to {staff.email}.</span></div>
              </form>
            </div>
            </div>
            <div className="card">
              <h2>Sent messages</h2>
              {(messages || []).map((m) => (
                <details key={m.id} className="note" style={{ display: 'block' }}>
                  <summary style={{ cursor: 'pointer' }}><b>{m.subject}</b> <span className={`badge plain ${m.to_kind === 'student' ? 'blue' : 'purple'}`}>{m.to_kind}</span><small>{m.to_email} · {dateTime(m.created_at)} · {niceName(m.sent_by)}</small></summary>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                </details>
              ))}
              {!(messages || []).length && <p className="muted" style={{ margin: 0 }}>Nothing sent from the portal yet.</p>}
            </div>
          </div>
        )}

        {tab === 'regent' && app.in_regent && (
          <div className="grid g2">
            <div className="card">
              <h2>Regent tracking</h2>
              <form action={updateRegent} className="grid" style={{ gap: 12 }}>
                <input type="hidden" name="id" value={id} />
                <label className="grid" style={{ gap: 6 }}><span className="muted">OPP ID</span><input name="oppId" defaultValue={app.opp_id || ''} placeholder="OPP ID-60000-00000" /></label>
                <label className="grid" style={{ gap: 6 }}><span className="muted">Payment</span><input name="payment" list="pay" defaultValue={app.payment || ''} placeholder="e.g. Paid" /><datalist id="pay"><option value="Paid" /><option value="Pending" /></datalist></label>
                <label className="grid" style={{ gap: 6 }}><span className="muted">Book for interview</span><input name="interview" list="intv" defaultValue={app.interview || ''} placeholder="e.g. To Be Booked for interview" /><datalist id="intv"><option value="To Be Booked for interview" /><option value="Booked" /><option value="Interview taken" /></datalist></label>
                <div><Btn>Save to Regent Only</Btn></div>
              </form>
            </div>
            <div className="card">
              <h2>From the Regent Only tab</h2>
              <dl className="kv"><dt>Status</dt><dd>{(app.regent_data as Record<string, string>)?.status || '—'}</dd><dt>Counselor</dt><dd>{(app.regent_data as Record<string, string>)?.counselor || '—'}</dd><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{(app.regent_data as Record<string, string>)?.notes || '—'}</dd></dl>
            </div>
          </div>
        )}

        {tab === 'sources' && (
          <div className="card">
            <h2>Where the data comes from</h2>
            <p className="muted" style={{ marginTop: -6 }}>{app.in_master ? 'Sheet1 is the curated record for status, counselor, notes and programme.' : <b>Not in Sheet1 yet.</b>} {app.in_regent ? 'Regent Only adds OPP ID, payment and interview booking.' : 'Not in the Regent Only tab.'} {isFormSubmission(app) ? 'The Applications log supplies documents and submission details.' : app.has_raw ? <b>Entered by hand in the Applications tab (no submission date, no form folder).</b> : <b>No form submission found.</b>} Highlighted rows disagree.</p>
            <table className="cmp">
              <thead><tr><th>Field</th><th>Sheet1 (curated)</th><th>Regent Only</th><th>Form log (raw)</th></tr></thead>
              <tbody>
                {FIELDS.map(([k, label]) => {
                  const get = (o: unknown) => String((o as Record<string, string> | null)?.[k] ?? '').trim();
                  const m = get(app.master_data), g = get(app.regent_data), r = get(app.raw_data);
                  const differs = new Set([m, g, r].filter(Boolean).map((v) => v.toLowerCase())).size > 1;
                  return <tr key={k} className={differs ? 'diff' : ''}><td className="muted">{label}</td><td>{m || '—'}</td><td>{g || '—'}</td><td>{r || '—'}</td></tr>;
                })}
                {app.student_ref && <tr><td className="muted">Student ID</td><td>{app.student_ref}</td><td>—</td><td>—</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { ALL_DOC_TYPES, FINAL_STATUSES, REQUIRED_DOCS } from '@/lib/constants';
import { counselorKey, schoolShort } from '@/lib/docs';
import { STEPS, stepIndex } from '@/lib/format';
import { shownName } from '@/lib/profile';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import StudentUploader from '@/components/StudentUploader';
import StudentMessage from '@/components/StudentMessage';

export const maxDuration = 60;
const OTHER_TYPES = ALL_DOC_TYPES.filter((t) => !(REQUIRED_DOCS as readonly string[]).includes(t));
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default async function StudentHome() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const db = admin();
  const { data: counselors } = await db.from('portal_counselors').select('name, name_key, email');
  const { data: profiles } = await db.from('portal_staff').select('email, display_name, avatar_url, color, title');

  // one card per university (several submissions to the same university count as one)
  const byKey = new Map<string, typeof me.apps>();
  me.apps.forEach((a) => byKey.set(a.student_key, [...(byKey.get(a.student_key) || []), a]));
  const cards = [...byKey.values()].map((list) => {
    const a = list[0], ids = list.map((x) => x.application_id);
    const docs = me.docs.filter((d) => me.apps.some((x) => x.student_key === a.student_key && x.application_id === d.application_id));
    const folderApp = list.find((x) => x.drive_folder_id) || a;
    const c = (counselors || []).find((x) => x.name_key === counselorKey(a.counselor));
    const prof = c?.email ? (profiles || []).find((p) => p.email.toLowerCase() === c.email!.toLowerCase()) : null;
    const missing = REQUIRED_DOCS.filter((t) => !docs.some((d) => d.type === t));
    return { a, ids, docs, folderApp, c, prof, missing, canUpload: !!folderApp.drive_folder_id };
  });
  const first = me.name.split(/[\s,]+/).filter(Boolean)[0] || 'there';

  return (
    <>
      <div className="head"><h1>Hi {first} 👋</h1></div>
      <p className="sub">Here is where your application stands, and what we still need from you.</p>
      {cards.map(({ a, docs, folderApp, c, prof, missing, canUpload }) => {
        const idx = stepIndex(a.status), final = a.status && FINAL_STATUSES.includes(a.status) && a.status !== 'Enrolled';
        const left = a.deadline ? Math.ceil((new Date(a.deadline + 'T23:59:59').getTime() - Date.now()) / 864e5) : null;
        const done = REQUIRED_DOCS.length - missing.length;
        return (
          <div key={a.student_key} className="card scard-big rise">
            <div className="sb-head">
              <div><div className="eyebrow">{schoolShort(a.school) || 'Your application'}</div><h2 style={{ margin: 0 }}>{a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : 'Your programme'}</h2></div>
              {a.status && <span className={`badge ${final ? 'red' : a.status === 'Enrolled' ? 'green' : 'plain'}`}>{a.status}</span>}
            </div>

            {!final && (
              <div className="stepper" aria-label="Application progress">
                {STEPS.map((st, i) => <div key={st} className={`stp ${i < idx ? 'done' : i === idx ? 'now' : ''}`}><i>{i < idx ? '✓' : i + 1}</i><span>{st}</span></div>)}
              </div>
            )}
            {a.progress != null && !final && <div className="bar" style={{ margin: '4px 0 14px' }}><i style={{ width: `${a.progress}%` }} /></div>}

            <div className="sgrid">
              <section>
                <h3><Icon n="file" size={16} /> Your documents <span className="muted" style={{ fontWeight: 500 }}>{done} of {REQUIRED_DOCS.length} required received</span></h3>
                <ul className="dlist">
                  {REQUIRED_DOCS.map((t) => {
                    const mine = docs.filter((d) => d.type === t);
                    return (
                      <li key={t} className={mine.length ? 'got' : 'need'}>
                        <span className="dstat">{mine.length ? '✓' : '!'}</span>
                        <div className="dmain"><b>{t}</b>
                          {mine.length ? <small>{mine[0].name} · received {new Date(mine[0].added).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{mine[0].size ? ` · ${kb(mine[0].size)}` : ''}</small> : <small className="warn-t">Still needed</small>}
                        </div>
                        {mine.length > 0 && <a className="dview" href={`/api/files/${encodeURIComponent(mine[0].id)}`} target="_blank" rel="noreferrer" title="View"><Icon n="eye" size={16} /></a>}
                        {canUpload && <StudentUploader appId={folderApp.application_id} docType={t} label={mine.length ? 'Replace' : 'Upload'} compact />}
                      </li>
                    );
                  })}
                </ul>
                {canUpload ? (
                  <div className="otherup"><b>Another document?</b><span className="muted"> English test, reference letter and so on.</span><StudentUploader appId={folderApp.application_id} label="Upload a file" choose types={OTHER_TYPES as string[]} /></div>
                ) : <div className="xnote" style={{ marginTop: 12 }}>Uploads aren’t switched on for your application yet. Please message your counselor and they will sort it out.</div>}
                {docs.filter((d) => !(REQUIRED_DOCS as readonly string[]).includes(d.type)).length > 0 && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Also received: {docs.filter((d) => !(REQUIRED_DOCS as readonly string[]).includes(d.type)).map((d) => d.name).join(', ')}</div>
                )}
              </section>

              <section>
                <h3><Icon n="users" size={16} /> Your counselor</h3>
                {c ? (
                  <div className="cbox">
                    <Avatar name={prof ? shownName(prof) : c.name} url={prof?.avatar_url} color={prof?.color} size={52} />
                    <div><b>{prof ? shownName(prof) : c.name}</b><div className="muted" style={{ fontSize: 13 }}>{prof?.title || 'Admissions Counselor'}</div></div>
                  </div>
                ) : <p className="muted" style={{ margin: 0 }}>A counselor will be assigned to you soon.</p>}
                <div style={{ marginTop: 12 }}><StudentMessage appId={a.application_id} counselor={c ? (prof ? shownName(prof).split(' ')[0] : c.name) : 'the team'} /></div>

                {(a.intake || a.deadline || (a.in_regent)) && (
                  <dl className="kv narrow-k" style={{ marginTop: 18 }}>
                    {a.intake && <><dt>Intake</dt><dd>{new Date(a.intake + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</dd></>}
                    {a.deadline && <><dt>Deadline</dt><dd>{new Date(a.deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}{left !== null && <span className={left <= 14 ? 'warn-t' : 'muted'}> · {left < 0 ? 'passed' : left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}</dd></>}
                    {a.in_regent && <><dt>Payment</dt><dd>{/^paid/i.test(a.payment || '') ? <span className="ok-t">Received ✓</span> : <span className="warn-t">Not received yet</span>}</dd></>}
                  </dl>
                )}
              </section>
            </div>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 24 }}>Questions? Use the message box above. Your documents are stored privately and only your counselors can see them.</p>
    </>
  );
}

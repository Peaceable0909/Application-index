import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { loadStudentData } from '@/lib/studentData';
import { ALL_DOC_TYPES } from '@/lib/constants';
import { schoolShort } from '@/lib/docs';
import { DOC_TIPS } from '@/lib/docTips';
import DocRow from '@/components/DocRow';
import StudentUploader from '@/components/StudentUploader';
import ProgressRing from '@/components/ProgressRing';
import Icon from '@/components/Icon';
import { studentStageAsks } from '@/lib/stageStudent';


export default async function StudentDocuments() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const d = await loadStudentData(me);
  const asked = await Promise.all(d.cards.map((c) => studentStageAsks([c.folderApp.application_id, c.a.application_id]).catch(() => null)));
  return (
    <div className="st-page">
      <h1 className="st-h1">Documents</h1>
      <p className="st-sub">Scan with your phone camera or upload a file. Your documents are stored privately and only your counselors can see them.</p>
      {d.cards.map((c, ci) => {
        const REQUIRED_DOCS = c.required, OTHER_TYPES = ALL_DOC_TYPES.filter((t) => !REQUIRED_DOCS.includes(t));
        const done = REQUIRED_DOCS.length - c.missing.length;
        const extra = c.docs.filter((x) => !REQUIRED_DOCS.includes(x.type));
        const sa = asked[ci];
        return (
          <section key={c.a.application_id} className="st-card" style={{ '--i': ci } as React.CSSProperties}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <ProgressRing percent={(done / REQUIRED_DOCS.length) * 100} size={84} label="received" />
              <div><h3 style={{ margin: 0 }}>{d.cards.length > 1 ? schoolShort(c.a.school) || 'Application' : 'Required documents'}</h3><small className="st-sub" style={{ margin: 0 }}>{done === REQUIRED_DOCS.length ? 'Everything required is in. Well done.' : `${REQUIRED_DOCS.length - done} still needed`}</small></div>
            </div>
            {!c.canUpload && <div className="st-err" style={{ background: '#fff7e6', color: '#b45309' }}>Uploads aren’t switched on for your application yet. Please message your counselor.</div>}
            {sa && sa.asks.length > 0 && (
              <div className="st-asks">
                <b><Icon n="bolt" size={15} /> Needed for your next step</b>
                <span className="st-sub" style={{ margin: '0 0 8px', display: 'block' }}>Your counselor needs {sa.asks.length === 1 ? 'this' : 'these'} before your application can move forward.</span>
                {sa.asks.map((a, i) => (
                  <div key={a.docType} className="st-doc need" style={{ '--i': i } as React.CSSProperties}>
                    <div className="st-doc-main"><span className="st-doc-dot">!</span><div className="st-doc-t"><b>{a.label}</b><small>{a.again ? 'Please send a new copy. The last one could not be used.' : a.hint || 'Still needed'}</small></div></div>
                    {c.canUpload && <div className="st-doc-act"><StudentUploader appId={sa.appId} docType={a.docType} reqType={a.docType} label={a.again ? 'Upload a new copy' : 'Upload a file'} compact /></div>}
                  </div>
                ))}
              </div>
            )}
            <div className="st-docs">
              {REQUIRED_DOCS.map((t, i) => (
                <DocRow key={t} i={i} type={t} appId={c.folderApp.application_id} canUpload={c.canUpload} tip={DOC_TIPS[t]} got={(() => { const g = c.docs.find((x) => x.type === t); return g ? { id: g.id, name: g.name, added: g.added, size: g.size ?? null } : null; })()} />
              ))}
            </div>
            {c.canUpload && (
              <div className="st-other"><b>Another document?</b><span className="st-sub" style={{ margin: '0 0 8px', display: 'block' }}>English test, reference letter, bank statement and so on.</span><StudentUploader appId={c.folderApp.application_id} label="Upload a file" choose types={OTHER_TYPES as string[]} /></div>
            )}
            {extra.length > 0 && <p className="st-sub" style={{ marginTop: 12 }}>Also received: {extra.map((x) => x.name).join(', ')}</p>}
          </section>
        );
      })}
    </div>
  );
}

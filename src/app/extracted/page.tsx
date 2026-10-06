import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, canAccessApp, canSee } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { effType, schoolShort } from '@/lib/docs';
import { decodeId, ago } from '@/lib/format';
import ExtractedView, { XDoc, XText } from '@/components/ExtractedView';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

export const maxDuration = 60;

const snippet = (text: string, q: string) => {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return '';
  return (i > 50 ? '…' : '') + text.slice(Math.max(0, i - 50), i + q.length + 90).replace(/\s+/g, ' ') + '…';
};

export default async function Extracted({ searchParams }: { searchParams: Promise<{ student?: string; file?: string; q?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams, db = admin();

  // ---- one student ----
  if (sp.student) {
    const id = decodeId(sp.student);
    const { data: app } = await db.from('portal_applications').select('application_id, name, school, programme, student_key, counselor').eq('application_id', id).maybeSingle();
    if (!app || !(await canAccessApp(staff, app.application_id))) notFound();
    const { data: sibs } = await db.from('portal_applications').select('application_id').eq('student_key', app.student_key);
    const { data: rows } = await db.from('portal_documents').select('*').in('application_id', (sibs || []).map((s) => s.application_id)).order('doc_type').order('created_at', { ascending: false });
    const docs: XDoc[] = (rows || []).map((d) => ({ id: d.drive_file_id, name: d.name, type: effType(d), path: d.folder_path, size: Number(d.size_bytes || 0), mime: d.mime_type || '', driveUrl: d.drive_url, fromOther: d.application_id !== id, added: new Date(d.created_at).toLocaleDateString('en-GB') }));
    const { data: tx } = docs.length ? await db.from('portal_doc_text').select('drive_file_id, text, chars, truncated, error, method, extracted_at').in('drive_file_id', docs.map((d) => d.id)) : { data: [] };
    const texts: Record<string, XText> = Object.fromEntries((tx || []).map((r) => [r.drive_file_id, { text: r.text, chars: r.chars, truncated: r.truncated, error: r.error, method: r.method, at: r.extracted_at }]));
    return (
      <>
        <Link href="/extracted" className="crumb"><Icon n="left" size={15} /> All students</Link>
        <div className="head" style={{ justifyContent: 'space-between' }}><h1>{app.name}</h1><Link className="btn ghost sm" href={`/applications/${encodeURIComponent(app.application_id)}`}>Open student</Link></div>
        <p className="sub">{[schoolShort(app.school), app.programme].filter(Boolean).join(' · ')} · text read out of each document, next to the document itself.</p>
        <ExtractedView docs={docs} initialTexts={texts} initialSel={sp.file || null} studentName={app.name} />
      </>
    );
  }

  // ---- landing: search + who's been extracted ----
  const q = (sp.q || '').trim();
  const [{ data: people }, { data: hits }, { data: recent }, { count: total }, { count: done }] = await Promise.all([
    q.length >= 2 ? db.from('portal_applications').select('application_id, name, school, programme, counselor, student_key').ilike('name', `%${q.replace(/[%,]/g, ' ')}%`).limit(30) : Promise.resolve({ data: [] as never[] }),
    q.length >= 3 ? db.from('portal_doc_text').select('drive_file_id, application_id, text, portal_documents(name, doc_type, type_override), portal_applications(name, counselor)').ilike('text', `%${q.replace(/[%,]/g, ' ')}%`).limit(40) : Promise.resolve({ data: [] as never[] }),
    db.from('portal_doc_text').select('application_id, extracted_at, portal_applications(name, school, counselor)').is('error', null).order('extracted_at', { ascending: false }).limit(300),
    db.from('portal_documents').select('drive_file_id', { count: 'exact', head: true }),
    db.from('portal_doc_text').select('drive_file_id', { count: 'exact', head: true }).is('error', null),
  ]);
  const seen = new Set<string>(), uniqPeople = (people || []).filter((p) => canSee(staff, p.counselor) && !seen.has(p.student_key) && seen.add(p.student_key));
  const byStudent = new Map<string, { name: string; school: string | null; n: number; at: string }>();
  (recent || []).forEach((r) => { const a = r.portal_applications as unknown as { name: string; school: string | null; counselor: string | null } | null; if (!a || !canSee(staff, a.counselor)) return; const cur = byStudent.get(r.application_id); byStudent.set(r.application_id, { name: a.name, school: a.school, n: (cur?.n || 0) + 1, at: cur?.at || r.extracted_at }); });
  const visibleHits = (hits || []).filter((h) => canSee(staff, (h.portal_applications as unknown as { counselor: string | null } | null)?.counselor ?? null));

  return (
    <>
      <div className="head"><h1>Extracted text</h1></div>
      <p className="sub">Every document read out as plain text, with the document beside it. {total ? `${done || 0} of ${total} documents read so far.` : ''}</p>
      <form className="card toolbar filters" method="get">
        <div className="search"><input name="q" placeholder="Find a student by name, or search inside every extracted document…" defaultValue={sp.q} /></div><Btn>Search</Btn>{q && <Link href="/extracted" className="muted">Clear</Link>}
      </form>
      {q && (
        <>
          {uniqPeople.length > 0 && <div className="card"><h2>Students</h2>{uniqPeople.map((p) => <Link key={p.application_id} href={`/extracted?student=${encodeURIComponent(p.application_id)}`} className="xrow"><b>{p.name}</b><span className="muted">{[schoolShort(p.school), p.programme].filter(Boolean).join(' · ')}</span><Icon n="right" size={15} /></Link>)}</div>}
          {q.length >= 3 && <div className="card"><h2>Inside documents</h2>
            {!visibleHits.length && <p className="muted" style={{ margin: 0 }}>No extracted document contains “{q}”. Only documents already extracted are searched.</p>}
            {visibleHits.map((h) => { const d = h.portal_documents as unknown as { name: string; doc_type: string; type_override: string | null } | null, a = h.portal_applications as unknown as { name: string } | null;
              return <Link key={h.drive_file_id} href={`/extracted?student=${encodeURIComponent(h.application_id)}&file=${encodeURIComponent(h.drive_file_id)}`} className="xrow col"><div><b>{a?.name}</b> <span className="badge plain">{d ? effType(d) : 'Document'}</span></div><span className="muted" style={{ fontSize: 13 }}>{snippet(h.text, q)}</span></Link>; })}
          </div>}
        </>
      )}
      <div className="card">
        <h2><Icon n="clock" size={17} /> Recently extracted</h2>
        {!byStudent.size && <p className="muted" style={{ margin: 0 }}>Nothing extracted yet. Search for a student above, open them, and press <b>Extract all</b>. You can also open any student’s page and choose <b>Extracted text</b>.</p>}
        {[...byStudent].slice(0, 40).map(([id, s]) => <Link key={id} href={`/extracted?student=${encodeURIComponent(id)}`} className="xrow"><b>{s.name}</b><span className="muted">{schoolShort(s.school)} · {s.n} document{s.n === 1 ? '' : 's'} · {ago(s.at)}</span><Icon n="right" size={15} /></Link>)}
      </div>
    </>
  );
}

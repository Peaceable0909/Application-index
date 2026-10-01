import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { loadStudents } from '@/lib/overview';
import { ALL_DOC_TYPES, REQUIRED_DOCS } from '@/lib/constants';
import { effType } from '@/lib/docs';
import { dateTime } from '@/lib/format';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { uploadDocument } from '../actions';

const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

export default async function Documents({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; msg?: string; err?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const [{ rows }, { data: docs }] = await Promise.all([
    loadStudents(),
    db.from('portal_documents').select('*, portal_applications(name, application_id)').order('created_at', { ascending: false }).limit(1500),
  ]);
  const judged = rows.filter((r) => r.judged);
  const stat = (t: string) => ({ present: judged.filter((r) => r.have.has(t)).length, missing: judged.filter((r) => r.missing.includes(t)).length });
  const q = (sp.q || '').toLowerCase();
  const list = (docs || []).filter((d) => (!sp.type || effType(d) === sp.type) && (!q || d.name.toLowerCase().includes(q) || (d.portal_applications as { name?: string } | null)?.name?.toLowerCase().includes(q))).slice(0, 150);
  const uploadable = rows.filter((r) => r.a.drive_folder_id).sort((a, b) => a.a.name.localeCompare(b.a.name));

  return (
    <>
      <div className="head"><h1>Documents</h1></div>
      <p className="sub">Every document across all students, and what’s still missing.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        {REQUIRED_DOCS.map((t, i) => { const s = stat(t); const pct = s.present + s.missing ? Math.round((s.present / (s.present + s.missing)) * 100) : 0; return (
          <Link key={t} href={`/documents?type=${encodeURIComponent(t)}`} className="sc rise" style={{ '--i': i } as React.CSSProperties}>
            <div className="filters" style={{ justifyContent: 'space-between' }}><b style={{ color: 'var(--ink)' }}>{t}</b><span className={`badge plain ${s.missing ? 'amber' : 'green'}`}>{s.missing} missing</span></div>
            <div className="num" style={{ marginTop: 8 }}>{s.present}<span className="muted" style={{ fontSize: 16, fontWeight: 500 }}> / {s.present + s.missing}</span></div>
            <div className="bar wide"><i style={{ width: `${pct}%` }} /></div>
          </Link>); })}
      </div>

      <div className="card" id="upload">
        <h2><Icon n="upload" size={17} /> Upload a document</h2>
        <form action={uploadDocument} className="filters">
          <input type="hidden" name="returnTo" value="/documents" />
          <select name="id" required style={{ minWidth: 240 }}><option value="">Choose a student…</option>{uploadable.map((r) => <option key={r.a.application_id} value={r.a.application_id}>{r.a.name} — {r.a.school || ''}</option>)}</select>
          <select name="docType">{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input type="file" name="file" required /><Btn>Upload to Drive</Btn>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>Only students with a linked Drive folder are listed. Link folders under <Link href="/drive">Drive matches</Link>.</p>
      </div>

      <form className="card toolbar filters" method="get">
        <div className="search"><input name="q" placeholder="Search file or student…" defaultValue={sp.q} /></div>
        <select name="type" defaultValue={sp.type || ''}><option value="">All types</option>{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <Btn>Apply</Btn>{(sp.q || sp.type) && <Link href="/documents" className="muted">Clear</Link>}
      </form>

      <div className="card tablecard"><div className="scroll"><table>
        <thead><tr><th>Student</th><th>Type</th><th>File</th><th>Size</th><th>Added</th><th /></tr></thead>
        <tbody>
          {list.map((d, i) => { const a = d.portal_applications as { name: string; application_id: string } | null; return (
            <tr key={d.drive_file_id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
              <td>{a ? <Link href={`/applications/${a.application_id}?tab=documents`}><b>{a.name}</b></Link> : '—'}</td>
              <td><span className="badge plain">{effType(d)}</span></td><td>{d.name}</td><td className="muted">{kb(d.size_bytes)}</td><td className="muted">{dateTime(d.created_at)}</td>
              <td>{a && <Link href={`/applications/${a.application_id}/documents?file=${d.drive_file_id}`} className="iact" title="View"><Icon n="eye" size={16} /></Link>}<a href={`/api/files/${d.drive_file_id}?download=1`} className="iact" title="Download"><Icon n="download" size={16} /></a></td>
            </tr>); })}
          {!list.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 36 }}>No documents match.</td></tr>}
        </tbody></table></div></div>
    </>
  );
}

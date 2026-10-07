'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import PagePreview from './PagePreview';
import { extractFile } from '@/app/actions';
import { factsFrom } from '@/lib/facts';

export type XDoc = { id: string; name: string; type: string; size: number; mime: string; driveUrl: string; path: string | null; fromOther: boolean; added: string };
export type XText = { text: string; chars: number; truncated: boolean; error: string | null; at: string; method: string | null };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlighted({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${esc(q.trim())})`, 'gi'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

export default function ExtractedView({ docs, initialTexts, initialSel, studentName }: { docs: XDoc[]; initialTexts: Record<string, XText>; initialSel: string | null; studentName: string }) {
  const [texts, setTexts] = useState(initialTexts);
  const [sel, setSel] = useState(initialSel && docs.some((d) => d.id === initialSel) ? initialSel : docs[0]?.id || null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [pane, setPane] = useState<'text' | 'preview'>('text');
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);

  const doc = docs.find((d) => d.id === sel) || null, t = doc ? texts[doc.id] : undefined;
  const facts = useMemo(() => (t?.text ? factsFrom(t.text) : null), [t?.text]);
  const matches = useMemo(() => (t?.text && q.trim() ? (t.text.match(new RegExp(esc(q.trim()), 'gi')) || []).length : 0), [t?.text, q]);
  const pending = docs.filter((d) => !texts[d.id]);

  async function extract(id: string) {
    setBusy(id);
    const r = await extractFile(id);
    // pull the saved row back so the screen shows exactly what's stored
    const res = await fetch(`/api/extracted/${encodeURIComponent(id)}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    setTexts((cur) => ({ ...cur, [id]: res?.row || { text: '', chars: 0, truncated: false, error: r.error || 'Failed', at: new Date().toISOString(), method: null } }));
    setBusy(null);
    return r.ok;
  }
  async function extractAll(list: XDoc[]) {
    stop.current = false; setRun({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) { if (stop.current) break; await extract(list[i].id); setRun({ done: i + 1, total: list.length }); }
    setTimeout(() => setRun(null), 2500);
  }
  const copy = async () => { if (t?.text) { await navigator.clipboard?.writeText(t.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  const download = () => { if (!t?.text || !doc) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`${doc.name}\n${studentName}\n\n${t.text}`], { type: 'text/plain;charset=utf-8' })); a.download = `${doc.name.replace(/\.[^.]+$/, '')}.txt`; a.click(); URL.revokeObjectURL(a.href); };

  if (!docs.length) return <div className="card muted">This student has no documents yet.</div>;
  return (
    <>
      <div className="xbar card">
        <div className="xdocs">
          {docs.map((d) => { const x = texts[d.id]; return (
            <button key={d.id} className={`xdoc ${d.id === sel ? 'on' : ''}`} onClick={() => setSel(d.id)}>
              <span className={`xdot ${!x ? '' : x.error ? 'bad' : 'ok'}`} title={!x ? 'Not extracted yet' : x.error ? 'Could not read' : 'Extracted'} />
              <b>{d.type}</b><small>{d.name}</small>
            </button>); })}
        </div>
        <div className="filters">
          {run ? <><span className="muted">Extracting {run.done}/{run.total}…</span><button className="btn ghost sm" onClick={() => { stop.current = true; }}>Stop</button></>
            : pending.length > 0 ? <button className="btn sm" onClick={() => extractAll(pending)}><Icon n="bolt" size={14} /> Extract {pending.length === docs.length ? 'all' : `${pending.length} remaining`}</button>
            : <button className="btn ghost sm" onClick={() => extractAll(docs)}>Re-extract all</button>}
        </div>
        {run && <div className="bar" style={{ marginTop: 10 }}><i style={{ width: `${(run.done / run.total) * 100}%` }} /></div>}
      </div>

      <div className="xtabs"><button className={pane === 'text' ? 'on' : ''} onClick={() => setPane('text')}>Extracted text</button><button className={pane === 'preview' ? 'on' : ''} onClick={() => setPane('preview')}>Document</button></div>
      {doc && (
        <div className={`xview pane-${pane}`}>
          <section className="card xtext">
            <header>
              <div><b>{doc.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{doc.type}{doc.path ? ` · 📁 ${doc.path}` : ''}{doc.fromOther ? ' · other submission' : ''}{t && !t.error ? ` · ${t.chars.toLocaleString()} characters${t.truncated ? ' (cut at 120,000)' : ''}` : ''}</div></div>
              <div className="filters">
                {t?.text && <><button className="btn ghost sm" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button><button className="btn ghost sm" onClick={download}><Icon n="download" size={13} /> .txt</button></>}
                <button className="btn ghost sm" disabled={!!busy} onClick={() => extract(doc.id)}>{busy === doc.id ? 'Reading…' : t ? 'Re-extract' : 'Extract text'}</button>
              </div>
            </header>
            {t?.text && <div className="xsearch"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in this document…" />{q.trim() && <span className="muted">{matches} match{matches === 1 ? '' : 'es'}</span>}<label><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> wrap lines</label></div>}
            {busy === doc.id && <div className="xnote"><span className="pspin2" /> Reading the document. Scans can take 10–20 seconds…</div>}
            {!t && busy !== doc.id && <div className="xnote">Nothing extracted yet. Press <b>Extract text</b> to read this document out as plain text.</div>}
            {t?.error && <div className="xnote bad">{t.error}</div>}
            {t?.text && <pre className={wrap ? 'wrap' : ''}><Highlighted text={t.text} q={q} /></pre>}
            {facts && (facts.mrz || facts.emails.length || facts.phones.length || facts.dates.length) ? (
              <div className="xfacts">
                <div className="stat-l">Found in the text <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(picked out by pattern, not interpreted. Always check against the document)</span></div>
                {facts.mrz && <div className="xmrz"><b>Passport machine-readable zone</b><dl className="kv narrow-k"><dt>Surname</dt><dd>{facts.mrz.surname}</dd><dt>Given names</dt><dd>{facts.mrz.given}</dd><dt>Passport no.</dt><dd>{facts.mrz.number}</dd><dt>Nationality</dt><dd>{facts.mrz.nationality}</dd><dt>Date of birth</dt><dd>{facts.mrz.dob}</dd>{facts.mrz.sex && <><dt>Sex</dt><dd>{facts.mrz.sex}</dd></>}<dt>Expires</dt><dd>{facts.mrz.expiry}</dd></dl></div>}
                {facts.dates.length > 0 && <div className="xchips"><span>Dates</span>{facts.dates.map((x) => <i key={x} onClick={() => setQ(x)}>{x}</i>)}</div>}
                {facts.emails.length > 0 && <div className="xchips"><span>Emails</span>{facts.emails.map((x) => <i key={x} onClick={() => setQ(x)}>{x}</i>)}</div>}
                {facts.phones.length > 0 && <div className="xchips"><span>Phones</span>{facts.phones.map((x) => <i key={x} onClick={() => setQ(x)}>{x}</i>)}</div>}
                <div className="muted" style={{ fontSize: 12.5 }}>{facts.words.toLocaleString()} words</div>
              </div>
            ) : null}
          </section>
          <section className="card xprev"><PagePreview key={doc.id} id={doc.id} mime={doc.mime} name={doc.name} size={doc.size} driveUrl={doc.driveUrl} /></section>
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}><Link href="/extracted">← All students</Link></p>
    </>
  );
}

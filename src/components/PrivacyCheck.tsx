'use client';
import { useState } from 'react';
import Icon from './Icon';

type Part = { total: number; next: number; done: boolean; checked: number; files: number; missing: string[]; openFolders: { id: string; name: string; access: string }[]; openFiles: { id: string; name: string; folder: string; access: string }[]; openFileCount: number; people: Record<string, number>; owner: string; team: string[]; main?: { name: string; access: string; editors: string[]; viewers: string[] }; error?: string };
type Sum = { total: number; checked: number; files: number; missing: string[]; openFolders: Part['openFolders']; openFiles: Part['openFiles']; openFileCount: number; people: Record<string, number>; owner: string; team: string[]; main?: Part['main'] };

/** Asks Google, folder by folder, who can open the students’ documents. Read-only. */
export default function PrivacyCheck() {
  const [run, setRun] = useState(false), [s, setS] = useState<Sum | null>(null), [done, setDone] = useState(false), [err, setErr] = useState('');
  async function go() {
    setRun(true); setErr(''); setDone(false);
    const acc: Sum = { total: 0, checked: 0, files: 0, missing: [], openFolders: [], openFiles: [], openFileCount: 0, people: {}, owner: '', team: [] };
    setS({ ...acc });
    let offset = 0;
    try {
      for (;;) {
        const r = await fetch('/api/privacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset }) });
        const j = (await r.json()) as Part;
        if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
        acc.total = j.total; acc.checked += j.checked; acc.files += j.files; acc.missing.push(...j.missing); acc.openFolders.push(...j.openFolders); acc.openFiles.push(...j.openFiles); acc.openFileCount += j.openFileCount;
        for (const [e, n] of Object.entries(j.people)) acc.people[e] = (acc.people[e] || 0) + n;
        acc.owner = j.owner; acc.team = j.team; if (j.main) acc.main = j.main;
        setS({ ...acc, people: { ...acc.people } });
        if (j.done || !j.next) break;
        offset = j.next;
      }
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    setRun(false);
  }
  const known = new Set([...(s?.team || []), s?.owner || '']);
  const outsiders = s ? Object.entries(s.people).filter(([e]) => !known.has(e)).sort((a, b) => b[1] - a[1]) : [];
  const open = s ? s.openFolders.length + s.openFileCount : 0;
  const clean = done && !open && !outsiders.length && !(s?.main && s.main.access !== 'PRIVATE');
  return (
    <div className="card">
      <h2><Icon n="lock" size={17} /> Privacy check</h2>
      <p className="muted" style={{ marginTop: 0 }}>Asks Google who can open the student folders and files in Drive. It only looks; it never changes anything. Shows any folder or file that can be opened by a link, and any person outside your team list who has access.</p>
      <button type="button" className="btn primary" onClick={go} disabled={run}>{run ? 'Checking…' : s ? 'Check again' : 'Run the privacy check'}</button>
      {run && s && <span className="muted" style={{ marginLeft: 12 }}>{s.checked} of {s.total || '…'} folders</span>}
      {err && <p className="bad-t" style={{ margin: '10px 0 0' }}>{err}</p>}
      {s && (done || s.checked > 0) && (
        <div style={{ marginTop: 14 }}>
          <p className={clean ? 'ok-t' : 'bad-t'} style={{ margin: '0 0 8px' }}>{!done ? 'Checking…' : clean ? `All clear: ${s.checked} folders and ${s.files} files are private to your team.` : 'Needs attention — see below.'}</p>
          <dl className="kv wide-k">
            <dt>Folders / files checked</dt><dd>{s.checked} / {s.files}</dd>
            <dt>Folders open by link</dt><dd>{s.openFolders.length}</dd>
            <dt>Files open by link</dt><dd>{s.openFileCount}</dd>
            {s.main && <><dt>Main folder “{s.main.name}”</dt><dd>{s.main.access === 'PRIVATE' ? 'private' : s.main.access}</dd></>}
            <dt>Not found in Drive</dt><dd>{s.missing.length}</dd>
          </dl>
          {s.openFolders.length > 0 && <><b>Open folders</b><ul>{s.openFolders.slice(0, 20).map((f) => <li key={f.id}>{f.name} <span className="muted">({f.access})</span></li>)}</ul></>}
          {s.openFiles.length > 0 && <><b>Open files</b><ul>{s.openFiles.slice(0, 20).map((f) => <li key={f.id}>{f.name} <span className="muted">in {f.folder} ({f.access})</span></li>)}</ul></>}
          {outsiders.length > 0 && <><b>People with access who aren’t on your team list</b><ul>{outsiders.map(([e, n]) => <li key={e}>{e} <span className="muted">· {n} folder{n === 1 ? '' : 's'}</span></li>)}</ul></>}
          {done && !clean && <p className="muted" style={{ marginBottom: 0 }}>To fix open folders and files, run <code>lockDownExistingFolders</code> once in Apps Script (Run menu). To remove a person, remove them from the folder in Drive.</p>}
          {done && <p className="muted" style={{ marginBottom: 0 }}>Team list (from Apps Script): {s.team.join(', ') || '—'}. Drive owner: {s.owner}.</p>}
        </div>
      )}
    </div>
  );
}

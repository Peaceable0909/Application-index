'use client';
import { useState } from 'react';
import Icon from './Icon';

type Part = { total: number; next: number; done: boolean; checked: number; files: number; missing: string[]; openFolders: { id: string; name: string; access: string }[]; openFiles: { id: string; name: string; folder: string; folderId?: string; access: string }[]; openFileCount: number; filesUnknown?: number; people: Record<string, number>; owner: string; team: string[]; main?: { name: string; access: string; editors: string[]; viewers: string[] }; error?: string };
type Sum = { total: number; checked: number; files: number; missing: string[]; openFolders: Part['openFolders']; openFiles: Part['openFiles']; openFileCount: number; filesUnknown: number; people: Record<string, number>; owner: string; team: string[]; main?: Part['main'] };

/** Asks Google, folder by folder, who can open the students’ documents. Read-only. */
export default function PrivacyCheck() {
  const [fixing, setFixing] = useState<{ done: number; total: number } | null>(null), [fixNote, setFixNote] = useState('');
  const [run, setRun] = useState(false), [s, setS] = useState<Sum | null>(null), [done, setDone] = useState(false), [err, setErr] = useState('');
  async function go() {
    setRun(true); setErr(''); setDone(false);
    const acc: Sum = { total: 0, checked: 0, files: 0, missing: [], openFolders: [], openFiles: [], openFileCount: 0, filesUnknown: 0, people: {}, owner: '', team: [] };
    setS({ ...acc });
    let offset = 0;
    try {
      for (;;) {
        const r = await fetch('/api/privacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset }) });
        const j = (await r.json()) as Part;
        if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
        acc.total = j.total; acc.checked += j.checked; acc.files += j.files; acc.missing.push(...j.missing); acc.openFolders.push(...j.openFolders); acc.openFiles.push(...j.openFiles); acc.openFileCount += j.openFileCount; acc.filesUnknown += j.filesUnknown || 0;
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
  /** Makes every open folder (and the folders holding open files) private to the team, a few at a time, then checks again. */
  async function fix() {
    if (!s || fixing) return;
    if (!window.confirm('Make these folders private?\n\nAnyone who only has a link will lose access. Your team keeps access, and students are not affected (they open their files through the portal).')) return;
    const ids = [...new Set([...s.openFolders.map((f) => f.id), ...s.openFiles.map((f) => f.folderId).filter(Boolean) as string[]])];
    const mainOpen = !!s.main && s.main.access !== 'PRIVATE';
    setErr(''); setFixNote(''); setFixing({ done: 0, total: ids.length });
    let failed = 0, files = 0;
    try {
      for (let i = 0; i < Math.max(ids.length, mainOpen ? 1 : 0); i += 8) {
        const r = await fetch('/api/privacy/fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderIds: ids.slice(i, i + 8), main: mainOpen && i === 0 }) });
        const j = (await r.json()) as { folders?: number; files?: number; failed?: unknown[]; error?: string };
        if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
        failed += j.failed?.length || 0; files += j.files || 0;
        setFixing({ done: Math.min(ids.length, i + 8), total: ids.length });
      }
      setFixNote(`Made ${ids.length - failed} folder${ids.length - failed === 1 ? '' : 's'} private${files ? ` and ${files} file${files === 1 ? '' : 's'}` : ''}${failed ? `, ${failed} could not be changed` : ''}. Checking again…`);
      setFixing(null);
      await go();
    } catch (e) { setErr((e as Error).message); setFixing(null); }
  }
  const known = new Set([...(s?.team || []), s?.owner || '']);
  const outsiders = s ? Object.entries(s.people).filter(([e]) => !known.has(e)).sort((a, b) => b[1] - a[1]) : [];
  const open = s ? s.openFolders.length + s.openFileCount : 0;
  const clean = done && !open && !outsiders.length && !(s?.main && s.main.access !== 'PRIVATE');
  return (
    <div className="card">
      <h2><Icon n="lock" size={17} /> Privacy check</h2>
      <p className="muted" style={{ marginTop: 0 }}>Asks Google who can open the student folders and files in Drive. Running the check only looks; it changes nothing. It shows any folder or file that can be opened by a link, and any person outside your team list who has access.</p>
      <button type="button" className="btn primary" onClick={go} disabled={run}>{run ? 'Checking…' : s ? 'Check again' : 'Run the privacy check'}</button>
      {run && s && <span className="muted" style={{ marginLeft: 12 }}>{s.checked} of {s.total || '…'} folders</span>}
      {err && <p className="bad-t" style={{ margin: '10px 0 0' }}>{err}</p>}
      {fixNote && <p className="ok-t" style={{ margin: '10px 0 0' }}>{fixNote}</p>}
      {s && (done || s.checked > 0) && (
        <div style={{ marginTop: 14 }}>
          <p className={clean ? 'ok-t' : 'bad-t'} style={{ margin: '0 0 8px' }}>{!done ? 'Checking…' : clean ? `All clear: ${s.checked} folders and ${s.files} files are private to your team.` : 'Needs attention — see below.'}</p>
          <dl className="kv wide-k">
            <dt>Folders / files checked</dt><dd>{s.checked} / {s.files}</dd>
            <dt>Folders open by link</dt><dd>{s.openFolders.length}</dd>
            <dt>Files open by link</dt><dd>{s.openFileCount}</dd>
            {s.main && <><dt>Main folder “{s.main.name}”</dt><dd>{s.main.access === 'PRIVATE' ? 'private' : s.main.access}</dd></>}
            <dt>Not found in Drive</dt><dd>{s.missing.length}</dd>
            {s.filesUnknown > 0 && <><dt>Files this check can’t see</dt><dd>{s.filesUnknown} <span className="muted">(owned by another Google account; their folders are private, but only that account can switch their own link sharing off)</span></dd></>}
          </dl>
          {s.openFolders.length > 0 && <><b>Open folders</b><ul>{s.openFolders.slice(0, 20).map((f) => <li key={f.id}>{f.name} <span className="muted">({f.access})</span></li>)}</ul></>}
          {s.openFiles.length > 0 && <><b>Open files</b><ul>{s.openFiles.slice(0, 20).map((f) => <li key={f.id}>{f.name} <span className="muted">in {f.folder} ({f.access})</span></li>)}</ul></>}
          {outsiders.length > 0 && <><b>People with access who aren’t on your team list</b><ul>{outsiders.map(([e, n]) => <li key={e}>{e} <span className="muted">· {n} folder{n === 1 ? '' : 's'}</span></li>)}</ul></>}
          {done && (open > 0 || (s.main && s.main.access !== 'PRIVATE')) && (
            <div className="callout" style={{ background: 'var(--amber-soft)', alignItems: 'center', margin: '8px 0' }}>
              <div style={{ flex: 1 }}><b>{s.openFolders.length} folder{s.openFolders.length === 1 ? '' : 's'} can be opened by anyone with the link.</b> That includes the documents inside. Making them private keeps your team’s access and removes everyone else’s.</div>
              <button type="button" className="btn primary" onClick={fix} disabled={!!fixing || run}>{fixing ? `Working… ${fixing.done}/${fixing.total}` : 'Make them private now'}</button>
            </div>
          )}
          {done && !clean && outsiders.length > 0 && <p className="muted" style={{ marginBottom: 0 }}>To remove a person, remove them from the folder in Drive.</p>}
          {done && <p className="muted" style={{ marginBottom: 0 }}>Team list (from Apps Script): {s.team.join(', ') || '—'}. Drive owner: {s.owner}.</p>}
        </div>
      )}
    </div>
  );
}

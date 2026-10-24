'use client';
import { useId, useState } from 'react';

/** Destination + what it covers (a school, the whole destination, or a location). The school and location boxes only show when they are needed,
 *  and suggest the spellings that already exist in that destination. */
export default function TargetFields({ workspaces, schools, cities, allow = ['school', 'country', 'location'] }: {
  workspaces: { key: string; name: string }[]; schools: Record<string, string[]>; cities: Record<string, string[]>; allow?: ('school' | 'country' | 'location')[];
}) {
  const [ws, setWs] = useState(workspaces[0]?.key || '');
  const [scope, setScope] = useState<string>(allow[0]);
  const id = useId();
  const word = { school: 'A school', country: 'The whole destination', location: 'A location (city or office)' } as const;
  return (
    <>
      <label>Destination<select name="workspace" value={ws} onChange={(e) => setWs(e.target.value)} required>{workspaces.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}</select></label>
      <label>Covers<select name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>{allow.map((a) => <option key={a} value={a}>{word[a]}</option>)}</select></label>
      {scope === 'school' && (
        <label>School<input name="school" list={`${id}-s`} required maxLength={120} placeholder="Start typing, for example CCCU" autoComplete="off" />
          <datalist id={`${id}-s`}>{(schools[ws] || []).map((s) => <option key={s} value={s} />)}</datalist></label>
      )}
      {scope === 'location' && (
        <label>Location<input name="location" list={`${id}-c`} required maxLength={80} placeholder="For example Lagos" autoComplete="off" />
          <datalist id={`${id}-c`}>{(cities[ws] || []).map((s) => <option key={s} value={s} />)}</datalist></label>
      )}
    </>
  );
}

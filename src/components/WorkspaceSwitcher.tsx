'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { switchWorkspace } from '@/app/workspaceActions';

/** Which country's students you are working with. Only shown to people who may open more than one. */
export default function WorkspaceSwitcher({ list, current }: { list: { key: string; name: string }[]; current: string }) {
  const router = useRouter();
  const [busy, go] = useTransition();
  if (list.length < 2) return null;
  return (
    <label className={`wsw ${busy ? 'busy' : ''}`} title="Switch country">
      <Icon n="globe" size={16} />
      <select value={current} aria-label="Workspace" disabled={busy} onChange={(e) => go(async () => { const r = await switchWorkspace(e.target.value); if (r.ok) router.refresh(); })}>
        {list.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
      </select>
    </label>
  );
}

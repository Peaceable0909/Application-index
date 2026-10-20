import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { callScript } from '@/lib/appsScript';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };
const STEP = 25;

type Audit = { checked: number; files: number; missing: string[]; openFolders: { id: string; name: string; access: string }[]; openFiles: { id: string; name: string; folder: string; access: string }[]; openFileCount: number; filesUnknown?: number; people: Record<string, number>; owner: string; team: string[]; main?: { name: string; access: string; editors: string[]; viewers: string[] } };

/** Admins only. Read-only: asks Google who can open the student folders, STEP folders at a time, so the page can show progress. */
export async function POST(req: Request) {
  const me = await currentStaff();
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403, headers: no });
  const { offset = 0 } = (await req.json().catch(() => ({}))) as { offset?: number };
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const { data } = await admin().from('portal_applications').select('drive_folder_id, extra_folder_ids');
  const ids = [...new Set((data || []).flatMap((r) => [r.drive_folder_id, ...(r.extra_folder_ids || [])]).filter(Boolean) as string[])].sort();
  const part = ids.slice(start, start + STEP);
  try {
    const a = await callScript<Audit>('auditSharing', { folderIds: part, includeMain: start === 0 });
    return NextResponse.json({ total: ids.length, next: start + part.length, done: start + part.length >= ids.length, ...a }, { headers: no });
  } catch (e) {
    const m = (e as Error).message;
    return NextResponse.json({ error: /unknown action|not supported|Unknown/i.test(m) ? 'Your Apps Script doesn’t have the privacy check yet. Paste the new PortalApi.gs and deploy a new version.' : m }, { status: 502, headers: no });
  }
}

import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { callScript } from '@/lib/appsScript';
import { audit } from '@/lib/audit';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };

/** Admins only: makes the given student folders private to the team (people who only had a link lose access). Only folders the portal knows about are touched, a few at a time. */
export async function POST(req: Request) {
  const me = await currentStaff();
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403, headers: no });
  const j = (await req.json().catch(() => null)) as { folderIds?: unknown; main?: boolean } | null;
  const asked = Array.isArray(j?.folderIds) ? j!.folderIds.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  const { data } = await admin().from('portal_applications').select('drive_folder_id, extra_folder_ids');
  const known = new Set((data || []).flatMap((r) => [r.drive_folder_id, ...(r.extra_folder_ids || [])]).filter(Boolean) as string[]);
  const ids = asked.filter((x) => known.has(x));
  try {
    const r = await callScript<{ folders: number; files: number; failed: { id: string; error: string }[]; main?: boolean }>('lockDown', { folderIds: ids, main: j?.main === true });
    if (ids.length || r.main) await audit(me.email, 'drive_locked_down', `${r.folders} folders`, { files: r.files, failed: r.failed.length });
    return NextResponse.json(r, { headers: no });
  } catch (e) {
    const m = (e as Error).message;
    return NextResponse.json({ error: /unknown action/i.test(m) ? 'Your Apps Script doesn’t have the lock-down yet. Paste the newest PortalApi.gs and deploy a new version.' : m }, { status: 502, headers: no });
  }
}

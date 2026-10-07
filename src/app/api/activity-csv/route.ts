import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';

const cell = (v: unknown) => { const t = typeof v === 'object' && v ? JSON.stringify(v) : String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

// Activity (or admin log) as a spreadsheet, honouring the page's filters.
export async function GET(req: Request) {
  const me = await currentStaff();
  if (!me || me.role === 'counselor') return new NextResponse('Unauthorized', { status: 401 });
  const sp = new URL(req.url).searchParams, day = (k: string, end = false) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) || '') ? `${sp.get(k)}T${end ? '23:59:59' : '00:00:00'}Z` : null);
  const adminLog = sp.get('tab') === 'admin', db = admin();
  let lines: string[];
  if (adminLog) {
    let q = db.from('portal_audit').select('created_at, actor, action, target, detail').order('created_at', { ascending: false }).limit(5000);
    if (sp.get('actor')) q = q.eq('actor', sp.get('actor')!); if (day('from')) q = q.gte('created_at', day('from')!); if (day('to', true)) q = q.lte('created_at', day('to', true)!);
    const { data } = await q; lines = [['When', 'Who', 'Action', 'Target', 'Detail'].join(','), ...(data || []).map((r) => [r.created_at, r.actor, r.action, r.target, r.detail].map(cell).join(','))];
  } else {
    let q = db.from('portal_activity').select('created_at, actor, kind, detail, portal_applications(name)').order('created_at', { ascending: false }).limit(5000);
    if (sp.get('kind')) q = q.eq('kind', sp.get('kind')!); if (sp.get('actor')) q = q.eq('actor', sp.get('actor')!); if (day('from')) q = q.gte('created_at', day('from')!); if (day('to', true)) q = q.lte('created_at', day('to', true)!);
    const { data } = await q; lines = [['When', 'Who', 'What', 'Student', 'Detail'].join(','), ...(data || []).map((r) => [r.created_at, r.actor, r.kind, (r.portal_applications as unknown as { name: string } | null)?.name, r.detail].map(cell).join(','))];
  }
  return new NextResponse('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${adminLog ? 'admin-log' : 'activity'}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
}

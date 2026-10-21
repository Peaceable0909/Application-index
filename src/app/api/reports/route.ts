import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { buildReport, defaultRange, reportCsv } from '@/lib/reports';
import { buildFunnel, funnelCsv } from '@/lib/funnel';
import { workspacesFor } from '@/lib/workspace';

export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || staff.role === 'counselor') return new NextResponse('Unauthorized', { status: 401 });
  const u = new URL(req.url), d = defaultRange();
  const range = { from: /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('from') || '') ? u.searchParams.get('from')! : d.from, to: /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('to') || '') ? u.searchParams.get('to')! : d.to };
  const kind = u.searchParams.get('kind') || 'university';
  if (kind.startsWith('funnel')) {
    const f = await buildFunnel(range, (await workspacesFor(staff)).map((w) => w.key));
    return new NextResponse(funnelCsv(f, kind), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="report-${kind}-${range.from}-${range.to}.csv"` } });
  }
  return new NextResponse(reportCsv(await buildReport(range), kind), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="report-${kind}-${range.from}-to-${range.to}.csv"`, 'Cache-Control': 'no-store' } });
}

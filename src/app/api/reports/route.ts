import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { buildReport, defaultRange, reportCsv } from '@/lib/reports';

export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff || staff.role === 'counselor') return new NextResponse('Unauthorized', { status: 401 });
  const u = new URL(req.url), d = defaultRange();
  const range = { from: /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('from') || '') ? u.searchParams.get('from')! : d.from, to: /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('to') || '') ? u.searchParams.get('to')! : d.to };
  const kind = u.searchParams.get('kind') || 'university';
  return new NextResponse(reportCsv(await buildReport(range), kind), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="report-${kind}-${range.from}-to-${range.to}.csv"`, 'Cache-Control': 'no-store' } });
}

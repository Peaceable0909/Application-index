import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { loadStudents } from '@/lib/overview';
import { filterRows, toCsv } from '@/lib/filters';

const csv = (body: string) => new NextResponse(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="peaceable-students-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });

// GET = everything matching the current filters.
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return new NextResponse('Unauthorized', { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { rows } = await loadStudents({ dups: !!sp.dups });
  return csv(toCsv(filterRows(rows, sp, staff.last_seen_at)));
}

// POST = only the rows ticked on the Applications page.
export async function POST(req: Request) {
  if (!(await currentStaff())) return new NextResponse('Unauthorized', { status: 401 });
  const ids = new Set((await req.formData()).getAll('ids').map(String));
  if (!ids.size) return new NextResponse('Tick at least one student first.', { status: 400 });
  const { rows } = await loadStudents({ dups: true });
  return csv(toCsv(rows.filter((r) => ids.has(r.a.application_id))));
}

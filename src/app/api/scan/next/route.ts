import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { scanNext, scanStatus } from '@/lib/scanQueue';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };

/** Team only: where the document check stands. */
export async function GET() {
  const me = await currentStaff();
  if (!me || me.role === 'counselor') return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  return NextResponse.json(await scanStatus(), { headers: no });
}

/** Team only: checks the next few unchecked documents and says how many are left, so the page can call again. */
export async function POST(req: Request) {
  const me = await currentStaff();
  if (!me || me.role === 'counselor') return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  const body = (await req.json().catch(() => ({}))) as { skip?: unknown };
  const skip = Array.isArray(body.skip) ? body.skip.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
  try { return NextResponse.json(await scanNext(me.email, { skip }), { headers: no }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: no }); }
}

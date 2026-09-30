import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/sync';

export const maxDuration = 60;

// Called by Vercel Cron (GET) and by the Apps Script webhook (POST).
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try { return NextResponse.json(await syncAll()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
export const GET = handle;
export const POST = handle;

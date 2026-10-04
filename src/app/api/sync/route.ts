import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/sync';
import { sendWeeklyDigests } from '@/lib/requests';
import { runBackup } from '@/lib/backup';

export const maxDuration = 60;

// Called by Vercel Cron (GET) and by the Apps Script webhook (POST).
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await syncAll();
    // Mondays: opt-in digest to each counselor (WEEKLY_DIGEST=on)
    const digest = new Date().getUTCDay() === 1 ? await sendWeeklyDigests().catch((e) => ({ error: (e as Error).message })) : undefined;
    // Daily: private backup of the portal's data (only on the scheduled GET, not on every sheet-change webhook)
    const backup = req.method === 'GET' ? await runBackup('nightly backup').catch((e) => ({ error: (e as Error).message })) : undefined;
    return NextResponse.json({ ...result, ...(digest ? { digest } : {}), ...(backup ? { backup } : {}) });
  }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
export const GET = handle;
export const POST = handle;

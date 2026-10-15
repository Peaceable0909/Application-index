import { createHmac } from 'node:crypto';
import { after } from 'next/server';

// "Look again now" nudges. A phone or computer with the app open listens on a private channel of its own (Supabase Realtime) and the
// server pings that channel when a message arrives or a call starts, so it shows up at once instead of at the next refresh.
// A nudge carries no content, only the kind of event: the app then asks the server (signed in) what actually happened.
// Nothing depends on it: the regular refresh still runs, just less often.
export type RtRole = 'staff' | 'student';
export type RtWho = { role: RtRole; email: string };
export type RtEvent = 'msg' | 'ring' | 'call';

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PORTAL_TOKEN || 'dev';
/** An unguessable channel name per person (nobody else can work it out from an email address). */
export const topicFor = (w: RtWho) => 'rt-' + createHmac('sha256', secret()).update(`${w.role}:${w.email.trim().toLowerCase()}`).digest('base64url').slice(0, 32);
export const rtConfig = () => { const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; return url && key ? { url, key } : null; };

export async function nudge(to: RtWho[], event: RtEvent, payload: Record<string, unknown> = {}): Promise<void> {
  const cfg = rtConfig();
  const topics = [...new Set(to.filter((w) => w.email).map(topicFor))];
  if (!cfg || !topics.length) return;
  try {
    await fetch(`${cfg.url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event, payload, private: false })) }),
    });
  } catch { /* the regular refresh will catch up */ }
}

/** Sends after the response has gone out (so the sender isn't kept waiting). */
export function nudgeLater(to: RtWho[], event: RtEvent, payload: Record<string, unknown> = {}) {
  try { after(() => nudge(to, event, payload)); } catch { void nudge(to, event, payload); }
}

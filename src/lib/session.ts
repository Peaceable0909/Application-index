// How long a team sign-in may sit unused and how long it may last in total.
// Change them in Vercel with SESSION_IDLE_MINUTES and SESSION_MAX_HOURS (no code change).
const num = (v: string | undefined, fallback: number, min: number) => { const n = Number(v); return Number.isFinite(n) && n >= min ? n : fallback; };

export const IDLE_MIN = num(process.env.SESSION_IDLE_MINUTES, 60, 5);
export const MAX_HOURS = num(process.env.SESSION_MAX_HOURS, 12, 1);

/** The page tells the server it is still in use at most every 4 minutes, so the server allows 5 minutes on top. */
export const IDLE_MS = (IDLE_MIN + 5) * 60_000;
export const MAX_MS = MAX_HOURS * 3_600_000;

/** Cookie holding the time of the last "still here" signal. Only the page's own activity writes it, never background polling. */
export const ACT_COOKIE = 'wr_act';
export const actCookie = () => ({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 14 });

// Video-call links for interview training. Google Meet is the default; Teams links are still accepted.
const OK = /^(?:[a-z0-9-]+\.)*(?:teams\.microsoft\.com|teams\.live\.com|microsoft\.com|office\.com)$/i;

export function checkMeetingUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    if (u.hostname.toLowerCase() === 'meet.google.com' && /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[\w-]+|_meet\/[\w-]+)\/?$/i.test(u.pathname)) return `https://meet.google.com${u.pathname}`;
    return OK.test(u.hostname) ? u.href : null;
  } catch { return null; }
}
export function providerName(url: string): string {
  try { const h = new URL(url).hostname.toLowerCase(); if (h === 'meet.google.com') return 'Google Meet'; if (OK.test(h)) return 'Microsoft Teams'; } catch { /* fall through */ }
  return 'the video call';
}

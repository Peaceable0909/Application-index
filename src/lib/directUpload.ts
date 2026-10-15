export type Uploaded = { path: string; name: string; type: string; size: number };

/** Sends a big file (a GIF, a PDF) straight to storage, past the size a request to the server can carry. Returns where it went, for the message that points at it. */
export async function uploadBig(app: string, f: File): Promise<Uploaded> {
  const r = await fetch('/api/thread/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, name: f.name, type: f.type, size: f.size }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; path?: string; url?: string; key?: string };
  if (!j.ok || !j.path || !j.url) throw new Error(j.error || 'Could not start the upload. Please try again.');
  const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', f);
  const put = await fetch(j.url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false', ...(j.key ? { apikey: j.key, Authorization: `Bearer ${j.key}` } : {}) } });
  if (!put.ok) throw new Error('The upload didn’t go through. Check your connection and try again.');
  return { path: j.path, name: f.name, type: f.type, size: f.size };
}

/** Anything over this goes straight to storage instead of through the server (the server only takes ~4 MB per request). */
export const BIG_FILE = 3_500_000;

// Server-only client for the Apps Script web app (PortalApi.gs).
type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export async function callScript<T>(action: string, payload: unknown = {}): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error('APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN are not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action, token, payload: JSON.stringify(payload) }),
    redirect: 'follow',
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Reply<T>;
  try { json = JSON.parse(text); } catch {
    if (res.status === 404) throw new Error('Google says the Apps Script web app address no longer exists (404). Redeploy it, copy the new Web app URL, and update APPS_SCRIPT_URL in Vercel, then redeploy the portal.');
    if (/accounts\.google\.com|sign in/i.test(text)) throw new Error('The Apps Script web app asks for a Google sign-in. In Deploy → Manage deployments, set “Who has access” to Anyone.');
    // keep what Google actually said (tags stripped) so the cause is visible instead of a generic message
    const said = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`Apps Script returned something unexpected (HTTP ${res.status}${said ? `: "${said}"` : ', empty reply'}). Check the deployment and APPS_SCRIPT_URL.`);
  }
  if (!json.ok) throw new Error(`Apps Script: ${json.error}`);
  return json.data;
}

export type SheetRow = {
  applicationId: string; row: number; submittedAt: string; name: string; email: string; phone: string;
  school: string; programme: string; country: string; city: string; gender: string; dob: string; age: string;
  counselor: string; status: string; notes: string; driveFolderId: string;
};
export type DriveFile = { id: string; name: string; mimeType: string; size: number; url: string; createdAt: string; path?: string };
export type MasterRow = {
  row: number; studentIdOrDate: string; name: string; email: string; phone: string; school: string; programme: string;
  country: string; city: string; gender: string; dob: string; age: string; counselor: string; status: string; notes: string;
};
export type RegentRow = {
  row: number; date: string; name: string; email: string; phone: string; school: string; programme: string; country: string;
  city: string; gender: string; oppId: string; payment: string; counselor: string; status: string; notes: string; interview: string;
};

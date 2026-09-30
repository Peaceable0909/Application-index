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
  try { json = JSON.parse(text); } catch { throw new Error(`Apps Script returned non-JSON (${res.status})`); }
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

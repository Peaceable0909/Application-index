import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { callScript } from '@/lib/appsScript';
import { currentWorkspace } from '@/lib/workspace';

export const maxDuration = 60;
const no = { 'Cache-Control': 'no-store' };
const OK = /^(application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|image\/(jpeg|png|webp)|text\/(plain|markdown|csv))$/;
const EXT = /\.(pdf|docx?|jpe?g|png|webp|txt|md|csv)$/i;
const mimeOf = (n: string) => (/\.pdf$/i.test(n) ? 'application/pdf' : /\.docx$/i.test(n) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : /\.doc$/i.test(n) ? 'application/msword' : /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : 'text/plain');

/** Team only: reads a file (handbook, requirements sheet, price list…) and keeps its text so the Brain can quote from it. */
export async function POST(req: Request) {
  const me = await currentStaff();
  if (!me || me.role === 'counselor') return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: no });
  const f = await req.formData().catch(() => null);
  const file = f?.get('file');
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose a file first.' }, { status: 400, headers: no });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: 'That file is over 4 MB. Split it or send a smaller copy.' }, { status: 400, headers: no });
  const type = OK.test(file.type) ? file.type : EXT.test(file.name) ? mimeOf(file.name) : '';
  if (!type) return NextResponse.json({ error: 'Use a PDF, Word file, photo (JPG/PNG) or text file.' }, { status: 400, headers: no });
  const title = String(f?.get('title') || '').trim().slice(0, 120) || file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  const school = String(f?.get('school') || '').trim() || null;
  if (title.length < 2) return NextResponse.json({ error: 'Give it a title.' }, { status: 400, headers: no });
  let r: { text: string; chars: number; truncated: boolean };
  try { r = await callScript('extractBlob', { name: file.name, mimeType: type, base64: Buffer.from(await file.arrayBuffer()).toString('base64') }); }
  catch (e) { const m = (e as Error).message; return NextResponse.json({ error: /unknown action/i.test(m) ? 'Your Apps Script needs the newest PortalApi.gs to read files. Paste it in and deploy a new version.' : /Drive is not defined/i.test(m) ? 'Add the Drive API service in Apps Script (Services → Drive API), then try again.' : m }, { status: 502, headers: no }); }
  if (r.chars < 80) return NextResponse.json({ error: 'I couldn’t find readable text in that file. A clearer scan, or a text/Word version, would work.' }, { status: 422, headers: no });
  const ws = await currentWorkspace();
  const { error } = await admin().from('portal_brain_docs').insert({ workspace: ws, title, school, body: r.text, chars: r.chars, created_by: me.email });
  if (error) return NextResponse.json({ error: 'Could not save it.' }, { status: 500, headers: no });
  return NextResponse.json({ ok: true, chars: r.chars, truncated: r.truncated }, { headers: no });
}

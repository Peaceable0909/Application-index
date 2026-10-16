import { admin } from './supabase';
import { callScript } from './appsScript';
import { generateOnce } from './ai';
import { ALL_DOC_TYPES } from './constants';

// Opt-in: sends one document's TEXT (read by OCR inside your Apps Script) to Qwen. Off unless AI_DOC_SCAN=on in Vercel.
export const docScanEnabled = () => process.env.AI_DOC_SCAN === 'on';

export type ScanFlag = { kind: 'type' | 'name' | 'expiry' | 'unreadable'; text: string; detected?: string };
export type Fact = { label: string; value: string };
export type Scan = { drive_file_id: string; facts?: Fact[]; detected_type: string | null; confidence: number | null; person_name: string | null; issuer: string | null; expiry_date: string | null; flags: ScanFlag[]; readable: boolean };

const words = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
function nameOverlap(a: string, b: string) {
  const A = new Set(words(a)), B = words(b);
  if (!A.size || !B.length) return 1; // nothing to compare
  return B.filter((t) => A.has(t)).length / Math.min(A.size, B.length);
}

const SYSTEM =
  "You analyse the OCR text of ONE document from a student's university application. Say what the document is and read only what is printed on it. " +
  `Reply as JSON: {"documentType": one of ${JSON.stringify(ALL_DOC_TYPES)}, "confidence": number 0-1, "personName": the full name printed as holder/candidate/author or null, "issuer": issuing institution or authority or null, "expiryDate": expiry date as YYYY-MM-DD only if printed, else null, "facts": up to 6 {"label","value"} pairs of key details printed on it}. ` +
  'Facts by type: Passport = Nationality, Issue date; Transcript / Degree Certificate = Programme, Class of degree or CGPA, Graduation year; WAEC/NECO = Exam year, Number of credits; IELTS = Overall, Listening, Reading, Writing, Speaking, Test date; Offer Letter = University, Course, Start date. Keep values short. NEVER put ID, passport, candidate, phone or bank numbers, addresses or photos in facts. ' +
  'Meanings: Passport = passport data page; Transcript = record of courses and grades; Degree Certificate = degree/diploma/certificate of award; WAEC/NECO = secondary-school exam result or certificate (WAEC, NECO, GCE); SOP = personal statement / statement of purpose; Reference = recommendation letter; IELTS = English test report; CV = résumé. ' +
  'Never guess. If unsure use "Other" with low confidence. Output only the JSON.';

/** Keeps a handful of short label/value pairs and drops anything that looks like an ID, passport or phone number. */
export function cleanFacts(raw: unknown): Fact[] {
  if (!Array.isArray(raw)) return [];
  const out: Fact[] = [];
  for (const f of raw) {
    const label = typeof (f as Fact)?.label === 'string' ? (f as Fact).label.trim().slice(0, 30) : '', value = typeof (f as Fact)?.value === 'string' || typeof (f as Fact)?.value === 'number' ? String((f as Fact).value).trim().slice(0, 80) : '';
    if (!label || !value || /\d{7,}/.test(value) || /\+?\d[\d\s-]{11,}\d/.test(value) || /\b(passport|id|candidate|phone|account)\s*(no|number|#)/i.test(label)) continue;
    out.push({ label, value });
    if (out.length === 6) break;
  }
  return out;
}

export async function scanOne(o: { appId: string; fileId: string; filedAs: string; studentName: string; actor: string }): Promise<Scan> {
  const db = admin();
  const save = async (s: Omit<Scan, 'drive_file_id'>) => {
    const row = { drive_file_id: o.fileId, application_id: o.appId, ...s, scanned_by: o.actor, created_at: new Date().toISOString() };
    await db.from('portal_doc_scans').upsert(row, { onConflict: 'drive_file_id' });
    return { drive_file_id: o.fileId, ...s } as Scan;
  };

  const ex = await callScript<{ text: string; chars: number }>('extractText', { fileId: o.fileId });
  if (ex.chars < 40) return save({ detected_type: null, confidence: null, person_name: null, issuer: null, expiry_date: null, readable: false, facts: [], flags: [{ kind: 'unreadable', text: 'Couldn’t read any text — the scan may be too faint, rotated or an unsupported file.' }] });

  const r = await generateOnce<{ documentType: string; confidence: number; personName: string | null; issuer: string | null; expiryDate: string | null; facts: Fact[] }>({
    kind: 'docscan', maxTokens: 500, system: SYSTEM, user: ex.text.slice(0, 4000),
    validate: (raw) => {
      const d = raw as Record<string, unknown>;
      const type = String(d?.documentType || '');
      const conf = Number(d?.confidence);
      if (!(ALL_DOC_TYPES as readonly string[]).includes(type) || !(conf >= 0 && conf <= 1)) return null;
      const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
      const exp = typeof d?.expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.expiryDate) ? d.expiryDate : null;
      return { documentType: type, confidence: conf, personName: str(d?.personName, 80), issuer: str(d?.issuer, 100), expiryDate: exp, facts: cleanFacts(d?.facts) };
    },
  });

  // Flags are worked out here from the extracted facts, not by the model, so they stay predictable.
  const flags: ScanFlag[] = [];
  if (r.documentType !== o.filedAs && r.documentType !== 'Other' && r.confidence >= 0.7) flags.push({ kind: 'type', detected: r.documentType, text: `Looks like a ${r.documentType}, but it is filed as ${o.filedAs}.` });
  if (r.personName && !['Reference', 'SOP', 'Other'].includes(r.documentType) && nameOverlap(o.studentName, r.personName) < 0.5) flags.push({ kind: 'name', text: `The name on the document (“${r.personName}”) may not match this student.` });
  if (r.documentType === 'Passport' && r.expiryDate) {
    const days = Math.floor((new Date(r.expiryDate).getTime() - Date.now()) / 864e5);
    if (days < 0) flags.push({ kind: 'expiry', text: `Passport appears expired (${r.expiryDate}).` });
    else if (days < 183) flags.push({ kind: 'expiry', text: `Passport expires within 6 months (${r.expiryDate}).` });
  }
  return save({ detected_type: r.documentType, confidence: r.confidence, person_name: r.personName, issuer: r.issuer, expiry_date: r.expiryDate, readable: true, facts: r.facts, flags });
}

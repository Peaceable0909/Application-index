import { PROGRESS, REQUIRED_DOCS, STATUSES } from './constants';

// Files saved by the app are named "<Student> - <Type>.pdf".
export function docTypeFromName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const label = (base.includes(' - ') ? base.split(' - ').pop()! : base).toLowerCase();
  if (/passport/.test(label)) return 'Passport';
  if (/\bcv\b|resume|curriculum/.test(label)) return 'CV';
  if (/transcript/.test(label)) return 'Transcript';
  if (/waec|neco|o.?level|ssce/.test(label)) return 'WAEC/NECO';
  if (/certificate|degree|diploma/.test(label)) return 'Degree Certificate';
  if (/sop|statement|purpose/.test(label)) return 'SOP';
  if (/ref/.test(label)) return 'Reference';
  if (/ielts|toefl|english|duolingo/.test(label)) return 'IELTS';
  return 'Other';
}

export function missingDocs(presentTypes: Iterable<string>): string[] {
  const have = new Set(presentTypes);
  return REQUIRED_DOCS.filter((d) => !have.has(d));
}

// "RCL" (master sheet) and "Regent College London (RCL)" (form) are the same school.
export function schoolKey(school: string | null): string {
  const s = (school || '').toLowerCase().trim();
  if (!s) return '';
  if (/regent|\brcl\b/.test(s)) return 'rcl';
  if (/canterbury|\bcccu\b/.test(s)) return 'cccu';
  if (/\bbpp\b/.test(s)) return 'bpp';
  if (/york st/.test(s)) return 'ysj';
  return s.replace(/[^a-z0-9]+/g, '');
}
export function schoolDisplay(school: string | null): string | null {
  const k = schoolKey(school);
  if (k === 'rcl') return 'Regent College London (RCL)';
  if (k === 'cccu') return 'Canterbury Christ Church University (CCCU)';
  return school?.trim() || null;
}
export const normEmail = (e: string | null) => (e || '').trim().toLowerCase();
export const normName = (n: string | null) => (n || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

export function studentKey(email: string | null, school: string | null, name: string): string {
  return `${normEmail(email) || normName(name)}|${schoolKey(school)}`;
}

// "interview taken" / "AWAITING CAS" -> canonical label from our list.
export function canonicalStatus(s: string | null): string | null {
  const t = (s || '').trim();
  if (!t) return null;
  if (/^application rejected$/i.test(t)) return 'Rejected';
  return STATUSES.find((x) => x.toLowerCase() === t.toLowerCase()) || t;
}
export function progressFor(status: string | null): number | null {
  return status && PROGRESS[status] != null ? PROGRESS[status] : null;
}

export function counselorKey(name: string | null): string {
  return (name || '').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr)\b\.?/g, '').replace(/\s+/g, ' ').trim();
}

export const effType = (d: { doc_type: string; type_override?: string | null }) => d.type_override || d.doc_type;

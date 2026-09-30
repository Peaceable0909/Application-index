import { REQUIRED_DOCS } from './constants';

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

export function studentKey(email: string | null, school: string | null, name: string): string {
  return `${(email || name).trim().toLowerCase()}|${(school || '').trim().toLowerCase()}`;
}

export function counselorKey(name: string | null): string {
  return (name || '').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr)\b\.?/g, '').replace(/\s+/g, ' ').trim();
}

// Reads the two machine-readable lines at the bottom of a passport (ICAO 9303, 44 characters each). They carry check digits, so a reading is
// either provably right or rejected: no AI is involved, nothing is guessed, and the passport number never leaves this function.
const W = [7, 3, 1];
const val = (c: string) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
export const checkDigit = (s: string) => s.split('').reduce((a, c, i) => a + val(c) * W[i % 3], 0) % 10;
const ok = (field: string, digit: string) => /\d/.test(digit) && checkDigit(field) === Number(digit);

// OCR mixes up look-alike characters. In a field that can only hold digits, put the digit back.
const DIGITIZE: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };
const digits = (s: string) => s.replace(/[A-Z]/g, (c) => DIGITIZE[c] ?? c);

export type Mrz = { country: string; nationality: string; surname: string; given: string; sex: string; birth: string | null; expiry: string; composite: boolean };

const iso = (yymmdd: string, kind: 'birth' | 'expiry'): string | null => {
  const yy = Number(yymmdd.slice(0, 2)), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6);
  if (!/^\d{6}$/.test(yymmdd) || Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  const now = new Date().getUTCFullYear() % 100;
  const year = kind === 'expiry' ? 2000 + yy : yy > now ? 1900 + yy : 2000 + yy;
  return `${year}-${mm}-${dd}`;
};
const title = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Finds and verifies a passport MRZ anywhere in OCR text (spaces and line breaks in the text don't matter). Returns null unless the check digits agree. */
export function parseMrz(text: string): Mrz | null {
  const t = text.toUpperCase().replace(/[«‹]/g, '<').replace(/\s+/g, '');
  for (let i = 44; i + 44 <= t.length; i++) {
    const w = t.slice(i, i + 44);
    if (!/^[A-Z0-9<]{44}$/.test(w) || !/[MF<X]/.test(w[20])) continue;
    // positions: 0-8 number, 9 check, 10-12 nationality, 13-18 birth, 19 check, 20 sex, 21-26 expiry, 27 check, 28-41 personal, 42 check, 43 composite
    const birth = digits(w.slice(13, 19)), expiry = digits(w.slice(21, 27)), c1 = digits(w[9]), c2 = digits(w[19]), c3 = digits(w[27]);
    if (!ok(w.slice(0, 9), c1) || !ok(birth, c2) || !ok(expiry, c3)) continue;
    const exp = iso(expiry, 'expiry');
    if (!exp) continue;
    const composite = ok(w.slice(0, 10) + birth + c2 + expiry + c3 + w.slice(28, 42) + digits(w[42]), digits(w[43]));
    const l1 = t.slice(i - 44, i);
    let surname = '', given = '', country = w.slice(10, 13).replace(/</g, '');
    if (/^P[A-Z<]/.test(l1)) {
      country = l1.slice(2, 5).replace(/</g, '') || country;
      const [s, g] = l1.slice(5).split('<<');
      surname = title((s || '').replace(/</g, ' ').trim());
      given = title((g || '').replace(/</g, ' ').trim());
    }
    return { country, nationality: w.slice(10, 13).replace(/</g, ''), surname, given, sex: w[20] === '<' ? 'X' : w[20], birth: iso(birth, 'birth'), expiry: exp, composite };
  }
  return null;
}

/** Hides machine-readable lines and long ID-like strings before any text goes to an AI service. */
export function redactForAi(text: string): string {
  return text
    .replace(/[A-Z0-9<«]{25,}/g, '[machine-readable line removed]')
    .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,12}\b/g, '[id removed]');
}

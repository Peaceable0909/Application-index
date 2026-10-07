// Plain pattern matching over extracted text. No AI, so nothing is invented: it only points at things that are printed in the document.
export type Facts = {
  emails: string[]; phones: string[]; dates: string[];
  mrz: null | { surname: string; given: string; number: string; nationality: string; dob: string; sex: string; expiry: string };
  words: number;
};

const uniq = (a: string[], n = 12) => [...new Set(a.map((x) => x.trim()))].slice(0, n);
const yymmdd = (s: string, future: boolean) => {
  if (!/^\d{6}$/.test(s)) return '';
  const yy = +s.slice(0, 2), mm = s.slice(2, 4), dd = s.slice(4, 6);
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return '';
  const now = new Date().getFullYear() % 100;
  const century = future ? 2000 : yy > now ? 1900 : 2000;   // expiry is always this century, birth dates are not in the future
  return `${dd}/${mm}/${century + yy}`;
};

export function factsFrom(text: string): Facts {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, '').toUpperCase());
  let mrz: Facts['mrz'] = null;
  for (let i = 0; i < lines.length - 1 && !mrz; i++) {
    const a = lines[i], b = lines[i + 1];
    if (/^P[<A-Z][A-Z]{3}[A-Z<]{10,}/.test(a) && /^[A-Z0-9<]{40,46}$/.test(b) && a.length >= 40) {
      const [surname, ...rest] = a.slice(5).split('<<');
      const given = rest.join(' ').replace(/</g, ' ').trim(), dob = yymmdd(b.slice(13, 19), false), expiry = yymmdd(b.slice(21, 27), true);
      if (surname && dob && expiry) mrz = { surname: surname.replace(/</g, ' ').trim(), given, number: b.slice(0, 9).replace(/</g, ''), nationality: b.slice(10, 13).replace(/</g, ''), dob, sex: b.slice(20, 21) === 'M' ? 'Male' : b.slice(20, 21) === 'F' ? 'Female' : '', expiry };
    }
  }
  const dates = [
    ...(text.match(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:19|20)\d{2}\b/g) || []),
    ...(text.match(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g) || []),
    ...(text.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+(?:19|20)\d{2}\b/gi) || []),
    ...(text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/gi) || []),
  ];
  return {
    emails: uniq(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []),
    phones: uniq((text.match(/\+?\d[\d\s().-]{8,16}\d/g) || []).filter((p) => p.replace(/\D/g, '').length >= 9 && p.replace(/\D/g, '').length <= 15 && !/^(19|20)\d{2}[-/]/.test(p.trim()))),
    dates: uniq(dates), mrz, words: (text.match(/\S+/g) || []).length,
  };
}

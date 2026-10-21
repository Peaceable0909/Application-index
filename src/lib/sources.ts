/** Where a student first heard about WhiteRock. The same list is used by the document form, the chat links and QR codes, and the reports. */
export const SOURCES = ['Instagram', 'Facebook', 'TikTok', 'WhatsApp', 'Website', 'Flyer or poster', 'Event or fair', 'Referral', 'Walk-in', 'Other'] as const;
export type Source = (typeof SOURCES)[number];

const RULES: [RegExp, Source][] = [
  [/insta|^ig$/, 'Instagram'],
  [/face|^fb$/, 'Facebook'],
  [/tik/, 'TikTok'],
  [/whats|^wa$/, 'WhatsApp'],
  [/flyer|poster|print|^qr|brochure|billboard/, 'Flyer or poster'],
  [/event|fair|expo|seminar|webinar/, 'Event or fair'],
  [/refer|friend|family|alumn|relative/, 'Referral'],
  [/walk/, 'Walk-in'],
  [/web|site|google|search|online|link/, 'Website'],
];

/** "insta", "IG", "Instagram ad" all become "Instagram". Empty stays empty; something we do not recognise becomes "Other". */
export function canonicalSource(raw: unknown): Source | null {
  const t = String(raw ?? '').toLowerCase().replace(/[^a-z]+/g, '');
  if (!t) return null;
  const exact = SOURCES.find((s) => s.toLowerCase().replace(/[^a-z]+/g, '') === t);
  if (exact) return exact;
  return RULES.find(([re]) => re.test(t))?.[1] ?? 'Other';
}

/** The short word used in a link: ?src=flyer. */
export const sourceSlug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

const TAG = /(?:^|[\s;|])lead\s*source\s*[:=]\s*([^\n;|]+)/i;

/** The document form puts the source in the notes as "Lead source: Instagram". Returns it and the notes without that tag. */
export function sourceFromNotes(notes: string | null | undefined): { source: Source | null; notes: string | null } {
  const t = (notes ?? '').toString();
  const m = TAG.exec(t);
  if (!m) return { source: null, notes: notes ?? null };
  const rest = t.replace(TAG, '').replace(/^[\s;|]+|[\s;|]+$/g, '');
  return { source: canonicalSource(m[1]), notes: rest || null };
}

import { docTypeFromName } from './docs';

/** A document kind typed in by a person ("Bank statement", "Birth certificate"…). Letters, numbers and a few marks only. */
export function cleanLabel(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  return t.length >= 2 && /^[\p{L}\p{N}][\p{L}\p{N} &'().\/+-]*$/u.test(t) ? t : null;
}

/** If the label is really one of the known kinds ("my passport"), file it as that kind; otherwise it stays "Other" and carries the person's own name for it. */
export function resolveLabel(label: string): { docType: string; override: string | null } {
  const known = docTypeFromName(label);
  return known !== 'Other' ? { docType: known, override: null } : { docType: 'Other', override: label };
}

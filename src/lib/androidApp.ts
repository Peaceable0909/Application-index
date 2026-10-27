// The Android app (the Trusted Web Activity in android/): what the website has to say so Android opens the portal full screen inside the app.
// Android checks that the app's signing certificate is listed in /.well-known/assetlinks.json on the portal's address; without it the app still
// works but shows a browser bar. Pure, so the parsing and the file are tested.

export const ANDROID_PACKAGE = 'com.whiterock.portal';
export const ANDROID_SETTING = 'android_app';
export const MAX_FINGERPRINTS = 5;

/** One SHA-256 certificate fingerprint written the way Google shows it: 32 bytes as upper-case hex pairs joined by colons. Null when it is not one. */
export function normalizeFingerprint(raw: string): string | null {
  const s = raw.trim().replace(/^sha-?256\s*[:=]?\s*/i, '').trim();
  if (!/^([0-9a-f]{2}[:\s-]?){31}[0-9a-f]{2}$/i.test(s)) return null;
  return s.replace(/[^0-9a-f]/gi, '').toUpperCase().match(/../g)!.join(':');
}

/** Fingerprints pasted one per line (or separated by commas or semicolons). `bad` are the pieces that are not a fingerprint, so the form can say which. */
export function parseFingerprints(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [], bad: string[] = [];
  for (const piece of String(text || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const fp = normalizeFingerprint(piece);
    if (!fp) bad.push(piece.slice(0, 80));
    else if (!ok.includes(fp)) ok.push(fp);
  }
  return { ok: ok.slice(0, MAX_FINGERPRINTS), bad };
}

/** The Google Play address of the app, or null when it is empty or not this app's page. */
export function cleanPlayUrl(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname === 'play.google.com' && u.pathname === '/store/apps/details' && u.searchParams.get('id') === ANDROID_PACKAGE ? `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` : null;
  } catch { return null; }
}

/** The Digital Asset Links file. An empty list gives an empty file, which is valid and simply lets Android fall back to showing a browser bar. */
export function assetLinks(fingerprints: string[]) {
  const list = fingerprints.map(normalizeFingerprint).filter((x): x is string => !!x);
  return list.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [...new Set(list)] } }] : [];
}

export type AndroidSettings = { fingerprints: string[]; playUrl: string | null };
/** What is stored in portal_settings (and the optional environment list) as the one settings object. */
export function readSettings(value: unknown, envList?: string | null): AndroidSettings {
  const v = (value || {}) as { fingerprints?: unknown; play_url?: unknown };
  const stored = Array.isArray(v.fingerprints) ? v.fingerprints.map((x) => String(x)) : [];
  const fingerprints = parseFingerprints([...stored, ...String(envList || '').split(',')].join('\n')).ok;
  return { fingerprints, playUrl: cleanPlayUrl(v.play_url) };
}

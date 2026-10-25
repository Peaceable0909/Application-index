// Cover photos for profiles: the built-in covers people can pick when they have no photo, and the checks on an uploaded one. Pure.
import { COLORS } from './profile';

/** Layers drawn over every cover so a name or a profile picture on top of it stays readable. */
const SHINE = 'radial-gradient(70% 130% at 90% -20%, rgba(255,255,255,.30), transparent 62%)';
const LINES = 'repeating-linear-gradient(115deg, rgba(255,255,255,.055) 0 2px, transparent 2px 26px)';

export const COVER_PRESETS: Record<string, { label: string; css: string }> = {
  horizon: { label: 'Horizon', css: `${SHINE}, radial-gradient(40% 60% at 15% 110%, rgba(255,196,120,.55), transparent 70%), linear-gradient(160deg, #10285f, #2b5fb8 60%, #5aa0e6)` },
  dusk: { label: 'Dusk', css: `${SHINE}, radial-gradient(50% 80% at 8% 100%, rgba(255,140,170,.5), transparent 70%), linear-gradient(150deg, #2a1466, #7b3fe0 55%, #e0679a)` },
  harbour: { label: 'Harbour', css: `${SHINE}, ${LINES}, linear-gradient(150deg, #06394f, #0b6e99 55%, #3cc0d8)` },
  evergreen: { label: 'Evergreen', css: `${SHINE}, radial-gradient(45% 70% at 12% 105%, rgba(190,235,160,.4), transparent 70%), linear-gradient(155deg, #0c3b21, #14703f 55%, #52b982)` },
  sandstone: { label: 'Sandstone', css: `${SHINE}, ${LINES}, linear-gradient(150deg, #7a3f08, #c77b12 55%, #f1c15f)` },
  graphite: { label: 'Graphite', css: `${SHINE}, ${LINES}, linear-gradient(150deg, #141c2c, #2f3d57 55%, #62728f)` },
};
export const COVER_KEYS = Object.keys(COVER_PRESETS);
export const isPreset = (k: unknown): k is string => typeof k === 'string' && k in COVER_PRESETS;

/** The picture behind a profile when there is no photo: the chosen built-in cover, otherwise one drawn from the person's accent colour. */
export function coverBackground(preset: string | null | undefined, color: string | null | undefined): string {
  if (isPreset(preset)) return COVER_PRESETS[preset].css;
  const k = COLORS[color || ''] || COLORS.navy;
  return `${SHINE}, ${LINES}, linear-gradient(135deg, ${k.from}, ${k.to})`;
}

export const COVER_MAX_BYTES = 2_000_000;

/** Which image type a file really is, from its first bytes (the name and the type the browser reports are not trusted). */
export function sniffImage(b: Uint8Array): { ext: 'jpg' | 'png' | 'webp'; mime: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { ext: 'png', mime: 'image/png' };
  if (b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** The file name inside the covers bucket for a stored cover address, or null when the address is not one of ours (so nothing else is ever deleted). */
export function coverPathFromUrl(url: string | null | undefined): string | null {
  const m = /\/storage\/v1\/object\/public\/covers\/([A-Za-z0-9._-]+)(?:\?.*)?$/.exec(url || '');
  return m && !m[1].includes('..') ? m[1] : null;
}

/** 0 (top) to 100 (bottom): which part of a tall photo stays in view. */
export const clampPos = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50; };

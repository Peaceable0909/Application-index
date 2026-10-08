// Client-safe theme definitions. The chosen mode and accent live on <html data-theme data-accent>.
export const MODES = ['light', 'soft', 'dark', 'system'] as const;
export const ACCENTS = ['blue', 'emerald', 'violet', 'rose', 'amber'] as const;
export type Mode = (typeof MODES)[number];
export type Accent = (typeof ACCENTS)[number];
export const MODE_LABEL: Record<Mode, string> = { light: 'Light', soft: 'Soft', dark: 'Dark', system: 'Auto' };
export const ACCENT_COLOR: Record<Accent, string> = { blue: '#2458e6', emerald: '#059669', violet: '#7c3aed', rose: '#e11d48', amber: '#d97706' };
export const COOKIE = 'wr_theme';
export const isMode = (v: unknown): v is Mode => typeof v === 'string' && (MODES as readonly string[]).includes(v);
export const isAccent = (v: unknown): v is Accent => typeof v === 'string' && (ACCENTS as readonly string[]).includes(v);
export function parseTheme(raw?: string | null): { mode: Mode; accent: Accent } {
  const [m, a] = (raw || '').split('.');
  return { mode: isMode(m) ? m : 'light', accent: isAccent(a) ? a : 'blue' };
}

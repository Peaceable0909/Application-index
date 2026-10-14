// Tiny vibration "ticks" on phones that support it (Android Chrome). Silent no-op elsewhere.
const v = (p: number | number[]) => { try { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(p); } catch { /* optional */ } };
export const tick = () => v(7);
export const tap = () => v(12);
export const success = () => v([12, 50, 22]);
export const warn = () => v([30, 40, 30]);

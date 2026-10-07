import { PROGRESS } from './constants';

// Colour of a status badge, from how far along the pipeline it is.
export function statusTone(s: string | null): 'gray' | 'amber' | 'blue' | 'green' | 'red' {
  if (!s) return 'gray';
  if (/reject|withdraw/i.test(s)) return 'red';
  const p = PROGRESS[s];
  if (p == null) return 'gray';
  return p >= 75 ? 'green' : p >= 50 ? 'blue' : p >= 25 ? 'amber' : 'gray';
}

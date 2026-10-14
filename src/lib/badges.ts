import { REQUIRED_DOCS } from './constants';
import type { StudentData } from './studentData';

export type Badge = { key: string; label: string; hint: string; emoji: string; hue: [string, string]; on: boolean };

const ORDER = ['New Lead', 'Documents Requested', 'Submitted', 'CF Gotten', 'Offer Received', 'Interview Taken', 'Interview Passed', 'Unconditional Offer', 'CAS Applied', 'CAS Received', 'Visa Applied', 'Enrolled'];
const reached = (status: string | null, at: string) => { const a = ORDER.indexOf(status || ''), b = ORDER.indexOf(at); return a >= 0 && a >= b; };

/** Collectible milestones for the student's journey. Everything is worked out from data they already see. */
export function milestoneBadges(d: StudentData): Badge[] {
  const cards = d.cards, st = cards.map((c) => c.a.status);
  const any = (f: (s: string | null) => boolean) => st.some(f);
  const docsDone = cards.length > 0 && cards.every((c) => c.missing.length === 0 && REQUIRED_DOCS.length > 0);
  const interviewed = d.interview.upcoming.length > 0 || d.interview.past.some((b) => b.status === 'completed') || any((s) => reached(s, 'Interview Taken'));
  const offer = cards.some((c) => !!c.offer?.offer_type) || any((s) => reached(s, 'Offer Received'));
  const cas = cards.some((c) => c.offer?.cas_status === 'Received') || any((s) => reached(s, 'CAS Received'));
  const visa = cards.some((c) => c.offer?.visa_status === 'Approved') || any((s) => s === 'Enrolled');
  const enrolled = any((s) => s === 'Enrolled');
  const checklist = d.checklist.length > 0 && d.checklist.every((x) => x.done);
  return [
    { key: 'applied', label: 'Applied', hint: 'You started your journey', emoji: '🚀', hue: ['#5ac8fa', '#007aff'], on: true },
    { key: 'docs', label: 'Documents in', hint: 'Every required document received', emoji: '📄', hue: ['#ffb340', '#ff9500'], on: docsDone },
    { key: 'checklist', label: 'Checklist done', hint: 'Everything on your list ticked', emoji: '✅', hue: ['#4cd964', '#2fb750'], on: checklist },
    { key: 'interview', label: 'Interview ready', hint: 'Booked or finished interview practice', emoji: '🎤', hue: ['#c77dff', '#9b4fd6'], on: interviewed },
    { key: 'offer', label: 'Offer!', hint: 'A university offered you a place', emoji: '🎓', hue: ['#ff6b81', '#ff2d55'], on: offer },
    { key: 'cas', label: 'CAS received', hint: 'Confirmation of Acceptance for Studies', emoji: '📬', hue: ['#64d2ff', '#30b0c7'], on: cas },
    { key: 'visa', label: 'Visa approved', hint: 'You’re cleared to travel', emoji: '🛂', hue: ['#a29bfe', '#5856d6'], on: visa },
    { key: 'enrolled', label: 'Enrolled', hint: 'Welcome to university', emoji: '🏆', hue: ['#ffd60a', '#ff9f0a'], on: enrolled },
  ];
}

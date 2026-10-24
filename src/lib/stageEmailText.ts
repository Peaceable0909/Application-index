// The words of the "your application has moved" email, as plain text the counselor can read and edit before it is sent.
// Pure (no imports, no database) so it can be tested on its own. sendMail turns the plain text into the designed HTML email.

export type StageEmailInput = {
  /** What the student likes to be called. */
  first: string;
  /** "Regent College London (RCL)" or just "RCL": whatever the application says. */
  school: string;
  programme?: string | null;
  stage: string;
  /** What the stage means, in words for the student (the stage's student note). */
  note?: string | null;
  /** Documents the student has to send at this stage, in words for them. */
  asks: { label: string; again: boolean }[];
  counselor?: string | null;
};

export type StageEmailDraft = { subject: string; body: string };

const programmeOf = (p?: string | null) => (p && p.trim() && p.trim().toUpperCase() !== 'N/A' ? p.trim() : '');

export function stageEmailDraft(i: StageEmailInput): StageEmailDraft {
  const prog = programmeOf(i.programme);
  const lines: string[] = [];
  lines.push(`Hi ${i.first || 'there'},`);
  lines.push(`There is an update on your application${prog ? ` for ${prog}` : ''} at ${i.school}. It has moved to a new stage: ${i.stage}.`);
  if (i.note && i.note.trim()) lines.push(i.note.trim());
  if (i.asks.length) {
    lines.push(`What we need from you:\n${i.asks.map((a) => `- ${a.label}${a.again ? ' (please send a new copy)' : ''}`).join('\n')}`);
    lines.push('You can upload these in your student portal, under Documents. If anything is unclear, reply to this email and we will help.');
  } else {
    lines.push('There is nothing you need to do right now. We will let you know when that changes. You can follow your progress at any time in your student portal.');
  }
  const short = i.school.match(/\(([^)]+)\)\s*$/)?.[1] || i.school;   // "Regent College London (RCL)" reads better as "RCL" in a subject
  return { subject: `Your application update: ${i.stage} (${short})`, body: lines.join('\n\n') };
}

/** The checks a message must pass before it is sent. Returns the first problem in words for the counselor, or null. */
export function stageEmailProblem(subject: string, body: string): string | null {
  if (subject.trim().length < 3) return 'Add a subject.';
  if (subject.length > 200) return 'The subject is too long.';
  if (body.trim().length < 20) return 'The message is too short to send.';
  if (body.length > 6000) return 'The message is too long.';
  return null;
}

export type InformState = 'sending' | 'sent' | 'failed' | null;
/** How long a send may stay "in progress" before it is treated as lost and can be tried again. */
export const SENDING_STALE_MS = 2 * 60_000;

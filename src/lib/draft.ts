import { generateOnce } from './ai';

// Purposes the drafter can write, who they are for, and what they should cover.
export const PURPOSES = {
  missing_docs: { label: 'Request missing documents', to: 'student', brief: 'Politely ask the student to send the missing documents listed in the facts, and to reply with clear scans or photos.' },
  follow_up: { label: 'Gentle follow-up', to: 'student', brief: 'A friendly reminder about whatever is still outstanding (missing documents, interview booking) per the facts.' },
  acknowledge: { label: 'Confirm application received', to: 'student', brief: 'Confirm we received the application and that the team is reviewing it. Mention missing documents only if the facts list some.' },
  status_update: { label: 'Status update', to: 'student', brief: 'Tell the student their current application stage (from the facts) in plain words and what usually happens next, without promising outcomes or dates.' },
  interview: { label: 'Interview booking', to: 'student', brief: 'Tell the student the next step is to book their interview and that scheduling details will be shared separately. Do not invent dates, times or links.' },
  counselor_update: { label: 'Update the counselor', to: 'counselor', brief: 'Brief update to the counselor about this student: status, missing documents, and the one or two next actions.' },
  custom: { label: 'Custom (use my instruction)', to: 'student', brief: 'Follow the admin instruction exactly, using only the facts.' },
} as const;
export type PurposeKey = keyof typeof PURPOSES;
export const TONES = { friendly: 'warm and friendly', formal: 'formal and professional', brief: 'very brief and direct (under 90 words)' } as const;
export type ToneKey = keyof typeof TONES;

export type DraftFacts = {
  programme: string | null; university: string | null; status: string | null; documentsMissing: string[]; documentsChecked: boolean;
  interviewStatus: string | null; paymentRecorded: boolean;
};
export type Draft = { subject: string; body: string; purpose: PurposeKey; tone: ToneKey; recipient: 'student' | 'counselor'; at: string };

// The model never sees real names, emails or phone numbers: it writes placeholders that we fill in afterwards.
const PLACEHOLDERS = ['{{FIRST_NAME}}', '{{COUNSELOR}}', '{{SENDER}}'];

export async function draftEmail(o: { purpose: PurposeKey; tone: ToneKey; instruction: string; facts: DraftFacts; names: { first: string; counselor: string; sender: string } }): Promise<Draft> {
  const p = PURPOSES[o.purpose];
  const raw = await generateOnce<{ subject: string; body: string }>({
    kind: 'draft', maxTokens: 650,
    system:
      'You draft emails for a university admissions advisory team. Use ONLY the facts in the JSON; if something is not in the facts, do not mention it. ' +
      `Write in a ${TONES[o.tone]} tone, plain English, at most 170 words. ` +
      `Address the student as {{FIRST_NAME}} (or the counselor as {{COUNSELOR}}) and sign off with {{SENDER}} then "Admissions Team". Use exactly these placeholders, never real names. ` +
      'NEVER invent dates, deadlines, fees, links, phone numbers or email addresses, and NEVER promise or hint at admission, an offer, a visa or any outcome. ' +
      'List missing documents as lines starting with "- ", using the exact document names from the facts. ' +
      'Reply as JSON: {"subject": "<short subject>", "body": "<plain-text email body>"}.',
    user: JSON.stringify({ purpose: p.label, whatToWrite: p.brief, adminInstruction: o.instruction || null, facts: o.facts }),
    validate: (r) => {
      const d = r as { subject?: unknown; body?: unknown };
      if (typeof d?.subject !== 'string' || typeof d?.body !== 'string') return null;
      const subject = d.subject.trim(), body = d.body.trim();
      if (subject.length < 3 || subject.length > 120 || body.length < 40 || body.length > 1800) return null;
      const text = `${subject}\n${body}`;
      if (/https?:\/\/|www\.|@|\+?\d[\d\s-]{7,}/.test(text)) return null;                    // no invented links, emails or phone numbers
      if (/guarantee|you (have been|are) (admitted|accepted)|offer (has been|is) (approved|granted)|visa (is|will be) (approved|granted)/i.test(text)) return null; // no promises
      if ((text.match(/\{\{[^}]+\}\}/g) || []).some((t) => !PLACEHOLDERS.includes(t))) return null;
      // Every missing document must actually be named, so the student knows what to send.
      if (o.facts.documentsChecked && ['missing_docs', 'follow_up'].includes(o.purpose)) {
        const lower = body.toLowerCase();
        if (!o.facts.documentsMissing.every((m) => m.toLowerCase().split('/').every((part) => lower.includes(part.trim())))) return null;
      }
      return { subject, body };
    },
  });
  const fill = (t: string) => t.replaceAll('{{FIRST_NAME}}', o.names.first).replaceAll('{{COUNSELOR}}', o.names.counselor).replaceAll('{{SENDER}}', o.names.sender);
  return { subject: fill(raw.subject), body: fill(raw.body), purpose: o.purpose, tone: o.tone, recipient: p.to, at: new Date().toISOString() };
}

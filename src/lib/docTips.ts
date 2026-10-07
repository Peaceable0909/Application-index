// Plain guidance shown next to each required document. Wording is deliberately general: universities differ, and the counselor is the final word.
export const DOC_TIPS: Record<string, { what: string; tips: string[] }> = {
  Passport: { what: 'The page with your photo and details', tips: ['Open it flat on a table, with all four corners in the picture', 'Make sure the two lines of letters and < symbols at the bottom are fully readable', 'Avoid glare from lights or the flash', 'Check it hasn’t expired; tell your counselor if it’s close'] },
  CV: { what: 'Your résumé', tips: ['A PDF works best', 'Education, work experience and your contact details', 'One or two pages is plenty'] },
  Transcript: { what: 'Your full academic record', tips: ['Every page, in order, with the grades visible', 'It should come from your university', 'If it isn’t in English, ask your counselor about a translation'] },
  'Degree Certificate': { what: 'The certificate for your degree', tips: ['The full certificate, not cropped', 'Include the statement of result too if you have one'] },
  'WAEC/NECO': { what: 'Your secondary-school exam result', tips: ['A result slip or certificate showing every subject and grade', 'Both sides if there is writing on the back'] },
  SOP: { what: 'Your personal statement', tips: ['Why this course and why this university, in your own words', 'A Word or PDF file is best', 'Your counselor can tell you the length your university prefers'] },
  IELTS: { what: 'Your English test result', tips: ['The full report, with all four scores and the overall score'] },
  Reference: { what: 'A reference letter', tips: ['On headed paper and signed, if possible'] },
};

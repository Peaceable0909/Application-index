// Pipeline taken from the stage column of your master sheet.
export const STATUSES = [
  'New Lead', 'Documents Requested', 'Submitted', 'CF Gotten', 'Offer Received',
  'Interview Taken', 'Interview Passed', 'Unconditional Offer', 'CAS Applied',
  'CAS Received', 'Visa Applied', 'Enrolled', 'Rejected', 'Withdrawn',
] as const;

export const FINAL_STATUSES = ['Enrolled', 'Rejected', 'Withdrawn'];

// Documents every application is expected to have. Edit to suit; per-school
// rules can be added later.
export const REQUIRED_DOCS = ['Passport', 'CV', 'Transcript', 'Degree Certificate', 'WAEC/NECO', 'SOP'] as const;
export const ALL_DOC_TYPES = [...REQUIRED_DOCS, 'IELTS', 'Reference', 'Other'] as const;

export const STALE_DAYS = 7;

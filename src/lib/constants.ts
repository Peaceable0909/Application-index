// Pipeline taken from the stage column of your master sheet.
// Pipeline legend from the master sheet (status -> progress %), plus statuses seen in the data.
export const PROGRESS: Record<string, number> = {
  'New Lead': 8, 'Documents Requested': 17, 'Submitted': 25, 'CF Gotten': 33, 'Offer Received': 42,
  'Interview Taken': 50, 'Interview Passed': 58, 'Unconditional Offer': 67, 'CAS Applied': 75,
  'CAS Received': 83, 'Visa Applied': 92, 'Enrolled': 100,
};
export const STATUSES = [...Object.keys(PROGRESS), 'Awaiting CAS', 'CAS Request', 'Rejected', 'Withdrawn'] as const;

export const FINAL_STATUSES = ['Enrolled', 'Rejected', 'Withdrawn'];

// Documents every application is expected to have. Edit to suit; per-school
// rules can be added later.
export const REQUIRED_DOCS = ['Passport', 'CV', 'Transcript', 'Degree Certificate', 'WAEC/NECO', 'SOP'] as const;
export const ALL_DOC_TYPES = [...REQUIRED_DOCS, 'IELTS', 'Reference', 'Other'] as const;

export const STALE_DAYS = 7;

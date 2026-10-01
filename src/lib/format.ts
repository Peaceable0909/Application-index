export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const ago = (t: string) => { const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
export const shortDate = (t: string | null) => (t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (t: string) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function describeActivity(kind: string, d: Record<string, string>): { title: string; icon: string; tone: string } {
  switch (kind) {
    case 'new_application': return { title: 'New application submitted', icon: 'file', tone: 'green' };
    case 'imported_from_sheet': return { title: 'Found in the sheets', icon: 'file', tone: '' };
    case 'status_change': return { title: `Status updated · ${d.to || ''}`, icon: 'clock', tone: 'amber' };
    case 'counselor_change': return { title: `Counselor assigned · ${d.to || '—'}`, icon: 'users', tone: '' };
    case 'payment_change': return { title: `Payment · ${d.to || '—'}`, icon: 'check-circle', tone: 'green' };
    case 'interview_change': return { title: `Interview · ${d.to || '—'}`, icon: 'clock', tone: 'purple' };
    case 'doc_uploaded': return { title: `Document uploaded${d.name ? ` · ${d.name.split(' - ').pop()}` : ''}`, icon: 'upload', tone: 'green' };
    case 'doc_retyped': return { title: `Document re-labelled · ${d.type || ''}`, icon: 'file', tone: '' };
    case 'email_sent': return { title: `Email sent${d.subject ? ` · ${d.subject}` : ''}`, icon: 'mail', tone: '' };
    case 'moved_to_master': return { title: 'Added to Sheet1', icon: 'check-circle', tone: 'green' };
    case 'folder_linked': return { title: 'Drive folder linked', icon: 'link', tone: '' };
    case 'folder_unlinked': return { title: 'Drive folder unlinked', icon: 'link', tone: 'amber' };
    case 'regent_update': return { title: 'Regent details updated', icon: 'note', tone: '' };
    case 'note': return { title: `Note added${d.preview ? ` · ${d.preview}` : ''}`, icon: 'note', tone: 'amber' };
    case 'task_done': return { title: `Task completed · ${d.title || ''}`, icon: 'check', tone: 'green' };
    case 'task_dismissed': return { title: 'Task dismissed', icon: 'check', tone: '' };
    case 'task_snoozed': return { title: 'Task snoozed', icon: 'clock', tone: '' };
    default: return { title: kind.replace(/_/g, ' '), icon: 'file', tone: '' };
  }
}

// Five-step view of the pipeline for the status stepper.
export const STEPS = ['Submitted', 'Under Review', 'Offer', 'Visa', 'Enrolled'] as const;
export function stepIndex(status: string | null): number {
  if (!status) return 0;
  if (['Enrolled'].includes(status)) return 4;
  if (['Visa Applied'].includes(status)) return 3;
  if (['Offer Received', 'Unconditional Offer', 'CAS Applied', 'CAS Received'].includes(status)) return 2;
  if (['CF Gotten', 'Interview Taken', 'Interview Passed', 'Awaiting CAS', 'CAS Request'].includes(status)) return 1;
  return 0;
}
export const IN_PROGRESS = ['CF Gotten', 'Offer Received', 'Interview Taken', 'Interview Passed', 'Unconditional Offer', 'CAS Applied', 'CAS Received', 'Visa Applied', 'Awaiting CAS', 'CAS Request'];
export const AWAITING = ['New Lead', 'Submitted', 'Documents Requested'];

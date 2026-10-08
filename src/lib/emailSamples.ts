import { plainToSpec, site, type EmailSpec } from './emailTemplate';

/** Example content so the team can preview and test the email design without touching a real student. */
export function sampleSpec(kind: string): Omit<EmailSpec, 'sign'> & { subject: string; body: string } {
  if (kind === 'digest') return {
    subject: 'Sample: 3 students need attention', body: 'Sample digest', eyebrow: 'Weekly digest', title: '3 students need your attention', greeting: 'Hi Counselor,', preheader: 'Bestman, Emmanuel and Samson',
    blocks: [
      { type: 'p', text: 'Here are your students who need attention right now.' },
      { type: 'students', title: 'Needs attention · 3', rows: [
        { name: 'Bestman Lolomari Felix', meta: 'CCCU · MBA International', status: 'Submitted', needs: 'Missing: SOP' },
        { name: 'Emmanuel Chidi Nochiri', meta: 'CCCU · MSc Data Intelligence', status: 'New Lead', needs: 'No update for 14 days · Missing: Passport, SOP' },
        { name: 'Samson Opayinka', meta: 'RCL · MSc International Business', status: 'Offer', needs: 'Payment unpaid' }] },
      { type: 'p', text: 'Please follow up where you can. Everything is one tap away in the portal.' }],
    cta: { label: 'Open my students', href: `${site()}/my` },
  };
  if (kind === 'custom') {
    const body = 'Hi Amara,\n\nThank you for your patience. Your offer from York St John is ready:\n\n• Programme: MSc Marketing\n• Intake: January 2027\n• Deposit due: 14 October\n\nLet me know if you have any questions.\n\nBest regards,\nYour counselor';
    return { subject: 'Sample: your offer is ready', body, eyebrow: 'Admissions update', ...plainToSpec(body) };
  }
  return {
    subject: 'Sample: documents needed for your application', body: 'Sample request', eyebrow: 'Documents needed', title: '2 documents needed', greeting: 'Hi Bestman,', preheader: 'Still needed: SOP, Passport',
    blocks: [
      { type: 'checklist', title: 'Needed for CCCU · MBA International', items: ['SOP', 'Passport'], received: 4, total: 6 },
      { type: 'p', text: 'Upload them in your student portal (sign in with this email, no password), or reply with clear scans attached.' }],
    cta: { label: 'Upload my documents', href: 'mailto:admissions@example.com' },
  };
}

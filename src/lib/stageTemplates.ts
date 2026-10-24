// Starting points for a school's workflow. They are only copied into the database (when the portal is set up, or when an admin adds a
// school "from a template"); after that the database is the one source and admins change it in the portal (Workflows page).
// Nothing in the app reads this file to decide how a stage behaves, so changing a school's process never needs a code change.
import type { Need, Notify, ReqKind, Role, SatisfiedAt, Workflow } from './stageEngine';

export type ReqT = {
  key: string; label: string; kind?: ReqKind; doc_type?: string; need?: Need; condition?: string; upload?: boolean; satisfied_at?: SatisfiedAt;
  student_visible?: boolean; options?: string[]; pass?: string[]; hint?: string;
};
export type StageT = {
  key: string; name: string; maps?: string; conditional?: boolean; delay?: number; notify?: Notify; roles?: Role[]; complete?: 'manual' | 'requirements';
  offer?: { offer_type?: string; cas_status?: string; visa_status?: string }; hint?: string; reqs?: ReqT[];
};
export type WorkflowT = { school_key: string; school_name: string; conditions: { key: string; label: string }[]; stages: StageT[] };

const OUTCOME = ['Passed', 'Failed', 'Rescheduled'];
const interview = (label: string): ReqT => ({ key: 'interview_outcome', label, kind: 'outcome', options: OUTCOME, pass: ['Passed'], hint: 'Record what happened. Only “Passed” lets the application move on.' });
const confirm = (key: string, label: string, hint?: string): ReqT => ({ key, label, kind: 'confirmation', hint });
const doc = (key: string, label: string, doc_type: string, extra: Partial<ReqT> = {}): ReqT => ({ key, label, kind: 'document', doc_type, ...extra });
const TB: ReqT = doc('tb_certificate', 'TB test certificate', 'TB certificate', { need: 'conditional', condition: 'cond:tb_required', hint: 'Only for applicants from a country that needs a TB test.' });
const CAS_STATEMENT = doc('cas_statement', 'CAS statement', 'CAS statement');
const VISA_DONE = confirm('visa_requirements', 'Visa application requirements completed', 'Tick when the visa form, funds, passport and other visa requirements are all in order. Needed before the application is marked as submitted.');
const VISA_DECISION = doc('visa_decision', 'Visa decision letter', 'Visa decision', { hint: 'The decision from the Home Office. A refusal needs a different route, not Enrolment.' });

export const WORKFLOW_TEMPLATES: WorkflowT[] = [
  {
    school_key: 'rcl', school_name: 'Regent College London (RCL)',
    conditions: [{ key: 'tb_required', label: 'Needs a TB test certificate' }],
    stages: [
      { key: 'offer_received', name: 'Offer Received', maps: 'Offer Received', delay: 14, reqs: [doc('offer_letter', 'Offer letter', 'Offer Letter', { need: 'optional' })] },
      { key: 'interview_to_be_booked', name: 'Interview to Be Booked', delay: 7, reqs: [interview('Interview outcome')] },
      { key: 'interview_passed', name: 'Interview Passed', maps: 'Interview Passed', delay: 7 },
      { key: 'tuition_fee_stage', name: 'Tuition Fee Stage', conditional: true, delay: 10, hint: 'Only when a tuition fee arrangement applies to this student.', reqs: [confirm('tuition_agreed', 'Tuition fee arrangement agreed with the student')] },
      { key: 'payment_plan_sent', name: 'Payment Plan Sent', delay: 7, reqs: [confirm('plan_sent', 'Payment plan sent to the student')] },
      { key: 'qc_form_sent', name: 'QC Form Sent', delay: 7, reqs: [confirm('qc_sent', 'QC form sent to the student')] },
      { key: 'payment_plan_signed', name: 'Payment Plan Signed', delay: 10, reqs: [confirm('plan_signed', 'Student has signed the payment plan')] },
      { key: 'tuition_fee_payment_required', name: 'Tuition Fee Payment Required', delay: 14, notify: 'both', reqs: [confirm('tuition_paid', 'Tuition fee payment confirmed')] },
      {
        key: 'student_documents_pending', name: 'Student Documents Pending', delay: 14, complete: 'requirements', notify: 'both',
        hint: 'The student sends the documents below. Each one must be reviewed and approved before this stage can finish.',
        reqs: [
          TB,
          doc('bank_statement', 'Bank statement', 'Bank statement'),
          doc('tuition_receipt', 'Tuition fee payment receipt', 'Tuition fee payment receipt', { need: 'conditional', condition: 'stage:tuition_fee_payment_required' }),
          doc('signed_payment_plan', 'Signed payment plan', 'Signed payment plan'),
          doc('additional_documents', 'Any additional document the school asks for', 'Additional document', { need: 'optional' }),
        ],
      },
      { key: 'cas_requested', name: 'CAS Requested', maps: 'CAS Applied', delay: 14, notify: 'both', offer: { cas_status: 'Requested' }, reqs: [confirm('cas_request_sent', 'CAS request sent to the school')] },
      { key: 'pending_documents', name: 'Pending Documents', conditional: true, delay: 10, hint: 'Only when the school asks for more before issuing the CAS.', reqs: [doc('school_requested_doc', 'Document requested by the school', 'Additional document', { satisfied_at: 'accepted' })] },
      { key: 'cas_received', name: 'CAS Received', maps: 'CAS Received', delay: 7, notify: 'both', offer: { cas_status: 'Received' }, reqs: [CAS_STATEMENT] },
      { key: 'visa_application', name: 'Visa Application', delay: 21, offer: { visa_status: 'Preparing' }, reqs: [VISA_DONE] },
      { key: 'visa_decision', name: 'Visa Decision', maps: 'Visa Applied', delay: 28, notify: 'both', offer: { visa_status: 'Decision awaited' }, reqs: [VISA_DECISION] },
      { key: 'enrolment', name: 'Enrolment', maps: 'Enrolled', notify: 'both' },
    ],
  },
  {
    school_key: 'cccu', school_name: 'Canterbury Christ Church University (CCCU)',
    conditions: [{ key: 'tb_required', label: 'Needs a TB test certificate' }, { key: 'deposit_required', label: 'Pays a tuition deposit before the CAS' }],
    stages: [
      { key: 'offer_received', name: 'Offer Received', maps: 'Offer Received', delay: 14, reqs: [doc('offer_letter', 'Offer letter', 'Offer Letter', { need: 'optional' })] },
      { key: 'first_interview', name: 'First Interview', maps: 'Interview Taken', delay: 10, reqs: [interview('First interview outcome')] },
      {
        key: 'documents_for_unconditional_offer', name: 'Documents Required for Unconditional Offer', delay: 14, complete: 'requirements', notify: 'both',
        hint: 'These must be received and approved before the unconditional offer is requested.',
        reqs: [doc('passport', 'Passport', 'Passport'), doc('degree_certificate', 'Degree certificate', 'Degree Certificate'), doc('transcript', 'Transcript', 'Transcript'), doc('english_test', 'English language test', 'IELTS', { need: 'optional' })],
      },
      { key: 'unconditional_offer_requested', name: 'Unconditional Offer Requested', delay: 14, reqs: [confirm('request_sent', 'Request for the unconditional offer sent to the university')] },
      { key: 'unconditional_offer_received', name: 'Unconditional Offer Received', maps: 'Unconditional Offer', delay: 7, notify: 'both', offer: { offer_type: 'Unconditional' }, reqs: [doc('unconditional_letter', 'Unconditional offer letter', 'Offer Letter')] },
      { key: 'precas_interview', name: 'Pre-CAS Interview', delay: 10, reqs: [interview('Pre-CAS interview outcome')] },
      {
        key: 'precas_interview_passed', name: 'Pre-CAS Interview Passed', delay: 10, complete: 'requirements',
        hint: 'Check the school’s CAS requirements and have everything ready before the CAS is requested.',
        reqs: [doc('passport_cas', 'Passport', 'Passport'), doc('bank_statement', 'Bank statement', 'Bank statement'), TB, doc('deposit_receipt', 'Tuition deposit receipt', 'Tuition deposit receipt', { need: 'conditional', condition: 'cond:deposit_required' }), confirm('cas_checked', 'The school’s CAS requirements have been checked')],
      },
      { key: 'cas_requested', name: 'CAS Requested', maps: 'CAS Applied', delay: 14, notify: 'both', offer: { cas_status: 'Requested' } },
      { key: 'cas_received', name: 'CAS Received', maps: 'CAS Received', delay: 7, notify: 'both', offer: { cas_status: 'Received' }, reqs: [CAS_STATEMENT] },
      { key: 'visa_application_started', name: 'Visa Application Started', delay: 21, offer: { visa_status: 'Preparing' }, reqs: [VISA_DONE] },
      { key: 'visa_application_submitted', name: 'Visa Application Submitted', maps: 'Visa Applied', delay: 7, offer: { visa_status: 'Applied' }, reqs: [doc('visa_submission', 'Visa application confirmation', 'Visa application confirmation', { need: 'optional' })] },
      { key: 'awaiting_visa_decision', name: 'Awaiting Visa Decision', delay: 28, offer: { visa_status: 'Decision awaited' } },
      { key: 'visa_decision_received', name: 'Visa Decision Received', notify: 'both', reqs: [VISA_DECISION] },
      { key: 'enrolment', name: 'Enrolment', maps: 'Enrolled', notify: 'both' },
    ],
  },
  {
    school_key: 'bpp', school_name: 'BPP University',
    conditions: [{ key: 'tb_required', label: 'Needs a TB test certificate' }],
    stages: [
      { key: 'documents_sent', name: 'Documents Sent', maps: 'Submitted', delay: 14 },
      { key: 'offer_received', name: 'Offer Received', maps: 'Offer Received', delay: 14, reqs: [doc('offer_letter', 'Offer letter', 'Offer Letter', { need: 'optional' })] },
      {
        key: 'bank_statement_review', name: 'Bank Statement Review', delay: 7, complete: 'requirements', hint: 'Check the funds on the statement against the school’s financial requirement.',
        reqs: [doc('bank_statement', 'Bank statement', 'Bank statement'), confirm('funds_verified', 'Financial requirement checked and met')],
      },
      { key: 'application_form_completed', name: 'Application Form Completed', delay: 10, reqs: [doc('application_form', 'Completed application form', 'Application form')] },
      {
        key: 'cas_documents_ready', name: 'CAS Documents Ready', delay: 10, complete: 'requirements', notify: 'both', hint: 'Everything the school needs for the CAS. Move on only when all of it is ready.',
        reqs: [doc('passport', 'Passport', 'Passport'), TB, confirm('cas_ready', 'All CAS documents are ready')],
      },
      { key: 'cas_requested', name: 'CAS Requested', maps: 'CAS Applied', delay: 14, offer: { cas_status: 'Requested' } },
      { key: 'awaiting_precas_interview', name: 'Awaiting Pre-CAS Interview', delay: 14, reqs: [interview('Pre-CAS interview outcome')] },
      { key: 'precas_interview_completed', name: 'Pre-CAS Interview Completed', delay: 10 },
      { key: 'cas_received', name: 'CAS Received', maps: 'CAS Received', delay: 7, notify: 'both', offer: { cas_status: 'Received' }, reqs: [CAS_STATEMENT, VISA_DONE] },
      { key: 'visa_application_submitted', name: 'Visa Application Submitted', maps: 'Visa Applied', delay: 7, offer: { visa_status: 'Applied' } },
      { key: 'awaiting_visa_decision', name: 'Awaiting Visa Decision', delay: 28, offer: { visa_status: 'Decision awaited' }, reqs: [VISA_DECISION] },
      { key: 'enrolment', name: 'Enrolment', maps: 'Enrolled', notify: 'both' },
    ],
  },
  {
    school_key: 'ysj', school_name: 'York St John University',
    conditions: [{ key: 'tb_required', label: 'Needs a TB test certificate' }, { key: 'deposit_required', label: 'Pays a tuition deposit before the CAS' }],
    stages: [
      { key: 'offer_received', name: 'Offer Received', maps: 'Offer Received', delay: 14, reqs: [doc('offer_letter', 'Offer letter', 'Offer Letter', { need: 'optional' })] },
      { key: 'interview_pending', name: 'Interview Pending', delay: 10, reqs: [interview('Interview outcome')] },
      {
        key: 'interview_passed', name: 'Interview Passed', maps: 'Interview Passed', delay: 10, complete: 'requirements', hint: 'Documents the university needs before an unconditional offer can be requested.',
        reqs: [doc('passport', 'Passport', 'Passport'), doc('degree_certificate', 'Degree certificate', 'Degree Certificate'), doc('transcript', 'Transcript', 'Transcript'), doc('english_test', 'English language test', 'IELTS', { need: 'optional' })],
      },
      { key: 'unconditional_offer_requested', name: 'Unconditional Offer Requested', delay: 14, reqs: [confirm('request_sent', 'Request for the unconditional offer sent to the university')] },
      {
        key: 'unconditional_offer_received', name: 'Unconditional Offer Received', maps: 'Unconditional Offer', delay: 10, complete: 'requirements', notify: 'both', offer: { offer_type: 'Unconditional' }, hint: 'Check the CAS requirements and have the documents ready before the CAS is requested.',
        reqs: [doc('unconditional_letter', 'Unconditional offer letter', 'Offer Letter'), doc('bank_statement', 'Bank statement', 'Bank statement'), TB, doc('deposit_receipt', 'Tuition deposit receipt', 'Tuition deposit receipt', { need: 'conditional', condition: 'cond:deposit_required' })],
      },
      { key: 'cas_requested', name: 'CAS Requested', maps: 'CAS Applied', delay: 14, offer: { cas_status: 'Requested' } },
      { key: 'cas_sent', name: 'CAS Sent', maps: 'CAS Applied', delay: 7, notify: 'both' },
      { key: 'cas_received', name: 'CAS Received', maps: 'CAS Received', delay: 7, notify: 'both', offer: { cas_status: 'Received' }, reqs: [CAS_STATEMENT] },
      { key: 'visa_application_started', name: 'Visa Application Started', delay: 21, offer: { visa_status: 'Preparing' }, reqs: [VISA_DONE] },
      { key: 'visa_application_submitted', name: 'Visa Application Submitted', maps: 'Visa Applied', delay: 7, offer: { visa_status: 'Applied' } },
      { key: 'awaiting_visa_decision', name: 'Awaiting Visa Decision', delay: 28, offer: { visa_status: 'Decision awaited' }, reqs: [VISA_DECISION] },
      { key: 'enrolment', name: 'Enrolment', maps: 'Enrolled', notify: 'both' },
    ],
  },
];

export const templateFor = (schoolKey: string) => WORKFLOW_TEMPLATES.find((t) => t.school_key === schoolKey) ?? null;

/** The template as an in-memory workflow (made-up ids). Used by tests and for previews; the database copy gets real ids. */
export function workflowFromTemplate(t: WorkflowT, workspace = 'uk'): Workflow {
  return {
    id: `wf-${t.school_key}`, workspace, school_key: t.school_key, school_name: t.school_name, active: true, override_roles: ['admin'], conditions: t.conditions,
    stages: t.stages.map((s, i) => ({
      id: `${t.school_key}:${s.key}`, key: s.key, name: s.name, position: (i + 1) * 10, active: true, conditional: !!s.conditional, maps_status: s.maps ?? null,
      move_roles: s.roles ?? ['admin', 'staff', 'counselor'], complete_when: s.complete ?? 'manual', notify: s.notify ?? 'counselor', delay_days: s.delay ?? null, offer_sync: s.offer ?? null, hint: s.hint ?? null, student_note: STUDENT_NOTES[s.key] ?? null,
      reqs: (s.reqs ?? []).map((r, j) => ({
        id: `${t.school_key}:${s.key}:${r.key}`, key: r.key, label: r.label, kind: r.kind ?? 'document', doc_type: r.doc_type ?? null, need: r.need ?? 'mandatory', condition_key: r.condition ?? null,
        upload: r.upload ?? (r.kind ?? 'document') === 'document', satisfied_at: r.satisfied_at ?? 'approved', student_visible: r.student_visible ?? (r.kind ?? 'document') === 'document',
        position: (j + 1) * 10, active: true, options: r.options ?? null, pass_options: r.pass ?? null, hint: r.hint ?? null,
      })),
    })),
  };
}
/** Plain-language description of each stage for the student (dashboard and email). Starting text only: admins edit it on the Workflows page. */
export const STUDENT_NOTES: Record<string, string> = {
  documents_sent: 'Your documents have been sent to the university.',
  offer_received: 'The university has made you an offer. Your counselor will explain any conditions and what comes next.',
  first_interview: 'The university interview is the next step. Your counselor will tell you how it works and when it takes place.',
  interview_pending: 'Your interview has not taken place yet. Your counselor will keep you updated.',
  interview_to_be_booked: 'Your interview still has to be booked. Your counselor will help you choose a time.',
  bank_statement_review: 'Your bank statement is being checked. Please make sure what you send is complete and easy to read.',
  documents_for_unconditional_offer: 'The university needs some documents before it can issue an unconditional offer. Please send what is listed below.',
  interview_passed: 'You have passed your interview. Your counselor will explain the next step.',
  application_form_completed: 'Your application form has been completed.',
  tuition_fee_stage: 'A tuition fee arrangement applies to your application. Your counselor will explain it.',
  unconditional_offer_requested: 'Your unconditional offer has been requested from the university. This can take a little time.',
  cas_documents_ready: 'Your documents for the CAS are ready.',
  payment_plan_sent: 'A payment plan has been sent to you. Please read it carefully and ask your counselor if anything is unclear.',
  unconditional_offer_received: 'You have received your unconditional offer.',
  cas_requested: 'Your CAS (Confirmation of Acceptance for Studies) has been requested from the university.',
  precas_interview: 'A pre-CAS interview is the next step. Your counselor will tell you how to prepare.',
  qc_form_sent: 'A QC form has been sent to you. Please complete it and return it as your counselor explains.',
  awaiting_precas_interview: 'You are waiting for your pre-CAS interview.',
  cas_sent: 'The university has sent your CAS.',
  payment_plan_signed: 'Your signed payment plan has been received.',
  precas_interview_passed: 'You have passed your pre-CAS interview.',
  cas_received: 'You have received your CAS. Keep it safe, because you need it for your visa application.',
  precas_interview_completed: 'Your pre-CAS interview has been completed.',
  tuition_fee_payment_required: 'A tuition fee payment is needed at this stage. Please follow your counselor’s instructions and keep your payment receipt.',
  student_documents_pending: 'Please send the documents listed below so your application can move forward.',
  visa_application_started: 'Your visa application has been started.',
  visa_application_submitted: 'Your visa application has been submitted.',
  awaiting_visa_decision: 'You are waiting for the decision on your visa application.',
  pending_documents: 'The school needs additional documents from you. Please send what is listed below.',
  enrolment: 'You are enrolled. Congratulations.',
  visa_application: 'It is time to prepare and submit your visa application. Your counselor will guide you.',
  visa_decision_received: 'Your visa decision has been received. Your counselor will talk you through it.',
  visa_decision: 'You are waiting for, or have received, your visa decision. Your counselor will keep you updated.',
};

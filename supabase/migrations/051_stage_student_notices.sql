-- Telling the student about a stage change is its own, optional action. It is recorded on the stage change itself (who, when, where it went,
-- whether it worked) so nothing can be sent twice by accident and a failed send can be retried without touching the stage.
alter table public.portal_stage_history
  add column if not exists inform_state text check (inform_state in ('sending','sent','failed')),
  add column if not exists informed_at timestamptz,
  add column if not exists informed_by text,
  add column if not exists inform_to text,
  add column if not exists inform_subject text,
  add column if not exists inform_error text,
  add column if not exists inform_message_id uuid references public.portal_messages(id) on delete set null;

-- What a stage means, in words for the student (shown on their dashboard and used in the email). Editable on the Workflows page.
alter table public.portal_stages add column if not exists student_note text;

-- Plain starting descriptions. They only fill stages that have none, so anything an admin writes later is kept.
update public.portal_stages set student_note = 'Your documents have been sent to the university.' where key = 'documents_sent' and student_note is null;
update public.portal_stages set student_note = 'The university has made you an offer. Your counselor will explain any conditions and what comes next.' where key = 'offer_received' and student_note is null;
update public.portal_stages set student_note = 'The university interview is the next step. Your counselor will tell you how it works and when it takes place.' where key = 'first_interview' and student_note is null;
update public.portal_stages set student_note = 'Your interview has not taken place yet. Your counselor will keep you updated.' where key = 'interview_pending' and student_note is null;
update public.portal_stages set student_note = 'Your interview still has to be booked. Your counselor will help you choose a time.' where key = 'interview_to_be_booked' and student_note is null;
update public.portal_stages set student_note = 'Your bank statement is being checked. Please make sure what you send is complete and easy to read.' where key = 'bank_statement_review' and student_note is null;
update public.portal_stages set student_note = 'The university needs some documents before it can issue an unconditional offer. Please send what is listed below.' where key = 'documents_for_unconditional_offer' and student_note is null;
update public.portal_stages set student_note = 'You have passed your interview. Your counselor will explain the next step.' where key = 'interview_passed' and student_note is null;
update public.portal_stages set student_note = 'Your application form has been completed.' where key = 'application_form_completed' and student_note is null;
update public.portal_stages set student_note = 'A tuition fee arrangement applies to your application. Your counselor will explain it.' where key = 'tuition_fee_stage' and student_note is null;
update public.portal_stages set student_note = 'Your unconditional offer has been requested from the university. This can take a little time.' where key = 'unconditional_offer_requested' and student_note is null;
update public.portal_stages set student_note = 'Your documents for the CAS are ready.' where key = 'cas_documents_ready' and student_note is null;
update public.portal_stages set student_note = 'A payment plan has been sent to you. Please read it carefully and ask your counselor if anything is unclear.' where key = 'payment_plan_sent' and student_note is null;
update public.portal_stages set student_note = 'You have received your unconditional offer.' where key = 'unconditional_offer_received' and student_note is null;
update public.portal_stages set student_note = 'Your CAS (Confirmation of Acceptance for Studies) has been requested from the university.' where key = 'cas_requested' and student_note is null;
update public.portal_stages set student_note = 'A pre-CAS interview is the next step. Your counselor will tell you how to prepare.' where key = 'precas_interview' and student_note is null;
update public.portal_stages set student_note = 'A QC form has been sent to you. Please complete it and return it as your counselor explains.' where key = 'qc_form_sent' and student_note is null;
update public.portal_stages set student_note = 'You are waiting for your pre-CAS interview.' where key = 'awaiting_precas_interview' and student_note is null;
update public.portal_stages set student_note = 'The university has sent your CAS.' where key = 'cas_sent' and student_note is null;
update public.portal_stages set student_note = 'Your signed payment plan has been received.' where key = 'payment_plan_signed' and student_note is null;
update public.portal_stages set student_note = 'You have passed your pre-CAS interview.' where key = 'precas_interview_passed' and student_note is null;
update public.portal_stages set student_note = 'You have received your CAS. Keep it safe, because you need it for your visa application.' where key = 'cas_received' and student_note is null;
update public.portal_stages set student_note = 'Your pre-CAS interview has been completed.' where key = 'precas_interview_completed' and student_note is null;
update public.portal_stages set student_note = 'A tuition fee payment is needed at this stage. Please follow your counselor’s instructions and keep your payment receipt.' where key = 'tuition_fee_payment_required' and student_note is null;
update public.portal_stages set student_note = 'Please send the documents listed below so your application can move forward.' where key = 'student_documents_pending' and student_note is null;
update public.portal_stages set student_note = 'Your visa application has been started.' where key = 'visa_application_started' and student_note is null;
update public.portal_stages set student_note = 'Your visa application has been submitted.' where key = 'visa_application_submitted' and student_note is null;
update public.portal_stages set student_note = 'You are waiting for the decision on your visa application.' where key = 'awaiting_visa_decision' and student_note is null;
update public.portal_stages set student_note = 'The school needs additional documents from you. Please send what is listed below.' where key = 'pending_documents' and student_note is null;
update public.portal_stages set student_note = 'You are enrolled. Congratulations.' where key = 'enrolment' and student_note is null;
update public.portal_stages set student_note = 'It is time to prepare and submit your visa application. Your counselor will guide you.' where key = 'visa_application' and student_note is null;
update public.portal_stages set student_note = 'Your visa decision has been received. Your counselor will talk you through it.' where key = 'visa_decision_received' and student_note is null;
update public.portal_stages set student_note = 'You are waiting for, or have received, your visa decision. Your counselor will keep you updated.' where key = 'visa_decision' and student_note is null;

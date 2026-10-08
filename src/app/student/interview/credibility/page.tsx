import { redirect } from 'next/navigation';
import Link from 'next/link';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { admin } from '@/lib/supabase';
import { loadQuestions, loadSettings, summarise, type Attempt } from '@/lib/credibility';
import CredTrainer, { type CAttempt, type CQuestion } from '@/components/CredTrainer';

export const maxDuration = 60;

export default async function CredibilityTraining() {
  if (await currentStaff()) redirect('/credibility');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  if (!me.apps.some((a) => a.in_regent)) {
    return (
      <div className="st-page">
        <h1 className="st-h1">Credibility Test Training</h1>
        <section className="st-card"><h2>Not available for your application</h2><p className="st-sub">This training is for applicants to Regent College London. Your counselor can tell you what to prepare for your interview.</p><Link className="st-btn" href="/student/interview">Back to interview practice</Link></section>
      </div>
    );
  }
  const [settings, questions, { data: rows }] = await Promise.all([
    loadSettings(), loadQuestions(true),
    admin().from('portal_cred_attempts').select('*').eq('student_email', me.email).order('created_at'),
  ]);
  const all = (rows || []) as Attempt[];
  const tried = new Set(all.map((a) => a.question_id));
  const cq: CQuestion[] = questions.map((q) => ({ id: q.id, question: q.question, category: q.category, guidance: q.guidance, model: tried.has(q.id) ? q.model_answer : null }));
  const ca: CAttempt[] = all.map((a) => ({ id: a.id, question_id: a.question_id, answer: a.answer, score: a.score, band: a.band, criteria: a.criteria, did_well: a.did_well, missing: a.missing, improve: a.improve, suggestions: a.suggestions, summary: a.summary, flags: (a.flags || []).filter((f) => !f.startsWith('internal:')), mode: a.mode, created_at: a.created_at }));
  return (
    <div className="st-page cr-page">
      <CredTrainer video={{ id: settings.video_id, title: settings.title, description: settings.description }} questions={cq} attempts={ca} stats={summarise(all, questions)} canPractise />
    </div>
  );
}

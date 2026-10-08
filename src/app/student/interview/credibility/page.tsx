import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { admin } from '@/lib/supabase';
import { loadQuestions, loadSettings, summarise, type Attempt } from '@/lib/credibility';
import CredTrainer, { type CAttempt, type CQuestion } from '@/components/CredTrainer';
import { fillUniversity } from '@/lib/credShared';

export const maxDuration = 60;

export default async function CredibilityTraining() {
  if (await currentStaff()) redirect('/credibility');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const [settings, questions, { data: rows }] = await Promise.all([
    loadSettings(), loadQuestions(true),
    admin().from('portal_cred_attempts').select('*').eq('student_email', me.email).order('created_at'),
  ]);
  const all = (rows || []) as Attempt[];
  const tried = new Set(all.map((a) => a.question_id));
  const school = me.apps[0]?.school || null;
  const cq: CQuestion[] = questions.map((q) => ({ id: q.id, question: fillUniversity(q.question, school), category: q.category, guidance: fillUniversity(q.guidance, school), model: tried.has(q.id) ? fillUniversity(q.model_answer, school) : null }));
  const ca: CAttempt[] = all.map((a) => ({ id: a.id, question_id: a.question_id, answer: a.answer, score: a.score, band: a.band, criteria: a.criteria, did_well: a.did_well, missing: a.missing, improve: a.improve, suggestions: a.suggestions, summary: a.summary, flags: (a.flags || []).filter((f) => !f.startsWith('internal:')), mode: a.mode, created_at: a.created_at }));
  return (
    <div className="st-page cr-page">
      <CredTrainer video={{ id: settings.video_id, title: settings.title, description: settings.description }} questions={cq} attempts={ca} stats={summarise(all, questions)} canPractise />
    </div>
  );
}

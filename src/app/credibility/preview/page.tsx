import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { loadQuestions, loadSettings, summarise } from '@/lib/credibility';
import { fillUniversity } from '@/lib/credShared';
import CredTrainer, { type CQuestion } from '@/components/CredTrainer';
import Icon from '@/components/Icon';

/** What a student sees, shown to staff read-only (nothing is saved or scored). */
export default async function CredibilityPreview() {
  await requireStaff();
  const [settings, questions] = await Promise.all([loadSettings(), loadQuestions(true)]);
  const cq: CQuestion[] = questions.map((q) => ({ id: q.id, question: fillUniversity(q.question, 'Regent College London'), category: q.category, guidance: fillUniversity(q.guidance, 'Regent College London'), model: null }));
  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}><Link href="/credibility" className="btn ghost sm"><Icon n="left" size={14} /> Back to training settings</Link><span className="badge amber plain">Student preview. Nothing here is saved.</span></div>
      <div className="stu-shell" style={{ minHeight: 0, borderRadius: 24, background: 'none' }}>
        <div className="st-page cr-page"><CredTrainer preview video={{ id: settings.video_id, title: settings.title, description: settings.description }} questions={cq} attempts={[]} stats={summarise([], questions)} canPractise={false} /></div>
      </div>
    </>
  );
}

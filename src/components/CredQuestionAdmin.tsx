'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { addQuestion, deleteQuestion, moveQuestion, toggleQuestion, updateQuestion } from '@/app/credibility-actions';
import { CATEGORIES, CATEGORY_LABEL, type Question } from '@/lib/credShared';

function Fields({ q }: { q?: Question }) {
  return (
    <div className="grid" style={{ gap: 10 }}>
      <label>Question<textarea name="question" defaultValue={q?.question || ''} rows={2} maxLength={400} required placeholder="e.g. Why did you choose this course?" style={{ width: '100%', marginTop: 6 }} /></label>
      <label>Type of question
        <select name="category" defaultValue={q?.category || 'general'} style={{ width: '100%', marginTop: 6 }}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
        <small className="muted">The type decides which skills are marked. For example, “Finance” also checks funding knowledge.</small></label>
      <label>Guidance for the student (one tip per line)<textarea name="guidance" defaultValue={q?.guidance || ''} rows={4} maxLength={1500} placeholder="What a strong answer should contain" style={{ width: '100%', marginTop: 6 }} /></label>
      <label>Example answer (optional)<textarea name="model_answer" defaultValue={q?.model_answer || ''} rows={4} maxLength={2000} placeholder="Leave empty if you prefer students to find their own words" style={{ width: '100%', marginTop: 6 }} />
        <small className="muted">Shown only after the student has tried once, with a reminder not to memorise it. Examples that students copy are marked down.</small></label>
    </div>
  );
}

export default function CredQuestionAdmin({ questions }: { questions: Question[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{questions.filter((q) => q.active).length} active of {questions.length}. Students see active questions in this order.</span>
        <button className="btn" onClick={() => setAdding(!adding)}><Icon n="user-plus" size={15} /> {adding ? 'Close' : 'Add question'}</button>
      </div>
      {adding && <form action={addQuestion} className="card"><h2 style={{ marginTop: 0 }}>New question</h2><Fields /><div className="filters" style={{ marginTop: 12 }}><button className="btn">Add question</button><button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button></div></form>}
      {questions.length === 0 && <div className="card muted">No questions yet. Add the first one.</div>}
      {questions.map((q, i) => (
        <div key={q.id} className="card" style={{ opacity: q.active ? 1 : 0.62, padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <b style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--blue-soft)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none', fontSize: 13 }}>{i + 1}</b>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{q.question}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge blue plain">{CATEGORY_LABEL[q.category] || 'General'}</span>
                {!q.active && <span className="badge amber plain">Hidden from students</span>}
                {q.guidance && <span>{q.guidance.split('\n').filter(Boolean).length} tips</span>}
                {q.model_answer && <span>example answer</span>}
              </div>
            </div>
            <div className="filters" style={{ flex: 'none', gap: 4 }}>
              <button className="btn ghost sm" disabled={pending || i === 0} onClick={() => run(() => moveQuestion(q.id, -1))} aria-label="Move up">↑</button>
              <button className="btn ghost sm" disabled={pending || i === questions.length - 1} onClick={() => run(() => moveQuestion(q.id, 1))} aria-label="Move down">↓</button>
            </div>
          </div>
          <div className="filters" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <label className="muted" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={q.active} disabled={pending} onChange={(e) => run(() => toggleQuestion(q.id, e.target.checked))} /> Active</label>
            <div className="filters">
              <button className="btn ghost sm" onClick={() => setEdit(edit === q.id ? null : q.id)}>{edit === q.id ? 'Close' : 'Edit'}</button>
              <button className="btn ghost sm" style={{ color: 'var(--red)' }} disabled={pending} onClick={() => { if (confirm('Delete this question? Students’ past answers to it are kept in their history.')) run(() => deleteQuestion(q.id)); }}><Icon n="trash" size={14} /> Delete</button>
            </div>
          </div>
          {edit === q.id && <form action={updateQuestion} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}><input type="hidden" name="id" value={q.id} /><Fields q={q} /><div className="filters" style={{ marginTop: 12 }}><button className="btn">Save changes</button></div></form>}
        </div>
      ))}
    </div>
  );
}

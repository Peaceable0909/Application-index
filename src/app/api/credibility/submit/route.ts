import { NextResponse } from 'next/server';
import { currentStudent } from '@/lib/student';
import { admin } from '@/lib/supabase';
import { answerHash, evaluateAnswer, loadQuestions, summarise, type Attempt } from '@/lib/credibility';

export const maxDuration = 60;
const DAILY = 40;

export async function POST(req: Request) {
  const me = await currentStudent();
  if (!me) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const reg = me.apps.find((a) => a.in_regent);
  if (!reg) return NextResponse.json({ ok: false, error: 'This training is for Regent College London applicants.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { questionId?: string; answer?: string };
  const answer = (b.answer || '').trim();
  if (answer.length < 10) return NextResponse.json({ ok: false, error: 'Write a little more so there is something to assess (at least a sentence).' }, { status: 400 });
  if (answer.length > 1500) return NextResponse.json({ ok: false, error: 'Please keep your answer under 1,500 characters. Interview answers should be focused.' }, { status: 400 });
  const db = admin();
  const questions = await loadQuestions(true);
  const q = questions.find((x) => x.id === b.questionId);
  if (!q) return NextResponse.json({ ok: false, error: 'That question is not available.' }, { status: 404 });
  const { count } = await db.from('portal_cred_attempts').select('id', { count: 'exact', head: true }).eq('student_email', me.email).gte('created_at', new Date(Date.now() - 864e5).toISOString());
  if ((count || 0) >= DAILY) return NextResponse.json({ ok: false, error: 'You have reached today’s practice limit. Come back tomorrow, and use the time to improve your answers.' }, { status: 429 });

  const ev = await evaluateAnswer(q, answer, { programme: reg.programme, school: reg.school, intake: reg.intake });
  const hash = answerHash(answer);
  const { count: same } = await db.from('portal_cred_attempts').select('id', { count: 'exact', head: true }).eq('question_id', q.id).eq('answer_hash', hash).neq('student_email', me.email);
  const flags = [...ev.flags, ...((same || 0) > 0 ? ['internal:identical-to-other-student'] : [])];
  const { data: row, error } = await db.from('portal_cred_attempts').insert({
    student_email: me.email, application_id: reg.application_id, question_id: q.id, question_text: q.question, category: q.category, answer, answer_hash: hash,
    score: ev.score, band: ev.band, criteria: ev.criteria, did_well: ev.didWell, missing: ev.missing, improve: ev.improve, suggestions: ev.suggestions, summary: ev.summary, flags, mode: ev.mode,
  }).select('*').single();
  if (error || !row) return NextResponse.json({ ok: false, error: 'Could not save your attempt. Please try again.' }, { status: 500 });
  const { data: all } = await db.from('portal_cred_attempts').select('*').eq('student_email', me.email).order('created_at');
  return NextResponse.json({ ok: true, attempt: row, stats: summarise((all || []) as Attempt[], questions) });
}

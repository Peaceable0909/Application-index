// Long-range recall for the AI Brain. A reply is written from the latest messages plus a short profile; this adds the OLDER messages of the same
// student that match what they are asking now (the way uploaded files are matched), so something said weeks ago is not lost when the chat is long.
// Pure (no database): the caller supplies the messages, already stripped of contact details.
import { words } from './brainDocs';

export type PastMessage = { from: 'student' | 'team'; text: string; at: string };
export type Recalled = { when: string; from: 'student' | 'team'; text: string };

export const sinceWords = (iso: string, now = Date.now()) => {
  const d = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 864e5));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
};

// A rough word stem, so "paying" and "pays", "sponsor" and "sponsoring" count as the same word.
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w);
const toks = (t: string) => [...new Set(words(t).map(stem))];
/** A message must score at least this to be recalled: one match on a rare word is enough, a match on a word used everywhere is not. */
const MIN_SCORE = 1.2;

/**
 * The few older messages that best match the question, oldest first. A word counts for more the fewer of this student's messages use it
 * ("tuition" says a lot, "documents" in a chat full of documents says nothing). Empty when nothing matches well.
 */
export function earlierRelevant(older: PastMessage[], query: string, max = 6, now = Date.now()): Recalled[] {
  const q = new Set(toks(query));
  if (!q.size || !older.length) return [];
  const per = older.map((m) => ({ m, ws: new Set(toks(m.text)) }));
  const df = new Map<string, number>();
  for (const { ws } of per) for (const w of ws) if (q.has(w)) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w: string) => Math.log(1 + per.length / (1 + (df.get(w) || 0)));
  const scored: { m: PastMessage; score: number }[] = [];
  for (const { m, ws } of per) {
    let score = 0;
    for (const w of ws) if (q.has(w)) score += idf(w);
    if (score >= MIN_SCORE) scored.push({ m, score: score + (m.from === 'student' ? 0.1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.m).sort((a, b) => a.at.localeCompare(b.at)).map((m) => ({ when: sinceWords(m.at, now), from: m.from, text: m.text.slice(0, 320) }));
}

import { admin } from './supabase';
import { schoolKey } from './docs';

// Files the team taught the Brain are stored whole and cut into passages when a reply is written. The passages that share the most
// words with what the student asked are handed to the model, so a 60-page handbook costs the same as a short note.
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those i you we they my your our their at by from as do does did can could would should will what when where how why which who whom about into than then so if not no yes please hi hello hey thanks thank'.split(' '));
export const words = (t: string) => (t.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));

export function chunkText(text: string, size = 900): string[] {
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n{2,}|(?<=[.!?])\s{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (cur && (cur + ' ' + p).length > size) { out.push(cur); cur = p.length > size ? p.slice(-size) : p; if (p.length > size) { for (let i = 0; i < p.length - size; i += size) out.push(p.slice(i, i + size)); } }
    else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** The few passages of this workspace's files that best match the question (empty when nothing matches well). */
export async function relevantPassages(workspace: string, school: string | null | undefined, query: string, max = 4): Promise<{ source: string; excerpt: string }[]> {
  const q = new Set(words(query));
  if (!q.size) return [];
  const { data } = await admin().from('portal_brain_docs').select('title, school, body').eq('workspace', workspace).eq('active', true).limit(40);
  const key = schoolKey(school ?? null);
  const scored: { source: string; excerpt: string; score: number }[] = [];
  for (const d of data || []) {
    if (school !== undefined && d.school && schoolKey(d.school) !== key) continue;   // undefined = no student yet (a new visitor): use every file
    for (const c of chunkText(d.body)) {
      const ws = words(c); if (!ws.length) continue;
      const hit = new Set(ws.filter((w) => q.has(w)));
      const score = hit.size / Math.sqrt(q.size) + hit.size * 0.05;
      if (hit.size >= Math.min(2, q.size)) scored.push({ source: d.title, excerpt: c.slice(0, 900), score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(({ source, excerpt }) => ({ source, excerpt }));
}

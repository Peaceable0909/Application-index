import { createHash } from 'crypto';
import { admin } from './supabase';
import { callScript } from './appsScript';

// Cost and safety controls for every model call:
//  - results are cached and reused until the underlying data changes (input hash)
//  - auto-generated text is rate-limited (default: at most once per 30 min)
//  - a daily call budget (AI_DAILY_LIMIT, default 60) stops runaway usage
//  - the model only ever sees aggregated numbers / non-identifying facts, never names, emails, phones or document contents
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 60);
const MANUAL_COOLDOWN_MS = 60_000;

export const hashOf = (o: unknown) => createHash('sha1').update(JSON.stringify(o)).digest('hex');

export type AiResult<T> = { data: T | null; cached: boolean; stale: boolean; at?: string; model?: string; error?: string };

function parseJson(text: string): unknown {
  const t = text.replace(/```json|```/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

/** True when every number written in `text` is one of the numbers we supplied (so the model can't invent figures). */
export function numbersWithin(text: string, allowed: Iterable<number>): boolean {
  const ok = new Set([...allowed].map(String));
  return (text.match(/\d+/g) || []).every((n) => ok.has(n));
}

export async function askAi<T>(o: {
  kind: string; cacheKey: string; inputHash: string; system: string; user: string; validate: (raw: unknown) => T | null;
  auto?: boolean;            // generate without being asked (only if nothing cached or the cooldown passed)
  force?: boolean;           // explicit "generate / refresh" click
  minIntervalMs?: number;    // cooldown for auto regeneration
  maxTokens?: number;
}): Promise<AiResult<T>> {
  const db = admin();
  const { data: c } = await db.from('portal_ai_cache').select('*').eq('cache_key', o.cacheKey).maybeSingle();
  const cachedOut = c ? (c.output as T) : null;
  if (c && c.input_hash === o.inputHash) return { data: cachedOut, cached: true, stale: false, at: c.created_at, model: c.model };

  const age = c ? Date.now() - new Date(c.created_at).getTime() : Infinity;
  const mayCall = o.force ? age > MANUAL_COOLDOWN_MS : !!o.auto && age > (o.minIntervalMs ?? 30 * 60_000);
  if (!mayCall) return { data: cachedOut, cached: !!c, stale: !!c, at: c?.created_at, model: c?.model };

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from('portal_ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());
  if ((count || 0) >= DAILY_LIMIT) return { data: cachedOut, cached: !!c, stale: !!c, at: c?.created_at, error: `Daily AI limit reached (${DAILY_LIMIT}).` };

  try {
    const r = await callScript<{ text: string; model: string; tokens: number }>('aiChat', { system: o.system, user: o.user, maxTokens: o.maxTokens ?? 600, json: true });
    const parsed = o.validate(parseJson(r.text));
    await db.from('portal_ai_usage').insert({ kind: o.kind, tokens: r.tokens, ok: !!parsed });
    if (!parsed) return { data: cachedOut, cached: !!c, stale: !!c, at: c?.created_at, error: 'The AI reply failed validation and was discarded.' };
    const at = new Date().toISOString();
    await db.from('portal_ai_cache').upsert({ cache_key: o.cacheKey, kind: o.kind, input_hash: o.inputHash, output: parsed, model: r.model, tokens: r.tokens, created_at: at });
    return { data: parsed, cached: false, stale: false, at, model: r.model };
  } catch (e) {
    await db.from('portal_ai_usage').insert({ kind: o.kind, ok: false });
    return { data: cachedOut, cached: !!c, stale: !!c, at: c?.created_at, error: (e as Error).message };
  }
}

import {
  type Profile, cleanProfile, mergeProfile, firstName, nameFrom, isGreeting, wantsPerson, isAffirmative, isNegative, offeredPerson, nextToLearn,
  readyForHandover, levelFromText, cleanReply, splitGap, claimsAction, promisesOutcome, unsupportedFigures, hasContactOrLink, repeatsEarlier, supported, normLevel,
  recentlyAsked, uncoveredTopics, ungroundedTopicClaim, generalClaimFromMemory, judgesQualification, fillerOpening, type Topic,
} from './leadProfile';

// One turn of the new-student chat, written so every side effect goes through `LeadIO`. The real wiring (database, model, notifications) is in
// leads.ts; tests plug in fakes. The rules that matter most:
//  - the assistant never says that something was sent, passed on or arranged; only this file may say so, and only after the notification
//    was really delivered (verified), using fixed wording;
//  - when the model fails, the visitor gets an honest "I could not answer that", never a claim that a counsellor has been told;
//  - the profile only takes in what the visitor actually typed.

export type LeadRow = {
  id: string; workspace: string; name: string | null; email: string | null; phone: string | null; interest: string | null; summary: string | null; needs: string[];
  ai_paused: boolean; needs_human: boolean; profile?: Profile | null; handover_at?: string | null; handover_delivered?: boolean | null; fail_streak?: number | null;
};
export type Msg = { from_lead: boolean; by_ai: boolean; body: string; created_at: string };
export type Knowledge = { country: string; text: string };
export type Extraction = { profile: Profile; summary: string; needs: string[]; personal: boolean };
export type Handover = { delivered: boolean; pushSent: number; emailSent: number };

export interface LeadIO {
  loadConvo(leadId: string): Promise<Msg[]>;
  saveReply(leadId: string, body: string): Promise<void>;
  updateLead(leadId: string, patch: Record<string, unknown>): Promise<void>;
  knowledge(lead: LeadRow, query: string): Promise<Knowledge>;
  aiEnabled(): boolean;
  budgetLeft(): Promise<boolean>;
  reply(system: string, messages: { role: 'user' | 'assistant'; content: string }[]): Promise<string>;
  extract(system: string, user: string): Promise<unknown | null>;
  notifyHandover(lead: LeadRow, profile: Profile, summary: string, recent: string[]): Promise<Handover>;
  notifyContact(lead: LeadRow, profile: Profile): Promise<void>;
  recordGap(workspace: string, leadId: string, question: string): Promise<void>;
  now(): number;
}

const strip = (t: string) => t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]').replace(/\+?\d[\d\s().-]{7,17}\d/g, '[number]').replace(/https?:\/\/\S+|www\.\S+/g, '[link]');
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s().-]{7,17}\d/;
const findEmail = (t: string) => t.match(EMAIL)?.[0].toLowerCase() || null;
const findPhone = (t: string) => { const m = t.match(PHONE)?.[0]; return m && m.replace(/\D/g, '').length >= 8 ? m.trim() : null; };

// ---------- wording the system itself is allowed to use ----------
const pick = (seed: string, options: string[]) => options[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % options.length];
const GREETINGS = [
  'Hello, and welcome to WhiteRock. I can help you choose a course, understand entry requirements and plan your application. What are you thinking of studying?',
  'Hi there, welcome. Are you already looking at a particular country or course, or would you like help working out your options?',
  'Hello, welcome to WhiteRock. Tell me a little about your study plans and I will help however I can. Where would you like to study, and what subject?',
];
export const handoverDone = (first: string, via: string) =>
  `Thank you${first ? `, ${first}` : ''}. I have notified our counsellors and shared this conversation with them, so you will not need to repeat yourself. They will contact you on the ${via} you gave me, or reply right here in the chat. You can keep asking me anything in the meantime.`;
export const handoverNotConfirmed = (first: string) =>
  `Thank you${first ? `, ${first}` : ''}. I tried to notify our counsellors, but I could not confirm that the message reached them. I have saved your details and this conversation so the team can see them in the portal, but I cannot tell you when someone will respond. If it is urgent, please send me a message again in a few minutes.`;
const handoverAlready = (first: string) =>
  `${first ? `${first}, our` : 'Our'} counsellors already have your details and this conversation, so there is nothing more you need to send. They will reach out using the contact details you gave me. If anything has changed, or you want to add something, just tell me here.`;
const askNameForHandover = 'I would be glad to bring in a counsellor. So that it is useful for them, may I have your name first?';
const askContactForHandover = (first: string) => `Thank you${first ? `, ${first}` : ''}. What is the best email address or WhatsApp number for a counsellor to reach you on?`;
const unavailable = 'I cannot answer questions automatically right now. If you leave your name and an email address or WhatsApp number here, I can ask a counsellor to follow up with you. Would you like that?';
const trouble = (streak: number) => streak < 1
  ? 'Sorry, I had trouble putting a good answer together for that. Could you say it again, perhaps in a slightly different way?'
  : 'I am still having trouble with that, and I would rather not guess. Would you like me to bring in a counsellor to help you with it?';

const viaWords = (p: Profile) => (p.email && p.phone ? 'email address or phone number' : p.email ? 'email address' : 'phone number');
const interestOf = (p: Profile) => [p.programme, p.level && `(${p.level})`, p.country && `in ${p.country}`, p.school && `at ${p.school}`].filter(Boolean).join(' ').slice(0, 200) || null;

// ---------- prompts ----------
export function buildSystem(o: { country: string; knowledge: string; profile: Profile; nextAsk: string | null; handover: 'none' | 'done' | 'recorded'; visitorTurns: number; greeting: boolean; uncovered?: Topic[] }): string {
  const known = Object.fromEntries(Object.entries(o.profile).filter(([k]) => k !== 'email' && k !== 'phone').concat(o.profile.email ? [['email', 'given']] : [], o.profile.phone ? [['phone', 'given']] : []));
  return `You are WhiteRock's AI study adviser, chatting with a prospective student who is interested in studying in ${o.country}. WhiteRock Educational Services is an education advice company that helps students apply to universities abroad and supports them through the visa step. You speak like an experienced, friendly human admissions counsellor: warm, direct and practical.

HOW TO TALK
- First work out what the visitor just did: greeted you, asked a question, shared their situation, asked for advice, or asked for a person. Respond to that, not to a script.
- A greeting gets one warm sentence back and ONE open question, such as "How can I help with your study plans?". Do not ask where they live or for any detail yet.
- If they ask something, answer it first and directly. Only after that, if it fits, ask one gentle question that moves their plan forward.
- Ask at most ONE question per message. Never ask for something they already told you (check PROFILE and the whole conversation first).
- Keep it short, usually two to four sentences. Plain words, full sentences, no bullet points unless you are listing a few options. No emoji. Do not use dashes as punctuation (no em dashes, no en dashes); use commas or full stops.
- Never open with praise or filler ("That's a great choice", "Great question", "Absolutely"). Do not open every message with a greeting, do not repeat back what they just said, vary your wording, and use their first name only now and then.
- If you asked something and they did not answer it, do not ask the same thing again straight away. Carry on helping with what they do say.
- Be kind when they are stressed, disappointed or worried (a refusal, money, grades). Acknowledge the feeling in one honest sentence before the practical part.

WHAT YOU KNOW
- For facts about schools, programmes, fees, entry requirements, deadlines, documents, visas and timelines, use ONLY the KNOWLEDGE section below. If something is not there, say plainly that you cannot confirm it from what you have, say what you can tell them, and ask for the detail you need to understand their situation. Put the marker [[GAP: their question in a few words]] at the very end of that message (the visitor never sees it).
- If it is not written in KNOWLEDGE, you do not know it, even if it seems like common knowledge. Do not describe what programmes or universities "usually" or "typically" require, what scholarships exist, what fees or deadlines are normal, how visas work, or whether their grades or degree are enough. Say you cannot confirm it instead.
- You may use ordinary counselling skill that needs no facts: help them think through options, ask good clarifying questions, and explain that a counsellor can check the details against the real requirements.
- Never invent or guess fees, dates, deadlines, grade or English test requirements, school or course names, links, phone numbers or email addresses. If KNOWLEDGE names a school or course, use the name exactly as written.
- Never promise or hint at an admission, offer, scholarship, visa result or timeline. For a refusal: show empathy, then ask calmly what the refusal letter said (country, date, stated reason, level of study) and what has changed since. Do not guess why it happened. A counsellor can review the actual letter.
- Do not give legal or immigration advice beyond KNOWLEDGE. Ask people not to share passport numbers or bank details in this chat.
- If asked, say you are an AI assistant and that a human counsellor can take over.

WHAT YOU CAN DO
- You cannot send, forward, book, assign or notify anything yourself. Never say or imply that you have sent, passed on, shared, forwarded, submitted, booked or assigned anything, and never say that a counsellor will contact them, unless HANDOVER is "done".
- Offer a human counsellor only when (a) the visitor asks for one, (b) their case needs personal review (a refusal letter, a borderline eligibility question, fees or scholarships) and you have already asked enough to understand it, or (c) you cannot confirm something that matters to their decision. Make it an offer in one question, such as "Would you like me to bring in a counsellor to look at this with you?". The system carries out the handover itself when they say yes, so never describe it as done.

EXAMPLES OF THE STYLE (tone only; never copy their facts)
Visitor: Hello
You: Hello, welcome to WhiteRock. How can I help with your study plans?
Visitor: how much is the tuition at a university (and KNOWLEDGE has no fees)
You: I do not have the tuition fee for that programme, and I would rather not guess. Which course are you looking at, so I can note exactly what you need answered? [[GAP: tuition fee for that programme]]
Visitor: my visa was refused last year
You: I am sorry, a refusal is stressful, and it does not have to be the end of your plans. Which country was the refusal from, and did the letter give a reason?
Visitor: can I get a scholarship? (and KNOWLEDGE has nothing on scholarships)
You: I cannot confirm what scholarships are available from the information I have. Are you hoping to fund your studies yourself, or would you need financial support? [[GAP: scholarships available]]

WHAT TO LEARN (gradually, as part of the conversation, never like a form)
- name, email, phone or WhatsApp, country, preferred school, programme, study level (undergraduate, top-up or postgraduate), previous qualifications and grades, previous school or university, and anything else relevant to their enquiry.
- PROFILE lists what is already known. NEXT_TO_LEARN is a suggestion for the single thing to ask about if nothing more pressing is going on. Skip it if they asked something you are answering, if they are upset, or if it would feel pushy. Ask for an email or phone number only when it helps them (follow-up, a counsellor call) and say why in a few words.

HANDOVER: ${o.handover}
${o.uncovered?.length ? `UNCOVERED_TOPICS (the visitor raised these and KNOWLEDGE has nothing real on them): ${o.uncovered.join(', ')}. Do not state anything about them. Say you cannot confirm it from what you have, and add the [[GAP: ...]] marker.\n` : ''}PROFILE: ${JSON.stringify(known)}
NEXT_TO_LEARN: ${o.nextAsk ?? 'nothing in particular'}
CONTEXT: this is visitor message number ${o.visitorTurns}.${o.greeting ? ' The visitor has just greeted you.' : ''}

KNOWLEDGE
${o.knowledge || '(nothing has been added for this country yet, so you cannot confirm specific facts)'}

Reply with the message text only.`;
}

export const EXTRACT_SYSTEM = `You read a conversation between a prospective student (VISITOR) and an education adviser (ASSISTANT) and extract what the VISITOR has actually said about themselves. Reply as JSON only:
{"profile": {"name": null, "country": null, "school": null, "programme": null, "level": null, "qualifications": null, "previousSchool": null, "other": null}, "summary": "", "needs": [], "personal": false}
- name: their own name. country: the country they want to study in. school: a university they named. programme: the course or subject they want. level: undergraduate, top-up, postgraduate, foundation or other. qualifications: their previous qualifications and grades as they described them. previousSchool: the school or university they attended. other: anything else relevant to an admission enquiry (a previous refusal, budget, intake, work experience).
- Use null for anything the VISITOR has not stated. Never infer, guess, or copy from the ASSISTANT's messages. Do not include email addresses or phone numbers. If the visitor corrected something, give the corrected value.
- summary: at most 350 characters: who they are, what they want, and what is still unknown. needs: up to 5 short things they asked for or need.
- personal: true when their situation needs a human counsellor to review it (a refusal, borderline grades, fees or scholarship talk, a complicated history).`;

/** Turns the model's JSON into an Extraction, keeping only what the visitor really typed. Returns null if it is not usable. */
export function parseExtraction(raw: unknown, visitorText: string): Extraction | null {
  const d = raw as { profile?: Record<string, unknown>; summary?: unknown; needs?: unknown; personal?: unknown } | null;
  if (!d || typeof d !== 'object') return null;
  const p = cleanProfile({ ...(d.profile || {}), email: undefined, phone: undefined });
  const kept: Profile = {};
  for (const [k, v] of Object.entries(p) as [keyof Profile, string][]) {
    const loose = k === 'qualifications' || k === 'other' || k === 'previousSchool' || k === 'school';
    // a level may be named by a word like "MSc" or "bachelor" rather than spelled out, so it is checked by meaning
    if (!supported(v, visitorText, loose) && !(k === 'level' && normLevel(v) === levelFromText(visitorText))) continue;
    if (k === 'name' && !/^[\p{L}][\p{L} .'-]*$/u.test(v)) continue;
    kept[k] = k === 'level' ? normLevel(v) : v;
  }
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  return {
    profile: kept, summary: str(d.summary, 500), personal: d.personal === true,
    needs: Array.isArray(d.needs) ? d.needs.filter((x): x is string => typeof x === 'string' && x.trim().length > 2).map((x) => x.trim().slice(0, 100)).slice(0, 6) : [],
  };
}

/** A draft with one or two bad sentences is better mended than thrown away: drop the offending sentences, a praise opener and any extra questions. Null when too little is left. */
export function repairReply(draft: string, o: { context: string; uncovered: Topic[]; handover: 'none' | 'done' | 'recorded' }): string | null {
  const { text } = splitGap(cleanReply(draft));
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const bad = (x: string) => hasContactOrLink(x) || (o.handover !== 'done' && !!claimsAction(x)) || !!promisesOutcome(x) || !!unsupportedFigures(x, o.context) || !!ungroundedTopicClaim(x, o.uncovered) || !!generalClaimFromMemory(x) || !!judgesQualification(x);
  let kept = sentences.filter((x) => !bad(x));
  if (kept.length && fillerOpening(kept[0])) kept = kept.slice(1);
  let q = 0;
  kept = kept.filter((x) => { if (/\?\s*$/.test(x)) { q++; return q === 1; } return true; });
  const out = kept.join(' ').trim();
  return out.length >= 25 ? out : null;
}

type Check = { ok: true; text: string; gap: string | null } | { ok: false; why: string };
/** Everything a drafted reply must pass before a visitor sees it. */
export function checkReply(draft: string, o: { context: string; earlier: string[]; handover: 'none' | 'done' | 'recorded'; uncovered?: Topic[] }): Check {
  const { text, gap } = splitGap(cleanReply(draft));
  if (text.length < 2) return { ok: false, why: 'it was empty' };
  if (text.length > 900 || text.split(/\s+/).length > 150) return { ok: false, why: 'it was too long; keep it under 110 words' };
  if (hasContactOrLink(text)) return { ok: false, why: 'it contained a link, email address or phone number; never write those' };
  const claim = o.handover === 'done' ? null : claimsAction(text);
  if (claim) return { ok: false, why: `it said something was sent, passed on or arranged ("${claim}"). Nothing has been; never say so. HANDOVER is not done` };
  const promise = promisesOutcome(text);
  if (promise) return { ok: false, why: `it promised an outcome ("${promise}"); never promise admission, offers, scholarships or visa results` };
  const filler = fillerOpening(text);
  if (filler) return { ok: false, why: `it opened with praise or filler ("${filler}"); start with the substance instead` };
  const ground = ungroundedTopicClaim(text, o.uncovered || []);
  if (ground) return { ok: false, why: `it stated something about a topic that is not in KNOWLEDGE ("${ground}"); say you cannot confirm it instead` };
  const judged = judgesQualification(text);
  if (judged) return { ok: false, why: `it judged how good their grades or qualifications are ("${judged}"); only the school can say, so do not` };
  const memory = generalClaimFromMemory(text);
  if (memory) return { ok: false, why: `it described what is "usually" or "typically" true from general knowledge ("${memory}"); only use KNOWLEDGE, otherwise say you cannot confirm it` };
  const fig = unsupportedFigures(text, o.context);
  if (fig) return { ok: false, why: `it stated a figure or date ("${fig}") that is not in KNOWLEDGE; only use figures given there` };
  if ((text.match(/\?/g) || []).length > 1) return { ok: false, why: 'it asked more than one question; ask only one' };
  if (repeatsEarlier(text, o.earlier)) return { ok: false, why: 'it repeated an earlier message; say something new and move the conversation forward' };
  return { ok: true, text, gap };
}

// ---------- the turn ----------
export async function runLeadTurn(lead: LeadRow, io: LeadIO): Promise<void> {
  const started = io.now();
  const convo = await io.loadConvo(lead.id);
  const visitor = convo.filter((m) => m.from_lead);
  const latest = visitor.at(-1)?.body ?? '';
  const prevAssistant = [...convo].reverse().find((m) => !m.from_lead)?.body ?? '';
  const visitorText = visitor.map((m) => m.body).join('\n');
  const pending = (lead.profile as Record<string, unknown> | null | undefined)?._handover === '1';

  // what the visitor typed, read without a model: contact details, a clearly stated name
  const base = cleanProfile({ ...(lead.profile || {}), ...(lead.name ? { name: lead.name } : {}), ...(lead.email ? { email: lead.email } : {}), ...(lead.phone ? { phone: lead.phone } : {}) });
  const typed: Profile = {};
  const email = base.email || findEmail(visitorText), phone = base.phone || findPhone(visitorText), name = base.name || nameFrom(latest, prevAssistant);
  if (email) typed.email = email; if (phone) typed.phone = phone; if (name) typed.name = name;
  let profile = mergeProfile(base, typed);
  const gotContact = (!lead.email && !!profile.email) || (!lead.phone && !!profile.phone);

  const accepted = offeredPerson(prevAssistant) && isAffirmative(latest);
  const declined = (offeredPerson(prevAssistant) || pending) && isNegative(latest);
  const asksPerson = wantsPerson(latest);
  // a handover that is waiting for their name or contact carries on when they give it
  const providedDetail = (!base.name && !!typed.name) || (!base.email && !!typed.email) || (!base.phone && !!typed.phone);
  const handoverRequested = !declined && (asksPerson || accepted || (pending && providedDetail));
  const already = !!lead.handover_at && lead.handover_delivered === true;

  const save = async (reply: string, extra: Record<string, unknown> = {}, ok = true, waiting: boolean | null = null) => {
    await io.saveReply(lead.id, reply);
    await io.updateLead(lead.id, {
      profile: (waiting ?? (pending && !declined)) ? { ...profile, _handover: '1' } : profile, ...(profile.name && !lead.name ? { name: profile.name } : {}), ...(profile.email && !lead.email ? { email: profile.email } : {}), ...(profile.phone && !lead.phone ? { phone: profile.phone } : {}),
      interest: interestOf(profile) || lead.interest, fail_streak: ok ? 0 : (lead.fail_streak || 0) + 1, last_message_at: new Date(io.now()).toISOString(), ...extra,
    });
  };

  // an honest, verified handover: ask for what is missing, then notify, and only then say so
  const handover = async (reason: string, summary: string): Promise<boolean> => {
    if (already) { await save(handoverAlready(firstName(profile.name)), {}, true, false); return true; }
    if (!profile.name) { await save(askNameForHandover, {}, true, true); return true; }
    if (!profile.email && !profile.phone) { await save(askContactForHandover(firstName(profile.name)), {}, true, true); return true; }
    const recent = visitor.slice(-6).map((m) => m.body);
    let res: Handover = { delivered: false, pushSent: 0, emailSent: 0 };
    try { res = await io.notifyHandover({ ...lead, name: profile.name || lead.name }, profile, summary || lead.summary || '', recent); } catch { /* reported below */ }
    await save(res.delivered ? handoverDone(firstName(profile.name), viaWords(profile)) : handoverNotConfirmed(firstName(profile.name)), {
      needs_human: true, handover_at: new Date(io.now()).toISOString(), handover_delivered: res.delivered, handover_reason: reason.slice(0, 200),
    }, true, false);
    return true;
  };

  if (handoverRequested) { await handover(asksPerson ? 'The visitor asked for a counsellor' : 'The visitor accepted the offer of a counsellor', lead.summary || ''); return; }

  // no model available: say so honestly; hand over only if they have already left details (they agreed to be contacted)
  if (!io.aiEnabled() || !(await io.budgetLeft())) {
    if (gotContact && readyForHandover(profile, true) && !lead.handover_at) { await handover('The assistant was unavailable and the visitor had left contact details', lead.summary || ''); return; }
    await save(already || lead.handover_at ? handoverAlready(firstName(profile.name)) : unavailable, {}, false);
    if (gotContact) await io.notifyContact({ ...lead, name: profile.name || lead.name }, profile);
    return;
  }

  const k = await io.knowledge(lead, visitor.slice(-3).map((m) => m.body).join(' '));
  const greeting = isGreeting(latest);
  const status: 'none' | 'done' | 'recorded' = lead.handover_at ? (lead.handover_delivered ? 'done' : 'recorded') : 'none';
  const nextAsk = nextToLearn(profile, { visitorTurns: visitor.length, skip: recentlyAsked(convo.filter((m) => !m.from_lead).map((m) => m.body)) });
  const uncovered = uncoveredTopics(visitor.slice(-3).map((m) => m.body).join(' '), k.text);
  const system = buildSystem({ country: k.country, knowledge: k.text, profile, nextAsk: nextAsk === 'contact' ? 'an email address or WhatsApp number (explain why)' : nextAsk, handover: status, visitorTurns: visitor.length, greeting, uncovered });
  // earlier claims by the old assistant would teach the model to repeat them
  const messages = convo.slice(-16).map((m) => ({ role: (m.from_lead ? 'user' : 'assistant') as 'user' | 'assistant', content: m.from_lead ? strip(m.body).slice(0, 600) : (claimsAction(m.body) ? '(earlier message not shown)' : m.body.slice(0, 600)) }));
  while (messages.length && messages[0].role === 'assistant') messages.shift();
  const earlier = convo.filter((m) => !m.from_lead).slice(-4).map((m) => m.body);
  const context = `${k.text}\n${visitorText}\n${JSON.stringify(profile)}`;

  const extractUser = JSON.stringify({ alreadyKnown: Object.fromEntries(Object.entries(profile).filter(([f]) => f !== 'email' && f !== 'phone')), conversation: convo.slice(-12).map((m) => ({ from: m.from_lead ? 'VISITOR' : 'ASSISTANT', text: strip(m.body).slice(0, 500) })) });
  const extractP = io.extract(EXTRACT_SYSTEM, extractUser).catch(() => null);

  let chosen: { text: string; gap: string | null } | null = null;
  let feedback = '';
  for (let attempt = 0; attempt < 2 && !chosen; attempt++) {
    if (attempt === 1 && io.now() - started > 25_000) break;     // a second try must still fit inside the server's time limit
    let draft = '';
    try { draft = await io.reply(feedback ? `${system}\n\nYour previous draft was rejected because ${feedback}. Write the message again and fix exactly that.` : system, messages); } catch { draft = ''; }
    if (!draft) { feedback = 'it was empty'; continue; }
    const c = checkReply(draft, { context, earlier, handover: status, uncovered });
    if (c.ok) { chosen = { text: c.text, gap: c.gap }; break; }
    feedback = c.why;
    const fixed = repairReply(draft, { context, uncovered, handover: status });
    const c2 = fixed ? checkReply(fixed, { context, earlier, handover: status, uncovered }) : null;
    if (c2?.ok) chosen = { text: c2.text, gap: splitGap(draft).gap };
  }

  const ext = parseExtraction(await extractP, visitorText);
  if (ext) profile = mergeProfile(profile, ext.profile);
  const extra: Record<string, unknown> = ext ? { summary: ext.summary || lead.summary, needs: ext.needs.length ? ext.needs : lead.needs } : {};

  if (!chosen) {
    await save(greeting ? pick(latest + lead.id, GREETINGS) : trouble(lead.fail_streak || 0), { ...extra, fail_reason: (feedback || 'no reply was produced').slice(0, 300) }, greeting);
  } else {
    await save(chosen.text, { ...extra, fail_reason: null }, true);
    // a question the notes could not answer is logged for the team, whether or not the model marked it
    const gap = chosen.gap || (uncovered.length && /\?|^(?:how|what|when|where|which|who|can|could|do|does|is|are|will|would)\b/i.test(latest) ? latest.replace(/\s+/g, ' ').trim().slice(0, 200) : null);
    if (gap) { try { await io.recordGap(lead.workspace, lead.id, gap); } catch { /* the team is not blocked by this */ } }
  }
  if (gotContact) { try { await io.notifyContact({ ...lead, name: profile.name || lead.name }, profile); } catch { /* the Leads page shows it anyway */ } }
}

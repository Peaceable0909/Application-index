// The thinking behind the new-student chat that does not need a model: what we know about a visitor, what to ask next, how to read
// short messages (greeting, "yes", "can I talk to someone"), and the checks every message the assistant writes must pass before it
// is shown. No imports, so it can be tested on its own.

export const FIELDS = ['name', 'email', 'phone', 'country', 'school', 'programme', 'level', 'qualifications', 'previousSchool', 'other'] as const;
export type Field = (typeof FIELDS)[number];
export type Profile = Partial<Record<Field, string>>;

export const FIELD_LABEL: Record<Field, string> = {
  name: 'Full name', email: 'Email', phone: 'Phone or WhatsApp', country: 'Country of study', school: 'Preferred school or university', programme: 'Programme or course',
  level: 'Study level', qualifications: 'Previous qualifications and grades', previousSchool: 'Previous school or university', other: 'Other details',
};

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
export const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';

/** Keeps only known fields with real text. */
export function cleanProfile(raw: unknown): Profile {
  const out: Profile = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const f of FIELDS) {
    const v = clip((raw as Record<string, unknown>)[f], f === 'qualifications' || f === 'other' ? 400 : 120);
    if (v && !/^(null|none|n\/a|unknown|not (?:stated|given|provided|mentioned)|undefined)$/i.test(v)) out[f] = v;
  }
  return out;
}

/** The new profile: anything newly learned replaces the old value. */
export const mergeProfile = (old: Profile, patch: Profile): Profile => ({ ...old, ...patch });

function levelRule(s: string): string | null {
  const t = s.toLowerCase();
  if (/top[\s-]?up/.test(t)) return 'Top-up';
  if (/pre[\s-]?master/.test(t)) return 'Pre-masters';
  if (/foundation/.test(t)) return 'Foundation';
  if (/(ph\.?d|doctora)/.test(t)) return 'Doctorate';
  if (/(post[\s-]?grad|master|msc|\bmba\b|\bma\b|pgd|pgce|llm)/.test(t)) return 'Postgraduate';
  if (/(under[\s-]?grad|bachelor|\bbsc\b|\bba\b|\bhnd\b|\bhnc\b|first degree|degree programme)/.test(t)) return 'Undergraduate';
  return null;
}
export const normLevel = (s: string): string => levelRule(s) ?? clip(s, 40);
/** The study level the visitor's own words point to ("MSc", "top-up", "bachelor"), if any. */
export const levelFromText = (visitorText: string): string | null => levelRule(visitorText);

/** Does what the model says the visitor told us really appear in what the visitor typed? Stops invented details. */
export function supported(value: string, visitorText: string, loose = false): boolean {
  const toks = (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}:.+-]*/gu) || []).filter((w) => w.length >= 2);
  if (!toks.length) return false;
  const hay = visitorText.toLowerCase();
  const hit = toks.filter((w) => hay.includes(w)).length;
  // free-text answers (grades, schools attended) may be tidied up by the model, so a quarter of the words is enough; short answers need half
  return hit >= Math.max(1, Math.ceil(toks.length * (loose ? 0.25 : 0.5)));
}

// ---------- reading short messages ----------
const GREET = /^(?:hi+|hello+|hey+|hiya|howdy|yo|sup|greetings|good\s+(?:morning|afternoon|evening|day)|salam|hola)(?:\s+(?:there|team|sir|madam|ma'?am|please|everyone|all|guys|whiterock))?[\s!.,?]*$/i;
export const isGreeting = (t: string) => GREET.test(t.trim());

const PERSON = /\b(?:speak|talk|chat|connect|put me|get me|transfer|link me|refer me)\b[^.!?]{0,30}\b(?:human|person|someone|somebody|counsel+(?:or|er)s?|advis[eo]rs?|agent|consultant|staff|team|representative|real)\b|\b(?:real|actual|live) (?:person|human|agent)\b|\b(?:call|phone|ring|whatsapp|email|text|contact) me\b|\b(?:i (?:want|need|would like|'d like|wish)|can i (?:get|have|see))\b[^.!?]{0,15}\b(?:counsel+(?:or|er)s?|human|person|advis[eo]rs?|agent)\b|\bwhen will (?:a |the )?(?:counsel+(?:or|er)s?|advis[eo]rs?|someone)\b/i;
/** The visitor is asking for a human. */
export const wantsPerson = (t: string) => PERSON.test(t);

const YES = /^(?:yes|yeah|yea|yep|yup|sure|ok(?:ay)?|please(?: do)?|go ahead|alright|all right|fine|definitely|of course|certainly|that would be (?:great|good|nice)|sounds good|do it|why not)\b/i;
export const isAffirmative = (t: string) => t.trim().split(/\s+/).length <= 8 && YES.test(t.trim());
export const isNegative = (t: string) => t.trim().split(/\s+/).length <= 8 && /^(?:no\b|nope|not now|not yet|maybe later|later|no thanks|no thank you|i(?:'m| am) fine|don'?t)/i.test(t.trim());

const OFFER = /\b(?:would you like|do you want|shall i|should i|want me to|happy to|i can|i could|can i)\b[^.!?]{0,90}\b(?:counsel+(?:or|er)s?|advis[eo]rs?|someone (?:from|on) (?:our|the) team|our team|a human|a person|specialists?)\b/i;
/** Did the assistant just offer to bring in a counsellor (so a short "yes" means yes)? */
export const offeredPerson = (assistantText: string) => /\?/.test(assistantText) && OFFER.test(assistantText);

const NAME_INTRO = /\b(?:my name is|my name'?s|name'?s|i am called|i'm called|call me|this is|it'?s)\s+([\p{L}][\p{L}'.-]*(?:\s+[\p{L}][\p{L}'.-]*){0,3})/iu;
const NOT_NAME = /^(?:not|looking|interested|from|a|an|the|planning|trying|thinking|hoping|here|just|so|very|sorry|new|currently|still|about|going|wanting|applying|ready|keen|also|really|already|unsure|confused|worried|stuck|asking|wondering|based|living|studying|working|in|on|at|for|to|with|and|but|or|if|how|what|when|where|why|who)$/i;
/** A name the visitor clearly stated ("my name is Chidi Okafor"), or a short reply right after we asked for it. */
export function nameFrom(text: string, previousAssistant: string): string | null {
  const t = text.trim();
  const m = NAME_INTRO.exec(t);
  const cand = m ? m[1] : /(?:your name|call you|who (?:am i|i am) (?:speaking|talking)|what should i call)/i.test(previousAssistant) && /^[\p{L}][\p{L}'.\- ]{1,38}$/u.test(t) && t.split(/\s+/).length <= 4 ? t : null;
  if (!cand) return null;
  const words = cand.replace(/[.,!?]+$/, '').split(/\s+/).filter((w) => !/^(?:and|but|i|im|i'm|am)$/i.test(w));
  const kept: string[] = [];
  for (const w of words) { if (NOT_NAME.test(w) || /^(?:yes|no|ok|okay|hello|hi|hey|thanks|please)$/i.test(w)) break; kept.push(w); }
  const name = kept.join(' ').trim();
  return name.length >= 2 && /^[\p{L}]/u.test(name) ? name.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : null;
}

// ---------- what to learn next ----------
export type AskCtx = { visitorTurns: number; wantsContact?: boolean; skip?: (Field | 'contact')[] };
/** The one thing it would be natural to ask next, or null. Their goal first, then their background, contact details last and only once the chat has substance. */
export function nextToLearn(p: Profile, ctx: AskCtx): Field | 'contact' | null {
  const order: Field[] = ['country', 'programme', 'level', 'qualifications', 'previousSchool', 'school'];
  const skip = new Set(ctx.skip || []);
  if (ctx.visitorTurns >= 2 && !p.name && !skip.has('name')) return 'name';
  for (const f of order) if (!p[f] && !skip.has(f)) return f;
  const haveContact = !!(p.email || p.phone);
  if (!haveContact && (ctx.wantsContact || ctx.visitorTurns >= 4) && !skip.has('contact')) return 'contact';
  if (!p.email && p.phone && ctx.visitorTurns >= 6 && !skip.has('email')) return 'email';
  if (!p.phone && p.email && ctx.visitorTurns >= 6 && !skip.has('phone')) return 'phone';
  return null;
}
export const missingFields = (p: Profile): Field[] => (['name', 'email', 'phone', 'country', 'school', 'programme', 'level', 'qualifications', 'previousSchool'] as Field[]).filter((f) => !p[f]);

/** Enough for a counsellor to act on: a name, a way to reach them, and what they want or asked. */
export const readyForHandover = (p: Profile, askedSomething: boolean) => !!p.name && !!(p.email || p.phone) && !!(p.country || p.programme || p.school || p.level || p.other || askedSomething);

/** Which of the pushier questions the assistant already put to the visitor in its last few messages (so it does not nag). */
export function recentlyAsked(assistantTexts: string[]): (Field | 'contact')[] {
  const out: (Field | 'contact')[] = [];
  const t = assistantTexts.slice(-3).join('\n');
  if (/\b(?:your (?:full )?name|call you|may i (?:have|know) your name)\b[^.!]*\?|\?[^.!?]*\bname\b/i.test(t)) out.push('name');
  if (/(?:e-?mail|whatsapp|phone number|contact number)[^.!?]*\?/i.test(t)) out.push('contact');
  return out;
}

// ---------- checks on what the assistant writes ----------
/** No em or en dashes, no emoji, no stray markers: plain full sentences. */
export function cleanReply(t: string): string {
  return t
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[ \t]+/g, ' ').replace(/ ,/g, ',').replace(/,\s*,/g, ',').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** The assistant may mark a question it could not answer with [[GAP: ...]]; the marker is removed before the visitor sees anything. */
export function splitGap(t: string): { text: string; gap: string | null } {
  const m = /\[\[\s*GAP\s*:\s*([^\]]{3,200})\]\]/i.exec(t);
  return { text: t.replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+$/g, '').trim(), gap: m ? m[1].trim() : null };
}

const RECIPIENT = /\b(?:counsel+(?:or|er)s?|advis[eo]rs?|(?:our|the|a) team|colleagues?|specialists?|admissions? (?:team|office|officers?)|someone (?:from|at|on) )\b/i;
const SEND_VERB = /\b(?:sent|send(?:ing)?|pass(?:ed|ing)?|forward(?:ed|ing)?|share[ds]?|sharing|submit(?:ted|ting)?|refer(?:red|ring)?|hand(?:ed|ing)?(?: over)?|escalat(?:ed|ing)|notif(?:ied|y|ying)|inform(?:ed|ing)|assign(?:ed|ing)|book(?:ed|ing)|schedul(?:ed|ing)|connect(?:ed|ing)|flag(?:ged|ging))\b/i;
const ACTION_CLAIMS: RegExp[] = [
  // "your message has been passed to the team", "details were sent to a counsellor"
  /\b(?:your|the)\s+(?:details|information|message|messages|enquiry|inquiry|chat|conversation|request|file|profile|case|documents?)\b[^.!?\n]{0,40}\b(?:has|have|had|is|are|was|were|will be)\s+(?:been\s+)?(?:sent|passed|forwarded|shared|submitted|referred|assigned|booked|noted|logged|recorded|received|flagged)\b/i,
  // a team member will do something
  /\b(?:counsel+(?:or|er)s?|advis[eo]rs?|(?:our|the) team|someone from [^.!?\n]{0,20}team)\b[^.!?\n]{0,50}\b(?:will|is going to|are going to|shall|'ll|has been|have been)\b[^.!?\n]{0,40}\b(?:contact|call|reach|email|message|reply|respond|get back|follow up|be in touch|review|assigned|help you personally)\b/i,
  /\b(?:you(?:'ve| have) been|you are now|you're now)\b[^.!?\n]{0,30}\b(?:connected|assigned|matched|registered|enrolled|booked|added|referred)\b/i,
];
const OFFER_VERB = /(?:\b(?:i|we)\s+(?:can|could|may|might|would|am (?:happy|glad|able) to|'d be (?:happy|glad) to)\s+(?:also\s+)?|\b(?:like|want) me to\s+|\bshall i\s+|\bshould i\s+)(?:\w+\s+){0,2}?(?:pass|send|share|forward|refer|connect|bring|hand|notify|inform|escalate|assign|book|schedule|flag)/i;
const CONDITIONAL = /^\s*(?:if|once|when|after)\b|\b(?:if you|once you|when you|after you)\b/i;
/** A sentence in which the assistant says it did, or someone will do, something the system has not done. Offers, questions and "if you ..." conditions are fine. Returns the sentence, or null. */
export function claimsAction(t: string): string | null {
  for (const s of t.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/)) {
    if (/\?\s*$/.test(s)) continue;                                  // a question cannot claim anything
    const first = /\b(?:i|we)\b/i.test(s) && SEND_VERB.test(s) && RECIPIENT.test(s) && !OFFER_VERB.test(s);
    if (first) return s.trim().slice(0, 140);                          // "I passed / I've sent / I'll forward ... to the team"
    if (ACTION_CLAIMS[0].test(s)) return s.trim().slice(0, 140);       // "your details have been sent to ..."
    if (ACTION_CLAIMS[1].test(s) && !CONDITIONAL.test(s)) return s.trim().slice(0, 140);   // "a counsellor will contact you"
    if (ACTION_CLAIMS[2].test(s)) return s.trim().slice(0, 140);       // "you have been assigned"
  }
  return null;
}

/** Promises about outcomes, which nobody can make. */
export function promisesOutcome(t: string): string | null {
  const re = /\b(?:guarantee[sd]?|i promise|100\s?%|definitely (?:get|receive|be (?:admitted|accepted|approved))|you (?:will|'ll) (?:definitely |certainly )?(?:get|receive|be given|be granted|be admitted|be accepted)|you (?:have been|are) (?:admitted|accepted|approved)|(?:offer|visa|admission|scholarship|place) (?:is|will be|has been) (?:guaranteed|approved|granted|secured)|no chance of (?:refusal|rejection)|certain(?:ly)? (?:to )?(?:be )?(?:approved|accepted|admitted))\b/i;
  return re.exec(t)?.[0] || null;
}

/** Money, percentages and years named in the reply must come from what we gave it or what the visitor said; otherwise they are invented. */
export function unsupportedFigures(reply: string, context: string): string | null {
  const ctx = context.replace(/,/g, '').toLowerCase();
  const found: string[] = [];
  const re = /(?:[£$€₦]\s?\d[\d,.]*\s?(?:k|m|million|thousand)?)|(?:\b\d[\d,.]*\s?(?:k\b|pounds|gbp|naira|ngn|usd|dollars|euros?|percent|%))|(?:\b(?:19|20)\d{2}\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply))) found.push(m[0]);
  for (const f of found) {
    const digits = f.replace(/[^\d.]/g, '').replace(/\.$/, '');
    if (digits && !ctx.includes(digits)) return f.trim();
  }
  return null;
}

/** Links, email addresses and phone numbers must never come from the model. */
export const hasContactOrLink = (t: string) => /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,}\d/.test(t);

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{3,}/g) || []));
/** Is this reply nearly the same as one the assistant already sent? */
export function repeatsEarlier(reply: string, earlier: string[]): boolean {
  const a = words(reply);
  if (a.size < 5) return false;
  return earlier.some((e) => { const b = words(e); if (b.size < 5) return false; let i = 0; a.forEach((w) => { if (b.has(w)) i++; }); return i / (a.size + b.size - i) > 0.75; });
}


// ---------- facts the assistant must not make up ----------
export type Topic = 'fees' | 'scholarships' | 'deadlines' | 'requirements' | 'visa' | 'accommodation' | 'work';
const TOPIC_WORDS: Record<Topic, RegExp> = {
  fees: /\b(?:fees?|tuition|costs?|price|how much|pay(?:ing|ment|ments)?|instal+ments?|deposit|afford)\b/i,
  scholarships: /\b(?:scholar\w*|bursar\w*|funding|funded|grants?|discounts?|financial aid)\b/i,
  deadlines: /\b(?:deadlines?|closing date|intakes?|start dates?|apply by|cut-?off|how long (?:does|will) (?:it|the) (?:take|process))\b/i,
  requirements: /\b(?:requirements?|eligib\w*|entry|ielts|toefl|pte|duolingo|english (?:test|language|proficiency)|minimum|gpa|cgpa|grades?|class of degree|2:1|2:2|qualif\w*|admission criteria)\b/i,
  visa: /\b(?:visa|cas|immigration|brp|ihs|tb test|refus\w*|proof of funds|bank statement|dependants?|dependents?)\b/i,
  accommodation: /\b(?:accommodation|housing|halls?|rent|where (?:to|will) (?:i )?live)\b/i,
  work: /\b(?:work rights|part[- ]time work|post[- ]study|graduate route|work (?:while|during)|jobs?)\b/i,
};
// what in the team's own notes counts as having an answer for a topic (a mere mention of the word is not enough)
const TOPIC_EVIDENCE: Record<Topic, RegExp> = {
  fees: /[£$€₦]\s?\d|\d[\d,]*\s?(?:pounds|gbp|naira|usd)\b/i,
  scholarships: /\b(?:scholarship|bursary)\b[^.\n]{0,120}\b(?:\d|available|offer|worth|eligible|apply)/i,
  deadlines: /\b(?:deadline|closing date|apply by|intake)\b[^.\n]{0,80}\b(?:\d{1,2}(?:st|nd|rd|th)?|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  requirements: /\b(?:ielts|toefl|pte|duolingo)\b[^.\n]{0,40}\d|\b(?:2:1|2:2|first class|second class|minimum grade|gpa|cgpa)\b|\bentry requirements?\b[^.\n]{0,80}\b(?:degree|grade|gpa|ielts|2:1|\d)/i,
  visa: /\b(?:visa|cas)\b[^.\n]{0,100}\b(?:require|need|apply|interview|document|fund|fee|\d)/i,
  accommodation: /\b(?:accommodation|halls?)\b[^.\n]{0,100}\b(?:\d|£|available|offer|book)/i,
  work: /\b(?:work rights|part[- ]time|graduate route)\b[^.\n]{0,100}\b(?:\d|allowed|hours|permit)/i,
};
export const ALL_TOPICS = Object.keys(TOPIC_WORDS) as Topic[];
export const topicsIn = (text: string): Topic[] => ALL_TOPICS.filter((t) => TOPIC_WORDS[t].test(text));
/** Topics the visitor raised that the knowledge text says nothing real about. */
export const uncoveredTopics = (visitorRecent: string, knowledge: string): Topic[] => topicsIn(visitorRecent).filter((t) => !TOPIC_EVIDENCE[t].test(knowledge));

const HEDGE = /\b(?:cannot|can't|can not|don't have|do not have|not able|unable|unsure|not sure|isn't in|is not in|no information|don't know|do not know|not something i can|cannot confirm|can't confirm|rather not guess|counsellor can|counsellor could|team can|would need to check|need to check)\b/i;
/** A sentence that states something about an uncovered topic as if it were known. Questions and honest "I cannot confirm" sentences are fine. Returns the sentence, or null. */
export function ungroundedTopicClaim(reply: string, uncovered: Topic[]): string | null {
  if (!uncovered.length) return null;
  const EMPATHY = /\b(?:sorry|understand|stressful|frustrating|difficult|hard|worr(?:y|ied|ying)|hear that|upsetting|disappointing|you mentioned|you said|you told me)\b/i;
  const YOURS = /\byour (?:\w+ ){0,2}(?:visa|refus\w*|fees?|budget|funding|scholarship|situation|plans?)\b/i;
  for (const s of reply.split(/(?<=[.!?])\s+|\n+/)) {
    if (/\?\s*$/.test(s) || HEDGE.test(s) || EMPATHY.test(s) || YOURS.test(s)) continue;   // questions, honest "cannot confirm", empathy and talk about their own situation are fine
    const hit = topicsIn(s).filter((t) => uncovered.includes(t));
    if (hit.length) return s.trim().slice(0, 140);
  }
  return null;
}

/** "usually", "typically", "most universities" about admissions subjects: general knowledge from memory, not from the team's notes. */
export function generalClaimFromMemory(reply: string): string | null {
  const general = /\b(?:usually|typically|generally|normally|commonly|often|tend to|in general|on average|most (?:universities|schools|students|programmes|courses)|(?:may|might|would|will|could) need (?:to|some|a)|(?:may|might|would|will|could) be (?:required|needed)|(?:may|might|could|would) (?:require|involve|call for|depend on)|are (?:limited|competitive)|is (?:limited|competitive))\b/i;
  const domain = /\b(?:degree|grade|ielts|english|deadline|intake|visa|tuition|fees?|cost|scholar\w*|requirement\w*|eligib\w*|accept\w*|admission|entry|gpa|cgpa|funding|bursar\w*|refus\w*)\b/i;
  // "I cannot say what is usually required" is honest; "we need to check, as they usually expect a degree" is still a claim from memory
  const negated = /\b(?:cannot|can't|can not|do not|don't|unable to|not able to|not sure|unsure|would rather not)\b[^.!?]{0,60}\b(?:usually|typically|generally|normally|required|requirements?|expect)\b/i;
  for (const s of reply.split(/(?<=[.!?])\s+|\n+/)) if (general.test(s) && domain.test(s) && !negated.test(s) && !/\?\s*$/.test(s)) return s.trim().slice(0, 140);
  return null;
}

/** Saying how good their grades or degree are: only the school can judge that. */
export function judgesQualification(reply: string): string | null {
  const good = '(?:strong|good|solid|excellent|impressive|great|competitive|weak|low|poor|decent|respectable)';
  const thing = '(?:foundation|grades?|degree|results?|class|background|qualifications?|profile|scores?|gpa|cgpa|transcript)';
  const re = new RegExp(`\\b${good}\\b[^.!?]{0,30}\\b${thing}\\b|\\b${thing}\\b[^.!?]{0,20}\\b(?:is|are|sounds?|looks?|seems?)\\b[^.!?]{0,15}\\b${good}\\b`, 'i');
  for (const s of reply.split(/(?<=[.!?])\s+|\n+/)) if (re.test(s) && !/\?\s*$/.test(s)) return s.trim().slice(0, 140);
  return null;
}

/** Praise and filler openers ("That's a great choice", "Great question") that make the chat sound scripted. */
export function fillerOpening(reply: string): string | null {
  return fillerMatch(reply)?.[0] ?? null;
}
/** The filler phrase at the start of a reply, with its length, so it can be cut out without losing the rest of the sentence. */
export function fillerMatch(reply: string): RegExpExecArray | null {
  const m = /^(?:that(?:'s| is)\s+(?:a\s+)?(?:really\s+)?(?:great|good|excellent|wonderful|fantastic|lovely|smart|solid)\b[^.!,]{0,30}|(?:great|excellent|wonderful|fantastic|lovely)\s+(?:choice|question|idea|decision|goal|start|plan|option)\b|(?:great|excellent|wonderful|fantastic|perfect|awesome)[!.,]|thank(?:s| you) for (?:sharing|asking|reaching out|letting me know|telling me|that|the (?:details|information|update)))/i.exec(reply.trim().replace(/[\u2018\u2019]/g, "'"));
  return m;
}

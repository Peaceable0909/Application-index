import { admin } from './supabase';
import { callScript } from './appsScript';
import { plainToSpec, renderEmail, site, type Block, type EmailSpec, type Sign } from './emailTemplate';
import { shownName } from './profile';

/** Who an email is "from" in the signature: the sender's portal profile, else their counselor record, else a readable name. */
export async function signFor(email: string | null | undefined, fallbackName?: string): Promise<Sign> {
  const e = (email || '').toLowerCase();
  const db = admin();
  const [{ data: p }, { data: c }] = await Promise.all([
    e ? db.from('portal_staff').select('email, display_name, title, phone, avatar_url').eq('email', e).maybeSingle() : Promise.resolve({ data: null }),
    e ? db.from('portal_counselors').select('name, email').eq('email', e).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (p) return { name: shownName(p), title: p.title || (c ? 'Admissions Counselor' : 'Admissions Team'), phone: p.phone, email: p.email, avatar: p.avatar_url };
  if (c) return { name: c.name, title: 'Admissions Counselor', email: c.email };
  return { name: fallbackName || 'WhiteRock Admissions', title: 'Admissions Team', email: e || null };
}

export type MailOpts = { to: string; subject: string; body: string; replyTo?: string; eyebrow?: string; title?: string; preheader?: string; blocks?: Block[]; greeting?: string; cta?: EmailSpec['cta']; sign?: Sign; footerNote?: string; from?: string };

/** Sends a designed HTML email with the plain-text version as the fallback. */
export async function sendMail(o: MailOpts) {
  const derived = plainToSpec(o.body);
  const sign = o.sign ?? (await signFor(o.from || o.replyTo));
  const html = renderEmail({
    preheader: o.preheader || o.body.replace(/\s+/g, ' ').slice(0, 110),
    eyebrow: o.eyebrow ?? 'Admissions update', title: o.title, greeting: o.greeting ?? derived.greeting,
    blocks: o.blocks ?? derived.blocks, cta: o.cta, sign, footerNote: o.footerNote,
  });
  const text = `${o.body}\n\n—\n${sign.name}${sign.title ? `, ${sign.title}` : ''}\nWhiteRock Admissions · ${site()}`;
  return callScript('sendEmail', { to: o.to, subject: o.subject, body: text, htmlBody: html, replyTo: o.replyTo || '' });
}

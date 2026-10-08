// Branded HTML emails: a 600px table layout with inline styles (works in Gmail, Outlook, Apple Mail and on phones).
const NAVY = '#0d1f4d', BLUE = '#2458d6', GOLD = '#b8952a', GOLD_L = '#e2c566', TEXT = '#334155', MUTED = '#64748b', LINE = '#e5e9f2', PAPER = '#f6f8fc', BG = '#eef1f8';
const SERIF = "Georgia,'Times New Roman',serif", SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export const site = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://applications-2026-kohl.vercel.app').replace(/\/$/, '');
/** Where students are sent. Set STUDENT_SITE_URL (e.g. https://student.yourdomain.com) to give them their own address. */
export const studentSite = () => (process.env.STUDENT_SITE_URL || site()).replace(/\/$/, '');
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');
const linkify = (html: string) => html.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${BLUE};text-decoration:underline">${u}</a>`);

export type Block =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'checklist'; title: string; items: string[]; received?: number; total?: number; tone?: 'warn' | 'ok' }
  | { type: 'students'; title?: string; rows: { name: string; meta?: string; status?: string; needs?: string }[] }
  | { type: 'note'; text: string }
  | { type: 'code'; code: string; note?: string }
  | { type: 'quote'; from: string; text: string }
  | { type: 'steps'; title?: string; items: string[] };
export type Sign = { name: string; title?: string | null; phone?: string | null; email?: string | null; avatar?: string | null };
export type EmailSpec = { preheader?: string; eyebrow?: string; title?: string; greeting?: string; blocks: Block[]; cta?: { label: string; href: string }; sign?: Sign; footerNote?: string };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'P';

function block(b: Block): string {
  switch (b.type) {
    case 'p': return `<p style="margin:0 0 16px;font:400 15.5px/1.7 ${SANS};color:${TEXT}">${linkify(nl2br(b.text))}</p>`;
    case 'note': return `<p style="margin:0 0 16px;font:400 13.5px/1.6 ${SANS};color:${MUTED}">${linkify(nl2br(b.text))}</p>`;
    case 'list': return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;width:100%">${b.items.map((i) => `<tr><td valign="top" style="width:22px;padding:3px 0;font:700 15px/1.6 ${SANS};color:${GOLD}">•</td><td style="padding:3px 0;font:400 15.5px/1.6 ${SANS};color:${TEXT}">${linkify(esc(i))}</td></tr>`).join('')}</table>`;
    case 'checklist': {
      const warn = (b.tone || 'warn') === 'warn', accent = warn ? '#d97706' : '#16a34a', soft = warn ? '#fff8ec' : '#effaf3', edge = warn ? '#fde7bd' : '#c9ecd5';
      const bar = b.total ? (() => { const pct = Math.max(0, Math.min(100, Math.round(((b.received ?? 0) / b.total) * 100)));
        return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px"><tr><td style="font:600 12.5px ${SANS};color:${MUTED};padding:0 0 6px">${b.received ?? 0} of ${b.total} received</td></tr><tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${edge};border-radius:99px"><tr><td width="${pct}%" style="background:${accent};border-radius:99px;height:8px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr></table>`; })() : '';
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px"><tr><td style="background:${soft};border:1px solid ${edge};border-left:4px solid ${accent};border-radius:12px;padding:18px 20px">
        <div style="font:700 11.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${accent};margin:0 0 12px">${esc(b.title)}</div>${bar}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${b.items.map((i) => `<tr><td valign="middle" style="width:30px;padding:5px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="20" height="20" align="center" style="width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid ${accent};font:700 11px/16px ${SANS};color:${accent}">${warn ? '!' : '✓'}</td></tr></table></td><td valign="middle" style="padding:5px 0;font:600 15.5px/1.5 ${SANS};color:${NAVY}">${esc(i)}</td></tr>`).join('')}</table></td></tr></table>`;
    }
    case 'code': return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 22px"><tr><td align="center" style="background:${PAPER};border:1px solid ${LINE};border-radius:14px;padding:26px 16px"><div style="font:700 11.5px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-bottom:10px">Your sign-in code</div><div style="font:700 34px/1.1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:6px;color:${NAVY};padding-left:6px;word-break:keep-all">${esc(b.code)}</div>${b.note ? `<div style="font:400 13px ${SANS};color:${MUTED};margin-top:12px">${esc(b.note)}</div>` : ''}</td></tr></table>`;
    case 'quote': return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px"><tr><td style="background:#f3f7ff;border-left:4px solid ${BLUE};border-radius:10px;padding:16px 18px"><div style="font:700 12px ${SANS};color:${BLUE};margin-bottom:6px">${esc(b.from)}</div><div style="font:400 15.5px/1.7 ${SANS};color:${NAVY}">${nl2br(b.text)}</div></td></tr></table>`;
    case 'steps': return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px">${b.title ? `<tr><td colspan="2" style="padding:0 0 8px;font:700 11.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">${esc(b.title)}</td></tr>` : ''}${b.items.map((i, n) => `<tr><td valign="top" style="width:34px;padding:6px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="24" height="24" align="center" style="width:24px;height:24px;border-radius:50%;background:${NAVY};color:${GOLD_L};font:700 12px/24px ${SANS}">${n + 1}</td></tr></table></td><td valign="middle" style="padding:6px 0;font:400 15.5px/1.55 ${SANS};color:${TEXT}">${esc(i)}</td></tr>`).join('')}</table>`;
    case 'students': return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px;border:1px solid ${LINE};border-radius:12px;overflow:hidden">
      ${b.title ? `<tr><td colspan="2" style="background:${PAPER};padding:11px 16px;border-bottom:1px solid ${LINE};font:700 11.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">${esc(b.title)}</td></tr>` : ''}
      ${b.rows.map((r, i) => `<tr><td valign="top" style="padding:13px 16px;${i ? `border-top:1px solid ${LINE};` : ''}">
        <div style="font:650 15px/1.4 ${SANS};color:${NAVY}">${esc(r.name)}</div>${r.meta ? `<div style="font:400 12.5px/1.5 ${SANS};color:${MUTED}">${esc(r.meta)}</div>` : ''}${r.needs ? `<div style="font:500 13px/1.5 ${SANS};color:#b91c1c;margin-top:4px">${esc(r.needs)}</div>` : ''}</td>
        <td valign="top" align="right" style="padding:13px 16px;${i ? `border-top:1px solid ${LINE};` : ''}white-space:nowrap">${r.status ? `<span style="display:inline-block;background:#e8eefc;color:${BLUE};border-radius:99px;padding:3px 11px;font:650 12px ${SANS}">${esc(r.status)}</span>` : ''}</td></tr>`).join('')}
    </table>`;
  }
}

export function renderEmail(s: EmailSpec): string {
  const logo = `${site()}/api/email/logo`, year = new Date().getFullYear();
  const sign = s.sign;
  const signHtml = sign ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;border-top:1px solid ${LINE};padding-top:12px;width:100%"><tr>
      <td valign="top" style="width:60px;padding:20px 16px 0 0">${sign.avatar
        ? `<img src="${esc(sign.avatar)}" width="48" height="48" alt="" style="display:block;border-radius:50%;object-fit:cover;width:48px;height:48px">`
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="48" height="48" align="center" style="width:48px;height:48px;border-radius:50%;background:${NAVY};color:${GOLD_L};font:700 16px/48px ${SANS}">${esc(initials(sign.name))}</td></tr></table>`}</td>
      <td valign="top" style="padding-top:20px"><div style="font:700 15.5px/1.4 ${SANS};color:${NAVY}">${esc(sign.name)}</div>
        <div style="font:400 13.5px/1.5 ${SANS};color:${MUTED}">${esc(sign.title || 'Admissions Counselor')} · WhiteRock Admissions</div>
        <div style="font:400 13.5px/1.7 ${SANS};margin-top:6px">${sign.email ? `<a href="mailto:${esc(sign.email)}" style="color:${BLUE};text-decoration:none">${esc(sign.email)}</a>` : ''}${sign.phone ? ` &nbsp;·&nbsp; <a href="tel:${esc(sign.phone)}" style="color:${BLUE};text-decoration:none">${esc(sign.phone)}</a>` : ''}</div></td></tr></table>` : '';
  const cta = s.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px"><tr><td align="center" bgcolor="${NAVY}" style="border-radius:12px;background:${NAVY}"><a href="${esc(s.cta.href)}" style="display:inline-block;padding:15px 30px;font:700 15px ${SANS};color:#ffffff;text-decoration:none;border-radius:12px;border-bottom:3px solid ${GOLD}">${esc(s.cta.label)} &nbsp;→</a></td></tr></table>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(s.title || 'WhiteRock Admissions')}</title>
<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}.h1{font-size:25px!important}}a{word-break:break-word}</style></head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(s.preheader || '')}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BG}" style="background:${BG}"><tr><td align="center" style="padding:28px 12px 36px">
  <table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px">
    <tr><td style="background:${NAVY};background-image:linear-gradient(135deg,#0a1840 0%,#1b3f8f 100%);border-radius:18px 18px 0 0;padding:20px 32px" class="px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="padding-right:12px"><img src="${logo}" width="42" height="42" alt="W" style="display:block;border-radius:11px;border:0"></td>
          <td valign="middle"><div style="font:400 22px/1.1 ${SERIF};color:#ffffff;letter-spacing:.2px">WhiteRock <span style="font-style:italic;color:${GOLD_L}">Admissions</span></div></td></tr></table></td>
        <td valign="middle" align="right" style="font:700 10.5px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${GOLD_L}">${esc(s.eyebrow || '')}</td></tr></table>
    </td></tr>
    <tr><td style="background:${GOLD};height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td class="px" style="background:#ffffff;padding:30px 36px 26px;border-left:1px solid ${LINE};border-right:1px solid ${LINE}">
      ${s.title ? `<h1 class="h1" style="margin:0 0 16px;font:400 25px/1.25 ${SERIF};color:${NAVY};letter-spacing:-.2px">${esc(s.title)}</h1>` : ''}
      ${s.greeting ? `<p style="margin:0 0 16px;font:650 16px/1.6 ${SANS};color:${NAVY}">${esc(s.greeting)}</p>` : ''}
      ${s.blocks.map(block).join('\n')}
      ${cta}
      ${signHtml}
    </td></tr>
    <tr><td class="px" style="background:${PAPER};border:1px solid ${LINE};border-top:0;border-radius:0 0 18px 18px;padding:16px 36px;text-align:center">
      <div style="font:400 12.5px/1.6 ${SANS};color:${MUTED}">${esc(s.footerNote || 'Reply to this email to reach us directly.')}</div>
      <div style="font:400 12px/1.6 ${SANS};color:#94a3b8;margin-top:4px">© ${year} WhiteRock Admissions · <a href="${site()}" style="color:#94a3b8;text-decoration:underline">${esc(site().replace(/^https?:\/\//, ''))}</a></div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** Turns a plain-text message (what staff type or the AI drafts) into blocks: greeting, paragraphs, bullet lists. The closing/sign-off is dropped, since the signature block replaces it. */
export function plainToSpec(body: string): { greeting?: string; blocks: Block[] } {
  const paras = body.replace(/\r/g, '').trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let greeting: string | undefined;
  if (paras.length && /^(hi|hello|hey|dear)\b[^\n]{0,60}[,!]?$/i.test(paras[0])) greeting = paras.shift()!.replace(/,?\s*$/, ',');
  while (paras.length) {
    const last = paras[paras.length - 1];
    if (/^(best regards|kind regards|warm regards|regards|best wishes|thanks|thank you|many thanks|best|cheers|sincerely|yours sincerely)[,!.]?(\n|$)/i.test(last) && last.split('\n').length <= 4) paras.pop(); else break;
  }
  const blocks: Block[] = [];
  for (const p of paras) {
    const lines = p.split('\n');
    const bullets = lines.filter((l) => /^\s*([•\-*]|\d+[.)])\s+/.test(l));
    if (bullets.length && bullets.length === lines.length) blocks.push({ type: 'list', items: lines.map((l) => l.replace(/^\s*([•\-*]|\d+[.)])\s+/, '')) });
    else if (bullets.length) {
      const head = lines.filter((l) => !/^\s*([•\-*]|\d+[.)])\s+/.test(l)).join('\n');
      if (head) blocks.push({ type: 'p', text: head });
      blocks.push({ type: 'list', items: bullets.map((l) => l.replace(/^\s*([•\-*]|\d+[.)])\s+/, '')) });
    } else blocks.push({ type: 'p', text: p });
  }
  return { greeting, blocks };
}

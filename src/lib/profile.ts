export const COLORS: Record<string, { label: string; from: string; to: string }> = {
  navy: { label: 'Navy', from: '#0f2a63', to: '#2b5fb8' },
  ocean: { label: 'Ocean', from: '#0b6e99', to: '#37b7d8' },
  forest: { label: 'Forest', from: '#14532d', to: '#3fa76a' },
  violet: { label: 'Violet', from: '#4c1d95', to: '#8b5cf6' },
  rose: { label: 'Rose', from: '#9f1239', to: '#f0658a' },
  amber: { label: 'Amber', from: '#9a5b00', to: '#f2b13a' },
  slate: { label: 'Slate', from: '#1e293b', to: '#64748b' },
};
export const gradient = (c?: string | null) => { const k = COLORS[c || ''] || COLORS.navy; return `linear-gradient(135deg, ${k.from}, ${k.to})`; };

type P = { email: string; display_name?: string | null };
const fromEmail = (email: string) => { const l = email.split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim().split(' ')[0] || 'Admin'; return l[0].toUpperCase() + l.slice(1).toLowerCase(); };
/** Chosen name, falling back to something readable from the email. */
export const shownName = (p: P) => (p.display_name || '').trim() || fromEmail(p.email);
export const firstWord = (p: P) => shownName(p).split(/\s+/)[0];
export const roleLabel = (r: string) => (r === 'admin' ? 'Admin' : r === 'counselor' ? 'Counselor' : 'Staff');
export const inits = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

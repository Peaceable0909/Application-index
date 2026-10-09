// Built-in sticker pack. A sticker is sent as an ordinary message whose text is "[[sticker:id]]", so it needs no storage of its own.
export type Sticker = { id: string; emoji: string; label: string; a: string; b: string; tilt: number };
export const STICKERS: Sticker[] = [
  { id: 'thank-you', emoji: '🙏', label: 'Thank you!', a: '#34d399', b: '#059669', tilt: -3 },
  { id: 'got-it', emoji: '👍', label: 'Got it!', a: '#60a5fa', b: '#2563eb', tilt: 2 },
  { id: 'on-it', emoji: '💪', label: 'On it!', a: '#fbbf24', b: '#d97706', tilt: -2 },
  { id: 'yes', emoji: '✅', label: 'Yes!', a: '#4ade80', b: '#16a34a', tilt: 3 },
  { id: 'no-worries', emoji: '😌', label: 'No worries', a: '#a78bfa', b: '#7c3aed', tilt: -3 },
  { id: 'congrats', emoji: '🎉', label: 'Congrats!', a: '#f472b6', b: '#db2777', tilt: 2 },
  { id: 'sorry', emoji: '🥺', label: 'Sorry!', a: '#fda4af', b: '#e11d48', tilt: -2 },
  { id: 'please', emoji: '🤲', label: 'Please', a: '#fdba74', b: '#ea580c', tilt: 3 },
  { id: 'waiting', emoji: '⏳', label: 'Waiting…', a: '#94a3b8', b: '#475569', tilt: -2 },
  { id: 'great', emoji: '🌟', label: 'Great job!', a: '#fde047', b: '#ca8a04', tilt: 2 },
  { id: 'love', emoji: '❤️', label: 'Love it', a: '#fb7185', b: '#be123c', tilt: -3 },
  { id: 'ok', emoji: '👌', label: 'OK', a: '#5eead4', b: '#0d9488', tilt: 3 },
  { id: 'question', emoji: '🤔', label: 'Question?', a: '#93c5fd', b: '#4f46e5', tilt: -2 },
  { id: 'done', emoji: '🏁', label: 'Done!', a: '#86efac', b: '#15803d', tilt: 2 },
  { id: 'welcome', emoji: '👋', label: 'Welcome!', a: '#67e8f9', b: '#0891b2', tilt: -3 },
  { id: 'good-luck', emoji: '🍀', label: 'Good luck!', a: '#bef264', b: '#4d7c0f', tilt: 3 },
  { id: 'docs', emoji: '📄', label: 'Docs sent', a: '#bfdbfe', b: '#3b82f6', tilt: -2 },
  { id: 'call-me', emoji: '📞', label: 'Call me', a: '#c4b5fd', b: '#6d28d9', tilt: 2 },
  { id: 'visa', emoji: '🛂', label: 'Visa time', a: '#7dd3fc', b: '#0369a1', tilt: -3 },
  { id: 'offer', emoji: '🎓', label: 'Offer in!', a: '#f9a8d4', b: '#a21caf', tilt: 3 },
  { id: 'lol', emoji: '😂', label: 'LOL', a: '#fcd34d', b: '#f59e0b', tilt: -2 },
  { id: 'wow', emoji: '😮', label: 'Wow!', a: '#fdba74', b: '#c2410c', tilt: 2 },
  { id: 'good-morning', emoji: '☀️', label: 'Good morning', a: '#fde68a', b: '#f59e0b', tilt: -3 },
  { id: 'good-night', emoji: '🌙', label: 'Good night', a: '#818cf8', b: '#3730a3', tilt: 3 },
  { id: 'on-the-way', emoji: '✈️', label: 'On the way', a: '#a5b4fc', b: '#4338ca', tilt: -2 },
  { id: 'study', emoji: '📚', label: 'Study mode', a: '#fca5a5', b: '#b91c1c', tilt: 2 },
];
export const stickerToken = (id: string) => `[[sticker:${id}]]`;
const RE = /^\[\[sticker:([a-z0-9-]{1,30})\]\]$/;
/** The sticker a message is, if the whole message is one. */
export const parseSticker = (body: string | null | undefined): Sticker | null => { const m = RE.exec((body || '').trim()); return m ? STICKERS.find((s) => s.id === m[1]) || null : null; };
/** Readable text for places that can't draw a sticker (alerts, emails, chat list, reply quotes). */
export const plainBody = (body: string): string => { const s = parseSticker(body); return s ? `${s.emoji} Sticker: ${s.label}` : body; };

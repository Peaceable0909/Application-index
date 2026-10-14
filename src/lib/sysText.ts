// Text the app writes into chats itself ("Photo", "Voice call · 2:31"). Older rows were saved with a leading emoji, so
// anything that shows them runs them through these helpers and the icon is drawn as an SVG instead.
const SYS_LEAD = /^(?:[\u{1F4F7}\u{1F3A4}\u{1F4CE}\u{1F642}\u{1F464}\u{1F4DE}\u{1F4F9}]️?\s*)+/u;
const CALL_LINE = /^(?:[\u{1F4F9}\u{1F4DE}]️?\s*)?(Missed (?:voice|video) call|(?:Voice|Video) call(?: declined| · \d+:\d{2}))$/u;

/** A message preview without the old emoji prefix (a camera emoji before "Photo" is dropped, leaving "Photo"). */
export const plainPreview = (s: string | null | undefined) => (s || '').replace(SYS_LEAD, '');

/** If a chat line is the call log the app writes ("Voice call · 2:31", "Missed video call"), say what it is so it can be drawn with an icon. */
export function parseCallLine(body: string | null | undefined): { text: string; video: boolean; missed: boolean } | null {
  const m = CALL_LINE.exec((body || '').trim());
  if (!m) return null;
  return { text: m[1], video: /video/i.test(m[1]), missed: /^Missed|declined$/.test(m[1]) };
}

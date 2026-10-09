import type { Sticker as S } from '@/lib/stickers';

/** A die-cut style sticker: big emoji on a glossy badge with a tilted caption ribbon and a white outline. */
export default function Sticker({ s, size = 'md' }: { s: S; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`stk stk-${size}`} style={{ '--a': s.a, '--b': s.b, '--tilt': `${s.tilt}deg` } as React.CSSProperties} role="img" aria-label={`Sticker: ${s.label}`}>
      <span className="face"><span className="gloss" /><span className="em" aria-hidden>{s.emoji}</span></span>
      <span className="cap">{s.label}</span>
    </span>
  );
}

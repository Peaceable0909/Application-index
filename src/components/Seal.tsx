import type { BadgeLite } from '@/lib/staffBadges';
import { badgeSpeech } from '@/lib/staffBadges';

/** A wavy-edged seal drawn once: 10 gentle lobes around a circle. */
const SEAL = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 90; i++) { const t = (i / 90) * Math.PI * 2, r = 10.3 * (1 + 0.065 * Math.cos(10 * t)); pts.push(`${(12 + r * Math.cos(t)).toFixed(2)} ${(12 + r * Math.sin(t)).toFixed(2)}`); }
  return `M${pts.join('L')}Z`;
})();

/**
 * One badge: a small seal in the colour the admin chose, with a tick. Pointing at it (or focusing it, or tapping it) shows the name and the
 * meaning the admin wrote (BadgeTips draws that). It says nothing else: not "verified", not "official", only the admin's own words.
 */
export default function Seal({ b, size = 16, quiet = false, plain = false }: { b: BadgeLite; size?: number; quiet?: boolean; plain?: boolean }) {
  // plain = just the picture (colour swatches on the admin page): no tooltip, hidden from screen readers
  if (plain) return <span className={`vseal vs-${b.color}`} style={{ width: size, height: size }} aria-hidden><svg viewBox="0 0 24 24" width={size} height={size} focusable="false"><path className="vs-body" d={SEAL} /><path className="vs-tick" d="M7.7 12.4l3 3 5.7-6.3" /></svg></span>;
  return (
    <span className={`vseal vs-${b.color}`} style={{ width: size, height: size }} data-bdg={b.id} data-name={b.name} data-desc={b.description} role="img" aria-label={badgeSpeech(b)} tabIndex={quiet ? undefined : 0}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
        <path className="vs-body" d={SEAL} />
        <path className="vs-tick" d="M7.7 12.4l3 3 5.7-6.3" />
      </svg>
    </span>
  );
}

/** The staff badges that sit beside a name. `max` keeps a crowded spot tidy ("+2"). Renders nothing when there are none. */
export function Seals({ list, size = 16, max = 4, quiet = false }: { list?: BadgeLite[] | null; size?: number; max?: number; quiet?: boolean }) {
  if (!list?.length) return null;
  const shown = list.slice(0, max), rest = list.slice(max);
  return (
    <span className="vseals">
      {shown.map((b) => <Seal key={b.id} b={b} size={size} quiet={quiet} />)}
      {rest.length > 0 && <span className="vmore" data-bdg="more" data-name={`${rest.length} more`} data-desc={rest.map((b) => b.name).join(', ')} tabIndex={quiet ? undefined : 0} role="img" aria-label={`${rest.length} more: ${rest.map((b) => b.name).join(', ')}`}>+{rest.length}</span>}
    </span>
  );
}

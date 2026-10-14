import type { Badge } from '@/lib/badges';

/** A swipeable row of collectible medals. Unlocked ones are colourful and pop in; locked ones wait in grey. */
export default function Milestones({ badges }: { badges: Badge[] }) {
  const n = badges.filter((b) => b.on).length;
  return (
    <section className="st-card st-ms-card">
      <div className="st-ms-h"><h2>Your milestones</h2><span className="st-sub" style={{ margin: 0 }}>{n} of {badges.length}</span></div>
      <div className="st-medals" role="list">
        {badges.map((b, i) => (
          <div key={b.key} role="listitem" className={`st-medal ${b.on ? 'on' : 'off'}`} style={{ ['--k' as string]: i, ['--h1' as string]: b.hue[0], ['--h2' as string]: b.hue[1] }} title={b.hint}>
            <span className="m"><span className="e">{b.on ? b.emoji : '🔒'}</span></span>
            <b>{b.label}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

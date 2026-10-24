import Link from 'next/link';
import Icon from '../Icon';
import { smoothPath } from '@/lib/vizLayout';
import { prettyDay, type Viz } from '@/lib/vizData';

/** A line over the weeks of the period: the shape of the intake at a glance. The latest week gets the dot. */
function Spark({ values }: { values: number[] }) {
  const W = 320, H = 64, P = 6, max = Math.max(1, ...values);
  const pts: [number, number][] = values.map((v, i) => [P + (values.length > 1 ? (i / (values.length - 1)) * (W - 2 * P) : (W - 2 * P) / 2), H - P - (v / max) * (H - 2 * P)]);
  if (pts.length < 2) return null;
  const line = smoothPath(pts), last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rv-spark" role="img" aria-label={`Applications each week: ${values.join(', ')}`} preserveAspectRatio="none">
      <path d={`${line} L${last[0]},${H} L${pts[0][0]},${H} Z`} className="rv-spark-a" />
      <path d={line} className="rv-spark-l" />
      <circle cx={last[0]} cy={last[1]} r={4.5} className="rv-spark-d" />
    </svg>
  );
}

export function Delta({ delta, prev, days }: { delta: number | null; prev: number; days: number }) {
  if (delta === null) return <span className="rv-delta flat"><Icon n="clock" size={13} /> Too few before this to compare ({prev})</span>;
  const up = delta >= 0;
  return <span className={`rv-delta ${up ? 'up' : 'down'}`}><Icon n={up ? 'up' : 'down'} size={13} /> {up ? '+' : ''}{delta}% <em>vs the {days} days before ({prev})</em></span>;
}

const INSIGHT_ICON: Record<string, string> = { trend: 'trend', clock: 'clock', spark: 'spark', graduation: 'graduation', 'check-circle': 'check-circle', alert: 'alert', globe: 'globe' };

/** The top of the page: one big number, the story in a few sentences, and the numbers that matter most. */
export default function Hero({ viz }: { viz: Viz }) {
  return (
    <section className="rv-hero" aria-label="Summary">
      <div className="rv-hero-main">
        <span className="rv-eyebrow">Applications started</span>
        <div className="rv-big">{viz.hero.value.toLocaleString('en-GB')}</div>
        <Delta delta={viz.hero.delta} prev={viz.hero.prev} days={viz.days} />
        <Spark values={viz.hero.spark} />
        <span className="rv-range">{prettyDay(viz.range.from)} to {prettyDay(viz.range.to)} · {viz.days} days</span>
      </div>
      <div className="rv-story">
        <span className="rv-eyebrow">What stands out</span>
        <ul>
          {viz.insights.map((i, k) => {
            const body = <><span className={`rv-ico t-${i.tone}`}><Icon n={INSIGHT_ICON[i.icon] || 'spark'} size={15} /></span><span>{i.text}</span>{i.href && <Icon n="right" size={14} />}</>;
            return <li key={k}>{i.href ? <Link href={i.href} className="rv-ins link">{body}</Link> : <div className="rv-ins">{body}</div>}</li>;
          })}
        </ul>
      </div>
      <div className="rv-tiles">
        {viz.tiles.map((t) => {
          const inner = <><span className="rv-tl">{t.label}</span><b className={`rv-tv t-${t.tone || 'none'}`}>{t.value.toLocaleString('en-GB')}</b>{t.sub && <small>{t.sub}</small>}</>;
          return t.href ? <Link key={t.key} href={t.href} className="rv-tile link">{inner}</Link> : <div key={t.key} className="rv-tile">{inner}</div>;
        })}
      </div>
    </section>
  );
}

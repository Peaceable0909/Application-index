'use client';
import { useEffect, useRef, useState } from 'react';
import { Empty, Legend, Tip, useTip, VizCard, plural } from './VizKit';
import { niceTicks, compact } from '@/lib/vizLayout';
import { prettyDay, WEEKDAYS, type Calendar, type Weekly } from '@/lib/vizData';

const SERIES = ['var(--ph-other)', 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];   // slot 0 is the grey "Other"
const LEFT = 34, TOP = 20;
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A path with only the top corners rounded (the data end of a column; the baseline stays square). */
const roundTop = (x: number, y: number, w: number, h: number, r: number) => { const q = Math.min(r, h, w / 2); return `M${x},${y + h} L${x},${y + q} Q${x},${y} ${x + q},${y} L${x + w - q},${y} Q${x + w},${y} ${x + w},${y + q} L${x + w},${y + h} Z`; };

function CalendarHeat({ cal }: { cal: Calendar }) {
  const { host, tip, on } = useTip();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [cal.weeks.length]);   // newest weeks first in view on a phone
  // fewer weeks means bigger squares, up to a comfortable size; a long period gets small ones and scrolls on a phone
  const PITCH = Math.max(16, Math.min(28, Math.floor(880 / Math.max(1, cal.weeks.length)))), CELL = PITCH - 4;
  const w = LEFT + cal.weeks.length * PITCH, h = TOP + 7 * PITCH;
  const level = (n: number) => (n <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil((n / Math.max(1, cal.max)) * 5))));
  const avg = cal.total / Math.max(1, cal.weeks.reduce((s, wk) => s + wk.cells.filter(Boolean).length, 0));
  const quietest = cal.weekday.reduce((b, n, i) => (n < cal.weekday[b] ? i : b), 0), busiest = cal.weekday.reduce((b, n, i) => (n > cal.weekday[b] ? i : b), 0);
  const wmax = Math.max(1, ...cal.weekday);
  return (
    <div className="rv-plot" ref={host}>
      <div className="rv-scroll" ref={scroller}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Applications per day: ${plural(cal.total, 'application')}, busiest day ${cal.busiest ? prettyDay(cal.busiest.day) : 'none'}`} className="rv-cal">
          {cal.months.map((m) => <text key={m.week} x={LEFT + m.week * PITCH} y={11} className="rv-ax">{m.label}</text>)}
          {[0, 2, 4].map((i) => <text key={i} x={LEFT - 8} y={TOP + i * PITCH + CELL - 3} textAnchor="end" className="rv-ax">{SHORT[i]}</text>)}
          {cal.weeks.map((wk, ci) => wk.cells.map((c, ri) => c && (
            <rect key={c.day} x={LEFT + ci * PITCH} y={TOP + ri * PITCH} width={CELL} height={CELL} rx={3.5} className={`rv-cell l${level(c.n)}`}
              {...on({ title: prettyDay(c.day), rows: [{ value: String(c.n), label: c.n === 1 ? 'application' : 'applications' }] })} />
          )))}
        </svg>
      </div>
      <Tip tip={tip} />
      <p className="rv-hint">Swipe sideways to see more weeks.</p>
      <div className="rv-scale" aria-hidden><span>Fewer</span>{[0, 1, 2, 3, 4, 5].map((l) => <i key={l} className={`rv-cell l${l}`} />)}<span>More</span><em>Up to {cal.max} in a day</em></div>
      <div className="rv-split">
        <div>
          <p className="rv-mini">By weekday</p>
          <svg viewBox="0 0 252 104" className="rv-wk" role="img" aria-label={`Applications by weekday. Busiest: ${WEEKDAYS[busiest]}`}>
            {cal.weekday.map((n, i) => { const bh = Math.max(n ? 3 : 0, (n / wmax) * 54), x = 8 + i * 34; return (
              <g key={i}>
                <path d={roundTop(x, 80 - bh, 22, bh, 4)} className={i === busiest && n > 0 ? 'rv-hot' : 'rv-dim'} />
                <rect x={x - 6} y={0} width={34} height={104} fill="transparent" {...on({ title: WEEKDAYS[i], rows: [{ value: String(n), label: n === 1 ? 'application' : 'applications' }] })} tabIndex={0} aria-label={`${WEEKDAYS[i]}: ${n}`} />
                {i === busiest && n > 0 && <text x={x + 11} y={80 - bh - 6} textAnchor="middle" className="rv-lbl">{n}</text>}
                <text x={x + 11} y={98} textAnchor="middle" className="rv-ax">{SHORT[i]}</text>
              </g>); })}
          </svg>
        </div>
        <dl className="rv-facts">
          <div><dt>Busiest day</dt><dd>{cal.busiest ? prettyDay(cal.busiest.day) : '—'}<em>{cal.busiest ? plural(cal.busiest.n, 'application') : ''}</em></dd></div>
          <div><dt>Busiest weekday</dt><dd>{cal.total ? `${WEEKDAYS[busiest]}s` : '—'}<em>{cal.total ? `${Math.round((cal.weekday[busiest] / cal.total) * 100)}% of the total` : ''}</em></dd></div>
          <div><dt>Quietest weekday</dt><dd>{cal.total ? `${WEEKDAYS[quietest]}s` : '—'}<em>{cal.total ? `${Math.round((cal.weekday[quietest] / cal.total) * 100)}% of the total` : ''}</em></dd></div>
          <div><dt>Average a day</dt><dd>{avg.toFixed(1)}<em>across the whole period</em></dd></div>
        </dl>
      </div>
    </div>
  );
}

function WeeklyColumns({ weekly }: { weekly: Weekly }) {
  const { host, tip, on } = useTip();
  const n = weekly.weeks.length, pitch = Math.min(44, Math.max(16, Math.floor(880 / Math.max(1, n)))), bw = Math.min(24, pitch - 6);
  const ticks = niceTicks(weekly.max), top = ticks[ticks.length - 1] || 1, H = 200, L = 36, W = L + n * pitch + 8, base = 12 + H;
  const y = (v: number) => base - (v / top) * H;
  let last = '';
  return (
    <div className="rv-plot" ref={host}>
      <div className="rv-scroll">
        <svg width={W} height={base + 28} viewBox={`0 0 ${W} ${base + 28}`} role="img" aria-label="Applications per week, split by university" className="rv-cols">
          {ticks.map((t) => <g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} className="rv-gl" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="rv-ax">{compact(t)}</text></g>)}
          {weekly.weeks.map((wk, i) => {
            const x = L + i * pitch + (pitch - bw) / 2;
            const mon = new Date(`${wk.start}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
            const label = mon !== last ? mon : ''; last = mon;
            let acc = 0;
            const segs = wk.by.map((v, g) => { const y1 = y(acc + v), y0 = y(acc); acc += v; return v ? { g, y: y1, h: y0 - y1 } : null; }).filter(Boolean) as { g: number; y: number; h: number }[];
            return (
              <g key={wk.start}>
                {segs.map((s, k) => { const isTop = k === segs.length - 1, hh = Math.max(1, s.h - (k ? 2 : 0)); return <path key={s.g} d={isTop ? roundTop(x, s.y, bw, hh, 4) : `M${x},${s.y} h${bw} v${hh} h-${bw} Z`} fill={SERIES[weekly.groups[s.g].slot]} className="rv-seg-m" />; })}
                <rect x={L + i * pitch} y={12} width={pitch} height={H + 16} fill="transparent" tabIndex={0} aria-label={`Week of ${prettyDay(wk.start)}: ${wk.total}`}
                  {...on({ title: `Week of ${prettyDay(wk.start)}`, rows: [...weekly.groups.map((g, gi) => ({ color: SERIES[g.slot], label: g.label, value: String(wk.by[gi]) })).filter((r) => r.value !== '0'), { label: 'in total', value: String(wk.total) }] })} />
                {label && <text x={L + i * pitch + pitch / 2} y={base + 18} textAnchor="middle" className="rv-ax">{label}</text>}
              </g>
            );
          })}
          <line x1={L} x2={W} y1={base} y2={base} className="rv-axis" />
        </svg>
      </div>
      <Tip tip={tip} />
    </div>
  );
}

/** When applications arrive: a calendar heat map (one square per day) or weekly columns split by university. */
export default function IntakeCard({ cal, weekly, csv }: { cal: Calendar; weekly: Weekly; csv?: string }) {
  const [mode, setMode] = useState<'calendar' | 'weekly'>('calendar');
  const table = mode === 'calendar'
    ? { head: ['Week starting', ...SHORT, 'Total'], rows: cal.weeks.map((w) => [prettyDay(w.start), ...w.cells.map((c) => (c ? c.n : '')), w.cells.reduce((s, c) => s + (c ? c.n : 0), 0)]) }
    : { head: ['Week starting', ...weekly.groups.map((g) => g.label), 'Total'], rows: weekly.weeks.map((w) => [prettyDay(w.start), ...w.by, w.total]) };
  const tools = (
    <div className="rv-seg" role="group" aria-label="Show as">
      <button type="button" aria-pressed={mode === 'calendar'} onClick={() => setMode('calendar')}>Calendar</button>
      <button type="button" aria-pressed={mode === 'weekly'} onClick={() => setMode('weekly')}>By university</button>
    </div>
  );
  return (
    <VizCard title="When applications arrive" sub={mode === 'calendar' ? 'One square a day. Darker means more applications that day.' : 'Applications started each week, split by university.'} csv={csv} table={table} tools={tools} wide
      legend={mode === 'weekly' ? <Legend items={weekly.groups.map((g) => ({ label: g.label, color: SERIES[g.slot] }))} label="Universities" /> : undefined}>
      {cal.total === 0 ? <Empty icon="clock" title="No applications started in this period">Pick a longer period above.</Empty> : mode === 'calendar' ? <CalendarHeat cal={cal} /> : <WeeklyColumns weekly={weekly} />}
    </VizCard>
  );
}

import Link from 'next/link';
import Btn from '../Btn';
import Icon from '../Icon';
import Hero from './Hero';
import IntakeCard from './IntakeCard';
import JourneyCard from './JourneyCard';
import { CountriesCard, FunnelCard, PaceCard, PortfolioCard, SourceCard, StageTracksCard } from './MoreCards';
import type { Track, Viz } from '@/lib/vizData';

export const PRESETS: [string, string][] = [['30d', '30 days'], ['90d', '90 days'], ['6m', '6 months'], ['12m', '12 months'], ['all', 'Everything']];

/** The whole Reports page, drawn from data the page has already worked out (so it can be shown, tested and screenshotted on its own). */
export default function ReportsView({ viz, tracks, spaces, ws, preset, headHref }: { viz: Viz; tracks: Track[]; spaces: { key: string; name: string }[]; ws: string; preset: string; headHref: string | null }) {
  const href = (o: { ws?: string; range?: string }) => {
    const p = new URLSearchParams(), w = o.ws ?? ws, r = o.range ?? preset;
    if (w !== 'all') p.set('ws', w);
    if (r === 'custom') { p.set('from', viz.range.from); p.set('to', viz.range.to); } else p.set('range', r);
    return `/reports?${p.toString()}`;
  };
  const csv = (kind: string) => `/api/reports?kind=${kind}&from=${viz.range.from}&to=${viz.range.to}`;
  return (
    <div className="rv">
      <div className="head"><h1>Reports</h1></div>
      <p className="sub">The story of your applications: when they arrive, where they go and where they wait.</p>

      <form className="rv-filters" method="get" action="/reports">
        <div className="rv-seg" role="group" aria-label="Period">
          {PRESETS.map(([k, label]) => <Link key={k} href={href({ range: k })} aria-current={preset === k ? 'true' : undefined} className={preset === k ? 'on' : ''}>{label}</Link>)}
        </div>
        <details className="rv-custom" open={preset === 'custom'}>
          <summary><Icon n="clock" size={14} /> Custom dates</summary>
          <div className="rv-custom-b">
            <label>From <input type="date" name="from" defaultValue={viz.range.from} /></label>
            <label>To <input type="date" name="to" defaultValue={viz.range.to} /></label>
            {ws !== 'all' && <input type="hidden" name="ws" value={ws} />}
            <Btn className="sm">Show</Btn>
          </div>
        </details>
        {spaces.length > 1 && (
          <div className="rv-seg" role="group" aria-label="Country">
            <Link href={href({ ws: 'all' })} aria-current={ws === 'all' ? 'true' : undefined} className={ws === 'all' ? 'on' : ''}>All countries</Link>
            {spaces.map((s) => <Link key={s.key} href={href({ ws: s.key })} aria-current={ws === s.key ? 'true' : undefined} className={ws === s.key ? 'on' : ''}>{s.name}</Link>)}
          </div>
        )}
      </form>

      <Hero viz={viz} />

      <div className="rv-grid">
        <JourneyCard flows={viz.flows} csv={{ school: csv('university'), counselor: csv('counselor') }} />
        <IntakeCard cal={viz.calendar} weekly={viz.weekly} csv={csv('month')} />
        <FunnelCard funnel={viz.funnel} csv={`/api/reports?kind=funnel_country&from=${viz.range.from}&to=${viz.range.to}`} />
        <SourceCard funnel={viz.funnel} csv={`/api/reports?kind=funnel_source&from=${viz.range.from}&to=${viz.range.to}`} />
        <PortfolioCard rows={viz.portfolios} csv={`/api/reports?kind=funnel_counselor&from=${viz.range.from}&to=${viz.range.to}`} headHref={headHref} />
        <StageTracksCard tracks={tracks} />
        <PaceCard viz={viz} csv={csv('stage')} headHref={headHref} />
        <CountriesCard funnel={viz.funnel} csv={`/api/reports?kind=funnel_country&from=${viz.range.from}&to=${viz.range.to}`} />
      </div>
      <p className="rv-foot">Numbers count the applications that <b>started</b> in the chosen period and chats started in it, followed to where they are now.</p>
    </div>
  );
}

'use client';
import { useMemo, useState } from 'react';
import { Empty, PHASE_VAR, Tip, useTip, VizCard, pctOf, plural } from './VizKit';
import { sankeyLayout } from '@/lib/vizLayout';
import { PHASES, type Flow } from '@/lib/vizData';

const W = 780, LM = 168, RM = 200, NODE = 12;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Where each group's applications are now. Ribbons are as thick as the number of applications and wear the colour of where they ended up. */
export default function JourneyCard({ flows, csv }: { flows: Flow[]; csv?: Record<string, string> }) {
  const [dim, setDim] = useState(0);
  const [hot, setHot] = useState<{ side: 'l' | 'r'; id: string } | null>(null);
  const { host, tip, on, hide } = useTip();
  const flow = flows[Math.min(dim, flows.length - 1)];
  const total = flow.total, H = Math.max(344, 40 + Math.max(flow.left.length, flow.right.length) * 34);
  const leftN = useMemo(() => new Map(flow.left.map((l) => [l.id, flow.links.filter((k) => k.from === l.id).reduce((s, k) => s + k.n, 0)])), [flow]);
  const lay = useMemo(() => sankeyLayout({ left: flow.left.map((l) => l.id), right: flow.right.map((r) => r.id), links: flow.links.map((k) => ({ from: k.from, to: k.to, n: k.n })), width: W - LM - RM, height: H - 16, nodeW: NODE, gap: 12 }), [flow]);
  const name = new Map(flow.left.map((l) => [l.id, l.label]));
  const phase = new Map(PHASES.map((p) => [p.key, p]));
  const right = new Map(flow.right.map((r) => [r.id, r]));
  const color = (id: string) => PHASE_VAR[right.get(id)?.phase ?? 'start'];
  const active = (r: { from: string; to: string }) => !hot || (hot.side === 'l' ? r.from === hot.id : r.to === hot.id);

  const table = { head: [flow.label, ...flow.right.map((r) => r.label), 'Total'], rows: flow.left.map((l) => [l.label, ...flow.right.map((r) => flow.links.find((k) => k.from === l.id && k.to === r.id)?.n ?? 0), leftN.get(l.id) ?? 0]) };
  const rowTip = (id: string) => ({ title: name.get(id) || id, rows: flow.right.map((r) => ({ color: color(r.id), label: r.label, value: String(flow.links.find((k) => k.from === id && k.to === r.id)?.n ?? 0) })).filter((r) => r.value !== '0'), note: `${plural(leftN.get(id) ?? 0, 'application')} in all` });
  const statusTip = (id: string) => { const n = flow.links.filter((k) => k.to === id).reduce((t, k) => t + k.n, 0), r = right.get(id)!; return { title: r.label, rows: [{ color: color(id), label: `of ${total} (${pctOf(n, total)}%)`, value: String(n) }], note: phase.get(r.phase)!.label }; };

  /** Tooltip handlers plus the highlight, so a pointer and the keyboard do the same two things. */
  const tipOf = (content: Parameters<typeof on>[0], mark: { side: 'l' | 'r'; id: string }) => {
    const t = on(content);
    return { ...t, onPointerEnter: () => setHot(mark), onFocus: (e: React.FocusEvent) => { t.onFocus(e); setHot(mark); }, onBlur: () => { t.onBlur(); setHot(null); } };
  };
  const tools = flows.length > 1 && (
    <div className="rv-seg" role="group" aria-label="Group by">
      {flows.map((f, i) => <button key={f.key} type="button" aria-pressed={i === dim} onClick={() => { setDim(i); setHot(null); hide(); }}>{f.key === 'source' ? 'Source' : f.label}</button>)}
    </div>
  );

  return (
    <VizCard title="The journey" sub={`Where every application that started in this period is now, by ${flow.label.toLowerCase()}. Hover a bar to follow its students.`} csv={csv?.[flow.key]} table={table} tools={tools} wide>
      {!total || !lay.nodes.length ? <Empty icon="swap" title="Nothing to follow yet">Applications that start in the chosen period appear here.</Empty> : (
        <div className="rv-plot" ref={host}>
          <div className="rv-scroll rv-sankey">
            <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Journey of ${total} applications by ${flow.label}`} style={{ minWidth: 640 }} onPointerLeave={() => setHot(null)}>
              <g transform={`translate(${LM},8)`}>
                {lay.ribbons.map((r) => (
                  <path key={`${r.from}>${r.to}`} d={r.d} fill={color(r.to)} className={`rv-rib${active(r) ? '' : ' dim'}`} tabIndex={0}
                    aria-label={`${name.get(r.from)} to ${right.get(r.to)?.label}: ${r.n}`}
                    {...tipOf({ title: `${name.get(r.from)}  →  ${right.get(r.to)?.label}`, rows: [{ color: color(r.to), label: `${pctOf(r.n, leftN.get(r.from) ?? 0)}% of ${name.get(r.from)}`, value: String(r.n) }] }, { side: 'l', id: r.from })} />
                ))}
                {lay.nodes.map((n) => {
                  const left = n.side === 'l', label = left ? name.get(n.id) || n.id : right.get(n.id)!.label;
                  const content = left ? rowTip(n.id) : statusTip(n.id);
                  return (
                    <g key={`${n.side}${n.id}`} className={`rv-node${hot && !(hot.side === n.side && hot.id === n.id) ? ' dim' : ''}`} tabIndex={0} aria-label={`${label}: ${n.n}`}
                      {...tipOf(content, { side: n.side, id: n.id })}>
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={3} fill={left ? 'var(--rv-node)' : color(n.id)} />
                      <rect x={left ? n.x - LM : n.x} y={n.y - 4} width={left ? LM : n.w + RM} height={n.h + 8} fill="transparent" />
                      <text x={left ? n.x - 10 : n.x + n.w + 10} y={n.y + n.h / 2} textAnchor={left ? 'end' : 'start'} dominantBaseline="middle" className="rv-nl">
                        {left ? <><tspan>{clip(label, 24)}</tspan><tspan className="rv-nv" dx={7}>{n.n}</tspan></> : <><tspan>{clip(label, 26)}</tspan><tspan className="rv-nv" dx={7}>{n.n} · {pctOf(n.n, total)}%</tspan></>}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
          <Tip tip={tip} />
          <p className="rv-hint">Swipe sideways to see the whole picture.</p>
          <ul className="rv-legend" aria-label="Where they are now">{PHASES.filter((p) => flow.right.some((r) => r.phase === p.key)).map((p) => <li key={p.key} title={p.hint}><i style={{ background: PHASE_VAR[p.key] }} />{p.label}</li>)}</ul>
        </div>
      )}
    </VizCard>
  );
}

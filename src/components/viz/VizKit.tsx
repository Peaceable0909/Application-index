'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import Icon from '../Icon';

// Shared pieces for the report charts: the card every chart sits in (with its table twin), the one tooltip, the legend.

export type TableData = { head: string[]; rows: (string | number)[][] };
export type TipRow = { color?: string; label: string; value: string };
type TipContent = { title?: string; rows: TipRow[]; note?: string };
type TipData = TipContent & { x: number; y: number; w: number };

/** One tooltip per chart. Values lead and labels follow; everything shown here is also in the table view, so the tooltip never gates a number. */
export function useTip() {
  const host = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipData | null>(null);
  const hide = useCallback(() => setTip(null), []);
  const show = useCallback((e: { clientX?: number; clientY?: number; currentTarget: Element }, content: TipContent, focus = false) => {
    const box = host.current?.getBoundingClientRect();
    if (!box) return;
    let cx = e.clientX, cy = e.clientY;
    if (focus || cx === undefined) { const r = e.currentTarget.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + Math.min(r.height / 2, 24); }
    setTip({ ...content, x: cx - box.left, y: (cy ?? 0) - box.top, w: box.width });
  }, []);
  /** Spread onto a mark: pointer and keyboard focus show the same thing. */
  const on = useCallback((content: TipContent) => ({
    onPointerMove: (e: React.PointerEvent) => show(e, content), onPointerDown: (e: React.PointerEvent) => show(e, content), onPointerLeave: hide,
    onFocus: (e: React.FocusEvent) => show(e, content, true), onBlur: hide,
  }), [show, hide]);
  return { host, tip, on, hide };
}

export function Tip({ tip }: { tip: (TipContent & { x: number; y: number; w: number }) | null }) {
  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 96), Math.max(96, tip.w - 96)), below = tip.y < 90;
  return (
    <div className={`rv-tip${below ? ' below' : ''}`} style={{ left: x, top: below ? tip.y + 18 : tip.y }} aria-hidden>
      {tip.title && <div className="rv-tip-t">{tip.title}</div>}
      {tip.rows.map((r, i) => (
        <div key={i} className="rv-tip-r">{r.color && <i style={{ background: r.color }} />}<b>{r.value}</b><span>{r.label}</span></div>
      ))}
      {tip.note && <div className="rv-tip-n">{tip.note}</div>}
    </div>
  );
}

export function Legend({ items, label = 'Key' }: { items: { label: string; color: string; note?: string }[]; label?: string }) {
  if (items.length < 2) return null;
  return <ul className="rv-legend" aria-label={label}>{items.map((i) => <li key={i.label} title={i.note}><i style={{ background: i.color }} />{i.label}</li>)}</ul>;
}

/** The frame around a chart: title, a short line saying what it shows, the CSV link, and the Chart | Table switch (the accessible twin of the picture). */
export function VizCard({ title, sub, csv, table, tools, legend, children, className = '', wide = false }: { title: string; sub?: string; csv?: string; table?: TableData; tools?: ReactNode; legend?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <figure className={`rv-card${wide ? ' wide' : ''} ${className}`}>
      <header className="rv-card-h">
        <div className="rv-card-t"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        <div className="rv-card-tools">
          {tools}
          {csv && <a className="rv-pill" href={csv} title="Download as a spreadsheet file"><Icon n="download" size={13} /> CSV</a>}
          {table && (
            <div className="rv-seg" role="group" aria-label={`${title}: view`}>
              <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
              <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
            </div>
          )}
        </div>
      </header>
      {view === 'chart' ? <>{legend}{children}</> : table && (
        <div className="rv-tablewrap"><table className="rv-table"><thead><tr>{table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table></div>
      )}
    </figure>
  );
}

export const Empty = ({ icon = 'spark', title, children }: { icon?: string; title: string; children?: ReactNode }) => (
  <div className="rv-empty"><span className="rv-empty-i"><Icon n={icon} size={20} /></span><b>{title}</b>{children && <p>{children}</p>}</div>
);

/** Phase colours are CSS variables so light, soft and dark each get their own validated steps. */
export const PHASE_VAR: Record<string, string> = { start: 'var(--ph-start)', offer: 'var(--ph-offer)', cas: 'var(--ph-cas)', visa: 'var(--ph-visa)', enrolled: 'var(--ph-enrolled)', closed: 'var(--ph-closed)' };
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
export const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

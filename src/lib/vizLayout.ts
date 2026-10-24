// Geometry for the report charts. Pure (no database, no DOM), so the shapes can be tested and the same numbers drive the picture and its table.

export type SankeyLink = { from: string; to: string; n: number };
export type SankeyNode = { id: string; n: number; x: number; y: number; w: number; h: number; side: 'l' | 'r' };
export type SankeyRibbon = { from: string; to: string; n: number; d: string; h: number; y0: number; y1: number };

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Two columns joined by ribbons whose thickness is the number of applications. `left` and `right` fix the order of the nodes top to bottom;
 * a node with nothing flowing through it is left out. Ribbons leave and arrive in node order, so they never cross themselves needlessly.
 */
export function sankeyLayout(o: { left: string[]; right: string[]; links: SankeyLink[]; width: number; height: number; nodeW?: number; gap?: number; minH?: number }): { nodes: SankeyNode[]; ribbons: SankeyRibbon[]; k: number } {
  const nodeW = o.nodeW ?? 12, gap = o.gap ?? 10, minH = o.minH ?? 3;
  const links = o.links.filter((l) => l.n > 0 && o.left.includes(l.from) && o.right.includes(l.to));
  const total = links.reduce((s, l) => s + l.n, 0);
  if (!total) return { nodes: [], ribbons: [], k: 0 };
  const sum = (key: 'from' | 'to', id: string) => links.filter((l) => l[key] === id).reduce((s, l) => s + l.n, 0);
  const L = o.left.filter((id) => sum('from', id) > 0), R = o.right.filter((id) => sum('to', id) > 0);

  // one scale for both columns, shrunk until both stacks (with their gaps and minimum heights) fit
  const stack = (ids: string[], key: 'from' | 'to', k: number) => ids.reduce((s, id) => s + Math.max(sum(key, id) * k, minH), 0) + gap * Math.max(0, ids.length - 1);
  let k = Math.min((o.height - gap * Math.max(0, L.length - 1)) / total, (o.height - gap * Math.max(0, R.length - 1)) / total);
  for (let i = 0; i < 12 && Math.max(stack(L, 'from', k), stack(R, 'to', k)) > o.height; i++) k *= o.height / Math.max(stack(L, 'from', k), stack(R, 'to', k)) * 0.98;

  const place = (ids: string[], key: 'from' | 'to', x: number, side: 'l' | 'r'): SankeyNode[] => {
    const used = stack(ids, key, k);
    let y = (o.height - used) / 2;
    return ids.map((id) => { const n = sum(key, id), h = Math.max(n * k, minH), node = { id, n, x, y: r1(y), w: nodeW, h: r1(h), side }; y += h + gap; return node; });
  };
  const ln = place(L, 'from', 0, 'l'), rn = place(R, 'to', o.width - nodeW, 'r');
  const lBy = new Map(ln.map((n) => [n.id, n])), rBy = new Map(rn.map((n) => [n.id, n]));

  // ribbons leave each left node top to bottom in the order of the right nodes, and arrive at each right node in the order of the left nodes
  const lOff = new Map<string, number>(), rOff = new Map<string, number>();
  const out = [...links].sort((a, b) => L.indexOf(a.from) - L.indexOf(b.from) || R.indexOf(a.to) - R.indexOf(b.to));
  const ribbons: SankeyRibbon[] = [];
  const inOrder = [...links].sort((a, b) => R.indexOf(a.to) - R.indexOf(b.to) || L.indexOf(a.from) - L.indexOf(b.from));
  const arrive = new Map<string, number>();
  for (const l of inOrder) { const key = `${l.from}>${l.to}`, o2 = rOff.get(l.to) ?? 0; arrive.set(key, o2); rOff.set(l.to, o2 + l.n * k); }
  const x0 = nodeW, x1 = o.width - nodeW, xm = (x0 + x1) / 2;
  for (const l of out) {
    const a = lBy.get(l.from)!, b = rBy.get(l.to)!, h = l.n * k, oa = lOff.get(l.from) ?? 0, ob = arrive.get(`${l.from}>${l.to}`) ?? 0;
    lOff.set(l.from, oa + h);
    const ya = a.y + oa, yb = b.y + ob;
    ribbons.push({ from: l.from, to: l.to, n: l.n, h: r1(h), y0: r1(ya), y1: r1(yb), d: `M${x0},${r1(ya)} C${r1(xm)},${r1(ya)} ${r1(xm)},${r1(yb)} ${x1},${r1(yb)} L${x1},${r1(yb + h)} C${r1(xm)},${r1(yb + h)} ${r1(xm)},${r1(ya + h)} ${x0},${r1(ya + h)} Z` });
  }
  return { nodes: [...ln, ...rn], ribbons, k };
}

/** A smooth line through the points (Catmull-Rom turned into Bézier), for the sparklines. */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])},${r1(p2[1])}`;
  }
  return d;
}

/** Clean axis ticks from 0 to a little above `max` (1, 2, 5 steps), at most `count` of them. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** 1,284 / 12.9K for large numbers; axis ticks and tiles use it. */
export const compact = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(Math.round(n * 10) / 10));

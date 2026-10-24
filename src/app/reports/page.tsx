import { requireTeam } from '@/lib/auth';
import { workspacesFor } from '@/lib/workspace';
import { loadFacts } from '@/lib/funnel';
import { loadStageBoard } from '@/lib/stageBoard';
import { loadStudents } from '@/lib/overview';
import { isPaid } from '@/lib/requests';
import { addDays, buildViz, docPayTiles, isoDay, scopeFacts, stageTracks, withTiles, type DocPayRow, type Range } from '@/lib/vizData';
import ReportsView from '@/components/viz/ReportsView';

export const maxDuration = 60;
type SP = { range?: string; from?: string; to?: string; ws?: string };

/** The calendar and weekly columns draw at most 60 weeks, so no period is allowed to be longer than that. */
const MAX_DAYS = 419;
const DAYS: Record<string, number> = { '30d': 29, '90d': 89, '6m': 181, '12m': 364 };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The period asked for: a preset (default six months), "everything so far", or two dates typed in. */
function resolveRange(sp: SP, today: string, first: string | null): { range: Range; preset: string } {
  let range: Range, preset = sp.range && (sp.range in DAYS || sp.range === 'all') ? sp.range : '';
  if (!preset && ISO.test(sp.from || '') && ISO.test(sp.to || '') && sp.from! <= sp.to!) { range = { from: sp.from!, to: sp.to! > today ? today : sp.to! }; preset = 'custom'; }
  else { preset = preset || '6m'; range = { from: preset === 'all' ? first || addDays(today, -DAYS['6m']) : addDays(today, -DAYS[preset]), to: today }; }
  if (range.from < addDays(range.to, -MAX_DAYS)) range = { from: addDays(range.to, -MAX_DAYS), to: range.to };
  return { range, preset };
}

export default async function Reports({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const spaces = (await workspacesFor(me)).map((w) => ({ key: w.key, name: w.name }));
  const keys = spaces.map((s) => s.key);
  const ws = sp.ws && keys.includes(sp.ws) ? sp.ws : 'all';

  const facts = await loadFacts(keys);
  const today = isoDay(Date.now());
  const first = scopeFacts(facts, ws).apps.map((a) => a.day).sort()[0] || null;
  const { range, preset } = resolveRange(sp, today, first);
  const headHref = me.role === 'admin' || me.team_head ? '/head' : null;

  const base = buildViz({ facts, spaces, range, ws, headHref });
  // documents complete and payments pending come from the student records (one pass per country), for the same students as everything else
  const inScope = ws === 'all' ? keys : [ws];
  const records = await Promise.all(inScope.map(async (workspace) => { try { return (await loadStudents({ workspace })).rows; } catch { return []; } }));
  const rows: DocPayRow[] = records.flat().map((r) => ({ id: r.a.application_id, status: r.a.status, judged: r.judged, missing: r.missing.length, inRegent: !!r.a.in_regent, paid: isPaid(r.a.payment) }));
  const viz = withTiles(base, docPayTiles(rows, new Set(base.cohortIds)));
  // each university's stage route, narrowed to the same applications the rest of the page is about
  const boards = await Promise.all(inScope.map(async (workspace) => { try { return { workspace, board: await loadStageBoard(workspace) }; } catch { return null; } }));
  const tracks = stageTracks(boards.filter((b): b is NonNullable<typeof b> => !!b), new Set(viz.cohortIds));

  return <ReportsView viz={viz} tracks={tracks} spaces={spaces} ws={ws} preset={preset} headHref={headHref} />;
}

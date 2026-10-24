// A small in-memory PostgREST stand-in: enough of the REST API for supabase-js to run the stage operations against it.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export type Rows = Record<string, Record<string, unknown>[]>;
const PK: Record<string, string[]> = { portal_app_flags: ['application_id', 'flag'], portal_offers: ['application_id'], portal_applications: ['application_id'], portal_documents: ['drive_file_id'] };

function parseVal(raw: string): unknown { return raw; }
function match(row: Record<string, unknown>, key: string, expr: string): boolean {
  const neg = expr.startsWith('not.'); const e = neg ? expr.slice(4) : expr;
  const dot = e.indexOf('.'); const op = e.slice(0, dot), val = e.slice(dot + 1);
  const v = row[key];
  let r: boolean;
  if (op === 'eq') r = String(v) === val;
  else if (op === 'neq') r = String(v) !== val;
  else if (op === 'in') r = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
  else if (op === 'is') r = val === 'null' ? v == null : val === 'true' ? v === true : v === false;
  else if (op === 'gt') r = String(v) > val; else if (op === 'gte') r = String(v) >= val; else if (op === 'lt') r = String(v) < val; else if (op === 'lte') r = String(v) <= val;
  else throw new Error('mock: unsupported operator ' + op);
  return neg ? !r : r;
}

export function startMock(db: Rows, port: number): Promise<http.Server> {
  const log: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const url = new URL(req.url!, 'http://x');
        const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
        if (!m) { res.writeHead(404); res.end('{}'); return; }
        const table = m[1]; db[table] ||= [];
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
        const accept = String(req.headers.accept || ''), prefer = String(req.headers.prefer || '');
        const filters: [string, string][] = [];
        let order: string | null = null, limit: number | null = null, select = '*';
        url.searchParams.forEach((v, k) => { if (k === 'select') select = v; else if (k === 'order') order = v; else if (k === 'limit') limit = Number(v); else if (k === 'on_conflict' || k === 'columns') { /* handled below */ } else filters.push([k, v]); });
        const sel = (rows: Record<string, unknown>[]) => rows.filter((r) => filters.every(([k, v]) => match(r, k, v)));
        const proj = (r: Record<string, unknown>) => (select === '*' ? { ...r } : Object.fromEntries(select.split(',').map((c) => c.trim()).filter(Boolean).map((c) => [c, r[c] ?? null])));
        const send = (code: number, data: unknown) => {
          if (accept.includes('vnd.pgrst.object')) {
            const arr = data as unknown[];
            if (!Array.isArray(arr) || arr.length !== 1) { res.writeHead(406, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${Array.isArray(arr) ? arr.length : 0} rows` })); return; }
            res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(arr[0])); return;
          }
          res.writeHead(code, { 'content-type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data));
        };
        const wantRows = prefer.includes('return=representation');
        if (req.method === 'GET') {
          let rows = sel(db[table]);
          if (order) { const [col, dir] = (order as string).split('.'); rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
          if (typeof limit === 'number') rows = rows.slice(0, limit);
          log.push(`GET ${table} ${url.search}`); send(200, rows.map(proj));
        } else if (req.method === 'POST') {
          const items = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
          const onConflict = url.searchParams.get('on_conflict');
          const merge = prefer.includes('resolution=merge-duplicates');
          const out: Record<string, unknown>[] = [];
          for (const it of items) {
            const row = { ...it }; if (!('id' in row) && !PK[table] && table !== 'portal_workflows_x') row.id = randomUUID();
            const keys = onConflict ? onConflict.split(',') : null;
            const ex = keys ? db[table].find((r) => keys.every((k) => String(r[k]) === String(row[k]))) : null;
            if (ex) { if (merge) { Object.assign(ex, row); out.push(ex); } else throw new Error('duplicate key'); }
            else {
              if (PK[table]) { const dup = db[table].find((r) => PK[table].every((k) => String(r[k]) === String(row[k]))); if (dup) throw new Error(`duplicate key value violates unique constraint (${table})`); }
              db[table].push(row); out.push(row);
            }
          }
          log.push(`POST ${table} x${items.length}`); send(201, wantRows ? out.map(proj) : undefined);
        } else if (req.method === 'PATCH') {
          const rows = sel(db[table]); rows.forEach((r) => Object.assign(r, body)); log.push(`PATCH ${table} ${url.search} -> ${rows.length}`); send(200, wantRows ? rows.map(proj) : undefined);
        } else if (req.method === 'DELETE') {
          const rows = sel(db[table]); db[table] = db[table].filter((r) => !rows.includes(r)); log.push(`DELETE ${table} -> ${rows.length}`); send(200, wantRows ? rows.map(proj) : undefined);
        } else { res.writeHead(405); res.end('{}'); }
      } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: (e as Error).message, code: 'MOCK' })); }
    });
  });
  (server as unknown as { log: string[] }).log = log;
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

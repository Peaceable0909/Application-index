// Tells the right people when an application enters a stage, or when a stage's checklist is complete and the next stage is ready.
// Best effort: a failed notification never affects the move itself.
import { admin } from './supabase';
import { sendPush } from './push';
import { staffFor } from './recipients';
import { DEFAULT_WS, mayOpen } from './workspaceCore';
import type { Notify, ReqEval, Stage } from './stageEngine';

type App = { application_id: string; name: string; workspace: string; school: string | null };

async function admins(workspace: string): Promise<string[]> {
  const { data } = await admin().from('portal_staff').select('email, role, workspaces').eq('role', 'admin');
  return (data || []).filter((r) => mayOpen(r as { role: 'admin'; workspaces: string[] | null }, workspace || DEFAULT_WS)).map((r) => r.email.toLowerCase());
}

/** Who a stage's "notify" setting means: the assigned counselor (the admins when nobody is assigned), the admins, or both. */
export async function stageRecipients(app: App, notify: Notify, except: string): Promise<string[]> {
  if (notify === 'none') return [];
  const list = notify === 'admins' ? await admins(app.workspace) : await staffFor(app.application_id, notify === 'both');
  return [...new Set(list.map((e) => e.toLowerCase()))].filter((e) => e !== except.toLowerCase());
}

const url = (id: string) => `/applications/${encodeURIComponent(id)}?tab=stage`;

export async function notifyEntered(o: { app: App; stage: Stage; from: string | null; by: string; open: ReqEval[]; override?: boolean }) {
  try {
    const to = await stageRecipients(o.app, o.stage.notify, o.by);
    if (!to.length) return;
    const needs = o.open.filter((r) => r.blocking).map((r) => r.label);
    await sendPush({
      emails: to, title: `${o.app.name}: ${o.stage.name}`, tag: `stage:${o.app.application_id}`, url: url(o.app.application_id),
      body: [o.from ? `Moved from ${o.from}.` : 'Entered this stage.', o.override ? 'Moved with an override.' : '', needs.length ? `Needs: ${needs.slice(0, 4).join(', ')}${needs.length > 4 ? '…' : ''}.` : ''].filter(Boolean).join(' '),
    });
  } catch { /* ignore */ }
}

export async function notifyReady(o: { app: App; stage: Stage; next: Stage; by: string }) {
  try {
    const to = await stageRecipients(o.app, o.stage.notify === 'none' ? 'counselor' : o.stage.notify, o.by);
    if (!to.length) return;
    await sendPush({ emails: to, title: `${o.app.name} is ready to move on`, body: `${o.stage.name} is complete. Next: ${o.next.name}.`, tag: `stage-ready:${o.app.application_id}`, url: url(o.app.application_id) });
  } catch { /* ignore */ }
}

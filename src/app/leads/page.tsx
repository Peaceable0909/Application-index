import Link from 'next/link';
import { Fragment } from 'react';
import { FIELDS, FIELD_LABEL, firstName, missingFields, type Profile } from '@/lib/leadProfile';
import { headers } from 'next/headers';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { currentWorkspace } from '@/lib/workspace';
import { brainEnabled } from '@/lib/brain';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import Avatar from '@/components/Avatar';
import AutoRefresh from '@/components/AutoRefresh';
import CopyLink from '@/components/CopyLink';
import { convertLead } from '../actions';
import { deleteLead, replyLead, saveLeadDetails, setLeadChatOpen, setLeadStatus, toggleLeadAi } from '../leadActions';

export const metadata = { title: 'New students' };
const when = (iso: string) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

export default async function Leads({ searchParams }: { searchParams: Promise<{ lead?: string; msg?: string; err?: string }> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const db = admin(), ws = await currentWorkspace();
  const [{ data: wsRow }, { data: leads }] = await Promise.all([
    db.from('portal_workspaces').select('name, lead_chat').eq('key', ws).maybeSingle(),
    db.from('portal_leads').select('id, name, email, phone, interest, summary, needs, status, ai_paused, needs_human, profile, handover_at, handover_delivered, handover_reason, converted_app, created_at, last_message_at, staff_read_at').eq('workspace', ws).order('last_message_at', { ascending: false }).limit(200),
  ]);
  const ids = (leads || []).map((l) => l.id);
  const { data: last } = ids.length ? await db.from('portal_lead_msgs').select('lead_id, body, from_lead, by_ai, created_at').in('lead_id', ids.slice(0, 60)).order('created_at', { ascending: false }).limit(400) : { data: [] };
  const preview = new Map<string, { body: string; from_lead: boolean }>();
  for (const m of last || []) if (!preview.has(m.lead_id)) preview.set(m.lead_id, m);
  const sel = (leads || []).find((l) => l.id === sp.lead) || null;
  const { data: thread } = sel ? await db.from('portal_lead_msgs').select('id, from_lead, by_ai, sender, body, created_at').eq('lead_id', sel.id).order('created_at').limit(400) : { data: [] };
  if (sel && !sel.staff_read_at) await db.from('portal_leads').update({ staff_read_at: new Date().toISOString() }).eq('id', sel.id);
  const host = (await headers()).get('host');
  const link = `${host?.includes('localhost') ? 'http' : 'https'}://${host}/hello/${ws}`;
  const open = !!wsRow?.lead_chat;
  const unread = (leads || []).filter((l) => !l.staff_read_at).length;

  return (
    <>
      <div className="head"><h1>New students</h1>{unread > 0 && <span className="badge blue">{unread} new</span>}</div>
      <p className="sub">People who are thinking about studying in {wsRow?.name || 'this country'} and chatted with the assistant. They are not students yet.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      <AutoRefresh />

      <div className="card">
        <h2><Icon n="chat" size={17} /> The chat link <span className={`badge plain ${open ? 'green' : ''}`} style={{ marginLeft: 6 }}>{open ? 'open' : 'closed'}</span></h2>
        {open ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Share this link (website, Instagram bio, WhatsApp status, a QR code). Anyone with it can chat. The assistant answers from what you taught it, asks for their name and contact, and tells you here.{brainEnabled() ? '' : ' The AI Brain is switched off, so it can only say a counselor will reply.'}</p>
            <div className="filters"><code style={{ wordBreak: 'break-all' }}>{link}</code><CopyLink href={link} /><a className="btn ghost sm" href={link} target="_blank" rel="noreferrer">Open</a></div>
          </>
        ) : <p className="muted" style={{ marginTop: 0 }}>The chat is closed, so the link shows nothing. When you open it, visitors must agree that you keep their chat, and each can only send a limited number of messages.</p>}
        {me.role === 'admin' && <form action={setLeadChatOpen} style={{ marginTop: 10 }}><input type="hidden" name="on" value={open ? '0' : '1'} /><Btn className={open ? 'ghost sm' : 'primary'}>{open ? 'Close the chat' : `Open the chat for ${wsRow?.name || 'this country'}`}</Btn></form>}
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card tablecard" style={{ padding: 0 }}>
          {(leads || []).length === 0 && <p className="muted" style={{ padding: 18, margin: 0 }}>No chats yet.</p>}
          {(leads || []).map((l) => {
            const p = preview.get(l.id);
            return (
              <Link key={l.id} href={`/leads?lead=${l.id}`} className={`lead-row ${sel?.id === l.id ? 'on' : ''} ${!l.staff_read_at ? 'unread' : ''}`}>
                <Avatar name={l.name || '?'} size={42} />
                <span className="lead-main">
                  <span className="lead-top"><b>{l.name || 'Visitor'}</b><time>{when(l.last_message_at)}</time></span>
                  <span className="lead-sub">{p ? `${p.from_lead ? '' : 'You: '}${p.body}` : ''}</span>
                  <span className="chips">
                    {l.status === 'converted' && <span className="badge green plain">Student</span>}
                    {l.needs_human && l.status !== 'converted' && <span className="badge amber plain">{l.handover_at && l.handover_delivered === false ? 'Handover not confirmed' : 'Wants a counsellor'}</span>}
                    {(l.email || l.phone) && <span className="badge plain">Contact left</span>}
                    {l.interest && <span className="badge plain">{l.interest.slice(0, 34)}</span>}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        {sel ? (
          <div className="card">
            <div className="filters" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{sel.name || 'Visitor'}</h2>
              <div className="filters" style={{ gap: 6 }}>
                <form action={toggleLeadAi}><input type="hidden" name="leadId" value={sel.id} /><Btn className="ghost sm">{sel.ai_paused ? 'Let the assistant answer' : 'Pause the assistant'}</Btn></form>
                {me.role === 'admin' && <form action={deleteLead}><input type="hidden" name="leadId" value={sel.id} /><Btn className="ghost sm">Delete</Btn></form>}
              </div>
            </div>
            <div className={`callout`} style={{ marginTop: 10, alignItems: 'flex-start' }}><Icon n="spark" className="ci" /><div style={{ flex: 1 }}>
              <b>What we know about {firstName(sel.name) || 'this visitor'}</b>
              {sel.summary && <p style={{ margin: '2px 0 6px' }}>{sel.summary}</p>}
              <dl className="kv narrow-k" style={{ margin: '6px 0' }}>
                {FIELDS.filter((f) => f !== 'other' && ((f === 'name' && sel.name) || (f === 'email' && sel.email) || (f === 'phone' && sel.phone) || ((sel.profile as Record<string, string> | null)?.[f]))).map((f) => <Fragment key={f}><dt>{FIELD_LABEL[f]}</dt><dd>{f === 'name' ? sel.name : f === 'email' ? sel.email : f === 'phone' ? sel.phone : (sel.profile as Record<string, string>)[f]}</dd></Fragment>)}
                {(sel.profile as Record<string, string> | null)?.other && <><dt>Other</dt><dd>{(sel.profile as Record<string, string>).other}</dd></>}
              </dl>
              {(() => { const gaps = missingFields({ ...((sel.profile as Profile) || {}), ...(sel.name ? { name: sel.name } : {}), ...(sel.email ? { email: sel.email } : {}), ...(sel.phone ? { phone: sel.phone } : {}) }).filter((f) => f !== 'school'); return gaps.length ? <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>Not asked or answered yet: {gaps.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}.</p> : null; })()}
              {(sel.needs as string[] | null)?.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{(sel.needs as string[]).map((n) => <li key={n}>{n}</li>)}</ul> : null}
              <p style={{ margin: '8px 0 0', fontSize: 13 }}><b>Counsellor handover:</b> {sel.handover_at ? (sel.handover_delivered ? <span className="ok-t">team notified on {when(sel.handover_at)}</span> : <span className="bad-t">asked for on {when(sel.handover_at)}, but the notification could not be confirmed. Please follow up.</span>) : sel.needs_human ? <span className="muted">flagged for a person</span> : <span className="muted">not requested yet</span>}</p>
            </div></div>
            <div className="lead-thread">
              {(thread || []).map((m) => (
                <div key={m.id} className={`hello-b ${m.from_lead ? 'them' : 'me'}`}>
                  <p>{m.body}</p>
                  <span className="meta">{m.by_ai && <i className="ai-tag">AI assistant</i>}{!m.from_lead && !m.by_ai && <i className="ai-tag">{m.sender?.split('@')[0] || 'You'}</i>}{when(m.created_at)}</span>
                </div>
              ))}
            </div>
            <form action={replyLead} className="grid" style={{ gap: 8 }}>
              <input type="hidden" name="leadId" value={sel.id} />
              <textarea name="body" rows={2} maxLength={2000} placeholder={sel.email ? 'Reply (they get it in the chat and by email)' : 'Reply (they see it when they open the chat again)'} required />
              <div><Btn data-busy="Sending…">Send reply</Btn> <span className="muted" style={{ fontSize: 12.5 }}>The assistant pauses once you reply.</span></div>
            </form>

            <h3 style={{ margin: '18px 0 8px' }}>Details</h3>
            <form action={saveLeadDetails} className="grid" style={{ gap: 8 }}>
              <input type="hidden" name="leadId" value={sel.id} />
              <div className="filters"><input name="name" defaultValue={sel.name || ''} placeholder="Name" /><input name="email" defaultValue={sel.email || ''} placeholder="Email" /><input name="phone" defaultValue={sel.phone || ''} placeholder="Phone / WhatsApp" /></div>
              <input name="interest" defaultValue={sel.interest || ''} placeholder="What they want to study, where, when" />
              <div className="filters"><input name="country" defaultValue={(sel.profile as Record<string, string> | null)?.country || ''} placeholder="Country of study" /><input name="school" defaultValue={(sel.profile as Record<string, string> | null)?.school || ''} placeholder="Preferred school" /><input name="programme" defaultValue={(sel.profile as Record<string, string> | null)?.programme || ''} placeholder="Programme" /><select name="level" defaultValue={(sel.profile as Record<string, string> | null)?.level || ''}><option value="">Study level</option><option>Undergraduate</option><option>Top-up</option><option>Postgraduate</option><option>Foundation</option><option>Pre-masters</option><option>Doctorate</option></select></div>
              <div className="filters"><input name="qualifications" defaultValue={(sel.profile as Record<string, string> | null)?.qualifications || ''} placeholder="Qualifications and grades" /><input name="previousSchool" defaultValue={(sel.profile as Record<string, string> | null)?.previousSchool || ''} placeholder="Previous school or university" /></div>
              <div><Btn className="ghost sm">Save details</Btn></div>
            </form>
            <div className="filters" style={{ marginTop: 14 }}>
              {sel.status !== 'converted' ? <>
                <form action={convertLead}><input type="hidden" name="leadId" value={sel.id} /><Btn className="primary" data-busy="Creating the student…"><Icon n="user-plus" size={15} /> Make a student</Btn></form>
                <form action={setLeadStatus} className="filters" style={{ gap: 6 }}><input type="hidden" name="leadId" value={sel.id} />
                  <select name="status" defaultValue={sel.status}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select><Btn className="ghost sm">Set</Btn></form>
              </> : sel.converted_app && <Link className="btn ghost" href={`/applications/${encodeURIComponent(sel.converted_app)}`}>Open the student</Link>}
            </div>
          </div>
        ) : <div className="card"><p className="muted" style={{ margin: 0 }}>Pick a chat on the left.</p></div>}
      </div>
    </>
  );
}

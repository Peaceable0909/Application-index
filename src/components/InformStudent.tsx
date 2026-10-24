'use client';
import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { draftStageEmail, informStudent, previewStageEmail } from '@/app/stageActions';

export type InformShown = { historyId: string; stage: string; state: 'sending' | 'sent' | 'failed' | null; at: string | null; by: string | null; to: string | null; error: string | null };

const when = (t: string | null) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * "Inform student": tells the student about this stage change by email, only when someone chooses to. Moving the stage never does this.
 * The counselor sees the email first, can change the subject and the words, and can see it as the student will. Always goes to the address on
 * the application. Once sent it cannot be sent again from here; if it fails, the stage is untouched and it can be tried again.
 */
export default function InformStudent({ appId, info, who = {}, compact = false, intro, openNow = false }: { appId: string; info: InformShown; who?: Record<string, string>; compact?: boolean; intro?: string; openNow?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(openNow);
  const [state, setState] = useState(info);
  // follow the server's version when its values change (not when a parent merely re-creates the same object)
  useEffect(() => setState(info), [info.historyId, info.state, info.at, info.by, info.to, info.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const by = state.by ? who[state.by.toLowerCase()] || state.by.split('@')[0] : '';

  return (
    <div className={`sg-inform${compact ? ' compact' : ''}${state.state === 'sent' ? ' is-sent' : state.state === 'failed' ? ' is-failed' : ''}`}>
      <span className="ic"><Icon n={state.state === 'sent' ? 'check-circle' : state.state === 'failed' ? 'alert' : 'mail'} size={compact ? 16 : 20} /></span>
      <div className="tx">
        {intro && <small>{intro}</small>}
        <b>{state.state === 'sent' ? 'Student informed' : state.state === 'failed' ? 'The email could not be sent' : state.state === 'sending' ? 'Sending the email…' : 'Student not informed'}</b>
        <small>
          {state.state === 'sent' ? `${when(state.at)}${by ? ` by ${by}` : ''}${state.to ? ` · ${state.to}` : ''}`
            : state.state === 'failed' ? `${state.error || 'Something went wrong.'} The stage is saved. You can try again.`
            : state.state === 'sending' ? 'This can take a few seconds.'
            : 'Their dashboard already shows this stage. Sending an email is your choice.'}
        </small>
      </div>
      {state.state !== 'sent' && state.state !== 'sending' && (
        <button type="button" className={`btn${compact ? ' ghost sm' : ' primary'}`} onClick={() => setOpen(true)}><Icon n="send" size={14} /> {state.state === 'failed' ? 'Try again' : 'Inform student'}</button>
      )}
      {open && <InformSheet appId={appId} info={state} onClose={(sent) => { setOpen(false); if (sent) { setState({ ...state, state: 'sent', at: new Date().toISOString(), by: null }); router.refresh(); } else router.refresh(); }} />}
    </div>
  );
}

function InformSheet({ appId, info, onClose }: { appId: string; info: InformShown; onClose: (sent: boolean) => void }) {
  const [draft, setDraft] = useState<{ to: string | null; name: string } | null>(null);
  const [subject, setSubject] = useState(''), [body, setBody] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState(''), [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<{ to: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await draftStageEmail(appId, info.historyId);
      if (!live) return;
      setLoading(false);
      if (!r.ok) { setErr(r.error); return; }
      setDraft({ to: r.to, name: r.name }); setSubject(r.subject); setBody(r.body);
      if (r.info.state === 'sent') setErr('The student was already informed about this change.');
    })();
    return () => { live = false; };
  }, [appId, info.historyId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose(!!sent); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  });

  function showPreview() {
    setTab('preview'); setHtml(null); setErr('');
    start(async () => { const r = await previewStageEmail(appId, info.historyId, subject, body); if (r.ok) setHtml(r.html); else setErr(r.error); });
  }
  function send() {
    setErr('');
    start(async () => {
      const r = await informStudent(appId, info.historyId, { subject, body });
      if (r.ok) setSent({ to: r.to }); else setErr(r.error);
    });
  }
  const canSend = !!draft?.to && !pending && !sent && subject.trim().length >= 3 && body.trim().length >= 20;

  const node = (
    <div className="modal-bg mv-bg" onClick={() => !pending && onClose(!!sent)}>
      <div className="modal mvs sg-sheet" role="dialog" aria-modal="true" aria-label="Inform student" onClick={(e) => e.stopPropagation()}>
        <div className="mv-h"><b>{sent ? 'Email sent' : 'Inform student'}</b><button type="button" className="iconbtn" onClick={() => !pending && onClose(!!sent)} aria-label="Close"><Icon n="x" size={16} /></button></div>
        {sent ? (
          <>
            <div className="mv-body"><div className="mv-result is-good"><span className="ic"><Icon n="check-circle" size={22} /></span><div><b>{draft?.name || 'The student'} has been told</b><small>Sent to {sent.to}. It is recorded on the stage change, so it cannot go out twice.</small></div></div></div>
            <div className="mv-foot"><button type="button" className="btn primary" onClick={() => onClose(true)}>Done</button></div>
          </>
        ) : (
          <>
            <div className="mv-body">
              {loading && <div className="mv-note">Preparing the email…</div>}
              {draft && (
                <>
                  <div className="mv-who"><b>{draft.name}</b><span>{draft.to ? <>To <b>{draft.to}</b>, the address on their application</> : 'No email address on this application'}</span></div>
                  {!draft.to && <div className="sg-banner is-stop"><Icon n="alert" size={18} /><div><b>Nobody to send it to</b><span>Add the student’s email address to their application first.</span></div></div>}
                  <div className="sg-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Write</button><button type="button" role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={showPreview}>Preview as the student sees it</button></div>
                  {tab === 'edit' ? (
                    <>
                      <div className="mv-fld"><label className="mv-lbl" htmlFor="inf-subject">Subject</label><input id="inf-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></div>
                      <div className="mv-fld"><label className="mv-lbl" htmlFor="inf-body">Message</label><textarea id="inf-body" className="sg-body-edit" value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={6000} />
                        <small className="mv-hint">Your name and contact details are added at the bottom, with a button to the student portal. Lines starting with “-” become a list.</small></div>
                    </>
                  ) : (
                    <div className="sg-preview">{html ? <iframe title="Email preview" sandbox="" srcDoc={html} /> : <div className="mv-note">{pending ? 'Preparing the preview…' : 'The preview could not be shown.'}</div>}</div>
                  )}
                </>
              )}
              {err && <div className="mv-note t-stop" role="alert">{err}</div>}
            </div>
            <div className="mv-foot">
              <button type="button" className="btn ghost" onClick={() => !pending && onClose(false)}>Not now</button>
              <button type="button" className="btn primary" disabled={!canSend} onClick={send}><Icon n="send" size={14} /> {pending && tab === 'edit' ? 'Sending…' : 'Send email'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}

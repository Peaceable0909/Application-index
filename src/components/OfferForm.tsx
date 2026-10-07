'use client';
import { useState } from 'react';
import Icon from './Icon';
import type { Condition } from '@/lib/offer';

type Props = { action: (f: FormData) => void; id: string; offer: Record<string, string | boolean | null>; conditions: Condition[]; docs: { id: string; name: string; type: string }[]; casStatuses: readonly string[]; visaStatuses: readonly string[] };

export default function OfferForm({ action, id, offer, conditions: initial, docs, casStatuses, visaStatuses }: Props) {
  const [conds, setConds] = useState<Condition[]>(initial);
  const [draft, setDraft] = useState('');
  const v = (k: string) => (offer[k] as string) || '';
  const add = () => { const t = draft.trim(); if (!t) return; setConds((c) => [...c, { text: t, met: false }]); setDraft(''); };
  return (
    <form action={action} className="grid g2" style={{ alignItems: 'start' }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="conditions" value={JSON.stringify(conds)} />
      <div className="grid">
        <div className="card">
          <h2><Icon n="file" size={17} /> Offer</h2>
          <div className="pgrid">
            <label>Type<select name="offer_type" defaultValue={v('offer_type')} style={{ width: '100%', marginTop: 6 }}><option value="">Not received yet</option><option>Conditional</option><option>Unconditional</option></select></label>
            <label>Offer date<input type="date" name="offer_date" defaultValue={v('offer_date')} style={{ width: '100%', marginTop: 6 }} /></label>
            <label style={{ gridColumn: '1 / -1' }}>Offer letter (a document in their folder)<select name="offer_doc_id" defaultValue={v('offer_doc_id')} style={{ width: '100%', marginTop: 6 }}><option value="">None attached</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.type} · {d.name}</option>)}</select></label>
            <label>Deposit due<input type="date" name="deposit_due" defaultValue={v('deposit_due')} style={{ width: '100%', marginTop: 6 }} /></label>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>To attach the letter, first upload it under Documents (choose the type “Offer Letter”), then pick it here.</p>
        </div>
        <div className="card">
          <h2><Icon n="check-circle" size={17} /> Conditions</h2>
          {!conds.length && <p className="muted" style={{ margin: '0 0 10px' }}>No conditions added.</p>}
          <ul className="conds">
            {conds.map((c, i) => (
              <li key={i} className={c.met ? 'met' : ''}>
                <label><input type="checkbox" checked={c.met} onChange={() => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, met: !x.met } : x)))} /> <span>{c.text}</span></label>
                <input type="date" value={c.due || ''} onChange={(e) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, due: e.target.value || null } : x)))} title="Due date (optional)" />
                <button type="button" className="iconbtn" aria-label="Remove" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
          <div className="filters" style={{ flexWrap: 'nowrap' }}><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="e.g. Final transcript, IELTS 6.5 overall…" style={{ flex: 1, minWidth: 0 }} /><button type="button" className="btn ghost sm" onClick={add}>Add</button></div>
        </div>
      </div>
      <div className="grid">
        <div className="card">
          <h2><Icon n="clock" size={17} /> CAS &amp; visa</h2>
          <div className="pgrid">
            <label>CAS<select name="cas_status" defaultValue={v('cas_status') || 'Not started'} style={{ width: '100%', marginTop: 6 }}>{casStatuses.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>CAS requested<input type="date" name="cas_applied_date" defaultValue={v('cas_applied_date')} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>CAS received<input type="date" name="cas_received_date" defaultValue={v('cas_received_date')} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>Visa<select name="visa_status" defaultValue={v('visa_status') || 'Not started'} style={{ width: '100%', marginTop: 6 }}>{visaStatuses.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Visa applied<input type="date" name="visa_applied_date" defaultValue={v('visa_applied_date')} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>Biometrics appointment<input type="date" name="visa_biometrics_date" defaultValue={v('visa_biometrics_date')} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>Visa decision<input type="date" name="visa_decision_date" defaultValue={v('visa_decision_date')} style={{ width: '100%', marginTop: 6 }} /></label>
          </div>
        </div>
        <div className="card">
          <h2><Icon n="user" size={17} /> What the student sees</h2>
          <label className="switch-row" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}><span>Show this to the student in their portal<small className="muted">Offer type, conditions, CAS and visa progress, dates and the offer letter.</small></span><input type="checkbox" name="visible" defaultChecked={offer.visible_to_student !== false} /></label>
          <label style={{ display: 'block', marginTop: 14 }}>Note for the student (optional)<textarea name="student_note" defaultValue={v('student_note')} rows={3} maxLength={600} placeholder="e.g. Please upload your final transcript by 20 November." style={{ width: '100%', height: 'auto', padding: '10px 12px', marginTop: 6 }} /></label>
          <label className="switch-row"><span>Email the student about this update<small className="muted">One branded email with a link to their portal.</small></span><input type="checkbox" name="notify" /></label>
          <div className="filters" style={{ marginTop: 16 }}><button className="btn">Save offer &amp; visa</button></div>
        </div>
      </div>
    </form>
  );
}

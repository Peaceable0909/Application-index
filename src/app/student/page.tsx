import { redirect } from 'next/navigation';
import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { ALL_DOC_TYPES, FINAL_STATUSES, REQUIRED_DOCS } from '@/lib/constants';
import { counselorKey, schoolShort } from '@/lib/docs';
import { STEPS, stepIndex } from '@/lib/format';
import { shownName } from '@/lib/profile';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import StudentUploader from '@/components/StudentUploader';
import StudentMessage from '@/components/StudentMessage';
import StudentDetails from '@/components/StudentDetails';
import StudentInterviews, { MyBooking, SlotView } from '@/components/StudentInterviews';
import { milestones, Offer } from '@/lib/offer';
import { googleCalUrl, MIN_NOTICE_H } from '@/lib/interviews';
import { providerName } from '@/lib/meet';

export const maxDuration = 60;
const OTHER_TYPES = ALL_DOC_TYPES.filter((t) => !(REQUIRED_DOCS as readonly string[]).includes(t));
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default async function StudentHome() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const db = admin();
  const { data: counselors } = await db.from('portal_counselors').select('name, name_key, email');
  const { data: offerRows } = await db.from('portal_offers').select('*').in('application_id', me.ids).eq('visible_to_student', true);
  const nowIso = new Date().toISOString();
  const { data: openSlots } = await db.from('portal_interview_slots').select('*').is('cancelled_at', null).gt('starts_at', new Date(Date.now() + MIN_NOTICE_H * 3600_000).toISOString()).lt('starts_at', new Date(Date.now() + 28 * 864e5).toISOString()).order('starts_at').limit(40);
  const { data: allB } = (openSlots || []).length ? await db.from('portal_interview_bookings').select('slot_id, status').in('slot_id', (openSlots || []).map((x) => x.id)).in('status', ['booked', 'completed', 'no_show']) : { data: [] };
  const { data: myB } = await db.from('portal_interview_bookings').select('*, portal_interview_slots(*)').in('application_id', me.ids).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(30);
  const toBooking = (b: NonNullable<typeof myB>[number]): MyBooking | null => { const sl = b.portal_interview_slots as unknown as { id: string; starts_at: string; duration_min: number; teams_url: string; notes: string | null; cancelled_at: string | null } | null; return sl && !sl.cancelled_at ? { id: b.id, starts_at: sl.starts_at, duration_min: sl.duration_min, teams_url: sl.teams_url, provider: providerName(sl.teams_url), notes: sl.notes, status: b.status, feedback: b.feedback_visible ? b.feedback : null, canCancel: new Date(sl.starts_at).getTime() - Date.now() >= MIN_NOTICE_H * 3600_000, gcal: googleCalUrl(sl as never) } : null; };
  const mine = (myB || []).map(toBooking).filter(Boolean) as MyBooking[];
  const upcomingB = mine.filter((b) => b.status === 'booked' && new Date(b.starts_at).getTime() + b.duration_min * 60_000 > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const pastB = mine.filter((b) => !upcomingB.includes(b) && (b.status !== 'booked' || new Date(b.starts_at) < new Date())).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 5);
  const slotViews: SlotView[] = (openSlots || []).map((x) => ({ id: x.id, starts_at: x.starts_at, duration_min: x.duration_min, notes: x.notes, free: x.capacity - (allB || []).filter((b) => b.slot_id === x.id).length })).filter((x) => x.free > 0);
  void nowIso;
  const { data: profiles } = await db.from('portal_staff').select('email, display_name, avatar_url, color, title');

  // one card per university (several submissions to the same university count as one)
  const byKey = new Map<string, typeof me.apps>();
  me.apps.forEach((a) => byKey.set(a.student_key, [...(byKey.get(a.student_key) || []), a]));
  const cards = [...byKey.values()].map((list) => {
    const a = list[0], ids = list.map((x) => x.application_id);
    const docs = me.docs.filter((d) => me.apps.some((x) => x.student_key === a.student_key && x.application_id === d.application_id));
    const folderApp = list.find((x) => x.drive_folder_id) || a;
    const c = (counselors || []).find((x) => x.name_key === counselorKey(a.counselor));
    const prof = c?.email ? (profiles || []).find((p) => p.email.toLowerCase() === c.email!.toLowerCase()) : null;
    const missing = REQUIRED_DOCS.filter((t) => !docs.some((d) => d.type === t));
    const offer = ((offerRows || []).filter((o) => ids.includes(o.application_id)).sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0] as unknown as Offer | undefined) || null;
    return { a, ids, docs, folderApp, c, prof, missing, offer, canUpload: !!folderApp.drive_folder_id };
  });
  const first = me.apps[0].preferred_name || me.name.split(/[\s,]+/).filter(Boolean)[0] || 'there';

  const a0 = me.apps[0];
  const refId = a0.opp_id || a0.student_ref || `PP-${a0.application_id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`;
  const locked: [string, string][] = [['Name', a0.name], ['Email', me.email], ['Country', a0.country || ''], ['Reference', refId], ['Applied', a0.submitted_at ? new Date(a0.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '']];
  return (
    <>
      <div className="head"><h1>Hi {first} 👋</h1></div>
      <p className="sub">Here is where your application stands, and what we still need from you.</p>
      {(() => {
        const items: { text: string; href: string }[] = [];
        for (const c of cards) {
          if (c.missing.length) items.push({ text: `Upload ${c.missing.join(', ')}${cards.length > 1 ? ` (${schoolShort(c.a.school) || 'application'})` : ''}`, href: '#documents' });
          if (c.a.in_regent && !/^paid/i.test(c.a.payment || '')) items.push({ text: 'Your payment hasn’t been received yet', href: '#application' });
          const open = (c.offer?.conditions || []).filter((x) => !x.met).length;
          if (open) items.push({ text: `${open} offer condition${open === 1 ? '' : 's'} still to meet`, href: '#offer' });
        }
        if (!upcomingB.length && slotViews.length) items.push({ text: 'Book your interview training session', href: '#interview' });
        return items.length
          ? <div className="card todo rise"><h2 style={{ margin: 0 }}>What we need from you</h2><ul>{items.map((i, n) => <li key={n}><span className="dstat" style={{ width: 22, height: 22, fontSize: 12 }}>!</span>{i.text}<a href={i.href}>Go →</a></li>)}</ul></div>
          : <div className="card todo clear rise"><b style={{ color: '#15803d' }}>You’re all caught up ✓</b><span className="muted"> Nothing needed from you right now.</span></div>;
      })()}
      {cards.map(({ a, docs, folderApp, c, prof, missing, offer, canUpload }) => {
        const idx = stepIndex(a.status), final = a.status && FINAL_STATUSES.includes(a.status) && a.status !== 'Enrolled';
        const left = a.deadline ? Math.ceil((new Date(a.deadline + 'T23:59:59').getTime() - Date.now()) / 864e5) : null;
        const done = REQUIRED_DOCS.length - missing.length;
        return (
          <div key={a.student_key} id="application" className="card scard-big rise">
            <div className="sb-head">
              <div><div className="eyebrow">{schoolShort(a.school) || 'Your application'}</div><h2 style={{ margin: 0 }}>{a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : 'Your programme'}</h2></div>
              {a.status && <span className={`badge ${final ? 'red' : a.status === 'Enrolled' ? 'green' : 'plain'}`}>{a.status}</span>}
            </div>

            {!final && (
              <div className="stepper" aria-label="Application progress">
                {STEPS.map((st, i) => <div key={st} className={`stp ${i < idx ? 'done' : i === idx ? 'now' : ''}`}><i>{i < idx ? '✓' : i + 1}</i><span>{st}</span></div>)}
              </div>
            )}
            {a.progress != null && !final && <div className="bar" style={{ margin: '4px 0 14px' }}><i style={{ width: `${a.progress}%` }} /></div>}

            {offer && (offer.offer_type || offer.cas_status || offer.visa_status || offer.conditions?.length) && (
              <div className="offerp" id="offer">
                <h3><Icon n="check-circle" size={16} /> Offer &amp; visa</h3>
                <div className="ms-strip" style={{ marginBottom: 10 }}>{milestones(offer).map((m) => <div key={m.key} className={`ms ${m.state}`}><i>{m.state === 'done' ? '✓' : m.state === 'bad' ? '✕' : ''}</i><b>{m.label}</b><small>{[m.detail, m.date ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).join(' · ') || 'Not yet'}</small></div>)}</div>
                {(offer.conditions || []).length > 0 && (
                  <ul className="dlist" style={{ marginBottom: 10 }}>{offer.conditions.map((cd, i) => <li key={i} className={cd.met ? 'got' : 'need'}><span className="dstat">{cd.met ? '✓' : '!'}</span><div className="dmain"><b>{cd.text}</b><small className={cd.met ? '' : 'warn-t'}>{cd.met ? 'Met' : 'Still to do'}{cd.due ? ` · by ${new Date(cd.due + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</small></div></li>)}</ul>
                )}
                {offer.offer_doc_id && docs.some((d) => d.id === offer.offer_doc_id) && <a className="btn ghost sm" href={`/api/files/${encodeURIComponent(offer.offer_doc_id)}`} target="_blank" rel="noreferrer"><Icon n="eye" size={14} /> View my offer letter</a>}
                {offer.student_note && <div className="fb" style={{ marginTop: 10 }}><b>Note from your counselor</b><div>{offer.student_note}</div></div>}
              </div>
            )}

            <div className="sgrid">
              <section>
                <h3 id="documents"><Icon n="file" size={16} /> Your documents <span className="muted" style={{ fontWeight: 500 }}>{done} of {REQUIRED_DOCS.length} required received</span></h3>
                <ul className="dlist">
                  {REQUIRED_DOCS.map((t) => {
                    const mine = docs.filter((d) => d.type === t);
                    return (
                      <li key={t} className={mine.length ? 'got' : 'need'}>
                        <span className="dstat">{mine.length ? '✓' : '!'}</span>
                        <div className="dmain"><b>{t}</b>
                          {mine.length ? <small>{mine[0].name} · received {new Date(mine[0].added).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{mine[0].size ? ` · ${kb(mine[0].size)}` : ''}</small> : <small className="warn-t">Still needed</small>}
                        </div>
                        {mine.length > 0 && <a className="dview" href={`/api/files/${encodeURIComponent(mine[0].id)}`} target="_blank" rel="noreferrer" title="View"><Icon n="eye" size={16} /></a>}
                        {canUpload && <StudentUploader appId={folderApp.application_id} docType={t} label={mine.length ? 'Replace' : 'Upload'} compact />}
                      </li>
                    );
                  })}
                </ul>
                {canUpload ? (
                  <div className="otherup"><b>Another document?</b><span className="muted"> English test, reference letter and so on.</span><StudentUploader appId={folderApp.application_id} label="Upload a file" choose types={OTHER_TYPES as string[]} /></div>
                ) : <div className="xnote" style={{ marginTop: 12 }}>Uploads aren’t switched on for your application yet. Please message your counselor and they will sort it out.</div>}
                {docs.filter((d) => !(REQUIRED_DOCS as readonly string[]).includes(d.type)).length > 0 && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Also received: {docs.filter((d) => !(REQUIRED_DOCS as readonly string[]).includes(d.type)).map((d) => d.name).join(', ')}</div>
                )}
              </section>

              <section>
                <h3><Icon n="users" size={16} /> Your counselor</h3>
                {c ? (
                  <div className="cbox">
                    <Avatar name={prof ? shownName(prof) : c.name} url={prof?.avatar_url} color={prof?.color} size={52} />
                    <div><b>{prof ? shownName(prof) : c.name}</b><div className="muted" style={{ fontSize: 13 }}>{prof?.title || 'Admissions Counselor'}</div></div>
                  </div>
                ) : <p className="muted" style={{ margin: 0 }}>A counselor will be assigned to you soon.</p>}
                <div style={{ marginTop: 12 }}><StudentMessage appId={a.application_id} counselor={c ? (prof ? shownName(prof).split(' ')[0] : c.name) : 'the team'} /></div>

                {(a.intake || a.deadline || (a.in_regent)) && (
                  <dl className="kv narrow-k" style={{ marginTop: 18 }}>
                    {a.intake && <><dt>Intake</dt><dd>{new Date(a.intake + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</dd></>}
                    {a.deadline && <><dt>Deadline</dt><dd>{new Date(a.deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}{left !== null && <span className={left <= 14 ? 'warn-t' : 'muted'}> · {left < 0 ? 'passed' : left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}</dd></>}
                    {a.in_regent && <><dt>Payment</dt><dd>{/^paid/i.test(a.payment || '') ? <span className="ok-t">Received ✓</span> : <span className="warn-t">Not received yet</span>}</dd></>}
                  </dl>
                )}
              </section>
            </div>
          </div>
        );
      })}
      <StudentInterviews slots={slotViews} upcoming={upcomingB} past={pastB} hasUpcoming={upcomingB.length > 0} />
      <StudentDetails locked={locked} phone={a0.phone || ''} city={a0.city || ''} preferred={a0.preferred_name || ''} />
      <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 24 }}>Questions? Use the message box above. Your documents are stored privately and only your counselors can see them.</p>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { admin } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { roleLabel, shownName } from '@/lib/profile';
import { loadBadgeDefs, loadBadgeMap, loadHolders } from '@/lib/badgeData';
import { mayHold } from '@/lib/staffBadges';
import { loadHandles } from '@/lib/profileData';
import { LIMITS } from '@/lib/profileRules';
import { adminSaveProfile } from '@/app/profileActions';
import { setPersonBadges } from '@/app/badgeActions';
import Avatar from '@/components/Avatar';
import BadgeList from '@/components/BadgeList';
import Btn from '@/components/Btn';
import CoverEditor from '@/components/CoverEditor';
import FlashScroll from '@/components/FlashScroll';
import HandlesCard from '@/components/HandlesCard';
import Icon from '@/components/Icon';
import ProfileHero from '@/components/ProfileHero';
import Seal from '@/components/Seal';

type SP = { msg?: string; err?: string };

export default async function Member({ params, searchParams }: { params: Promise<{ email: string }>; searchParams: Promise<SP> }) {
  const me = await requireStaff();
  const raw = (await params).email, sp = await searchParams;
  let email: string;
  try { email = decodeURIComponent(raw).toLowerCase(); } catch { notFound(); }
  const { data: p } = await admin().from('portal_staff').select('email, role, display_name, avatar_url, title, phone, bio, color, last_seen_at, cover_url, cover_pos, cover_preset, responsibilities, duties, also_supports').eq('email', email).maybeSingle();
  if (!p) notFound();
  const mine = p.email.toLowerCase() === me.email.toLowerCase(), isAdmin = me.role === 'admin';
  const [badgeMap, handles, defs, holders] = await Promise.all([loadBadgeMap(), loadHandles(email), isAdmin ? loadBadgeDefs() : Promise.resolve([]), isAdmin ? loadHolders() : Promise.resolve([])]);
  const badges = badgeMap.get(email) || [];
  const name = shownName(p), here = `/team/${encodeURIComponent(email)}`;
  const online = !!p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 10 * 60_000;
  const held = new Set(holders.filter((h) => h.email === email).map((h) => h.badge_id));
  return (
    <>
      <p className="crumb"><Link href="/team"><Icon n="left" size={14} className="ic-in" /> Team</Link></p>
      {sp.msg && <div className="card ok" data-flash>{sp.msg}</div>}{sp.err && <div className="card err" data-flash>{sp.err}</div>}
      <FlashScroll />
      <ProfileHero
        name={name} title={p.title || roleLabel(p.role)} bio={p.bio} email={p.email} phone={p.phone} badges={badges} online={online}
        cover={{ url: p.cover_url, pos: p.cover_pos, preset: p.cover_preset, color: p.color }}
        tools={isAdmin && !mine ? <CoverEditor email={p.email} url={p.cover_url} pos={p.cover_pos ?? 50} preset={p.cover_preset} color={p.color} returnTo={here} /> : undefined}
        avatar={<Avatar name={name} url={p.avatar_url} color={p.color} size={120} />}
        actions={mine ? <Link href="/profile" className="btn sm"><Icon n="edit" size={14} /> Edit my profile</Link> : <a href={`mailto:${p.email}`} className="btn sm"><Icon n="mail" size={14} /> Email</a>}
      />
      <div className="split">
        <div>
          <div className="card">
            <h2><Icon n="note" size={17} /> Responsibilities</h2>
            <div className="pf-block"><div className="hd-h">Primary responsibilities</div>{p.responsibilities ? <p className="pf-text">{p.responsibilities}</p> : <p className="muted">Not written yet.</p>}</div>
            {p.duties && <div className="pf-block"><div className="hd-h">Additional duties</div><p className="pf-text">{p.duties}</p></div>}
            {p.also_supports && <div className="pf-block"><div className="hd-h">Also helps with</div><p className="pf-text">{p.also_supports}</p></div>}
          </div>
          {isAdmin && !mine && (
            <>
              <form action={adminSaveProfile} className="card" data-busy="Saving their profile…">
                <input type="hidden" name="email" value={p.email} /><input type="hidden" name="returnTo" value={here} />
                <h2><Icon n="edit" size={17} /> Edit their profile <span className="badge plain" style={{ marginLeft: 6 }}>admin</span></h2>
                <div className="pgrid">
                  <label>Display name<input name="display_name" defaultValue={p.display_name || ''} maxLength={LIMITS.display_name} /></label>
                  <label>Professional role<input name="title" defaultValue={p.title || ''} maxLength={LIMITS.title} /></label>
                </div>
                <label style={{ display: 'block', marginTop: 12 }}>Short bio<textarea name="bio" defaultValue={p.bio || ''} maxLength={LIMITS.bio} rows={2} style={{ width: '100%', height: 'auto', padding: '10px 12px' }} /></label>
                <label style={{ display: 'block', marginTop: 12 }}>Primary responsibilities<textarea name="responsibilities" defaultValue={p.responsibilities || ''} maxLength={LIMITS.responsibilities} rows={3} style={{ width: '100%', height: 'auto', padding: '10px 12px' }} /></label>
                <label style={{ display: 'block', marginTop: 12 }}>Additional duties<textarea name="duties" defaultValue={p.duties || ''} maxLength={LIMITS.duties} rows={2} style={{ width: '100%', height: 'auto', padding: '10px 12px' }} /></label>
                <label style={{ display: 'block', marginTop: 12 }}>Also helps with<input name="also_supports" defaultValue={p.also_supports || ''} maxLength={LIMITS.also_supports} style={{ width: '100%', marginTop: 6 }} /></label>
                <div className="filters" style={{ marginTop: 14 }}><Btn className="btn" data-busy="Saving their profile…">Save</Btn></div>
              </form>
              <form action={setPersonBadges} className="card" data-busy="Saving their badges…">
                <input type="hidden" name="email" value={p.email} />
                <h2><Icon n="seal" size={17} /> Give or take back badges <span className="badge plain" style={{ marginLeft: 6 }}>admin</span></h2>
                <ul className="pb-list">
                  {defs.map((d) => {
                    const ok = mayHold(d, p.role);
                    return (
                      <li key={d.id} className={ok ? '' : 'off'}>
                        <label>
                          <input type="checkbox" name="badge" value={d.id} defaultChecked={held.has(d.id)} disabled={!ok && !held.has(d.id)} />
                          <Seal b={d} size={22} quiet />
                          <span><b>{d.name}</b>{!d.enabled && <em> (switched off)</em>}<small>{d.description || 'No meaning written yet.'}{!ok ? ` Not open to ${roleLabel(p.role).toLowerCase()}s.` : ''}</small></span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="hd-note">A badge shows only once it is switched on. <Link href="/badges">Manage badges</Link></p>
                <div className="filters" style={{ marginTop: 10 }}><Btn className="btn" data-busy="Saving their badges…">Save badges</Btn></div>
              </form>
            </>
          )}
        </div>
        <div>
          <BadgeList badges={badges} who={mine ? 'You' : 'They'} />
          <HandlesCard handles={handles} admin={isAdmin} who={mine ? 'You' : 'They'} />
          {isAdmin && <div className="card"><h2>Access</h2><dl className="kv"><dt>Portal role</dt><dd>{roleLabel(p.role)}</dd></dl><p className="hd-note">Badges and the text on a profile never change what someone can open. Access is set in Settings and on the Responsibilities page.</p></div>}
        </div>
      </div>
    </>
  );
}

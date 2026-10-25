'use client';
import { useRef, useState } from 'react';
import Icon from './Icon';
import Btn from './Btn';
import Avatar from './Avatar';
import Link from 'next/link';
import ProfileHero from './ProfileHero';
import CoverEditor from './CoverEditor';
import { COLORS, gradient, shownName } from '@/lib/profile';
import type { BadgeLite } from '@/lib/staffBadges';
import { LIMITS, type LockKey } from '@/lib/profileRules';

type Init = {
  email: string; role: string; display_name: string; title: string; phone: string; bio: string; color: string; avatar_url: string | null; notify_email: boolean;
  cover_url: string | null; cover_pos: number; cover_preset: string | null; responsibilities: string; duties: string; also_supports: string;
};

/** Squares + shrinks the chosen photo in the browser (400×400 JPEG, ~40 KB) before it is uploaded. */
async function squash(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), S = 400;
  const c = document.createElement('canvas'); c.width = c.height = S;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.86));
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

export default function ProfileEditor({ init, save, upload, remove, roleName, locks, badges, aside }: { init: Init; save: (f: FormData) => void; upload: (f: FormData) => void; remove: () => void; roleName: string; locks: LockKey[]; badges: BadgeLite[]; aside: React.ReactNode }) {
  const [name, setName] = useState(init.display_name);
  const [title, setTitle] = useState(init.title);
  const [color, setColor] = useState(init.color || 'navy');
  const [bio, setBio] = useState(init.bio);
  const [resp, setResp] = useState(init.responsibilities);
  const [duties, setDuties] = useState(init.duties);
  const lock = (k: LockKey) => locks.includes(k);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = shownName({ email: init.email, display_name: name });

  async function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    try {
      const small = await squash(f);
      setPreview(URL.createObjectURL(small));
      const dt = new DataTransfer(); dt.items.add(small);
      input.current!.files = dt.files;
      form.current!.requestSubmit();
    } catch { setBusy(false); alert('Could not read that image. Try a JPG or PNG.'); }
  }

  const lockNote = (k: LockKey) => lock(k) && <small className="muted ph-lock"><Icon n="lock" size={12} className="ic-in" /> Set by an admin. Ask them to change it.</small>;
  return (
    <>
      <ProfileHero
        name={shown} title={title || roleName} bio={bio} email={init.email} phone={init.phone} badges={badges}
        cover={{ url: init.cover_url, pos: init.cover_pos, preset: init.cover_preset, color }}
        tools={<CoverEditor url={init.cover_url} pos={init.cover_pos} preset={init.cover_preset} color={color} returnTo="/profile" locked={lock('cover')} />}
        avatar={(
          <form ref={form} action={upload} className="pavatar">
            <Avatar name={shown} url={preview || init.avatar_url} color={color} size={120} />
            <input ref={input} type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden onChange={picked} />
            <button type="button" className="pcam" aria-label="Change photo" onClick={() => input.current?.click()} disabled={busy}><Icon n="camera" size={18} /></button>
            {busy && <span className="pspin" />}
          </form>
        )}
        actions={(
          <>
            <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={busy}><Icon n="upload" size={14} /> {init.avatar_url ? 'Change photo' : 'Upload photo'}</button>
            {init.avatar_url && <form action={remove}><Btn className="btn ghost sm" data-busy="Removing the photo…"><Icon n="trash" size={14} /> Remove</Btn></form>}
            <Link href={`/team/${encodeURIComponent(init.email)}`} className="btn ghost sm"><Icon n="eye" size={14} /> See it as teammates do</Link>
          </>
        )}
      />

      <div className="split">
        <div>
          <form action={save} className="card">
            <h2><Icon n="user" size={17} /> About you</h2>
            <div className="pgrid">
              <label>Display name<input name="display_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.display_name} placeholder="How your name appears" /></label>
              <label>Professional role<input {...(lock('title') ? { disabled: true } : { name: 'title' })} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.title} placeholder="e.g. Senior Admissions Counselor" />{lockNote('title')}</label>
              <label>Phone<input name="phone" defaultValue={init.phone} maxLength={30} placeholder="+234…" inputMode="tel" /></label>
              <label>Email<input value={init.email} disabled /></label>
            </div>
            <label style={{ display: 'block', marginTop: 14 }}>Short bio <span className="muted">({bio.length}/{LIMITS.bio})</span>
              <textarea {...(lock('bio') ? { disabled: true } : { name: 'bio' })} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bio} rows={3} placeholder="A line or two about you: what you handle, languages, best time to reach you." style={{ width: '100%', height: 'auto', padding: '10px 12px' }} />
              {lockNote('bio')}
            </label>
            <label style={{ display: 'block', marginTop: 14 }}>Primary responsibilities <span className="muted">({resp.length}/{LIMITS.responsibilities})</span>
              <textarea {...(lock('responsibilities') ? { disabled: true } : { name: 'responsibilities' })} value={resp} onChange={(e) => setResp(e.target.value)} maxLength={LIMITS.responsibilities} rows={3} placeholder="What you are mainly responsible for, in a few lines." style={{ width: '100%', height: 'auto', padding: '10px 12px' }} />
              {lockNote('responsibilities')}
            </label>
            <label style={{ display: 'block', marginTop: 14 }}>Additional duties <span className="muted">({duties.length}/{LIMITS.duties})</span>
              <textarea {...(lock('duties') ? { disabled: true } : { name: 'duties' })} value={duties} onChange={(e) => setDuties(e.target.value)} maxLength={LIMITS.duties} rows={2} placeholder="Anything else you take care of, such as training, interviews or reviewing documents." style={{ width: '100%', height: 'auto', padding: '10px 12px' }} />
              {lockNote('duties')}
            </label>
            <label style={{ display: 'block', marginTop: 14 }}>Also helps with
              <input {...(lock('also_supports') ? { disabled: true } : { name: 'also_supports' })} defaultValue={init.also_supports} maxLength={LIMITS.also_supports} placeholder="e.g. Ghana enquiries, cover for the Lagos desk" style={{ width: '100%', marginTop: 6 }} />
              <small className="muted">A note for your team. The countries, schools and locations you handle come from the Responsibilities page; this does not change who receives applications.</small>
              {lockNote('also_supports')}
            </label>
            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ marginBottom: 8 }}>Accent colour</div>
              <div className="swatches">
                {Object.entries(COLORS).map(([k, c]) => (
                  <label key={k} className={`sw ${color === k ? 'on' : ''}`} title={c.label}>
                    <input type="radio" name="color" value={k} checked={color === k} onChange={() => setColor(k)} hidden />
                    <i style={{ background: gradient(k) }} />
                  </label>
                ))}
              </div>
            </div>
            <label className="switch-row" style={{ marginTop: 18 }}><span>Email me about new chat messages and assigned students<small className="muted">Off by default. If you turn it on: only when you’re away from the portal, at most once per chat every 3 hours, and never more than 3 a day.</small></span><input type="checkbox" name="notify_email" defaultChecked={init.notify_email} /></label>
            <div className="filters" style={{ marginTop: 18 }}><Btn className="btn" data-busy="Saving your profile…">Save profile</Btn></div>
          </form>
        </div>

        <div>
          {aside}
          <div className="card"><h2>Account</h2>
            <dl className="kv"><dt>Portal role</dt><dd>{roleName}</dd><dt>Sign-in</dt><dd>Google · {init.email}</dd></dl>
            <p className="hd-note">What you can open comes from your role and your assignments. Your professional role, bio and badges are descriptions only.</p>
          </div>
        </div>
      </div>
    </>
  );
}

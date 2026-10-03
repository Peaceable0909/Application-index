'use client';
import { useRef, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import { COLORS, gradient, shownName } from '@/lib/profile';

type Init = { email: string; role: string; display_name: string; title: string; phone: string; bio: string; color: string; avatar_url: string | null };

/** Squares + shrinks the chosen photo in the browser (400×400 JPEG, ~40 KB) before it is uploaded. */
async function squash(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), S = 400;
  const c = document.createElement('canvas'); c.width = c.height = S;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.86));
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

export default function ProfileEditor({ init, save, upload, remove, roleName }: { init: Init; save: (f: FormData) => void; upload: (f: FormData) => void; remove: () => void; roleName: string }) {
  const [name, setName] = useState(init.display_name);
  const [title, setTitle] = useState(init.title);
  const [color, setColor] = useState(init.color || 'navy');
  const [bio, setBio] = useState(init.bio);
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

  return (
    <div className="split">
      <div>
        <div className="card pcard">
          <div className="pcover" style={{ background: gradient(color) }} />
          <div className="pwho">
            <form ref={form} action={upload} className="pavatar">
              <Avatar name={shown} url={preview || init.avatar_url} color={color} size={112} />
              <input ref={input} type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden onChange={picked} />
              <button type="button" className="pcam" aria-label="Change photo" onClick={() => input.current?.click()} disabled={busy}><Icon n="camera" size={18} /></button>
              {busy && <span className="pspin" />}
            </form>
            <div className="pname"><h2>{shown}</h2><div className="muted">{title || roleName}</div></div>
          </div>
          <div className="filters" style={{ marginTop: 14 }}>
            <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={busy}><Icon n="upload" size={14} /> {init.avatar_url ? 'Change photo' : 'Upload photo'}</button>
            {init.avatar_url && <form action={remove}><button className="btn ghost sm"><Icon n="trash" size={14} /> Remove</button></form>}
            <span className="muted" style={{ fontSize: 12.5 }}>Square photos look best. It’s resized for you.</span>
          </div>
        </div>

        <form action={save} className="card">
          <h2><Icon n="user" size={17} /> About you</h2>
          <div className="pgrid">
            <label>Display name<input name="display_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="How your name appears" /></label>
            <label>Job title<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Senior Admissions Counselor" /></label>
            <label>Phone<input name="phone" defaultValue={init.phone} maxLength={30} placeholder="+234…" inputMode="tel" /></label>
            <label>Email<input value={init.email} disabled /></label>
          </div>
          <label style={{ display: 'block', marginTop: 14 }}>Short bio <span className="muted">({bio.length}/400)</span>
            <textarea name="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={400} rows={3} placeholder="A line or two about you — what you handle, languages, best time to reach you." style={{ width: '100%', height: 'auto', padding: '10px 12px' }} />
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
          <div className="filters" style={{ marginTop: 18 }}><button className="btn">Save profile</button></div>
        </form>
      </div>

      <div>
        <div className="card">
          <h2>How teammates see you</h2>
          <div className="tcard">
            <Avatar name={shown} url={preview || init.avatar_url} color={color} size={64} />
            <div><b>{shown}</b><div className="muted">{title || roleName}</div></div>
          </div>
          {bio && <p style={{ margin: '12px 0 0' }}>{bio}</p>}
          <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>{init.email}{init.phone ? ` · ${init.phone}` : ''}</div>
        </div>
        <div className="card"><h2>Account</h2>
          <dl className="kv"><dt>Role</dt><dd>{roleName}</dd><dt>Sign-in</dt><dd>Google · {init.email}</dd></dl>
        </div>
      </div>
    </div>
  );
}

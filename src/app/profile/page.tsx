import { requireStaff } from '@/lib/auth';
import { roleLabel } from '@/lib/profile';
import { removeAvatar, saveProfile, uploadAvatar } from '../actions';
import ProfileEditor from '@/components/ProfileEditor';
import PushToggle from '@/components/PushToggle';
import ThemePicker from '@/components/ThemePicker';
import { cookies } from 'next/headers';
import { COOKIE, parseTheme } from '@/lib/theme';

export default async function Profile({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const theme = parseTheme((await cookies()).get(COOKIE)?.value);
  return (
    <>
      <div className="head"><h1>My profile</h1></div>
      <p className="sub">Your photo and details appear across the portal and to your teammates.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}
      <ProfileEditor
        init={{ email: staff.email, role: staff.role, display_name: staff.display_name || '', title: staff.title || '', phone: staff.phone || '', bio: staff.bio || '', color: staff.color || 'navy', avatar_url: staff.avatar_url, notify_email: staff.notify_email === true }}
        roleName={roleLabel(staff.role)} save={saveProfile} upload={uploadAvatar} remove={removeAvatar} />
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Look &amp; feel</h2>
        <p className="muted">Choose a theme and an accent colour. It is saved to your account.</p>
        <ThemePicker initial={theme} />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Phone notifications</h2>
        <p className="muted">Get an alert on this device when a student messages you.</p>
        <div className="stu-shell" style={{ minHeight: 0, background: 'none' }}><PushToggle /></div>
      </div>
    </>
  );
}

import { requireStaff } from '@/lib/auth';
import { roleLabel } from '@/lib/profile';
import { removeAvatar, saveProfile, uploadAvatar } from '../actions';
import ProfileEditor from '@/components/ProfileEditor';

export default async function Profile({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  return (
    <>
      <div className="head"><h1>My profile</h1></div>
      <p className="sub">Your photo and details appear across the portal and to your teammates.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}
      <ProfileEditor
        init={{ email: staff.email, role: staff.role, display_name: staff.display_name || '', title: staff.title || '', phone: staff.phone || '', bio: staff.bio || '', color: staff.color || 'navy', avatar_url: staff.avatar_url, notify_email: staff.notify_email !== false }}
        roleName={roleLabel(staff.role)} save={saveProfile} upload={uploadAvatar} remove={removeAvatar} />
    </>
  );
}

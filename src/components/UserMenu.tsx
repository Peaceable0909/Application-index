import Link from 'next/link';
import { Staff } from '@/lib/auth';
import { signOut } from '@/app/actions';
import Icon from './Icon';
import Avatar from './Avatar';
import { firstWord, roleLabel, shownName } from '@/lib/profile';

export const niceName = (email: string) => { const l = email.split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim().split(' ')[0] || 'Admin'; return l[0].toUpperCase() + l.slice(1).toLowerCase(); };

export default function UserMenu({ staff }: { staff: Staff }) {
  const name = firstWord(staff);
  return (
    <details className="dd">
      <summary className="me"><Avatar name={shownName(staff)} url={staff.avatar_url} color={staff.color} size={42} /><div><b>{name}</b><small>{staff.title || roleLabel(staff.role)}</small></div><Icon n="down" size={16} /></summary>
      <div className="menu" style={{ minWidth: 230 }}>
        <div className="mhead"><Avatar name={shownName(staff)} url={staff.avatar_url} color={staff.color} size={46} /><div><b>{shownName(staff)}</b><small>{staff.email}</small></div></div>
        <Link href="/profile"><Icon n="user" /> My profile</Link>
        <Link href="/team"><Icon n="users" /> Team</Link>
        {staff.role !== 'counselor' && <Link href="/settings"><Icon n="settings" /> Settings</Link>}
        <form action={signOut}><button className="item"><Icon n="logout" /> Sign out</button></form>
      </div>
    </details>
  );
}

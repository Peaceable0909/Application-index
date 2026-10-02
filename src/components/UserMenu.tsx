import Link from 'next/link';
import { Staff } from '@/lib/auth';
import { signOut } from '@/app/actions';
import Icon from './Icon';

export const niceName = (email: string) => { const l = email.split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim().split(' ')[0] || 'Admin'; return l[0].toUpperCase() + l.slice(1).toLowerCase(); };

export default function UserMenu({ staff }: { staff: Staff }) {
  const name = niceName(staff.email);
  return (
    <details className="dd">
      <summary className="me"><span className="avatar">{name.slice(0, 2)}</span><div><b>{name}</b><small>{staff.role === 'admin' ? 'Admin' : staff.role === 'counselor' ? 'Counselor' : 'Staff'}</small></div><Icon n="down" size={16} /></summary>
      <div className="menu" style={{ minWidth: 230 }}>
        <div className="hd">{staff.email}</div>
        {staff.role !== 'counselor' && <Link href="/settings"><Icon n="settings" /> Settings</Link>}
        <form action={signOut}><button className="item"><Icon n="logout" /> Sign out</button></form>
      </div>
    </details>
  );
}

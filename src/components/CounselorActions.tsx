'use client';
import Link from 'next/link';
import Icon from './Icon';
import { useCallMaybe } from './CallProvider';

/** Message / Voice / Video buttons for the student's counselor. */
export default function CounselorActions({ appId, name, avatar }: { appId: string; name: string; avatar: { name: string; url: string | null; color: string | null } }) {
  const call = useCallMaybe(), off = !call || call.phase !== 'idle';
  return (
    <div className="st-ca">
      <Link href="/student/messages" className="st-btn sm"><Icon n="chat" size={15} /> Message</Link>
      <button type="button" className="st-btn sm ghost" aria-label="Voice call" disabled={off} onClick={() => call?.start(appId, 'voice', { name, avatar })}><Icon n="phone" size={15} /></button>
      <button type="button" className="st-btn sm ghost" aria-label="Video call" disabled={off} onClick={() => call?.start(appId, 'video', { name, avatar })}><Icon n="video" size={15} /></button>
    </div>
  );
}

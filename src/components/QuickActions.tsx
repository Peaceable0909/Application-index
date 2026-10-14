'use client';
import Link from 'next/link';
import Icon from './Icon';
import { useCallMaybe } from './CallProvider';

type Counselor = { display: string; avatar_url: string | null; color: string | null } | null;
type Props = { docsLeft: number; unread: number; interview: string; counselor: Counselor; appId: string };

/** Four big tiles, like widgets on a home screen: the things a student does most. */
export default function QuickActions({ docsLeft, unread, interview, counselor, appId }: Props) {
  const call = useCallMaybe();
  const parts = (counselor?.display || '').split(/\s+/).filter(Boolean);
  const first = /^(mr|mrs|ms|miss|dr|prof|engr|pastor)\.?$/i.test(parts[0] || '') && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
  return (
    <div className="st-quick">
      <Link href="/student/documents" className="st-qt"><span className="st-qi orange"><Icon n="file" size={22} /></span><b>Documents</b><small>{docsLeft ? `${docsLeft} to upload` : 'All received'}</small>{docsLeft > 0 && <i className="n">{docsLeft}</i>}</Link>
      <Link href="/student/messages" className="st-qt"><span className="st-qi blue"><Icon n="chat" size={22} /></span><b>Messages</b><small>{unread ? `${unread} new` : 'Say hello'}</small>{unread > 0 && <i className="n">{unread}</i>}</Link>
      <Link href="/student/interview" className="st-qt"><span className="st-qi purple"><Icon n="video" size={22} /></span><b>Interview</b><small>{interview}</small></Link>
      <button type="button" className="st-qt" disabled={!call || !counselor || call.phase !== 'idle'} onClick={() => counselor && call?.start(appId, 'voice', { name: counselor.display, avatar: { name: counselor.display, url: counselor.avatar_url, color: counselor.color } })}>
        <span className="st-qi green"><Icon n="phone" size={22} /></span><b>Call</b><small>{counselor ? `Call ${first}` : 'No counselor yet'}</small>
      </button>
    </div>
  );
}

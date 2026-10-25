import { People, personFor } from '@/lib/people';
import Avatar from './Avatar';
import { Seals } from './Seal';

/** Photo + chosen name for a teammate. `bare` = name only (for tight spots). */
export default function Who({ people, email, size = 26, bare = false, bold = false }: { people: People; email: string | null | undefined; size?: number; bare?: boolean; bold?: boolean }) {
  const p = personFor(people, email);
  if (bare) return <span title={p.title || undefined}>{p.name}</span>;
  return (
    <span className="who" title={p.title || p.email || undefined}>
      <Avatar name={p.name} url={p.avatar_url} color={p.color} size={size} />
      {bold ? <b>{p.name}</b> : <span>{p.name}</span>}
      <Seals list={p.badges} size={Math.max(13, Math.round(size * 0.6))} max={3} quiet />
    </span>
  );
}

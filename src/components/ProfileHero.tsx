import Cover from './Cover';
import { Seals } from './Seal';
import type { BadgeLite } from '@/lib/staffBadges';

/**
 * The top of a profile: a wide cover, the profile picture overlapping its lower edge, then the name with its badges, the professional title,
 * contact details and a short bio. Used for the public profile page and, live, in the editor. `avatar` is the picture (or the form that changes it);
 * `tools` sits over the cover (the cover editor); `actions` are buttons on the right.
 */
export default function ProfileHero({ name, title, cover, badges, bio, email, phone, avatar, tools, actions, online = false }: {
  name: string; title: string;
  cover: { url?: string | null; pos?: number | null; preset?: string | null; color?: string | null };
  badges?: BadgeLite[]; bio?: string | null; email?: string | null; phone?: string | null;
  avatar: React.ReactNode; tools?: React.ReactNode; actions?: React.ReactNode; online?: boolean;
}) {
  return (
    <section className="ph">
      <Cover className="ph-cover" {...cover} />
      {tools}
      <div className="ph-body">
        <div className="ph-face">{avatar}{online && <i className="live ph-live" title="Active now" />}</div>
        <div className="ph-id">
          <h1 className="ph-name"><span>{name}</span><Seals list={badges} size={22} max={6} /></h1>
          {title && <div className="ph-title">{title}</div>}
          {(email || phone) && <div className="ph-meta">{email && <a href={`mailto:${email}`}>{email}</a>}{phone && <a href={`tel:${phone}`}>{phone}</a>}</div>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
      {bio && <p className="ph-bio">{bio}</p>}
    </section>
  );
}

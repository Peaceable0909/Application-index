import { coverBackground } from '@/lib/covers';

/**
 * The wide picture behind a profile. A photo when the person has one (its `pos` says which part of a tall photo stays in view), otherwise their
 * chosen built-in cover or one drawn from their accent colour. The soft shade at the bottom keeps a name or picture on top of it readable.
 */
export default function Cover({ url, pos, preset, color, className = '', children }: { url?: string | null; pos?: number | null; preset?: string | null; color?: string | null; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`cvr ${className}`} style={url ? undefined : { backgroundImage: coverBackground(preset, color) }}>
      {url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt="" loading="lazy" decoding="async" style={{ objectPosition: `50% ${pos ?? 50}%` }} />}
      {children}
    </div>
  );
}

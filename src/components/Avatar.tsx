import { gradient, inits } from '@/lib/profile';

/** Photo if there is one, otherwise initials on the person's accent gradient. */
export default function Avatar({ name, url, color, size = 42, className = '' }: { name: string; url?: string | null; color?: string | null; size?: number; className?: string }) {
  return (
    <span className={`pic ${className}`} style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)), background: url ? '#e6ecfa' : gradient(color) }}>
      {url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt={name} width={size} height={size} /> : inits(name)}
    </span>
  );
}

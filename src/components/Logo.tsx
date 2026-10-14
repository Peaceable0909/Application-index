// The Extravel logo. Transparent PNGs in /public/brand: `light` is the white-lettered one for navy backgrounds, `mark` is the "E" on its own.
// Without `light` both are rendered and the theme picks one (white lettering in dark mode), so it stays readable on any surface.
const RATIO = { logo: 1367 / 489, mark: 659 / 480 };

export default function Logo({ height = 40, mark = false, light = false, alt = 'Extravel', className = '' }: { height?: number; mark?: boolean; light?: boolean; alt?: string; className?: string }) {
  const kind = mark ? 'mark' : 'logo';
  const size = { width: Math.round(height * RATIO[kind]), height };
  const one = (v: '' | '-light', cls: string, text: string, lazy?: boolean) => (
    <img src={`/brand/extravel-${kind}${v}.png`} alt={text} {...size} className={`xlogo ${cls} ${className}`.trim()} decoding="async" draggable={false} {...(lazy ? { loading: 'lazy' as const, 'aria-hidden': true } : {})} />
  );
  if (light) return one('-light', '', alt);
  return <>{one('', 'xl-d', alt)}{one('-light', 'xl-l', '', true)}</>;
}

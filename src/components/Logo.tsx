// The WhiteRock logo (public/brand/whiterock-logo.png). It carries its own red and navy shapes, so the same file works on light, dark and navy surfaces.
const RATIO = 610 / 95;

export default function Logo({ height = 40, alt = 'WhiteRock', className = '' }: { height?: number; mark?: boolean; light?: boolean; alt?: string; className?: string }) {
  return <img src="/brand/whiterock-logo.png" alt={alt} width={Math.round(height * RATIO)} height={height} className={`xlogo ${className}`.trim()} decoding="async" draggable={false} />;
}

import { ImageResponse } from 'next/og';

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params, size = name.includes('512') ? 512 : 192;
  return new ImageResponse(
    (<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0d1f4d,#1f4ba8)', color: '#e2c566', fontSize: size * 0.5, fontWeight: 800 }}>W</div>),
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=86400' } });
}

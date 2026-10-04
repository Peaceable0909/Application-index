import { ImageResponse } from 'next/og';

// The WhiteRock mark as a PNG: email clients can't show SVG. Public on purpose (mail apps fetch it without a login).
export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: 168, height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1f4d', borderRadius: 46, border: '4px solid #b8952a' }}>
        <svg width="104" height="104" viewBox="0 0 32 32" fill="none"><path d="M6.5 10l3.6 12 5.9-10.5L21.9 22l3.6-12" stroke="#e2c566" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    ),
    { width: 168, height: 168, headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } },
  );
}

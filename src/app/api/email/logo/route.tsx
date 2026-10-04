import { ImageResponse } from 'next/og';

// The Peaceable mark as a PNG: email clients can't show SVG. Public on purpose (mail apps fetch it without a login).
export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: 168, height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1f4d', borderRadius: 46, border: '4px solid #b8952a' }}>
        <svg width="104" height="104" viewBox="0 0 32 32" fill="none"><path d="M11 23V9.5h5.2a4.2 4.2 0 0 1 0 8.4H11" stroke="#e2c566" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    ),
    { width: 168, height: 168, headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } },
  );
}

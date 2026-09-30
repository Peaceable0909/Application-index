// Shown instantly while a page loads: thin progress bar + skeleton of the layout.
export default function Loading() {
  return (
    <>
      <div className="topload" />
      <div className="sk" style={{ width: 230, height: 36, marginBottom: 10 }} />
      <div className="sk" style={{ width: 320, height: 14, marginBottom: 26 }} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="card"><div className="sk" style={{ width: 90, height: 11 }} /><div className="sk" style={{ width: 70, height: 38, marginTop: 12 }} /></div>)}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 18, padding: '16px 14px', borderBottom: '1px solid var(--line)' }}>
            <div className="sk" style={{ width: '24%', height: 14 }} /><div className="sk" style={{ width: '28%', height: 14 }} />
            <div className="sk" style={{ width: '14%', height: 14 }} /><div className="sk" style={{ width: '12%', height: 14 }} />
          </div>
        ))}
      </div>
    </>
  );
}

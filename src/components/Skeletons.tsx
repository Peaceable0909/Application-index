// Page-shaped loading skeletons, shown instantly while a route's data loads.
const Bar = ({ w = '100%', h = 14, mt = 0 }: { w?: number | string; h?: number; mt?: number }) => <div className="sk" style={{ width: w, height: h, marginTop: mt }} />;
const Head = ({ title }: { title?: string }) => (
  <>
    <div className="topload" />
    {title ? <h1>{title}</h1> : <Bar w={240} h={34} />}
    <Bar w={340} h={14} mt={12} />
    <div style={{ height: 22 }} />
  </>
);
const Row = ({ cols = 5 }: { cols?: number }) => (
  <div style={{ display: 'flex', gap: 20, padding: '16px 18px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
    <div className="sk" style={{ width: 30, height: 30, borderRadius: '50%', flex: 'none' }} />
    {Array.from({ length: cols }).map((_, i) => <div key={i} style={{ flex: i === 0 ? 2 : 1 }}><Bar h={13} /></div>)}
  </div>
);

export function SkTable({ title }: { title?: string }) {
  return (
    <>
      <Head title={title} />
      <div className="card toolbar" style={{ display: 'flex', gap: 10 }}><Bar w="40%" h={38} /><Bar w={120} h={38} /><Bar w={120} h={38} /><Bar w={90} h={38} /></div>
      <div className="card tablecard">{Array.from({ length: 9 }).map((_, i) => <Row key={i} />)}</div>
    </>
  );
}

export function SkDashboard() {
  return (
    <>
      <div className="topload" />
      <Bar w={160} h={11} /><div style={{ height: 10 }} /><Bar w={420} h={34} /><Bar w={520} h={14} mt={12} /><div style={{ height: 22 }} />
      <div className="split">
        <div>
          <div className="grid g4" style={{ marginBottom: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="card"><div className="sk" style={{ width: 46, height: 46, borderRadius: '50%' }} /><Bar w={110} h={12} mt={14} /><Bar w={70} h={32} mt={12} /></div>)}</div>
          <div className="card"><Bar w={140} h={16} /><Bar w="92%" mt={16} /><Bar w="70%" mt={8} /></div>
          <div className="card tablecard"><div style={{ padding: 20 }}><Bar w={170} h={16} /></div>{Array.from({ length: 6 }).map((_, i) => <Row key={i} cols={4} />)}</div>
        </div>
        <div><div className="sk" style={{ height: 176, borderRadius: 14, marginBottom: 16 }} /><div className="card"><Bar w={120} h={16} />{[0, 1, 2, 3].map((i) => <Bar key={i} h={42} mt={14} />)}</div></div>
      </div>
    </>
  );
}

export function SkCards({ title }: { title?: string }) {
  return (
    <>
      <Head title={title} />
      <div className="grid g3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card"><div className="filters" style={{ flexWrap: 'nowrap' }}><div className="sk" style={{ width: 42, height: 42, borderRadius: '50%' }} /><div style={{ flex: 1 }}><Bar w="60%" h={15} /><Bar w="40%" h={11} mt={8} /></div></div><Bar h={44} mt={18} /><Bar w="70%" h={36} mt={14} /></div>)}</div>
    </>
  );
}

export function SkFeed({ title }: { title?: string }) {
  return (
    <>
      <Head title={title} />
      <div className="card">{Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}><div className="sk" style={{ width: 38, height: 38, borderRadius: '50%', flex: 'none' }} /><div style={{ flex: 1 }}><Bar w="45%" h={14} /><Bar w="25%" h={11} mt={8} /></div></div>)}</div>
    </>
  );
}

export function SkDetail() {
  return (
    <>
      <div className="topload" />
      <Bar w={150} h={13} /><div style={{ height: 18 }} />
      <div className="filters" style={{ flexWrap: 'nowrap', gap: 20 }}><div className="sk" style={{ width: 76, height: 76, borderRadius: '50%', flex: 'none' }} /><div style={{ flex: 1 }}><Bar w={260} h={30} /><Bar w={340} h={14} mt={12} /></div></div>
      <div className="grid g4" style={{ margin: '22px 0' }}>{[0, 1, 2, 3].map((i) => <Bar key={i} h={36} />)}</div>
      <div className="filters" style={{ gap: 28, borderBottom: '1px solid var(--line)', paddingBottom: 14, marginBottom: 22 }}>{[90, 110, 70, 80, 90].map((w, i) => <Bar key={i} w={w} h={14} />)}</div>
      <div className="split">
        <div><div className="grid g2" style={{ marginBottom: 16 }}><div className="card"><Bar w={160} h={16} /><Bar h={70} mt={16} /><Bar h={44} mt={14} /></div><div className="card"><Bar w={160} h={16} />{[0, 1, 2, 3, 4].map((i) => <Bar key={i} h={14} mt={14} />)}</div></div>
          <div className="card"><Bar w={120} h={16} /><div className="docs" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 96, borderRadius: 13 }} />)}</div></div></div>
        <div><div className="card"><Bar w={150} h={16} /><Bar h={50} mt={16} /></div><div className="card"><Bar w={120} h={16} />{[0, 1, 2, 3].map((i) => <Bar key={i} h={40} mt={14} />)}</div></div>
      </div>
    </>
  );
}

export function SkViewer() {
  return (
    <>
      <Head title="Documents" />
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <div className="card">{[0, 1, 2, 3, 4, 5].map((i) => <Bar key={i} h={36} mt={i ? 10 : 0} />)}</div>
        <div className="card"><Bar w="50%" h={16} /><div className="sk" style={{ height: '62vh', marginTop: 16, borderRadius: 12 }} /></div>
      </div>
    </>
  );
}

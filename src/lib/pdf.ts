// A tiny PDF writer: each photographed page becomes one A4 page holding a JPEG. No libraries, runs in the browser.
export type PdfPage = { jpeg: Uint8Array; w: number; h: number };

const enc = new TextEncoder();
export function buildPdf(pages: PdfPage[]): Uint8Array {
  const parts: Uint8Array[] = [], offsets: number[] = [];
  let size = 0;
  const push = (d: Uint8Array | string) => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); size += b.length; };
  const obj = (n: number, head: string, stream?: Uint8Array) => { offsets[n] = size; push(`${n} 0 obj\n${head}\n`); if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); } push('endobj\n'); };
  const A4W = 595, A4H = 842, M = 24;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, content = pg + 1, img = pg + 2;
    const k = Math.min((A4W - 2 * M) / p.w, (A4H - 2 * M) / p.h), dw = p.w * k, dh = p.h * k, x = (A4W - dw) / 2, y = (A4H - dh) / 2;
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`);
    const cs = enc.encode(`q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`);
    obj(content, `<< /Length ${cs.length} >>`, cs);
    obj(img, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
  });
  const total = 3 + pages.length * 3, xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(size); let at = 0;
  for (const b of parts) { out.set(b, at); at += b.length; }
  return out;
}

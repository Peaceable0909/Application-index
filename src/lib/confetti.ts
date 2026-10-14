// A small confetti burst drawn on a canvas laid over the page. No libraries. Skipped for people who ask for reduced motion.
type Opts = { x?: number; y?: number; count?: number; power?: number; colors?: string[] };
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#30b0c7', '#007aff', '#af52de', '#ff2d55'];

export function confetti(o: Opts = {}) {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9500';
  document.body.appendChild(c);
  const ctx = c.getContext('2d'); if (!ctx) { c.remove(); return; }
  ctx.scale(dpr, dpr);
  const cx = o.x ?? W / 2, cy = o.y ?? H * 0.38, n = o.count ?? 140, pw = o.power ?? 1, cols = o.colors || COLORS;
  const parts = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2, v = (4 + Math.random() * 11) * pw;
    return { x: cx, y: cy, vx: Math.cos(a) * v * (0.6 + Math.random() * 0.8), vy: Math.sin(a) * v - 5 * pw, w: 6 + Math.random() * 7, h: 4 + Math.random() * 6, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, c: cols[(Math.random() * cols.length) | 0], round: Math.random() < 0.25, life: 0 };
  });
  let raf = 0; const t0 = performance.now();
  const frame = (t: number) => {
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.34; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life += 1;
      const alpha = Math.max(0, Math.min(1, 1 - (el - 1800) / 1500));
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (el < 3400) raf = requestAnimationFrame(frame); else { cancelAnimationFrame(raf); c.remove(); }
  };
  raf = requestAnimationFrame(frame);
}

/** A confetti shower from the top (for bigger moments). */
export function confettiRain() { confetti({ x: window.innerWidth * 0.25, y: -10, count: 70, power: 0.6 }); setTimeout(() => confetti({ x: window.innerWidth * 0.75, y: -10, count: 70, power: 0.6 }), 160); setTimeout(() => confetti({ count: 120 }), 320); }

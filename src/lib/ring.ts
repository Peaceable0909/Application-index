// A soft two-tone ring built in the browser (no audio files). Browsers may keep it silent until the person has touched the page; the vibration and the screen still show the call.
export function startRing(mode: 'in' | 'out'): () => void {
  let ctx: AudioContext | null = null, timer: ReturnType<typeof setInterval> | null = null, stopped = false;
  const buzz = () => { try { navigator.vibrate?.(mode === 'in' ? [400, 200, 400] : 0); } catch { /* optional */ } };
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      ctx = new AC();
      const burst = () => {
        if (!ctx || stopped) return;
        void ctx.resume?.();
        const t0 = ctx.currentTime, beats = mode === 'in' ? [0, 0.6] : [0];
        for (const b of beats) for (const f of [440, 480]) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
          g.gain.setValueAtTime(0, t0 + b); g.gain.linearRampToValueAtTime(0.08, t0 + b + 0.04); g.gain.setValueAtTime(0.08, t0 + b + 0.4); g.gain.linearRampToValueAtTime(0, t0 + b + 0.46);
          o.start(t0 + b); o.stop(t0 + b + 0.5);
        }
        buzz();
      };
      burst(); timer = setInterval(burst, mode === 'in' ? 2600 : 3200);
    }
  } catch { /* silent is fine */ }
  return () => { stopped = true; if (timer) clearInterval(timer); try { void ctx?.close(); } catch { /* already closed */ } try { navigator.vibrate?.(0); } catch { /* optional */ } };
}

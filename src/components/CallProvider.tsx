'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CallKind, CallSignal, CallView } from '@/lib/callTypes';

export type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'live' | 'ended';
export type Peer = { name: string; sub?: string; avatar?: { name: string; url: string | null; color: string | null } | null };
export type Reaction = { id: number; e: string; x: number };
export const REACTIONS = ['👍', '❤️', '😂', '👏', '🎉', '🙏'];

type Reply = { ok?: boolean; error?: string; call?: CallView | null; signals?: CallSignal[]; appId?: string; peer?: Peer };
type Ctl = { t: 'cam' | 'screen' | 'mute'; on: boolean } | { t: 'react'; e: string } | { t: 'state'; cam: boolean; screen: boolean; mute: boolean };
type Streams = { audio: MediaStream | null; cam: MediaStream | null; screen: MediaStream | null };

export type CallApi = {
  phase: Phase; kind: CallKind; peer: Peer; note: string; minimized: boolean; muted: boolean; camOn: boolean; sharing: boolean;
  remoteMuted: boolean; remoteCam: boolean; remoteSharing: boolean; secs: number; quality: number;
  streams: Streams; camPreview: MediaStream | null; reactions: Reaction[]; canShare: boolean; canFlip: boolean;
  start: (appId: string, kind: CallKind, peer: Peer) => Promise<void>;
  accept: () => Promise<void>; decline: () => void; hangup: () => void;
  toggleMute: () => void; toggleCam: () => Promise<void>; flipCam: () => Promise<void>; toggleShare: () => Promise<void>;
  react: (e: string) => void; setMinimized: (v: boolean) => void;
  /** The chat's own refresh tells us what it knows about the current call (an incoming ring, or that the caller gave up). */
  offerServer: (appId: string, call: CallView | null, peer: Peer) => void;
  /** A chat that is open polls by itself, so the background "is anyone calling?" check stays quiet while one is mounted. */
  registerChat: () => () => void;
};

const Ctx = createContext<CallApi | null>(null);
export const useCallCtx = () => { const c = useContext(Ctx); if (!c) throw new Error('CallProvider is missing'); return c; };
/** Safe version for components that may render outside the provider (login pages, previews). */
export const useCallMaybe = () => useContext(Ctx);

const END_TEXT: Record<string, string> = { declined: 'Call declined', missed: 'No answer', ended: 'Call ended' };

export function CallProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [kind, setKind] = useState<CallKind>('voice');
  const [peer, setPeer] = useState<Peer>({ name: '' });
  const [note, setNote] = useState('');
  const [minimized, setMinimizedState] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteCam, setRemoteCam] = useState(false);
  const [remoteSharing, setRemoteSharing] = useState(false);
  const [secs, setSecs] = useState(0);
  const [quality, setQuality] = useState(3);
  const [streams, setStreams] = useState<Streams>({ audio: null, cam: null, screen: null });
  const [camPreview, setCamPreview] = useState<MediaStream | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [canShare, setCanShare] = useState(false);
  const [canFlip, setCanFlip] = useState(false);

  const phaseRef = useRef<Phase>('idle');
  const app = useRef('');
  const id = useRef<string | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null), scrTrack = useRef<MediaStreamTrack | null>(null);
  const camSender = useRef<RTCRtpSender | null>(null), scrSender = useRef<RTCRtpSender | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const facing = useRef<'user' | 'environment'>('user');
  const after = useRef(0), remoteSet = useRef(false), relay = useRef(false), rid = useRef(0);
  const pending = useRef<RTCIceCandidateInit[]>([]), outIce = useRef<RTCIceCandidateInit[]>([]);
  const timers = useRef<{ flush?: ReturnType<typeof setTimeout>; poll?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>; lost?: ReturnType<typeof setTimeout>; stats?: ReturnType<typeof setInterval> }>({});
  const dismissed = useRef(new Set<string>());
  const incoming = useRef<{ call: CallView; appId: string; peer: Peer } | null>(null);
  const on = useRef({ cam: false, share: false, mute: false });
  const chats = useRef(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const lastStats = useRef({ lost: 0, got: 0 });

  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const setMinimized = useCallback((v: boolean) => setMinimizedState(v && (phaseRef.current === 'live')), []);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  const post = useCallback(async (body: Record<string, unknown>): Promise<Reply> => {
    try {
      const r = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: app.current, ...body }) });
      return (await r.json()) as Reply;
    } catch { return { ok: false, error: 'No connection. Check your internet and try again.' }; }
  }, []);

  const ctl = useCallback((m: Ctl) => { try { if (dc.current?.readyState === 'open') dc.current.send(JSON.stringify(m)); } catch { /* the channel closed */ } }, []);

  const spawn = useCallback((e: string) => {
    const n = ++rid.current;
    setReactions((r) => [...r.slice(-10), { id: n, e, x: 14 + Math.random() * 72 }]);
    setTimeout(() => setReactions((r) => r.filter((x) => x.id !== n)), 2700);
  }, []);

  const cleanup = useCallback((why: string) => {
    const t = timers.current;
    if (t.poll) clearTimeout(t.poll); if (t.flush) clearTimeout(t.flush); if (t.lost) clearTimeout(t.lost); if (t.tick) clearInterval(t.tick); if (t.stats) clearInterval(t.stats);
    timers.current = {};
    try { dc.current?.close(); } catch { /* closed */ }
    try { pc.current?.close(); } catch { /* closed */ }
    pc.current = null; dc.current = null; camSender.current = null; scrSender.current = null;
    [local.current, camTrack.current ? new MediaStream([camTrack.current]) : null, scrTrack.current ? new MediaStream([scrTrack.current]) : null].forEach((s) => s?.getTracks().forEach((x) => x.stop()));
    local.current = null; camTrack.current = null; scrTrack.current = null;
    void wake.current?.release().catch(() => {}); wake.current = null;
    if (id.current) dismissed.current.add(id.current);
    id.current = null; after.current = 0; remoteSet.current = false; pending.current = []; outIce.current = []; facing.current = 'user';
    on.current = { cam: false, share: false, mute: false };
    setStreams({ audio: null, cam: null, screen: null }); setCamPreview(null); setReactions([]);
    setMuted(false); setCamOn(false); setSharing(false); setRemoteMuted(false); setRemoteCam(false); setRemoteSharing(false); setSecs(0); setQuality(3); setCanFlip(false); setMinimizedState(false);
    setNote(why); setPhase(why ? 'ended' : 'idle');
    if (why) setTimeout(() => { if (phaseRef.current === 'ended') { setPhase('idle'); setNote(''); } }, 1900);
  }, []);

  /** Something went wrong on our side: tell the server the call is over, then say why. */
  const fail = useCallback((why: string) => { const cid = id.current; if (cid) void post({ action: 'end', callId: cid }); cleanup(why); }, [post, cleanup]);

  const sendSignal = useCallback((k: 'offer' | 'answer' | 'ice', data: unknown) => { const cid = id.current; return cid ? post({ action: 'signal', callId: cid, kind: k, data }) : Promise.resolve({} as Reply); }, [post]);

  const queueIce = useCallback((c: RTCIceCandidateInit) => {
    outIce.current.push(c);
    if (timers.current.flush) return;
    timers.current.flush = setTimeout(() => { timers.current.flush = undefined; const batch = outIce.current; outIce.current = []; if (batch.length) void sendSignal('ice', batch); }, 250);
  }, [sendSignal]);

  const markLive = useCallback(() => {
    if (phaseRef.current === 'live') return;
    setPhase('live'); setNote(''); setSecs(0);
    timers.current.tick = setInterval(() => setSecs((s) => s + 1), 1000);
    // a rough "how is the line" reading from the connection's own statistics
    timers.current.stats = setInterval(async () => {
      const conn = pc.current; if (!conn) return;
      try {
        const rep = await conn.getStats(); let rtt: number | null = null, lost = 0, got = 0;
        rep.forEach((r) => {
          if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000;
          if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost = r.packetsLost || 0; got = r.packetsReceived || 0; }
        });
        const dl = lost - lastStats.current.lost, dg = got - lastStats.current.got; lastStats.current = { lost, got };
        const loss = dg + dl > 0 ? dl / (dg + dl) : 0;
        setQuality(rtt !== null && (rtt > 600 || loss > 0.15) ? 1 : rtt !== null && (rtt > 300 || loss > 0.06) ? 2 : 3);
      } catch { /* stats are a nicety */ }
    }, 3000);
    // keep the screen awake while talking
    try { void (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((w) => { wake.current = w; }).catch(() => {}); } catch { /* optional */ }
  }, []);

  const applyIce = useCallback(async (list: RTCIceCandidateInit[]) => {
    for (const c of list) { if (remoteSet.current) { try { await pc.current?.addIceCandidate(c); } catch { /* a late or duplicate candidate */ } } else pending.current.push(c); }
  }, []);

  const handleSignal = useCallback(async (s: CallSignal) => {
    const conn = pc.current; if (!conn) return;
    if (s.kind === 'ice') { await applyIce(Array.isArray(s.data) ? (s.data as RTCIceCandidateInit[]) : [s.data as RTCIceCandidateInit]); return; }
    if (s.kind === 'offer' && conn.signalingState === 'stable' && !remoteSet.current) {
      await conn.setRemoteDescription(s.data as RTCSessionDescriptionInit); remoteSet.current = true;
      const vids = conn.getTransceivers().filter((x) => x.receiver.track.kind === 'video');
      if (vids[0]) { vids[0].direction = 'sendrecv'; camSender.current = vids[0].sender; if (camTrack.current) await vids[0].sender.replaceTrack(camTrack.current); }
      if (vids[1]) { vids[1].direction = 'sendrecv'; scrSender.current = vids[1].sender; }
      const list = pending.current; pending.current = []; await applyIce(list);
      const ans = await conn.createAnswer(); await conn.setLocalDescription(ans); await sendSignal('answer', conn.localDescription);
    } else if (s.kind === 'answer' && conn.signalingState === 'have-local-offer') {
      await conn.setRemoteDescription(s.data as RTCSessionDescriptionInit); remoteSet.current = true;
      const list = pending.current; pending.current = []; await applyIce(list);
    }
  }, [applyIce, sendSignal]);

  const poll = useCallback(async () => {
    const cid = id.current; if (!cid) return;
    try {
      const r = await fetch(`/api/call?app=${encodeURIComponent(app.current)}&call=${cid}&after=${after.current}`, { cache: 'no-store' });
      const j = (await r.json()) as Reply;
      if (id.current !== cid) return;
      const st = j.call?.status;
      if (!j.call || st === 'ended' || st === 'declined' || st === 'missed') {
        cleanup(st === 'missed' && phaseRef.current !== 'outgoing' ? END_TEXT.ended : END_TEXT[st || 'ended']); return;
      }
      if (st === 'active' && phaseRef.current === 'outgoing') setPhase('connecting');
      for (const s of j.signals || []) { after.current = Math.max(after.current, s.id); try { await handleSignal(s); } catch { /* wait for the next one */ } }
    } catch { /* offline for a moment: try again */ }
    if (id.current === cid) timers.current.poll = setTimeout(poll, phaseRef.current === 'live' ? 2500 : 700);
  }, [cleanup, handleSignal]);

  const onCtl = useCallback((m: Ctl) => {
    if (m.t === 'cam') setRemoteCam(m.on);
    else if (m.t === 'screen') { setRemoteSharing(m.on); if (m.on) setMinimizedState(false); }
    else if (m.t === 'mute') setRemoteMuted(m.on);
    else if (m.t === 'state') { setRemoteCam(!!m.cam); setRemoteSharing(!!m.screen); setRemoteMuted(!!m.mute); if (m.screen) setMinimizedState(false); }
    else if (m.t === 'react' && typeof m.e === 'string' && m.e.length <= 8) spawn(m.e);
  }, [spawn]);

  const startCam = useCallback(async (face: 'user' | 'environment') => {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face, width: { ideal: 640 }, height: { ideal: 480 } } });
    const t = s.getVideoTracks()[0];
    await camSender.current?.replaceTrack(t);
    camTrack.current?.stop(); camTrack.current = t; facing.current = face;
    setCamPreview(new MediaStream([t])); on.current.cam = true; setCamOn(true); ctl({ t: 'cam', on: true });
    navigator.mediaDevices.enumerateDevices().then((d) => setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1)).catch(() => {});
  }, [ctl]);

  const stopCam = useCallback(() => {
    camTrack.current?.stop(); camTrack.current = null; void camSender.current?.replaceTrack(null);
    setCamPreview(null); on.current.cam = false; setCamOn(false); setCanFlip(false); ctl({ t: 'cam', on: false });
  }, [ctl]);

  const stopShare = useCallback(() => {
    scrTrack.current?.stop(); scrTrack.current = null; void scrSender.current?.replaceTrack(null);
    on.current.share = false; setSharing(false); ctl({ t: 'screen', on: false });
  }, [ctl]);

  /** Microphone (and camera), then the connection itself. Returns false if it could not be set up. */
  const prepare = useCallback(async (k: CallKind, caller: boolean): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { fail('Calls aren’t supported in this browser.'); return false; }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    let stream: MediaStream | null = null, camBlocked = false;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio, video: k === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false }); }
    catch (e) {
      const n = (e as DOMException).name;
      if (k === 'video' && n !== 'NotAllowedError') { try { stream = await navigator.mediaDevices.getUserMedia({ audio }); camBlocked = true; } catch { /* handled below */ } }
      if (!stream) { fail(n === 'NotAllowedError' ? 'Allow the microphone to make calls, then try again.' : n === 'NotFoundError' ? 'No microphone was found.' : 'Could not start the microphone.'); return false; }
    }
    if (camBlocked) setNote('Camera unavailable: voice only');
    local.current = stream;
    const ice = (await fetch(`/api/call/ice?app=${encodeURIComponent(app.current)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)) as { iceServers?: RTCIceServer[]; relay?: boolean } | null;
    relay.current = !!ice?.relay;
    const conn = new RTCPeerConnection({ iceServers: ice?.iceServers?.length ? ice.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.current = conn;
    // Three media lines (voice, camera, screen) so camera and screen can be switched on later by swapping a track: no renegotiation.
    // The caller creates them in its offer. The answerer can't pre-create them (a browser only matches an incoming offer to transceivers made
    // with addTrack), so it switches the offered camera/screen lines to send-and-receive right after reading the offer (see handleSignal).
    stream.getAudioTracks().forEach((t) => conn.addTrack(t, stream!));
    const vt = stream.getVideoTracks()[0] || null;
    if (caller) {
      const camT = conn.addTransceiver(vt || 'video', { direction: 'sendrecv', streams: [stream] });
      const scrT = conn.addTransceiver('video', { direction: 'sendrecv' });
      camSender.current = camT.sender; scrSender.current = scrT.sender;
    }
    if (vt) { camTrack.current = vt; setCamPreview(new MediaStream([vt])); on.current.cam = true; setCamOn(true); navigator.mediaDevices.enumerateDevices().then((d) => setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1)).catch(() => {}); }
    // a small side channel for "my camera is off", "I'm sharing", reactions
    const ch = conn.createDataChannel('ctl', { negotiated: true, id: 0 });
    dc.current = ch;
    ch.onopen = () => ctl({ t: 'state', cam: on.current.cam, screen: on.current.share, mute: on.current.mute });
    ch.onmessage = (ev) => { try { onCtl(JSON.parse(String(ev.data)) as Ctl); } catch { /* ignore junk */ } };
    const rA = new MediaStream(), rC = new MediaStream(), rS = new MediaStream();
    setStreams({ audio: rA, cam: rC, screen: rS });
    conn.ontrack = (e) => {
      const t = e.track;
      if (t.kind === 'audio') { if (!rA.getTracks().includes(t)) rA.addTrack(t); return; }
      const idx = conn.getTransceivers().filter((x) => x.receiver.track.kind === 'video').indexOf(e.transceiver);
      const target = idx === 1 ? rS : rC;
      if (!target.getTracks().includes(t)) target.addTrack(t);
      t.onunmute = () => { if (idx === 1) { setRemoteSharing(true); setMinimizedState(false); } else setRemoteCam(true); };
    };
    conn.onicecandidate = (e) => { if (e.candidate) queueIce(e.candidate.toJSON()); };
    conn.onconnectionstatechange = () => {
      const s = conn.connectionState;
      if (timers.current.lost && s !== 'disconnected') { clearTimeout(timers.current.lost); timers.current.lost = undefined; }
      if (s === 'connected') markLive();
      else if (s === 'failed') fail(relay.current ? 'Couldn’t connect. Check your internet and try again.' : 'Couldn’t connect: this network blocks direct calls.');
      else if (s === 'disconnected') timers.current.lost = setTimeout(() => { if (pc.current === conn && conn.connectionState !== 'connected') fail('Connection lost'); }, 8000);
    };
    return true;
  }, [fail, ctl, onCtl, queueIce, markLive]);

  const start = useCallback(async (appId: string, k: CallKind, who: Peer) => {
    if (phaseRef.current !== 'idle') return;
    app.current = appId; setPeer(who); setKind(k); setNote(''); setPhase('outgoing'); setMinimizedState(false);
    const j = await post({ action: 'start', kind: k });
    if (!j.ok || !j.call) { cleanup(j.error || 'Could not start the call.'); return; }
    id.current = j.call.id;
    if (!(await prepare(k, true))) return;
    try { const conn = pc.current!; const offer = await conn.createOffer(); await conn.setLocalDescription(offer); await sendSignal('offer', conn.localDescription); }
    catch { fail('Could not start the call.'); return; }
    void poll();
  }, [post, cleanup, prepare, sendSignal, fail, poll]);

  const accept = useCallback(async () => {
    const s = incoming.current; if (!s || phaseRef.current !== 'incoming') return;
    app.current = s.appId; id.current = s.call.id; setPeer(s.peer); setKind(s.call.kind); setPhase('connecting'); setNote('');
    if (!(await prepare(s.call.kind, false))) return;
    const j = await post({ action: 'answer', callId: s.call.id });
    if (!j.ok) { cleanup(j.error || 'The call has ended.'); return; }
    void poll();
  }, [prepare, post, cleanup, poll]);

  const decline = useCallback(() => {
    const s = incoming.current; if (!s) return;
    app.current = s.appId; dismissed.current.add(s.call.id); void post({ action: 'decline', callId: s.call.id }); incoming.current = null; setPhase('idle');
  }, [post]);

  const hangup = useCallback(() => { const cid = id.current; if (cid) void post({ action: 'end', callId: cid }); cleanup('Call ended'); }, [post, cleanup]);

  const toggleMute = useCallback(() => {
    const next = !on.current.mute; on.current.mute = next;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next); ctl({ t: 'mute', on: next });
  }, [ctl]);

  const flash = useCallback((m: string) => { setNote(m); setTimeout(() => setNote((n) => (n === m ? '' : n)), 3500); }, []);

  const toggleCam = useCallback(async () => {
    if (on.current.cam) { stopCam(); return; }
    try { await startCam(facing.current); } catch (e) { flash((e as DOMException).name === 'NotAllowedError' ? 'Allow the camera to turn it on' : 'Could not start the camera'); }
  }, [startCam, stopCam, flash]);

  const flipCam = useCallback(async () => {
    try { await startCam(facing.current === 'user' ? 'environment' : 'user'); } catch { flash('Could not switch cameras'); }
  }, [startCam, flash]);

  const toggleShare = useCallback(async () => {
    if (on.current.share) { stopShare(); return; }
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      const t = ds.getVideoTracks()[0];
      try { (t as MediaStreamTrack & { contentHint: string }).contentHint = 'detail'; } catch { /* optional */ }
      await scrSender.current?.replaceTrack(t);
      try { const p = scrSender.current?.getParameters(); if (p && p.encodings?.length) { p.encodings[0].maxBitrate = 2_500_000; await scrSender.current?.setParameters(p); } } catch { /* the default bitrate is fine */ }
      scrTrack.current = t; t.onended = () => { if (scrTrack.current === t) stopShare(); };
      on.current.share = true; setSharing(true); ctl({ t: 'screen', on: true });
    } catch (e) { if ((e as DOMException).name !== 'NotAllowedError') flash('Could not share your screen'); }
  }, [stopShare, ctl, flash]);

  const react = useCallback((e: string) => { ctl({ t: 'react', e }); spawn(e); }, [ctl, spawn]);

  const offerServer = useCallback((appId: string, call: CallView | null, who: Peer) => {
    if (call && call.status === 'ringing' && !call.mine && !dismissed.current.has(call.id)) {
      incoming.current = { call, appId, peer: who };
      if (phaseRef.current === 'idle') { setPeer(who); setKind(call.kind); setPhase('incoming'); }
    } else if (phaseRef.current === 'incoming') { incoming.current = null; setPhase('idle'); }
  }, []);

  const registerChat = useCallback(() => { chats.current++; return () => { chats.current = Math.max(0, chats.current - 1); }; }, []);

  // Background "is anyone calling me?" (only while idle and visible).
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== 'visible' || phaseRef.current !== 'idle') return; // runs even with a chat open: the staff messenger shows one student's chat while another student may call
      try {
        const r = await fetch('/api/call/ring', { cache: 'no-store' }); if (!r.ok) return;
        const j = (await r.json()) as Reply; if (stop) return;
        if (j.call && j.appId && j.peer) offerServer(j.appId, j.call, j.peer);
        else if ((phaseRef.current as Phase) === 'incoming' && chats.current === 0) { incoming.current = null; setPhase('idle'); }
      } catch { /* try next time */ }
    };
    // the server nudges us the moment a call starts (RealtimeNudge); this slower check is only the safety net
    const t = setInterval(tick, 6000), first = setTimeout(tick, 1500);
    const v = () => { if (document.visibilityState === 'visible') void tick(); };
    const nd = (e: Event) => { const k = (e as CustomEvent<{ event?: string }>).detail?.event; if (k === 'ring' || k === 'call' || k === 'wake') void tick(); };
    document.addEventListener('visibilitychange', v); window.addEventListener('wr:nudge', nd);
    return () => { stop = true; clearInterval(t); clearTimeout(first); document.removeEventListener('visibilitychange', v); window.removeEventListener('wr:nudge', nd); };
  }, [enabled, offerServer]);

  // Closing the tab hangs up, so the other person isn't left holding the line.
  useEffect(() => {
    const bye = () => { const cid = id.current; if (cid && phaseRef.current !== 'idle') navigator.sendBeacon?.('/api/call', new Blob([JSON.stringify({ app: app.current, action: 'end', callId: cid })], { type: 'application/json' })); };
    const v = () => { if (document.visibilityState === 'visible' && phaseRef.current === 'live') void (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((w) => { wake.current = w; }).catch(() => {}); };
    window.addEventListener('pagehide', bye); document.addEventListener('visibilitychange', v);
    return () => { window.removeEventListener('pagehide', bye); document.removeEventListener('visibilitychange', v); bye(); };
  }, []);

  const value = useMemo<CallApi>(() => ({
    phase, kind, peer, note, minimized, muted, camOn, sharing, remoteMuted, remoteCam, remoteSharing, secs, quality, streams, camPreview, reactions, canShare, canFlip,
    start, accept, decline, hangup, toggleMute, toggleCam, flipCam, toggleShare, react, setMinimized, offerServer, registerChat,
  }), [phase, kind, peer, note, minimized, muted, camOn, sharing, remoteMuted, remoteCam, remoteSharing, secs, quality, streams, camPreview, reactions, canShare, canFlip,
    start, accept, decline, hangup, toggleMute, toggleCam, flipCam, toggleShare, react, setMinimized, offerServer, registerChat]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

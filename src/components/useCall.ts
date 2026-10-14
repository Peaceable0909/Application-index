'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallKind, CallSignal, CallView } from '@/lib/callTypes';

export type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'live' | 'ended';
type Reply = { ok?: boolean; error?: string; call?: CallView | null; signals?: CallSignal[] };

/**
 * One call at a time, browser to browser (WebRTC). The portal only passes the "how to reach me" messages along;
 * `server` is what the chat's regular refresh says about the current call, which is how an incoming call is noticed.
 */
export function useCall({ appId, server }: { appId: string; server: CallView | null }) {
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [kind, setKind] = useState<CallKind>('voice');
  const [note, setNote] = useState('');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [secs, setSecs] = useState(0);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteVideo, setRemoteVideo] = useState(false);

  const phaseRef = useRef<Phase>('idle');
  const id = useRef<string | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const after = useRef(0), remoteSet = useRef(false), relay = useRef(false);
  const pending = useRef<RTCIceCandidateInit[]>([]), outIce = useRef<RTCIceCandidateInit[]>([]);
  const timers = useRef<{ flush?: ReturnType<typeof setTimeout>; poll?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>; lost?: ReturnType<typeof setTimeout> }>({});
  const dismissed = useRef(new Set<string>());
  const incoming = useRef<CallView | null>(null);
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const enc = encodeURIComponent(appId);

  const post = useCallback(async (body: Record<string, unknown>): Promise<Reply> => {
    try {
      const r = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: appId, ...body }) });
      return (await r.json()) as Reply;
    } catch { return { ok: false, error: 'No connection. Check your internet and try again.' }; }
  }, [appId]);

  const cleanup = useCallback((why: string) => {
    const t = timers.current;
    if (t.poll) clearTimeout(t.poll); if (t.flush) clearTimeout(t.flush); if (t.lost) clearTimeout(t.lost); if (t.tick) clearInterval(t.tick);
    timers.current = {};
    try { pc.current?.close(); } catch { /* already closed */ }
    pc.current = null;
    local.current?.getTracks().forEach((x) => x.stop());
    local.current = null; setLocalStream(null); setRemote(null); setRemoteVideo(false);
    if (id.current) dismissed.current.add(id.current);
    id.current = null; after.current = 0; remoteSet.current = false; pending.current = []; outIce.current = [];
    setMuted(false); setCamOff(false); setSecs(0);
    setNote(why); setPhase(why ? 'ended' : 'idle');
    if (why) setTimeout(() => { if (phaseRef.current === 'ended') { setPhase('idle'); setNote(''); } }, 1800);
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
  }, []);

  const applyIce = useCallback(async (list: RTCIceCandidateInit[]) => {
    for (const c of list) { if (remoteSet.current) { try { await pc.current?.addIceCandidate(c); } catch { /* a late or duplicate candidate */ } } else pending.current.push(c); }
  }, []);

  const handleSignal = useCallback(async (s: CallSignal) => {
    const conn = pc.current; if (!conn) return;
    if (s.kind === 'ice') { await applyIce(Array.isArray(s.data) ? (s.data as RTCIceCandidateInit[]) : [s.data as RTCIceCandidateInit]); return; }
    if (s.kind === 'offer' && conn.signalingState === 'stable' && !remoteSet.current) {
      await conn.setRemoteDescription(s.data as RTCSessionDescriptionInit); remoteSet.current = true;
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
      const r = await fetch(`/api/call?app=${enc}&call=${cid}&after=${after.current}`, { cache: 'no-store' });
      const j = (await r.json()) as Reply;
      if (id.current !== cid) return;
      const st = j.call?.status;
      if (!j.call || st === 'ended' || st === 'declined' || st === 'missed') {
        cleanup(st === 'declined' ? 'Call declined' : st === 'missed' && phaseRef.current === 'outgoing' ? 'No answer' : 'Call ended'); return;
      }
      if (st === 'active' && phaseRef.current === 'outgoing') setPhase('connecting');
      for (const s of j.signals || []) { after.current = Math.max(after.current, s.id); try { await handleSignal(s); } catch { /* wait for the next one */ } }
    } catch { /* offline for a moment: try again */ }
    if (id.current === cid) timers.current.poll = setTimeout(poll, phaseRef.current === 'live' ? 2500 : 700);
  }, [enc, cleanup, handleSignal]);

  /** Microphone (and camera), then the connection itself. Returns false if it could not be set up. */
  const prepare = useCallback(async (k: CallKind): Promise<boolean> => {
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
    local.current = stream; setLocalStream(stream);
    const ice = (await fetch(`/api/call/ice?app=${enc}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)) as { iceServers?: RTCIceServer[]; relay?: boolean } | null;
    relay.current = !!ice?.relay;
    const conn = new RTCPeerConnection({ iceServers: ice?.iceServers?.length ? ice.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.current = conn;
    stream.getTracks().forEach((t) => conn.addTrack(t, stream!));
    const rs = new MediaStream(); setRemote(rs);
    conn.ontrack = (e) => { if (!rs.getTracks().includes(e.track)) rs.addTrack(e.track); setRemoteVideo(rs.getVideoTracks().length > 0); };
    conn.onicecandidate = (e) => { if (e.candidate) queueIce(e.candidate.toJSON()); };
    conn.onconnectionstatechange = () => {
      const s = conn.connectionState;
      if (timers.current.lost && s !== 'disconnected') { clearTimeout(timers.current.lost); timers.current.lost = undefined; }
      if (s === 'connected') markLive();
      else if (s === 'failed') fail(relay.current ? 'Couldn’t connect. Check your internet and try again.' : 'Couldn’t connect: this network blocks direct calls.');
      else if (s === 'disconnected') timers.current.lost = setTimeout(() => { if (pc.current === conn && conn.connectionState !== 'connected') fail('Connection lost'); }, 8000);
    };
    return true;
  }, [enc, fail, queueIce, markLive]);

  const start = useCallback(async (k: CallKind) => {
    if (phaseRef.current !== 'idle') return;
    setKind(k); setNote(''); setPhase('outgoing');
    const j = await post({ action: 'start', kind: k });
    if (!j.ok || !j.call) { cleanup(j.error || 'Could not start the call.'); return; }
    id.current = j.call.id;
    if (!(await prepare(k))) return;
    try { const conn = pc.current!; const offer = await conn.createOffer(); await conn.setLocalDescription(offer); await sendSignal('offer', conn.localDescription); }
    catch { fail('Could not start the call.'); return; }
    void poll();
  }, [post, cleanup, prepare, sendSignal, fail, poll]);

  const accept = useCallback(async () => {
    const s = incoming.current; if (!s || phaseRef.current !== 'incoming') return;
    id.current = s.id; setKind(s.kind); setPhase('connecting'); setNote('');
    if (!(await prepare(s.kind))) return;
    const j = await post({ action: 'answer', callId: s.id });
    if (!j.ok) { cleanup(j.error || 'The call has ended.'); return; }
    void poll();
  }, [prepare, post, cleanup, poll]);

  const decline = useCallback(() => {
    const s = incoming.current; if (!s) return;
    dismissed.current.add(s.id); void post({ action: 'decline', callId: s.id }); incoming.current = null; setPhase('idle');
  }, [post]);

  const hangup = useCallback(() => { const cid = id.current; if (cid) void post({ action: 'end', callId: cid }); cleanup('Call ended'); }, [post, cleanup]);

  const toggleMute = useCallback(() => { const next = !muted; local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; }); setMuted(next); }, [muted]);
  const toggleCam = useCallback(() => { const next = !camOff; local.current?.getVideoTracks().forEach((t) => { t.enabled = !next; }); setCamOff(next); }, [camOff]);

  // The chat's refresh tells us about a call someone else started (or that they gave up).
  useEffect(() => {
    if (server && server.status === 'ringing' && !server.mine && !dismissed.current.has(server.id)) {
      incoming.current = server;
      if (phaseRef.current === 'idle') { setKind(server.kind); setPhase('incoming'); }
    } else if (phaseRef.current === 'incoming') { incoming.current = null; setPhase('idle'); }
  }, [server]);

  // Leaving the page mid-call hangs up, so the other person isn't left holding the line.
  useEffect(() => {
    const bye = () => { const cid = id.current; if (cid && phaseRef.current !== 'idle') navigator.sendBeacon?.('/api/call', new Blob([JSON.stringify({ app: appId, action: 'end', callId: cid })], { type: 'application/json' })); };
    window.addEventListener('pagehide', bye);
    return () => { window.removeEventListener('pagehide', bye); bye(); cleanup(''); };
  }, [appId, cleanup]);

  return { phase, kind, note, muted, camOff, secs, remote, localStream, remoteVideo, start, accept, decline, hangup, toggleMute, toggleCam };
}
export type CallApi = ReturnType<typeof useCall>;

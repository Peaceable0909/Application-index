'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import { REACTIONS, useCallMaybe } from './CallProvider';
import { startRing } from '@/lib/ring';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const S = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const I = {
  mic: <svg {...S}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>,
  micOff: <svg {...S}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3M4 4l16 16" /></svg>,
  cam: <svg {...S}><path d="M3 7a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM16 10l5-3v10l-5-3" /></svg>,
  camOff: <svg {...S}><path d="M3 7a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM16 10l5-3v10l-5-3M3 3l18 18" /></svg>,
  flip: <svg {...S}><path d="M4 8V5h3M20 16v3h-3M5.5 9A8 8 0 0119 8M18.5 15A8 8 0 015 16" /></svg>,
  screen: <svg {...S}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M12 13V8m0 0l-2.5 2.5M12 8l2.5 2.5" /></svg>,
  smile: <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4.5 4.5 0 007 0M9 9.5h.01M15 9.5h.01" /></svg>,
  phone: <svg {...S}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>,
  video: <svg {...S}><path d="M3 7a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM15 10l6-3v10l-6-3" /></svg>,
  down: <svg {...S} width={24} height={24}><path d="M6 9l6 6 6-6" /></svg>,
};

function Bars({ n }: { n: number }) {
  return <span className={`cu-bars q${n}`} role="img" aria-label={n === 3 ? 'Good connection' : n === 2 ? 'Fair connection' : 'Weak connection'}><i /><i /><i /></span>;
}

/** Full-screen call, plus a small "call in progress" pill when you step away to another page. Mounted once, above every page. */
export default function CallOverlay() {
  const c = useCallMaybe();
  const rv = useRef<HTMLVideoElement>(null), sv = useRef<HTMLVideoElement>(null), pv = useRef<HTMLVideoElement>(null), ra = useRef<HTMLAudioElement>(null), lv = useRef<HTMLVideoElement>(null);
  const [tray, setTray] = useState(false);
  const phase = c?.phase ?? 'idle', streams = c?.streams, camPreview = c?.camPreview ?? null, remoteSharing = c?.remoteSharing, remoteCam = c?.remoteCam, camOn = c?.camOn;

  useEffect(() => { if (ra.current) ra.current.srcObject = streams?.audio ?? null; }, [streams?.audio, phase]);
  useEffect(() => { if (rv.current) rv.current.srcObject = streams?.cam ?? null; }, [streams?.cam, remoteCam, remoteSharing, phase, c?.minimized]);
  useEffect(() => { if (sv.current) sv.current.srcObject = streams?.screen ?? null; }, [streams?.screen, remoteSharing, phase, c?.minimized]);
  useEffect(() => { if (pv.current) pv.current.srcObject = streams?.cam ?? null; }, [streams?.cam, remoteCam, remoteSharing, phase, c?.minimized]);
  useEffect(() => { if (lv.current) lv.current.srcObject = camPreview; }, [camPreview, camOn, remoteSharing, remoteCam, phase, c?.minimized]);
  useEffect(() => {
    if (phase !== 'incoming' && phase !== 'outgoing') return;
    return startRing(phase === 'incoming' ? 'in' : 'out');
  }, [phase]);
  useEffect(() => { if (phase !== 'live') setTray(false); }, [phase]);

  if (!c || phase === 'idle' || typeof document === 'undefined') return null;
  const { kind, peer, note, minimized, muted, sharing, remoteMuted, secs, quality, reactions, canShare, canFlip } = c;
  const name = peer.name || 'Call';
  const word = kind === 'video' ? 'video' : 'voice';

  const pill = phase === 'live' && minimized;
  if (pill) {
    return createPortal(
      <>
        <audio ref={ra} autoPlay playsInline />
        <div className="callpill" role="button" tabIndex={0} onClick={() => c.setMinimized(false)} onKeyDown={(e) => { if (e.key === 'Enter') c.setMinimized(false); }} aria-label={`Call with ${name}, ${mmss(secs)}. Tap to open.`}>
          <Avatar name={peer.avatar?.name || name} url={peer.avatar?.url} color={peer.avatar?.color} size={30} />
          <span className="cp-who"><b>{name.split(/\s+/)[0]}</b><small>{sharing ? 'Sharing screen' : 'On call'} · {mmss(secs)}</small></span>
          <button type="button" className={`cp-b ${muted ? 'on' : ''}`} aria-label={muted ? 'Unmute' : 'Mute'} onClick={(e) => { e.stopPropagation(); c.toggleMute(); }}>{muted ? I.micOff : I.mic}</button>
          <button type="button" className="cp-b end" aria-label="End call" onClick={(e) => { e.stopPropagation(); c.hangup(); }}>{I.phone}</button>
        </div>
      </>, document.body);
  }

  const stageScreen = !!remoteSharing, stageCam = !stageScreen && !!remoteCam && phase === 'live';
  const hasStage = stageScreen || stageCam;
  const pipRemote = stageScreen && !!remoteCam, pipSelf = camOn && !pipRemote;
  const status = phase === 'incoming' ? `Incoming ${word} call` : phase === 'outgoing' ? 'Calling…' : phase === 'connecting' ? (note || 'Connecting…')
    : phase === 'live' ? (note ? `${mmss(secs)} · ${note}` : mmss(secs)) : note;
  const pulse = phase === 'incoming' || phase === 'outgoing' || phase === 'connecting';

  return createPortal(
    <div className={`callui ${hasStage ? 'has-stage' : ''} ${stageScreen ? 'is-screen' : ''}`} role="dialog" aria-label={`${word} call with ${name}`} onClick={(e) => { e.stopPropagation(); if (tray) setTray(false); }}>
      <audio ref={ra} autoPlay playsInline />
      <div className="cu-glow" aria-hidden />
      {stageScreen && <video ref={sv} className="callui-screen" autoPlay playsInline />}
      {stageCam && <video ref={rv} className="callui-remote" autoPlay playsInline />}

      <header className="callui-head">
        {phase === 'live' ? <button type="button" className="cu-min" onClick={() => c.setMinimized(true)} aria-label="Minimise the call">{I.down}</button> : <span />}
        {phase === 'live' && <Bars n={quality} />}
      </header>

      {sharing && <div className="callui-share" onClick={(e) => e.stopPropagation()}><i className="cu-rec" /><span>You’re sharing your screen</span><button type="button" onClick={() => void c.toggleShare()}>Stop</button></div>}

      <div className="callui-top">
        {!hasStage && <div className={`callui-pic ${pulse ? 'pulse' : ''}`}><Avatar name={peer.avatar?.name || name} url={peer.avatar?.url} color={peer.avatar?.color} size={132} /></div>}
        <b className="callui-name">{name}</b>
        <span className={`callui-status ${phase === 'ended' ? 'end' : ''}`}>{status}</span>
        {phase === 'live' && remoteMuted && <span className="cu-muted">{I.micOff} Muted</span>}
      </div>

      {pipRemote && <video ref={pv} className="callui-local pip-remote" autoPlay playsInline muted />}
      {pipSelf && <video ref={lv} className="callui-local" autoPlay playsInline muted />}

      <div className="cu-float" aria-hidden>{reactions.map((r) => <span key={r.id} style={{ left: `${r.x}%` }}>{r.e}</span>)}</div>

      {tray && phase === 'live' && <div className="cu-tray" onClick={(e) => e.stopPropagation()}>{REACTIONS.map((e) => <button key={e} type="button" onClick={() => c.react(e)} aria-label={`React ${e}`}>{e}</button>)}</div>}

      <div className="callui-bar" onClick={(e) => e.stopPropagation()}>
        {phase === 'incoming' ? (
          <>
            <div className="callui-act"><button type="button" className="cbtn cb-stop" onClick={c.decline} aria-label="Decline">{I.phone}</button><span>Decline</span></div>
            <div className="callui-act"><button type="button" className="cbtn cb-go cb-ring" onClick={() => void c.accept()} aria-label="Accept">{kind === 'video' ? I.video : I.phone}</button><span>Accept</span></div>
          </>
        ) : phase === 'ended' ? null : (
          <>
            <div className="callui-act"><button type="button" className={`cbtn ${muted ? 'on' : ''}`} onClick={c.toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? I.micOff : I.mic}</button><span>{muted ? 'Unmute' : 'Mute'}</span></div>
            {phase === 'live' && <div className="callui-act"><button type="button" className={`cbtn ${camOn ? 'on' : ''}`} onClick={() => void c.toggleCam()} aria-pressed={camOn} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}>{camOn ? I.cam : I.camOff}</button><span>Camera</span></div>}
            {phase === 'live' && camOn && canFlip && <div className="callui-act"><button type="button" className="cbtn" onClick={() => void c.flipCam()} aria-label="Switch camera">{I.flip}</button><span>Flip</span></div>}
            {phase === 'live' && canShare && <div className="callui-act"><button type="button" className={`cbtn ${sharing ? 'on' : ''}`} onClick={() => void c.toggleShare()} aria-pressed={sharing} aria-label={sharing ? 'Stop sharing' : 'Share screen'}>{I.screen}</button><span>{sharing ? 'Stop' : 'Share'}</span></div>}
            {phase === 'live' && <div className="callui-act"><button type="button" className={`cbtn ${tray ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setTray((v) => !v); }} aria-label="Reactions">{I.smile}</button><span>React</span></div>}
            <div className="callui-act"><button type="button" className="cbtn cb-stop" onClick={c.hangup} aria-label="End call">{I.phone}</button><span>{phase === 'live' ? 'End' : 'Cancel'}</span></div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

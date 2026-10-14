'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import Icon from './Icon';
import { startRing } from '@/lib/ring';
import type { CallApi } from './useCall';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Full-screen call: ringing, connecting and the live call, in the same look for students and staff. */
export default function CallOverlay({ call, name, avatar }: { call: CallApi; name: string; avatar?: { name: string; url: string | null; color: string | null } }) {
  const { phase, kind, note, muted, camOff, secs, remote, localStream, remoteVideo } = call;
  const rv = useRef<HTMLVideoElement>(null), lv = useRef<HTMLVideoElement>(null), ra = useRef<HTMLAudioElement>(null);

  useEffect(() => { if (rv.current) rv.current.srcObject = remote; if (ra.current) ra.current.srcObject = remote; }, [remote, phase, remoteVideo]);
  useEffect(() => { if (lv.current) lv.current.srcObject = localStream; }, [localStream, phase]);
  useEffect(() => {
    if (phase !== 'incoming' && phase !== 'outgoing') return;
    return startRing(phase === 'incoming' ? 'in' : 'out');
  }, [phase]);

  if (phase === 'idle' || typeof document === 'undefined') return null;
  const word = kind === 'video' ? 'video' : 'voice';
  const status = phase === 'incoming' ? `Incoming ${word} call` : phase === 'outgoing' ? 'Calling…' : phase === 'connecting' ? (note || 'Connecting…') : phase === 'live' ? (note ? `${mmss(secs)} · ${note}` : mmss(secs)) : note;
  const showVideo = kind === 'video' && phase === 'live' && remoteVideo;
  const pulse = phase === 'incoming' || phase === 'outgoing' || phase === 'connecting';

  return createPortal(
    <div className={`callui ${showVideo ? 'has-video' : ''}`} role="dialog" aria-label={`${word} call with ${name}`} onClick={(e) => e.stopPropagation()}>
      <audio ref={ra} autoPlay playsInline />
      {showVideo && <video ref={rv} className="callui-remote" autoPlay playsInline />}
      {kind === 'video' && localStream && phase !== 'incoming' && <video ref={lv} className={`callui-local ${camOff ? 'off' : ''}`} autoPlay playsInline muted />}
      <div className="callui-top">
        {!showVideo && <div className={`callui-pic ${pulse ? 'pulse' : ''}`}><Avatar name={avatar?.name || name} url={avatar?.url} color={avatar?.color} size={132} /></div>}
        <b className="callui-name">{name}</b>
        <span className={`callui-status ${phase === 'ended' ? 'end' : ''}`}>{status}</span>
      </div>
      <div className="callui-bar">
        {phase === 'incoming' ? (
          <>
            <div className="callui-act"><button type="button" className="cbtn cb-stop" onClick={call.decline} aria-label="Decline"><Icon n="phone" size={26} /></button><span>Decline</span></div>
            <div className="callui-act"><button type="button" className="cbtn cb-go cb-ring" onClick={call.accept} aria-label="Accept"><Icon n={kind === 'video' ? 'video' : 'phone'} size={26} /></button><span>Accept</span></div>
          </>
        ) : phase === 'ended' ? null : (
          <>
            <div className="callui-act"><button type="button" className={`cbtn ${muted ? 'on' : ''}`} onClick={call.toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" />{muted && <path d="M4 4l16 16" />}</svg></button><span>{muted ? 'Unmute' : 'Mute'}</span></div>
            {kind === 'video' && <div className="callui-act"><button type="button" className={`cbtn ${camOff ? 'on' : ''}`} onClick={call.toggleCam} aria-pressed={camOff} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'}><Icon n="video" size={26} />{camOff && <svg className="slash" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l16 16" /></svg>}</button><span>Camera</span></div>}
            <div className="callui-act"><button type="button" className="cbtn cb-stop" onClick={call.hangup} aria-label="End call"><Icon n="phone" size={26} /></button><span>{phase === 'live' ? 'End' : 'Cancel'}</span></div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

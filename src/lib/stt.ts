// Speech-to-text for voice notes. Opt-in: AI_VOICE=on plus a key (STT_API_KEY) from any provider that offers the
// standard "audio/transcriptions" API (Groq, OpenAI, Together, or your own Whisper server: set STT_BASE_URL and STT_MODEL).
// The recording of a student's voice note is sent to that provider, so this stays off until an admin switches it on.
export const voiceEnabled = () => process.env.AI_VOICE === 'on' && !!process.env.STT_API_KEY;

export const sttBase = () => (process.env.STT_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
export const sttModel = () => process.env.STT_MODEL || 'whisper-large-v3-turbo';

const ext = (mime: string) => (/mp4|m4a|aac/i.test(mime) ? 'm4a' : /ogg/i.test(mime) ? 'ogg' : /mpeg|mp3/i.test(mime) ? 'mp3' : /wav/i.test(mime) ? 'wav' : 'webm');

/** The words spoken in a recording, or an Error saying what went wrong. */
export async function transcribeAudio(bytes: Uint8Array, mime: string): Promise<string> {
  const type = mime.split(';')[0].trim() || 'audio/webm';
  const form = new FormData();
  form.set('file', new Blob([bytes as BlobPart], { type }), `voice-note.${ext(type)}`);
  form.set('model', sttModel());
  form.set('response_format', 'json');
  form.set('temperature', '0');
  const r = await fetch(`${sttBase()}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.STT_API_KEY}` }, body: form, signal: AbortSignal.timeout(50_000) });
  if (!r.ok) {
    let why = '';
    try { why = ((await r.json()) as { error?: { message?: string } }).error?.message?.slice(0, 120) || ''; } catch { /* no details */ }
    throw new Error(`The speech service answered ${r.status}${why ? `: ${why}` : ''}`);
  }
  const j = (await r.json()) as { text?: string };
  return String(j.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

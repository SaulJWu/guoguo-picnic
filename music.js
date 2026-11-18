const trackURL = new URL("./assets/orchard-picnic.mp3", import.meta.url);
const level = .27;
// Sixteen bars of four beats, with each beat lasting 0.5625 seconds.
const loopSeconds = 36;

let decoded;
let loading;
let wantedContext = null;
let playing = null;
let position = 0;

async function loadTrack(context) {
  const response = await fetch(trackURL);
  if (!response.ok) throw new Error("Music HTTP " + response.status);
  return context.decodeAudioData(await response.arrayBuffer());
}

export async function playMusic(context) {
  if (!context) return;
  wantedContext = context;
  if (playing) return;
  if (!decoded) {
    // Keep one download. If the connection drops, the next play can retry.
    loading ??= loadTrack(context).finally(() => { loading = null; });
    try { decoded = await loading; } catch { return; }
  }
  if (wantedContext !== context || playing) return;
  const source = context.createBufferSource();
  const volume = context.createGain();
  const now = context.currentTime;
  source.buffer = decoded;
  source.loop = true;
  source.loopEnd = Math.min(loopSeconds, decoded.duration);
  volume.gain.setValueAtTime(0, now);
  volume.gain.linearRampToValueAtTime(level, now + .045);
  source.connect(volume);
  volume.connect(context.destination);
  source.onended = () => { source.disconnect(); volume.disconnect(); };
  source.start(now, position);
  playing = {source, volume, startedAt: now};
}

export function pauseMusic(reset = false, immediate = false) {
  wantedContext = null;
  if (playing) {
    const {source, volume, startedAt} = playing;
    const now = volume.context.currentTime;
    position = (position + now - startedAt) % source.loopEnd;
    const gain = volume.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(immediate ? 0 : gain.value, now);
    const end = immediate ? now : now + .025;
    if (!immediate) gain.linearRampToValueAtTime(0, end);
    source.stop(end);
    playing = null;
  }
  if (reset) position = 0;
}

export function duckMusic() {
  if (!playing) return;
  const gain = playing.volume.gain;
  const now = playing.volume.context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(level * .52, now + .014);
  gain.setValueAtTime(level * .52, now + .12);
  gain.linearRampToValueAtTime(level, now + .32);
}

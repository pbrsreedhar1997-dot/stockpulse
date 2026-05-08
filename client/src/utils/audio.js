let _ctx = null;

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Resume if suspended (browser autoplay policy)
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function tone(freq, startOffset, duration, type = 'sine', vol = 0.28) {
  try {
    const c    = ctx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.value = freq;
    const t = c.currentTime + startOffset;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  } catch {}
}

/* Rising major arpeggio — price crossed ABOVE target */
export function playAboveTone() {
  // C5 → E5 → G5 → C6
  [[523.25, 0], [659.25, 0.13], [783.99, 0.26], [1046.5, 0.4]].forEach(([f, t]) =>
    tone(f, t, 0.35, 'sine', 0.25)
  );
}

/* Descending minor — price dropped BELOW target */
export function playBelowTone() {
  // G4 → Eb4 (minor third down, then a soft low C4)
  [[392, 0], [311.13, 0.22], [261.63, 0.48]].forEach(([f, t]) =>
    tone(f, t, 0.4, 'triangle', 0.3)
  );
}

/* Single soft bell — alert dismissed/cleared */
export function playDismissTone() {
  tone(880, 0, 0.5, 'sine', 0.15);
}

/* Warm chime — alert saved */
export function playSaveTone() {
  [[659.25, 0], [880, 0.1]].forEach(([f, t]) => tone(f, t, 0.3, 'sine', 0.18));
}

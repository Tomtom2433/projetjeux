// Tiny synthesized radio sounds (no audio files).
class RadioAudio {
  private ctx: AudioContext | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('last-signal.muted') === '1';
    } catch {
      /* ignore */
    }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('last-signal.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  private tone(freq: number, dur: number, gain: number, when = 0, type: OscillatorType = 'sine') {
    const c = this.ctx;
    if (!c || this.muted) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  }

  private hiss(dur: number, gain: number) {
    const c = this.ctx;
    if (!c || this.muted) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }

  blip(signal = 1) {
    this.tone(1250, 0.05, 0.035);
    this.tone(1650, 0.07, 0.03, 0.06);
    this.hiss(0.18 + (1 - signal) * 0.5, 0.02 + (1 - signal) * 0.05);
  }

  alert() {
    this.tone(520, 0.14, 0.05, 0, 'square');
    this.tone(390, 0.2, 0.05, 0.16, 'square');
    this.hiss(0.3, 0.03);
  }

  tick() {
    this.tone(900 + Math.random() * 300, 0.012, 0.006, 0, 'square');
  }
}

export const audio = new RadioAudio();

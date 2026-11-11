// Tiny synthesized radio sounds (no audio files).
class RadioAudio {
  private ctx: AudioContext | null = null;
  muted = false;
  /** Spoken radio lines through the browser's own speech synthesis (offline, quality varies by device). */
  voice = false;

  constructor() {
    try {
      this.voice = localStorage.getItem('last-signal.voice') === '1';
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

  get voiceAvailable() {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  setVoice(on: boolean) {
    this.voice = on;
    if (!on && this.voiceAvailable) speechSynthesis.cancel();
    try {
      localStorage.setItem('last-signal.voice', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  /** Each speaker gets a pitch and pace; a weak signal makes the delivery slower and quieter. */
  speak(text: string, who: string, signal = 1, urgent = false) {
    if (!this.voice || this.muted || !this.voiceAvailable) return;
    const clean = text.replace(/kk?rr?sh+/gi, ' ').replace(/[…—]/g, ', ').replace(/·e/g, '').trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    const fr = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('fr'));
    const profile: Record<string, [number, number, number]> = { mara: [1.05, 1.05, 0], jo: [0.55, 0.95, 1], lena: [1.55, 1.15, 0], unknown: [0.8, 0.82, 1], echo: [1, 1, 0] };
    const [pitch, rate, pickVoice] = profile[who] ?? profile.echo;
    if (fr.length) u.voice = fr[Math.min(fr.length - 1, pickVoice)];
    u.lang = 'fr-FR';
    u.pitch = pitch;
    u.rate = rate * (0.85 + Math.min(1, signal) * 0.15);
    u.volume = 0.55 + Math.min(1, signal) * 0.45;
    if (urgent) speechSynthesis.cancel();
    speechSynthesis.speak(u);
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

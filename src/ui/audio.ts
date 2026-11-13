// All sound is synthesized (no audio files): radio blips, a living ambience (wind, rain, fire),
// a dark drone that tightens with danger, and short effects for what happens in the street.
export type Channel = 'master' | 'ambience' | 'music' | 'sfx';
export type Sfx = 'hit' | 'growl' | 'sync' | 'flare' | 'down' | 'dayend' | 'order' | 'refuse';

interface SceneMix {
  /** 0..1 each. */
  storm: number;
  dark: number;
  danger: number;
  /** Camera close to the brazier. */
  fire: number;
  /** A menu is open: everything recedes. */
  menu: boolean;
}

class RadioAudio {
  private ctx: AudioContext | null = null;
  muted = false;
  vol: Record<Channel, number> = { master: 0.9, ambience: 0.7, music: 0.55, sfx: 0.8 };
  private bus: Partial<Record<Channel, GainNode>> = {};
  private amb: { wind: GainNode; windF: BiquadFilterNode; rain: GainNode; fire: GainNode; drone: GainNode; droneF: BiquadFilterNode; oscs: OscillatorNode[] } | null = null;
  private mix: SceneMix = { storm: 0, dark: 0, danger: 0, fire: 0, menu: true };
  private beat = 0;
  private crackle = 0;
  private chord = 0;
  private chordAt = 0;
  /** Spoken radio lines through the browser's own speech synthesis (offline, quality varies by device). */
  voice = false;

  constructor() {
    try {
      this.voice = localStorage.getItem('last-signal.voice') === '1';
      this.muted = localStorage.getItem('last-signal.muted') === '1';
      Object.assign(this.vol, JSON.parse(localStorage.getItem('last-signal.vol') ?? '{}'));
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
      this.build();
    } catch {
      this.ctx = null;
    }
  }

  /** Output node of a channel (falls back to the speakers before the graph exists). */
  private out(ch: Channel): AudioNode {
    return this.bus[ch] ?? this.ctx!.destination;
  }

  private noise(seconds: number): AudioBuffer {
    const c = this.ctx!;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private build() {
    const c = this.ctx!;
    const master = c.createGain();
    master.connect(c.destination);
    this.bus.master = master;
    for (const ch of ['ambience', 'music', 'sfx'] as const) {
      const g = c.createGain();
      g.connect(master);
      this.bus[ch] = g;
    }
    this.applyVolumes();
    const loop = (filter: BiquadFilterNode, gain: GainNode) => {
      const src = c.createBufferSource();
      src.buffer = this.noise(3);
      src.loop = true;
      src.connect(filter).connect(gain).connect(this.bus.ambience!);
      src.start();
    };
    const windF = c.createBiquadFilter();
    windF.type = 'lowpass';
    windF.frequency.value = 380;
    const wind = c.createGain();
    wind.gain.value = 0;
    loop(windF, wind);
    const rainF = c.createBiquadFilter();
    rainF.type = 'highpass';
    rainF.frequency.value = 2200;
    const rain = c.createGain();
    rain.gain.value = 0;
    loop(rainF, rain);
    const fire = c.createGain();
    fire.gain.value = 0;
    fire.connect(this.bus.ambience!);
    // drone: three detuned voices under a slow filter
    const droneF = c.createBiquadFilter();
    droneF.type = 'lowpass';
    droneF.frequency.value = 220;
    droneF.Q.value = 2;
    const drone = c.createGain();
    drone.gain.value = 0;
    droneF.connect(drone).connect(this.bus.music!);
    const oscs = [0, 1, 2].map((i) => {
      const o = c.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.detune.value = (i - 1) * 7;
      const g = c.createGain();
      g.gain.value = i === 2 ? 0.5 : 0.22;
      o.connect(g).connect(droneF);
      o.start();
      return o;
    });
    this.amb = { wind, windF, rain, fire, drone, droneF, oscs };
    this.setChord(0);
  }

  private setChord(i: number) {
    const a = this.amb;
    if (!a || !this.ctx) return;
    // D minor, B flat, G minor, A: slow, unresolved
    const chords = [[73.42, 110, 146.83], [58.27, 116.54, 146.83], [49, 98, 146.83], [55, 110, 164.81]];
    const ch = chords[i % chords.length];
    a.oscs.forEach((o, k) => o.frequency.setTargetAtTime(ch[k], this.ctx!.currentTime, 2.5));
  }

  private applyVolumes() {
    const t = this.ctx?.currentTime ?? 0;
    for (const ch of ['master', 'ambience', 'music', 'sfx'] as const) this.bus[ch]?.gain.setTargetAtTime(ch === 'master' && this.muted ? 0 : this.vol[ch], t, 0.05);
  }

  setVolume(ch: Channel, v: number) {
    this.vol[ch] = Math.min(1, Math.max(0, v));
    this.applyVolumes();
    try {
      localStorage.setItem('last-signal.vol', JSON.stringify(this.vol));
    } catch {
      /* ignore */
    }
  }

  /** Called every frame with what the player is looking at. */
  scene(m: SceneMix, dt: number) {
    this.mix = m;
    const c = this.ctx;
    const a = this.amb;
    if (!c || !a || c.state !== 'running') return;
    const t = c.currentTime;
    const duck = m.menu ? 0.45 : 1;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1);
    a.wind.gain.setTargetAtTime((0.05 + m.storm * 0.12 + gust * 0.05) * duck, t, 0.4);
    a.windF.frequency.setTargetAtTime(300 + gust * 260 + m.storm * 500, t, 0.6);
    a.rain.gain.setTargetAtTime(m.storm * 0.09 * duck, t, 0.5);
    a.drone.gain.setTargetAtTime((0.1 + m.dark * 0.05 + m.danger * 0.08) * (m.menu ? 0.7 : 1), t, 0.8);
    a.droneF.frequency.setTargetAtTime(170 + m.danger * 520 + m.dark * 60, t, 0.7);
    this.chordAt -= dt;
    if (this.chordAt <= 0) {
      this.chordAt = 14 - m.danger * 6;
      this.setChord(++this.chord);
    }
    // a heartbeat under the music when someone is in trouble
    this.beat -= dt;
    if (m.danger > 0.45 && !m.menu && this.beat <= 0) {
      this.beat = 1.05 - m.danger * 0.45;
      this.thump(52, 0.16, 0.22 * m.danger, 'music');
      this.thump(46, 0.2, 0.16 * m.danger, 'music', 0.17);
    }
    // the brazier crackles when the camera is on the yard
    this.crackle -= dt;
    if (m.fire > 0.05 && this.crackle <= 0) {
      this.crackle = 0.05 + Math.random() * 0.22;
      this.burst(0.02 + Math.random() * 0.03, 0.05 * m.fire * duck, 1800 + Math.random() * 2500, 'ambience');
    }
  }

  private thump(freq: number, dur: number, gain: number, ch: Channel, when = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(freq * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.6);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(ch));
    o.start(t);
    o.stop(t + dur);
  }

  /** A short filtered noise burst: crackle, thud, breath. */
  private burst(dur: number, gain: number, freq: number, ch: Channel, type: BiquadFilterType = 'bandpass', when = 0) {
    const c = this.ctx;
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = this.noise(dur);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    const t = c.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(ch));
    src.start(t);
  }

  sfx(kind: Sfx) {
    const c = this.ctx;
    if (!c || this.muted) return;
    if (kind === 'hit') {
      this.thump(70, 0.22, 0.4, 'sfx');
      this.burst(0.12, 0.25, 500, 'sfx', 'lowpass');
    } else if (kind === 'growl') {
      // a throat somewhere in the street
      const o = c.createOscillator();
      const g = c.createGain();
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 320;
      f.Q.value = 3;
      o.type = 'sawtooth';
      const t = c.currentTime;
      o.frequency.setValueAtTime(95 + Math.random() * 25, t);
      o.frequency.linearRampToValueAtTime(60, t + 0.9);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      o.connect(f).connect(g).connect(this.out('sfx'));
      o.start(t);
      o.stop(t + 1);
      this.burst(0.8, 0.05, 700, 'sfx');
    } else if (kind === 'sync') {
      [660, 880, 1175].forEach((f, i) => this.tone(f, 0.25, 0.05, i * 0.09, 'triangle'));
    } else if (kind === 'flare') {
      this.burst(0.9, 0.2, 1400, 'sfx', 'highpass');
      this.tone(1900, 0.5, 0.03, 0.05, 'sine');
    } else if (kind === 'down') {
      this.thump(48, 0.6, 0.45, 'sfx');
      [392, 311, 233].forEach((f, i) => this.tone(f, 0.7, 0.05, 0.1 + i * 0.22, 'triangle'));
    } else if (kind === 'dayend') {
      this.thump(62, 1.6, 0.35, 'sfx');
      [146.83, 220, 293.66].forEach((f, i) => this.tone(f, 2.2, 0.04, i * 0.05, 'triangle'));
    } else if (kind === 'order') {
      this.tone(980, 0.05, 0.04);
      this.burst(0.06, 0.03, 2600, 'sfx');
    } else if (kind === 'refuse') {
      this.tone(300, 0.16, 0.05, 0, 'square');
      this.tone(240, 0.2, 0.05, 0.12, 'square');
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolumes();
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
    o.connect(g).connect(this.out('sfx'));
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
    src.connect(f).connect(g).connect(this.out('sfx'));
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

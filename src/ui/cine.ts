// Dialogue scenes played in the world itself: the survivors walk to their marks around the brazier,
// the camera closes in on whoever speaks, and each line appears in a bubble over the speaker's head.
import type { Actors, CineMark } from '../render/actors';
import type { Stage } from '../render/scene';
import type { Act, Scene } from '../sim/scenes';
import type { GameState } from '../sim/types';
import { NPCS } from '../sim/text';
import { audio } from './audio';

/** The brazier in the shelter yard: every scene is staged around it. */
const FIRE = { x: -41, z: 21.5 };
/** Marks relative to the fire, open toward the camera. */
const SPOTS: Record<string, [number, number]> = { mara: [-2.35, 0.95], jo: [-1.85, -1.85], lena: [1.0, -2.3] };
const EXTRA_SPOTS: [number, number][] = [[2.7, -1.5], [-1.6, 2.9], [3.2, 0.6]];
const CARD_TIME = 2.6;
const CHARS_PER_SEC = 48;

interface Role {
  bx: number;
  bz: number;
  /** Distance moved toward the fire (negative: stepped back). */
  off: number;
  sit: boolean;
  away: boolean;
  still: boolean;
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export class Cine {
  active = false;
  private el = document.getElementById('cine')!;
  private q = (sel: string) => this.el.querySelector(sel) as HTMLElement;
  private scene: Scene | null = null;
  private done: (() => void) | null = null;
  private at = -1;
  private card = 0;
  private chars = 0;
  private last = 0;
  private roles: Record<string, Role> = {};
  private marks: Record<string, CineMark> = {};
  private baseZoom = 6;
  private saved = { min: 8, ease: 0.0015 };

  constructor(
    private stage: Stage,
    private actors: () => Actors,
    private state: () => GameState,
    private portrait: (id: string, color: string) => string,
  ) {
    this.el.addEventListener('click', (e) => {
      if (!this.active) return;
      if ((e.target as HTMLElement).closest('[data-cine="skip"]')) this.finish();
      else this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') this.finish();
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.advance();
      }
    });
  }

  /** Lighting the scene wants, or null to keep the game's own. */
  mood(): { dark: number; storm: number } | null {
    if (!this.active || !this.scene) return null;
    return this.scene.mood === 'night' ? { dark: 0.82, storm: 0 } : this.scene.mood === 'storm' ? { dark: 0.72, storm: 0.85 } : null;
  }

  play(scene: Scene, done: () => void) {
    this.scene = scene;
    this.done = done;
    this.at = -1;
    this.card = CARD_TIME;
    this.active = true;
    this.roles = {};
    let extra = 0;
    for (const l of scene.lines) {
      for (const id of [l.who, l.to, ...Object.keys(l.acts ?? {})]) {
        if (!id || id === 'narr' || this.roles[id]) continue;
        const spot = SPOTS[id] ?? EXTRA_SPOTS[extra++ % EXTRA_SPOTS.length];
        this.roles[id] = { bx: FIRE.x + spot[0], bz: FIRE.z + spot[1], off: 0, sit: false, away: false, still: false };
      }
    }
    // survivors with no line still stand with the others
    for (const sv of this.state().survivors) {
      if (!sv.alive || this.roles[sv.id] || !SPOTS[sv.id]) continue;
      this.roles[sv.id] = { bx: FIRE.x + SPOTS[sv.id][0], bz: FIRE.z + SPOTS[sv.id][1], off: 0, sit: false, away: false, still: false };
    }
    this.saved = { min: this.stage.minZoom, ease: this.stage.ease };
    this.stage.minZoom = 3.2;
    this.stage.ease = 0.06;
    document.body.classList.add('cine');
    this.el.hidden = false;
    this.el.className = 'card';
    this.q('.c-art').style.backgroundImage = `url(./art/s-${scene.art}.webp)`;
    this.q('.c-title').textContent = scene.title;
    this.q('.c-place').textContent = scene.place;
    this.q('.c-top b').textContent = scene.title;
    this.q('.c-top small').textContent = scene.place;
    this.q('.c-bubble').hidden = true;
    this.q('.c-narr').hidden = true;
    this.q('.c-count').textContent = '';
    this.layout(null);
    this.shot('wide', null, null, true);
    audio.tick();
  }

  private wide() {
    return window.innerWidth < window.innerHeight ? 12 : 8.5;
  }

  /** Point the camera: tight on the speaker, on two people, or on the whole circle. */
  private shot(cam: 'close' | 'two' | 'wide', who: string | null, to: string | null, snap = false) {
    const portrait = window.innerWidth < window.innerHeight;
    const a = who ? this.marks[who] : null;
    const b = to ? this.marks[to] : null;
    let x = FIRE.x - 0.4;
    let z = FIRE.z - 0.4;
    let zoom = this.wide();
    if (a && cam !== 'wide') {
      x = a.x;
      z = a.z;
      zoom = portrait ? 6.6 : 4.6;
      if (b && cam === 'two') {
        x = (a.x + b.x) / 2;
        z = (a.z + b.z) / 2;
        zoom = (portrait ? 7.4 : 5.2) + Math.hypot(a.x - b.x, a.z - b.z) * 0.25;
      }
    }
    this.baseZoom = zoom;
    // keep the subject in the lower half: the bubble needs the room above
    const lift = zoom * 0.3;
    this.stage.focus(x - lift * Math.SQRT1_2, z - lift * Math.SQRT1_2, zoom);
    if (snap) {
      this.stage.view.x = this.stage.goal.x + 3;
      this.stage.view.z = this.stage.goal.z + 3;
      this.stage.view.zoom = zoom * 1.5;
    }
  }

  /** Recompute everyone's mark, heading and gesture for the current beat. */
  private layout(speaker: string | null, to: string | null = null, gesture: CineMark['gesture'] = 'none') {
    const pos = (r: Role) => {
      const dx = FIRE.x - r.bx;
      const dz = FIRE.z - r.bz;
      const d = Math.hypot(dx, dz) || 1;
      return { x: r.bx + (dx / d) * r.off, z: r.bz + (dz / d) * r.off };
    };
    const at: Record<string, { x: number; z: number }> = {};
    for (const [id, r] of Object.entries(this.roles)) at[id] = pos(r);
    const look = (from: { x: number; z: number }, x: number, z: number) => Math.atan2(x - from.x, z - from.z);
    this.marks = {};
    for (const [id, r] of Object.entries(this.roles)) {
      const p = at[id];
      let face = look(p, FIRE.x, FIRE.z);
      if (r.still) face = -Math.PI / 2; // toward the radio room
      else if (r.away) face += Math.PI * 0.8;
      else if (id === speaker) {
        if (to && at[to]) face = look(p, at[to].x, at[to].z);
        else face = face * 0.6 + (Math.PI / 4) * 0.4; // half to the fire, half to the camera
      } else if (speaker && at[speaker]) face = look(p, at[speaker].x, at[speaker].z);
      this.marks[id] = { x: p.x, z: p.z, face, sit: r.sit, gesture: id === speaker ? gesture : 'none' };
    }
    this.actors().setCine(this.marks);
  }

  private apply(acts?: Record<string, Act>) {
    for (const r of Object.values(this.roles)) r.still = false;
    for (const [id, act] of Object.entries(acts ?? {})) {
      const r = this.roles[id];
      if (!r) continue;
      if (act === 'sit') r.sit = true;
      else if (act === 'stand') r.sit = false;
      else if (act === 'away') r.away = true;
      else if (act === 'face') r.away = false;
      else if (act === 'step') {
        r.off = 0.9;
        r.away = false;
        r.sit = false;
      } else if (act === 'back') {
        r.off = -2.2;
        r.away = true;
        r.sit = false;
      } else if (act === 'still') r.still = true;
    }
  }

  private who(id: string) {
    const sv = this.state().survivors.find((v) => v.id === id);
    if (sv) return { name: sv.short, color: sv.color };
    const n = Object.values(NPCS).find((x) => x.id === id);
    return { name: n?.name.split(' ')[0] ?? id, color: n?.color ?? '#e8dcc4' };
  }

  private advance() {
    const sc = this.scene;
    if (!sc) return;
    if (this.card > 0.4) {
      this.card = 0.4; // tap through the opening card
      return;
    }
    const cur = sc.lines[this.at];
    if (cur && this.chars < cur.text.length) {
      this.chars = cur.text.length; // first tap finishes the line, the next one moves on
      return;
    }
    this.show(this.at + 1);
  }

  private show(i: number) {
    const sc = this.scene!;
    if (i >= sc.lines.length) return this.finish();
    this.at = i;
    this.chars = 0;
    const l = sc.lines[i];
    const narr = l.who === 'narr';
    const act = narr ? undefined : l.acts?.[l.who];
    if (!narr && this.roles[l.who] && act !== 'away' && act !== 'back') this.roles[l.who].away = false; // you turn round to speak
    this.apply(l.acts);
    const gesture: CineMark['gesture'] = narr ? 'none' : act === 'point' || act === 'shrug' || act === 'nod' ? act : 'talk';
    this.layout(narr ? null : l.who, l.to ?? null, gesture);
    this.shot(l.cam ?? 'close', narr ? null : l.who, l.to ?? null);
    const bubble = this.q('.c-bubble');
    const cap = this.q('.c-narr');
    bubble.hidden = narr;
    cap.hidden = !narr;
    this.el.className = narr ? 'narr' : 'talk';
    if (!narr) {
      const c = this.who(l.who);
      bubble.style.setProperty('--c', c.color);
      this.q('.c-face').innerHTML = this.portrait(l.who, c.color);
      this.q('.c-name').textContent = c.name + (l.to ? ` → ${this.who(l.to).name}` : '');
      audio.speak(l.text, l.who, 1, true);
    }
    const last = i >= sc.lines.length - 1;
    this.q('.c-count').textContent = `${i + 1} / ${sc.lines.length}`;
    this.q('[data-cine="next"]').textContent = last ? 'Continuer ▸' : 'Suivant ▸';
    audio.tick();
  }

  private finish() {
    if (!this.active) return;
    this.active = false;
    this.scene = null;
    this.el.hidden = true;
    document.body.classList.remove('cine');
    this.actors().setCine(null);
    this.stage.minZoom = this.saved.min;
    this.stage.ease = this.saved.ease;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const done = this.done;
    this.done = null;
    done?.();
  }

  frame(dt: number) {
    if (!this.active || !this.scene) return;
    // text speed follows the clock, not the frame rate
    const now = performance.now();
    const real = Math.min(0.5, (now - (this.last || now)) / 1000);
    this.last = now;
    if (this.card > 0) {
      this.card -= real;
      if (this.card <= 0.4) this.el.classList.add('out');
      if (this.card <= 0) this.show(0);
      return;
    }
    const l = this.scene.lines[this.at];
    if (!l) return;
    // a slow push-in on every line
    this.stage.goal.zoom = Math.max(this.baseZoom * 0.86, this.stage.goal.zoom - dt * 0.1);
    const before = Math.floor(this.chars);
    this.chars = Math.min(l.text.length, this.chars + real * CHARS_PER_SEC);
    const n = Math.floor(this.chars);
    const narr = l.who === 'narr';
    const p = this.q(narr ? '.c-narr' : '.c-text');
    if (n !== before || p.dataset.i !== String(this.at)) {
      p.dataset.i = String(this.at);
      p.innerHTML = `${esc(l.text.slice(0, n))}<span>${esc(l.text.slice(n))}</span>`;
    }
    if (narr) return;
    const head = this.actors().headPos(l.who);
    if (!head) return;
    const sp = this.stage.project(head.x, head.y + 0.55, head.z);
    const b = this.q('.c-bubble');
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const W = window.innerWidth;
    const x = Math.min(W - w / 2 - 10, Math.max(w / 2 + 10, sp.x));
    const y = Math.max(h + 52, sp.y - 12);
    b.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px,${(y - h).toFixed(1)}px,0)`;
    b.style.setProperty('--tail', `${Math.min(w - 26, Math.max(26, sp.x - (x - w / 2))).toFixed(0)}px`);
  }
}

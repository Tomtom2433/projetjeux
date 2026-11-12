// DOM interface: tactical HUD, radio, roster, shelter, debrief, title.
import type { GameState, NodeId, OrderType, RadioMessage, Shelter, Survivor } from '../sim/types';
import { NODE, NODES, EDGES, CANAL } from '../sim/world';
import { LINK_THRESHOLD, pathLength, signalAt, stockTotal, stormLevel, survivorSignal, zoneOf, darkness } from '../sim/core';
import { canEndDay, validTargets } from '../sim/sim';
import { UPGRADES, storageCap, upgradeBlocker } from '../sim/state';
import { LAST_DAY, mission, objectiveStatus } from '../sim/missions';
import { LEVELS, PERKS, aptitude, levelProgress, perkOffer } from '../sim/perks';
import { MODE_LABEL, NPCS, ORDER_COLOR, ORDER_LABEL, fmtClock, fmtTime, nodeName } from '../sim/text';
import { storedTier, storeTier, type Tier } from '../render/quality';
import { audio, type Channel } from './audio';
import { applyPrefs, storedDifficulty, storedSafe, storedText, storeSafe, storeText } from './prefs';
import { DIFFICULTY } from '../sim/core';
import { ITEMS, canUseItem, type ItemId } from '../sim/items';
import { VERSION, buildReport } from './report';
import { ACHIEVEMENTS, loadProfile } from './profile';
import { synchro } from '../sim/cover';
import { Tutorial } from './tutorial';

export type Screen = 'about' | 'profile' | 'title' | 'radio' | 'roster' | 'shelter' | 'debrief' | 'ending' | 'settings' | 'scene' | null;

export interface GameApi {
  s: GameState;
  selected: string | null;
  orderType: OrderType | null;
  targets: NodeId[];
  chosen: NodeId | null;
  route: NodeId[] | null;
  speed: number;
  paused: boolean;
  started: boolean;
  shown(sv: Survivor): { x: number; z: number; node: NodeId };
  select(id: string | null, focus?: boolean): void;
  pickOrder(t: OrderType): void;
  confirmOrder(): void;
  queueOrder(): void;
  useItem(id: ItemId): void;
  cancelOrder(): void;
  choose(choiceId: string): void;
  buy(key: keyof Shelter): void;
  perk(svId: string, perkId: string): void;
  skipTutorial(): void;
  orderNow(id: string, type: OrderType, node: NodeId | null): void;
  advanceUntil(done: () => boolean, maxSeconds: number): void;
  endDayNow(): void;
  nextDay(): void;
  newGame(training?: boolean): void;
  canRetryDay(): boolean;
  retryDay(): void;
  setDifficulty(d: number): void;
  continueGame(): void;
  hasSave(): boolean;
  focus(x: number, z: number): void;
  project(x: number, z: number): { x: number; y: number };
  togglePause(): void;
  cycleSpeed(): void;
  stats(): { calls: number; tris: number; scale: number; ms: number; tier: string };
  view(): { x: number; z: number; zoom: number };
}

const diffSeg = () => `<div class="seg">${DIFFICULTY.map((d, i) => `<button class="${storedDifficulty() === i ? 'on' : ''}" data-act="difficulty" data-arg="${i}">${d.name}</button>`).join('')}</div>`;

const svg = (d: string, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${extra}<path d="${d}"/></svg>`;
const ICON: Record<string, string> = {
  radio: svg('M12 11v9M8.5 20h7M8.2 8.2a5.4 5.4 0 0 1 7.6 0M5.4 5.4a9.3 9.3 0 0 1 13.2 0', '<circle cx="12" cy="10.5" r="1.2" fill="currentColor"/>'),
  team: svg('M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15.5 14.6c3 .2 5.5 2.1 5.5 5.4', '<circle cx="9" cy="8" r="3.4"/><circle cx="17" cy="9" r="2.6"/>'),
  home: svg('M3.5 11.5 12 4l8.5 7.5M6 10v9.5h12V10M10 19.5v-5h4v5'),
  pause: svg('M8 5v14M16 5v14'),
  play: svg('M7 4.5v15l12-7.5z'),
  eye: svg('M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z', '<circle cx="12" cy="12" r="2.8"/>'),
  gear: svg('M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8', '<circle cx="12" cy="12" r="3.6"/>'),
  pill: svg('M8.5 20.5a5 5 0 0 1-5-5c0-1.4.5-2.6 1.5-3.5l7-7a5 5 0 0 1 7 7l-7 7a4.9 4.9 0 0 1-3.5 1.5zM8.5 8.5l7 7'),
  crate: svg('M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9'),
  wrench: svg('M14.5 6.5a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.5-8.5a4 4 0 0 1-2-2z'),
  scout: svg('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', '<circle cx="12" cy="12" r="2.8"/>'),
  retrieve: svg('M4 9.5 12 5l8 4.5v8L12 22l-8-4.5zM12 13V2.5M8.5 5.5 12 2l3.5 3.5'),
  hold: svg('M12 3 4.5 6v6c0 4.5 3 7.5 7.5 9 4.5-1.5 7.5-4.5 7.5-9V6z'),
  retreat: svg('M20 12H5M11 5.5 4.5 12l6.5 6.5'),
  rescue: svg('M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10zM12 11v5M9.5 13.5h5'),
  end: svg('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'),
};

const ORDERS: OrderType[] = ['scout', 'retrieve', 'hold', 'retreat', 'rescue'];

function bars(sig: number): string {
  const n = Math.round(Math.min(1, sig / 0.9) * 5);
  const cls = sig < LINK_THRESHOLD ? 'dead' : sig < 0.45 ? 'weak' : '';
  let h = `<span class="bars ${cls}">`;
  for (let i = 0; i < 5; i++) h += `<i class="${i < Math.max(1, n) ? 'on' : ''}" style="height:${5 + i * 2.6}px"></i>`;
  return h + '</span>';
}

export interface Mood {
  hurt?: boolean;
  afraid?: boolean;
  lost?: boolean;
  dead?: boolean;
}

const moodOf = (sv: Survivor): Mood => ({ hurt: sv.health < 55, afraid: sv.fear > 60 || sv.mode === 'flee', lost: sv.alive && !sv.linked, dead: !sv.alive });

// (portraits)
/** Characters with a painted portrait in public/art. */
const PAINTED = new Set(['mara', 'jo', 'lena', 'ines', 'patient', 'sacha', 'vogel', 'stranger']);
const SKIN: Record<string, string> = { mara: '#c48d69', jo: '#d6ab8b', lena: '#e8c6aa', ines: '#b98562', patient: '#d9c2ae', sacha: '#cfa07e', vogel: '#d2b7a0' };

/** Hand-drawn SVG busts. The face reacts to the survivor's state. */
export function portrait(id: string, color = '#3fe0c5', mood: Mood = {}): string {
  const scan = `<g opacity=".13" stroke="#fff" stroke-width=".6">${Array.from({ length: 16 }, (_, i) => `<path d="M0 ${i * 6.4 + 2}h100"/>`).join('')}</g>`;
  if (id === 'unknown')
    return `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#14121f"/><g fill="#3b3560">${Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 37) % 100}" y="${(i * 53) % 100}" width="${8 + ((i * 7) % 20)}" height="2"/>`).join('')}</g><path d="M22 100c0-18 12-28 28-28s28 10 28 28z" fill="#2a2546"/><ellipse cx="50" cy="44" rx="15" ry="18" fill="#2a2546"/><text x="50" y="54" font-size="26" font-weight="800" text-anchor="middle" fill="#a78bfa" font-family="system-ui">?</text>${scan}</svg>`;
  if (id === 'echo')
    return `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#0f1a1c"/><g fill="none" stroke="#3fe0c5" stroke-width="4" stroke-linecap="round"><path d="M36 40a20 20 0 0 1 28 0"/><path d="M26 30a34 34 0 0 1 48 0" opacity=".5"/><path d="M50 50v32M40 82h20M50 50 40 82M50 50l10 32" stroke="#e9e4d8"/></g><circle cx="50" cy="48" r="5" fill="#a78bfa"/>${scan}</svg>`;
  if (PAINTED.has(id)) {
    const cls = mood.dead ? 'dead' : mood.lost ? 'lost' : mood.hurt ? 'hurt' : mood.afraid ? 'afraid' : '';
    return `<div class="pimg ${cls}" style="background-image:url(./art/p-${id}.webp)"></div>`;
  }
  const skin = SKIN[id] ?? '#d6ab8b';
  const back: Record<string, string> = {
    mara: '<path d="M65 28c9 4 11 17 6 29l-6-8z" fill="#2b1d16"/>',
    jo: '',
    ines: '<circle cx="50" cy="15" r="7.5" fill="#241a14"/>',
    lena: `<path d="M24 56C19 28 32 11 50 11s31 17 26 45c-2 8-6 13-11 15H35c-5-2-9-7-11-15z" fill="${color}"/><path d="M24 56C19 28 32 11 50 11s31 17 26 45c-2 8-6 13-11 15H35c-5-2-9-7-11-15z" fill="#000" opacity=".38"/>`,
  };
  const hair: Record<string, string> = {
    mara: '<path d="M33 39c-3-17 6-26 17-26s20 9 17 26c-3-9-7-13-17-14-10 1-14 5-17 14z" fill="#2b1d16"/><path d="M38 31.5l5 1.5" stroke="#8a5a45" stroke-width="1.1" stroke-linecap="round"/>',
    jo: '<path d="M35 46c1 13 7 19 15 19s14-6 15-19c-3 6-8 8-15 8s-12-2-15-8z" fill="#6a6258"/><path d="M31.5 35c0-13 8-21 18.5-21S68.5 22 68.5 35c-6-3-12-4-18.5-4s-12.5 1-18.5 4z" fill="#37424c"/><path d="M31.5 31.5c6-2.5 12-3.5 18.5-3.5s12.5 1 18.5 3.5v4c-6-3-12-4-18.5-4s-12.5 1-18.5 4z" fill="#232b32"/>',
    ines: '<path d="M33 39c-3-17 6-25 17-25s20 8 17 25c-4-8-8-11-17-11s-13 3-17 11z" fill="#241a14"/><path d="M36 60q14 10 28 0v6q-14 9-28 0z" fill="#dfeeee" opacity=".9"/>',
    patient: '<path d="M34 34c1-11 8-17 16-17s15 6 16 17c-5-5-10-6-16-6s-11 1-16 6z" fill="#77706a"/><path d="M36 48c2 9 7 13 14 13s12-4 14-13c-3 4-8 5-14 5s-11-1-14-5z" fill="#8a837c" opacity=".55"/>',
    sacha: '<path d="M35 46c1 13 7 19 15 19s14-6 15-19c-3 6-8 8-15 8s-12-2-15-8z" fill="#4a3526"/><path d="M29 33c2-12 10-18 21-18s19 6 21 18c-7-3-14-4-21-4s-14 1-21 4z" fill="#3a2f28"/><rect x="27" y="31" width="46" height="4" rx="2" fill="#2a221d"/>',
    vogel: '<path d="M33 37c0-13 8-20 17-20s17 7 17 20c-3-7-6-10-8-11-5 3-13 3-18 0-2 1-5 4-8 11z" fill="#b9b4ac"/><g fill="none" stroke="#1c1f24" stroke-width="1.6"><circle cx="43" cy="39.5" r="5"/><circle cx="57" cy="39.5" r="5"/><path d="M48 39.5h4"/></g><path d="M38 50c2 8 6 12 12 12s10-4 12-12c-3 3-7 4-12 4s-9-1-12-4z" fill="#b9b4ac" opacity=".6"/>',
    lena: '<path d="M33.5 37c1-13 8-19 16.5-19s15.5 6 16.5 19c-4-7-9-10-13-10-2 3-6 5-11 5-4 0-7 2-9 5z" fill="#c9a25a"/><path d="M33.5 36c-2 6-2 13 0 19l3-9zM66.5 36c2 6 2 13 0 19l-3-9z" fill="#b8914d"/><g fill="#a9775a" opacity=".55"><circle cx="43" cy="45" r=".7"/><circle cx="45.5" cy="46.5" r=".7"/><circle cx="55" cy="46.5" r=".7"/><circle cx="57.5" cy="45" r=".7"/></g>',
  };
  const gear: Record<string, string> = {
    mara: '<rect x="18" y="80" width="13" height="13" rx="2" fill="#e9e4d8"/><path d="M24.5 82.5v8M20.5 86.5h8" stroke="#2fae90" stroke-width="2.6"/>',
    jo: '<path d="M17 88l15-15 4.5 3.5L20 93zM83 88 68 73l-4.5 3.5L80 93z" fill="#eceadb" opacity=".85"/>',
    ines: '<path d="M40 68l10 14 10-14" fill="none" stroke="#e9f4f2" stroke-width="2"/><rect x="62" y="82" width="12" height="9" rx="1.5" fill="#e9f4f2"/>',
    sacha: '<path d="M30 74l-6 26M70 74l6 26" stroke="#2a221d" stroke-width="3.5"/>',
    vogel: '<path d="M30 60q20-12 40 0" fill="none" stroke="#1c1f24" stroke-width="3"/><rect x="26" y="56" width="7" height="12" rx="3" fill="#1c1f24"/><rect x="67" y="56" width="7" height="12" rx="3" fill="#1c1f24"/>',
    lena: '<path d="M39 69l16 31" stroke="#1c1f24" stroke-width="2.4"/><rect x="50" y="88" width="13" height="8" rx="2" fill="#1c1f24"/>',
  };
  const brows = mood.afraid ? '<path d="M38.5 36l8-3M61.5 36l-8-3"' : mood.hurt ? '<path d="M38.5 33.5l8 1.5M61.5 33.5l-8 1.5"' : '<path d="M38.5 34.5l8-.5M61.5 34.5l-8-.5"';
  const mouth = mood.afraid ? 'M46 54.5q4-1.5 8 0' : mood.hurt ? 'M45 55q5-2.5 10 0' : id === 'jo' ? 'M46 54h8' : 'M45.5 53.5q4.5 2 9 0';
  const eyeRy = mood.afraid ? 2.4 : mood.hurt ? 1.2 : 1.8;
  const eyes = [43, 57].map((x) => `<ellipse cx="${x}" cy="39.5" rx="3" ry="${eyeRy}" fill="#f3efe6"/><circle cx="${x}" cy="39.5" r="${Math.min(1.5, eyeRy)}" fill="#2a2018"/>`).join('');
  const wounds = mood.hurt ? '<path d="M33.5 27l33 4.5v5l-33-4.5z" fill="#e9e4d8"/><path d="M56 30.5l5 .7v4l-5-.7z" fill="#a8372c" opacity=".8"/><path d="M58 47l4 4M60 46.5l3 3" stroke="#a8372c" stroke-width="1.1" stroke-linecap="round"/>' : '';
  const sweat = mood.afraid ? '<path d="M36.5 30q-1.5 2.5 0 3.5 1.5-1 0-3.5z" fill="#bfe3ff" opacity=".8"/>' : '';
  const over = mood.dead
    ? '<rect width="100" height="100" fill="#06070a" opacity=".68"/><path d="M36 36l28 28M64 36 36 64" stroke="#ff6b57" stroke-width="5" stroke-linecap="round" opacity=".85"/>'
    : mood.lost
      ? `<rect width="100" height="100" fill="#1a1d26" opacity=".5"/><g fill="#cfd6e4" opacity=".3">${Array.from({ length: 9 }, (_, i) => `<rect x="${(i * 41) % 70}" y="${8 + i * 10.5}" width="${22 + ((i * 17) % 40)}" height="${1.5 + (i % 3)}"/>`).join('')}</g>`
      : '';
  return `<svg viewBox="0 0 100 100"><defs><linearGradient id="pg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3342"/><stop offset="1" stop-color="#0c0f15"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#pg${id})"/><circle cx="24" cy="22" r="34" fill="#ffb27a" opacity=".1"/>
    ${back[id] ?? ''}
    <path d="M12 100c0-21 15-33 38-33s38 12 38 33z" fill="${color}"/><path d="M50 67c23 0 38 12 38 33H50z" fill="#000" opacity=".2"/>
    <path d="M40 68l10 10 10-10-3-3H43z" fill="#000" opacity=".35"/>
    ${gear[id] ?? ''}
    <path d="M44 54h12v13l-6 6-6-6z" fill="${skin}"/><path d="M44 58q6 5 12 0v-4H44z" fill="#000" opacity=".22"/>
    <ellipse cx="33.5" cy="41" rx="2.6" ry="4.5" fill="${skin}"/><ellipse cx="66.5" cy="41" rx="2.6" ry="4.5" fill="${skin}"/>
    <path d="M34 38c0-13 7-21 16-21s16 8 16 21c0 12-6 23-16 23S34 50 34 38z" fill="${skin}"/>
    <path d="M50 17c9 0 16 8 16 21 0 12-6 23-16 23z" fill="#000" opacity=".13"/>
    ${eyes}${brows} stroke="#2a2018" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <path d="M50 41v6.5l-2.5 1.5" stroke="#000" stroke-opacity=".3" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    ${hair[id] ?? ''}
    <path d="${mouth}" stroke="#5a2f28" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    ${wounds}${sweat}${over}${scan}</svg>`;
}

/** Signal loss eats characters. Deterministic per message. */
function garble(text: string, sig: number, id: number): string {
  if (sig >= 0.55) return esc(text);
  const p = Math.min(0.42, (0.55 - sig) * 1.1);
  let out = '';
  let run = '';
  const flush = () => {
    if (run) out += `<span class="g">${run}</span>`;
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const h = Math.sin((i + 1) * 12.9898 + id * 78.233) * 43758.5453;
    if (ch !== ' ' && h - Math.floor(h) < p) run += '▒';
    else {
      flush();
      out += esc(ch);
    }
  }
  flush();
  return out;
}

const dayName = (d: number) => (d === 0 ? 'Formation' : `Jour ${d}`);
const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export class Ui {
  screen: Screen = null;
  showPerf = false;
  private el = {
    hud: document.getElementById('hud')!,
    status: document.getElementById('status')!,
    topright: document.getElementById('topright')!,
    team: document.getElementById('team')!,
    ticker: document.getElementById('ticker') as HTMLButtonElement,
    orders: document.getElementById('orders')!,
    coach: document.getElementById('coach')!,
    minimap: document.getElementById('minimap') as HTMLCanvasElement,
    perf: document.getElementById('perf')!,
    overlay: document.getElementById('overlay')!,
    rain: document.getElementById('rain')!,
    rotate: document.getElementById('rotate')!,
    toasts: document.getElementById('toasts')!,
    edges: document.getElementById('edges')!,
  };
  private flash = new Map<string, { cls: string; until: number }>();
  private edgeEls = new Map<string, HTMLButtonElement>();
  private now = 0;
  private timer = 0;
  private cache = new Map<HTMLElement, string>();
  private lastMsg: RadioMessage | null = null;
  private typed = 0;
  private typingMsg = -1;
  tutorial: Tutorial;
  private rotateDismissed = false;

  constructor(private g: GameApi) {
    this.el.status.className = 'panel';
    this.el.orders.className = 'panel';
    this.tutorial = new Tutorial(g);
    applyPrefs();
    try {
      this.setHud(Number(localStorage.getItem('last-signal.hud') ?? 0) % 3);
    } catch {
      /* ignore */
    }
    document.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset?.vol) {
        audio.unlock();
        audio.setVolume(t.dataset.vol as Channel, Number(t.value) / 100);
      }
    });
    document.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      audio.unlock();
      this.act(t.dataset.act!, t.dataset.arg ?? '');
    });
    this.el.minimap.addEventListener('pointerdown', (e) => {
      const r = this.el.minimap.getBoundingClientRect();
      this.g.focus(-76 + ((e.clientX - r.left) / r.width) * 152, -57 + ((e.clientY - r.top) / r.height) * 114);
    });
    document.getElementById('rotate-ok')!.addEventListener('click', () => {
      this.rotateDismissed = true;
      this.el.rotate.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') this.g.togglePause();
      else if (e.key === 'Escape') this.screen && this.screen !== 'title' && this.g.s.awaiting === null ? this.close() : this.g.cancelOrder();
      else if (e.key >= '1' && e.key <= '5') this.g.select(this.g.s.survivors[+e.key - 1]?.id ?? null, true);
    });
  }

  private set(el: HTMLElement, html: string) {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }

  private act(a: string, arg: string) {
    const g = this.g;
    switch (a) {
      case 'open': this.open(arg as Screen); break;
      case 'close': this.close(); break;
      case 'select': g.select(arg, g.selected === arg); break;
      case 'goto': g.select(arg, true); break;
      case 'order': g.pickOrder(arg as OrderType); break;
      case 'confirm': g.confirmOrder(); break;
      case 'confirm-next': g.queueOrder(); break;
      case 'item': g.useItem(arg as ItemId); break;
      case 'tut-next': this.tutorial.next(); break;
      case 'tut-reset': Tutorial.reset(); this.toast('La formation reviendra à la prochaine nouvelle partie.'); break;
      case 'cancel': g.cancelOrder(); break;
      case 'choice': g.choose(arg); break;
      case 'buy': g.buy(arg as keyof Shelter); this.render(); break;
      case 'perk': g.perk(arg.split(':')[0], arg.split(':')[1]); this.render(); break;
      case 'pause': g.togglePause(); break;
      case 'speed': g.cycleSpeed(); break;
      case 'endday': g.endDayNow(); break;
      case 'nextday': g.nextDay(); break;
      case 'new': g.newGame(arg === 'tuto' ? true : arg === 'skip' ? false : undefined); break;
      case 'continue': g.continueGame(); break;
      case 'tier': storeTier(arg as Tier | 'auto'); location.reload(); break;
      case 'sound': audio.setMuted(!audio.muted); this.render(); break;
      case 'hud': this.setHud((this.hudMode + 1) % 3); break;
      case 'retry': g.retryDay(); break;
      case 'report': {
        const st = g.stats();
        const text = buildReport({ Jour: g.s.day, Difficulté: DIFFICULTY[storedDifficulty()].name, Qualité: st.tier, 'Image (ms)': st.ms.toFixed(1) });
        void (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
          () => this.toast('Rapport copié : collez-le dans votre message.'),
          () => this.toast('Copie impossible sur ce navigateur.', 'bad'),
        );
        break;
      }
      case 'difficulty': g.setDifficulty(Number(arg)); this.render(); break;
      case 'text': storeText(Number(arg)); this.render(); break;
      case 'safe': storeSafe(!storedSafe()); this.render(); break;
      case 'voice': audio.setVoice(!audio.voice); this.render(); if (audio.voice) audio.speak('ECHO-7, ici Mara. Vous me recevez ?', 'mara'); break;
      case 'perf': this.showPerf = !this.showPerf; this.el.perf.hidden = !this.showPerf; this.render(); break;
      case 'skip': this.typed = 1e9; break;
      case 'fullscreen': document.documentElement.requestFullscreen?.().catch(() => {}); break;
    }
    this.timer = 0;
  }

  open(screen: Screen) {
    this.screen = screen;
    this.el.overlay.hidden = screen === null || screen === 'scene';
    this.el.hud.hidden = screen === 'title' || screen === 'scene' || !this.g.started;
    this.cache.delete(this.el.overlay);
    this.render();
  }

  close() {
    if (this.g.s.awaiting !== null && this.screen === 'radio') return;
    this.open(this.g.s.phase === 'debrief' ? 'debrief' : this.g.s.phase === 'ending' ? 'ending' : null);
  }

  onRadio(msg: RadioMessage) {
    this.lastMsg = msg;
    if (msg.kind === 'alert') audio.alert();
    else audio.blip(msg.signal);
    audio.speak(msg.text, msg.from, msg.signal, msg.kind !== 'report');
    if (msg.art && !msg.choices && this.screen === null && this.g.started) this.eventCard(msg);
    if (this.screen === 'scene') return; // the briefing waits until the survivors have finished talking
    if (msg.choices && !msg.chosen) this.open('radio');
    else if (this.screen === 'radio') this.render();
  }

  /** Illustrated card for events that need no decision. */
  private eventCard(msg: RadioMessage) {
    const el = document.getElementById('eventcard')!;
    const c = this.g.s.survivors.find((v) => v.id === msg.from)?.color ?? 'var(--teal)';
    el.innerHTML = `<div class="scene" style="background-image:url(./art/s-${msg.art}.webp)"></div><p><b style="color:${c}">${msg.fromName}</b> ${esc(msg.text)}</p>`;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => (el.hidden = true), 6500);
  }
  private cardTimer = 0;

  /** 0 full interface, 1 compact (portraits only, no minimap), 2 hidden (top buttons only). */
  hudMode = 0;
  private setHud(mode: number) {
    this.hudMode = mode;
    document.body.classList.toggle('hud-compact', mode === 1);
    document.body.classList.toggle('hud-off', mode === 2);
    try {
      localStorage.setItem('last-signal.hud', String(mode));
    } catch {
      /* ignore */
    }
    if (this.g?.started) this.toast(['Interface complète', 'Interface réduite', 'Interface masquée'][mode]);
    this.timer = 0;
  }

  /** The team's Synchro chain changed. */
  onSync(value: number, found: string | null) {
    this.syncFlash = this.now + 1.2;
    if (value === 0) this.toast('Synchro rompue : quelqu’un a été repéré', 'bad');
    else if (found) this.toast(`<b>Synchro ×${value}</b> · trouvaille : ${found}`, 'ok', ORDER_COLOR.hold);
    this.timer = 0;
  }
  private syncFlash = 0;

  toast(text: string, kind: 'ok' | 'bad' | 'wait' = 'ok', color = 'var(--teal)') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.style.setProperty('--c', color);
    d.innerHTML = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3200);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
  }

  /** Make the outcome of a transmitted order impossible to miss. */
  orderFeedback(sv: Survivor, result: 'ack' | 'refused' | 'queued' | 'next') {
    const label = { ack: 'ordre reçu', refused: 'refuse l’ordre', queued: 'hors réseau — ordre en attente', next: 'enchaînera dès que possible' }[result];
    this.toast(`<b>${sv.short}</b> ${label}`, result === 'ack' ? 'ok' : result === 'refused' ? 'bad' : 'wait', sv.color);
    this.flash.set(sv.id, { cls: result === 'ack' ? 'f-ok' : result === 'refused' ? 'f-bad' : 'f-wait', until: this.now + 1.6 });
    if (result === 'refused') navigator.vibrate?.([40, 60, 40]);
    this.timer = 0;
  }

  /** Arrows on the screen edge for survivors outside the camera frame. */
  private edges() {
    const s = this.g.s;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const show = this.g.started && this.screen === null;
    for (const sv of s.survivors) {
      let el = this.edgeEls.get(sv.id);
      if (!el) {
        el = document.createElement('button');
        el.className = 'edge';
        el.dataset.act = 'goto';
        el.dataset.arg = sv.id;
        el.style.setProperty('--c', sv.color);
        el.innerHTML = `<i></i><b>${sv.short[0]}</b>`;
        this.el.edges.appendChild(el);
        this.edgeEls.set(sv.id, el);
      }
      const p = this.g.shown(sv);
      const sp = this.g.project(p.x, p.z);
      const off = sp.x < 0 || sp.x > W || sp.y < 50 || sp.y > H - 10;
      if (!show || !sv.alive || !off) {
        if (!el.hidden) el.hidden = true;
        continue;
      }
      el.hidden = false;
      const x = Math.min(W - 150, Math.max(196, sp.x));
      const y = Math.min(H - 78, Math.max(72, sp.y));
      const a = Math.atan2(sp.y - y, sp.x - x);
      el.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0) translate(-50%,-50%)`;
      (el.firstElementChild as HTMLElement).style.transform = `rotate(${a.toFixed(2)}rad) translateX(17px)`;
      const cls = 'edge' + (['flee', 'down', 'fight'].includes(sv.mode) && sv.linked ? ' danger' : !sv.linked ? ' lost' : '');
      if (el.className !== cls) el.className = cls;
    }
  }

  // ------------------------------------------------------------------ frame
  frame(dt: number, t: number) {
    const s = this.g.s;
    this.now = t;
    this.edges();
    this.tutorial.frame(this.g.started && this.screen === null && s.phase === 'running' && s.awaiting === null);
    this.el.rain.style.opacity = String(Math.max(stormLevel(s) * 0.9, s.time < ((s.flags.rainUntil as number) ?? -1) ? 0.45 : 0));
    const portraitMode = window.innerHeight > window.innerWidth * 1.15 && window.innerWidth < 700;
    this.el.rotate.hidden = !portraitMode || this.rotateDismissed;
    this.wave(t);
    if (this.screen === 'radio') this.type(dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    if (!this.g.started) return;
    this.hud();
    this.minimap();
    if (this.showPerf) {
      const st = this.g.stats();
      this.el.perf.textContent = `${Math.round(1000 / Math.max(1, st.ms))} fps · ${st.ms.toFixed(1)} ms\n${st.calls} draw calls · ${(st.tris / 1000).toFixed(0)}k tris\nqualité ${st.tier} · résolution ×${st.scale.toFixed(2)}`;
    }
  }

  private hud() {
    const g = this.g;
    const s = g.s;
    const sel = g.selected ? s.survivors.find((v) => v.id === g.selected) : null;
    const sig = sel ? (sel.alive ? survivorSignal(s, sel) : 0) : signalAt(s, 'cross_e');
    const left = s.duration - s.time;
    const obj = objectiveStatus(s);
    this.set(
      this.el.status,
      `<div class="sig">${bars(sig)}</div>
       <div class="sig"><small>${sel ? 'Signal ' + sel.short : 'Réseau'}${stormLevel(s) > 0.3 ? ' · orage' : ''}</small><b>${sel && !sel.linked ? 'PERDU' : Math.round(sig * 100) + ' %'}</b></div>
       <div class="clock"><small>${dayName(s.day)} · ${fmtClock(s.time)}</small><b>${left > 0 ? 'Nuit dans ' + fmtTime(left) : 'Nuit'}</b><div class="timebar"><i style="width:${Math.min(100, (s.time / s.duration) * 100).toFixed(1)}%"></i></div></div>
       ${synchro(s) > 0 || this.syncFlash > this.now ? `<div class="sync ${this.syncFlash > this.now ? 'pop' : ''}"><small>Synchro</small><b>×${synchro(s)}</b></div>` : ''}
       <div class="obj-line ${obj.done ? 'done' : ''}">Objectif<br><b>${obj.label}</b>${obj.detail ? ' — ' + obj.detail : ''}</div>`,
    );
    const end = canEndDay(s) && s.time > 20;
    const waiting = s.awaiting !== null;
    this.set(
      this.el.topright,
      `<div class="res panel"><span title="Médicaments">${ICON.pill}${s.resources.medicine}</span><span title="Rations">${ICON.crate}${s.resources.supplies}</span><span title="Pièces">${ICON.wrench}${s.resources.parts}</span></div>
       ${end ? `<button class="btn act" data-act="endday">${ICON.end}<span class="lbl">Finir le jour</span></button>` : ''}
       <button class="btn ${waiting ? 'alert' : ''}" data-act="open" data-arg="radio">${ICON.radio}<span class="lbl">Radio</span></button>
       <button class="btn" data-act="open" data-arg="roster">${ICON.team}<span class="lbl">Équipe</span></button>
       <button class="btn" data-act="open" data-arg="shelter">${ICON.home}<span class="lbl">Abri</span></button>
       <button class="btn" data-act="speed">×${g.speed}</button>
       <button class="btn ${g.paused ? 'act' : ''}" data-act="pause">${g.paused ? ICON.play : ICON.pause}</button>
       <button class="btn" data-act="open" data-arg="settings">${ICON.gear}</button>
       <button class="btn ${this.hudMode ? 'act' : ''}" data-act="hud" title="Afficher ou masquer l’interface">${ICON.eye}</button>`,
    );
    this.set(
      this.el.team,
      s.survivors
        .map((sv) => {
          const st = !sv.alive ? (sv.missing ? 'Disparu·e' : 'Mort·e') : !sv.linked ? (sv.pendingOrder ? `⏳ ${ORDER_LABEL[sv.pendingOrder.type]} en attente du signal` : `Signal perdu · ${fmtTime(s.time - sv.lastReport.time)}`) : sv.mode === 'order' && sv.order ? `${sv.order.stage === 'return' ? 'Retour' : ORDER_LABEL[sv.order.type]}${sv.order.target && sv.order.stage !== 'return' && sv.order.type !== 'retreat' ? ' · ' + nodeName(sv.order.target) : ''}${sv.nextOrder ? ' ▸ ' + ORDER_LABEL[sv.nextOrder.type] : ''}` : `${MODE_LABEL[sv.mode]} · ${nodeName(zoneOf(sv))}`;
          const cls = !sv.alive ? '' : !sv.linked ? 'lost' : ['flee', 'down', 'fight'].includes(sv.mode) ? 'danger' : '';
          const fl = this.flash.get(sv.id);
          const fcls = fl && fl.until > this.now ? fl.cls : '';
          return `<button class="chip ${fcls} ${g.selected === sv.id ? 'sel' : ''} ${sv.alive ? '' : 'dead'}" style="--c:${sv.color}" data-act="select" data-arg="${sv.id}">
            <span class="av">${portrait(sv.id, sv.color, moodOf(sv))}</span><b>${sv.short}${sv.perkPoints > 0 ? ' <u>★</u>' : ''}</b>${sv.alive ? bars(survivorSignal(s, sv)) : '<span></span>'}
            <span class="st ${cls}" ${sv.alive && sv.linked && sv.mode === 'order' && sv.order ? `style="color:${ORDER_COLOR[sv.order.stage === 'return' ? 'retreat' : sv.order.type]}"` : ''}>${st}</span>
            <span class="meters"><span class="mw"><em>♥</em><span class="meter hp"><i style="width:${sv.health.toFixed(0)}%"></i></span></span><span class="mw"><em>ϟ</em><span class="meter fear"><i style="width:${sv.fear.toFixed(0)}%"></i></span></span><span class="mw"><em>☾</em><span class="meter fat"><i style="width:${sv.fatigue.toFixed(0)}%"></i></span></span></span>
          </button>`;
        })
        .join(''),
    );

    // order bar
    const o = this.el.orders;
    if (!sel || !sel.alive || sel.mode === 'down') o.hidden = true;
    else {
      o.hidden = false;
      if (g.orderType && g.chosen) {
        const len = g.route ? Math.round(pathLength(g.route)) : 0;
        const risk = g.route ? g.route.slice(1).reduce((a, n) => Math.max(a, s.intel[n].seenAt !== -1 ? s.intel[n].threat : 0), 0) : 0;
        const unknown = g.route ? g.route.filter((n) => s.intel[n].seenAt < 0).length : 0;
        const dead = g.route ? g.route.some((n) => signalAt(s, n) < LINK_THRESHOLD) : false;
        this.set(
          o,
          `<div class="confirm" style="--oc:${ORDER_COLOR[g.orderType]}"><p><b>${sel.short} → ${ORDER_LABEL[g.orderType]}</b> · ${nodeName(g.chosen)}<small>${len} m${risk ? ` · ☣ ${risk} signalés` : ''}${unknown ? ` · ${unknown} secteur${unknown > 1 ? 's' : ''} non reconnu${unknown > 1 ? 's' : ''}` : ''}${dead ? ' · zone sans signal' : ''}</small></p>
           <button class="btn primary" data-act="confirm">${sel.order ? 'Maintenant' : 'Transmettre'}</button>${sel.order && sel.linked ? '<button class="btn" data-act="confirm-next">Ensuite</button>' : ''}<button class="btn ghost" data-act="cancel">Annuler</button></div>`,
        );
      } else if (g.orderType) {
        this.set(o, `<div class="confirm" style="--oc:${ORDER_COLOR[g.orderType]}"><p><b>${ORDER_LABEL[g.orderType]}</b><small>${g.targets.length ? 'Touchez une destination surlignée sur la carte.' : 'Aucune cible connue pour cet ordre.'}</small></p><button class="btn ghost" data-act="cancel">Annuler</button></div>`);
      } else {
        this.set(
          o,
          ORDERS.map((t) => {
            const dis = t === 'rescue' && validTargets(s, sel, 'rescue').length === 0;
            const on = sel.order?.type === t && sel.mode === 'order';
            const apt = t === 'retreat' ? 0 : aptitude(sel, t);
            return `<button class="o ${on ? 'on' : ''}" style="--oc:${ORDER_COLOR[t]}" data-act="order" data-arg="${t}" ${dis ? 'disabled' : ''}>${ICON[t]}${ORDER_LABEL[t]}${apt ? `<span class="apt">${'<i class="on"></i>'.repeat(apt)}${'<i></i>'.repeat(5 - apt)}</span>` : '<span class="apt"></span>'}</button>`;
          }).join('') +
            (zoneOf(sel) !== 'shelter'
              ? (Object.keys(ITEMS) as ItemId[]).map((id) => `<button class="o item" data-act="item" data-arg="${id}" title="${ITEMS[id].hint}" ${canUseItem(s, sel, id) ? '' : 'disabled'}><b>${id === 'decoy' ? '⏰' : '☁'}</b>${ITEMS[id].name}<span class="apt cost">1 ${ITEMS[id].costName}</span></button>`).join('')
              : ''),
        );
      }
    }

    // ticker
    const m = this.lastMsg;
    const tk = this.el.ticker;
    if (m && s.time - m.time < 40 && this.screen === null) {
      tk.hidden = false;
      tk.className = m.kind === 'alert' ? 'alert' : '';
      tk.dataset.act = 'open';
      tk.dataset.arg = 'radio';
      const c = s.survivors.find((v) => v.id === m.from)?.color ?? (m.from === 'unknown' ? 'var(--purple)' : 'var(--teal)');
      this.set(tk, `<b style="color:${c}">${m.fromName}</b><span>${m.delayed ? '<em>(différé)</em> ' : ''}${garble(m.text, m.signal, m.id)}</span>`);
    } else tk.hidden = true;

  }

  private minimap() {
    const cv = this.el.minimap;
    const c = cv.getContext('2d')!;
    const s = this.g.s;
    const k = cv.width / 152;
    const X = (x: number) => (x + 76) * k;
    const Z = (z: number) => (z + 57) * k;
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#10141c';
    c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#16343a';
    c.fillRect(X(CANAL.x0), 0, (CANAL.x1 - CANAL.x0) * k, cv.height);
    c.lineCap = 'round';
    for (const e of EDGES) {
      const a = NODE[e.a];
      const b = NODE[e.b];
      const known = s.intel[e.a].seenAt >= 0 && s.intel[e.b].seenAt >= 0;
      c.strokeStyle = known ? '#586170' : '#2a303a';
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(X(a.x), Z(a.z));
      for (const v of e.via ?? []) c.lineTo(X(v[0]), Z(v[1]));
      c.lineTo(X(b.x), Z(b.z));
      c.stroke();
    }
    if (this.g.route) {
      c.strokeStyle = ORDER_COLOR[this.g.orderType ?? 'scout'];
      c.lineWidth = 3;
      c.beginPath();
      this.g.route.forEach((n, i) => (i ? c.lineTo(X(NODE[n].x), Z(NODE[n].z)) : c.moveTo(X(NODE[n].x), Z(NODE[n].z))));
      c.stroke();
    }
    for (const n of NODES) {
      const it = s.intel[n.id];
      c.fillStyle = n.id === 'shelter' ? '#3fe0c5' : n.kind === 'interior' ? '#a78bfa' : it.seenAt >= 0 ? '#8891a0' : '#3a414d';
      c.beginPath();
      if (n.kind === 'interior' || n.id === 'shelter') c.rect(X(n.x) - 5, Z(n.z) - 5, 10, 10);
      else c.arc(X(n.x), Z(n.z), 3.5, 0, 7);
      c.fill();
      if (n.id !== 'shelter' && signalAt(s, n.id) < LINK_THRESHOLD) {
        c.strokeStyle = 'rgba(240,178,74,0.85)';
        c.lineWidth = 1.5;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.arc(X(n.x), Z(n.z), 10, 0, 7);
        c.stroke();
        c.setLineDash([]);
      }
      if (it.lootKnown && s.loot[n.id] && stockTotal(s.loot[n.id]) > 0) {
        c.fillStyle = '#e6cf7a';
        c.save();
        c.translate(X(n.x) - 8, Z(n.z) + 8);
        c.rotate(Math.PI / 4);
        c.fillRect(-3, -3, 6, 6);
        c.restore();
      }
      if (it.threat > 0 && it.seenAt !== -1) {
        const fresh = s.time - it.seenAt < 4;
        c.fillStyle = fresh ? '#ff5a45' : 'rgba(255,107,87,0.45)';
        c.beginPath();
        c.arc(X(n.x) + 7, Z(n.z) - 7, 3 + Math.min(4, it.threat), 0, 7);
        c.fill();
      }
    }
    for (const sv of s.survivors) {
      if (!sv.alive) continue;
      const p = this.g.shown(sv);
      c.fillStyle = sv.color;
      c.globalAlpha = sv.linked ? 1 : 0.5;
      c.beginPath();
      c.arc(X(p.x), Z(p.z), 6, 0, 7);
      c.fill();
      c.globalAlpha = 1;
      if (this.g.selected === sv.id) {
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.stroke();
      }
    }
    const v = this.g.view();
    const aspect = window.innerWidth / window.innerHeight;
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 1.5;
    c.save();
    c.translate(X(v.x), Z(v.z));
    c.rotate(-Math.PI / 4);
    c.strokeRect(-v.zoom * aspect * k, (-v.zoom * k) / 0.64, v.zoom * aspect * 2 * k, (v.zoom * 2 * k) / 0.64);
    c.restore();
    void darkness;
  }

  // ------------------------------------------------------------------ radio typing + waveform
  private type(dt: number) {
    const p = document.getElementById('rmsg');
    if (!p) return;
    const id = +(p.dataset.id ?? -1);
    const msg = this.g.s.radio.find((m) => m.id === id);
    if (!msg) return;
    if (this.typingMsg !== id) {
      this.typingMsg = id;
      this.typed = 0;
    }
    if (this.typed >= msg.text.length) {
      if (p.dataset.done !== '1') {
        p.dataset.done = '1';
        p.innerHTML = garble(msg.text, msg.signal, msg.id);
      }
      return;
    }
    this.typed += dt * 70;
    p.dataset.done = '';
    p.innerHTML = garble(msg.text.slice(0, Math.floor(this.typed)), msg.signal, msg.id) + '<span class="g">▌</span>';
    if (Math.random() < 0.3) audio.tick();
  }

  private wave(t: number) {
    const cv = document.getElementById('wave') as HTMLCanvasElement | null;
    if (!cv) return;
    const c = cv.getContext('2d')!;
    const sig = +(cv.dataset.sig ?? 1);
    const talking = this.typingMsg >= 0 && document.getElementById('rmsg')?.dataset.done !== '1';
    c.clearRect(0, 0, cv.width, cv.height);
    const n = 48;
    for (let i = 0; i < n; i++) {
      const voice = talking ? Math.abs(Math.sin(t * 9 + i * 0.7) * Math.sin(t * 3.1 + i * 0.23)) : 0.04;
      const noise = (1 - sig) * Math.random() * 0.7;
      const h = Math.min(1, voice * (0.4 + sig * 0.6) + noise) * cv.height;
      c.fillStyle = noise > voice ? 'rgba(167,139,250,0.7)' : 'rgba(63,224,197,0.9)';
      c.fillRect((i / n) * cv.width, (cv.height - h) / 2, cv.width / n - 2, Math.max(2, h));
    }
  }

  // ------------------------------------------------------------------ screens
  render() {
    const o = this.el.overlay;
    if (this.screen === null) return;
    const s = this.g.s;
    let html = '';
    const head = (title: string, sub = '', closable = true) => `<header><h2>${title}</h2><small>${sub}</small>${closable ? '<button class="x" data-act="close">✕</button>' : ''}</header>`;

    if (this.screen === 'scene') {
      html = ''; // the scene plays in the world, not in a window
    } else if (this.screen === 'title') {
      const tier = storedTier();
      html = `<div class="sheet"><div class="scene hero" style="background-image:url(./art/s-shelter.webp)"></div><div class="title">
        <h1>LAST <span>SIGNAL</span></h1>
        <p>La ville est tombée. Vous êtes la voix d’ECHO-7 : vous ne voyez que ce que vos survivants vous rapportent, et ils ne vous obéissent que s’ils vous font confiance.</p>
        <div class="menu">
          ${this.g.hasSave() ? '<button class="btn primary" data-act="continue">Continuer</button>' : ''}
          <button class="btn ${this.g.hasSave() ? '' : 'primary'}" data-act="new" data-arg="tuto">Nouvelle partie</button>
          ${Tutorial.seen() ? '<button class="btn ghost" data-act="new" data-arg="skip">Sans la formation</button>' : ''}
          <button class="btn ghost" data-act="open" data-arg="profile">Carnet de l’opérateur</button>
          <button class="btn ghost" data-act="open" data-arg="about">À propos</button>
          <div class="diffrow"><small>Difficulté</small>${diffSeg()}</div>
        </div>
        <div class="row" style="justify-content:center;margin-top:14px"><div class="seg">${(['auto', 'low', 'medium', 'high'] as const).map((t) => `<button class="${tier === t ? 'on' : ''}" data-act="tier" data-arg="${t}">${{ auto: 'Auto', low: 'Léger', medium: 'Moyen', high: 'Élevé' }[t]}</button>`).join('')}</div></div>
        <footer>Tranche verticale 0.2 · hors-ligne · sauvegarde locale automatique</footer>
      </div></div>`;
    } else if (this.screen === 'radio') {
      const await_ = s.awaiting !== null ? s.radio.find((m) => m.id === s.awaiting) : null;
      const m = await_ ?? this.lastMsg ?? s.radio[s.radio.length - 1];
      const sv = m ? s.survivors.find((v) => v.id === m.from) : undefined;
      const who = sv ? `<b>${sv.name}</b><small>${sv.role}</small>` : `<b>${m?.fromName ?? 'ECHO-7'}</b><small>${m?.from === 'unknown' ? 'Fréquence non identifiée' : 'Station radio'}</small>`;
      html = `<div class="sheet">${head(await_?.incident === 'briefing' ? `${dayName(s.day)} · ${mission(s).title}` : 'Transmission · canal 7', `${dayName(s.day)} · ${fmtClock(m?.time ?? s.time)}`, !await_)}<div class="body">
        ${m?.art ? `<div class="scene" style="background-image:url(./art/s-${m.art}.webp)"></div>` : ''}
        ${m ? `<div class="radio"><div class="who"><div class="portrait">${portrait(sv ? sv.id : m.from === 'unknown' ? 'unknown' : 'echo', sv?.color, sv ? { ...moodOf(sv), lost: m.signal < 0.34 } : {})}</div><div>${who}<div class="sigrow">${bars(m.signal)} ${Math.round(m.signal * 100)} %${m.delayed ? ' · message différé' : ''}</div></div><canvas id="wave" width="300" height="68" data-sig="${m.signal}"></canvas></div>
        <div><p class="msg mono" id="rmsg" data-id="${m.id}" data-act="skip"></p>
        ${await_ ? `<div class="choices">${await_.choices!.map((c) => `<button class="choice" data-act="choice" data-arg="${c.id}"><b>${c.label}</b><small>${c.hint}</small></button>`).join('')}</div>` : ''}</div></div>` : '<p>Aucune transmission.</p>'}
        ${!await_ ? `<h4 style="margin:14px 0 6px;font-size:10px;letter-spacing:.16em;color:var(--dim)">JOURNAL</h4><div class="log">${[...s.radio].reverse().slice(0, 40).map((r) => `<div class="${r.kind}"><time>${fmtClock(r.time)}</time><b>${r.fromName}</b>${r.delayed ? '<em>différé</em>' : ''} — ${garble(r.text, r.signal, r.id)}${r.chosen ? ` <em>→ ${esc(r.choices?.find((c) => c.id === r.chosen)?.label ?? '')}</em>` : ''}</div>`).join('')}</div>` : ''}
      </div></div>`;
    } else if (this.screen === 'roster') {
      html = `<div class="sheet">${head('Équipe', `${dayName(s.day)}`)}<div class="body"><div class="cards">${s.survivors.map((sv) => this.card(sv)).join('')}</div>
        ${s.rescued.length ? `<h4 class="sec">À l’abri grâce à vous</h4><div class="npcs">${[...new Set(s.rescued)].map((n) => NPCS[n]).filter(Boolean).map((n) => `<div class="npc"><div class="portrait">${portrait(n.id, n.color, { hurt: n.id === 'patient' })}</div><div><b>${n.name}</b><small>${n.role}</small><p>${n.note}</p></div></div>`).join('')}</div>` : ''}</div></div>`;
    } else if (this.screen === 'shelter') {
      const cap = storageCap(s);
      html = `<div class="sheet">${head('ECHO-7 · abri', 'Les améliorations sont permanentes')}<div class="body">
        <div class="stockline"><span>${ICON.pill ? '' : ''}Médicaments <b>${s.resources.medicine}</b>/${cap}</span><span>Rations <b>${s.resources.supplies}</b>/${cap}</span><span>Pièces <b>${s.resources.parts}</b>/${cap}</span><span>Fusées <b>${s.resources.flares}</b></span><span style="color:var(--dim)">Chaque nuit : 1 ration par survivant, 1 dose pour l’infirmerie.</span></div>
        <div class="up">${UPGRADES.map((u) => {
          const lvl = s.shelter[u.key];
          const next = u.levels[lvl];
          const block = upgradeBlocker(s, u.key);
          const names = { supplies: 'ration', medicine: 'médic.', parts: 'pièce' } as const;
          return `<div class="upc"><h3>${u.name}<span class="pips">${u.levels.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span></h3>
            <p>${lvl === 0 ? u.base : u.levels[lvl - 1].effect}</p>
            ${next ? `<p class="next">▸ Niv. ${lvl + 1} : ${next.effect}</p>` : ''}
            <footer>${next ? `<span class="cost">${(Object.entries(next.cost) as [keyof typeof names, number][]).map(([k, v]) => `<span class="${s.resources[k] < v ? 'no' : ''}">${v} ${names[k]}${v > 1 && k !== 'medicine' ? 's' : ''}</span>`).join('')}</span><button class="btn ${block ? '' : 'primary'}" data-act="buy" data-arg="${u.key}" ${block ? 'disabled' : ''}>${block && block !== 'Ressources insuffisantes' ? block : 'Améliorer'}</button>` : '<span class="cost">Niveau maximum</span>'}</footer></div>`;
        }).join('')}</div></div></div>`;
    } else if (this.screen === 'debrief' && s.debrief) {
      const d = s.debrief;
      const list = (items: string[], none: string) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<div class="none">${none}</div>`);
      const alive = s.survivors.some((v) => v.alive);
      html = `<div class="sheet debrief">${head(d.day === 0 ? 'Débrief · formation' : `Débrief · fin du jour ${d.day}`, '', false)}<div class="body paper">
        <span class="stamp ${d.rating}">${{ succes: 'MISSION ACCOMPLIE', mitige: 'BILAN MITIGÉ', echec: 'ÉCHEC' }[d.rating]}</span>
        <h1>${esc(d.headline)}</h1>
        <div class="cols" style="margin-top:12px">
          <div><h4>Pertes</h4>${list(d.deaths, 'Aucune.')}</div>
          <div><h4>Secourus</h4>${list(d.rescues, 'Personne.')}</div>
          <div><h4>Rapporté à l’abri</h4><ul><li>${d.gained.medicine} médicaments</li><li>${d.gained.supplies} rations</li><li>${d.gained.parts} pièces</li></ul></div>
          <div><h4>Signaux non résolus</h4>${list(d.unresolved, 'Aucun. La fréquence est silencieuse.')}</div>
          <div style="grid-column:1/-1"><h4>Progression</h4><div class="xprow">${s.survivors.filter((v) => v.alive).map((v) => `<div class="xp ${v.perkPoints > 0 ? 'up' : ''}" style="--c:${v.color}"><b>${v.short}</b><span>Niv. ${v.level}${d.xp?.[v.id] ? ` · +${d.xp[v.id]} XP` : ''}</span><span class="meter"><i style="width:${Math.round(levelProgress(v) * 100)}%"></i></span>${v.perkPoints > 0 ? '<em>★ compétence à choisir dans Équipe</em>' : ''}</div>`).join('')}</div></div>
          <div style="grid-column:1/-1"><h4>Conséquences</h4>${list(d.consequences, '—')}</div>
        </div></div>
        <div class="actions"><button class="btn" data-act="open" data-arg="roster">${ICON.team} Équipe</button><button class="btn" data-act="open" data-arg="shelter">${ICON.home} Abri</button><button class="btn ghost" data-act="new">Nouvelle partie</button>${this.g.canRetryDay() && d.day > 0 ? `<button class="btn ${alive ? 'ghost' : 'primary'}" data-act="retry">Rejouer la journée</button>` : ''}${alive || d.day >= LAST_DAY ? `<button class="btn primary" data-act="nextday">${d.day >= LAST_DAY ? 'Épilogue' : 'Jour suivant'}</button>` : ''}</div></div>`;
    } else if (this.screen === 'ending' && s.ending) {
      html = `<div class="sheet debrief">${head('Dernier signal · épilogue', `${LAST_DAY} jours`, false)}<div class="body ending paper"><div class="scene" style="background-image:url(./art/s-${s.persistent.final === 'leave' ? 'boat' : 'final'}.webp)"></div>
        ${s.ending.map((l, i) => `<p style="animation-delay:${(i * 0.9).toFixed(1)}s">${esc(l)}</p>`).join('')}
        ${s.rescued.length ? `<div class="npcs" style="margin-top:12px">${[...new Set(s.rescued)].map((n) => NPCS[n]).filter(Boolean).map((n) => `<div class="npc"><div class="portrait">${portrait(n.id, n.color)}</div><div><b>${n.name}</b><small>${n.role}</small></div></div>`).join('')}</div>` : ''}
        </div><div class="actions"><button class="btn" data-act="open" data-arg="roster">${ICON.team} Équipe</button><button class="btn primary" data-act="new">Nouvelle partie</button></div></div>`;
    } else if (this.screen === 'about') {
      html = `<div class="sheet">${head('À propos', `Version ${VERSION}`, false)}<div class="body about">
        <h4>Le jeu</h4><p>LAST SIGNAL est un jeu de stratégie et de survie : vous dirigez par radio trois survivants qui décident eux-mêmes s’ils vous obéissent.</p>
        <h4>Confidentialité</h4><p>Le jeu fonctionne hors ligne. Sauvegarde, réglages, succès et rapports d’erreurs restent sur cet appareil ; aucune donnée n’est collectée ni transmise. Effacer les données du site dans le navigateur supprime tout.</p>
        <h4>Crédits</h4><p>Conception et développement : Nytha IA. Illustrations, portraits et modèles 3D des personnages créés avec des outils d’IA générative (Magnific). Sons entièrement synthétisés par le jeu. Moteur 3D : three.js (licence MIT). Polices : Saira Stencil One et Special Elite (licence OFL).</p>
        <h4>Avertissement</h4><p>Œuvre de fiction : situations de danger, blessures et morts de personnages. Déconseillé aux plus jeunes.</p>
        </div><div class="actions"><button class="btn primary" data-act="open" data-arg="${this.g.started ? 'settings' : 'title'}">Retour</button></div></div>`;
    } else if (this.screen === 'profile') {
      const p = loadProfile();
      const n = ACHIEVEMENTS.filter((a) => p.done[a.id]).length;
      html = `<div class="sheet">${head('Carnet de l’opérateur', `${n} / ${ACHIEVEMENTS.length} succès`, false)}<div class="body">
        <div class="pstats">${[['Parties', p.runs], ['Journées tenues', p.days], ['Secourus', p.rescued], ['Perdus', p.lost], ['Meilleure Synchro', '×' + p.bestSync], ['Fins vues', `${p.endings.length} / 2`]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
        <div class="achs">${ACHIEVEMENTS.map((a) => `<div class="ach ${p.done[a.id] ? 'on' : ''}"><i>${p.done[a.id] ? '★' : '☆'}</i><div><b>${a.name}</b><small>${a.text}</small></div></div>`).join('')}</div>
        </div><div class="actions"><button class="btn primary" data-act="open" data-arg="${this.g.started ? 'settings' : 'title'}">Retour</button></div></div>`;
    } else if (this.screen === 'settings') {
      const tier = storedTier();
      html = `<div class="sheet">${head('Réglages')}<div class="body"><div class="settings">
        <div class="row"><label>Qualité graphique<small>Recharge la page. La partie est sauvegardée.</small></label><div class="seg">${(['auto', 'low', 'medium', 'high'] as const).map((t) => `<button class="${tier === t ? 'on' : ''}" data-act="tier" data-arg="${t}">${{ auto: 'Auto', low: 'Léger', medium: 'Moyen', high: 'Élevé' }[t]}</button>`).join('')}</div></div>
        <div class="row"><label>Son</label><button class="btn" data-act="sound">${audio.muted ? 'Coupé' : 'Activé'}</button></div>
        ${([['master', 'Volume général'], ['ambience', 'Ambiance'], ['music', 'Musique'], ['sfx', 'Effets et radio']] as const).map(([ch, label]) => `<div class="row"><label>${label}</label><input type="range" min="0" max="100" value="${Math.round(audio.vol[ch] * 100)}" data-vol="${ch}" aria-label="${label}"></div>`).join('')}
        <div class="row"><label>Difficulté<small>${DIFFICULTY[storedDifficulty()].note}</small></label>${diffSeg()}</div>
        <div class="row"><label>Taille du texte</label><div class="seg">${['Normal', 'Grand', 'Très grand'].map((t, i) => `<button class="${storedText() === i ? 'on' : ''}" data-act="text" data-arg="${i}">${t}</button>`).join('')}</div></div>
        <div class="row"><label>Couleurs adaptées<small>Palette des ordres lisible avec un daltonisme ; chaque ordre garde aussi son symbole.</small></label><button class="btn" data-act="safe">${storedSafe() ? 'Activées' : 'Désactivées'}</button></div>
        <div class="row"><label>Voix parlées<small>${audio.voiceAvailable ? 'Synthèse vocale du navigateur : hors-ligne, qualité variable selon l’appareil.' : 'Non disponible sur ce navigateur.'}</small></label><button class="btn" data-act="voice" ${audio.voiceAvailable ? '' : 'disabled'}>${audio.voice ? 'Activées' : 'Désactivées'}</button></div>
        <div class="row"><label>Profilage<small>FPS, draw calls, triangles, résolution dynamique.</small></label><button class="btn" data-act="perf">${this.showPerf ? 'Affiché' : 'Masqué'}</button></div>
        <div class="row"><label>Formation<small>La rejouer, guidée par Mara, à la prochaine nouvelle partie.</small></label><button class="btn" data-act="tut-reset">Réactiver</button></div>
        <div class="row"><label>Carnet de l’opérateur<small>Statistiques et succès.</small></label><button class="btn" data-act="open" data-arg="profile">Ouvrir</button></div>
        <div class="row"><label>Signaler un problème<small>Copie un rapport technique (version, écran, erreurs récentes). Rien n’est envoyé automatiquement.</small></label><button class="btn" data-act="report">Copier le rapport</button></div>
        <div class="row"><label>À propos<small>Version ${VERSION} · crédits et confidentialité.</small></label><button class="btn" data-act="open" data-arg="about">Lire</button></div>
        <div class="row"><label>Plein écran</label><button class="btn" data-act="fullscreen">Activer</button></div>
        <div class="row"><label>Journée en cours<small>Ceux qui sont dehors passeront la nuit dehors.</small></label><button class="btn" data-act="endday">Terminer la journée</button><button class="btn ghost" data-act="new">Nouvelle partie</button></div>
      </div></div></div>`;
    }
    this.set(o, html);
    if (this.screen === 'radio') {
      this.typingMsg = -1;
      const p = document.getElementById('rmsg');
      if (p && s.awaiting === null) this.typed = 1e9;
    }
  }

  private card(sv: Survivor): string {
    const s = this.g.s;
    const stat = (label: string, v: number, cls: string) => `<div class="stat">${label}<span class="meter ${cls}"><i style="width:${Math.round(v)}%"></i></span><b>${Math.round(v)}</b></div>`;
    const rel = Object.entries(sv.relations)
      .map(([id, v]) => {
        const o = s.survivors.find((x) => x.id === id);
        return o ? `<span class="pill">${o.short} ${v >= 65 ? '♥' : v >= 45 ? '·' : '✕'} ${Math.round(v)}</span>` : '';
      })
      .join('');
    const gear = [...sv.equipment.map((e) => (e === 'Pistolet' ? `Pistolet (${sv.ammo})` : e))];
    return `<div class="card ${sv.alive ? '' : 'dead'}"><div class="head"><div class="portrait">${portrait(sv.id, sv.color, moodOf(sv))}</div><div><h3>${sv.name}</h3><div class="role">${sv.role} · ${sv.alive ? MODE_LABEL[sv.mode] : sv.missing ? 'Disparu·e' : 'Mort·e'}</div></div></div>
      <div class="pills">${sv.traits.map((t) => `<span class="pill">${t}</span>`).join('')}${sv.perks.map((id) => `<span class="pill perk" title="${PERKS[sv.id]?.find((p) => p.id === id)?.desc ?? ''}">★ ${PERKS[sv.id]?.find((p) => p.id === id)?.name ?? id}</span>`).join('')}</div>
      <div class="lvl"><b>Niv. ${sv.level}</b><span class="meter"><i style="width:${Math.round(levelProgress(sv) * 100)}%"></i></span><small>${LEVELS[sv.level] !== undefined ? `${sv.xp}/${LEVELS[sv.level]} XP` : 'max'}</small></div>
      ${sv.alive && sv.perkPoints > 0 ? `<div class="offer"><h4>★ Nouvelle compétence</h4>${perkOffer(sv).map((p) => `<button class="choice" data-act="perk" data-arg="${sv.id}:${p.id}"><b>${p.name}</b><small>${p.desc}</small></button>`).join('')}</div>` : ''}
      ${stat('Santé', sv.health, 'hp')}${stat('Stress', sv.fear, 'fear')}${stat('Fatigue', sv.fatigue, 'fat')}${stat('Courage', sv.courage, 'hp')}${stat('Confiance', sv.trust, 'hp')}
      <h4>Aptitudes</h4><div class="apts">${(['scout', 'retrieve', 'hold', 'rescue'] as const).map((k) => `<div style="--oc:${ORDER_COLOR[k]}">${ICON[k]}<span>${ORDER_LABEL[k]}</span><span class="apt">${'<i class="on"></i>'.repeat(aptitude(sv, k))}${'<i></i>'.repeat(5 - aptitude(sv, k))}</span></div>`).join('')}</div>
      <h4>Équipement</h4><div class="pills">${gear.map((e) => `<span class="pill">${e}</span>`).join('')}</div>
      <h4>Relations</h4><div class="pills">${rel}</div>
      <h4>Mémoire</h4>${[...sv.memory].reverse().slice(0, 4).map((m) => `<div class="mem ${m.tone < -0.15 ? 'bad' : m.tone > 0.15 ? 'good' : ''}">${m.day > 0 ? `J${m.day} · ` : ''}${esc(m.text)}</div>`).join('')}
    </div>`;
  }
}

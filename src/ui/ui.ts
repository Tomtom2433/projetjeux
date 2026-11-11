// DOM interface: tactical HUD, radio, roster, shelter, debrief, title.
import type { GameState, NodeId, OrderType, RadioMessage, Shelter, Survivor } from '../sim/types';
import { NODE, NODES, EDGES, CANAL } from '../sim/world';
import { LINK_THRESHOLD, pathLength, signalAt, stormLevel, survivorSignal, zoneOf, darkness } from '../sim/core';
import { canEndDay, validTargets } from '../sim/sim';
import { UPGRADES, storageCap, upgradeBlocker } from '../sim/state';
import { MODE_LABEL, ORDER_LABEL, fmtClock, fmtTime, nodeName } from '../sim/text';
import { storedTier, storeTier, type Tier } from '../render/quality';
import { audio } from './audio';

export type Screen = 'title' | 'radio' | 'roster' | 'shelter' | 'debrief' | 'settings' | null;

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
  cancelOrder(): void;
  choose(choiceId: string): void;
  buy(key: keyof Shelter): void;
  endDayNow(): void;
  nextDay(): void;
  newGame(): void;
  continueGame(): void;
  hasSave(): boolean;
  focus(x: number, z: number): void;
  togglePause(): void;
  cycleSpeed(): void;
  stats(): { calls: number; tris: number; scale: number; ms: number; tier: string };
  view(): { x: number; z: number; zoom: number };
}

const svg = (d: string, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${extra}<path d="${d}"/></svg>`;
const ICON: Record<string, string> = {
  radio: svg('M12 11v9M8.5 20h7M8.2 8.2a5.4 5.4 0 0 1 7.6 0M5.4 5.4a9.3 9.3 0 0 1 13.2 0', '<circle cx="12" cy="10.5" r="1.2" fill="currentColor"/>'),
  team: svg('M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15.5 14.6c3 .2 5.5 2.1 5.5 5.4', '<circle cx="9" cy="8" r="3.4"/><circle cx="17" cy="9" r="2.6"/>'),
  home: svg('M3.5 11.5 12 4l8.5 7.5M6 10v9.5h12V10M10 19.5v-5h4v5'),
  pause: svg('M8 5v14M16 5v14'),
  play: svg('M7 4.5v15l12-7.5z'),
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

function portrait(id: string, color = '#3fe0c5'): string {
  const scan = `<g opacity=".16" stroke="#fff" stroke-width=".6">${Array.from({ length: 16 }, (_, i) => `<path d="M0 ${i * 6.4 + 2}h100"/>`).join('')}</g>`;
  if (id === 'unknown')
    return `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#14121f"/><g fill="#3b3560">${Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 37) % 100}" y="${(i * 53) % 100}" width="${8 + ((i * 7) % 20)}" height="2"/>`).join('')}</g><text x="50" y="66" font-size="52" font-weight="800" text-anchor="middle" fill="#a78bfa" font-family="system-ui">?</text>${scan}</svg>`;
  if (id === 'echo')
    return `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#0f1a1c"/><g fill="none" stroke="#3fe0c5" stroke-width="4" stroke-linecap="round"><path d="M36 40a20 20 0 0 1 28 0"/><path d="M26 30a34 34 0 0 1 48 0" opacity=".5"/><path d="M50 50v32M40 82h20M50 50 40 82M50 50l10 32" stroke="#e9e4d8"/></g><circle cx="50" cy="48" r="5" fill="#a78bfa"/>${scan}</svg>`;
  const hair: Record<string, string> = {
    mara: '<path d="M32 40c-2-18 8-26 18-26s20 8 18 26c-3-9-8-13-18-13s-15 4-18 13z" fill="#2b1d16"/><path d="M66 38c4 6 4 16 1 22l-5-6z" fill="#2b1d16"/>',
    jo: '<path d="M33 36c0-13 8-20 17-20s17 7 17 20c-5-7-10-9-17-9s-12 2-17 9z" fill="#5a5148"/><path d="M36 50c3 10 8 14 14 14s11-4 14-14c-2 4-7 6-14 6s-12-2-14-6z" fill="#4a423a"/>',
    lena: '<path d="M30 46c-3-22 8-32 20-32s23 10 20 32c-2-12-8-18-20-18s-18 6-20 18z" fill="#c9a25a"/><path d="M30 44c-3 10-2 20 2 28l6-10zM70 44c3 10 2 20-2 28l-6-10z" fill="#c9a25a"/>',
  };
  return `<svg viewBox="0 0 100 100"><defs><linearGradient id="pg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232a36"/><stop offset="1" stop-color="#0d1016"/></linearGradient></defs><rect width="100" height="100" fill="url(#pg${id})"/><path d="M14 100c0-20 14-32 36-32s36 12 36 32z" fill="${color}"/><path d="M40 70h20l-4 12H44z" fill="#0d1016" opacity=".35"/><rect x="44" y="52" width="12" height="18" rx="4" fill="#c79b7c"/><ellipse cx="50" cy="40" rx="16" ry="19" fill="#d6ab8b"/>${hair[id] ?? ''}${scan}</svg>`;
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
  };
  private timer = 0;
  private cache = new Map<HTMLElement, string>();
  private lastMsg: RadioMessage | null = null;
  private typed = 0;
  private typingMsg = -1;
  private coachDone = false;
  private rotateDismissed = false;

  constructor(private g: GameApi) {
    this.el.status.className = 'panel';
    this.el.orders.className = 'panel';
    try {
      this.coachDone = localStorage.getItem('last-signal.coach') === '1';
    } catch {
      /* ignore */
    }
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
      else if (e.key >= '1' && e.key <= '3') this.g.select(this.g.s.survivors[+e.key - 1]?.id ?? null, true);
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
      case 'select': g.select(g.selected === arg ? arg : arg, g.selected === arg); break;
      case 'order': g.pickOrder(arg as OrderType); break;
      case 'confirm': g.confirmOrder(); this.finishCoach(); break;
      case 'cancel': g.cancelOrder(); break;
      case 'choice': g.choose(arg); break;
      case 'buy': g.buy(arg as keyof Shelter); this.render(); break;
      case 'pause': g.togglePause(); break;
      case 'speed': g.cycleSpeed(); break;
      case 'endday': g.endDayNow(); break;
      case 'nextday': g.nextDay(); break;
      case 'new': g.newGame(); break;
      case 'continue': g.continueGame(); break;
      case 'tier': storeTier(arg as Tier | 'auto'); location.reload(); break;
      case 'sound': audio.setMuted(!audio.muted); this.render(); break;
      case 'perf': this.showPerf = !this.showPerf; this.el.perf.hidden = !this.showPerf; this.render(); break;
      case 'skip': this.typed = 1e9; break;
      case 'fullscreen': document.documentElement.requestFullscreen?.().catch(() => {}); break;
    }
    this.timer = 0;
  }

  private finishCoach() {
    if (this.coachDone) return;
    this.coachDone = true;
    try {
      localStorage.setItem('last-signal.coach', '1');
    } catch {
      /* ignore */
    }
  }

  open(screen: Screen) {
    this.screen = screen;
    this.el.overlay.hidden = screen === null;
    this.el.hud.hidden = screen === 'title' || !this.g.started;
    this.cache.delete(this.el.overlay);
    this.render();
  }

  close() {
    if (this.g.s.awaiting !== null && this.screen === 'radio') return;
    this.open(this.g.s.phase === 'debrief' ? 'debrief' : null);
  }

  onRadio(msg: RadioMessage) {
    this.lastMsg = msg;
    if (msg.kind === 'alert') audio.alert();
    else audio.blip(msg.signal);
    if (msg.choices && !msg.chosen) this.open('radio');
    else if (this.screen === 'radio') this.render();
  }

  // ------------------------------------------------------------------ frame
  frame(dt: number, t: number) {
    const s = this.g.s;
    this.el.rain.style.opacity = String(stormLevel(s) * 0.9);
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
    const med = s.delivered.medicine;
    this.set(
      this.el.status,
      `<div class="sig">${bars(sig)}</div>
       <div class="sig"><small>${sel ? 'Signal ' + sel.short : 'Réseau'}${stormLevel(s) > 0.3 ? ' · orage' : ''}</small><b>${sel && !sel.linked ? 'PERDU' : Math.round(sig * 100) + ' %'}</b></div>
       <div class="clock"><small>Jour ${s.day} · ${fmtClock(s.time)}</small><b>${left > 0 ? 'Nuit dans ' + fmtTime(left) : 'Nuit'}</b><div class="timebar"><i style="width:${Math.min(100, (s.time / s.duration) * 100).toFixed(1)}%"></i></div></div>
       <div class="obj-line ${med >= 2 ? 'done' : ''}">Objectif<br><b>Médicaments ${med}/2</b>${med >= 2 ? ' — rentrez tous' : ''}</div>`,
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
       <button class="btn" data-act="open" data-arg="settings">${ICON.gear}</button>`,
    );
    this.set(
      this.el.team,
      s.survivors
        .map((sv) => {
          const st = !sv.alive ? (sv.missing ? 'Disparu·e' : 'Mort·e') : !sv.linked ? `Signal perdu · ${fmtTime(s.time - sv.lastReport.time)}` : sv.mode === 'order' && sv.order ? `${sv.order.stage === 'return' ? 'Retour' : ORDER_LABEL[sv.order.type]}${sv.order.target && sv.order.stage !== 'return' && sv.order.type !== 'retreat' ? ' · ' + nodeName(sv.order.target) : ''}` : `${MODE_LABEL[sv.mode]} · ${nodeName(zoneOf(sv))}`;
          const cls = !sv.alive ? '' : !sv.linked ? 'lost' : ['flee', 'down', 'fight'].includes(sv.mode) ? 'danger' : '';
          return `<button class="chip ${g.selected === sv.id ? 'sel' : ''} ${sv.alive ? '' : 'dead'}" style="--c:${sv.color}" data-act="select" data-arg="${sv.id}">
            <b>${sv.short}</b>${sv.alive ? bars(survivorSignal(s, sv)) : ''}
            <span class="st ${cls}">${st}</span>
            <span class="meters"><span class="meter hp"><i style="width:${sv.health.toFixed(0)}%"></i></span><span class="meter fear"><i style="width:${sv.fear.toFixed(0)}%"></i></span><span class="meter fat"><i style="width:${sv.fatigue.toFixed(0)}%"></i></span></span>
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
          `<div class="confirm"><p><b>${sel.short} → ${ORDER_LABEL[g.orderType]}</b> · ${nodeName(g.chosen)}<small>${len} m${risk ? ` · ☣ ${risk} signalés` : ''}${unknown ? ` · ${unknown} secteur${unknown > 1 ? 's' : ''} non reconnu${unknown > 1 ? 's' : ''}` : ''}${dead ? ' · zone sans signal' : ''}</small></p>
           <button class="btn primary" data-act="confirm">Transmettre</button><button class="btn ghost" data-act="cancel">Annuler</button></div>`,
        );
      } else if (g.orderType) {
        this.set(o, `<div class="confirm"><p><b>${ORDER_LABEL[g.orderType]}</b><small>${g.targets.length ? 'Touchez une destination surlignée sur la carte.' : 'Aucune cible connue pour cet ordre.'}</small></p><button class="btn ghost" data-act="cancel">Annuler</button></div>`);
      } else {
        this.set(
          o,
          ORDERS.map((t) => {
            const dis = t === 'rescue' && validTargets(s, sel, 'rescue').length === 0;
            const on = sel.order?.type === t && sel.mode === 'order';
            return `<button class="o ${on ? 'on' : ''}" data-act="order" data-arg="${t}" ${dis ? 'disabled' : ''}>${ICON[t]}${ORDER_LABEL[t]}</button>`;
          }).join(''),
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

    // coach marks
    const c = this.el.coach;
    if (this.coachDone || this.screen !== null || s.day > 1) c.hidden = true;
    else {
      c.hidden = false;
      c.textContent = !sel ? '① Touchez un survivant (à gauche ou sur la carte)' : !g.orderType ? '② Donnez-lui un ordre' : !g.chosen ? '③ Touchez une destination surlignée' : '④ Transmettez l’ordre par radio';
    }
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
      c.strokeStyle = '#3fe0c5';
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

    if (this.screen === 'title') {
      const tier = storedTier();
      html = `<div class="sheet"><div class="title">
        <h1>LAST <span>SIGNAL</span></h1>
        <p>La ville est tombée. Vous êtes la voix d’ECHO-7 : vous ne voyez que ce que vos survivants vous rapportent, et ils ne vous obéissent que s’ils vous font confiance.</p>
        <div class="menu">
          ${this.g.hasSave() ? '<button class="btn primary" data-act="continue">Continuer</button>' : ''}
          <button class="btn ${this.g.hasSave() ? '' : 'primary'}" data-act="new">Nouvelle partie</button>
        </div>
        <div class="row" style="justify-content:center;margin-top:14px"><div class="seg">${(['auto', 'low', 'medium', 'high'] as const).map((t) => `<button class="${tier === t ? 'on' : ''}" data-act="tier" data-arg="${t}">${{ auto: 'Auto', low: 'Léger', medium: 'Moyen', high: 'Élevé' }[t]}</button>`).join('')}</div></div>
        <footer>Tranche verticale 0.2 · hors-ligne · sauvegarde locale automatique</footer>
      </div></div>`;
    } else if (this.screen === 'radio') {
      const await_ = s.awaiting !== null ? s.radio.find((m) => m.id === s.awaiting) : null;
      const m = await_ ?? this.lastMsg ?? s.radio[s.radio.length - 1];
      const sv = m ? s.survivors.find((v) => v.id === m.from) : undefined;
      const who = sv ? `<b>${sv.name}</b><small>${sv.role}</small>` : `<b>${m?.fromName ?? 'ECHO-7'}</b><small>${m?.from === 'unknown' ? 'Fréquence non identifiée' : 'Station radio'}</small>`;
      html = `<div class="sheet">${head('Transmission · canal 7', `Jour ${s.day} · ${fmtClock(m?.time ?? s.time)}`, !await_)}<div class="body">
        ${m ? `<div class="radio"><div class="who"><div class="portrait">${portrait(sv ? sv.id : m.from === 'unknown' ? 'unknown' : 'echo', sv?.color)}</div><div>${who}<div class="sigrow">${bars(m.signal)} ${Math.round(m.signal * 100)} %${m.delayed ? ' · message différé' : ''}</div></div><canvas id="wave" width="300" height="68" data-sig="${m.signal}"></canvas></div>
        <div><p class="msg mono" id="rmsg" data-id="${m.id}" data-act="skip"></p>
        ${await_ ? `<div class="choices">${await_.choices!.map((c) => `<button class="choice" data-act="choice" data-arg="${c.id}"><b>${c.label}</b><small>${c.hint}</small></button>`).join('')}</div>` : ''}</div></div>` : '<p>Aucune transmission.</p>'}
        ${!await_ ? `<h4 style="margin:14px 0 6px;font-size:10px;letter-spacing:.16em;color:var(--dim)">JOURNAL</h4><div class="log">${[...s.radio].reverse().slice(0, 40).map((r) => `<div class="${r.kind}"><time>${fmtClock(r.time)}</time><b>${r.fromName}</b>${r.delayed ? '<em>différé</em>' : ''} — ${garble(r.text, r.signal, r.id)}${r.chosen ? ` <em>→ ${esc(r.choices?.find((c) => c.id === r.chosen)?.label ?? '')}</em>` : ''}</div>`).join('')}</div>` : ''}
      </div></div>`;
    } else if (this.screen === 'roster') {
      html = `<div class="sheet">${head('Équipe', `Jour ${s.day}`)}<div class="body"><div class="cards">${s.survivors.map((sv) => this.card(sv)).join('')}</div>
        ${s.rescued.length ? `<p style="color:var(--dim);margin:10px 0 0;font-size:11.5px">À l’abri grâce à vous : ${[...new Set(s.rescued)].join(', ')}.</p>` : ''}</div></div>`;
    } else if (this.screen === 'shelter') {
      const cap = storageCap(s);
      html = `<div class="sheet">${head('ECHO-7 · abri', 'Les améliorations sont permanentes')}<div class="body">
        <div class="stockline"><span>${ICON.pill ? '' : ''}Médicaments <b>${s.resources.medicine}</b>/${cap}</span><span>Rations <b>${s.resources.supplies}</b>/${cap}</span><span>Pièces <b>${s.resources.parts}</b>/${cap}</span><span>Fusées <b>${s.resources.flares}</b></span><span style="color:var(--dim)">Chaque nuit : 1 ration par survivant, 1 dose pour l’infirmerie.</span></div>
        <div class="up">${UPGRADES.map((u) => {
          const lvl = s.shelter[u.key];
          const next = u.levels[lvl];
          const block = upgradeBlocker(s, u.key);
          const names = { supplies: 'rations', medicine: 'médic.', parts: 'pièces' } as const;
          return `<div class="upc"><h3>${u.name}<span class="pips">${u.levels.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span></h3>
            <p>${lvl === 0 ? u.base : u.levels[lvl - 1].effect}</p>
            ${next ? `<p class="next">▸ Niv. ${lvl + 1} : ${next.effect}</p>` : ''}
            <footer>${next ? `<span class="cost">${(Object.entries(next.cost) as [keyof typeof names, number][]).map(([k, v]) => `<span class="${s.resources[k] < v ? 'no' : ''}">${v} ${names[k]}</span>`).join('')}</span><button class="btn ${block ? '' : 'primary'}" data-act="buy" data-arg="${u.key}" ${block ? 'disabled' : ''}>${block && block !== 'Ressources insuffisantes' ? block : 'Améliorer'}</button>` : '<span class="cost">Niveau maximum</span>'}</footer></div>`;
        }).join('')}</div></div></div>`;
    } else if (this.screen === 'debrief' && s.debrief) {
      const d = s.debrief;
      const list = (items: string[], none: string) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<div class="none">${none}</div>`);
      const alive = s.survivors.some((v) => v.alive);
      html = `<div class="sheet debrief">${head(`Débrief · fin du jour ${d.day}`, '', false)}<div class="body">
        <span class="stamp ${d.rating}">${{ succes: 'MISSION ACCOMPLIE', mitige: 'BILAN MITIGÉ', echec: 'ÉCHEC' }[d.rating]}</span>
        <h1>${esc(d.headline)}</h1>
        <div class="cols" style="margin-top:12px">
          <div><h4>Pertes</h4>${list(d.deaths, 'Aucune.')}</div>
          <div><h4>Secourus</h4>${list(d.rescues, 'Personne.')}</div>
          <div><h4>Rapporté à l’abri</h4><ul><li>${d.gained.medicine} médicaments</li><li>${d.gained.supplies} rations</li><li>${d.gained.parts} pièces</li></ul></div>
          <div><h4>Signaux non résolus</h4>${list(d.unresolved, 'Aucun. La fréquence est silencieuse.')}</div>
          <div style="grid-column:1/-1"><h4>Conséquences</h4>${list(d.consequences, '—')}</div>
        </div></div>
        <div class="actions"><button class="btn" data-act="open" data-arg="roster">${ICON.team} Équipe</button><button class="btn" data-act="open" data-arg="shelter">${ICON.home} Abri</button><button class="btn ghost" data-act="new">Nouvelle partie</button>${alive ? '<button class="btn primary" data-act="nextday">Jour suivant</button>' : ''}</div></div>`;
    } else if (this.screen === 'settings') {
      const tier = storedTier();
      html = `<div class="sheet">${head('Réglages')}<div class="body"><div class="settings">
        <div class="row"><label>Qualité graphique<small>Recharge la page. La partie est sauvegardée.</small></label><div class="seg">${(['auto', 'low', 'medium', 'high'] as const).map((t) => `<button class="${tier === t ? 'on' : ''}" data-act="tier" data-arg="${t}">${{ auto: 'Auto', low: 'Léger', medium: 'Moyen', high: 'Élevé' }[t]}</button>`).join('')}</div></div>
        <div class="row"><label>Son radio</label><button class="btn" data-act="sound">${audio.muted ? 'Coupé' : 'Activé'}</button></div>
        <div class="row"><label>Profilage<small>FPS, draw calls, triangles, résolution dynamique.</small></label><button class="btn" data-act="perf">${this.showPerf ? 'Affiché' : 'Masqué'}</button></div>
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
    return `<div class="card ${sv.alive ? '' : 'dead'}"><div class="head"><div class="portrait">${portrait(sv.id, sv.color)}</div><div><h3>${sv.name}</h3><div class="role">${sv.role} · ${sv.alive ? MODE_LABEL[sv.mode] : sv.missing ? 'Disparu·e' : 'Mort·e'}</div></div></div>
      <div class="pills">${sv.traits.map((t) => `<span class="pill">${t}</span>`).join('')}</div>
      ${stat('Santé', sv.health, 'hp')}${stat('Stress', sv.fear, 'fear')}${stat('Fatigue', sv.fatigue, 'fat')}${stat('Courage', sv.courage, 'hp')}${stat('Confiance', sv.trust, 'hp')}
      <h4>Équipement</h4><div class="pills">${gear.map((e) => `<span class="pill">${e}</span>`).join('')}</div>
      <h4>Relations</h4><div class="pills">${rel}</div>
      <h4>Mémoire</h4>${[...sv.memory].reverse().slice(0, 4).map((m) => `<div class="mem ${m.tone < -0.15 ? 'bad' : m.tone > 0.15 ? 'good' : ''}">${m.day > 0 ? `J${m.day} · ` : ''}${esc(m.text)}</div>`).join('')}
    </div>`;
  }
}

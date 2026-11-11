// LAST SIGNAL — bootstrap and game loop.
// The simulation advances in fixed ticks; rendering only reads its state.
import './style.css';
import type { GameState, NodeId, OrderType, Shelter, SimEvent, Survivor } from './sim/types';
import { NODE, edgePoints } from './sim/world';
import { darkness, findPath, previewPath, stormLevel, survivor, survivorPos, zoneOf } from './sim/core';
import { TICK, endDay, issueOrder, nextDay, resolveChoice, step, validTargets } from './sim/sim';
import { buyUpgrade, newGame } from './sim/state';
import { clearSave, loadGame, saveGame } from './sim/save';
import { getQuality } from './render/quality';
import { Stage } from './render/scene';
import { buildCity } from './render/city';
import { Actors, type UiView } from './render/actors';
import { Ui, type GameApi } from './ui/ui';
import { audio } from './ui/audio';

function polyline(path: NodeId[] | null, start?: { x: number; z: number }): [number, number][] | null {
  if (!path || path.length < 1) return null;
  const pts: [number, number][] = start ? [[start.x, start.z]] : [];
  if (path.length === 1 && start) pts.push([NODE[path[0]].x, NODE[path[0]].z]);
  for (let i = 1; i < path.length; i++) {
    const seg = edgePoints(path[i - 1], path[i]);
    for (let k = i === 1 && !start ? 0 : 1; k < seg.length; k++) pts.push(seg[k]);
    if (i === 1 && start) pts.splice(1, 0, seg[0]);
  }
  return pts.length > 1 ? pts : null;
}

class Game implements GameApi {
  s: GameState;
  selected: string | null = null;
  orderType: OrderType | null = null;
  targets: NodeId[] = [];
  chosen: NodeId | null = null;
  route: NodeId[] | null = null;
  speed = 1;
  paused = false;
  started = false;

  private q = getQuality();
  private stage = new Stage(document.getElementById('stage') as HTMLCanvasElement, this.q);
  private city = buildCity(this.q);
  private actors: Actors;
  private ui: Ui;
  private ev: SimEvent[] = [];
  private acc = 0;
  private last = performance.now();
  private t = 0;
  private saveTimer = 0;
  private routeTimer = 0;
  private uiView: UiView = { selected: null, targets: [], chosen: null, route: null, activeRoute: null };
  private labels = document.getElementById('labels')!;

  constructor() {
    this.s = loadGame() ?? newGame();
    this.stage.scene.add(this.city.group);
    this.actors = new Actors(this.stage, this.city, this.labels, this.s);
    this.ui = new Ui(this);
    this.stage.onTap = (x, y) => this.tap(x, y);
    this.stage.focus(-20, 6, window.innerWidth < window.innerHeight ? 60 : 40);
    this.ui.open('title');
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
      this.last = performance.now();
    });
    window.addEventListener('pagehide', () => this.save());
    requestAnimationFrame((n) => this.frame(n));
  }

  // ------------------------------------------------------------ GameApi
  shown(sv: Survivor) {
    return this.actors.shownPos(sv);
  }
  view() {
    return this.stage.view;
  }

  hasSave() {
    return loadGame() !== null;
  }

  private rebuild(s: GameState) {
    this.s = s;
    this.labels.innerHTML = '';
    // Actors hold meshes per survivor: rebuild them for a fresh state.
    this.stage.scene.remove(this.actors.root);
    this.actors = new Actors(this.stage, this.city, this.labels, s);
    this.selected = null;
    this.cancelOrder();
    this.acc = 0;
  }

  private begin() {
    this.started = true;
    this.paused = false;
    audio.unlock();
    this.ui.open(this.s.phase === 'debrief' ? 'debrief' : this.s.awaiting !== null ? 'radio' : null);
    this.stage.focus(-36, 12, window.innerWidth < window.innerHeight ? 56 : 30);
  }

  newGame() {
    clearSave();
    this.rebuild(newGame());
    this.begin();
  }

  continueGame() {
    const s = loadGame();
    if (s) this.rebuild(s);
    this.begin();
  }

  select(id: string | null, focus = false) {
    if (id !== this.selected) this.cancelOrder();
    this.selected = id;
    const sv = id ? survivor(this.s, id) : null;
    if (sv && focus) {
      const p = this.actors.shownPos(sv);
      this.stage.focus(p.x, p.z);
    }
    this.routeTimer = 0;
  }

  pickOrder(t: OrderType) {
    const sv = this.selected ? survivor(this.s, this.selected) : null;
    if (!sv) return;
    if (t === 'hold' || t === 'retreat') {
      issueOrder(this.s, sv.id, t, null, this.ev);
      this.cancelOrder();
      return;
    }
    this.orderType = t;
    this.targets = validTargets(this.s, sv, t);
    this.chosen = null;
    this.route = null;
    // Frame the whole theatre so every valid destination is on screen.
    if (this.targets.length) this.stage.frame([this.actors.shownPos(sv), ...this.targets.map((n) => NODE[n])]);
  }

  confirmOrder() {
    if (!this.selected || !this.orderType || !this.chosen) return;
    issueOrder(this.s, this.selected, this.orderType, this.chosen, this.ev);
    this.cancelOrder();
    this.routeTimer = 0;
  }

  cancelOrder() {
    this.orderType = null;
    this.targets = [];
    this.chosen = null;
    this.route = null;
  }

  choose(choiceId: string) {
    resolveChoice(this.s, choiceId, this.ev);
    this.ui.open(null);
    this.save();
  }

  buy(key: keyof Shelter) {
    if (buyUpgrade(this.s, key)) {
      audio.blip();
      this.save();
    }
  }

  endDayNow() {
    endDay(this.s, this.ev);
  }

  nextDay() {
    nextDay(this.s, this.ev);
    this.cancelOrder();
    this.selected = null;
    this.save();
    if (this.s.phase === 'gameover') this.newGame();
  }

  focus(x: number, z: number) {
    this.stage.focus(x, z);
  }
  project(x: number, z: number) {
    return this.stage.project(x, 1.2, z);
  }
  togglePause() {
    this.paused = !this.paused;
  }
  cycleSpeed() {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
  }
  stats() {
    return { ...this.stage.stats(), tier: this.q.tier };
  }

  /** Debug/testing helper: advance the simulation without rendering until a decision is needed. */
  debugAdvance(seconds: number) {
    for (let i = 0; i < seconds / TICK && this.s.phase === 'running' && this.s.awaiting === null; i++) step(this.s, TICK, this.ev);
  }

  private save() {
    if (this.started) saveGame(this.s);
  }

  // ------------------------------------------------------------ input
  private tap(x: number, y: number) {
    if (!this.started || this.ui.screen !== null) return;
    audio.unlock();
    const hit = this.actors.pick(this.s, x, y, this.orderType ? this.targets : []);
    if (this.orderType && hit.node) {
      this.chosen = hit.node;
      const sv = survivor(this.s, this.selected!);
      this.route = sv ? previewPath(this.s, sv, hit.node) : null;
      return;
    }
    if (hit.survivor) {
      this.select(hit.survivor);
      return;
    }
    if (!this.orderType) this.select(null);
  }

  // ------------------------------------------------------------ loop
  private handleEvents() {
    for (const e of this.ev) {
      if (e.type === 'radio') {
        const m = this.s.radio.find((r) => r.id === e.id);
        if (m) this.ui.onRadio(m);
      } else if (e.type === 'order') {
        const sv = survivor(this.s, e.survivor);
        if (sv) this.ui.orderFeedback(sv, e.result);
      } else if (e.type === 'hit') this.actors.onHit(e.survivor);
      else if (e.type === 'noise') {
        if (this.s.intel[e.node].seenAt >= this.s.time - 3) this.actors.pulse(e.node);
      } else if (e.type === 'flare') {
        this.city.flare(NODE[e.node].x, NODE[e.node].z);
        this.actors.pulse(e.node, 0xff5a3a);
      } else if (e.type === 'phase') {
        this.save();
        if (this.s.phase === 'debrief') this.ui.open('debrief');
        else if (this.s.phase === 'running') {
          this.ui.open(this.s.awaiting !== null ? 'radio' : null);
          this.stage.focus(-36, 12);
        }
      }
    }
    this.ev.length = 0;
  }

  private frame(now: number) {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const s = this.s;

    const running = this.started && !this.paused && this.ui.screen === null && s.phase === 'running' && s.awaiting === null;
    if (running) {
      this.acc += dt * this.speed;
      let guard = 0;
      while (this.acc >= TICK && guard++ < 40) {
        step(s, TICK, this.ev);
        this.acc -= TICK;
        if (s.awaiting !== null || s.phase !== 'running') {
          this.acc = 0;
          break;
        }
      }
      this.saveTimer += dt;
      if (this.saveTimer > 10) {
        this.saveTimer = 0;
        this.save();
      }
    }
    this.handleEvents();
    if (this.started && s.awaiting !== null && this.ui.screen === null) this.ui.open('radio');

    // selected survivor's current route (what the operator can infer)
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) {
      this.routeTimer = 0.5;
      const sv = this.selected ? survivor(s, this.selected) : null;
      let active: [number, number][] | null = null;
      if (sv && sv.alive && sv.linked && sv.mode === 'order' && sv.order && sv.order.type !== 'hold') {
        const goal = sv.order.stage === 'return' || sv.order.type === 'retreat' ? 'shelter' : sv.order.target;
        if (goal) {
          const from = sv.to ?? sv.at;
          const path = findPath(s, from, goal, { safe: 1.2, sv, avoidBridge: sv.tactic === 'detour' });
          active = polyline(path, survivorPos(sv));
        }
      }
      let preview: [number, number][] | null = null;
      if (this.route && sv) {
        const p = this.actors.shownPos(sv);
        preview = polyline(this.route, zoneOf(sv) === this.route[0] && sv.to ? p : undefined) ?? null;
      }
      this.uiView = { selected: this.selected, targets: this.targets, chosen: this.chosen, route: preview, activeRoute: active };
      this.actors.setRoutes(this.uiView);
    }
    this.uiView.selected = this.selected;
    this.uiView.targets = this.targets;
    this.uiView.chosen = this.chosen;

    const dark = this.started ? darkness(s) : 0.25;
    const storm = this.started ? stormLevel(s) : 0;
    this.stage.update(dt);
    this.stage.setAtmosphere(dark, storm, this.t);
    this.city.setShelter(s.shelter);
    this.city.update(this.t, dark, storm);
    this.actors.sync(s, this.uiView, dt, this.t);
    this.stage.render();
    this.ui.frame(dt, this.t);
  }
}

const game = new Game();
(window as unknown as { game: Game }).game = game;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

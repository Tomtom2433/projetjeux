// LAST SIGNAL — bootstrap and game loop.
// The simulation advances in fixed ticks; rendering only reads its state.
import './style.css';
import type { GameState, NodeId, OrderType, Shelter, SimEvent, Survivor } from './sim/types';
import { NODE, edgePoints } from './sim/world';
import { darkness, findPath, previewPath, stormLevel, survivor, survivorPos, zoneOf } from './sim/core';
import { TICK, endDay, issueOrder, nextDay, resolveChoice, step, validTargets, queueOrder } from './sim/sim';
import { buyUpgrade, newGame } from './sim/state';
import { choosePerk } from './sim/perks';
import { clearSave, loadGame, saveGame } from './sim/save';
import { getQuality } from './render/quality';
import { Stage } from './render/scene';
import { buildCity } from './render/city';
import { Actors, type UiView } from './render/actors';
import { Ui, type GameApi } from './ui/ui';
import { audio } from './ui/audio';
import { Tutorial } from './ui/tutorial';
import { introScene, nightScene, type Scene } from './sim/scenes';
import { Cine } from './ui/cine';
import { useItem, type ItemId } from './sim/items';
import { watchErrors } from './ui/report';

watchErrors();
import { countRun, recordDay } from './ui/profile';
import { storedDifficulty, storeDifficulty } from './ui/prefs';
import { portrait } from './ui/ui';
import { coverMap } from './sim/cover';
import '@fontsource/special-elite/latin-400.css';
import '@fontsource/saira-stencil-one/latin-400.css';

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
    this.ui.open(this.s.phase === 'debrief' ? 'debrief' : this.s.phase === 'ending' ? 'ending' : this.s.awaiting !== null ? 'radio' : null);
    this.stage.focus(-36, 12, window.innerWidth < window.innerHeight ? 56 : 30);
    this.ui.tutorial.maybeStart();
  }

  /** `training`: force or skip the guided first day; by default only first-time players get it. */
  newGame(training?: boolean) {
    clearSave();
    this.rebuild(newGame(undefined, training ?? !Tutorial.seen()));
    this.s.persistent.difficulty = storedDifficulty();
    this.snapshotDay();
    countRun();
    // a first game opens on the three of them talking, before the operator ever speaks
    const intro = this.s.day === 0 ? introScene(this.s) : null;
    if (intro) {
      this.started = true;
      audio.unlock();
      this.sceneLock = true;
      this.playScene(intro, () => {
        this.sceneLock = false;
        this.begin();
      });
    } else this.begin();
  }

  /** Leave the training and go straight to day 1. */
  skipTutorial() {
    if (this.s.day !== 0) return;
    Tutorial.markSeen();
    clearSave();
    this.rebuild(newGame());
    this.s.persistent.difficulty = storedDifficulty();
    this.snapshotDay();
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

  /** Keep the current order and line this one up behind it. */
  queueOrder() {
    if (!this.selected || !this.orderType || !this.chosen) return;
    queueOrder(this.s, this.selected, this.orderType, this.chosen, this.ev);
    this.cancelOrder();
  }

  /** Tell the selected survivor to use a tactical item right now. */
  useItem(id: ItemId) {
    const sv = this.selected ? survivor(this.s, this.selected) : null;
    if (sv && useItem(this.s, sv, id, this.ev)) audio.sfx(id === 'decoy' ? 'flare' : 'order');
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

  perk(svId: string, perkId: string) {
    const sv = survivor(this.s, svId);
    if (sv && choosePerk(sv, perkId)) {
      audio.blip();
      this.save();
    }
  }

  endDayNow() {
    endDay(this.s, this.ev);
  }

  nextDay() {
    // what they say to each other that night depends on the day that just ended
    const night = nightScene(this.s);
    nextDay(this.s, this.ev);
    this.cancelOrder();
    this.selected = null;
    this.save();
    if (this.s.phase === 'gameover') return this.newGame();
    if (this.s.phase === 'running') this.snapshotDay();
    if (night && this.s.phase === 'running') {
      this.sceneLock = true;
      this.playScene(night, () => {
        this.sceneLock = false;
        this.ui.open(this.s.awaiting !== null ? 'radio' : null);
        this.ui.tutorial.maybeStart();
      });
    }
  }
  private sceneLock = false;

  /** Keep the state as it was when the day began, so a lost day can be played again. */
  private snapshotDay() {
    try {
      localStorage.setItem('last-signal.daystart', JSON.stringify(this.s));
    } catch {
      /* storage full or unavailable: no retry, the game still runs */
    }
  }
  canRetryDay(): boolean {
    try {
      const raw = localStorage.getItem('last-signal.daystart');
      return !!raw && Number(this.s.persistent.difficulty ?? 1) < 2 && (JSON.parse(raw) as GameState).day === this.s.day;
    } catch {
      return false;
    }
  }
  /** Same day, same situation, different dice. */
  retryDay() {
    if (!this.canRetryDay()) return;
    const s = JSON.parse(localStorage.getItem('last-signal.daystart')!) as GameState;
    s.rng = ((Date.now() & 0x7fffffff) || 1) | 0;
    s.persistent.retries = Number(s.persistent.retries ?? 0) + 1;
    this.rebuild(s);
    this.snapshotDay();
    this.begin();
  }
  setDifficulty(d: number) {
    storeDifficulty(d);
    if (this.started) this.s.persistent.difficulty = d;
  }
  private cine = new Cine(this.stage, () => this.actors, () => this.s, portrait);

  /** Play a dialogue scene in the yard, then hand the game back. */
  private playScene(scene: Scene, done: () => void) {
    this.cancelOrder();
    this.selected = null;
    this.ui.open('scene');
    this.cine.play(scene, () => {
      this.ui.open(null);
      this.stage.focus(-36, 12, window.innerWidth < window.innerHeight ? 56 : 30);
      done();
    });
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
        audio.sfx(e.result === 'refused' ? 'refuse' : 'order');
      } else if (e.type === 'sync') {
        this.ui.onSync(e.value, e.found);
        audio.sfx('sync');
      } else if (e.type === 'hit') {
        this.actors.onHit(e.survivor);
        audio.sfx('hit');
        if (e.survivor === this.selected) this.stage.shake(0.5);
      }
      else if (e.type === 'noise') {
        if (this.s.intel[e.node].seenAt >= this.s.time - 3) {
          this.actors.pulse(e.node);
          audio.sfx('growl');
        }
      } else if (e.type === 'flare') {
        this.city.flare(NODE[e.node].x, NODE[e.node].z);
        audio.sfx('flare');
        this.actors.pulse(e.node, 0xff5a3a);
      } else if (e.type === 'phase') {
        this.save();
        if (this.s.phase === 'debrief') {
          for (const name of recordDay(this.s, false)) this.ui.toast(`<b>Succès</b> ${name}`, 'ok');
          this.ui.open('debrief');
          audio.sfx(this.s.survivors.some((v) => v.alive) ? 'dayend' : 'down');
        }
        else if (this.s.phase === 'ending') {
          for (const name of recordDay(this.s, true)) this.ui.toast(`<b>Succès</b> ${name}`, 'ok');
          this.ui.open('ending');
        }
        else if (this.s.phase === 'running' && !this.sceneLock) {
          this.ui.open(this.s.awaiting !== null ? 'radio' : null);
          if (this.s.day > 0) Tutorial.markSeen();
          this.ui.tutorial.maybeStart();
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

    const running = this.started && !this.paused && !this.ui.tutorial.holding && this.ui.screen === null && s.phase === 'running' && s.awaiting === null;
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
      this.actors.setCover(this.started ? coverMap(s) : []);
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
      this.uiView = { selected: this.selected, targets: this.targets, chosen: this.chosen, route: preview, activeRoute: active, orderType: this.orderType, activeType: sv?.order ? (sv.order.stage === 'return' ? 'retreat' : sv.order.type) : null };
      this.actors.setRoutes(this.uiView);
    }
    this.uiView.selected = this.selected;
    this.uiView.targets = this.targets;
    this.uiView.chosen = this.chosen;
    this.uiView.orderType = this.orderType;

    const mood = this.cine.mood();
    const dark = mood ? mood.dark : this.started ? darkness(s) : 0.25;
    const storm = mood ? mood.storm : this.started ? stormLevel(s) : 0;
    this.stage.update(dt);
    this.stage.setAtmosphere(dark, storm, this.t);
    this.city.setShelter(s.shelter);
    this.city.setBusFire(!!s.flags['blk_bridge_mid|bridge_w']);
    this.city.update(this.t, dark, storm);
    this.actors.sync(s, this.uiView, dt, this.t);
    this.stage.render();
    this.ui.frame(dt, this.t);
    this.cine.frame(dt);
    const trouble = this.started && s.phase === 'running' ? Math.max(0, ...s.survivors.map((v) => (!v.alive ? 0 : v.mode === 'down' || v.mode === 'fight' ? 1 : v.mode === 'flee' ? 0.8 : v.mode === 'hide' ? 0.5 : 0))) : 0;
    const v = this.stage.view;
    const nearFire = Math.max(0, 1 - Math.hypot(v.x - -41, v.z - 21.5) / 14) * Math.max(0, 1 - v.zoom / 30);
    audio.scene({ storm, dark, danger: trouble, fire: this.started ? nearFire : 0, menu: this.ui.screen !== null && this.ui.screen !== 'scene' }, dt);
    if (mood) document.getElementById('rain')!.style.opacity = String(mood.storm * 0.9);
  }
}

const game = new Game();
(window as unknown as { game: Game }).game = game;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

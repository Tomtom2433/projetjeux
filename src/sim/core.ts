// Shared simulation helpers: RNG, radio, memory, perception, pathfinding.
import type { GameState, NodeId, RadioMessage, SimEvent, Stock, Survivor, Threat } from './types';
import { NODE, NODES, edgeExposure, edgeLength, neighbors, pointOnEdge } from './world';

export const LINK_THRESHOLD = 0.3;

export const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Deterministic RNG (mulberry32) whose state lives in the save file. */
/** Difficulty chosen for the run: 0 calm, 1 normal, 2 hard. Scales how easily survivors are spotted and hurt. */
export const DIFFICULTY = [
  { name: 'Calme', detect: 0.75, damage: 0.65, note: 'Les infectés repèrent moins vite et frappent moins fort.' },
  { name: 'Normal', detect: 1, damage: 1, note: 'L’expérience prévue.' },
  { name: 'Dur', detect: 1.2, damage: 1.35, note: 'Repérés plus vite, blessés plus fort, et pas de seconde chance.' },
] as const;
export const difficulty = (s: GameState) => DIFFICULTY[Math.min(2, Math.max(0, Number(s.persistent.difficulty ?? 1)))];

export function rnd(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(s: GameState, arr: T[]): T {
  return arr[Math.floor(rnd(s) * arr.length) % arr.length];
}

export const emptyStock = (): Stock => ({ supplies: 0, medicine: 0, parts: 0 });
export const stockTotal = (k: Stock) => k.supplies + k.medicine + k.parts;

export function survivor(s: GameState, id: string): Survivor | undefined {
  return s.survivors.find((v) => v.id === id);
}

// ---------------------------------------------------------------- environment

/** 0 at dusk, 1 at full night. Drives fear, detection and the renderer's lighting. */
export function darkness(s: GameState): number {
  const t = clamp01((s.time / s.duration - 0.35) / 0.65);
  return t * t * (3 - 2 * t);
}

export function stormLevel(s: GameState): number {
  const { start, end } = s.storm;
  if (s.time < start || s.time > end) return 0;
  return Math.min(1, (s.time - start) / 15, (end - s.time) / 15);
}

export function signalAt(s: GameState, node: NodeId): number {
  const burst = s.time < ((s.flags.burstUntil as number) ?? -1) ? 0.25 : 0;
  return clamp01(NODE[node].signal + s.shelter.antenna * 0.12 - stormLevel(s) * 0.3 - burst);
}

export function survivorSignal(s: GameState, sv: Survivor): number {
  const a = signalAt(s, sv.at);
  if (!sv.to) return a;
  return a + (signalAt(s, sv.to) - a) * sv.progress;
}

// ---------------------------------------------------------------- positions

export function survivorPos(sv: Survivor): { x: number; z: number; heading: number } {
  if (sv.to) return pointOnEdge(sv.at, sv.to, sv.progress);
  return { x: NODE[sv.at].x, z: NODE[sv.at].z, heading: 0 };
}

export function threatPos(th: Threat): { x: number; z: number; heading: number } {
  if (th.to) return pointOnEdge(th.at, th.to, th.progress);
  return { x: NODE[th.at].x, z: NODE[th.at].z, heading: 0 };
}

/** The node an entity currently "occupies" for encounters and perception. */
export function zoneOf(e: { at: NodeId; to: NodeId | null; progress: number }): NodeId {
  return e.to && e.progress > 0.5 ? e.to : e.at;
}

export function threatAtNode(s: GameState, node: NodeId): number {
  let n = 0;
  for (const th of s.threats) if (zoneOf(th) === node) n += th.size;
  return n;
}

// ---------------------------------------------------------------- radio & memory

export function pushRadio(
  s: GameState,
  ev: SimEvent[],
  msg: Omit<RadioMessage, 'id' | 'time' | 'signal'> & { signal?: number; time?: number },
): RadioMessage {
  const full: RadioMessage = {
    id: s.nextRadioId++,
    time: msg.time ?? s.time,
    signal: msg.signal ?? 1,
    ...msg,
  } as RadioMessage;
  s.radio.push(full);
  if (s.radio.length > 80) s.radio.splice(0, s.radio.length - 80);
  ev.push({ type: 'radio', id: full.id });
  return full;
}

/** A survivor speaks. If the link is down the words wait in the outbox. */
export function say(s: GameState, ev: SimEvent[], sv: Survivor, text: string, kind: RadioMessage['kind'] = 'report', art?: string) {
  if (!sv.linked) {
    sv.outbox.push({ time: s.time, text });
    if (sv.outbox.length > 6) sv.outbox.shift();
    return;
  }
  pushRadio(s, ev, { from: sv.id, fromName: sv.short, text, kind, signal: survivorSignal(s, sv), art });
}

export function systemMsg(s: GameState, ev: SimEvent[], text: string, kind: RadioMessage['kind'] = 'system', art?: string) {
  pushRadio(s, ev, { from: 'echo', fromName: 'ECHO-7', text, kind, signal: 1, art });
}

export function remember(s: GameState, sv: Survivor, text: string, tone: number, kind?: string, node?: NodeId) {
  sv.memory.push({ day: s.day, time: s.time, text, tone, kind, node });
  if (sv.memory.length > 12) sv.memory.shift();
}

export function shiftTrust(sv: Survivor, d: number) {
  sv.trust = clamp(sv.trust + d);
}

export function noise(s: GameState, ev: SimEvent[], node: NodeId, power: number) {
  ev.push({ type: 'noise', node, power });
  for (const th of s.threats) {
    if (th.state === 'hunt') continue;
    const d = hopsCached(zoneOf(th), node);
    if (d > 2) continue;
    const chance = power * (d === 0 ? 1 : d === 1 ? 0.6 : 0.25);
    if (rnd(s) < chance) {
      th.state = 'lured';
      th.goal = node;
      th.timer = 30 + rnd(s) * 20;
    }
  }
}

// ---------------------------------------------------------------- knowledge

/** What this survivor believes about a node (own eyes or shared intel, whichever is fresher). */
export function believedThreat(s: GameState, sv: Survivor, node: NodeId): number {
  const own = sv.obs[node];
  const shared = s.intel[node];
  let t = -1e9;
  let threat = 0;
  if (own) {
    t = own.t;
    threat = own.threat;
  }
  if (sv.linked && shared && shared.seenAt > t && shared.seenAt !== -1) {
    t = shared.seenAt;
    threat = shared.threat;
  }
  if (t === -1e9) return 0;
  const age = s.time - t;
  return age > 240 ? threat * 0.5 : threat;
}

/** Nodes the survivor can see from where they stand. */
export function visibleNodes(sv: Survivor, deep = false): NodeId[] {
  const here = zoneOf(sv);
  const out = new Set<NodeId>([here]);
  if (sv.to) out.add(sv.at).add(sv.to);
  if (NODE[here].kind !== 'interior') {
    for (const n of neighbors(here)) {
      if (NODE[n].kind === 'interior') continue;
      out.add(n);
      if (deep) for (const m of neighbors(n)) if (NODE[m].kind !== 'interior') out.add(m);
    }
  }
  return [...out];
}

export function perceive(s: GameState, sv: Survivor, deep = false) {
  const here = zoneOf(sv);
  for (const node of visibleNodes(sv, deep)) {
    const threat = threatAtNode(s, node);
    sv.obs[node] = { t: s.time, threat };
    if (sv.linked) {
      const it = s.intel[node];
      it.seenAt = s.time;
      it.threat = threat;
      if (node === here && !sv.to) it.lootKnown = true;
      for (const th of s.threats) if (zoneOf(th) === node) th.seen = true;
    }
  }
}

/** Push private observations into shared intel, keeping their original (stale) timestamps. */
export function syncObservations(s: GameState, sv: Survivor) {
  for (const [node, o] of Object.entries(sv.obs)) {
    const it = s.intel[node];
    if (o.t > it.seenAt) {
      it.seenAt = o.t;
      it.threat = o.threat;
    }
  }
}

// ---------------------------------------------------------------- pathfinding

const hopCache = new Map<string, number>();
export function hopsCached(a: NodeId, b: NodeId): number {
  const key = a + '>' + b;
  let v = hopCache.get(key);
  if (v === undefined) {
    v = bfs(a, b);
    hopCache.set(key, v);
  }
  return v;
}

function bfs(from: NodeId, to: NodeId): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: NodeId[] = [];
    for (const n of frontier)
      for (const m of neighbors(n)) {
        if (m === to) return d;
        if (!seen.has(m)) {
          seen.add(m);
          next.push(m);
        }
      }
    frontier = next;
  }
  return 99;
}

export interface PathOpts {
  /** Caution: 0 = shortest, higher = avoids exposure and believed threats. */
  safe?: number;
  sv?: Survivor;
  avoidBridge?: boolean;
}

/** Dijkstra over the street graph. Returns the node list including both ends, or null. */
export function findPath(s: GameState, from: NodeId, to: NodeId, opts: PathOpts = {}): NodeId[] | null {
  if (from === to) return [from];
  const safe = opts.safe ?? 1;
  const dist = new Map<NodeId, number>([[from, 0]]);
  const prev = new Map<NodeId, NodeId>();
  const open = new Set<NodeId>([from]);
  const done = new Set<NodeId>();
  while (open.size) {
    let cur: NodeId | null = null;
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n)!;
      if (d < best) {
        best = d;
        cur = n;
      }
    }
    if (cur === null) break;
    if (cur === to) break;
    open.delete(cur);
    done.add(cur);
    for (const nb of neighbors(cur)) {
      if (done.has(nb) || s.flags['blk_' + [cur, nb].sort().join('|')]) continue;
      let cost = edgeLength(cur, nb) * (1 + edgeExposure(cur, nb) * safe * 0.4);
      const believed = opts.sv ? believedThreat(s, opts.sv, nb) : s.intel[nb].seenAt !== -1 ? s.intel[nb].threat : 0;
      cost += believed * safe * 22;
      if (opts.avoidBridge && nb === 'bridge_mid') cost += 2000;
      const nd = best + cost;
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, cur);
        open.add(nb);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  let c = to;
  while (c !== from) {
    c = prev.get(c)!;
    path.unshift(c);
  }
  return path;
}

export function pathLength(path: NodeId[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += edgeLength(path[i - 1], path[i]);
  return l;
}

/** Route the operator sees when previewing an order (uses shared intel only). */
export function previewPath(s: GameState, sv: Survivor, target: NodeId): NodeId[] | null {
  const from = sv.linked ? zoneOf(sv) : sv.lastReport.node;
  return findPath(s, from, target, { safe: 1.2 });
}

export const ALL_NODE_IDS = NODES.map((n) => n.id);

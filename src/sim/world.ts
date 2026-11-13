// Static map of the vertical slice: one city block split by a canal.
// Shared by the simulation (graph) and the renderer (layout).
import type { EdgeDef, NodeDef, NodeId } from './types';

export const BOUNDS = { minX: -72, maxX: 72, minZ: -52, maxZ: 52 };
export const CANAL = { x0: -1, x1: 9 };

export const NODES: NodeDef[] = [
  { id: 'shelter', name: 'ECHO-7', x: -44, z: 20, kind: 'shelter', cover: 0.9, signal: 1 },
  { id: 'gate', name: 'Avenue ouest', x: -44, z: 0, kind: 'street', cover: 0.4, signal: 0.9 },
  { id: 'cross_w', name: 'Carrefour du quai', x: -18, z: 0, kind: 'street', cover: 0.35, signal: 0.8 },
  { id: 'quay_n', name: 'Quai nord', x: -18, z: -36, kind: 'street', cover: 0.45, signal: 0.6 },
  { id: 'quay_s', name: 'Quai sud', x: -18, z: 34, kind: 'street', cover: 0.5, signal: 0.7 },
  { id: 'apts', name: 'Immeuble des Tanneurs', x: -38, z: -22, kind: 'interior', cover: 0.8, signal: 0.52 },
  { id: 'bridge_w', name: 'Pont — rive ouest', x: -8, z: 0, kind: 'bridge', cover: 0.4, signal: 0.7 },
  { id: 'bridge_mid', name: 'Pont — bus accidenté', x: 4, z: 0, kind: 'bridge', cover: 0.6, signal: 0.62 },
  { id: 'bridge_e', name: 'Checkpoint', x: 16, z: 0, kind: 'bridge', cover: 0.5, signal: 0.55 },
  { id: 'cross_e', name: 'Carrefour est', x: 34, z: 0, kind: 'street', cover: 0.35, signal: 0.48 },
  { id: 'lock_e', name: 'Écluse', x: 14, z: -36, kind: 'street', cover: 0.25, signal: 0.2 },
  { id: 'east_n', name: 'Rue Saint-Roch nord', x: 34, z: -36, kind: 'street', cover: 0.4, signal: 0.36 },
  { id: 'parvis', name: "Parvis de l'hôpital", x: 34, z: -18, kind: 'street', cover: 0.45, signal: 0.42 },
  { id: 'hosp_in', name: 'Hôpital Saint-Roch', x: 52, z: -20, kind: 'interior', cover: 0.75, signal: 0.26 },
  { id: 'east_s', name: 'Entrepôts sud', x: 34, z: 34, kind: 'street', cover: 0.4, signal: 0.4 },
  { id: 'garage', name: 'Garage Lorentz', x: 50, z: 30, kind: 'interior', cover: 0.7, signal: 0.27 },
];

export const EDGES: EdgeDef[] = [
  { a: 'shelter', b: 'gate', exposure: 0.1 },
  { a: 'gate', b: 'cross_w', exposure: 0.4 },
  { a: 'cross_w', b: 'quay_n', exposure: 0.5 },
  { a: 'cross_w', b: 'quay_s', exposure: 0.5 },
  { a: 'cross_w', b: 'apts', exposure: 0.3, via: [[-18, -22]] },
  { a: 'cross_w', b: 'bridge_w', exposure: 0.5 },
  { a: 'bridge_w', b: 'bridge_mid', exposure: 0.8 },
  { a: 'bridge_mid', b: 'bridge_e', exposure: 0.8 },
  { a: 'bridge_e', b: 'cross_e', exposure: 0.6 },
  { a: 'quay_n', b: 'lock_e', exposure: 0.9 },
  { a: 'lock_e', b: 'east_n', exposure: 0.7 },
  { a: 'east_n', b: 'parvis', exposure: 0.5 },
  { a: 'cross_e', b: 'parvis', exposure: 0.5 },
  { a: 'parvis', b: 'hosp_in', exposure: 0.3, via: [[44, -18]] },
  { a: 'cross_e', b: 'east_s', exposure: 0.5 },
  { a: 'east_s', b: 'garage', exposure: 0.3, via: [[42, 34]] },
];

export const NODE: Record<NodeId, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));

interface EdgeInfo {
  def: EdgeDef;
  /** Polyline from a to b. */
  pts: [number, number][];
  /** Cumulative length at each point. */
  cum: number[];
  length: number;
}

const edgeMap = new Map<string, EdgeInfo>();
const adj = new Map<NodeId, NodeId[]>();

for (const def of EDGES) {
  const a = NODE[def.a];
  const b = NODE[def.b];
  const pts: [number, number][] = [[a.x, a.z], ...(def.via ?? []), [b.x, b.z]];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  edgeMap.set(def.a + '|' + def.b, { def, pts, cum, length: cum[cum.length - 1] });
  if (!adj.has(def.a)) adj.set(def.a, []);
  if (!adj.has(def.b)) adj.set(def.b, []);
  adj.get(def.a)!.push(def.b);
  adj.get(def.b)!.push(def.a);
}

export function neighbors(id: NodeId): NodeId[] {
  return adj.get(id) ?? [];
}

function edgeInfo(a: NodeId, b: NodeId): { info: EdgeInfo; reversed: boolean } {
  const fwd = edgeMap.get(a + '|' + b);
  if (fwd) return { info: fwd, reversed: false };
  const back = edgeMap.get(b + '|' + a);
  if (back) return { info: back, reversed: true };
  throw new Error(`No edge ${a} - ${b}`);
}

export function edgeLength(a: NodeId, b: NodeId): number {
  return edgeInfo(a, b).info.length;
}

export function edgeExposure(a: NodeId, b: NodeId): number {
  return edgeInfo(a, b).info.def.exposure;
}

/** Polyline from a to b, in travel order. */
export function edgePoints(a: NodeId, b: NodeId): [number, number][] {
  const { info, reversed } = edgeInfo(a, b);
  return reversed ? [...info.pts].reverse() : info.pts;
}

/** Position at fraction t (0..1) of the way from a to b. */
export function pointOnEdge(a: NodeId, b: NodeId, t: number): { x: number; z: number; heading: number } {
  const { info, reversed } = edgeInfo(a, b);
  const d = (reversed ? 1 - t : t) * info.length;
  let i = 1;
  while (i < info.cum.length - 1 && info.cum[i] < d) i++;
  const p0 = info.pts[i - 1];
  const p1 = info.pts[i];
  const seg = info.cum[i] - info.cum[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (d - info.cum[i - 1]) / seg));
  const dx = (p1[0] - p0[0]) * (reversed ? -1 : 1);
  const dz = (p1[1] - p0[1]) * (reversed ? -1 : 1);
  return { x: p0[0] + (p1[0] - p0[0]) * f, z: p0[1] + (p1[1] - p0[1]) * f, heading: Math.atan2(dx, dz) };
}

/** Number of edges between two nodes (BFS). */
export function hops(from: NodeId, to: NodeId): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: NodeId[] = [];
    for (const n of frontier) {
      for (const m of neighbors(n)) {
        if (m === to) return d;
        if (!seen.has(m)) {
          seen.add(m);
          next.push(m);
        }
      }
    }
    frontier = next;
  }
  return 99;
}

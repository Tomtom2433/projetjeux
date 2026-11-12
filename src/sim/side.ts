// Optional objectives drawn each morning, and the help the operator can give by hand (mini-games).
import type { GameState, SimEvent, Survivor } from './types';
import { stockTotal, survivor, zoneOf } from './core';
import { neighbors } from './world';
import { gainXp } from './perks';

interface SideDef {
  label: string;
  /** Live reading: done so far, and whether it can no longer be met. */
  read: (s: GameState) => { done: boolean; failed: boolean };
}

const out = (s: GameState) => s.survivors.filter((v) => v.alive && zoneOf(v) !== 'shelter').length;
export const SIDES: Record<string, SideDef> = {
  unseen: { label: 'Personne n’est repéré', read: (s) => ({ done: !s.flags.spottedToday, failed: !!s.flags.spottedToday }) },
  unhurt: { label: 'Personne ne tombe', read: (s) => ({ done: !s.flags.downToday, failed: !!s.flags.downToday }) },
  early: { label: 'Tous rentrés une minute avant la nuit', read: (s) => ({ done: s.time > 30 && s.time <= s.duration - 60 && out(s) === 0, failed: s.time > s.duration - 60 && out(s) > 0 }) },
  haul: { label: 'Rapporter 4 ressources', read: (s) => ({ done: stockTotal(s.delivered) >= 4, failed: false }) },
  sync: { label: 'Atteindre la Synchro ×3', read: (s) => ({ done: Number(s.flags.syncBest ?? 0) >= 3, failed: false }) },
};

/** Two optional objectives for the day. */
export function drawSides(s: GameState) {
  // drawn from the seed and the day, without touching the run's dice
  let h = (Math.imul(s.seed | 0, 31) + s.day * 7919) >>> 0;
  const next = (n: number) => {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 3266489917) >>> 0;
    return h % n;
  };
  const ids = Object.keys(SIDES);
  const a = ids.splice(next(ids.length), 1)[0];
  const b = ids.splice(next(ids.length), 1)[0];
  s.flags.side = a + ',' + b;
}

export function sideStatus(s: GameState): { id: string; label: string; done: boolean; failed: boolean }[] {
  return String(s.flags.side ?? '')
    .split(',')
    .filter((id) => SIDES[id])
    .map((id) => ({ id, label: SIDES[id].label, ...SIDES[id].read(s) }));
}

/** At nightfall: every optional objective met gives the whole team experience and a ration. */
export function settleSides(s: GameState): string[] {
  const notes: string[] = [];
  for (const side of sideStatus(s)) {
    if (!side.done || side.failed) continue;
    for (const sv of s.survivors) if (sv.alive) gainXp(s, sv, 12);
    s.resources.supplies += 1;
    notes.push(`Objectif secondaire atteint : ${side.label.toLowerCase()}. +12 XP pour chacun, +1 ration.`);
  }
  s.persistent.sidesDone = Number(s.persistent.sidesDone ?? 0) + notes.length;
  return notes;
}

export type AssistKind = 'scout' | 'retrieve' | 'rescue';
/** What the operator can help with right now for this survivor, if anything. */
export function assistable(s: GameState, sv: Survivor): AssistKind | null {
  if (!sv.alive || !sv.linked || sv.mode !== 'order' || !sv.order) return null;
  const o = sv.order;
  const key = `assist_${sv.id}_${o.type}_${o.target ?? ''}_${Math.floor(o.issuedAt)}`;
  if (s.flags[key]) return null;
  // on the way there or already at it: the help is banked and used when the work starts
  if ((o.type === 'scout' || o.type === 'retrieve') && (o.stage === 'go' || (o.stage === 'work' && sv.work > 1))) return o.type;
  if (o.type === 'rescue' && o.stage === 'go' && s.survivors.some((v) => v.alive && v.mode === 'down' && zoneOf(v) === o.target)) return 'rescue';
  return null;
}

/** Apply the result of a mini-game, `score` from 0 (missed everything) to 1 (perfect). */
export function assist(s: GameState, svId: string, kind: AssistKind, score: number, ev: SimEvent[]) {
  const sv = survivor(s, svId);
  if (!sv || !sv.order) return;
  const o = sv.order;
  s.flags[`assist_${sv.id}_${o.type}_${o.target ?? ''}_${Math.floor(o.issuedAt)}`] = true;
  const q = Math.min(1, Math.max(0, score));
  if (q <= 0) return;
  if (o.stage === 'go' && kind !== 'rescue') s.flags['prep_' + sv.id] = q;
  if (kind === 'scout') {
    if (o.stage === 'work') sv.work = Math.max(0.2, sv.work - 4 * q);
    // a sharp look also reads the streets next door
    if (q >= 0.6) for (const n of [zoneOf(sv), ...neighbors(zoneOf(sv))]) s.intel[n].lootKnown = true;
  } else if (kind === 'retrieve') {
    if (o.stage === 'work') sv.work = Math.max(0.2, sv.work - 6 * q);
    if (q >= 0.99) s.flags['bonus_' + sv.id] = true;
  } else s.flags['steady_' + sv.id] = q;
  gainXp(s, sv, Math.round(6 * q));
  ev.push({ type: 'order', survivor: sv.id, result: 'ack' });
}

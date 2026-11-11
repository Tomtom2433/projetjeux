// Cover and Synchro: the tactical heart of a sortie.
//
// A survivor who stands still on watch (holding a position, or observing at the end of a scout order)
// covers that node and the streets around it. Teammates acting inside covered ground are harder to
// spot, keep their nerve, and get warned out loud when a pack walks in. Every action completed under
// cover raises the team's Synchro; it pays out in experience and, every third point, in a lucky find.
// The moment anyone is spotted, the chain breaks. Moving one person while another watches
// ("bounding overwatch") is therefore always better than sending everyone at once.
import type { GameState, NodeId, SimEvent, Survivor } from './types';
import { NODE, neighbors } from './world';
import { rnd, say, zoneOf } from './core';
import { aptitude } from './perks';

/** Is this survivor currently on watch? */
export function watching(sv: Survivor): boolean {
  if (!sv.alive || sv.to || sv.mode !== 'order' || !sv.order) return false;
  return sv.order.type === 'hold' || (sv.order.type === 'scout' && sv.order.stage === 'work');
}

/** Nodes a watcher covers: their own, the adjacent streets, and one street further for a trained scout. */
export function coveredBy(sv: Survivor): NodeId[] {
  if (!watching(sv) || NODE[sv.at].kind === 'interior' || sv.at === 'shelter') return [];
  const out = new Set<NodeId>([sv.at]);
  const far = aptitude(sv, 'scout') >= 4;
  for (const n of neighbors(sv.at)) {
    if (NODE[n].kind === 'interior' || n === 'shelter') continue;
    out.add(n);
    if (far) for (const m of neighbors(n)) if (NODE[m].kind !== 'interior' && m !== 'shelter') out.add(m);
  }
  return [...out];
}

/** Who, if anyone, is covering this survivor right now (never themselves). */
export function coverer(s: GameState, sv: Survivor): Survivor | null {
  const here = zoneOf(sv);
  for (const o of s.survivors) if (o !== sv && coveredBy(o).includes(here)) return o;
  return null;
}

/** Every covered node with the id of its watcher, for the map. */
export function coverMap(s: GameState): { watcher: string; from: NodeId; nodes: NodeId[] }[] {
  const out: { watcher: string; from: NodeId; nodes: NodeId[] }[] = [];
  for (const o of s.survivors) {
    const nodes = coveredBy(o);
    if (nodes.length) out.push({ watcher: o.id, from: o.at, nodes });
  }
  return out;
}

export const synchro = (s: GameState) => (s.flags.sync as number) ?? 0;

/** XP multiplier earned by the current chain. */
export const synchroBonus = (s: GameState) => 1 + Math.min(10, synchro(s)) * 0.1;

/** Something was done under cover: the chain grows, and every third link pays out. */
export function creditSynchro(s: GameState, sv: Survivor, what: string, ev: SimEvent[]) {
  const by = coverer(s, sv);
  if (!by) return;
  const key = `syncd_${sv.id}_${what}`;
  if (s.flags[key]) return; // each distinct action counts once a day
  s.flags[key] = true;
  const v = synchro(s) + 1;
  s.flags.sync = v;
  s.flags.syncBest = Math.max((s.flags.syncBest as number) ?? 0, v);
  s.persistent.syncRecord = Math.max((s.persistent.syncRecord as number) ?? 0, v);
  by.relations[sv.id] = Math.min(100, (by.relations[sv.id] ?? 50) + 1);
  sv.relations[by.id] = Math.min(100, (sv.relations[by.id] ?? 50) + 1);
  let found: string | null = null;
  if (v % 3 === 0) {
    const roll = rnd(s);
    const res = roll < 0.25 ? 'medicine' : roll < 0.55 ? 'parts' : 'supplies';
    sv.carrying[res]++;
    found = res === 'medicine' ? 'une dose de médicaments' : res === 'parts' ? 'une pièce' : 'une ration';
    say(s, ev, sv, sv.id === 'jo' ? `Tant que ${by.short} regarde, je prends mon temps. Trouvé ${found} de plus.` : `${by.short} me couvre : j’ai pu fouiller tranquille. ${found[0].toUpperCase() + found.slice(1)} de plus.`);
  }
  ev.push({ type: 'sync', value: v, survivor: sv.id, by: by.id, found });
}

/** The chain breaks when someone is spotted. */
export function breakSynchro(s: GameState, ev: SimEvent[]) {
  if (synchro(s) > 0) {
    s.flags.sync = 0;
    ev.push({ type: 'sync', value: 0, survivor: '', by: '', found: null });
  }
}

/** A watcher calls out a pack walking into ground where a teammate stands. */
export function coverCallouts(s: GameState, ev: SimEvent[]) {
  for (const w of s.survivors) {
    const nodes = coveredBy(w);
    if (!nodes.length || !w.linked) continue;
    for (const th of s.threats) {
      const z = zoneOf(th);
      if (!nodes.includes(z) || th.state === 'dormant') continue;
      const ally = s.survivors.find((o) => o !== w && o.alive && o.mode !== 'down' && zoneOf(o) === z);
      if (!ally) continue;
      const key = `call_${w.id}_${th.id}_${z}`;
      if (s.flags[key]) continue;
      s.flags[key] = true;
      const lines: Record<string, string> = {
        lena: `${ally.short}, ne bouge plus ! J’en vois ${th.size} qui arrivent sur toi, côté ${NODE[z].name}.`,
        mara: `${ally.short}, à couvert, tout de suite. ${th.size} silhouettes à ${NODE[z].name}. Je te garde à l’œil.`,
        jo: `${ally.short} ! ${th.size} sur ${NODE[z].name}. Planque-toi, je te dis quand ça passe.`,
      };
      say(s, ev, w, lines[w.id] ?? lines.mara, 'alert');
      // warned in time: the ally freezes instead of walking into them
      if (!ally.to && ally.mode === 'order' && ally.order?.stage !== 'work') {
        ally.mode = 'hide';
        ally.modeSince = s.time;
        ally.safeFor = 0;
      }
      ally.fear = Math.max(0, ally.fear - 6);
    }
  }
}

// Things worth carrying home: each one is somewhere in the district, shows up when someone looks,
// comes back on a survivor's shoulders, and changes what ECHO-7 can do from that night on.
import type { GameState, NodeId, Shelter, SimEvent, Survivor } from './types';
import { say, systemMsg } from './core';
import { neighbors } from './world';
import { nodeName } from './text';
import { gainXp } from './perks';

export interface Find {
  id: string;
  name: string;
  /** Where it lies. */
  at: NodeId;
  /** What the scout says on spotting it. */
  seen: string;
  /** What it does once installed. */
  effect: string;
  /** Upgrade level it makes possible, if any. */
  unlocks?: { key: keyof Shelter; level: number };
}

export const FINDS: Find[] = [
  { id: 'tarp', name: 'Bâche et piquets', at: 'apts', seen: 'Une grande bâche de chantier et des piquets, au sec dans une cage d’escalier.', effect: 'Monte la tente d’infirmerie : +6 santé par nuit pour tous.' },
  { id: 'genset', name: 'Groupe électrogène', at: 'quay_s', seen: 'Un groupe électrogène dans la camionnette. Lourd, mais entier.', effect: 'Donne du courant à l’abri. Indispensable pour améliorer le générateur.', unlocks: { key: 'generator', level: 1 } },
  { id: 'water', name: 'Citerne d’eau', at: 'lock_e', seen: 'Une citerne de mille litres sur une remorque, près de l’écluse. Encore à moitié pleine.', effect: 'De l’eau propre : chacun démarre la journée moins fatigué et récupère +4 santé par nuit.' },
  { id: 'stove', name: 'Poêle à bois', at: 'quay_n', seen: 'Un petit poêle en fonte dans une guérite du quai. Le tuyau y est.', effect: 'On dort au chaud : le stress retombe bien plus la nuit.' },
  { id: 'shelves', name: 'Rayonnages métalliques', at: 'east_s', seen: 'Des rayonnages d’entrepôt, démontables. De quoi ranger pour de bon.', effect: 'Permet le niveau 2 de la réserve.', unlocks: { key: 'storage', level: 2 } },
  { id: 'flood', name: 'Projecteur de chantier', at: 'bridge_e', seen: 'Un projecteur sur trépied au checkpoint, avec son câble.', effect: 'Éclaire l’avenue : la nuit tombe trente secondes plus tard.' },
  { id: 'seeds', name: 'Bacs et semences', at: 'parvis', seen: 'Des bacs de culture et des sachets de graines, dans le kiosque du parvis.', effect: 'Un potager dans la cour : +1 ration chaque nuit.' },
  { id: 'dish', name: 'Parabole', at: 'east_n', seen: 'Une parabole intacte sur un balcon, rue Saint-Roch. Avec sa tête de réception.', effect: 'Le signal porte un peu plus loin, et permet le niveau 2 de l’antenne.', unlocks: { key: 'antenna', level: 2 } },
  { id: 'cots', name: 'Lits de camp', at: 'hosp_in', seen: 'Une pile de lits de camp de l’armée dans le hall de l’hôpital.', effect: 'De vrais lits : permet le niveau 2 de l’infirmerie.', unlocks: { key: 'infirmary', level: 2 } },
  { id: 'battery', name: 'Batteries de camion', at: 'garage', seen: 'Quatre batteries de poids lourd, sous une bâche, au fond du garage.', effect: 'Stocke le courant : permet le niveau 2 du générateur.', unlocks: { key: 'generator', level: 2 } },
  { id: 'bench', name: 'Établi et outillage', at: 'garage', seen: 'Un établi complet, étau, limes, fer à souder. Jo va pleurer.', effect: 'On bricole sur place : le premier leurre de chaque journée est gratuit.' },
];

export const hasFind = (s: GameState, id: string) => !!s.persistent['find_' + id];
export const knowsFind = (s: GameState, id: string) => !!s.persistent['seenfind_' + id];
export const findsAt = (s: GameState, node: NodeId) => FINDS.filter((f) => f.at === node && !hasFind(s, f.id));
export const hauling = (s: GameState, sv: Survivor) => FINDS.find((f) => f.id === s.flags['haul_' + sv.id]) ?? null;
const taken = (s: GameState, id: string) => s.survivors.some((v) => s.flags['haul_' + v.id] === id);

/** Nodes where a known object is still waiting to be carried home. */
export const findTargets = (s: GameState): NodeId[] => [...new Set(FINDS.filter((f) => !hasFind(s, f.id) && knowsFind(s, f.id) && !taken(s, f.id)).map((f) => f.at))];

/** Someone has had a proper look at this place (and, with sharp eyes, at the streets around). */
export function noteFinds(s: GameState, sv: Survivor, node: NodeId, ev: SimEvent[], wide = false) {
  for (const n of wide ? [node, ...neighbors(node)] : [node]) {
    for (const f of findsAt(s, n)) {
      if (knowsFind(s, f.id)) continue;
      s.persistent['seenfind_' + f.id] = true;
      say(s, ev, sv, `${f.seen} Ça servirait à l’abri : envoyez quelqu’un le récupérer à ${nodeName(f.at)}.`, 'report');
    }
  }
}

/** A search ends: if something for the base lies here and hands are free, it comes along. */
export function haul(s: GameState, sv: Survivor, node: NodeId, ev: SimEvent[]): boolean {
  if (hauling(s, sv)) return false;
  const f = findsAt(s, node).find((x) => !taken(s, x.id));
  if (!f) return false;
  s.persistent['seenfind_' + f.id] = true;
  s.flags['haul_' + sv.id] = f.id;
  say(s, ev, sv, `Je charge : ${f.name.toLowerCase()}. Ça pèse, je rentre doucement.`, 'report');
  return true;
}

/** Back at ECHO-7 with it. */
export function install(s: GameState, sv: Survivor, ev: SimEvent[]): Find | null {
  const f = hauling(s, sv);
  if (!f) return null;
  s.flags['haul_' + sv.id] = '';
  s.persistent['find_' + f.id] = true;
  gainXp(s, sv, 15);
  systemMsg(s, ev, `${f.name} installé à ECHO-7. ${f.effect}`, 'report');
  ev.push({ type: 'deposit', survivor: sv.id });
  return f;
}

/** What a missing object blocks in the shelter's upgrades. */
export function findBlocker(s: GameState, key: keyof Shelter, nextLevel: number): string | null {
  const need = FINDS.find((f) => f.unlocks && f.unlocks.key === key && f.unlocks.level === nextLevel && !hasFind(s, f.id));
  return need ? `Il manque : ${need.name.toLowerCase()}` : null;
}

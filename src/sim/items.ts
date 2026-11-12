// Tactical items: one-tap tools the operator can tell a survivor to use, paid from the shelter's stock.
import type { GameState, SimEvent, Survivor } from './types';
import { believedThreat, hopsCached, noise, say, zoneOf } from './core';
import { neighbors } from './world';
import { nodeName } from './text';

export type ItemId = 'decoy' | 'smoke';
export const ITEMS: Record<ItemId, { name: string; cost: 'parts' | 'supplies'; costName: string; hint: string }> = {
  decoy: { name: 'Leurre', cost: 'parts', costName: 'pièce', hint: 'Un réveil bricolé jeté dans la rue voisine : les meutes proches s’y ruent pendant une quarantaine de secondes.' },
  smoke: { name: 'Fumigène', cost: 'supplies', costName: 'ration', hint: 'Vingt-cinq secondes de fumée : presque invisible, et la meute qui chasse perd la trace.' },
};

const SMOKE_TIME = 25;
/** With a workbench at the shelter, the first decoy of the day costs nothing. */
export const freeDecoy = (s: GameState, id: ItemId) => id === 'decoy' && !!s.persistent.find_bench && !s.flags.benchUsed;
export const smoked = (s: GameState, sv: Survivor) => s.time < Number(s.flags['smoke_' + sv.id] ?? -1);

export function canUseItem(s: GameState, sv: Survivor | null | undefined, id: ItemId): boolean {
  return !!sv && sv.alive && sv.linked && sv.mode !== 'down' && zoneOf(sv) !== 'shelter' && (s.resources[ITEMS[id].cost] >= 1 || freeDecoy(s, id)) && !(id === 'smoke' && smoked(s, sv));
}

export function useItem(s: GameState, sv: Survivor, id: ItemId, ev: SimEvent[]): boolean {
  if (!canUseItem(s, sv, id)) return false;
  if (freeDecoy(s, id)) s.flags.benchUsed = true;
  else s.resources[ITEMS[id].cost] -= 1;
  const here = zoneOf(sv);
  if (id === 'decoy') {
    // thrown away from where the survivor is heading, toward the worst street nearby
    const ahead = sv.to ?? sv.order?.target ?? null;
    const options = neighbors(here).filter((n) => n !== 'shelter' && n !== ahead);
    const spot = options.sort((a, b) => believedThreat(s, sv, b) - believedThreat(s, sv, a) || hopsCached(b, 'shelter') - hopsCached(a, 'shelter'))[0] ?? here;
    noise(s, ev, spot, 0);
    for (const th of s.threats) {
      if (hopsCached(zoneOf(th), spot) > 2) continue;
      th.state = 'lured';
      th.target = null;
      th.goal = spot;
      th.timer = 40;
    }
    say(s, ev, sv, `Leurre lancé vers ${nodeName(spot)}. Ça sonne. Ils y vont.`, 'report');
  } else {
    s.flags['smoke_' + sv.id] = s.time + SMOKE_TIME;
    for (const th of s.threats) {
      if (th.target !== sv.id) continue;
      th.state = 'wander';
      th.target = null;
      th.timer = 8;
    }
    say(s, ev, sv, 'Fumigène. Je ne vois plus mes mains, et eux non plus.', 'report');
  }
  s.flags.itemsUsed = Number(s.flags.itemsUsed ?? 0) + 1;
  return true;
}

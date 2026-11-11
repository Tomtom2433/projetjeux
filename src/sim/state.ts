// Game creation, day setup and shelter upgrades.
import type { GameState, Shelter, SimEvent, Stock, Survivor } from './types';
import { NODE, NODES } from './world';
import { emptyStock, pushRadio, rnd } from './core';
import { mission } from './missions';

export const SAVE_VERSION = 4;
export const MISSION_DURATION = 600;

function makeSurvivor(p: Partial<Survivor> & Pick<Survivor, 'id' | 'name' | 'short' | 'role' | 'color'>): Survivor {
  return {
    traits: [],
    equipment: [],
    alive: true,
    missing: false,
    health: 100,
    fear: 15,
    fatigue: 10,
    courage: 50,
    trust: 50,
    speed: 1,
    noise: 1,
    carryCap: 3,
    ammo: 0,
    melee: false,
    medic: false,
    relations: {},
    memory: [],
    at: 'shelter',
    to: null,
    progress: 0,
    mode: 'idle',
    modeSince: 0,
    order: null,
    pendingOrder: null,
    work: 0,
    think: 0,
    carrying: emptyStock(),
    escort: { ines: false, patient: false, sacha: false, vogel: false },
    tactic: null,
    helping: null,
    carriedBy: null,
    bleed: 0,
    safeFor: 0,
    linked: true,
    lastReport: { x: NODE.shelter.x, z: NODE.shelter.z, node: 'shelter', time: 0, mode: 'idle' },
    obs: {},
    outbox: [],
    ...p,
  };
}

export function newGame(seed = (Date.now() & 0x7fffffff) || 1): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed | 0,
    day: 1,
    time: 0,
    duration: MISSION_DURATION,
    phase: 'running',
    survivors: [
      makeSurvivor({
        id: 'mara',
        name: 'Mara Kessler',
        short: 'Mara',
        role: 'Ambulancière',
        color: '#d9623b',
        traits: ['Compatissante', 'Sang-froid'],
        equipment: ['Trousse de secours', 'Pistolet'],
        courage: 70,
        trust: 65,
        ammo: 3,
        medic: true,
        relations: { jo: 45, lena: 72 },
        memory: [{ day: 0, time: 0, text: "A tenu l'infirmerie d'ECHO-7 seule pendant onze jours.", tone: 0.4 }],
      }),
      makeSurvivor({
        id: 'jo',
        name: 'Joachim Brandt',
        short: 'Jo',
        role: 'Mécanicien',
        color: '#d8b13a',
        traits: ['Têtu', 'Costaud'],
        equipment: ['Pied-de-biche', 'Sac de chantier'],
        courage: 80,
        trust: 40,
        speed: 0.92,
        noise: 1.2,
        carryCap: 5,
        melee: true,
        relations: { mara: 45, lena: 55 },
        memory: [{ day: 0, time: 0, text: 'Un opérateur précédent a envoyé son frère au checkpoint. Il n’est pas revenu.', tone: -0.7, kind: 'brother', node: 'bridge_e' }],
      }),
      makeSurvivor({
        id: 'lena',
        name: 'Lena Voss',
        short: 'Lena',
        role: 'Éclaireuse',
        color: '#4f8fd6',
        traits: ['Rapide', 'Anxieuse'],
        equipment: ['Jumelles', 'Lampe torche'],
        courage: 35,
        trust: 55,
        fear: 25,
        speed: 1.2,
        noise: 0.7,
        carryCap: 2,
        relations: { mara: 72, jo: 55 },
        memory: [{ day: 0, time: 0, text: 'Mara l’a trouvée dans une cave du quai nord. Elle n’en parle pas.', tone: -0.3, kind: 'cave', node: 'quay_n' }],
      }),
    ],
    threats: [],
    nextThreatId: 1,
    intel: {},
    loot: {},
    resources: { supplies: 3, medicine: 0, parts: 2, flares: 1 },
    shelter: { antenna: 0, infirmary: 0, generator: 0, storage: 0 },
    flags: {},
    persistent: {},
    incidents: {},
    radio: [],
    nextRadioId: 1,
    awaiting: null,
    storm: { start: 330, end: 430 },
    dayStart: { resources: emptyStock() },
    delivered: emptyStock(),
    rescued: [],
    rescuedToday: [],
    unresolved: [],
    debrief: null,
    ending: null,
  };
  setupDay(s, []);
  return s;
}

/** Reset the mission layer for the current day. Survivors, shelter and persistent flags are kept. */
export function setupDay(s: GameState, ev: SimEvent[]) {
  s.time = 0;
  s.phase = 'running';
  s.flags = {};
  s.debrief = null;
  s.delivered = emptyStock();
  s.rescuedToday = [];
  s.unresolved = [];
  s.radio = [];
  s.awaiting = null;
  s.dayStart = { resources: { supplies: s.resources.supplies, medicine: s.resources.medicine, parts: s.resources.parts } };
  const m = mission(s);
  s.storm = m.storm ? { start: m.storm[0], end: m.storm[1] } : { start: 310 + Math.floor(rnd(s) * 40), end: 0 };
  if (!m.storm) s.storm.end = s.storm.start + 100;
  for (const [a, b] of m.blocked ?? []) s.flags['blk_' + [a, b].sort().join('|')] = true;

  for (const sv of s.survivors) {
    if (!sv.alive) continue;
    Object.assign(sv, {
      at: 'shelter',
      to: null,
      progress: 0,
      mode: 'idle',
      modeSince: 0,
      order: null,
      pendingOrder: null,
      work: 0,
      carrying: emptyStock(),
      escort: { ines: false, patient: false, sacha: false, vogel: false },
      tactic: null,
      helping: null,
      carriedBy: null,
      bleed: 0,
      safeFor: 0,
      linked: true,
      obs: {},
      outbox: [],
    });
    sv.lastReport = { x: NODE.shelter.x, z: NODE.shelter.z, node: 'shelter', time: 0, mode: 'idle' };
  }

  s.intel = {};
  for (const n of NODES) s.intel[n.id] = { seenAt: -1, threat: 0, lootKnown: false };
  for (const id of ['shelter', 'gate', 'cross_w']) s.intel[id].seenAt = 0;
  // Yesterday's rumour: stale on purpose (the real pack is larger).
  s.intel.bridge_e = { seenAt: -900, threat: 3, lootKnown: false };

  s.loot = {};
  for (const [node, k] of Object.entries(m.loot)) s.loot[node] = { supplies: 0, medicine: 0, parts: 0, ...k };

  s.threats = [];
  for (const [at, size, state] of m.threats)
    s.threats.push({ id: s.nextThreatId++, at, to: null, progress: 0, size, state, target: null, goal: null, timer: 10 + rnd(s) * 20, seen: false });

  s.incidents = {};
  for (const id of ['bridge', 'hospital', 'unknown', 'logbook', 'vogel', 'boat']) s.incidents[id] = { state: m.incidents.includes(id) ? 'pending' : 'resolved' };
  if (s.day > 1 && s.persistent.inesLeft) s.incidents.hospital = { state: 'pending' };
  s.flags.unknownTruth = rnd(s) < 0.6 ? 'genuine' : 'lure';
  s.flags.unknownState = 'none';

  const leader = s.survivors.find((v) => v.alive);
  const text = m.brief;
  const msg = pushRadio(s, ev, {
    from: leader?.id ?? 'echo',
    fromName: leader?.short ?? 'ECHO-7',
    text,
    kind: 'incident',
    incident: 'briefing',
    choices: m.choices ?? [{ id: 'ok', label: 'Reçu. On y va.', hint: m.hint }],
  });
  s.awaiting = msg.id;
}

// ---------------------------------------------------------------- shelter

export interface UpgradeDef {
  key: keyof Shelter;
  name: string;
  icon: string;
  levels: { cost: Partial<Stock>; effect: string }[];
  base: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    key: 'antenna',
    name: 'Antenne',
    icon: '📡',
    base: 'Portée radio de base. L’hôpital et le garage sont hors réseau.',
    levels: [
      { cost: { parts: 2 }, effect: 'Portée +12 % : liaison à l’intérieur de l’hôpital et du garage.' },
      { cost: { parts: 3, supplies: 1 }, effect: 'Portée +24 % : la liaison tient pendant l’orage. Nécessite un générateur.' },
    ],
  },
  {
    key: 'infirmary',
    name: 'Infirmerie',
    icon: '✚',
    base: 'Un lit de camp. Les blessés récupèrent lentement.',
    levels: [
      { cost: { medicine: 1, parts: 1 }, effect: 'Soins à l’abri ×3, les blessés graves sont stabilisés.' },
      { cost: { medicine: 2, parts: 2 }, effect: 'Soins ×5, récupération complète pendant la nuit.' },
    ],
  },
  {
    key: 'generator',
    name: 'Générateur',
    icon: '⚡',
    base: 'À l’arrêt. La cour est dans le noir.',
    levels: [
      { cost: { parts: 2, supplies: 1 }, effect: 'Projecteurs : la peur retombe plus vite à l’abri, antenne niveau 2 possible.' },
      { cost: { parts: 3, supplies: 2 }, effect: 'Périmètre éclairé : meilleures chances pour ceux qui rentrent de nuit.' },
    ],
  },
  {
    key: 'storage',
    name: 'Réserve',
    icon: '▣',
    base: 'Stock limité à 8 par ressource.',
    levels: [
      { cost: { parts: 1, supplies: 1 }, effect: 'Stock 12 par ressource, +1 charge par survivant.' },
      { cost: { parts: 2, supplies: 2 }, effect: 'Stock 16 par ressource, +2 charges par survivant.' },
    ],
  },
];

export const storageCap = (s: GameState) => 8 + 4 * s.shelter.storage;

export function upgradeBlocker(s: GameState, key: keyof Shelter): string | null {
  const def = UPGRADES.find((u) => u.key === key)!;
  const lvl = s.shelter[key];
  if (lvl >= def.levels.length) return 'Niveau maximum';
  if (key === 'antenna' && lvl === 1 && s.shelter.generator < 1) return 'Nécessite un générateur';
  const cost = def.levels[lvl].cost;
  for (const k of ['supplies', 'medicine', 'parts'] as const) {
    if ((cost[k] ?? 0) > s.resources[k]) return 'Ressources insuffisantes';
  }
  return null;
}

export function buyUpgrade(s: GameState, key: keyof Shelter): boolean {
  if (upgradeBlocker(s, key)) return false;
  const def = UPGRADES.find((u) => u.key === key)!;
  const cost = def.levels[s.shelter[key]].cost;
  for (const k of ['supplies', 'medicine', 'parts'] as const) s.resources[k] -= cost[k] ?? 0;
  s.shelter[key]++;
  return true;
}

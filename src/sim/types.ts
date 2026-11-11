// LAST SIGNAL — simulation data model.
// Everything in GameState is plain JSON: the simulation never touches the DOM or the renderer.

export type NodeId = string;
export type NodeKind = 'shelter' | 'street' | 'bridge' | 'interior';

export interface NodeDef {
  id: NodeId;
  name: string;
  x: number;
  z: number;
  kind: NodeKind;
  /** 0..1 — how much the place hides a survivor. */
  cover: number;
  /** 0..1 — radio reception with a level-0 antenna. */
  signal: number;
}

export interface EdgeDef {
  a: NodeId;
  b: NodeId;
  /** 0..1 — how visible a walker is on that stretch. */
  exposure: number;
  /** Optional intermediate waypoints, ordered from a to b. */
  via?: [number, number][];
}

export type OrderType = 'scout' | 'retrieve' | 'hold' | 'retreat' | 'rescue';

export interface Order {
  type: OrderType;
  target: NodeId | null;
  stage: 'go' | 'work' | 'return';
  issuedAt: number;
}

export type Mode = 'idle' | 'order' | 'flee' | 'fight' | 'hide' | 'rest' | 'help' | 'home' | 'down';

export interface Stock {
  supplies: number;
  medicine: number;
  parts: number;
}

export interface MemoryEntry {
  day: number;
  time: number;
  text: string;
  /** Emotional weight, -1 (trauma) .. +1 (pride). */
  tone: number;
  /** Category and place, so later dialogue can refer back to it. */
  kind?: string;
  node?: NodeId;
}

export interface Observation {
  t: number;
  threat: number;
}

export interface Survivor {
  id: string;
  name: string;
  short: string;
  role: string;
  color: string;
  traits: string[];
  equipment: string[];
  alive: boolean;
  missing: boolean;
  health: number;
  fear: number;
  fatigue: number;
  courage: number;
  trust: number;
  speed: number;
  /** Multiplier on the chance of being noticed. */
  noise: number;
  carryCap: number;
  ammo: number;
  melee: boolean;
  medic: boolean;
  relations: Record<string, number>;
  memory: MemoryEntry[];

  at: NodeId;
  to: NodeId | null;
  progress: number;
  mode: Mode;
  modeSince: number;
  order: Order | null;
  /** Order transmitted while the link was down; delivered when the signal returns. */
  pendingOrder: Order | null;
  work: number;
  think: number;
  carrying: Stock;
  escort: { ines: boolean; patient: boolean; sacha: boolean; vogel: boolean };
  tactic: 'stealth' | 'detour' | null;
  helping: string | null;
  carriedBy: string | null;
  bleed: number;
  safeFor: number;

  linked: boolean;
  /** What the operator believes: last position actually reported over the radio. */
  lastReport: { x: number; z: number; node: NodeId; time: number; mode: Mode };
  /** Private observations, merged into shared intel when the link is up. */
  obs: Record<NodeId, Observation>;
  /** Messages spoken into a dead radio; flushed on relink. */
  outbox: { time: number; text: string }[];
}

export interface Threat {
  id: number;
  at: NodeId;
  to: NodeId | null;
  progress: number;
  size: number;
  state: 'dormant' | 'wander' | 'hunt' | 'lured';
  target: string | null;
  goal: NodeId | null;
  timer: number;
  /** True while a linked survivor is currently watching it. */
  seen: boolean;
}

export interface Intel {
  /** Mission time of the last report (-1 = never; negative = from a previous day). */
  seenAt: number;
  threat: number;
  lootKnown: boolean;
}

export interface Choice {
  id: string;
  label: string;
  hint: string;
}

export interface RadioMessage {
  id: number;
  time: number;
  from: string;
  fromName: string;
  text: string;
  signal: number;
  kind: 'report' | 'alert' | 'incident' | 'system';
  delayed?: boolean;
  incident?: string;
  choices?: Choice[];
  chosen?: string;
}

export interface Shelter {
  antenna: number;
  infirmary: number;
  generator: number;
  storage: number;
}

export interface Debrief {
  day: number;
  rating: 'succes' | 'mitige' | 'echec';
  headline: string;
  deaths: string[];
  rescues: string[];
  gained: Stock;
  consequences: string[];
  unresolved: string[];
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  day: number;
  time: number;
  duration: number;
  phase: 'briefing' | 'running' | 'debrief' | 'ending' | 'gameover';
  survivors: Survivor[];
  threats: Threat[];
  nextThreatId: number;
  intel: Record<NodeId, Intel>;
  loot: Record<NodeId, Stock>;
  resources: Stock & { flares: number };
  shelter: Shelter;
  /** Mission-scoped flags, cleared every day. */
  flags: Record<string, number | string | boolean>;
  /** Flags that survive across days. */
  persistent: Record<string, number | string | boolean>;
  incidents: Record<string, { state: 'pending' | 'active' | 'resolved'; choice?: string; by?: string }>;
  radio: RadioMessage[];
  nextRadioId: number;
  /** Id of the radio message waiting for an operator decision (simulation is frozen meanwhile). */
  awaiting: number | null;
  storm: { start: number; end: number };
  dayStart: { resources: Stock };
  delivered: Stock;
  rescued: string[];
  rescuedToday: string[];
  unresolved: string[];
  debrief: Debrief | null;
  /** Epilogue lines, set once the last day is over. */
  ending: string[] | null;
}

export type SimEvent =
  | { type: 'radio'; id: number }
  | { type: 'noise'; node: NodeId; power: number }
  | { type: 'hit'; survivor: string }
  | { type: 'death'; survivor: string }
  | { type: 'deposit'; survivor: string }
  | { type: 'link'; survivor: string; linked: boolean }
  | { type: 'flare'; node: NodeId }
  | { type: 'order'; survivor: string; result: 'ack' | 'refused' | 'queued' }
  | { type: 'phase' };

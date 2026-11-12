// LAST SIGNAL — simulation step. Pure logic: no rendering, no DOM, no network.
import { smoked } from './items';
import type { GameState, Mode, NodeId, Order, OrderType, SimEvent, Survivor, Threat } from './types';
import { NODE, neighbors, edgeLength } from './world';
import {
  LINK_THRESHOLD,
  believedThreat,
  clamp,
  clamp01,
  darkness,
  emptyStock,
  findPath,
  hopsCached,
  noise,
  perceive,
  pushRadio,
  remember,
  rnd,
  say,
  shiftTrust,
  stockTotal,
  stormLevel,
  survivor,
  survivorPos,
  survivorSignal,
  syncObservations,
  systemMsg,
  zoneOf, difficulty } from './core';
import { onArrive, tickIncidents } from './incidents';
import { line, lootText, nodeName, recall } from './text';
import { cryOut, protest, thank, tickBanter, welcome } from './banter';
import { setupDay, storageCap } from './state';
import { tickDirector } from './director';
import { breakSynchro, coverCallouts, coverer, creditSynchro } from './cover';
import { aptitude, gainXp, hasPerk, levelUp, practise } from './perks';
import { ORDER_LABEL } from './text';
import { LAST_DAY, buildEnding, mission, objective, objectiveStatus, type ObjectiveStatus } from './missions';

export const TICK = 0.25;

const armed = (sv: Survivor) => sv.melee || sv.ammo > 0;
const escorting = (sv: Survivor) => sv.escort.ines || sv.escort.patient || sv.escort.sacha || sv.escort.vogel || sv.escort.stranger;

function setMode(s: GameState, sv: Survivor, mode: Mode) {
  if (sv.mode === mode) return;
  sv.mode = mode;
  sv.modeSince = s.time;
  sv.safeFor = 0;
}

// ---------------------------------------------------------------- orders

export function validTargets(s: GameState, sv: Survivor, type: OrderType): NodeId[] {
  const here = zoneOf(sv);
  const all = Object.keys(NODE);
  if (type === 'hold' || type === 'retreat') return [];
  if (type === 'scout') return all.filter((n) => n !== 'shelter' && n !== here);
  if (type === 'retrieve') return all.filter((n) => NODE[n].kind === 'interior' || (s.loot[n] && stockTotal(s.loot[n]) > 0 && s.intel[n].lootKnown) || n === 'quay_s');
  // rescue: downed survivors, known people in need.
  const out = new Set<NodeId>();
  for (const o of s.survivors) if (o.alive && o.mode === 'down' && o.id !== sv.id) out.add(o.lastReport.node);
  if (s.flags.unknownState === 'answered') out.add('apts');
  if (s.incidents.hospital.state === 'pending' || s.persistent.inesLeft) out.add('hosp_in');
  if (s.flags.vogelLocated && s.incidents.vogel.state === 'pending') out.add('lock_e');
  if (s.flags.strangerAt) out.add(s.flags.strangerAt as NodeId);
  return [...out];
}

/** How willing the survivor is to carry out (or keep carrying out) an order. 0..~1.3 */
export function obeyScore(s: GameState, sv: Survivor, order: Order): number {
  if (order.type === 'retreat' || order.type === 'hold') return 1;
  const goal = order.stage === 'return' ? 'shelter' : order.target ?? 'shelter';
  const path = findPath(s, zoneOf(sv), goal, { safe: 1.5, sv, avoidBridge: sv.tactic === 'detour' });
  let risk = 0;
  if (path) for (const n of path.slice(1, 4)) risk = Math.max(risk, believedThreat(s, sv, n) / 5);
  // Being sent *to* a known pack weighs on the mind even from far away.
  if (path && path.length > 4) risk = Math.max(risk, (believedThreat(s, sv, path[path.length - 1]) / 5) * 0.7);
  risk = clamp01(risk);
  if (order.stage === 'return') risk *= 0.5;
  const far = path && path.length > 4 ? darkness(s) * 0.12 : 0;
  return (
    0.5 +
    (aptitude(sv, order.type) - 3) * 0.04 +
    (sv.trust / 100) * 0.35 +
    (sv.courage / 100) * 0.25 -
    (sv.fear / 100) * (0.25 + 0.5 * risk) -
    risk * 0.15 -
    far -
    (sv.fatigue > 85 ? 0.2 : 0) -
    (sv.health < 35 ? 0.25 : 0)
  );
}

function deliverOrder(s: GameState, sv: Survivor, order: Order, ev: SimEvent[]) {
  const vars = { node: order.target ? nodeName(order.target) : '' };
  if (sv.health < 20 && order.type !== 'hold' && order.type !== 'retreat') {
    say(s, ev, sv, line(s, sv, 'refuse_hurt'));
    ev.push({ type: 'order', survivor: sv.id, result: 'refused' });
    return;
  }
  if (obeyScore(s, sv, order) < 0.32) {
    say(s, ev, sv, line(s, sv, 'refuse', vars));
    shiftTrust(sv, -2);
    remember(s, sv, `A refusé un ordre vers ${vars.node}.`, -0.2, 'refused', order.target ?? undefined);
    ev.push({ type: 'order', survivor: sv.id, result: 'refused' });
    return;
  }
  sv.order = order;
  sv.helping = null;
  sv.work = 0;
  setMode(s, sv, 'order');
  say(s, ev, sv, line(s, sv, 'ack_' + order.type, vars));
  ev.push({ type: 'order', survivor: sv.id, result: 'ack' });
  if (order.target && order.type !== 'retreat') {
    const path = findPath(s, zoneOf(sv), order.target, { safe: 1.2, sv, avoidBridge: sv.tactic === 'detour' }) ?? [order.target];
    const memory = recall(s, sv, path.slice(1));
    if (memory) say(s, ev, sv, memory);
    protest(s, sv, path, ev);
  }
}

export function issueOrder(s: GameState, svId: string, type: OrderType, target: NodeId | null, ev: SimEvent[]): { ok: boolean; reason?: string } {
  const sv = survivor(s, svId);
  if (!sv || !sv.alive) return { ok: false, reason: 'Survivant indisponible' };
  if (sv.mode === 'down') return { ok: false, reason: `${sv.short} est à terre` };
  if (type !== 'hold' && type !== 'retreat' && !target) return { ok: false, reason: 'Choisissez une destination' };
  const order: Order = { type, target: type === 'retreat' ? 'shelter' : target, stage: 'go', issuedAt: s.time };
  if (!sv.linked) {
    sv.pendingOrder = order;
    systemMsg(s, ev, `Pas de liaison avec ${sv.short}. Ordre en attente : il partira quand le signal reviendra.`, 'alert');
    ev.push({ type: 'order', survivor: sv.id, result: 'queued' });
    return { ok: true, reason: 'queued' };
  }
  deliverOrder(s, sv, order, ev);
  return { ok: true };
}

/** Plan one order ahead: it is transmitted the moment the current one is done. */
export function queueOrder(s: GameState, svId: string, type: OrderType, target: NodeId | null, ev: SimEvent[]): boolean {
  const sv = survivor(s, svId);
  if (!sv || !sv.alive || !sv.order || (type !== 'hold' && type !== 'retreat' && !target)) return false;
  sv.nextOrder = { type, target: type === 'retreat' ? 'shelter' : target, stage: 'go', issuedAt: s.time };
  ev.push({ type: 'order', survivor: sv.id, result: 'next' });
  return true;
}

// ---------------------------------------------------------------- movement

/** Event sink for the current step, so movement can report Synchro gains. */
let crossEv: SimEvent[] | null = null;

function speedOf(s: GameState, sv: Survivor): number {
  let v = 1.55 * sv.speed * (1 - sv.fatigue / 260);
  if (stockTotal(sv.carrying) > 0) v *= 0.92;
  const triage = hasPerk(sv, 'triage');
  if (escorting(sv) || sv.helping) v *= 0.88 + aptitude(sv, 'rescue') * 0.04;
  if (sv.escort.patient) v *= triage ? 0.78 : 0.55;
  else if (sv.escort.ines || sv.escort.sacha || sv.escort.vogel || sv.escort.stranger) v *= triage ? 0.96 : 0.85;
  if (hasPerk(sv, 'runner')) v *= 1.12;
  if (sv.helping && survivor(s, sv.helping)?.carriedBy === sv.id) v *= 0.6;
  if (sv.mode === 'flee') v *= 1.35;
  if (sv.health < 40 && sv.mode !== 'flee') v *= 0.8;
  if (sv.tactic === 'stealth' && NODE[zoneOf(sv)].kind === 'bridge') v *= 0.7;
  return v;
}

/** Walk toward goal along the graph. Returns true once standing on it. */
function moveToward(s: GameState, sv: Survivor, goal: NodeId, dt: number, safe: number): boolean {
  if (!sv.to) {
    if (sv.at === goal) return true;
    const path = findPath(s, sv.at, goal, { safe, sv, avoidBridge: sv.tactic === 'detour' });
    if (!path || path.length < 2) return false;
    sv.to = path[1];
    sv.progress = 0;
  } else if (sv.to !== goal) {
    // Turn around mid-street if the way to the goal now leads back.
    const path = findPath(s, sv.to, goal, { safe, sv, avoidBridge: sv.tactic === 'detour' });
    if (path && path.length > 1 && path[1] === sv.at) {
      const from = sv.at;
      sv.at = sv.to;
      sv.to = from;
      sv.progress = 1 - sv.progress;
    }
  }
  sv.progress += (speedOf(s, sv) * dt) / edgeLength(sv.at, sv.to!);
  if (sv.progress >= 1) {
    sv.at = sv.to!;
    sv.to = null;
    sv.progress = 0;
    if (sv.mode === 'order' && sv.at !== 'shelter' && crossEv) creditSynchro(s, sv, 'cross_' + sv.at, crossEv);
  }
  return !sv.to && sv.at === goal;
}

/** Finish the current street segment (toward the nearer end) so the survivor stands on a node. */
function settle(s: GameState, sv: Survivor, dt: number) {
  if (!sv.to) return;
  if (sv.progress < 0.5) {
    const from = sv.at;
    sv.at = sv.to;
    sv.to = from;
    sv.progress = 1 - sv.progress;
  }
  moveToward(s, sv, sv.to!, dt, 1);
}

function arriveHome(s: GameState, sv: Survivor, ev: SimEvent[]) {
  const cap = storageCap(s);
  const carried = sv.helping ? survivor(s, sv.helping) : undefined;
  if (carried && carried.carriedBy === sv.id) {
    for (const k of ['supplies', 'medicine', 'parts'] as const) sv.carrying[k] += carried.carrying[k];
    carried.carrying = emptyStock();
  }
  const brought = stockTotal(sv.carrying) > 0;
  const dropped = { ...sv.carrying };
  for (const k of ['supplies', 'medicine', 'parts'] as const) {
    const room = Math.max(0, cap - s.resources[k]);
    const put = Math.min(room, sv.carrying[k]);
    if (put < sv.carrying[k]) s.flags.overflow = true;
    s.resources[k] += put;
    s.delivered[k] += put;
  }
  sv.carrying = emptyStock();
  const people: string[] = [];
  if (sv.escort.ines) {
    people.push('Inès Duval');
    s.persistent.inesRescued = true;
    s.persistent.inesLeft = false;
  }
  if (sv.escort.patient) {
    people.push('le patient de Saint-Roch');
    s.persistent.patientRescued = true;
  }
  if (sv.escort.sacha) {
    people.push('Sacha et sa fille');
    s.persistent.sachaRescued = true;
  }
  if (sv.escort.vogel) {
    people.push('Elias Vogel');
    s.persistent.vogel = 'rescued';
  }
  if (sv.escort.stranger) {
    people.push('Un rescapé du quartier');
    s.resources.supplies = Math.min(cap, s.resources.supplies + 1);
  }
  gainXp(s, sv, people.length * 25 + (brought ? 8 : 0));
  if (people.length) practise(s, sv, 'rescue');
  for (const p of people) {
    s.rescued.push(p);
    s.rescuedToday.push(p);
  }
  sv.escort = { ines: false, patient: false, sacha: false, vogel: false, stranger: false };
  if (sv.helping) {
    const ally = survivor(s, sv.helping);
    if (ally && ally.carriedBy === sv.id) {
      ally.carriedBy = null;
      ally.at = 'shelter';
      ally.to = null;
      ally.health = Math.max(ally.health, 12 + 15 * s.shelter.infirmary);
      setMode(s, ally, 'idle');
      ally.relations[sv.id] = clamp((ally.relations[sv.id] ?? 50) + 20);
      remember(s, ally, `${sv.short} l’a ramené·e à ECHO-7 sur son dos.`, 0.8);
      remember(s, sv, `A ramené ${ally.short} vivant·e.`, 0.7);
      thank(s, ally, sv, ev);
      if (s.day === 0) s.flags.tut_rescued = true;
      people.push(ally.short);
    }
    sv.helping = null;
  }
  if (brought || people.length) {
    shiftTrust(sv, 3);
    const what = [brought ? lootText(dropped) : '', people.length ? people.join(', ') + ' en sécurité' : ''].filter(Boolean).join(' · ');
    say(s, ev, sv, line(s, sv, 'deposit', { loot: what }));
    ev.push({ type: 'deposit', survivor: sv.id });
    welcome(s, sv, ev);
  } else if (sv.order || sv.mode === 'home' || sv.mode === 'flee') {
    say(s, ev, sv, line(s, sv, 'home'));
  }
  sv.order = null;
  sv.tactic = null;
  setMode(s, sv, 'idle');
}

// ---------------------------------------------------------------- order execution

function runOrder(s: GameState, sv: Survivor, dt: number, ev: SimEvent[]) {
  const o = sv.order!;
  const vars = { node: o.target ? nodeName(o.target) : '' };
  if (o.type === 'hold') {
    settle(s, sv, dt);
    return;
  }
  if (o.type === 'retreat' || o.stage === 'return') {
    if (moveToward(s, sv, 'shelter', dt, 2)) arriveHome(s, sv, ev);
    return;
  }
  const target = o.target!;
  if (o.stage === 'go') {
    if (!moveToward(s, sv, target, dt, o.type === 'scout' ? 1.8 : 1.2)) return;
    // Arrived. Incidents may already have rewritten the order.
    onArrive(s, sv, ev);
    if (sv.order !== o || o.stage !== 'go' || s.awaiting !== null) return;
    o.stage = 'work';
    if (o.type === 'scout') sv.work = (sv.equipment.includes('Jumelles') ? 4 : 7) * (hasPerk(sv, 'lynx') ? 0.5 : 1) * (1.3 - aptitude(sv, 'scout') * 0.1);
    else if (o.type === 'retrieve') {
      sv.work = 12 * (1.36 - aptitude(sv, 'retrieve') * 0.12);
      say(s, ev, sv, line(s, sv, 'search_start', vars));
    } else sv.work = 2;
    return;
  }
  // stage === 'work'
  sv.work -= dt;
  if (o.type === 'retrieve' && rnd(s) < 0.02 * dt * sv.noise) noise(s, ev, sv.at, 0.5);
  if (sv.work > 0) return;
  if (o.type === 'scout') {
    perceive(s, sv, true);
    s.flags['scouted_' + target] = true;
    creditSynchro(s, sv, 'scout_' + target, ev);
    gainXp(s, sv, 12);
    practise(s, sv, 'scout');
    if (hasPerk(sv, 'lynx')) for (const n of [target, ...neighbors(target)]) s.intel[n].lootKnown = true;
    const n = Math.round(believedThreat(s, sv, target));
    const around = neighbors(target).reduce((a, m) => a + (NODE[m].kind !== 'interior' ? Math.round(believedThreat(s, sv, m)) : 0), 0);
    say(s, ev, sv, line(s, sv, n + around > 0 ? 'scout_threat' : 'scout_clear', { ...vars, n: n + around }));
    shiftTrust(sv, 1);
    sv.order = { type: 'hold', target: null, stage: 'go', issuedAt: s.time };
  } else if (o.type === 'retrieve') {
    const stock = s.loot[target];
    const cap = sv.carryCap + s.shelter.storage - stockTotal(sv.carrying);
    const got = emptyStock();
    let room = cap;
    if (stock)
      for (const k of ['medicine', 'parts', 'supplies'] as const) {
        const take = Math.min(room, stock[k]);
        stock[k] -= take;
        got[k] = take;
        sv.carrying[k] += take;
        room -= take;
      }
    s.intel[target].lootKnown = true;
    if (stockTotal(got) > 0) {
      if (hasPerk(sv, 'scrounger')) {
        got.supplies++;
        sv.carrying.supplies++;
      }
      creditSynchro(s, sv, 'search_' + target, ev);
      gainXp(s, sv, Math.min(20, stockTotal(got) * 6));
      practise(s, sv, 'retrieve');
      say(s, ev, sv, line(s, sv, 'search_found', { loot: lootText(got) }));
      o.stage = 'return';
    } else {
      say(s, ev, sv, line(s, sv, 'search_empty', vars));
      o.stage = 'return';
    }
  } else if (o.type === 'rescue') {
    const ally = s.survivors.find((a) => a.alive && a.mode === 'down' && !a.carriedBy && zoneOf(a) === sv.at);
    if (ally) {
      for (const o of s.survivors) if (o !== sv && o.helping === ally.id) o.helping = null;
      pickUp(s, sv, ally, ev);
    }
    else if (!escorting(sv)) say(s, ev, sv, `Personne à ${vars.node}.`);
    o.stage = 'return';
  }
}

function pickUp(s: GameState, sv: Survivor, ally: Survivor, ev: SimEvent[]) {
  ally.carriedBy = sv.id;
  ally.health = Math.max(ally.health, (hasPerk(sv, 'surehands') ? 35 : sv.medic ? 15 : 5) + aptitude(sv, 'rescue') * 4);
  practise(s, sv, 'rescue');
  creditSynchro(s, sv, 'pickup_' + ally.id, ev);
  gainXp(s, sv, 20);
  ally.bleed = 9999;
  sv.helping = ally.id;
  say(s, ev, sv, line(s, sv, 'help_got', { ally: ally.short }), 'report', 'rescue');
}

// ---------------------------------------------------------------- threats & encounters

interface Proximity {
  level: number;
  hunted: boolean;
  here: Threat[];
  node: NodeId | null;
}

function proximity(s: GameState, sv: Survivor): Proximity {
  const here = zoneOf(sv);
  const p: Proximity = { level: 0, hunted: false, here: [], node: null };
  for (const th of s.threats) {
    const z = zoneOf(th);
    const d = hopsCached(z, here);
    let l = 0;
    if (th.state === 'hunt' && th.target === sv.id) {
      p.hunted = true;
      l = d === 0 ? 1 : d === 1 ? 0.8 : 0.4;
    } else if (d === 0) l = 1;
    else if (d === 1 && sv.obs[z] && sv.obs[z].t >= s.time - 1.5 && sv.obs[z].threat > 0) l = 0.45;
    if (d === 0) p.here.push(th);
    if (l > p.level) {
      p.level = l;
      p.node = z;
    }
  }
  return p;
}

function goDown(s: GameState, sv: Survivor, ev: SimEvent[]) {
  say(s, ev, sv, line(s, sv, 'down'), 'alert');
  remember(s, sv, `Est tombé·e à ${NODE[zoneOf(sv)].name}.`, -0.7, 'hurt', zoneOf(sv));
  cryOut(s, sv, ev);
  setMode(s, sv, 'down');
  sv.health = 0;
  sv.bleed = 110;
  sv.order = null;
  sv.to = null;
  sv.at = zoneOf(sv);
  if (sv.helping) {
    const ally = survivor(s, sv.helping);
    if (ally && ally.carriedBy === sv.id) {
      ally.carriedBy = null;
      ally.at = sv.at;
      ally.to = null;
      ally.bleed = 40;
    }
    sv.helping = null;
  }
  if (sv.escort.ines || sv.escort.patient) {
    s.unresolved.push('Inès Duval a disparu quand son escorte est tombée.');
    s.persistent.inesLost = true;
  }
  if (sv.escort.sacha) s.unresolved.push('Sacha et sa fille ont fui dans les ruelles.');
  if (sv.escort.vogel) {
    s.persistent.vogel = 'lost';
    s.unresolved.push('Elias Vogel est tombé avec son escorte. Son magnétophone tourne encore, quelque part.');
  }
  sv.escort = { ines: false, patient: false, sacha: false, vogel: false, stranger: false };
  systemMsg(s, ev, `${sv.short} ne répond plus. Balise de détresse active : ${nodeName(sv.at)}.`, 'alert');
}

function die(s: GameState, sv: Survivor, ev: SimEvent[], how: string) {
  sv.alive = false;
  sv.mode = 'down';
  s.flags['dead_' + sv.id] = how;
  ev.push({ type: 'death', survivor: sv.id });
  systemMsg(s, ev, `La balise de ${sv.short} s’est tue.`, 'alert');
  for (const o of s.survivors) {
    if (!o.alive) continue;
    const rel = o.relations[sv.id] ?? 50;
    o.fear = clamp(o.fear + rel * 0.25);
    shiftTrust(o, -Math.round(rel * 0.12));
    remember(s, o, `${sv.short} est mort·e ${how}.`, -1);
  }
}

function encounter(s: GameState, sv: Survivor, prox: Proximity, ev: SimEvent[]) {
  const here = zoneOf(sv);
  if (here === 'shelter') return;
  const node = NODE[here];
  for (const th of prox.here) {
    if (th.state !== 'hunt') {
      let p = 0.042 * Math.sqrt(th.size) * (1 - node.cover * 0.7) * sv.noise;
      if (th.state === 'dormant') p *= 0.6;
      if (!sv.to && (sv.mode === 'hide' || (sv.mode === 'order' && sv.order?.type === 'hold'))) p *= 0.3;
      if (sv.tactic === 'stealth' && node.kind === 'bridge') p *= 0.3;
      if (hasPerk(sv, 'shadow')) p *= 0.7;
      if (coverer(s, sv)) p *= 0.55;
      if (s.time < ((s.flags.rainUntil as number) ?? -1)) p *= 0.75;
      if (sv.mode === 'order' && sv.order?.type === 'scout') p *= 1.02 - aptitude(sv, 'scout') * 0.11;
      if (sv.mode === 'order' && sv.order?.type === 'hold') p *= 1.3 - aptitude(sv, 'hold') * 0.12;
      if (sv.escort.patient) p *= 1.3;
      if (stockTotal(sv.carrying) > 0) p *= 1.1;
      p *= 1 - darkness(s) * 0.2;
      p *= difficulty(s).detect;
      if (smoked(s, sv)) p *= 0.15;
      if (rnd(s) < p) {
        th.state = 'hunt';
        th.target = sv.id;
        th.timer = 0;
        breakSynchro(s, ev);
        sv.fear = clamp(sv.fear + 24 * (1 - sv.courage / 200) * (hasPerk(sv, 'calm') ? 0.7 : 1));
        say(s, ev, sv, line(s, sv, 'spotted', { node: node.name }), 'alert');
      }
      continue;
    }
    if (th.target !== sv.id) continue;
    // The pack is on them.
    if (rnd(s) < Math.min(0.4, 0.1 + 0.05 * th.size)) {
      sv.health -= (4 + rnd(s) * 8) * (hasPerk(sv, 'thick') ? 0.7 : 1) * difficulty(s).damage;
      sv.fear = clamp(sv.fear + 8);
      ev.push({ type: 'hit', survivor: sv.id });
      if (sv.order) shiftTrust(sv, -1);
      if (sv.health <= 0) {
        goDown(s, sv, ev);
        th.timer = 6;
        return;
      }
      if (rnd(s) < 0.35) say(s, ev, sv, line(s, sv, 'hit'), 'alert');
    }
    let killChance = 0;
    if (sv.ammo > 0 && (sv.mode === 'fight' || sv.health < 60 || escorting(sv))) {
      killChance = hasPerk(sv, 'marksman') ? 0.72 : 0.5;
      sv.ammo--;
      noise(s, ev, here, 0.6);
    } else if (sv.melee) killChance = (sv.mode === 'fight' ? 0.3 : 0.15) * (hasPerk(sv, 'breaker') ? 1.6 : 1);
    else if (sv.mode === 'fight') killChance = 0.06;
    if (rnd(s) < killChance) {
      th.size--;
      gainXp(s, sv, 4);
      if (th.size <= 0) {
        s.threats = s.threats.filter((t) => t !== th);
        say(s, ev, sv, line(s, sv, 'clear'));
        remember(s, sv, `A tenu tête à une meute à ${node.name}.`, 0.5);
        sv.fear = clamp(sv.fear - 10);
      } else if (rnd(s) < 0.5) say(s, ev, sv, line(s, sv, 'kill'));
    }
  }
}

function updateThreat(s: GameState, th: Threat, dt: number) {
  let goal: NodeId | null = null;
  let speed = 0.8;
  if (th.state === 'hunt') {
    const target = th.target ? survivor(s, th.target) : undefined;
    const tz = target ? zoneOf(target) : null;
    if (!target || !target.alive || tz === 'shelter' || hopsCached(zoneOf(th), tz!) > 3) {
      th.state = 'wander';
      th.target = null;
      th.timer = 10;
    } else if (target.mode === 'down') {
      th.timer -= dt;
      if (th.timer <= 0) {
        th.state = 'wander';
        th.target = null;
        th.timer = 20;
      }
    } else {
      goal = tz;
      speed = 1.25;
      // Lose the trail when the prey stays out of reach.
      if (hopsCached(zoneOf(th), tz!) >= 2) {
        th.timer += dt;
        if (th.timer > 9) {
          th.state = 'wander';
          th.target = null;
          th.timer = 12;
          return;
        }
      } else th.timer = 0;
    }
  } else if (th.state === 'lured') {
    goal = th.goal;
    speed = 1.2;
    if (!th.to && th.at === goal) {
      th.timer -= dt;
      if (th.timer <= 0) {
        th.state = 'wander';
        th.goal = null;
        th.timer = 20;
      }
      return;
    }
  } else if (th.state === 'wander') {
    if (!th.to) {
      th.timer -= dt;
      if (th.timer <= 0) {
        const decoys = s.persistent.vogel === 'ally' || s.persistent.vogel === 'rescued';
        const opts = neighbors(th.at).filter((n) => n !== 'shelter' && NODE[n].kind !== 'interior' && !(n === 'gate' && s.shelter.generator >= 2) && !(n === 'lock_e' && decoys));
        if (opts.length) goal = opts[Math.floor(rnd(s) * opts.length)];
        th.timer = 18 + rnd(s) * 30;
      }
    } else goal = th.to;
  }
  if (!goal && !th.to) return;
  if (!th.to) {
    if (th.at === goal) return;
    const path = findPath(s, th.at, goal!, { safe: 0 });
    if (!path || path.length < 2 || path[1] === 'shelter') {
      if (th.state !== 'wander') {
        th.state = 'wander';
        th.timer = 15;
      }
      return;
    }
    th.to = path[1];
    th.progress = 0;
  }
  th.progress += (speed * dt) / edgeLength(th.at, th.to);
  if (th.progress >= 1) {
    th.at = th.to;
    th.to = null;
    th.progress = 0;
  }
}

// ---------------------------------------------------------------- survivor mind

function decide(s: GameState, sv: Survivor, prox: Proximity, ev: SimEvent[]) {
  const here = zoneOf(sv);
  const atShelter = !sv.to && sv.at === 'shelter';
  const timeLeft = s.duration - s.time;
  const cur = sv.mode;

  if (atShelter) {
    // Behind the fence: nothing to run from.
    if (cur !== 'idle' && cur !== 'order') setMode(s, sv, sv.order ? 'order' : 'idle');
    return;
  }

  if (cur === 'help') {
    const ally = sv.helping ? survivor(s, sv.helping) : undefined;
    if (!ally || !ally.alive) {
      sv.helping = null;
      setMode(s, sv, sv.order ? 'order' : 'home');
    }
    if (!prox.hunted) return;
  }

  // Flee / hide resolve into "resume or abort" once things have been quiet for a while.
  if (cur === 'flee' || cur === 'hide' || cur === 'fight') {
    if (prox.level < 0.2) sv.safeFor += 1;
    else sv.safeFor = 0;
    if (sv.safeFor >= (cur === 'hide' ? 5 : 6)) {
      if (sv.order && obeyScore(s, sv, sv.order) >= 0.45) {
        if (sv.order.stage === 'work') sv.order.stage = 'go';
        setMode(s, sv, 'order');
        say(s, ev, sv, line(s, sv, 'resume'));
      } else if (sv.order) {
        sv.order = null;
        shiftTrust(sv, -3);
        remember(s, sv, `A abandonné sa mission près de ${NODE[here].name}.`, -0.3, 'aborted', here);
        say(s, ev, sv, here === 'shelter' ? line(s, sv, 'home') : line(s, sv, 'abort', { node: NODE[here].name }));
        setMode(s, sv, atShelter ? 'idle' : 'hide');
        sv.safeFor = -9999; // stays put until told otherwise
      } else if (sv.safeFor >= 0) setMode(s, sv, atShelter ? 'idle' : 'home');
      return;
    }
  }

  const fear = sv.fear / 100;
  const courage = sv.courage / 100;
  const sc: Partial<Record<Mode, number>> = {};
  const obey = sv.order ? obeyScore(s, sv, sv.order) : -1;
  const holding = sv.order?.type === 'hold';

  sc.order = sv.order && !(prox.hunted && prox.level >= 1) ? obey : -1;
  if (prox.hunted) {
    sc.flee = 0.9 - courage * (armed(sv) ? 0.3 : 0.08) + fear * 0.2;
    sc.fight = prox.level >= 1 ? courage * (armed(sv) ? 0.95 : 0.4) - fear * 0.3 - (sv.health < 40 ? 0.4 : 0) - prox.here.reduce((a, t) => a + t.size, 0) * 0.04 + (sv.helping || escorting(sv) ? 0.25 : 0) : -1;
  } else {
    sc.flee = prox.level * (0.15 + fear * 0.85 - courage * 0.1);
    sc.hide = prox.level > 0 && !sv.to ? prox.level * NODE[here].cover * (0.3 + fear * 0.5) : -1;
  }
  sc.rest = sv.fatigue > 85 && prox.level === 0 && !atShelter ? 0.25 + ((sv.fatigue - 85) / 15) * 0.6 : -1;

  // An ally is down: affection and courage against fear.
  const ally = s.survivors.find(
    (a) =>
      a.alive &&
      a.mode === 'down' &&
      !a.carriedBy &&
      a.id !== sv.id &&
      hopsCached(here, zoneOf(a)) <= (sv.linked ? 4 : 1) &&
      !s.survivors.some((o) => o !== sv && o.alive && o.mode !== 'down' && o.helping === a.id),
  );
  // (during training the operator has to give the rescue order himself)
  if (ally && s.day > 0 && !sv.helping && !escorting(sv) && !(sv.order?.type === 'rescue')) {
    sc.help = 0.2 + ((sv.relations[ally.id] ?? 50) / 100) * 0.55 + courage * 0.25 - fear * 0.3;
  }

  if (!atShelter && s.flags.final !== 'leave') {
    if (!sv.order) sc.home = sv.safeFor < 0 ? -1 : 0.3 + (timeLeft < 120 ? 0.4 : 0);
    else if (timeLeft < 80 && sv.order.type !== 'retreat' && sv.order.stage !== 'return') sc.home = 0.55 + (1 - sv.trust / 100) * 0.3 + fear * 0.2;
    if (sv.safeFor < 0 && timeLeft < 100) sc.home = 0.8;
  }
  sc[cur] = (sc[cur] ?? (cur === 'idle' ? 0.05 : -1)) + 0.12; // hysteresis
  if (sc.idle === undefined) sc.idle = 0.05;

  let best: Mode = cur;
  let bestV = -Infinity;
  for (const [m, v] of Object.entries(sc) as [Mode, number][]) {
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  if (best === cur) return;
  if (s.time - sv.modeSince < 3 && !prox.hunted && cur !== 'idle') return;

  const quiet = s.time - ((s.flags['said_' + sv.id] as number) ?? -99) < 15;
  if (best === 'flee' || best === 'hide') s.flags['said_' + sv.id] = s.time;
  if (best === 'flee') {
    if (!quiet) say(s, ev, sv, line(s, sv, 'flee'), 'alert');
  }
  else if (best === 'hide' && cur === 'order' && !holding && !quiet) say(s, ev, sv, line(s, sv, 'hide'));
  else if (best === 'rest') say(s, ev, sv, line(s, sv, 'rest'));
  else if (best === 'help' && ally) {
    sv.helping = ally.id;
    say(s, ev, sv, line(s, sv, 'help_go', { ally: ally.short }));
  } else if (best === 'home' && sv.order) {
    say(s, ev, sv, line(s, sv, 'home_dusk'));
    shiftTrust(sv, -2);
    remember(s, sv, 'Est rentré·e de sa propre initiative à la tombée de la nuit.', -0.1);
    sv.order = null;
  }
  setMode(s, sv, best);
}

function fleeGoal(s: GameState, sv: Survivor, prox: Proximity): NodeId {
  const here = zoneOf(sv);
  const from = prox.node ?? here;
  let best: NodeId = 'shelter';
  let bestV = Infinity;
  const cands = new Set<NodeId>([here, ...neighbors(here)]);
  for (const n of [...cands]) for (const m of neighbors(n)) cands.add(m);
  for (const n of cands) {
    if (n === from && n !== here) continue;
    const path = findPath(s, here, n, { safe: 3, sv });
    if (!path || path.slice(1).includes(from)) continue;
    const v = hopsCached(n, 'shelter') - hopsCached(n, from) * 2.5 - NODE[n].cover + believedThreat(s, sv, n) * 2;
    if (v < bestV) {
      bestV = v;
      best = n;
    }
  }
  return best;
}

function act(s: GameState, sv: Survivor, dt: number, ev: SimEvent[], prox: Proximity | null) {
  switch (sv.mode) {
    case 'order':
      runOrder(s, sv, dt, ev);
      break;
    case 'flee': {
      const goal = s.flags['flee_' + sv.id] as NodeId | undefined;
      if (goal && moveToward(s, sv, goal, dt, 3) && goal === 'shelter') arriveHome(s, sv, ev);
      break;
    }
    case 'home':
      if (moveToward(s, sv, 'shelter', dt, 2)) arriveHome(s, sv, ev);
      break;
    case 'help': {
      const ally = sv.helping ? survivor(s, sv.helping) : undefined;
      if (!ally) break;
      if (ally.carriedBy && ally.carriedBy !== sv.id) {
        sv.helping = null;
        setMode(s, sv, sv.order ? 'order' : 'home');
      } else if (ally.carriedBy === sv.id) {
        if (moveToward(s, sv, 'shelter', dt, 2)) arriveHome(s, sv, ev);
      } else if (moveToward(s, sv, zoneOf(ally), dt, 1.5)) pickUp(s, sv, ally, ev);
      break;
    }
    default:
      settle(s, sv, dt);
  }
  void prox;
}

function vitals(s: GameState, sv: Survivor, dt: number, prox: Proximity) {
  const atShelter = !sv.to && sv.at === 'shelter';
  const moving = !!sv.to;
  if (atShelter) {
    sv.fatigue = clamp(sv.fatigue - 0.5 * dt);
    sv.fear = clamp(sv.fear - (0.5 + 0.4 * s.shelter.generator) * dt);
    sv.health = clamp(sv.health + (0.02 + 0.07 * s.shelter.infirmary * (s.persistent.inesRescued ? 1.5 : 1)) * dt);
    return;
  }
  if (moving) sv.fatigue = clamp(sv.fatigue + (sv.mode === 'flee' ? 0.3 : 0.11) * (sv.escort.patient || sv.helping ? 1.5 : 1) * dt);
  else sv.fatigue = clamp(sv.fatigue - (sv.mode === 'rest' ? 0.8 : 0.12) * dt);
  const calm = 1 - sv.courage / 200;
  let df = -0.25;
  if (prox.level > 0) df = prox.level * (prox.hunted ? 2.2 : 0.9) * calm;
  else {
    df += darkness(s) * 0.3 * calm;
    if (!sv.linked) df += 0.22 * calm;
    if (s.survivors.some((o) => o !== sv && o.alive && o.mode !== 'down' && zoneOf(o) === zoneOf(sv))) df -= 0.3;
  }
  if (df > 0 && hasPerk(sv, 'calm')) df *= 0.7;
  if (df > 0 && coverer(s, sv)) df *= 0.5;
  if (df < 0 && hasPerk(sv, 'steady')) df *= 2;
  sv.fear = clamp(sv.fear + df * dt);
  if (sv.mode === 'rest' && sv.fatigue < 55) setMode(s, sv, sv.order ? 'order' : 'home');
}

function updateLink(s: GameState, sv: Survivor, ev: SimEvent[]) {
  const sig = survivorSignal(s, sv);
  const was = sv.linked;
  sv.linked = was ? sig >= LINK_THRESHOLD - 0.02 : sig >= LINK_THRESHOLD + 0.02;
  if (sv.linked) {
    const p = survivorPos(sv);
    sv.lastReport = { x: p.x, z: p.z, node: zoneOf(sv), time: s.time, mode: sv.mode };
    if (!was) {
      ev.push({ type: 'link', survivor: sv.id, linked: true });
      syncObservations(s, sv);
      const delayed = sv.outbox.splice(0);
      if (delayed.length)
        for (const m of delayed) pushRadio(s, ev, { from: sv.id, fromName: sv.short, text: m.text, kind: 'report', delayed: true, time: m.time, signal: sig });
      else if (sv.mode !== 'down') say(s, ev, sv, line(s, sv, 'relink'));
      if (sv.pendingOrder && sv.mode !== 'down') {
        const o = sv.pendingOrder;
        sv.pendingOrder = null;
        o.issuedAt = s.time;
        deliverOrder(s, sv, o, ev);
      }
    }
  } else if (was) {
    ev.push({ type: 'link', survivor: sv.id, linked: false });
    systemMsg(s, ev, `Liaison perdue avec ${sv.short}. Dernier contact : ${nodeName(sv.lastReport.node)}.`, 'alert');
  }
}

// ---------------------------------------------------------------- step

export function step(s: GameState, dt: number, ev: SimEvent[]) {
  if (s.phase !== 'running' || s.awaiting !== null) return;
  crossEv = ev;
  const prevSecond = Math.floor(s.time);
  s.time += dt;
  const second = Math.floor(s.time) !== prevSecond;

  if (s.day === 0) tutorialScript(s, ev);
  if (!s.flags.stormWarned && s.time >= s.storm.start - 25) {
    s.flags.stormWarned = true;
    systemMsg(s, ev, 'Front orageux à l’ouest. Interférences radio attendues dans moins d’une minute.', 'alert', 'burst');
  }
  if (s.day > 0 && !s.flags.duskWarned && s.time >= s.duration - 120) {
    s.flags.duskWarned = true;
    systemMsg(s, ev, 'Deux minutes avant la nuit. Rappelez tout le monde.', 'alert');
  }
  if (s.day > 0 && !s.flags.nightPack && s.time >= s.duration * 0.7) {
    s.flags.nightPack = true;
    s.threats.push({ id: s.nextThreatId++, at: 'east_n', to: null, progress: 0, size: 3, state: 'wander', target: null, goal: null, timer: 5, seen: false });
    s.threats.push({ id: s.nextThreatId++, at: 'quay_s', to: null, progress: 0, size: 2, state: 'wander', target: null, goal: null, timer: 12, seen: false });
  }

  tickIncidents(s, ev);
  if (s.awaiting !== null) return;

  // orders planned ahead leave as soon as the survivor is free, still standing and on the air
  for (const sv of s.survivors) {
    if (!sv.nextOrder) continue;
    if (!sv.alive || sv.mode === 'down') sv.nextOrder = null;
    else if (!sv.order && sv.linked && sv.mode === 'idle') {
      const o = sv.nextOrder;
      sv.nextOrder = null;
      o.issuedAt = s.time;
      deliverOrder(s, sv, o, ev);
    }
  }

  if (second) {
    for (const th of s.threats) th.seen = false;
    tickBanter(s, ev);
    coverCallouts(s, ev);
    if (s.day > 0) tickDirector(s, ev);
    if (s.awaiting !== null) return;
  }

  for (const sv of s.survivors) {
    if (!sv.alive) continue;
    if (sv.mode === 'down') {
      if (sv.carriedBy) {
        const c = survivor(s, sv.carriedBy);
        if (c) {
          sv.at = c.at;
          sv.to = c.to;
          sv.progress = c.progress;
        }
      } else {
        sv.bleed -= dt;
        if (sv.bleed <= 0) die(s, sv, ev, `seul·e à ${NODE[sv.at].name}`);
      }
      if (second && sv.alive) updateLink(s, sv, ev);
      continue;
    }
    if (second) {
      updateLink(s, sv, ev);
      perceive(s, sv);
      const prox = proximity(s, sv);
      vitals(s, sv, 1, prox);
      encounter(s, sv, prox, ev);
      if ((sv.mode as Mode) === 'down') continue;
      decide(s, sv, prox, ev);
      if (sv.mode === 'flee') s.flags['flee_' + sv.id] = fleeGoal(s, sv, prox);
    }
    if (!sv.to) onArrive(s, sv, ev);
    if (s.awaiting !== null) return;
    act(s, sv, dt, ev, null);
    if (s.awaiting !== null) return;
  }

  for (const th of [...s.threats]) updateThreat(s, th, dt);

  if (s.flags.final === 'leave') {
    const at = s.flags.boatAt as number;
    if (!s.flags.boatWarned && s.time >= at - 110) {
      s.flags.boatWarned = true;
      systemMsg(s, ev, 'Le bateau est en vue de l’écluse. Départ dans moins de deux minutes.', 'alert');
    }
    if (s.time >= at) return endDay(s, ev);
  }
  if (s.time >= s.duration) endDay(s, ev);
}

// ---------------------------------------------------------------- end of day

/** Day 0: the one scripted beat of the training. Once the first two exercises are done, someone outside goes down. */
function tutorialScript(s: GameState, ev: SimEvent[]) {
  if (s.flags.tut_fall || !s.flags.scouted_cross_w || s.delivered.supplies < 1) return;
  s.flags.tut_fall = true;
  const victim = s.survivors.find((v) => v.id === 'lena' && v.alive && zoneOf(v) !== 'shelter') ?? s.survivors.find((v) => v.alive && v.mode !== 'down' && zoneOf(v) !== 'shelter');
  if (!victim) {
    s.flags.tut_rescued = true;
    systemMsg(s, ev, 'Tout le monde est à l’abri : pas de blessé à ramener aujourd’hui. Tant mieux.');
    return;
  }
  s.flags.tut_victim = victim.id;
  say(s, ev, victim, victim.id === 'jo' ? 'Merde— ma cheville. La plaque d’égout a cédé. Je peux plus poser le pied.' : 'Aïe ! Ma cheville— je suis tombée. Je peux pas me relever. Je suis désolée.', 'alert', 'rescue');
  setMode(s, victim, 'down');
  victim.health = 22;
  victim.bleed = 99999;
  victim.order = null;
  victim.at = zoneOf(victim);
  victim.to = null;
  victim.progress = 0;
  systemMsg(s, ev, `${victim.short} est à terre. Balise active : ${nodeName(victim.at)}.`, 'alert');
}

export function canEndDay(s: GameState): boolean {
  if (s.phase !== 'running') return false;
  if (s.flags.final === 'leave') return s.survivors.some((v) => v.alive) && s.survivors.every((v) => !v.alive || (!v.to && v.at === 'lock_e'));
  return s.survivors.every((v) => !v.alive || (!v.to && v.at === 'shelter'));
}

export function endDay(s: GameState, ev: SimEvent[]) {
  if (s.phase !== 'running') return;
  s.awaiting = null;
  const obj = objectiveStatus(s);
  const title = mission(s).title;
  const nightNotes: string[] = [];
  const leaving = s.flags.final === 'leave';
  for (const sv of s.survivors) {
    if (!sv.alive) continue;
    if (leaving && zoneOf(sv) === 'lock_e' && (sv.mode !== 'down' || sv.carriedBy)) {
      s.persistent['evac_' + sv.id] = true;
      nightNotes.push(`${sv.short} est à bord.`);
      for (const [flag, name] of [['ines', 'Inès Duval'], ['patient', 'le patient de Saint-Roch'], ['sacha', 'Sacha et sa fille'], ['vogel', 'Elias Vogel']] as const)
        if (sv.escort[flag]) s.rescued.push(name);
      continue;
    }
    if (!leaving && !sv.to && sv.at === 'shelter') continue;
    if (leaving && !sv.to && sv.at === 'shelter') {
      nightNotes.push(`${sv.short} a regardé partir le bateau depuis le toit d’ECHO-7.`);
      continue;
    }
    const d = hopsCached(zoneOf(sv), 'shelter');
    let p = 0.78 - d * 0.07 + sv.health / 400 - sv.fatigue / 500 + s.shelter.generator * 0.05;
    if (sv.mode === 'down') p -= 0.5;
    p = Math.min(0.92, Math.max(0.05, p));
    if (rnd(s) < p) {
      sv.health = clamp(sv.health - 25, 8, 100);
      sv.fear = clamp(sv.fear + 30);
      shiftTrust(sv, -10);
      remember(s, sv, 'A passé une nuit dehors, sans abri ni radio.', -0.8);
      nightNotes.push(`${sv.short} a passé la nuit dehors et est rentré·e à l’aube, épuisé·e.`);
      // What they carried comes home with them.
      for (const k of ['supplies', 'medicine', 'parts'] as const) {
        const put = Math.min(storageCap(s) - s.resources[k], sv.carrying[k]);
        s.resources[k] += Math.max(0, put);
        s.delivered[k] += Math.max(0, put);
      }
      for (const [flag, name] of [['ines', 'Inès Duval'], ['patient', 'le patient de Saint-Roch'], ['sacha', 'Sacha et sa fille'], ['vogel', 'Elias Vogel'], ['stranger', 'Un rescapé du quartier']] as const)
        if (sv.escort[flag]) {
          s.rescued.push(name);
          s.rescuedToday.push(name);
          if (flag === 'ines') {
            s.persistent.inesRescued = true;
            s.persistent.inesLeft = false;
          }
          if (flag === 'sacha') s.persistent.sachaRescued = true;
          if (flag === 'vogel') s.persistent.vogel = 'rescued';
        }
    } else {
      sv.alive = false;
      sv.missing = true;
      if (sv.escort.vogel) s.persistent.vogel = 'lost';
      s.flags['dead_' + sv.id] = 'dans la nuit';
      s.unresolved.push(`La balise de ${sv.short} a émis jusqu’à 3 h du matin, près de ${NODE[zoneOf(sv)].name}.`);
      for (const o of s.survivors)
        if (o.alive) {
          shiftTrust(o, -8);
          remember(s, o, `${sv.short} n’est pas rentré·e. L’opérateur l’avait laissé·e dehors.`, -0.9);
        }
    }
  }
  if (s.flags.unknownState === 'answered') s.unresolved.push('Tanneurs : vous avez promis d’envoyer quelqu’un. Personne n’est venu.');
  if (s.flags.unknownState === 'proof' || s.incidents.unknown.state === 'active') s.unresolved.push('Immeuble des Tanneurs : un appel resté sans réponse.');
  if (s.day >= LAST_DAY && s.flags.final === 'stay' && obj.done) s.persistent.finalDone = true;
  // experience: everyone alive learns from the day, more if it went well
  const xp: Record<string, number> = {};
  const levelUps: string[] = [];
  for (const sv of s.survivors) {
    if (!sv.alive) continue;
    gainXp(s, sv, 8 + (obj.done ? 15 : 0));
    xp[sv.id] = (s.flags['xp_' + sv.id] as number) ?? 0;
    if (levelUp(sv) > 0) levelUps.push(`${sv.short} passe niveau ${sv.level}`);
    for (const type of ['scout', 'retrieve', 'hold', 'rescue']) if (s.flags['apt_' + sv.id + '_' + type]) levelUps.push(`${sv.short} progresse en « ${ORDER_LABEL[type]} » (${sv.skill[type]}/5)`);
    if (sv.order?.type === 'hold' || s.flags['held_' + sv.id]) practise(s, sv, 'hold');
  }
  buildDebrief(s, nightNotes, obj, title);
  s.debrief!.xp = xp;
  s.debrief!.levelUps = levelUps;
  s.phase = 'debrief';
  ev.push({ type: 'phase' });
}

function buildDebrief(s: GameState, notes: string[], obj: ObjectiveStatus, title: string) {
  const deaths = s.survivors.filter((v) => s.flags['dead_' + v.id]).map((v) => `${v.name} — ${v.missing ? 'porté·e disparu·e' : 'mort·e'} ${s.flags['dead_' + v.id]}`);
  const c: string[] = [...notes];
  const med = s.delivered.medicine;
  const o = objective(s);
  if (o.kind === 'tutorial') {
    c.push(obj.done ? 'Formation terminée. Mara dit que vous écoutez mieux que Vogel. Ce n’est pas un compliment, c’est un constat.' : 'La formation n’est pas terminée. Demain, ce ne sera plus un exercice.');
  } else if (s.day === 1) {
    if (med >= 2) c.push(`L’infirmerie tient : ${med} doses rapportées.`);
    else {
      c.push(med === 1 ? 'Une seule dose rapportée. Pas assez pour tout le monde.' : 'Aucun médicament rapporté. Les blessés vont s’affaiblir.');
      s.persistent.noMedicine = true;
    }
  } else if (o.kind === 'deliver') {
    if (obj.done) c.push(o.res === 'parts' ? (s.day >= LAST_DAY ? 'L’amplificateur est réparé. ECHO-7 porte plus loin que jamais.' : 'Le générateur tourne rond. L’antenne tiendra.') : 'Il y a de quoi manger pour quelques jours.');
    else c.push(o.res === 'parts' ? 'Pas assez de pièces. Le générateur tiendra à la ficelle.' : 'Pas assez de rations. La nuit sera longue, et la suivante aussi.');
  } else if (o.kind === 'scout') {
    c.push(obj.done ? 'Vous savez enfin qui parlait dans la boucle.' : 'L’émetteur n’a pas été trouvé. La boucle reprendra cette nuit.');
  } else {
    c.push(obj.done ? 'Tout le monde est à bord. ECHO-7 se tait.' : 'Le bateau est parti sans tout le monde.');
  }
  const lb = s.incidents.logbook;
  if (lb.choice === 'truth') c.push('Jo sait ce que Vogel a ordonné au convoi de son frère.');
  if (lb.choice === 'lied') c.push('Jo croit que son frère est mort en couvrant les autres. C’est vous qui le lui avez dit.');
  if (lb.choice === 'hidden') c.push('Le carnet du convoi a brûlé. Quelqu’un dans l’équipe sait pourquoi.');
  const vg = s.incidents.vogel;
  if (vg.choice === 'bring') c.push(s.persistent.vogel === 'rescued' ? 'Elias Vogel dort à ECHO-7, pour la première fois depuis des semaines.' : 'Vogel n’est pas arrivé jusqu’à l’abri.');
  if (vg.choice === 'leave') c.push('Vogel reste à l’écluse. Ses leurres continuent d’éloigner les meutes du canal.');
  if (vg.choice === 'take') c.push('Les leurres de l’écluse se sont tus. Le canal ne sera plus aussi calme.');
  if (s.persistent.joKnows && vg.state === 'resolved' && s.day === 3) c.push('Vogel a parlé. Jo sait que vous lui avez menti.');
  if (s.incidents.boat.choice === 'open') c.push('Toute la ville sait pour le bateau. Les vivants, et ce qui suit le bruit.');
  if (s.incidents.boat.choice === 'quiet') c.push('Le bateau reste votre secret. Douze places.');
  if (s.flags.flareUsed) c.push('La fusée a vidé le checkpoint, et réveillé les entrepôts. Il n’en reste plus.');
  const h = s.incidents.hospital;
  if (h.state === 'resolved' && h.choice === 'all' && s.persistent.patientRescued) c.push('Tout le monde est sorti de Saint-Roch. Le patient vivra.');
  if (s.rescuedToday.includes('Inès Duval')) c.push('Inès Duval rejoint l’infirmerie : les soins à l’abri seront plus efficaces.');
  if (h.choice === 'ines' && s.persistent.patientLeft && !s.persistent.patientRescued) c.push('Un homme est resté seul à Saint-Roch avec une radio.');
  if (h.choice === 'meds') c.push('Inès Duval est restée à Saint-Roch. Elle sait que vous avez choisi.');
  if (s.flags.unknownOutcome === 'rescued') c.push('Le signal des Tanneurs était vrai. Sacha a apporté une pièce de générateur.');
  if (s.flags.unknownOutcome === 'lure') c.push('Le signal des Tanneurs était un leurre posé par quelqu’un.');
  if (((s.flags.syncBest as number) ?? 0) >= 3) c.push(`Synchro ×${s.flags.syncBest} : ceux qui avançaient l’ont fait sous le regard d’un autre. Ça se sent dans l’équipe.`);
  if (s.flags.overflow) c.push('La réserve était pleine : une partie du butin est restée dans la cour, sous la pluie.');
  for (const sv of s.survivors) {
    if (!sv.alive) continue;
    if (sv.trust < 30) c.push(`${sv.short} ne vous fait plus confiance (${Math.round(sv.trust)}). Ses refus seront plus fréquents.`);
    else if (sv.trust > 80) c.push(`${sv.short} vous suivrait n’importe où (${Math.round(sv.trust)}).`);
  }
  const alive = s.survivors.filter((v) => v.alive).length;
  const partial = o.kind === 'tutorial' ? true : o.kind === 'deliver' ? s.delivered[o.res] >= 1 : o.kind === 'scout' ? !!s.flags.vogelLocated : s.survivors.some((v) => s.persistent['evac_' + v.id]);
  const rating = alive === 0 ? 'echec' : obj.done && deaths.length === 0 ? 'succes' : obj.done || (deaths.length === 0 && partial) ? 'mitige' : 'echec';
  void title;
  const headline =
    alive === 0
      ? 'ECHO-7 n’émet plus.'
      : rating === 'succes'
        ? s.flags.final === 'leave'
          ? 'Tout le monde est à bord.'
          : 'Tout le monde est rentré. Objectif atteint.'
        : rating === 'mitige'
          ? 'ECHO-7 tient encore. À quel prix.'
          : 'Une journée de plus, et moins de voix sur la fréquence.';
  s.debrief = {
    day: s.day,
    rating,
    headline,
    deaths,
    rescues: [...s.rescuedToday],
    gained: { ...s.delivered },
    consequences: c,
    unresolved: [...new Set(s.unresolved)],
    xp: {},
    levelUps: [],
  };
}

/** Night passes; persistent outcomes carry over into the next mission. */
export function nextDay(s: GameState, ev: SimEvent[]) {
  const alive = s.survivors.filter((v) => v.alive);
  if (s.day >= LAST_DAY) {
    s.ending = buildEnding(s);
    s.phase = 'ending';
    ev.push({ type: 'phase' });
    return;
  }
  if (!alive.length) {
    s.phase = 'gameover';
    return;
  }
  if (s.day === 0) {
    // the training costs nothing: everyone starts the real first day fresh
    for (const sv of alive) {
      sv.health = 100;
      sv.fatigue = 8;
      sv.fear = sv.id === 'lena' ? 25 : 15;
    }
    s.day = 1;
    setupDay(s, ev);
    ev.push({ type: 'phase' });
    return;
  }
  for (const sv of alive) {
    if (s.resources.supplies > 0) s.resources.supplies--;
    else {
      sv.health = clamp(sv.health - 12, 5, 100);
      shiftTrust(sv, -6);
      remember(s, sv, 'Une nuit le ventre vide.', -0.4);
    }
    const heal = 12 + 22 * s.shelter.infirmary + (s.persistent.inesRescued ? 10 : 0) - (s.persistent.noMedicine ? 14 : 0);
    sv.health = clamp(sv.health + heal, 5, 100);
    sv.fatigue = 8;
    sv.fear = clamp(sv.fear * 0.45);
    if (sv.ammo === 0 && sv.equipment.includes('Pistolet') && rnd(s) < 0.5) sv.ammo = 1;
  }
  s.persistent.noMedicine = false;
  s.resources.medicine = Math.max(0, s.resources.medicine - 1);
  s.day++;
  setupDay(s, ev);
  ev.push({ type: 'phase' });
}

export { resolveChoice } from './incidents';
export { stormLevel };

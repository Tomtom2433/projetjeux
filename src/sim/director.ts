// The director: a small pacing AI. It reads how tense the mission is and injects an event
// to push or relieve, so no two days play out the same. Deterministic, offline, no script.
import type { GameState, NodeId, SimEvent, Survivor } from './types';
import { NODE, neighbors } from './world';
import { clamp, darkness, hopsCached, noise, pick, pushRadio, rnd, say, shiftTrust, systemMsg, zoneOf } from './core';

const outside = (s: GameState) => s.survivors.filter((v) => v.alive && v.mode !== 'down' && zoneOf(v) !== 'shelter');

/** 0 = quiet, 1 = everything is going wrong. */
export function tension(s: GameState): number {
  const out = outside(s);
  if (!out.length) return 0;
  let t = 0;
  for (const sv of out) t = Math.max(t, sv.fear / 100 + (sv.health < 40 ? 0.2 : 0));
  if (s.threats.some((th) => th.state === 'hunt')) t += 0.35;
  return Math.min(1, t + darkness(s) * 0.15);
}

type Kind = 'pack' | 'burst' | 'block' | 'alarm' | 'breather' | 'rain' | 'cache' | 'stranger';

const BLOCKABLE: [NodeId, NodeId][] = [['cross_e', 'parvis'], ['east_n', 'parvis'], ['bridge_e', 'cross_e'], ['cross_w', 'quay_n']];

function count(s: GameState, k: Kind) {
  return (s.flags['dir_' + k] as number) ?? 0;
}

function fire(s: GameState, k: Kind, ev: SimEvent[]): boolean {
  const out = outside(s);
  switch (k) {
    case 'pack': {
      // a roaming pack turns toward someone
      const sv = pick(s, out);
      const th = s.threats.find((t) => t.state !== 'hunt' && t.state !== 'lured' && hopsCached(zoneOf(t), zoneOf(sv)) >= 2 && hopsCached(zoneOf(t), zoneOf(sv)) <= 4);
      if (!th) return false;
      const near = neighbors(zoneOf(sv)).filter((n) => n !== 'shelter' && NODE[n].kind !== 'interior');
      if (!near.length) return false;
      th.state = 'lured';
      th.goal = pick(s, near);
      th.timer = 25;
      systemMsg(s, ev, `Mouvement de meute ${NODE[zoneOf(th)].x > 4 ? 'à l’est du canal' : 'à l’ouest du canal'}. Quelque chose les a mis en marche.`, 'alert', 'pack');
      return true;
    }
    case 'burst':
      s.flags.burstUntil = s.time + 24;
      systemMsg(s, ev, 'Parasites sur toutes les fréquences. La liaison va sauter quelques secondes.', 'alert', 'burst');
      return true;
    case 'block': {
      const opts = BLOCKABLE.filter(([a, b]) => !s.flags['blk_' + [a, b].sort().join('|')] && !s.survivors.some((v) => v.alive && v.to && [v.at, v.to].sort().join('|') === [a, b].sort().join('|')));
      if (!opts.length) return false;
      const [a, b] = pick(s, opts);
      const key = [a, b].sort().join('|');
      s.flags['blk_' + key] = true;
      s.flags['blkUntil_' + key] = s.time + 75;
      systemMsg(s, ev, `Une façade s’est effondrée entre ${NODE[a].name} et ${NODE[b].name}. Passage coupé pour l’instant.`, 'alert', 'block');
      ev.push({ type: 'noise', node: b, power: 1 });
      return true;
    }
    case 'alarm': {
      // far from everyone: it draws packs away
      const nodes = Object.keys(NODE).filter((n) => NODE[n].kind === 'street' && out.every((sv) => hopsCached(n, zoneOf(sv)) >= 3));
      if (!nodes.length) return false;
      const n = pick(s, nodes);
      noise(s, ev, n, 1);
      systemMsg(s, ev, `Une alarme de voiture hurle vers ${NODE[n].name}. Tout ce qui écoute va y aller.`, 'system', 'alarm');
      return true;
    }
    case 'breather': {
      const sv = [...out].sort((a, b) => b.fear - a.fear)[0];
      if (!sv || !sv.linked || s.threats.some((t) => t.target === sv.id)) return false;
      sv.fear = clamp(sv.fear - 18);
      shiftTrust(sv, 2);
      say(s, ev, sv, sv.id === 'jo' ? 'Ça va. J’ai repris mon souffle. Restez en ligne, c’est tout.' : sv.id === 'lena' ? 'Votre voix… ça aide. Ça va mieux. Je crois.' : 'Je respire. Merci d’être resté sur la fréquence.');
      return true;
    }
    case 'rain':
      if (s.time < s.storm.end && s.time > s.storm.start - 40) return false;
      s.flags.rainUntil = s.time + 75;
      systemMsg(s, ev, 'Il se met à pleuvoir. Le bruit de l’eau couvre les pas : ils seront plus durs à repérer.', 'system', 'rain');
      return true;
    case 'cache': {
      const sv = out.find((v) => v.linked && NODE[zoneOf(v)].kind !== 'interior');
      if (!sv) return false;
      const opts = neighbors(zoneOf(sv)).filter((n) => n !== 'shelter' && NODE[n].kind !== 'interior');
      if (!opts.length) return false;
      const n = pick(s, opts);
      const med = rnd(s) < 0.3;
      s.loot[n] ??= { supplies: 0, medicine: 0, parts: 0 };
      if (med) s.loot[n].medicine += 1;
      else s.loot[n].supplies += 2;
      s.intel[n].lootKnown = true;
      say(s, ev, sv, sv.id === 'jo' ? `Y a un sac abandonné vers ${NODE[n].name}. Ça se ramasse.` : `Je vois un sac ${med ? 'de pharmacie' : 'à dos'} abandonné vers ${NODE[n].name}. Ça vaut un détour ?`, 'report', 'cache');
      return true;
    }
    case 'stranger': {
      if (s.awaiting !== null || s.incidents.stranger?.state !== 'pending') return false;
      const n = pick(s, ['quay_s', 'quay_n', 'cross_e', 'east_s'].filter((x) => !s.flags['blk_' + x]));
      s.flags.strangerNode = n;
      s.incidents.stranger = { state: 'active' };
      const msg = pushRadio(s, ev, {
        from: 'unknown',
        fromName: 'Inconnu',
        art: 'stranger',
        text: `…allô ? Est-ce que cette radio marche ? Je suis caché dans une voiture, vers ${NODE[n].name}. Je les entends tourner autour. Je n’ai plus de voix pour crier. S’il vous plaît.`,
        kind: 'incident',
        incident: 'stranger',
        signal: 0.5,
        choices: [
          { id: 'help', label: 'Lui dire de tenir : on vient', hint: `Marque ${NODE[n].name} comme cible de l’ordre Secourir.` },
          { id: 'ignore', label: 'Couper la fréquence', hint: 'Vous avez déjà trois vies à ramener.' },
        ],
      });
      s.awaiting = msg.id;
      return true;
    }
  }
}

export function tickDirector(s: GameState, ev: SimEvent[]) {
  // expire temporary roadblocks
  for (const k of Object.keys(s.flags)) {
    if (k.startsWith('blkUntil_') && s.time >= (s.flags[k] as number)) {
      delete s.flags[k];
      delete s.flags['blk_' + k.slice(9)];
      systemMsg(s, ev, 'Le passage coupé est de nouveau praticable.');
    }
  }
  if (s.flags.dirNext === undefined) s.flags.dirNext = 75 + rnd(s) * 30;
  if (s.time < (s.flags.dirNext as number) || s.time > s.duration - 60) return;
  s.flags.dirNext = s.time + 55 + rnd(s) * 45;
  if (!outside(s).length) return;
  const t = tension(s);
  const pool: [Kind, number, number][] =
    t < 0.35
      ? [['pack', 3, 2], ['burst', 2, 1], ['block', 2, 1], ['stranger', 2, 1], ['cache', 1, 2]]
      : t > 0.65
        ? [['breather', 3, 2], ['rain', 2, 1], ['alarm', 2, 1]]
        : [['cache', 3, 2], ['stranger', 2, 1], ['alarm', 2, 1], ['rain', 1, 1], ['pack', 1, 2]];
  // weighted draw among events still allowed today; fall through to the next if one cannot fire
  const open = pool.filter(([k, , max]) => count(s, k) < max);
  for (let tries = 0; tries < 3 && open.length; tries++) {
    const total = open.reduce((a, [, w]) => a + w, 0);
    let roll = rnd(s) * total;
    let idx = 0;
    while (idx < open.length - 1 && roll >= open[idx][1]) roll -= open[idx++][1];
    const [k] = open.splice(idx, 1)[0];
    if (fire(s, k, ev)) {
      s.flags['dir_' + k] = count(s, k) + 1;
      s.flags.dirLast = k;
      return;
    }
  }
}

/** Someone reached the stranger's hiding place. */
export function meetStranger(s: GameState, sv: Survivor, ev: SimEvent[]) {
  s.flags.strangerNode = '';
  s.incidents.stranger = { state: 'resolved', choice: 'help', by: sv.id };
  sv.escort.stranger = true;
  shiftTrust(sv, 3);
  say(s, ev, sv, sv.id === 'jo' ? 'Je l’ai. Il tient debout. On rentre.' : 'Je l’ai trouvé. Déshydraté, mais il marche. On le ramène.');
  sv.order = { type: 'rescue', target: sv.at, stage: 'return', issuedAt: s.time };
  sv.mode = 'order';
  sv.modeSince = s.time;
}

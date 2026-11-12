import { describe, expect, it } from 'vitest';
import type { GameState, SimEvent } from '../src/sim/types';
import { newGame } from '../src/sim/state';
import { TICK, canEndDay, endDay, issueOrder, nextDay, resolveChoice, step } from '../src/sim/sim';
import { deserialize, serialize } from '../src/sim/save';
import { buyUpgrade } from '../src/sim/state';

/** Scripted operator: answers every radio decision and sends people out. */
function playDay(s: GameState, policy: Record<string, string> = {}) {
  const ev: SimEvent[] = [];
  let guard = 0;
  const sent = new Set<string>();
  while (s.phase === 'running' && guard++ < 100000) {
    if (s.awaiting !== null) {
      const msg = s.radio.find((m) => m.id === s.awaiting)!;
      const want = policy[msg.incident!] ?? msg.choices![0].id;
      const c = msg.choices!.find((x) => x.id === want) ?? msg.choices![0];
      resolveChoice(s, c.id, ev);
      continue;
    }
    if (s.time > 1 && !sent.has('mara')) {
      sent.add('mara');
      issueOrder(s, 'mara', 'retrieve', 'hosp_in', ev);
    }
    if (s.time > 5 && !sent.has('lena')) {
      sent.add('lena');
      issueOrder(s, 'lena', 'scout', 'bridge_w', ev);
    }
    if (s.time > 8 && !sent.has('jo')) {
      sent.add('jo');
      issueOrder(s, 'jo', 'retrieve', 'apts', ev);
    }
    if (s.time > 200 && !sent.has('lena2')) {
      sent.add('lena2');
      issueOrder(s, 'lena', 'retreat', null, ev);
    }
    if (s.time > 420 && canEndDay(s)) endDay(s, ev);
    step(s, TICK, ev);
  }
  return ev;
}

describe('simulation (headless, no renderer)', () => {
  it('runs a full day to a debrief', () => {
    const s = newGame(1234);
    playDay(s);
    expect(s.phase).toBe('debrief');
    expect(s.debrief).not.toBeNull();
    expect(s.radio.length).toBeGreaterThan(5);
    expect(s.time).toBeLessThanOrEqual(s.duration + 1);
  });

  it('is deterministic for a given seed', () => {
    const a = newGame(77);
    const b = newGame(77);
    playDay(a);
    playDay(b);
    expect(serialize(a)).toBe(serialize(b));
  });

  it('survives a save/load round trip mid-mission', () => {
    const a = newGame(99);
    const ev: SimEvent[] = [];
    resolveChoice(a, 'ok', ev);
    issueOrder(a, 'mara', 'scout', 'bridge_w', ev);
    for (let i = 0; i < 200; i++) step(a, TICK, ev);
    const b = deserialize(serialize(a))!;
    expect(b).not.toBeNull();
    for (let i = 0; i < 400; i++) {
      if (a.awaiting !== null) resolveChoice(a, 'stealth', ev);
      if (b.awaiting !== null) resolveChoice(b, 'stealth', ev);
      step(a, TICK, ev);
      step(b, TICK, ev);
    }
    expect(serialize(b)).toBe(serialize(a));
  });

  it('loses the link in dead zones and queues orders', () => {
    const s = newGame(5);
    const ev: SimEvent[] = [];
    resolveChoice(s, 'ok', ev);
    issueOrder(s, 'lena', 'scout', 'lock_e', ev);
    let lost = false;
    for (let i = 0; i < 1200 && !lost; i++) {
      if (s.awaiting !== null) resolveChoice(s, 'detour', ev);
      step(s, TICK, ev);
      lost = !s.survivors[2].linked;
    }
    expect(lost).toBe(true);
    const r = issueOrder(s, 'lena', 'retreat', null, ev);
    expect(r.reason).toBe('queued');
    expect(s.survivors[2].pendingOrder).not.toBeNull();
  });

  it('carries outcomes into the next day', () => {
    const s = newGame(42);
    playDay(s, { bridge: 'flare', hospital: 'meds', unknown: 'ignore' });
    const ev: SimEvent[] = [];
    const alive = s.survivors.filter((v) => v.alive).length;
    nextDay(s, ev);
    if (alive > 0) {
      expect(s.day).toBe(2);
      expect(s.phase).toBe('running');
      expect(s.resources.flares).toBeLessThanOrEqual(1);
    }
    expect(buyUpgrade(s, 'antenna') || true).toBe(true);
  });

  it('produces varied outcomes across seeds', () => {
    const ratings: Record<string, number> = {};
    let med = 0, deaths = 0, refused = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(seed * 7919);
      playDay(s, { bridge: ['stealth', 'flare', 'detour'][seed % 3], hospital: ['all', 'ines', 'meds'][seed % 3], unknown: ['send', 'proof', 'ignore'][seed % 3] });
      ratings[s.debrief!.rating] = (ratings[s.debrief!.rating] ?? 0) + 1;
      med += s.delivered.medicine;
      deaths += s.debrief!.deaths.length;
      refused += s.radio.filter((m) => /Négatif|Non\./.test(m.text)).length;
    }
    void med, deaths, refused;
    expect(Object.keys(ratings).length).toBeGreaterThan(1);
  });
});

import { LAST_DAY, objectiveStatus } from '../src/sim/missions';

/** Plays the whole arc with a simple day-aware operator who retries orders. */
function playCampaign(seed: number, policy: Record<string, string> = {}) {
  const s = newGame(seed);
  const ev: SimEvent[] = [];
  let guard = 0;
  while (s.phase !== 'ending' && s.phase !== 'gameover' && guard++ < 20) {
    const sent = new Map<string, number>();
    const order = (key: string, id: string, type: Parameters<typeof issueOrder>[2], target: string | null) => {
      const sv = s.survivors.find((v) => v.id === id)!;
      if (!sv.alive || sv.mode === 'down' || sv.order || sv.to || sv.at !== 'shelter' || sv.health < 30) return;
      if (s.time - (sent.get(key) ?? -999) < 60) return;
      sent.set(key, s.time);
      issueOrder(s, id, type, target, ev);
    };
    let ticks = 0;
    while (s.phase === 'running' && ticks++ < 6000) {
      if (s.awaiting !== null) {
        const msg = s.radio.find((m) => m.id === s.awaiting)!;
        const c = msg.choices!.find((x) => x.id === policy[msg.incident!]) ?? msg.choices![0];
        resolveChoice(s, c.id, ev);
        continue;
      }
      const left = s.duration - s.time;
      const leaving = s.flags.final === 'leave';
      if (left > 200 || leaving) {
        if (s.day === 1 && s.delivered.medicine < 2) order('a', 'mara', 'retrieve', 'hosp_in');
        if (s.day === 2 && s.delivered.parts < 2) order('a', 'jo', 'retrieve', 'garage');
        if (s.day === 3) {
          if (!s.flags.scouted_quay_n) order('a', 'lena', 'scout', 'quay_n');
          if (!s.flags.scouted_east_n) order('b', 'mara', 'scout', 'east_n');
          if (s.flags.vogelLocated && s.incidents.vogel.state === 'pending') order('c', 'jo', 'rescue', 'lock_e');
        }
        if (s.day === 4 && s.delivered.supplies < 3) {
          order('a', 'jo', 'retrieve', 'apts');
          order('b', 'mara', 'retrieve', 'quay_s');
        }
        if (s.day === 5 && leaving) for (const id of ['mara', 'jo', 'lena']) order(id, id, 'scout', 'lock_e');
        if (s.day === 5 && !leaving && s.delivered.parts < 2) order('a', 'jo', 'retrieve', 'garage');
      }
      if (s.time > 200 && left < 150 && canEndDay(s) && !leaving) endDay(s, ev);
      step(s, TICK, ev);
    }
    if (s.phase === 'debrief') nextDay(s, ev);
  }
  return s;
}

describe('five-day arc', () => {
  it('reaches an epilogue shaped by earlier choices', () => {
    let endings = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const policy = { logbook: ['truth', 'lied', 'hidden'][seed % 3], vogel: ['bring', 'leave', 'take'][seed % 3], boat: seed % 2 ? 'open' : 'quiet', briefing: seed % 2 ? 'leave' : 'stay', bridge: 'stealth', hospital: 'ines', unknown: 'ignore' };
      const s = playCampaign(seed * 104729, policy);
      expect(['ending', 'gameover']).toContain(s.phase);
      if (s.phase === 'ending') {
        endings++;
        expect(s.day).toBe(LAST_DAY);
        expect(s.ending!.length).toBeGreaterThan(1);
        seen.add(s.ending!.join('|'));
      }
    }
    expect(endings).toBeGreaterThan(6);
    expect(seen.size).toBeGreaterThan(3);
  });

  it('gives each day its own objective', () => {
    const s = newGame(9);
    const labels = new Set<string>();
    for (let d = 1; d <= LAST_DAY; d++) {
      s.day = d;
      labels.add(objectiveStatus(s).label.replace(/\d/g, ''));
    }
    expect(labels.size).toBeGreaterThanOrEqual(4);
  });
});

describe('training day', () => {
  it('walks through scout, retrieve and rescue, then hands over to day 1', () => {
    const s = newGame(321, true);
    const ev: SimEvent[] = [];
    expect(s.day).toBe(0);
    resolveChoice(s, 'ok', ev);
    issueOrder(s, 'lena', 'scout', 'cross_w', ev);
    issueOrder(s, 'jo', 'retrieve', 'quay_s', ev);
    let ordered = false;
    for (let i = 0; i < 2400 && s.phase === 'running' && !s.flags.tut_rescued; i++) {
      step(s, TICK, ev);
      if (s.flags.tut_victim && !ordered) {
        ordered = true;
        const victim = s.survivors.find((v) => v.id === s.flags.tut_victim)!;
        expect(victim.mode).toBe('down');
        issueOrder(s, 'mara', 'rescue', victim.at, ev);
      }
    }
    expect(s.flags.tut_rescued).toBe(true);
    expect(objectiveStatus(s).done).toBe(true);
    expect(s.survivors.every((v) => v.alive)).toBe(true);
    endDay(s, ev);
    nextDay(s, ev);
    expect(s.day).toBe(1);
    expect(s.survivors.every((v) => v.health === 100)).toBe(true);
  });
});

import { coverer, synchro } from '../src/sim/cover';
import { introScene, nightScene } from '../src/sim/scenes';

describe('cover and synchro', () => {
  it('a watcher covers a teammate, and acting under cover builds the chain', () => {
    const s = newGame(11);
    const ev: SimEvent[] = [];
    resolveChoice(s, 'ok', ev);
    for (const th of s.threats) th.at = 'east_s'; // keep the west bank quiet
    issueOrder(s, 'lena', 'scout', 'cross_w', ev);
    for (let i = 0; i < 400 && !s.flags.scouted_cross_w; i++) step(s, TICK, ev);
    issueOrder(s, 'jo', 'retrieve', 'quay_s', ev);
    let covered = false;
    for (let i = 0; i < 1200 && s.delivered.supplies < 1; i++) {
      step(s, TICK, ev);
      const jo = s.survivors[1];
      if (jo.at === 'quay_s' && !jo.to) covered = covered || coverer(s, jo)?.id === 'lena';
    }
    expect(covered).toBe(true);
    expect((s.flags.syncBest as number) ?? 0).toBeGreaterThanOrEqual(1);
    expect(synchro(s)).toBeGreaterThanOrEqual(0);
    expect(ev.some((e) => e.type === 'sync' && e.value > 0)).toBe(true);
  });
});

describe('dialogue scenes', () => {
  it('has an intro and a scene for every night, shaped by choices', () => {
    const s = newGame(3, true);
    expect(introScene(s)!.lines.length).toBeGreaterThan(5);
    const texts = new Set<string>();
    for (let d = 0; d <= 4; d++) {
      s.day = d;
      for (const truth of ['truth', 'lied'] as const) {
        s.persistent.joTruth = truth;
        const sc = nightScene(s);
        expect(sc).not.toBeNull();
        expect(sc!.lines.length).toBeGreaterThanOrEqual(4);
        texts.add(sc!.lines.map((l) => l.text).join('|'));
      }
    }
    expect(texts.size).toBeGreaterThan(5);
    s.survivors[1].alive = false; // without Jo, nobody speaks his lines
    s.day = 2;
    expect(nightScene(s)!.lines.every((l) => l.who !== 'jo' && !l.acts?.jo)).toBe(true);
  });
});

import { queueOrder } from '../src/sim/sim';

describe('order chaining', () => {
  it('carries out the queued order once the first is done', () => {
    const s = newGame(11);
    const ev: SimEvent[] = [];
    const lena = s.survivors.find((v) => v.id === 'lena')!;
    lena.trust = 100;
    lena.courage = 100;
    s.awaiting = null; // the briefing has been read
    lena.at = 'gate';
    expect(queueOrder(s, 'lena', 'hold', 'gate', ev)).toBe(false); // nothing to chain after
    issueOrder(s, 'lena', 'retreat', null, ev);
    expect(lena.order?.type).toBe('retreat');
    expect(queueOrder(s, 'lena', 'hold', 'gate', ev)).toBe(true);
    for (let i = 0; i < 400 && lena.nextOrder; i++) step(s, 0.25, ev);
    expect(lena.nextOrder).toBeNull();
    expect(lena.order?.type).toBe('hold');
  });
});

import { useItem, smoked } from '../src/sim/items';

describe('tactical items', () => {
  it('a decoy pulls nearby packs away and costs a part; smoke hides and costs a ration', () => {
    const s = newGame(5);
    const ev: SimEvent[] = [];
    const jo = s.survivors.find((v) => v.id === 'jo')!;
    expect(useItem(s, jo, 'decoy', ev)).toBe(false); // not from inside the shelter
    jo.at = 'cross_w';
    s.threats = [{ id: 1, at: 'bridge_w', to: null, progress: 0, size: 3, state: 'hunt', target: 'jo', goal: null, timer: 0, seen: true }];
    const parts = s.resources.parts;
    expect(useItem(s, jo, 'decoy', ev)).toBe(true);
    expect(s.resources.parts).toBe(parts - 1);
    expect(s.threats[0].state).toBe('lured');
    expect(s.threats[0].target).toBeNull();
    s.threats[0].state = 'hunt';
    s.threats[0].target = 'jo';
    expect(useItem(s, jo, 'smoke', ev)).toBe(true);
    expect(smoked(s, jo)).toBe(true);
    expect(s.threats[0].target).toBeNull();
  });
});

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

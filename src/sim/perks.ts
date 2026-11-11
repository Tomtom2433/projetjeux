// Survivor progression: experience, levels and one perk per level.
import type { GameState, Survivor } from './types';

export interface Perk {
  id: string;
  name: string;
  desc: string;
}

export const PERKS: Record<string, Perk[]> = {
  mara: [
    { id: 'surehands', name: 'Mains sûres', desc: 'Un blessé qu’elle relève repart avec bien plus de santé.' },
    { id: 'calm', name: 'Sang-froid', desc: 'Son stress monte 30 % moins vite.' },
    { id: 'triage', name: 'Triage', desc: 'Escorter des civils la ralentit beaucoup moins.' },
    { id: 'marksman', name: 'Tireuse', desc: 'Quatre balles chaque matin, et elle touche plus souvent.' },
  ],
  jo: [
    { id: 'mule', name: 'Bête de somme', desc: 'Porte 2 charges de plus.' },
    { id: 'thick', name: 'Cuir épais', desc: 'Subit 30 % de dégâts en moins.' },
    { id: 'breaker', name: 'Briseur', desc: 'Son pied-de-biche met à terre bien plus souvent.' },
    { id: 'scrounger', name: 'Fouineur', desc: 'Chaque fouille réussie rapporte une ration de plus.' },
  ],
  lena: [
    { id: 'shadow', name: 'Ombre', desc: 'Encore 30 % plus difficile à repérer.' },
    { id: 'lynx', name: 'Œil de lynx', desc: 'Observe deux fois plus vite et repère le butin alentour.' },
    { id: 'runner', name: 'Coureuse', desc: 'Se déplace 12 % plus vite.' },
    { id: 'steady', name: 'Nerfs solides', desc: 'Son stress retombe deux fois plus vite.' },
  ],
};

export const LEVELS = [0, 40, 100, 180, 280];

/** Aptitude of a survivor for an order type, 1..5 (3 when unknown). */
export const aptitude = (sv: Survivor, type: string) => sv.skill?.[type] ?? 3;

/** A completed order is practice: three successes raise the aptitude by one. */
export function practise(s: GameState, sv: Survivor, type: string) {
  if (!sv.skill || aptitude(sv, type) >= 5) return;
  sv.practice[type] = (sv.practice[type] ?? 0) + 1;
  if (sv.practice[type] >= 3) {
    sv.practice[type] = 0;
    sv.skill[type] = aptitude(sv, type) + 1;
    s.flags['apt_' + sv.id + '_' + type] = sv.skill[type];
  }
}

export const hasPerk = (sv: Survivor, id: string) => sv.perks.includes(id);

export function gainXp(s: GameState, sv: Survivor, n: number) {
  if (!sv.alive) return;
  // the team's Synchro chain multiplies what everyone learns
  n = Math.round(n * (1 + Math.min(10, (s.flags.sync as number) ?? 0) * 0.1));
  sv.xp += n;
  s.flags['xp_' + sv.id] = ((s.flags['xp_' + sv.id] as number) ?? 0) + n;
}

/** Turn accumulated experience into levels. Returns how many levels were gained. */
export function levelUp(sv: Survivor): number {
  let gained = 0;
  while (sv.level < LEVELS.length && sv.xp >= LEVELS[sv.level]) {
    sv.level++;
    if (sv.level > 1) {
      sv.perkPoints++;
      gained++;
    }
  }
  return gained;
}

/** Progress toward the next level, 0..1. */
export function levelProgress(sv: Survivor): number {
  const next = LEVELS[sv.level];
  if (next === undefined) return 1;
  const prev = LEVELS[sv.level - 1] ?? 0;
  return Math.min(1, Math.max(0, (sv.xp - prev) / (next - prev)));
}

/** The two perks currently on offer (the first two not yet taken). */
export function perkOffer(sv: Survivor): Perk[] {
  return (PERKS[sv.id] ?? []).filter((p) => !sv.perks.includes(p.id)).slice(0, 2);
}

export function choosePerk(sv: Survivor, perkId: string): boolean {
  if (sv.perkPoints <= 0 || !perkOffer(sv).some((p) => p.id === perkId)) return false;
  sv.perkPoints--;
  sv.perks.push(perkId);
  if (perkId === 'mule') sv.carryCap += 2;
  return true;
}

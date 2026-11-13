// What the player has done across all runs on this device: statistics and achievements.
import type { GameState } from '../sim/types';

export interface Profile {
  runs: number;
  days: number;
  rescued: number;
  lost: number;
  bestSync: number;
  endings: string[];
  done: Record<string, number>;
}

export const ACHIEVEMENTS: { id: string; name: string; text: string }[] = [
  { id: 'home', name: 'Tout le monde rentre', text: 'Finir une journée, objectif atteint, sans perdre personne.' },
  { id: 'cover', name: 'Un qui regarde, un qui bouge', text: 'Monter la Synchro à 5.' },
  { id: 'nurse', name: 'Personne derrière', text: 'Sortir Inès et son patient de Saint-Roch.' },
  { id: 'truth', name: 'Mot pour mot', text: 'Dire à Jo la vérité sur le carnet.' },
  { id: 'vogel', name: 'Le fauteuil vide', text: 'Ramener Elias Vogel à ECHO-7.' },
  { id: 'child', name: 'Le dessin du pont', text: 'Sauver Sacha et Mila.' },
  { id: 'leave', name: 'Douze places', text: 'Finir la campagne en partant par le bateau.' },
  { id: 'stay', name: 'Dernier signal', text: 'Finir la campagne en restant à l’antenne.' },
  { id: 'three', name: 'Trois voix', text: 'Finir la campagne avec Mara, Jo et Lena en vie.' },
  { id: 'clean', name: 'D’une traite', text: 'Finir la campagne sans rejouer une seule journée.' },
  { id: 'hard', name: 'Sans filet', text: 'Finir la campagne en difficulté Dur.' },
];

const KEY = 'last-signal.profile';
const empty = (): Profile => ({ runs: 0, days: 0, rescued: 0, lost: 0, bestSync: 0, endings: [], done: {} });

export function loadProfile(): Profile {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Profile>) };
  } catch {
    return empty();
  }
}
function store(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function countRun() {
  const p = loadProfile();
  p.runs++;
  store(p);
}

/** Record a finished day (or the ending) and return the achievements it unlocked. */
export function recordDay(s: GameState, ended: boolean): string[] {
  const p = loadProfile();
  const got: string[] = [];
  const unlock = (id: string, cond: unknown) => {
    if (cond && !p.done[id]) {
      p.done[id] = Date.now();
      got.push(ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id);
    }
  };
  const f = s.persistent;
  if (!ended && s.debrief && s.day > 0) {
    p.days++;
    p.rescued += s.debrief.rescues.length;
    p.lost += s.debrief.deaths.length;
    unlock('home', s.debrief.rating === 'succes');
  }
  p.bestSync = Math.max(p.bestSync, Number(s.flags.syncBest ?? 0), Number(f.syncRecord ?? 0));
  unlock('cover', p.bestSync >= 5);
  unlock('nurse', f.inesRescued && f.patientRescued);
  unlock('truth', f.joTruth === 'truth');
  unlock('vogel', f.vogel === 'rescued');
  unlock('child', f.sachaRescued);
  if (ended) {
    const end = f.final === 'leave' ? 'leave' : 'stay';
    if (!p.endings.includes(end)) p.endings.push(end);
    unlock(end, true);
    unlock('three', s.survivors.every((v) => v.alive));
    unlock('clean', !f.retries);
    unlock('hard', Number(f.difficulty ?? 1) >= 2);
  }
  store(p);
  return got;
}

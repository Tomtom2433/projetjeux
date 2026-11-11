// Radio lines. The simulation decides what happens; these only describe it.
import type { GameState, Survivor } from './types';
import { NODE } from './world';
import { pick } from './core';

type Lines = Record<string, string[]>;

const COMMON: Lines = {
  ack_scout: ['Reçu. Je vais voir {node}.', 'Compris, reconnaissance vers {node}.'],
  ack_retrieve: ['Reçu. Je ramène ce que je trouve à {node}.', "J'y vais. {node}, fouille et retour."],
  ack_hold: ['Je tiens la position.', 'Je ne bouge plus.'],
  ack_retreat: ['Reçu, je rentre.', 'Repli vers ECHO-7.'],
  ack_rescue: ["J'y vais. Personne ne reste dehors.", 'Reçu. Je vais les chercher à {node}.'],
  refuse: ['Négatif. Pas maintenant, pas par là.', "Non. Je n'irai pas à {node} comme ça."],
  refuse_hurt: ['Je tiens à peine debout. Envoyez quelqu’un d’autre.'],
  spotted: ["Ils m'ont vue ! Contact à {node} !", 'Contact ! Ils arrivent sur moi !'],
  flee: ['Je décroche, il y en a trop !', 'Je ne reste pas là. Je recule.'],
  resume: ["C'est calme. Je reprends.", 'Voie libre, je continue.'],
  abort: ["J'ai décroché. J'attends vos ordres à {node}.", "Mission interrompue. Je me cache à {node}."],
  hide: ["Mouvement tout près. Je me planque.", 'Je me mets à couvert, silence radio.'],
  rest: ["Je n'en peux plus. Deux minutes.", 'Je souffle un instant.'],
  home_dusk: ['La nuit tombe. Je rentre, avec ou sans ordre.', "Il fait trop sombre. Je rentre à ECHO-7."],
  scout_clear: ['{node} : rien ne bouge.', 'Visuel sur {node}. Dégagé.'],
  scout_threat: ['{node} : j’en compte {n}. Immobiles pour l’instant.', 'Visuel sur {node} : {n} infectés.'],
  search_start: ['Je fouille {node}.', 'Sur place. Je cherche.'],
  search_found: ['Trouvé : {loot}. Je rentre.', "J'ai {loot}. Retour."],
  search_empty: ['Rien à {node}. Vide.', 'Quelqu’un est passé avant nous. Rien.'],
  deposit: ['De retour. {loot} au stock.', 'Je suis rentrée. {loot}.'],
  home: ['De retour à ECHO-7.', 'Je suis à l’abri.'],
  hit: ['Je suis touchée !', 'Ahh— blessée !'],
  kill: ['Un de moins.', "Il ne se relèvera pas."],
  clear: ["C'est fini. Ils sont tous à terre.", 'Zone nettoyée.'],
  down: ['… je… ne peux plus…'],
  help_go: ['{ally} est à terre. J’y vais.', 'Je ne laisse pas {ally} là-bas.'],
  help_got: ["J'ai {ally}. Vivant·e. On rentre.", 'Je porte {ally}. Couvrez-nous.'],
  relink: ['… ECHO-7, vous me recevez ? Je reviens sur le réseau.'],
  night_back: ["J'ai passé la nuit dehors. Ne me refaites plus ça."],
};

const VOICE: Record<string, Lines> = {
  jo: {
    ack_scout: ['Ouais. Je jette un œil à {node}.'],
    ack_retrieve: ['Ça marche. Je vide {node} et je reviens.'],
    ack_hold: ['Je bouge pas.'],
    ack_retreat: ['Je rentre.'],
    refuse: ["Non. C'est du suicide, votre truc.", 'Trouvez un autre pigeon pour {node}.'],
    spotted: ['Merde, repéré ! {node} !'],
    flee: ['Trop nombreux, je dégage !'],
    resume: ["C'est bon. J'y retourne."],
    abort: ["J'arrête là. Je suis planqué à {node}."],
    hit: ['Saloperie— touché !'],
    kill: ['Un de moins.', 'Le pied-de-biche a parlé.'],
    deposit: ['Rentré. {loot}. De rien.'],
    home: ['Rentré.'],
    home_dusk: ["Fait nuit. Je rentre, que ça vous plaise ou non."],
  },
  lena: {
    ack_scout: ["D'accord. Je serai discrète. {node}."],
    ack_retrieve: ["D'accord… {node}. Je fais vite."],
    refuse: ["Non. Non, je peux pas. Pas {node}.", "Je… non. Demandez à Mara."],
    spotted: ['Ils me voient ! Ils me voient !'],
    flee: ['Je cours ! Je cours !'],
    hide: ["J'entends quelque chose. Je me cache."],
    resume: ["Ça va… ça va. Je continue."],
    abort: ["J'ai pas pu. Je suis cachée à {node}."],
    hit: ["Aïe— j'ai mal, j'ai mal !"],
    home: ["Je suis rentrée. Je suis rentrée."],
  },
  mara: {
    ack_rescue: ["J'y vais. On ne laisse personne."],
    refuse: ['Négatif, opérateur. Pas avec ce que je vois à {node}.'],
    spotted: ['Contact à {node}. Ils m’ont repérée.'],
    hit: ['Je suis touchée. Ça ira.'],
  },
};

const LOOT_NAMES: Record<string, [string, string]> = {
  supplies: ['ration', 'rations'],
  medicine: ['dose de médicaments', 'doses de médicaments'],
  parts: ['pièce', 'pièces'],
};

export function lootText(k: { supplies: number; medicine: number; parts: number }): string {
  const out: string[] = [];
  for (const key of ['medicine', 'supplies', 'parts'] as const) {
    const n = k[key];
    if (n > 0) out.push(`${n} ${LOOT_NAMES[key][n > 1 ? 1 : 0]}`);
  }
  return out.length ? out.join(', ') : 'rien';
}

export function line(
  s: GameState,
  sv: Survivor,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const own = VOICE[sv.id]?.[key];
  const pool = own && own.length ? own : COMMON[key] ?? [key];
  let text = pick(s, pool);
  // Jo and Lena's lines are written per-voice; the common pool is feminine (Mara, Lena).
  if (sv.id === 'jo') text = text.replace('rentrée', 'rentré').replace('touchée', 'touché').replace('vue', 'vu').replace('blessée', 'blessé');
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const nodeName = (id: string) => NODE[id]?.name ?? id;

export function fmtTime(t: number): string {
  const v = Math.max(0, Math.floor(t));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** In-fiction clock: the mission runs from 17:40 to nightfall at 19:20. */
export function fmtClock(t: number): string {
  const minutes = 17 * 60 + 40 + Math.floor(t / 6);
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

export const ORDER_LABEL: Record<string, string> = {
  scout: 'Reconnaître',
  retrieve: 'Récupérer',
  hold: 'Tenir',
  retreat: 'Repli',
  rescue: 'Secourir',
};

export const MODE_LABEL: Record<string, string> = {
  idle: 'En attente',
  order: 'En mission',
  flee: 'En fuite',
  hide: 'À couvert',
  rest: 'Se repose',
  help: 'Porte secours',
  home: 'Rentre',
  down: 'À terre',
  fight: 'Se bat',
};

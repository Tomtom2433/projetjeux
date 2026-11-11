// Radio lines. The simulation decides what happens; these only describe it.
import type { GameState, Survivor } from './types';
import { NODE } from './world';
import { pick } from './core';

type Lines = Record<string, string[]>;

// Keys may carry a tone suffix: "@low" is used when trust is under 35, "@high" above 75.
const COMMON: Lines = {
  ack_scout: ['Reçu. Je vais voir {node}.', 'Compris, reconnaissance vers {node}.', 'Je pars sur {node}. Je vous décris ce que je vois.', '{node}. Je garde la radio ouverte.'],
  'ack_scout@low': ['{node}. Si vous le dites.', 'J’y vais. J’espère que vous savez ce qu’il y a là-bas.'],
  'ack_scout@high': ['{node}, tout de suite. Guidez-moi.', 'J’y vais les yeux fermés. Enfin, presque.'],
  ack_retrieve: ['Reçu. Je ramène ce que je trouve à {node}.', "J'y vais. {node}, fouille et retour.", 'Compris. Je vide {node} et je rentre.', '{node}. Je fais vite et léger.'],
  'ack_retrieve@low': ['Encore moi. D’accord. {node}.', 'J’y vais. Mais c’est moi qui décide quand je rentre.'],
  'ack_retrieve@high': ['{node}. Comptez sur moi.', 'Reçu, opérateur. Je vous ramène ça.'],
  ack_hold: ['Je tiens la position.', 'Je ne bouge plus.', 'À couvert. J’attends.', 'Je me fais oublier ici.'],
  ack_retreat: ['Reçu, je rentre.', 'Repli vers ECHO-7.', 'Je décroche. Retour à l’abri.', 'Compris. Je reviens.'],
  'ack_retreat@low': ['Enfin une bonne décision. Je rentre.'],
  ack_rescue: ["J'y vais. Personne ne reste dehors.", 'Reçu. Je vais les chercher à {node}.', '{node}. Je les ramène.', 'Tenez-les en ligne. J’arrive.'],
  refuse: ['Négatif. Pas maintenant, pas par là.', "Non. Je n'irai pas à {node} comme ça.", 'Trop risqué. Trouvez-moi un autre chemin.', '{node} ? Non. Regardez votre carte.'],
  'refuse@low': ['Non. Et ne me demandez pas pourquoi.', 'Vous n’êtes pas dehors, vous. C’est non.'],
  'refuse@high': ['Je vous fais confiance, mais là, non. Pas {node}.', 'Désolée, opérateur. Je ne peux pas faire ça.'],
  refuse_hurt: ['Je tiens à peine debout. Envoyez quelqu’un d’autre.', 'Je saigne encore. Pas aujourd’hui.'],
  spotted: ["Ils m'ont vue ! Contact à {node} !", 'Contact ! Ils arrivent sur moi !', 'Repérée ! {node} !', 'Ils tournent la tête— ils m’ont vue !'],
  flee: ['Je décroche, il y en a trop !', 'Je ne reste pas là. Je recule.', 'Trop près ! Je dégage !', 'Je romps le contact !'],
  resume: ["C'est calme. Je reprends.", 'Voie libre, je continue.', 'Ils sont passés. Je repars.', 'Plus rien ne bouge. J’y retourne.'],
  'resume@low': ['Je reprends. Pour l’équipe, pas pour vous.'],
  abort: ["J'ai décroché. J'attends vos ordres à {node}.", 'Mission interrompue. Je me cache à {node}.', 'Je ne passerai pas. Je suis à {node}.', 'Impossible d’avancer. Planquée à {node}.'],
  hide: ['Mouvement tout près. Je me planque.', 'Je me mets à couvert, silence radio.', 'Quelque chose approche. Je ne bouge plus.', 'Je coupe la lampe. Chut.'],
  rest: ["Je n'en peux plus. Deux minutes.", 'Je souffle un instant.', 'Mes jambes lâchent. Une minute.'],
  home_dusk: ['La nuit tombe. Je rentre, avec ou sans ordre.', 'Il fait trop sombre. Je rentre à ECHO-7.', 'Je ne vois plus mes mains. Je rentre.'],
  scout_clear: ['{node} : rien ne bouge.', 'Visuel sur {node}. Dégagé.', '{node} est vide. Pour l’instant.', 'Rien à {node}. Juste le vent.'],
  scout_threat: ['{node} : j’en compte {n}. Immobiles pour l’instant.', 'Visuel sur {node} : {n} infectés.', '{n} silhouettes autour de {node}. Elles ne m’ont pas vue.', 'J’en vois {n} près de {node}. Ne passez pas par là.'],
  search_start: ['Je fouille {node}.', 'Sur place. Je cherche.', 'Je suis dedans. Ça sent la poussière et pire.', 'Je commence par les étagères.'],
  search_found: ['Trouvé : {loot}. Je rentre.', "J'ai {loot}. Retour.", '{loot} dans le sac. Je sors.', 'Bonne pioche : {loot}.'],
  search_empty: ['Rien à {node}. Vide.', 'Quelqu’un est passé avant nous. Rien.', 'Des emballages vides. C’est tout.'],
  deposit: ['De retour. {loot} au stock.', 'Je suis rentrée. {loot}.', 'À l’abri. {loot}.', 'Portail refermé. {loot}.'],
  'deposit@low': ['Rentrée. {loot}. La prochaine fois, venez le chercher vous-même.'],
  'deposit@high': ['On l’a fait. {loot}. Merci de m’avoir guidée.'],
  home: ['De retour à ECHO-7.', 'Je suis à l’abri.', 'Rentrée. Portail fermé.'],
  hit: ['Je suis touchée !', 'Ahh— blessée !', 'Il m’a eue— je saigne !'],
  kill: ['Un de moins.', 'Il ne se relèvera pas.', 'À terre. Suivant.'],
  clear: ["C'est fini. Ils sont tous à terre.", 'Zone nettoyée.', 'Plus rien ne bouge. Je respire.'],
  down: ['… je… ne peux plus…', '… opérateur… je tombe…'],
  help_go: ['{ally} est à terre. J’y vais.', 'Je ne laisse pas {ally} là-bas.', 'Tiens bon, {ally}. J’arrive.'],
  help_got: ["J'ai {ally}. Vivant·e. On rentre.", 'Je porte {ally}. Couvrez-nous.', '{ally} respire. Je le sors de là.'],
  relink: ['… ECHO-7, vous me recevez ? Je reviens sur le réseau.', '… allô ? Ah. Vous êtes là. J’ai cru que c’était fini.', '… kkrsh… ECHO-7 ? Je vous entends de nouveau.'],
  night_back: ["J'ai passé la nuit dehors. Ne me refaites plus ça."],
};

const VOICE: Record<string, Lines> = {
  jo: {
    ack_scout: ['Ouais. Je jette un œil à {node}.', '{node}. Je regarde, je touche à rien.', 'Reco sur {node}. Ça marche.'],
    'ack_scout@low': ['{node}. Si j’y reste, vous l’écrirez dans le carnet ?'],
    ack_retrieve: ['Ça marche. Je vide {node} et je reviens.', '{node}. J’ai le grand sac.', 'Je prends tout ce qui se porte.'],
    'ack_retrieve@low': ['Je fais les courses. Vous, restez bien au chaud.'],
    'ack_retrieve@high': ['{node}. Vous m’avez pas encore planté. J’y vais.'],
    ack_hold: ['Je bouge pas.', 'Planqué. J’attends.'],
    ack_retreat: ['Je rentre.', 'Demi-tour. Reçu.'],
    ack_rescue: ['J’y vais. Je porte, c’est mon rayon.', '{node}. Je les ramène sur mon dos s’il faut.'],
    refuse: ["Non. C'est du suicide, votre truc.", 'Trouvez un autre pigeon pour {node}.', 'Négatif. J’ai déjà donné.'],
    'refuse@low': ['Non. Vous envoyez les gens mourir depuis un fauteuil.', 'C’est non. Comme pour mon frère, ça aurait dû être non.'],
    'refuse@high': ['Pas cette fois, chef. Même pour vous.'],
    spotted: ['Merde, repéré ! {node} !', 'Ils m’ont vu ! Ça vient !'],
    flee: ['Trop nombreux, je dégage !', 'Je recule, je recule !'],
    resume: ["C'est bon. J'y retourne.", 'Ils ont lâché. Je continue.'],
    abort: ["J'arrête là. Je suis planqué à {node}.", 'Ça passe pas. J’attends à {node}.'],
    hide: ['Ça bouge. Je me planque.', 'Plus un bruit.'],
    hit: ['Saloperie— touché !', 'Il m’a mordu la veste— non, le bras !'],
    kill: ['Un de moins.', 'Le pied-de-biche a parlé.', 'Celui-là, c’est pour le convoi.'],
    clear: ['Fini. J’ai le bras qui tremble.', 'Tous à terre. J’ai besoin d’un verre.'],
    deposit: ['Rentré. {loot}. De rien.', 'Voilà. {loot}. Qui range ?'],
    'deposit@high': ['Rentré. {loot}. On fait une bonne équipe, la voix.'],
    home: ['Rentré.', 'Je suis là. Portail fermé.'],
    home_dusk: ['Fait nuit. Je rentre, que ça vous plaise ou non.'],
    search_start: ['Je fouille. Ça va faire du bruit.', 'Je force la porte de {node}.'],
    help_go: ['{ally} est tombé·e. Je vais le chercher.', 'Personne ne reste là-bas. Pas une deuxième fois.'],
    relink: ['… ça capte ? Ouais. Bon. Je suis vivant, au cas où.'],
  },
  lena: {
    ack_scout: ["D'accord. Je serai discrète. {node}.", '{node}. Je passe par les ombres.', 'Je regarde et je reviens. Promis.'],
    'ack_scout@low': ['{node}… vous êtes sûr qu’il n’y a rien ? Vous disiez ça aussi hier.'],
    'ack_scout@high': ['{node}. Je vous fais confiance. Dites-moi si vous voyez quelque chose.'],
    ack_retrieve: ["D'accord… {node}. Je fais vite.", 'Je prends ce que je peux porter. {node}.'],
    ack_hold: ['Je ne bouge pas. Je respire à peine.', 'Cachée. Je vous écoute.'],
    ack_retreat: ['Oui. Oui, je rentre.', 'Je reviens. Je cours.'],
    ack_rescue: ['Moi ? D’accord. D’accord. J’y vais.', 'Je vais les chercher. Parlez-moi pendant que je marche.'],
    refuse: ['Non. Non, je peux pas. Pas {node}.', 'Je… non. Demandez à Mara.', 'Pas là-bas. S’il vous plaît.'],
    'refuse@low': ['Non. Vous ne savez pas ce qu’il y a là-bas. Vous ne savez jamais.'],
    spotted: ['Ils me voient ! Ils me voient !', 'Il a tourné la tête— il m’a vue !'],
    flee: ['Je cours ! Je cours !', 'Je peux pas rester— je pars !'],
    hide: ["J'entends quelque chose. Je me cache.", 'Je suis sous une voiture. Ne parlez pas.'],
    resume: ['Ça va… ça va. Je continue.', 'Ils sont partis. Je crois. J’y vais.'],
    abort: ["J'ai pas pu. Je suis cachée à {node}.", 'Pardon. Je me suis arrêtée à {node}.'],
    hit: ["Aïe— j'ai mal, j'ai mal !", 'Il m’a griffée— ça brûle !'],
    home: ['Je suis rentrée. Je suis rentrée.', 'Portail fermé. Je tremble encore.'],
    deposit: ['Je l’ai fait. {loot}.', 'Regardez. {loot}. J’ai réussi.'],
    scout_threat: ['{node}… j’en compte {n}. Ils se balancent. Ils attendent.', '{n} à {node}. Je les vois dans mes jumelles. Un porte un cartable.'],
    scout_clear: ['{node}, c’est vide. On dirait un dimanche.', 'Rien à {node}. Même pas un oiseau.'],
    relink: ['… vous êtes là ? Dites quelque chose. S’il vous plaît.'],
  },
  mara: {
    ack_scout: ['Reçu. Reconnaissance sur {node}.', '{node}. Je vous fais un point dans cinq minutes.'],
    ack_rescue: ["J'y vais. On ne laisse personne.", '{node}. J’ai ma trousse.'],
    'ack_retrieve@low': ['J’y vais. Pour ceux de l’infirmerie, pas pour vos statistiques.'],
    refuse: ['Négatif, opérateur. Pas avec ce que je vois à {node}.', 'Non. Je ne serai utile à personne morte.'],
    spotted: ['Contact à {node}. Ils m’ont repérée.', 'Je suis vue. Je gère.'],
    hit: ['Je suis touchée. Ça ira.', 'Morsure superficielle. Je continue de bouger.'],
    kill: ['Un de moins. Il portait encore son alliance.', 'Désolée. Vraiment.'],
    search_start: ['Je fouille {node}. Méthodiquement.', 'Sur place. Je commence par l’armoire à pharmacie.'],
    help_got: ['J’ai {ally}. Pouls filant, mais présent. On rentre.', 'Garrot posé. Je ramène {ally}.'],
  },
};

/** Lines spoken when an order sends someone back to a place they remember. */
const RECALL: Record<string, Lines> = {
  brother: { jo: ['Le checkpoint. C’est là que le convoi de mon frère s’est arrêté. Bon. Allons voir.', 'Par le checkpoint. Évidemment. Sur ordre de la radio, comme lui.'] },
  cave: { lena: ['Le quai nord… D’accord. Je ne regarderai pas les caves.'] },
  refused: { '*': ['J’avais dit non pour {node}. Vous insistez.', 'Encore {node}. Vous n’avez pas écouté, la dernière fois.'] },
  aborted: { '*': ['La dernière fois, j’ai fait demi-tour à {node}. On verra si ça passe.', '{node}. J’y ai laissé mes nerfs. On réessaie.'] },
  hurt: { '*': ['J’ai laissé du sang à {node}. Je m’en souviens très bien.', '{node}. Là où je suis tombée. Parfait.'], jo: ['{node}. C’est là qu’ils m’ont eu. Je leur dois quelque chose.'] },
  left: { '*': ['Saint-Roch. Vous savez ce qu’on y a laissé.', 'Je retourne là-bas. J’espère qu’il n’y a plus personne à regarder en face.'] },
  lure: { '*': ['Les Tanneurs. Le magnétophone sur la table. Vous êtes sûr, cette fois ?'] },
};

export function line(s: GameState, sv: Survivor, key: string, vars: Record<string, string | number> = {}): string {
  const tone = sv.trust < 35 ? '@low' : sv.trust > 75 ? '@high' : '';
  const own = VOICE[sv.id] ?? {};
  // A toned line is a seasoning, not the whole meal: use it about half the time.
  const toned = tone && pick(s, [true, false]) ? own[key + tone] ?? COMMON[key + tone] : undefined;
  const pool = toned && toned.length ? toned : own[key] && own[key].length ? own[key] : COMMON[key] ?? [key];
  // Never the same line twice in a row for the same speaker and situation.
  const memo = 'ln_' + sv.id + '_' + key;
  let idx = Math.floor(pickIndex(s, pool.length));
  if (pool.length > 1 && s.flags[memo] === pool[idx]) idx = (idx + 1) % pool.length;
  let text = pool[idx];
  s.flags[memo] = text;
  if (sv.id === 'jo') text = masculine(text);
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

const pickIndex = (s: GameState, n: number) => pick(s, Array.from({ length: n }, (_, i) => i));

function masculine(text: string): string {
  return text
    .replace(/rentrée/g, 'rentré')
    .replace(/Rentrée/g, 'Rentré')
    .replace(/touchée/g, 'touché')
    .replace(/vue/g, 'vu')
    .replace(/blessée/g, 'blessé')
    .replace(/Repérée/g, 'Repéré')
    .replace(/Planquée/g, 'Planqué')
    .replace(/tombée/g, 'tombé')
    .replace(/Désolée/g, 'Désolé');
}

/** A remark tied to a bad memory of the place the order leads through, if any. Said once per day per place. */
export function recall(s: GameState, sv: Survivor, nodes: string[]): string | null {
  for (const m of sv.memory) {
    if (!m.kind || !m.node || m.tone >= 0 || !nodes.includes(m.node)) continue;
    if (m.day === s.day && s.time - m.time < 90) continue;
    const flag = 'recall_' + sv.id + '_' + m.node;
    if (s.flags[flag]) continue;
    const set = RECALL[m.kind];
    const pool = set?.[sv.id] ?? set?.['*'];
    if (!pool) continue;
    s.flags[flag] = true;
    let text = pick(s, pool);
    if (sv.id === 'jo') text = masculine(text);
    return text.replace('{node}', NODE[m.node]?.name ?? '');
  }
  return null;
}

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

/** Civilians brought back to ECHO-7. Keyed by the name stored in state.rescued. */
export const NPCS: Record<string, { id: string; name: string; role: string; color: string; note: string }> = {
  'Inès Duval': { id: 'ines', name: 'Inès Duval', role: 'Infirmière · Saint-Roch', color: '#4fa89a', note: 'Tient l’infirmerie. Les soins à l’abri sont plus efficaces.' },
  'le patient de Saint-Roch': { id: 'patient', name: 'Marc Oberlin', role: 'Patient · fracture ouverte', color: '#9aa7ab', note: 'Alité. Il demande chaque soir qui est rentré.' },
  'Sacha et sa fille': { id: 'sacha', name: 'Sacha et Mila', role: 'Rescapés des Tanneurs', color: '#6b5540', note: 'Il répare ce qu’on lui apporte. Elle dessine la carte du quartier.' },
  'Un rescapé du quartier': { id: 'stranger', name: 'Un rescapé du quartier', role: 'Trouvé caché dans une voiture', color: '#7d8a6a', note: 'Il ne dit pas son nom. Il a partagé sa dernière ration.' },
  'Elias Vogel': { id: 'vogel', name: 'Elias Vogel', role: 'Ancien opérateur d’ECHO-7', color: '#5d5a6e', note: 'Il connaît chaque fréquence. Il évite le regard de Jo.' },
};

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

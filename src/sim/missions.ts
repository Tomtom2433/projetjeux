// The five-day arc. Each day changes the objective, the map state and which incidents can fire.
// Text may look at persistent flags: what happened on earlier days shapes the briefing.
import type { Choice, GameState, NodeId, Stock } from './types';
import { zoneOf } from './core';

export const LAST_DAY = 5;

export type Objective =
  | { kind: 'deliver'; res: keyof Stock; n: number; nodes: NodeId[] }
  | { kind: 'scout'; nodes: NodeId[] }
  | { kind: 'evacuate'; node: NodeId };

export interface Mission {
  title: string;
  brief: string;
  hint: string;
  choices?: Choice[];
  loot: Record<NodeId, Partial<Stock>>;
  threats: [NodeId, number, 'dormant' | 'wander'][];
  incidents: string[];
  storm?: [number, number];
  blocked?: [NodeId, NodeId][];
}

const RES: Record<keyof Stock, string> = { medicine: 'Médicaments', parts: 'Pièces', supplies: 'Rations' };

export function objective(s: GameState): Objective {
  switch (Math.min(s.day, LAST_DAY)) {
    case 1:
      return { kind: 'deliver', res: 'medicine', n: 2, nodes: ['hosp_in'] };
    case 2:
      return { kind: 'deliver', res: 'parts', n: 2, nodes: ['garage'] };
    case 3:
      return { kind: 'scout', nodes: ['quay_n', 'east_n'] };
    case 4:
      return { kind: 'deliver', res: 'supplies', n: 3, nodes: ['apts', 'quay_s', 'hosp_in', 'garage'] };
    default:
      return s.flags.final === 'stay' ? { kind: 'deliver', res: 'parts', n: 2, nodes: ['garage', 'apts'] } : { kind: 'evacuate', node: 'lock_e' };
  }
}

export interface ObjectiveStatus {
  label: string;
  detail: string;
  done: boolean;
  nodes: NodeId[];
}

export function objectiveStatus(s: GameState): ObjectiveStatus {
  const o = objective(s);
  if (o.kind === 'deliver') {
    const got = s.delivered[o.res];
    return { label: `${RES[o.res]} ${Math.min(got, o.n)}/${o.n}`, detail: got >= o.n ? 'rentrez tous' : '', done: got >= o.n, nodes: got >= o.n ? [] : o.nodes.filter((n) => (s.loot[n]?.[o.res] ?? 0) > 0) };
  }
  if (o.kind === 'scout') {
    const seen = o.nodes.filter((n) => s.flags['scouted_' + n]);
    if (seen.length < o.nodes.length) return { label: `Relevés radio ${seen.length}/${o.nodes.length}`, detail: 'ordre Reconnaître', done: false, nodes: o.nodes.filter((n) => !s.flags['scouted_' + n]) };
    const found = s.incidents.vogel?.state === 'resolved';
    return { label: found ? 'Émetteur trouvé' : 'Émetteur localisé : l’écluse', detail: found ? 'rentrez tous' : 'envoyez quelqu’un', done: found, nodes: found ? [] : ['lock_e'] };
  }
  const alive = s.survivors.filter((v) => v.alive);
  const there = alive.filter((v) => zoneOf(v) === o.node && v.mode !== 'down').length;
  return { label: `À l’écluse ${there}/${alive.length}`, detail: 'avant le départ du bateau', done: alive.length > 0 && there === alive.length, nodes: [o.node] };
}

export function mission(s: GameState): Mission {
  const p = s.persistent;
  const harder = p.flareUsed ? 1 : 0;
  switch (Math.min(s.day, LAST_DAY)) {
    case 1:
      return {
        title: 'Saint-Roch',
        brief:
          "ECHO-7, ici Mara. On n'a plus d'antibiotiques. Il en reste à l'hôpital Saint-Roch, de l'autre côté du canal. Le pont est le chemin le plus court, mais personne n'a vu le checkpoint depuis hier. Vous êtes nos yeux, opérateur. La nuit tombe dans dix minutes.",
        hint: 'Objectif : rapporter au moins 2 doses de médicaments avant la nuit.',
        loot: { quay_s: { supplies: 2 }, apts: { supplies: 3 }, hosp_in: { medicine: 5 }, garage: { supplies: 1, parts: 3 } },
        threats: [['bridge_e', 4, 'dormant'], ['parvis', 2, 'wander'], ['east_s', 3, 'dormant'], ['quay_n', 1, 'wander']],
        incidents: ['bridge', 'hospital', 'unknown'],
      };
    case 2:
      return {
        title: 'Le carnet de Lorentz',
        brief: `Jour 2. ${p.inesRescued ? 'Inès a tenu l’infirmerie toute la nuit. ' : ''}Le générateur tousse et l’antenne avec lui : il nous faut des pièces. Le garage Lorentz, au sud-est. Jo dit que le convoi de son frère y faisait le plein, avant. Il ne dit rien d’autre.`,
        hint: 'Objectif : rapporter au moins 2 pièces du garage Lorentz.',
        loot: { quay_s: { supplies: 1 }, apts: { supplies: 2 }, hosp_in: { medicine: 2 }, garage: { supplies: 1, parts: 4 } },
        threats: [['bridge_e', 3 + harder, 'dormant'], ['parvis', 2, 'wander'], ['east_s', 2, 'dormant'], ['quay_n', 1, 'wander']],
        incidents: ['bridge', 'logbook'],
      };
    case 3:
      return {
        title: 'La voix dans la boucle',
        brief: `Jour 3. Cette nuit, ${p.lureFound ? 'le magnétophone des Tanneurs' : 'la voix des Tanneurs'} a repris, sur une autre fréquence. Même phrase, mêmes quatorze secondes. Quelqu’un déplace cet émetteur. Deux relevés suffisent pour le trianguler : un au quai nord, un rue Saint-Roch nord.`,
        hint: 'Objectif : ordre Reconnaître sur le Quai nord et la Rue Saint-Roch nord, puis trouver l’émetteur.',
        loot: { quay_s: { supplies: 1 }, apts: { supplies: 1 }, hosp_in: { medicine: 1, supplies: 1 }, garage: { parts: 1 } },
        threats: [['bridge_e', 3 + harder, 'dormant'], ['parvis', 3, 'wander'], ['cross_e', 2, 'dormant'], ['quay_s', 1, 'wander']],
        incidents: ['bridge', 'vogel'],
      };
    case 4:
      return {
        title: 'Avant l’orage',
        brief: `Jour 4. Le bus du pont a brûlé cette nuit : le tablier est impraticable, il ne reste que l’écluse. ${p.vogel === 'rescued' ? 'Vogel dit que l’orage tiendra jusqu’au soir et que la radio ne portera pas loin. ' : 'L’orage sera sur nous toute la journée. '}Et la réserve est vide. Il faut manger.`,
        hint: 'Objectif : rapporter au moins 3 rations. Le pont est coupé, la liaison radio sera mauvaise.',
        loot: { quay_s: { supplies: 2 }, apts: { supplies: 2 }, hosp_in: { supplies: 2, medicine: 1 }, garage: { supplies: 2, parts: 1 } },
        threats: [['parvis', 3, 'wander'], ['east_s', 3, 'wander'], ['quay_n', 2, 'wander'], ['quay_s', 2, 'dormant'], ...(p.vogel === 'robbed' ? ([['lock_e', 2, 'wander']] as [NodeId, number, 'wander'][]) : [])],
        incidents: ['boat'],
        storm: [40, 570],
        blocked: [['bridge_w', 'bridge_mid']],
      };
    default:
      return {
        title: 'Dernier signal',
        brief: `Jour 5. Le bateau du relais fluvial passera l’écluse ce soir${p.boat === 'open' ? ', et toute la ville le sait' : ''}. ${p.vogel === 'rescued' || p.vogel === 'ally' ? 'Vogel tiendra les vannes ouvertes jusqu’à la nuit. ' : 'Sans personne aux vannes, il ne s’arrêtera que quelques minutes. '}Si nous partons, ECHO-7 se tait pour de bon. Si nous restons, il faut réparer l’amplificateur, et d’autres entendront peut-être. C’est vous qui tenez le micro, opérateur.`,
        hint: 'La décision ne peut pas être reprise.',
        choices: [
          { id: 'leave', label: 'Partir : tout le monde à l’écluse', hint: 'Ordre Reconnaître vers l’Écluse : ils y tiendront la position. Ceux qui n’y sont pas au départ restent.' },
          { id: 'stay', label: 'Rester : ECHO-7 continue d’émettre', hint: 'Objectif : rapporter 2 pièces pour l’amplificateur. Le bateau partira sans vous.' },
        ],
        loot: { quay_s: { supplies: 1 }, apts: { supplies: 1, parts: 1 }, hosp_in: { medicine: 1 }, garage: { parts: 3 } },
        threats: [['parvis', 3, 'wander'], ['east_n', 2, 'wander'], ['quay_s', 2, 'wander'], ['east_s', 3, 'wander'], ...(p.vogel === 'robbed' ? ([['quay_n', 2, 'wander']] as [NodeId, number, 'wander'][]) : []), ...(p.boat === 'open' ? ([['cross_w', 2, 'wander'], ['cross_e', 2, 'wander']] as [NodeId, number, 'wander'][]) : [])],
        incidents: [],
        blocked: [['bridge_w', 'bridge_mid']],
      };
  }
}

/** Closing lines, built from everything that persisted. */
export function buildEnding(s: GameState): string[] {
  const p = s.persistent;
  const out: string[] = [];
  const alive = s.survivors.filter((v) => v.alive);
  const names = (l: { short: string }[]) => l.map((v) => v.short).join(', ').replace(/, ([^,]*)$/, ' et $1');
  if (!alive.length) return ['La fréquence d’ECHO-7 est vide. Le générateur a tourné encore deux jours, puis la porteuse s’est éteinte.', 'Personne ne sait qui tenait le micro.'];
  if (p.final === 'leave') {
    const gone = s.survivors.filter((v) => p['evac_' + v.id]);
    const stayed = alive.filter((v) => !p['evac_' + v.id]);
    if (gone.length) out.push(`${names(gone)} ${gone.length > 1 ? 'ont embarqué' : 'a embarqué'} à l’écluse. Le bateau a descendu le canal tous feux éteints.`);
    else out.push('Le bateau a passé l’écluse sans personne d’ECHO-7 à son bord.');
    if (stayed.length) out.push(`${names(stayed)} ${stayed.length > 1 ? 'n’ont' : 'n’a'} pas embarqué. La radio de l’abri grésille encore, certains soirs.`);
    if (gone.length && s.rescued.length) out.push(`Avec eux : ${[...new Set(s.rescued)].join(', ')}.`);
    if (p.boat === 'open') out.push('Onze inconnus attendaient déjà sur la berge. Ils avaient entendu votre message.');
    out.push('ECHO-7 n’émet plus. Votre dernier message tourne en boucle : quatorze secondes, une position, une heure.');
  } else {
    if (p.finalDone) out.push('L’amplificateur a tenu. Cette nuit-là, trois stations ont répondu : une au nord, deux sur le fleuve.');
    else out.push('L’amplificateur n’a jamais été réparé. ECHO-7 émet toujours, mais à courte portée, pour qui passe à moins d’un kilomètre.');
    out.push(`${names(alive)} ${alive.length > 1 ? 'tiennent' : 'tient'} encore l’abri. Le bateau est passé sans s’arrêter.`);
  }
  if (p.inesRescued) out.push('Inès Duval a rouvert une infirmerie. Elle note chaque nom dans un cahier d’écolier.');
  else if (p.inesLeft) out.push('À Saint-Roch, le canal 4 a émis jusqu’au troisième jour. Puis plus rien.');
  else if (p.inesLost) out.push('Personne n’a revu Inès Duval après la chute de son escorte.');
  if (p.patientRescued) out.push('Marc Oberlin remarche, avec une canne taillée dans un manche de pelle.');
  if (p.sachaRescued) out.push('Mila a dessiné la carte du quartier de mémoire. Elle est punaisée au-dessus du poste.');
  else if (p.lureFound) out.push('Le magnétophone des Tanneurs est sur votre bureau. Vous ne l’avez jamais réécouté.');
  const jo = s.survivors.find((v) => v.id === 'jo');
  if (jo?.alive) {
    if (p.joTruth === 'told') out.push('Jo a gardé le carnet de son frère. Il vous a dit merci une fois, sans vous regarder.');
    else if (p.joTruth === 'lied') out.push(p.joKnows ? 'Jo sait que vous lui avez menti. Il vous obéit encore. Il ne vous parle plus.' : 'Jo croit toujours que son frère est mort en héros. Vous êtes seul à savoir.');
    else if (p.joTruth === 'hidden') out.push('Le carnet a brûlé dans un bidon. Jo demande parfois ce qu’il y avait au garage.');
  }
  if (p.vogel === 'rescued') out.push('Elias Vogel a repris un casque. Il ne donne plus d’ordres : il écoute, et il vous dit quand vous vous trompez.');
  else if (p.vogel === 'ally') out.push('Vogel est resté à l’écluse. Ses boucles éloignent encore les meutes du canal, la nuit.');
  else if (p.vogel === 'robbed') out.push('On a retrouvé la cabane de l’écluse vide. Sans ses leurres, les meutes sont revenues sur les quais.');
  else if (p.vogel === 'lost' || p.vogel === 'escorted') out.push('Vogel est tombé sur le chemin du retour. Ses carnets de fréquences sont illisibles.');
  else out.push('Vous n’avez jamais su qui déplaçait l’émetteur.');
  const best = [...alive].sort((a, b) => b.trust - a.trust)[0];
  if (best && best.trust >= 70) out.push(`${best.short}, le dernier soir : « Je ne connais pas votre visage. Mais je reconnaîtrais votre voix n’importe où. »`);
  else if (best && best.trust < 35) out.push(`Aucun d’eux ne vous a dit au revoir. ${best.short} a simplement coupé son poste.`);
  return out;
}

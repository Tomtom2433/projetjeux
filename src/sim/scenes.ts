// Dialogue scenes: the survivors talk to each other, without the operator on the line.
// One plays before the training day, one each night between days. What they say depends on
// who is still alive and on what the operator decided, so the scenes are the story's memory.
import type { GameState } from './types';

export interface SceneLine {
  who: string;
  text: string;
}

export interface Scene {
  title: string;
  /** Illustration key (public/art/s-<key>.webp). */
  art: string;
  place: string;
  lines: SceneLine[];
}

const L = (who: string, text: string): SceneLine => ({ who, text });

/** Drop lines spoken by people who are no longer there. */
function cast(s: GameState, title: string, art: string, place: string, lines: (SceneLine | false | null | undefined | 0 | '')[]): Scene | null {
  const alive = new Set(s.survivors.filter((v) => v.alive).map((v) => v.id));
  const extras = new Set(['ines', 'vogel', 'sacha', 'patient', 'stranger']);
  const kept = lines.filter((l): l is SceneLine => !!l && (alive.has(l.who) || extras.has(l.who)));
  return kept.length >= 2 ? { title, art, place, lines: kept } : null;
}

/** Before anything else: the three of them, and an empty chair at the radio. */
export function introScene(s: GameState): Scene | null {
  return cast(s, 'Neuf jours sans opérateur', 'shelter', 'ECHO-7, la cour, à la tombée du jour', [
    L('jo', 'Neuf jours que le poste est vide. Neuf jours qu’on sort à l’aveugle. Et ce soir, quelqu’un s’assoit dans le fauteuil de Vogel comme si de rien n’était.'),
    L('mara', 'Quelqu’un s’assoit dans un fauteuil vide, Jo. C’est tout ce que c’est pour l’instant.'),
    L('lena', 'Il est comment ? Le nouveau. Vous l’avez vu ?'),
    L('mara', 'Personne ne le verra. C’est une voix. Elle nous dira ce qu’on ne peut pas voir d’en bas.'),
    L('jo', 'La dernière voix a dit à mon frère de passer par le checkpoint. Tu te souviens de ce qu’il y avait au checkpoint ?'),
    L('lena', 'Jo…'),
    L('jo', 'Je dis juste que moi, une voix, je l’écoute. Je lui obéis pas. C’est pas pareil.'),
    L('mara', 'Alors écoute-la demain. Juste demain. On fait trois choses simples près de l’abri, et on voit si elle mérite la suivante.'),
    L('lena', 'Et si elle se trompe ?'),
    L('mara', 'Alors on le lui dira. C’est une radio, Lena. Ça marche dans les deux sens.'),
  ]);
}

/** The night after a day, read from the state just before the next day is set up. */
export function nightScene(s: GameState): Scene | null {
  const p = s.persistent;
  const dead = s.survivors.filter((v) => !v.alive).map((v) => v.short);
  const mourning = dead.length ? L('mara', `On laisse une gamelle pour ${dead.join(' et ')}. Je sais. Laissez-la quand même.`) : null;
  switch (s.day) {
    case 0:
      return cast(s, 'Première nuit', 'shelter', 'ECHO-7, autour du brasero', [
        L('lena', 'Elle m’a envoyée au carrefour, et elle m’a ramenée. Vogel, il oubliait qu’on était dehors.'),
        L('jo', 'Elle t’a ramenée d’une entorse à deux cents mètres du portail. Attends demain avant de lui tresser une couronne.'),
        L('mara', 'Demain, c’est Saint-Roch. Il n’y a plus un antibiotique ici, et j’ai trois plaies qui tournent mal.'),
        L('jo', 'Par le pont ?'),
        L('mara', 'Par où la voix dira. On verra bien ce qu’elle voit.'),
        L('lena', 'Mara… si je regarde pendant que quelqu’un avance, il risque moins, non ? C’est ce que j’ai compris aujourd’hui.'),
        L('mara', 'C’est exactement ça. Un qui regarde, un qui bouge. Retiens-le, et rappelle-le-lui s’il l’oublie.'),
      ]);
    case 1: {
      const choice = s.incidents.hospital?.choice;
      return cast(s, 'Ce qu’on a laissé à Saint-Roch', choice === 'all' || p.inesRescued ? 'hospital-mara' : 'unknown', 'ECHO-7, l’infirmerie', [
        p.inesRescued && L('ines', 'Vous avez une infirmerie avec un seul lit et pas d’eau courante. J’ai connu pire. J’ai connu Saint-Roch la semaine dernière.'),
        p.inesRescued && L('mara', 'Bienvenue à ECHO-7. Le lit est pour celui qui en a le plus besoin, et ce soir ce n’est pas vous.'),
        p.patientRescued && L('jo', 'J’aurais pas parié une ration qu’on sortirait le gars à la jambe. La voix a dit « tout le monde ». Elle a pas hésité.'),
        choice === 'ines' && L('mara', 'On a laissé un homme là-bas avec de l’eau et une radio. Il a dit merci. Je préférerais qu’il ne l’ait pas dit.'),
        choice === 'meds' && L('mara', 'J’ai le stock. J’ai laissé une infirmière et un blessé. C’était l’ordre.'),
        choice === 'meds' && L('jo', 'C’était le bon ordre. On est sept bouches ici, pas neuf.'),
        choice === 'meds' && L('lena', 'Tu dis ça parce que c’est pas toi qui as fermé la porte.'),
        !choice && L('mara', 'Personne n’est entré dans la pharmacie aujourd’hui. Les plaies n’attendront pas un jour de plus.'),
        s.flags.unknownOutcome === 'lure' && L('lena', 'Le magnétophone des Tanneurs… quelqu’un l’a posé là. Quelqu’un de vivant.'),
        s.flags.unknownOutcome === 'rescued' && L('lena', 'La petite dessine. Elle a dessiné le pont, avec le bus. Elle n’a pas dessiné ce qu’il y a derrière.'),
        L('jo', 'Le générateur a calé deux fois cette nuit. Demain il me faut des pièces. Y a qu’un endroit : le garage Lorentz.'),
        L('lena', 'Lorentz… c’est là que le convoi de ton frère—'),
        L('jo', 'Je sais où c’est.'),
        mourning,
      ]);
    }
    case 2: {
      const truth = p.joTruth;
      return cast(s, 'Le carnet', 'logbook', 'ECHO-7, l’atelier', [
        truth === 'truth' && L('jo', '« Passez par le checkpoint. Faites du bruit. » Il a recopié l’ordre mot pour mot. Mon frère recopiait tout.'),
        truth === 'truth' && L('mara', 'Vogel a fait de lui un appât pour éloigner une meute de l’abri. Et la voix te l’a dit telle quelle.'),
        truth === 'truth' && L('jo', 'Ouais. C’est la première fois qu’une radio me dit un truc que j’avais pas envie d’entendre. Ça change.'),
        truth === 'lied' && L('jo', 'Mort en couvrant les autres. Je le savais. Je l’ai toujours su.'),
        truth === 'lied' && L('mara', '…Oui. Sûrement.'),
        truth === 'lied' && L('lena', 'Mara, pourquoi tu regardes par terre ?'),
        truth === 'hidden' && L('jo', 'Y avait rien au garage ? Pas un papier, pas un nom ? Dans le camion de mon frère ?'),
        truth === 'hidden' && L('lena', 'On… on a ramené les pièces. C’est ce qui compte, non ?'),
        !truth && L('jo', 'On n’est pas allés au bout. Le garage attendra. Mon frère aussi, il a l’habitude.'),
        L('lena', 'La boucle a repris cette nuit. La même voix, les mêmes mots. Mais plus forte, et pas au même endroit qu’hier.'),
        L('mara', 'Quelqu’un déplace l’émetteur. Avec deux relevés, on saura où il dort.'),
        L('jo', 'Et quand on saura ?'),
        L('mara', 'On ira frapper à sa porte. Poliment. La première fois.'),
        mourning,
      ]);
    }
    case 3: {
      const v = p.vogel;
      return cast(s, 'L’homme de l’écluse', 'vogel', 'ECHO-7, la salle radio', [
        v === 'rescued' && L('vogel', 'Votre opérateur écoute. Moi, je parlais. C’est toute la différence, et il m’a fallu un mois dans une cabane pour la comprendre.'),
        v === 'rescued' && L('jo', 'Parle encore une fois de différence et je te montre celle entre un pied-de-biche et une porte.'),
        v === 'rescued' && L('mara', 'Jo. Il sait ouvrir l’écluse. Tu régleras ça après, s’il y a un après.'),
        v === 'ally' && L('lena', 'On l’a laissé là-bas, avec sa ration. Il a dit qu’il ouvrirait les vannes si on en avait besoin. Il pleurait, je crois.'),
        v === 'ally' && L('jo', 'Qu’il pleure. Qu’il ouvre ses vannes, et qu’il pleure.'),
        v === 'robbed' && L('mara', 'On lui a pris ses batteries. Ses leurres se sont tus. Écoutez le quai, cette nuit : ça revient.'),
        v === 'robbed' && L('jo', 'Il a eu ce qu’il a donné.'),
        v === 'lost' && L('mara', 'Vogel est tombé à mi-chemin. Tout ce qu’il savait sur les fréquences est tombé avec lui.'),
        !v && L('lena', 'On ne l’a pas trouvé. La boucle tourne encore. Je l’entends quand je ferme les yeux.'),
        p.joKnows && L('jo', '« Faites du bruit. » Voilà ce qu’il leur a dit. Et la voix, elle, m’a dit qu’il était mort en héros. Deux opérateurs, deux menteurs.'),
        p.joKnows && L('mara', 'Elle a menti pour t’épargner. Lui, pour se sauver. Ce n’est pas la même faute.'),
        p.joKnows && L('jo', 'C’est le même fauteuil.'),
        L('lena', 'Le ciel est jaune à l’ouest. Ça sent la pluie et le métal.'),
        L('mara', 'L’orage sera là à l’aube. Et la réserve est vide : demain, on sort quand même.'),
        L('jo', 'Alors on sortira trempés. La pluie couvre le bruit des pas, au moins.'),
        mourning,
      ]);
    }
    case 4: {
      const open = p.boat === 'open';
      return cast(s, 'Douze places', 'boat', 'ECHO-7, le toit, sous la pluie', [
        L('lena', 'Un bateau. Demain soir. Douze places.'),
        open && L('jo', 'Et la voix l’a crié sur toutes les fréquences. Demain, la moitié de la ville sera sur le quai. L’autre moitié suivra le bruit.'),
        open && L('mara', 'La moitié de la ville, ce sont des gens, Jo. On a été ces gens.'),
        !open && L('jo', 'Et personne d’autre ne le sait. Pour une fois qu’on a une longueur d’avance.'),
        !open && L('lena', 'Il y a d’autres caves, d’autres gens cachés. Ils ne sauront jamais qu’il est passé.'),
        L('mara', 'Si on monte tous, ECHO-7 se tait. Ceux qui écoutent encore cette fréquence n’entendront plus rien.'),
        L('jo', 'Si on reste, il faut réparer l’amplificateur, et prier pour que quelqu’un réponde.'),
        L('lena', 'Moi, je veux partir. Je suis désolée. Je veux partir.'),
        L('mara', 'Ne sois pas désolée. C’est la voix qui tranchera. Elle nous a amenés jusqu’ici.'),
        L('jo', 'Ouais. Pour une fois, je suis curieux de l’entendre.'),
        mourning,
      ]);
    }
    default:
      return null;
  }
}

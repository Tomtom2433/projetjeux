// Dialogue scenes: the survivors talk to each other, without the operator on the line.
// One plays before the training day, one each night between days. What they say depends on
// who is still alive and on what the operator decided, so the scenes are the story's memory.
import type { GameState } from './types';

/** What a character does on a beat. Postures (sit, stand, away, back, step) stay until changed; the rest lasts one line. */
export type Act = 'sit' | 'stand' | 'away' | 'face' | 'step' | 'back' | 'point' | 'shrug' | 'nod' | 'still';

export interface SceneLine {
  /** Speaker id, or 'narr' for a stage direction shown as a caption. */
  who: string;
  text: string;
  /** Who the line is addressed to: the speaker turns to them and the camera can hold both. */
  to?: string;
  /** Stage directions for this beat, by character. */
  acts?: Record<string, Act>;
  cam?: 'close' | 'two' | 'wide';
}

export interface Scene {
  title: string;
  /** Illustration key (public/art/s-<key>.webp), shown as the opening card. */
  art: string;
  place: string;
  mood: 'dusk' | 'night' | 'storm';
  lines: SceneLine[];
}

type Dir = Act | Record<string, Act>;
const dirs = (who: string, d?: Dir) => (d === undefined ? undefined : typeof d === 'string' ? { [who]: d } : d);
/** A spoken line. `to` is the addressee; `d` an act for the speaker or a map of acts. */
const L = (who: string, text: string, to?: string, d?: Dir, cam?: SceneLine['cam']): SceneLine => ({ who, text, to, acts: dirs(who, d), cam });
/** A stage direction: nobody speaks, somebody does something. */
const N = (text: string, acts?: Record<string, Act>): SceneLine => ({ who: 'narr', text, acts, cam: 'wide' });

/** Drop lines spoken by people who are no longer there, and directions about them. */
function cast(s: GameState, title: string, art: string, place: string, mood: Scene['mood'], lines: (SceneLine | false | null | undefined | 0 | '')[]): Scene | null {
  const alive = new Set(s.survivors.filter((v) => v.alive).map((v) => v.id));
  const extras = new Set(['ines', 'vogel', 'sacha', 'patient', 'stranger']);
  const here = (id: string) => alive.has(id) || extras.has(id);
  const kept = lines.filter((l): l is SceneLine => {
    if (!l) return false;
    if (l.who === 'narr') return !l.acts || Object.keys(l.acts).every(here);
    return here(l.who);
  });
  for (const l of kept) if (l.to && !here(l.to)) l.to = undefined;
  return kept.filter((l) => l.who !== 'narr').length >= 2 ? { title, art, place, mood, lines: kept } : null;
}

/** Before anything else: the three of them, and an empty chair at the radio. */
export function introScene(s: GameState): Scene | null {
  return cast(s, 'Neuf jours sans opérateur', 'shelter', 'ECHO-7, la cour, à la tombée du jour', 'dusk', [
    N('Le brasero crépite. Lena s’accroupit près des flammes ; Jo reste debout, à l’écart, le dos tourné au poste radio.', { lena: 'sit', jo: 'back' }),
    L('jo', 'Neuf jours que le poste est vide. Neuf jours qu’on sort à l’aveugle. Et ce soir, quelqu’un s’assoit dans le fauteuil de Vogel comme si de rien n’était.', 'mara', 'away'),
    L('mara', 'Quelqu’un s’assoit dans un fauteuil vide, Jo. C’est tout ce que c’est pour l’instant.', 'jo'),
    L('lena', 'Il est comment ? Le nouveau. Vous l’avez vu ?', 'mara'),
    L('mara', 'Personne ne le verra. C’est une voix. Elle nous dira ce qu’on ne peut pas voir d’en bas.', 'lena', 'point'),
    N('Jo se retourne et revient vers le feu.', { jo: 'step' }),
    L('jo', 'La dernière voix a dit à mon frère de passer par le checkpoint. Tu te souviens de ce qu’il y avait au checkpoint ?', 'mara', 'point', 'two'),
    L('lena', 'Jo…', 'jo', 'stand'),
    L('jo', 'Je dis juste que moi, une voix, je l’écoute. Je lui obéis pas. C’est pas pareil.', 'lena', 'shrug'),
    L('mara', 'Alors écoute-la demain. Juste demain. On fait trois choses simples près de l’abri, et on voit si elle mérite la suivante.', 'jo', undefined, 'two'),
    L('lena', 'Et si elle se trompe ?', 'mara'),
    L('mara', 'Alors on le lui dira. C’est une radio, Lena. Ça marche dans les deux sens.', 'lena', 'nod'),
    N('Dans la salle radio, un voyant passe au vert. Les trois têtes se tournent vers le fauteuil.', { mara: 'still', jo: 'still', lena: 'still' }),
  ]);
}

/** The night after a day, read from the state just before the next day is set up. */
export function nightScene(s: GameState): Scene | null {
  const p = s.persistent;
  const dead = s.survivors.filter((v) => !v.alive).map((v) => v.short);
  const mourning = dead.length ? L('mara', `On laisse une gamelle pour ${dead.join(' et ')}. Je sais. Laissez-la quand même.`, undefined, 'sit', 'wide') : null;
  switch (s.day) {
    case 0:
      return cast(s, 'Première nuit', 'shelter', 'ECHO-7, autour du brasero', 'night', [
        N('La nuit est tombée sur la cour. Lena masse sa cheville près du feu ; Jo recharge le brasero.', { lena: 'sit', jo: 'step' }),
        L('lena', 'Elle m’a envoyée au carrefour, et elle m’a ramenée. Vogel, il oubliait qu’on était dehors.', 'jo'),
        L('jo', 'Elle t’a ramenée d’une entorse à deux cents mètres du portail. Attends demain avant de lui tresser une couronne.', 'lena', 'shrug'),
        L('mara', 'Demain, c’est Saint-Roch. Il n’y a plus un antibiotique ici, et j’ai trois plaies qui tournent mal.', 'jo', 'point'),
        L('jo', 'Par le pont ?', 'mara', undefined, 'two'),
        L('mara', 'Par où la voix dira. On verra bien ce qu’elle voit.', 'jo', 'shrug'),
        N('Lena se relève, hésite, puis s’approche de Mara.', { lena: 'step' }),
        L('lena', 'Mara… si je regarde pendant que quelqu’un avance, il risque moins, non ? C’est ce que j’ai compris aujourd’hui.', 'mara', undefined, 'two'),
        L('mara', 'C’est exactement ça. Un qui regarde, un qui bouge. Retiens-le, et rappelle-le-lui s’il l’oublie.', 'lena', 'nod'),
      ]);
    case 1: {
      const choice = s.incidents.hospital?.choice;
      return cast(s, 'Ce qu’on a laissé à Saint-Roch', choice === 'all' || p.inesRescued ? 'hospital-mara' : 'unknown', 'ECHO-7, devant l’infirmerie', 'night', [
        N('Mara rince ses mains dans un seau. Personne ne s’est encore assis.', { mara: 'step' }),
        p.inesRescued && L('ines', 'Vous avez une infirmerie avec un seul lit et pas d’eau courante. J’ai connu pire. J’ai connu Saint-Roch la semaine dernière.', 'mara'),
        p.inesRescued && L('mara', 'Bienvenue à ECHO-7. Le lit est pour celui qui en a le plus besoin, et ce soir ce n’est pas vous.', 'ines', 'nod', 'two'),
        p.patientRescued && L('jo', 'J’aurais pas parié une ration qu’on sortirait le gars à la jambe. La voix a dit « tout le monde ». Elle a pas hésité.', 'mara', 'shrug'),
        choice === 'ines' && L('mara', 'On a laissé un homme là-bas avec de l’eau et une radio. Il a dit merci. Je préférerais qu’il ne l’ait pas dit.', undefined, 'away'),
        choice === 'meds' && L('mara', 'J’ai le stock. J’ai laissé une infirmière et un blessé. C’était l’ordre.', undefined, 'away'),
        choice === 'meds' && L('jo', 'C’était le bon ordre. On est sept bouches ici, pas neuf.', 'mara', 'shrug'),
        choice === 'meds' && L('lena', 'Tu dis ça parce que c’est pas toi qui as fermé la porte.', 'jo', 'point', 'two'),
        !choice && L('mara', 'Personne n’est entré dans la pharmacie aujourd’hui. Les plaies n’attendront pas un jour de plus.', 'jo'),
        s.flags.unknownOutcome === 'lure' && L('lena', 'Le magnétophone des Tanneurs… quelqu’un l’a posé là. Quelqu’un de vivant.', 'mara', 'sit'),
        s.flags.unknownOutcome === 'rescued' && L('lena', 'La petite dessine. Elle a dessiné le pont, avec le bus. Elle n’a pas dessiné ce qu’il y a derrière.', 'mara', 'sit'),
        N('Le générateur tousse, cale, repart. La lumière de la cour vacille.', { jo: 'away' }),
        L('jo', 'Le générateur a calé deux fois cette nuit. Demain il me faut des pièces. Y a qu’un endroit : le garage Lorentz.', 'mara', 'point'),
        L('lena', 'Lorentz… c’est là que le convoi de ton frère—', 'jo', 'stand'),
        L('jo', 'Je sais où c’est.', undefined, 'back'),
        mourning,
      ]);
    }
    case 2: {
      const truth = p.joTruth;
      return cast(s, 'Le carnet', 'logbook', 'ECHO-7, devant l’atelier', 'night', [
        truth === 'truth' && N('Jo tient le carnet ouvert à la lueur du feu. Il a lu la même page quatre fois.', { jo: 'sit', lena: 'sit' }),
        truth !== 'truth' && N('Jo trie des pièces de moteur sur une bâche, sans lever les yeux.', { jo: 'sit' }),
        truth === 'truth' && L('jo', '« Passez par le checkpoint. Faites du bruit. » Il a recopié l’ordre mot pour mot. Mon frère recopiait tout.', 'mara'),
        truth === 'truth' && L('mara', 'Vogel a fait de lui un appât pour éloigner une meute de l’abri. Et la voix te l’a dit telle quelle.', 'jo', 'step', 'two'),
        truth === 'truth' && L('jo', 'Ouais. C’est la première fois qu’une radio me dit un truc que j’avais pas envie d’entendre. Ça change.', 'mara', 'stand'),
        truth === 'lied' && L('jo', 'Mort en couvrant les autres. Je le savais. Je l’ai toujours su.', 'mara', 'nod'),
        truth === 'lied' && L('mara', '…Oui. Sûrement.', undefined, 'away'),
        truth === 'lied' && L('lena', 'Mara, pourquoi tu regardes par terre ?', 'mara', 'step', 'two'),
        truth === 'hidden' && L('jo', 'Y avait rien au garage ? Pas un papier, pas un nom ? Dans le camion de mon frère ?', 'lena', 'stand'),
        truth === 'hidden' && L('lena', 'On… on a ramené les pièces. C’est ce qui compte, non ?', 'jo', 'away'),
        !truth && L('jo', 'On n’est pas allés au bout. Le garage attendra. Mon frère aussi, il a l’habitude.', 'mara', 'shrug'),
        N('Sur le poste, la boucle reprend : une voix d’homme, les mêmes six mots, à peine audibles.', { lena: 'stand' }),
        L('lena', 'La boucle a repris cette nuit. La même voix, les mêmes mots. Mais plus forte, et pas au même endroit qu’hier.', 'mara', 'point'),
        L('mara', 'Quelqu’un déplace l’émetteur. Avec deux relevés, on saura où il dort.', 'lena', 'nod'),
        L('jo', 'Et quand on saura ?', 'mara', 'stand', 'two'),
        L('mara', 'On ira frapper à sa porte. Poliment. La première fois.', 'jo', 'shrug'),
        mourning,
      ]);
    }
    case 3: {
      const v = p.vogel;
      return cast(s, 'L’homme de l’écluse', 'vogel', 'ECHO-7, sous la fenêtre de la salle radio', 'night', [
        v === 'rescued' && N('Vogel est assis près du feu, les mains tendues vers les flammes. Jo ne le quitte pas des yeux.', { vogel: 'sit', jo: 'back' }),
        v !== 'rescued' && N('Le quai est silencieux. Trop. Chacun écoute sans le dire.', { lena: 'sit' }),
        v === 'rescued' && L('vogel', 'Votre opérateur écoute. Moi, je parlais. C’est toute la différence, et il m’a fallu un mois dans une cabane pour la comprendre.', 'mara'),
        v === 'rescued' && L('jo', 'Parle encore une fois de différence et je te montre celle entre un pied-de-biche et une porte.', 'vogel', 'step', 'two'),
        v === 'rescued' && L('mara', 'Jo. Il sait ouvrir l’écluse. Tu régleras ça après, s’il y a un après.', 'jo', 'point'),
        v === 'ally' && L('lena', 'On l’a laissé là-bas, avec sa ration. Il a dit qu’il ouvrirait les vannes si on en avait besoin. Il pleurait, je crois.', 'jo'),
        v === 'ally' && L('jo', 'Qu’il pleure. Qu’il ouvre ses vannes, et qu’il pleure.', undefined, 'away'),
        v === 'robbed' && L('mara', 'On lui a pris ses batteries. Ses leurres se sont tus. Écoutez le quai, cette nuit : ça revient.', 'jo', 'point'),
        v === 'robbed' && L('jo', 'Il a eu ce qu’il a donné.', 'mara', 'shrug'),
        v === 'lost' && L('mara', 'Vogel est tombé à mi-chemin. Tout ce qu’il savait sur les fréquences est tombé avec lui.', 'jo', 'away'),
        !v && L('lena', 'On ne l’a pas trouvé. La boucle tourne encore. Je l’entends quand je ferme les yeux.', 'mara'),
        p.joKnows && L('jo', '« Faites du bruit. » Voilà ce qu’il leur a dit. Et la voix, elle, m’a dit qu’il était mort en héros. Deux opérateurs, deux menteurs.', 'mara', 'point', 'two'),
        p.joKnows && L('mara', 'Elle a menti pour t’épargner. Lui, pour se sauver. Ce n’est pas la même faute.', 'jo', 'step'),
        p.joKnows && L('jo', 'C’est le même fauteuil.', undefined, 'back'),
        N('Un éclair muet, très loin à l’ouest. Lena se lève et regarde le ciel.', { lena: 'stand' }),
        L('lena', 'Le ciel est jaune à l’ouest. Ça sent la pluie et le métal.', undefined, 'away'),
        L('mara', 'L’orage sera là à l’aube. Et la réserve est vide : demain, on sort quand même.', 'jo'),
        L('jo', 'Alors on sortira trempés. La pluie couvre le bruit des pas, au moins.', 'mara', 'shrug'),
        mourning,
      ]);
    }
    case 4: {
      const open = p.boat === 'open';
      return cast(s, 'Douze places', 'boat', 'ECHO-7, la cour, sous la pluie', 'storm', [
        N('La pluie tombe droit. Le brasero fume plus qu’il ne brûle. Personne n’a pensé à s’abriter.', { lena: 'step' }),
        L('lena', 'Un bateau. Demain soir. Douze places.', 'mara', 'point'),
        open && L('jo', 'Et la voix l’a crié sur toutes les fréquences. Demain, la moitié de la ville sera sur le quai. L’autre moitié suivra le bruit.', 'mara', 'shrug'),
        open && L('mara', 'La moitié de la ville, ce sont des gens, Jo. On a été ces gens.', 'jo', 'step', 'two'),
        !open && L('jo', 'Et personne d’autre ne le sait. Pour une fois qu’on a une longueur d’avance.', 'mara', 'nod'),
        !open && L('lena', 'Il y a d’autres caves, d’autres gens cachés. Ils ne sauront jamais qu’il est passé.', 'jo', 'away'),
        L('mara', 'Si on monte tous, ECHO-7 se tait. Ceux qui écoutent encore cette fréquence n’entendront plus rien.', 'lena', 'point'),
        L('jo', 'Si on reste, il faut réparer l’amplificateur, et prier pour que quelqu’un réponde.', 'mara', 'shrug'),
        N('Lena s’accroupit, les bras autour des genoux.', { lena: 'sit' }),
        L('lena', 'Moi, je veux partir. Je suis désolée. Je veux partir.', 'mara'),
        L('mara', 'Ne sois pas désolée. C’est la voix qui tranchera. Elle nous a amenés jusqu’ici.', 'lena', 'step', 'two'),
        L('jo', 'Ouais. Pour une fois, je suis curieux de l’entendre.', undefined, 'nod', 'wide'),
        mourning,
      ]);
    }
    default:
      return null;
  }
}

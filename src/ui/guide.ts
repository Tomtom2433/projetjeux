// Everything the game explains in words: the manual, the first-visit guide of each screen,
// and one-time advice from Mara when something happens for the first time.

export const MANUAL: { title: string; lines: string[] }[] = [
  {
    title: 'Le principe',
    lines: [
      'Vous êtes l’opérateur radio d’ECHO-7. Vous ne déplacez personne : vous donnez des ordres à des survivants qui choisissent leur chemin, et qui peuvent refuser.',
      'Chaque journée dure dix minutes, du crépuscule à la nuit. À la nuit, ceux qui sont encore dehors y restent.',
      'La campagne compte cinq journées. Ce que vous décidez un jour revient les jours suivants.',
    ],
  },
  {
    title: 'L’écran de jeu',
    lines: [
      '<b>Bandeau du haut</b> : force du signal, heure, temps avant la nuit, objectif du jour et objectifs secondaires.',
      '<b>Équipe</b> (à gauche) : touchez une fiche pour sélectionner un survivant. ♥ santé, ϟ stress, ☾ fatigue.',
      '<b>Carte</b> : glissez pour vous déplacer, pincez pour zoomer. La brume couvre ce que personne n’a regardé.',
      '<b>Mini-carte</b> : les points sont vos survivants, les anneaux les lieux importants.',
      '<b>Œil</b> (en haut à droite) : réduit ou masque l’interface.',
    ],
  },
  {
    title: 'Donner un ordre',
    lines: [
      'Touchez un survivant, puis un ordre, puis une destination surlignée, puis <b>Transmettre</b>.',
      '<b>Reconnaître</b> ◉ : aller voir et rapporter. <b>Récupérer</b> ▣ : fouiller et ramener. <b>Tenir</b> ◆ : garder une position et couvrir. <b>Repli</b> ↩ : rentrer. <b>Secourir</b> ✚ : aller chercher quelqu’un à terre ou un civil.',
      'Les pastilles sous chaque ordre montrent l’aptitude du survivant, de 1 à 5.',
      'S’il a déjà un ordre, <b>Ensuite</b> programme le suivant.',
    ],
  },
  {
    title: 'Pourquoi un ordre est refusé',
    lines: [
      'Un survivant pèse votre ordre contre sa peur, sa fatigue, ses blessures et la confiance qu’il vous porte.',
      'La confiance monte quand vos ordres se passent bien, et tombe quand ils coûtent cher. Un mensonge se paie plus tard.',
    ],
  },
  {
    title: 'Signal et renseignement',
    lines: [
      'Loin de l’antenne, la liaison tombe : vous ne voyez plus qu’une position fantôme, vos ordres attendent, et les décisions se prennent sans vous.',
      'Une étiquette en pointillés est un renseignement périmé : ce qu’on croyait hier.',
    ],
  },
  {
    title: 'Couverture et Synchro',
    lines: [
      'Un survivant qui <b>tient</b> ou <b>observe</b> un point couvre les rues voisines : ses équipiers y sont moins repérés.',
      'Chaque action réussie sous couverture fait monter la <b>Synchro</b>, qui multiplie l’expérience. Se faire repérer la remet à zéro.',
    ],
  },
  {
    title: 'Aider à la main',
    lines: [
      'Quand un survivant observe, fouille ou part secourir, un bouton <b>Aider</b> apparaît en bas. Il lance une épreuve de quelques secondes ; bien réussie, elle accélère le travail ou ramène le blessé en meilleur état. Elle est toujours facultative.',
    ],
  },
  {
    title: 'Objets',
    lines: [
      '<b>Leurre</b> (1 pièce) : attire les meutes proches dans la rue voisine. <b>Fumigène</b> (1 ration) : rend presque invisible vingt-cinq secondes.',
    ],
  },
  {
    title: 'L’abri, la nuit, la progression',
    lines: [
      'Les ressources rapportées servent à améliorer l’antenne, l’infirmerie, le générateur et la réserve.',
      'Chaque nuit consomme une ration par personne. Les survivants gagnent de l’expérience et choisissent une compétence par niveau, dans <b>Équipe</b>.',
      'Une journée perdue peut être rejouée, sauf en difficulté Dur.',
    ],
  },
];

/** Shown at the top of a screen the first time it is opened, and again from its « ? » button. */
export const GUIDES: Record<string, { title: string; steps: string[] }> = {
  radio: {
    title: 'La radio',
    steps: [
      'Ici s’affichent les messages des survivants, du plus récent au plus ancien.',
      'Quand un message demande une décision, le temps s’arrête. Lisez les choix : chacun dit ce qu’il risque.',
      'Un message marqué « différé » a été envoyé pendant une coupure : il est déjà vieux.',
    ],
  },
  roster: {
    title: 'L’équipe',
    steps: [
      'Une fiche par survivant : état, traits, équipement, et ce qu’il pense de vous (la confiance).',
      'Les aptitudes vont de 1 à 5 par type d’ordre. Elles progressent en pratiquant.',
      'Une étoile ★ signale une compétence à choisir : touchez-en une, le choix est définitif.',
      'En bas, les personnes secourues et ce qu’elles apportent à l’abri.',
    ],
  },
  shelter: {
    title: 'L’abri',
    steps: [
      'En haut, votre stock : médicaments, rations, pièces.',
      'Chaque amélioration a deux niveaux. L’antenne étend la zone où la radio porte, l’infirmerie soigne mieux la nuit, le générateur éclaire la cour, la réserve augmente le stock maximal.',
      'Une amélioration achetée se voit dans la cour dès le lendemain.',
    ],
  },
  debrief: {
    title: 'Le débrief',
    steps: [
      'Le tampon résume la journée : succès, mitigé ou échec.',
      '« Conséquences » liste ce qui pèsera sur les jours suivants, et les objectifs secondaires atteints.',
      '« Progression » montre l’expérience gagnée. Passez par <b>Équipe</b> s’il y a une compétence à choisir, et par <b>Abri</b> pour dépenser vos ressources, avant « Jour suivant ».',
    ],
  },
  settings: {
    title: 'Les réglages',
    steps: [
      'Qualité graphique, volumes, difficulté, taille du texte et couleurs adaptées se règlent ici.',
      '« Comment jouer » rouvre le manuel complet. « Carnet de l’opérateur » garde vos statistiques et succès.',
    ],
  },
};

/** One-time advice, said by Mara the first time something happens. */
export const TIPS: Record<string, string> = {
  day1: 'Fini l’exercice. L’objectif du jour est dans le bandeau du haut, avec deux objectifs secondaires facultatifs. La brume, c’est ce que personne n’a regardé : envoyez quelqu’un <b>reconnaître</b> avant d’y faire passer les autres.',
  refuse: 'On vient de vous dire non. Regardez ses jauges : trop de stress, trop de fatigue, ou plus assez de confiance. Rappelez-le, laissez-le souffler, ou demandez à quelqu’un d’autre.',
  link: 'Liaison perdue. Ce que vous voyez d’elle est sa dernière position connue. Vos ordres partiront quand le signal reviendra ; améliorer l’antenne à l’abri repousse cette limite.',
  hit: 'Quelqu’un prend des coups. <b>Repli</b> le ramène, un <b>fumigène</b> fait perdre sa trace, un <b>leurre</b> détourne la meute. Ne laissez pas la jauge ♥ tomber à zéro.',
  sync: 'Synchro ! Un qui regarde, un qui bouge : chaque action sous couverture la fait monter et multiplie l’expérience. Si quelqu’un se fait repérer, elle retombe à zéro.',
  assist: 'Le bouton <b>Aider</b> vient d’apparaître en bas : touchez-le pour donner un coup de main vous-même. C’est facultatif, et un essai raté ne coûte rien.',
  dusk: 'Deux minutes avant la nuit. Ceux qui ne sont pas rentrés à ce moment-là passeront la nuit dehors. <b>Repli</b> pour tout le monde.',
  down: 'Quelqu’un est à terre. Sa balise émet : sélectionnez un autre survivant et donnez l’ordre <b>Secourir</b> sur l’anneau de la balise. Chaque seconde compte.',
};

const KEY = 'last-signal.seen';
function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
export const wasSeen = (id: string) => !!load()[id];
export function markSeen(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: true }));
  } catch {
    /* ignore */
  }
}
export function resetSeen() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// The three branching incidents of the mission.
// A choice only sets up the situation; the simulation resolves what follows.
import type { Choice, GameState, SimEvent, Survivor } from './types';
import { clamp, pushRadio, remember, rnd, say, shiftTrust, survivor, survivorSignal, systemMsg, zoneOf } from './core';

function raise(s: GameState, ev: SimEvent[], incident: string, sv: Survivor | null, text: string, choices: Choice[]) {
  s.incidents[incident] = { state: 'active', by: sv?.id };
  const msg = pushRadio(s, ev, {
    from: sv?.id ?? 'unknown',
    fromName: sv?.short ?? 'Signal inconnu',
    text,
    kind: 'incident',
    incident,
    choices,
    signal: sv ? survivorSignal(s, sv) : 0.34,
  });
  s.awaiting = msg.id;
}

// ---------------------------------------------------------------- triggers

/** Called every tick for survivors standing on a node. */
export function onArrive(s: GameState, sv: Survivor, ev: SimEvent[]) {
  if (s.awaiting !== null) return;
  if (sv.at === 'bridge_w' && s.incidents.bridge.state === 'pending' && sv.mode === 'order' && sv.order?.stage === 'go') {
    const goingEast = sv.order.target && !['bridge_w', 'cross_w', 'gate', 'quay_n', 'quay_s', 'apts', 'shelter'].includes(sv.order.target);
    if (goingEast) triggerBridge(s, sv, ev);
  }
  if (sv.at === 'hosp_in' && s.incidents.hospital.state === 'pending') triggerHospital(s, sv, ev);
  if (sv.at === 'apts' && s.flags.unknownState === 'answered') resolveUnknownSite(s, sv, ev);
  if (sv.at === 'garage' && s.incidents.logbook.state === 'pending') triggerLogbook(s, sv, ev);
  if (sv.at === 'lock_e' && s.incidents.vogel.state === 'pending' && s.flags.vogelLocated) triggerVogel(s, sv, ev);
}

export function tickIncidents(s: GameState, ev: SimEvent[]) {
  if (s.awaiting !== null) return;
  // Day 3: two bearings give a position.
  if (s.incidents.vogel.state === 'pending' && !s.flags.vogelLocated && s.flags.scouted_quay_n && s.flags.scouted_east_n) {
    s.flags.vogelLocated = true;
    s.intel.lock_e.seenAt = s.time;
    systemMsg(s, ev, 'Triangulation terminée. L’émetteur est dans la cabane de l’écluse. Zone sans signal : celui que vous enverrez sera seul.', 'alert');
  }
  // Day 4: the river relay breaks through the storm.
  if (s.incidents.boat.state === 'pending' && s.time >= 150) {
    s.incidents.boat = { state: 'active' };
    const msg = pushRadio(s, ev, {
      from: 'unknown',
      fromName: 'Relais fluvial',
      text: '…à toutes les stations du canal… un bateau descend demain soir… il passera l’écluse des Tanneurs à la tombée de la nuit… douze places, pas une de plus… kkrsh… ne répondez pas sur cette fréquence, ils écoutent le bruit…',
      kind: 'incident',
      incident: 'boat',
      signal: 0.36,
      choices: [
        { id: 'open', label: 'Relayer le message à toute la ville', hint: 'D’autres survivants viendront. Les meutes aussi suivent le bruit.' },
        { id: 'quiet', label: 'Garder l’information pour ECHO-7', hint: 'Douze places. Vous savez déjà pour qui.' },
      ],
    });
    s.awaiting = msg.id;
    return;
  }
  if (s.incidents.unknown.state === 'pending' && s.time >= s.storm.start + 18) {
    raise(
      s,
      ev,
      'unknown',
      null,
      "…CHO-7… si quelqu'un… immeuble des Tanneurs, troisième étage… on a une pièce de générateur… on l'échange contre un passage… ma fille ne… kkrrsh… répondez…",
      [
        { id: 'send', label: 'Répondre : on envoie quelqu’un', hint: 'Marque l’immeuble des Tanneurs comme cible. Peut être un piège.' },
        { id: 'proof', label: 'Analyser le signal', hint: '20 secondes d’écoute. Fiabilité selon l’antenne.' },
        { id: 'ignore', label: 'Ne pas répondre', hint: 'Le signal restera sans réponse.' },
      ],
    );
  }
  if (s.flags.unknownState === 'proof' && s.time >= (s.flags.proofAt as number)) {
    const truth = s.flags.unknownTruth as string;
    const accurate = rnd(s) < 0.62 + 0.19 * s.shelter.antenna;
    const reading = accurate ? truth : truth === 'genuine' ? 'lure' : 'genuine';
    s.flags.unknownReading = reading;
    s.flags.unknownState = 'none';
    raise(
      s,
      ev,
      'unknown',
      null,
      reading === 'genuine'
        ? 'Analyse ECHO-7 : respiration, bruit de fond variable, une seconde voix plus aiguë. Émission en direct.'
        : 'Analyse ECHO-7 : la phrase revient à l’identique toutes les quatorze secondes. Enregistrement en boucle.',
      [
        { id: 'send', label: 'Envoyer quelqu’un', hint: 'Cible : immeuble des Tanneurs.' },
        { id: 'ignore', label: 'Couper la fréquence', hint: 'Le signal restera sans réponse.' },
      ],
    );
  }
}

// ---------------------------------------------------------------- bridge

function triggerBridge(s: GameState, sv: Survivor, ev: SimEvent[]) {
  if (!sv.linked) {
    const c = sv.courage > 60 ? 'stealth' : sv.fear > 45 ? 'back' : 'detour';
    sv.outbox.push({ time: s.time, text: 'Pas de liaison au pont. J’ai décidé sans vous.' });
    applyBridge(s, sv, c, ev);
    return;
  }
  const choices: Choice[] = [
    { id: 'stealth', label: 'Passer en silence', hint: 'Lent, à couvert derrière le bus. Risque d’être repéré au checkpoint.' },
  ];
  if (s.resources.flares > 0)
    choices.push({ id: 'flare', label: 'Fusée éclairante vers les entrepôts', hint: `Attire la meute au sud-est. ${s.resources.flares} fusée restante, et le bruit réveille le quartier.` });
  choices.push({ id: 'detour', label: 'Détour par l’écluse', hint: 'Plus long, à découvert, zone sans signal radio.' });
  choices.push({ id: 'back', label: 'Demi-tour', hint: 'Repli vers ECHO-7.' });
  raise(
    s,
    ev,
    'bridge',
    sv,
    sv.id === 'jo'
      ? "Je suis au pont. Y a un bus en travers et des silhouettes derrière les barrières du checkpoint. Plus que ce qu'on disait hier. Je fais quoi ?"
      : sv.id === 'lena'
        ? "Je… je suis au pont. Il y a un bus couché, et des gens debout au checkpoint. Ils ne bougent pas. Ce ne sont pas des gens. Qu'est-ce que je fais ?"
        : s.day > 1
          ? 'Rive ouest du pont. Le checkpoint est toujours occupé, et ils ont l’air plus nerveux qu’hier. Vos ordres ?'
          : "Rive ouest du pont. Un bus bloque le tablier, je peux me faufiler. Mais il y a du monde au checkpoint, et l'info d'hier était fausse : ils sont plus nombreux. Vos ordres ?",
    choices,
  );
}

function applyBridge(s: GameState, sv: Survivor, choice: string, ev: SimEvent[]) {
  s.incidents.bridge = { state: 'resolved', choice, by: sv.id };
  if (choice === 'stealth') {
    sv.tactic = 'stealth';
    say(s, ev, sv, sv.id === 'jo' ? 'Sur la pointe des pieds. Pas mon fort.' : 'Je longe le bus. Silence radio.');
  } else if (choice === 'flare') {
    s.resources.flares--;
    s.flags.flareUsed = true;
    s.persistent.flareUsed = true;
    ev.push({ type: 'flare', node: 'east_s' });
    for (const th of s.threats) {
      const z = zoneOf(th);
      if (z === 'bridge_e' || z === 'cross_e' || z === 'bridge_mid') {
        th.state = 'lured';
        th.goal = 'east_s';
        th.target = null;
        th.timer = 150;
      } else if (z === 'east_s' && th.state === 'dormant') {
        th.state = 'wander';
        th.timer = 60;
      }
    }
    say(s, ev, sv, 'Fusée tirée. Ils lèvent tous la tête… ils partent vers les entrepôts. Le pont se vide.');
    remember(s, sv, 'A tiré la dernière fusée pour vider le checkpoint.', 0.2);
  } else if (choice === 'detour') {
    sv.tactic = 'detour';
    say(s, ev, sv, 'Par l’écluse, alors. Vous allez me perdre un moment là-bas.');
  } else {
    sv.order = { type: 'retreat', target: 'shelter', stage: 'go', issuedAt: s.time };
    say(s, ev, sv, 'Demi-tour. On trouvera autre chose.');
  }
}

// ---------------------------------------------------------------- hospital

function triggerHospital(s: GameState, sv: Survivor, ev: SimEvent[]) {
  const second = !!s.persistent.inesLeft;
  if (!sv.linked) {
    const c = second ? 'ines' : sv.id === 'jo' ? 'meds' : sv.id === 'mara' ? 'all' : 'ines';
    sv.outbox.push({
      time: s.time,
      text: second
        ? 'Hors réseau à Saint-Roch. Inès était encore là. Je la ramène.'
        : 'Hors réseau à Saint-Roch. Il y avait des survivants. J’ai tranché sans vous.',
    });
    applyHospital(s, sv, c, ev);
    return;
  }
  if (second) {
    raise(s, ev, 'hospital', sv, 'Saint-Roch. Inès est toujours dans la pharmacie. Seule. Elle dit qu’il est mort dans la nuit. Elle ne nous regarde pas.', [
      { id: 'ines', label: 'La ramener', hint: 'Escorte : déplacement ralenti.' },
      { id: 'meds', label: 'Médicaments seulement', hint: 'Elle reste. Encore.' },
    ]);
    return;
  }
  raise(
    s,
    ev,
    'hospital',
    sv,
    sv.id === 'jo'
      ? "Je suis dans la pharmacie de Saint-Roch. Y a les médocs. Y a aussi une infirmière, Inès, et un type avec la jambe en vrac qui peut pas marcher. Je peux pas tout porter."
      : "Pharmacie de Saint-Roch. Le stock est là. Et il y a des vivants : une infirmière, Inès Duval, et un patient, fracture ouverte, il ne marchera pas. Si on le porte, on rentre lentement et les mains presque vides.",
    [
      { id: 'all', label: 'Évacuer tout le monde', hint: 'Très lent, bruyant. Peu de médicaments emportés.' },
      { id: 'ines', label: 'Inès et les médicaments', hint: 'Le patient reste, avec de l’eau et une radio.' },
      { id: 'meds', label: 'Les médicaments, rien d’autre', hint: 'Rapide. Inès refusera de l’abandonner.' },
    ],
  );
}

function applyHospital(s: GameState, sv: Survivor, choice: string, ev: SimEvent[]) {
  const second = !!s.persistent.inesLeft;
  s.incidents.hospital = { state: 'resolved', choice, by: sv.id };
  const stock = s.loot.hosp_in;
  const cap = sv.carryCap + s.shelter.storage;
  let take = 0;
  const compassion = sv.id === 'mara' ? 1.4 : sv.id === 'lena' ? 1 : -0.3;

  if (choice === 'all') {
    take = Math.min(2, stock.medicine);
    sv.escort.ines = true;
    sv.escort.patient = true;
    shiftTrust(sv, Math.round(5 * compassion));
    remember(s, sv, 'A porté un blessé hors de Saint-Roch sur ordre de l’opérateur.', 0.6);
    say(s, ev, sv, sv.id === 'jo' ? 'On le porte. On va y rester, mais on le porte.' : 'On prend tout le monde. Inès m’aide à le porter. On sort.');
  } else if (choice === 'ines') {
    take = Math.min(cap + 1, stock.medicine);
    sv.escort.ines = true;
    if (!second) {
      s.persistent.patientLeft = true;
      s.unresolved.push('Saint-Roch : la radio laissée au patient émet encore, par intermittence.');
      shiftTrust(sv, Math.round(-5 * compassion));
      remember(s, sv, 'A laissé un homme blessé à Saint-Roch. Ordre de l’opérateur.', -0.6, 'left', 'hosp_in');
      say(s, ev, sv, 'Inès vient avec nous. Lui… on lui laisse de l’eau et la radio. Il a compris.');
    } else {
      s.persistent.inesLeft = false;
      shiftTrust(sv, 4);
      say(s, ev, sv, 'Elle vient. Elle ne dit rien, mais elle vient.');
    }
  } else {
    take = Math.min(cap + 1, stock.medicine);
    s.persistent.inesLeft = true;
    if (!second) s.persistent.patientLeft = true;
    s.unresolved.push('Saint-Roch : Inès Duval appelle toujours sur le canal 4.');
    shiftTrust(sv, Math.round(-10 * Math.max(0.3, compassion)));
    sv.fear = clamp(sv.fear + 5);
    remember(s, sv, 'A pris les médicaments et laissé les vivants. Ordre de l’opérateur.', -0.8, 'left', 'hosp_in');
    say(s, ev, sv, sv.id === 'jo' ? 'J’ai les médocs. Elle a refusé de bouger. Tant pis.' : 'J’ai le stock. Inès refuse de le quitter. Je… je sors.');
  }
  stock.medicine -= take;
  sv.carrying.medicine += take;
  s.intel.hosp_in.lootKnown = true;
  sv.order = { type: 'retrieve', target: 'hosp_in', stage: 'return', issuedAt: s.time };
  sv.mode = 'order';
  sv.modeSince = s.time;
}

// ---------------------------------------------------------------- unknown signal

function applyUnknown(s: GameState, choice: string, ev: SimEvent[]) {
  if (choice === 'send') {
    s.flags.unknownState = 'answered';
    s.incidents.unknown = { state: 'resolved', choice };
    systemMsg(s, ev, 'Réponse émise. Cible marquée : immeuble des Tanneurs. Envoyez quelqu’un avant la nuit.');
  } else if (choice === 'proof') {
    s.flags.unknownState = 'proof';
    s.flags.proofAt = s.time + 20;
    s.incidents.unknown = { state: 'active' };
    systemMsg(s, ev, 'Écoute en cours sur la fréquence inconnue…');
  } else {
    s.flags.unknownState = 'ignored';
    s.incidents.unknown = { state: 'resolved', choice };
    s.unresolved.push('Immeuble des Tanneurs : un appel resté sans réponse.');
    const lena = survivor(s, 'lena');
    if (lena?.alive) {
      shiftTrust(lena, -4);
      remember(s, lena, 'L’opérateur a coupé la fréquence pendant qu’une voix appelait.', -0.4);
    }
  }
}

function resolveUnknownSite(s: GameState, sv: Survivor, ev: SimEvent[]) {
  s.flags.unknownState = 'resolved';
  if (s.flags.unknownTruth === 'genuine') {
    sv.escort.sacha = true;
    sv.carrying.parts += 2;
    s.flags.unknownOutcome = 'rescued';
    shiftTrust(sv, 5);
    remember(s, sv, 'A trouvé Sacha et sa fille aux Tanneurs. Le signal était vrai.', 0.7);
    say(s, ev, sv, 'Ils sont là. Un père, une gamine. Et la pièce de générateur. On les ramène.');
    sv.order = { type: 'rescue', target: 'apts', stage: 'return', issuedAt: s.time };
    sv.mode = 'order';
  } else {
    s.flags.unknownOutcome = 'lure';
    s.persistent.lureFound = true;
    s.threats.push({ id: s.nextThreatId++, at: 'apts', to: null, progress: 0, size: 3, state: 'hunt', target: sv.id, goal: null, timer: 0, seen: true });
    sv.fear = clamp(sv.fear + 25);
    shiftTrust(sv, -8);
    remember(s, sv, 'Le signal des Tanneurs était un piège. L’opérateur l’y avait envoyé·e.', -0.7, 'lure', 'apts');
    say(s, ev, sv, 'C’est un magnétophone ! Sur une table ! Et ils sont dans la cage d’escalier— c’est un piège !', 'alert');
    s.unresolved.push('Tanneurs : quelqu’un a posé cet émetteur. On ne sait pas qui.');
  }
}

// ---------------------------------------------------------------- day 2: the logbook

function triggerLogbook(s: GameState, sv: Survivor, ev: SimEvent[]) {
  const jo = survivor(s, 'jo');
  if (!jo?.alive) {
    s.incidents.logbook = { state: 'resolved', choice: 'none' };
    return;
  }
  if (!sv.linked) {
    sv.outbox.push({ time: s.time, text: sv.id === 'jo' ? 'J’ai trouvé le carnet de bord du convoi. Je l’ai lu. Vous auriez pu me le dire.' : 'J’ai trouvé un carnet de bord au garage. Je l’ai donné à Jo. Il avait le droit de savoir.' });
    applyLogbook(s, sv, 'truth', ev);
    return;
  }
  raise(
    s,
    ev,
    'logbook',
    sv,
    sv.id === 'jo'
      ? 'Garage Lorentz. Y a le camion de mon frère sur le pont élévateur. Et son carnet de bord dans la boîte à gants. La dernière page, c’est une transcription radio. Un ordre d’ECHO-7. Je… lisez-la-moi, vous. Vous avez les archives. Qu’est-ce que l’opérateur lui a dit ?'
      : 'Garage Lorentz. J’ai trouvé un carnet de bord, celui du convoi du frère de Jo. La dernière page recopie un ordre d’ECHO-7 : « Passez par le checkpoint. Faites du bruit. » Signé E. Vogel, opérateur. Il les a envoyés servir d’appât. Qu’est-ce que je fais de ça ?',
    [
      { id: 'truth', label: 'Dire la vérité à Jo', hint: 'Vogel, l’ancien opérateur, a sacrifié le convoi pour éloigner une meute de l’abri.' },
      { id: 'lied', label: '« Il est mort en couvrant les autres »', hint: 'Un mensonge qui tient tant que personne ne le contredit.' },
      { id: 'hidden', label: 'Brûler le carnet', hint: 'Jo ne saura rien. Celui qui l’a trouvé, si.' },
    ],
  );
}

function applyLogbook(s: GameState, finder: Survivor, choice: string, ev: SimEvent[]) {
  s.incidents.logbook = { state: 'resolved', choice, by: finder.id };
  s.persistent.joTruth = choice;
  const jo = survivor(s, 'jo')!;
  if (choice === 'truth') {
    jo.fear = clamp(jo.fear + 12);
    shiftTrust(jo, finder.linked ? 12 : -6);
    remember(s, jo, 'Sait que l’ancien opérateur, Vogel, a envoyé son frère servir d’appât.', -0.5, 'truth');
    if (jo.linked) say(s, ev, jo, 'Vogel. D’accord. Au moins vous, vous me l’avez dit. …Je finis de charger et je rentre.');
  } else if (choice === 'lied') {
    shiftTrust(jo, 5);
    remember(s, jo, 'L’opérateur lui a dit que son frère était mort en couvrant le convoi.', 0.3, 'truth');
    if (finder !== jo) {
      shiftTrust(finder, -6);
      remember(s, finder, 'Sait que l’opérateur a menti à Jo sur la mort de son frère.', -0.5);
    }
    if (jo.linked) say(s, ev, jo, 'En couvrant les autres. Ouais. Ça lui ressemble. …Merci.');
  } else {
    shiftTrust(finder, finder === jo ? -15 : -8);
    remember(s, finder, 'A brûlé le carnet du convoi sur ordre de l’opérateur.', -0.5);
    say(s, ev, finder, finder === jo ? 'Vous voulez que je brûle le carnet de mon frère. Sans le lire. …C’est fait. Ne me demandez plus rien aujourd’hui.' : 'C’est brûlé. J’espère que vous savez ce que vous faites.');
  }
}

// ---------------------------------------------------------------- day 3: the man at the lock

function triggerVogel(s: GameState, sv: Survivor, ev: SimEvent[]) {
  if (!sv.linked) {
    const c = sv.id === 'mara' ? 'bring' : sv.id === 'jo' ? (s.persistent.joTruth === 'truth' ? 'take' : 'bring') : 'leave';
    sv.outbox.push({ time: s.time, text: 'J’ai trouvé l’émetteur, et l’homme qui le déplace. Elias Vogel. L’ancien opérateur. Pas de liaison : j’ai décidé.' });
    applyVogel(s, sv, c, ev);
    return;
  }
  raise(
    s,
    ev,
    'vogel',
    sv,
    'Cabane de l’écluse. Il y a un homme, des magnétophones partout, des batteries de voiture. Il dit s’appeler Elias Vogel. Il dit qu’il tenait votre micro avant vous. Ses boucles, c’est pour attirer les meutes loin du canal, pas pour piéger des gens. Il a l’air de ne pas avoir dormi depuis un mois.',
    [
      { id: 'bring', label: 'Le ramener à ECHO-7', hint: 'Escorte lente. Il connaît les fréquences et les vannes de l’écluse.' },
      { id: 'leave', label: 'Le laisser, avec une ration', hint: 'Coûte 1 ration. Il continuera d’éloigner les meutes du canal.' },
      { id: 'take', label: 'Prendre ses batteries et son matériel', hint: '+2 pièces. Plus de leurres sur le canal.' },
    ],
  );
}

function applyVogel(s: GameState, sv: Survivor, choice: string, ev: SimEvent[]) {
  s.incidents.vogel = { state: 'resolved', choice, by: sv.id };
  const jo = survivor(s, 'jo');
  if (choice === 'bring') {
    sv.escort.vogel = true;
    s.persistent.vogel = 'escorted';
    say(s, ev, sv, sv.id === 'jo' ? 'Il vient. Je marche derrière lui. Qu’il se retourne pas.' : 'Il vient avec nous. Il porte un seul magnétophone, il n’a pas voulu le lâcher.');
  } else if (choice === 'leave') {
    s.persistent.vogel = 'ally';
    s.resources.supplies = Math.max(0, s.resources.supplies - 1);
    shiftTrust(sv, 2);
    say(s, ev, sv, 'Il reste. Il dit qu’il ouvrira les vannes si on en a besoin un jour. Je crois qu’il a honte de rentrer.');
  } else {
    s.persistent.vogel = 'robbed';
    sv.carrying.parts += 2;
    shiftTrust(sv, sv.id === 'jo' ? 4 : -6);
    remember(s, sv, 'A pris à un vieil homme les batteries qui le protégeaient.', sv.id === 'jo' ? 0.1 : -0.6);
    say(s, ev, sv, sv.id === 'jo' ? 'J’ai ses batteries. Il a pas discuté. Il savait qui j’étais.' : 'J’ai le matériel. Il n’a rien dit. Il a juste éteint ses machines une par une.');
  }
  if (jo?.alive && s.persistent.joTruth === 'lied' && !s.persistent.joKnows) {
    s.persistent.joKnows = true;
    shiftTrust(jo, -24);
    remember(s, jo, 'Vogel a raconté le convoi. L’opérateur lui avait menti.', -0.9, 'truth');
    if (jo.linked) say(s, ev, jo, '« Faites du bruit. » C’est ce qu’il leur a dit. Et vous, vous m’avez dit qu’il était mort en héros. Vous êtes pareil que lui.', 'alert');
    else jo.outbox.push({ time: s.time, text: 'Vogel m’a tout dit. Vous m’avez menti.' });
  }
  sv.order = { type: 'rescue', target: 'lock_e', stage: 'return', issuedAt: s.time };
  sv.mode = 'order';
  sv.modeSince = s.time;
}

// ---------------------------------------------------------------- day 5: the last signal

function applyFinal(s: GameState, choice: string, ev: SimEvent[]) {
  s.flags.final = choice;
  s.persistent.final = choice;
  if (choice === 'leave') {
    const held = s.persistent.vogel === 'rescued' || s.persistent.vogel === 'ally';
    s.flags.boatAt = held ? s.duration - 5 : 430;
    s.intel.lock_e.seenAt = 0;
    systemMsg(s, ev, held ? 'Le bateau attendra à l’écluse jusqu’à la nuit. Envoyez tout le monde, et qu’ils tiennent la position.' : 'Sans personne aux vannes, le bateau repartira vers 18h50. Envoyez tout le monde à l’écluse, vite.', 'alert');
    for (const o of s.survivors) if (o.alive) shiftTrust(o, o.id === 'lena' ? 6 : 0);
  } else {
    systemMsg(s, ev, 'ECHO-7 reste à l’antenne. Il faut deux pièces pour l’amplificateur avant la nuit.');
    for (const o of s.survivors) if (o.alive) shiftTrust(o, o.id === 'mara' ? 6 : o.id === 'lena' ? -6 : 0);
  }
}

// ---------------------------------------------------------------- operator decision

export function resolveChoice(s: GameState, choiceId: string, ev: SimEvent[]): boolean {
  if (s.awaiting === null) return false;
  const msg = s.radio.find((m) => m.id === s.awaiting);
  s.awaiting = null;
  if (!msg || !msg.incident) return false;
  msg.chosen = choiceId;
  const sv = msg.from ? survivor(s, msg.from) : undefined;
  switch (msg.incident) {
    case 'briefing':
      if (choiceId === 'leave' || choiceId === 'stay') applyFinal(s, choiceId, ev);
      break;
    case 'logbook':
      if (sv) applyLogbook(s, sv, choiceId, ev);
      break;
    case 'vogel':
      if (sv) applyVogel(s, sv, choiceId, ev);
      break;
    case 'boat':
      s.incidents.boat = { state: 'resolved', choice: choiceId };
      s.persistent.boat = choiceId;
      systemMsg(s, ev, choiceId === 'open' ? 'Message relayé sur toutes les fréquences. Demain soir, l’écluse ne sera pas vide.' : 'Fréquence coupée. Demain soir, à l’écluse. Personne d’autre ne le sait.');
      for (const o of s.survivors) if (o.alive) shiftTrust(o, choiceId === 'open' ? (o.id === 'jo' ? -3 : 4) : o.id === 'jo' ? 3 : -4);
      break;
    case 'bridge':
      if (sv) applyBridge(s, sv, choiceId, ev);
      break;
    case 'hospital':
      if (sv) applyHospital(s, sv, choiceId, ev);
      break;
    case 'unknown':
      applyUnknown(s, choiceId, ev);
      break;
  }
  return true;
}

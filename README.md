# LAST SIGNAL

Stratégie de survie isométrique, mobile-first. Vous êtes l'opérateur radio d'ECHO-7 : trois survivants autonomes
exécutent (ou refusent) vos ordres dans un quartier en ruine, et vous ne voyez que ce qu'ils vous rapportent.

Tranche verticale 0.2 — web (three.js + TypeScript), hors-ligne, aucun appel réseau ni LLM.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build statique dans dist/ (PWA installable, service worker)
npm test           # simulation en headless, sans rendu
```

## Jouer

1. Touchez un survivant (panneau gauche ou carte).
2. Donnez un ordre : Reconnaître, Récupérer, Tenir, Repli, Secourir.
3. Touchez une destination surlignée, vérifiez le tracé, puis **Transmettre**.

Objectif du jour : rapporter au moins 2 doses de médicaments de l'hôpital Saint-Roch avant la nuit (10 minutes).
Glisser pour déplacer la caméra, pincer ou molette pour zoomer, mini-carte pour sauter.

## Ce que contient la tranche

- **Carte** : un îlot urbain coupé par un canal — pont, checkpoint, écluse, hôpital, abri radio, 3 rues,
  3 intérieurs abstraits (le toit s'allume quand quelqu'un est dedans).
- **Simulation** (`src/sim`, sans DOM ni rendu) : santé, peur, fatigue, courage, confiance, équipement, relations,
  mémoire. Chaque seconde, chaque survivant note ses options (obéir, fuir, se cacher, se battre, se reposer,
  secourir, rentrer) et prend la meilleure : les ordres peuvent être refusés, interrompus ou repris.
- **Brouillard de guerre et renseignement périmé** : la carte montre le dernier rapport, avec son âge.
  Hors réseau, un survivant devient un fantôme à sa dernière position connue ; les ordres attendent le retour du
  signal, les rapports arrivent en différé, et les incidents sont tranchés sans vous.
- **Un arc en 5 jours** (`src/sim/missions.ts`), une mission par jour :
  1. *Saint-Roch* — rapporter des médicaments (incidents : le pont, l'hôpital, le signal inconnu).
  2. *Le carnet de Lorentz* — des pièces au garage, et ce qu'on y apprend sur le frère de Jo.
  3. *La voix dans la boucle* — deux relevés pour trianguler l'émetteur, puis l'homme de l'écluse.
  4. *Avant l'orage* — pont coupé, orage toute la journée, et un message du relais fluvial.
  5. *Dernier signal* — partir par le bateau ou rester à l'antenne. Épilogue selon tout ce qui a précédé.
- **Script vivant** : répliques par personnage, ton selon la confiance, rappels de mémoire
  (« J'avais dit non pour le checkpoint. Vous insistez. »), échanges entre survivants qui font bouger leurs relations.
- **Directeur d'événements** (`src/sim/director.ts`) : une petite IA de rythme lit la tension de la mission et
  injecte un événement pour relancer ou soulager — meute en marche, parasites radio, façade effondrée, alarme de
  voiture, averse, sac abandonné, inconnu qui appelle à l'aide. Déterministe, hors-ligne, sans script.
- **Progression** (`src/sim/perks.ts`) : expérience par action, niveaux, et une compétence à choisir par niveau
  parmi quatre propres à chaque survivant.
- **Formation « Prise de poste »** : une journée d'entraînement scénarisée, menée par Mara à la radio, en onze
  étapes (reconnaître, récupérer, secourir un blessé). Chaque étape attend le vrai geste et désigne où toucher.
  Proposée à la première partie, passable, rejouable depuis les réglages.
- **Habillage post-apo** : panneaux d'acier usé, rivets, bandes de signalisation, titres au pochoir, texte radio
  en machine à écrire, débrief sur papier de rapport. Polices embarquées, textures générées avec Magnific.
- **Illustrations** (`public/art`) : 8 portraits et 20 scènes peints, générés avec Magnific puis embarqués en
  WebP (1,4 Mo au total, mis en cache pour le hors-ligne). Les incidents du pont et de l'hôpital ont une scène
  par survivant ; les événements du directeur s'affichent en carte illustrée.
- **Une couleur par ordre** : Reconnaître (cyan), Récupérer (ambre), Tenir (bleu-gris), Repli (violet),
  Secourir (rose), reprise sur les boutons, les tracés, les anneaux et les statuts.
- **Aptitudes** : chaque survivant est noté de 1 à 5 par type d'ordre (Lena en reconnaissance, Jo en
  récupération, Mara en secours). L'aptitude joue sur la vitesse, la discrétion, l'acceptation de l'ordre, et
  monte avec la pratique.
- **Couverture et Synchro** (`src/sim/cover.ts`) : un survivant qui tient un point couvre ses voisins
  (pointillés sur la carte). Sous couverture, on est moins repéré et on a moins peur ; chaque action couverte fait
  monter la Synchro de l'équipe, qui multiplie l'expérience et rapporte un bonus tous les trois points. Se faire
  repérer la remet à zéro.
- **Scènes dialoguées** (`src/sim/scenes.ts`, `src/ui/cine.ts`) : une scène d'introduction, puis une veillée
  entre chaque journée, dont les répliques dépendent des survivants en vie et des décisions prises. Elles se
  jouent dans le monde 3D, autour du brasero : carte d'ouverture illustrée, bandes cinéma, personnages qui
  marchent jusqu'à leur place, s'accroupissent, se tournent le dos ou pointent du doigt, caméra qui se resserre
  sur celui qui parle (plan serré, plan à deux, plan large), bulle au-dessus de sa tête avec texte progressif,
  didascalies en légende, éclairage propre à la scène (crépuscule, nuit, orage). Un tap termine la réplique,
  le suivant passe à la suite ; « Passer la scène » ou Échap l'interrompt.
- **Personnages 3D réalistes** (`public/models`) : Mara, Jo et Lena sont des modèles texturés avec squelette,
  animés par le code (marche, course, accroupi, port). Le squelette est reconnu par sa forme, pas par ses noms.
- **Son** (`src/ui/audio.ts`) : tout est synthétisé, sans fichier audio. Vent, pluie selon l'orage, crépitement
  du brasero quand la caméra est sur la cour, nappe musicale qui se tend avec le danger (battement de cœur),
  bruitages (coup, grognement, fusée, Synchro, ordre reçu ou refusé, fin de journée). Quatre volumes séparés.
- **Difficulté** : Calme, Normal, Dur (détection et dégâts). En Calme et Normal, une journée perdue peut être
  rejouée depuis son début, avec d'autres tirages ; pas en Dur.
- **Ordres enchaînés** : quand un survivant a déjà un ordre, « Ensuite » programme le suivant, transmis dès qu'il
  est libre.
- **Objets tactiques** (`src/sim/items.ts`) : hors de l'abri, un survivant peut lancer un leurre (1 pièce : les
  meutes proches se ruent dans la rue voisine) ou un fumigène (1 ration : 25 s presque invisible, la meute qui
  chasse perd la trace).
- **Journées variables** : à chaque partie, une cache change de place et une meute peut apparaître ailleurs.
- **Carnet de l'opérateur** (`src/ui/profile.ts`) : statistiques et 11 succès, conservés entre les parties.
- **Confort** : taille du texte (3 niveaux), palette d'ordres adaptée au daltonisme, symbole par type d'ordre.
- **Signalement** (`src/ui/report.ts`) : les erreurs restent sur l'appareil ; « Copier le rapport » dans les
  réglages produit un diagnostic à coller dans un message. Écran « À propos » : crédits et confidentialité.
- **Abri** : antenne, infirmerie, générateur, réserve (2 niveaux chacun, visibles dans la cour).
- **Débrief** : pertes, secourus, butin, conséquences, signaux non résolus.
- **Sauvegarde locale** automatique (`localStorage`), simulation déterministe par graine.
- **Voix parlées** en option (Réglages) : synthèse vocale du navigateur, hors-ligne, qualité variable.

## Architecture

```
src/sim/      état JSON pur, pas à pas fixe (0,25 s), RNG dans la sauvegarde
src/render/   three.js : ville procédurale fusionnée par matériau, acteurs, caméra orthographique
src/ui/       HUD et écrans en DOM
tests/        vitest : journée complète, déterminisme, sauvegarde, perte de signal, arc de 5 jours
```

## Performance

Toute la ville statique est fusionnée en une poignée de maillages (≈ 45–60 draw calls, ≈ 60 k triangles),
la horde est un seul `InstancedMesh`. Trois paliers de qualité (Léger / Moyen / Élevé : ombres, taille des
textures, densité de végétation, anticrénelage) plus une résolution dynamique qui protège la cadence.
Réglages → **Profilage** affiche FPS, draw calls, triangles et échelle de résolution pour mesurer sur un
appareil réel.

## Limites connues

- La ville est procédurale (aucun pack d'assets) : la direction artistique « haute fidélité PBR »
  du brief demande les packs listés et un moteur natif ; cette tranche valide la boucle de jeu, la caméra,
  la lisibilité et le budget mobile.
- Le comparatif Unity URP / Unreal n'a pas été fait ici. `src/sim` ne dépend d'aucun moteur et se porte tel quel.
- Une seule carte : les 5 missions se jouent sur le même îlot. Pas d'intérieurs à plusieurs pièces.
- L'équilibrage vient d'opérateurs scriptés, pas de vrais joueurs.

L'ancien prototype « DJ Block World » est conservé dans `legacy/dj-block-world/`.

# Vérifier un jeu 3D dans un navigateur sans écran

## Mise en place
- Construire, puis servir la version construite (`vite preview`), pas le serveur de développement : c'est elle que
  verra le joueur.
- Lancer Chromium avec le rendu logiciel : `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
  --ignore-gpu-blocklist`.
- Exposer l'objet du jeu sur `window` pour piloter l'état : avancer le temps, donner un ordre, forcer une situation.
- Relever les erreurs de page et de console, et les réponses HTTP en erreur, à chaque parcours.

## Ce qu'il faut capturer à chaque passe
- L'écran touché, en paysage (1000 × 560) et en portrait (390 × 760).
- Pour une animation : des poses figées (phase et vitesse imposées), de face et de profil, en gros plan.
- Assembler plusieurs captures en une planche pour les comparer d'un coup d'œil.

## Pièges
- **Le rendu logiciel est très lent** (parfois une image par seconde). Tout ce qui dépend du temps réel paraît cassé :
  texte progressif, minuteries, mini-jeux. Pour tester une logique d'interface, neutraliser le rendu 3D le temps du
  test, ou baser les minuteries sur l'horloge réelle et le savoir.
- **Les animations d'apparition** laissent des éléments transparents sur la capture : attendre, ou éviter de partir
  d'une opacité nulle.
- **Un écran étroit en portrait** peut afficher un panneau « tournez l'appareil » qui intercepte les clics.
- **Un robot ne juge pas la difficulté.** Un mini-jeu réussi à 3 sur 7 par le script ne dit rien du ressenti au doigt.
  Le dire dans le compte rendu.
- **Le cache hors ligne** sert l'ancienne version : comparer le nom du fichier construit à celui servi après
  déploiement, et prévenir l'utilisateur de recharger.

## Mesurer plutôt que regarder
Quand une image laisse un doute, lire les valeurs : position et orientation réelles d'un os, poids des clips, état de
la simulation. Une mesure tranche en une commande ce qu'un regard laisse en suspens.

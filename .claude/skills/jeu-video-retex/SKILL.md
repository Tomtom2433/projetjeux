---
name: jeu-video-retex
description: "Méthode et retour d'expérience pour concevoir, construire et faire évoluer un jeu vidéo avec Claude (web three.js/TypeScript en priorité, mais les principes valent ailleurs). À utiliser dès que l'utilisateur veut créer un jeu, un prototype jouable, une tranche verticale, ajouter une mécanique, un tutoriel, des animations de personnages, des mini-jeux, une interface de jeu mobile, des modèles 3D ou des images générées pour un jeu, ou demande « liste les manques », « améliore le gameplay », « go les jalons » sur un projet de jeu. Capitalise sur la session LAST SIGNAL : erreurs à ne pas refaire, idées qui ont marché, recettes techniques (squelettes et animations partagés, tests sans écran, déploiement)."
---

# Construire un jeu avec Claude : méthode et retour d'expérience

Cette skill vient d'une vraie session : LAST SIGNAL, un jeu de survie isométrique en 3D pour mobile, construit de zéro
jusqu'à une version jouable (campagne, personnages animés, mini-jeux, tutoriel, base à équiper). Elle dit ce qui a
marché, ce qui a coûté du temps pour rien, et comment s'y prendre la prochaine fois.

Lire d'abord cette page. Ouvrir une référence seulement quand le sujet se présente :

- `references/erreurs-et-bonnes-idees.md` : la liste détaillée, avec la cause de chaque erreur et la parade.
- `references/pipeline-3d.md` : personnages réalistes, squelette commun, clips d'animation partagés, coûts.
- `references/tests-sans-ecran.md` : vérifier un jeu 3D dans un navigateur sans écran, et ses pièges.
- `references/checklist-v1.md` : ce qu'il faut avant de montrer le jeu à de vrais joueurs.
- `scripts/glb_clips.py` : convertit des modèles animés en un fichier de clips partagé et allège un modèle.

## Les sept règles qui comptent le plus

1. **La simulation d'abord, sans affichage.** Écrire les règles du jeu comme des fonctions pures sur un état
   sérialisable, avec un pas de temps fixe et un générateur aléatoire stocké dans l'état. C'est ce qui a permis de
   tester une campagne entière en quelques secondes, de sauvegarder par simple JSON, et de rejouer une journée.
   L'affichage et l'interface lisent cet état ; ils ne décident rien.

2. **Une idée de jeu en une phrase, et une mécanique qui la sert.** Ici : « vous ne déplacez personne, vous donnez
   des ordres par radio à des gens qui peuvent refuser ». Chaque ajout a été jugé à cette aune (brouillard,
   liaison perdue, confiance). Une fonctionnalité qui ne sert pas la phrase attend.

3. **Regarder avant d'affirmer.** Une capture d'écran regardée vaut plus que dix lignes de raisonnement. Presque
   toutes les erreurs de cette session ont été trouvées en regardant une image, ou par l'utilisateur sur son
   téléphone alors qu'elles auraient pu l'être avant. Quand une image contredit le code, mesurer (voir règle 5).

4. **Le téléphone en portrait est l'écran de référence.** Tester à 390 × 760 dès le premier écran d'interface, pas
   à la fin. Les chevauchements du HUD, les textes coupés et les boutons trop petits ne se voient qu'à cette taille.

5. **Quand quelque chose « a l'air faux », mesurer au lieu de deviner.** Exemple vécu : des personnages semblaient mal
   orientés. La mesure (direction réelle des pieds contre direction demandée) a montré que le rendu était exact et
   que c'étaient les indications de mise en scène qui étaient fausses. Deviner aurait coûté une heure.

6. **Dire le coût avant de dépenser, et ce qui n'a pas été vérifié après.** Toute génération payante (images, modèles
   3D, clips) s'annonce avec son prix. Tout compte rendu sépare « vérifié à l'écran », « vérifié par test » et « non
   vérifié ». Ne jamais dire qu'une chose est livrée sans l'avoir rouverte.

7. **Petits jalons, chacun déployé.** Un commit, un déploiement et une capture par jalon. L'utilisateur réagit à ce
   qu'il voit sur son téléphone ; plus la boucle est courte, plus le jeu converge.

## Dérouler un projet de jeu

### 1. Cadrer (une demi-heure, pas plus)
- Reformuler le jeu en une phrase et trois verbes de joueur.
- Fixer la tranche verticale : un lieu, trois personnages, dix minutes, une fin. Tout le reste est « plus tard ».
- Choisir la pile la plus simple qui tient l'objectif. Pour un jeu web mobile : Vite, TypeScript strict, three.js,
  vitest, pas de moteur. Sauvegarde locale, hors ligne, aucun serveur.

### 2. Construire dans cet ordre
1. État, règles, tests de simulation (une partie complète jouée par un script).
2. Rendu minimal lisible (formes simples, couleurs franches), caméra, sélection.
3. Interface de jeu, d'abord en portrait.
4. Tutoriel jouable : c'est lui qui révèle les trous de l'interface.
5. Contenu (journées, incidents, dialogues), puis seulement l'habillage (modèles, animations, illustrations, son).

L'habillage avant le tutoriel est le piège classique : on polit un jeu que personne ne sait jouer.

### 3. À chaque demande « améliore » ou « liste les manques »
Répondre par une liste courte, classée en « bloquant », « nécessaire », « plus tard », avec une recommandation, puis
exécuter par jalons sans redemander. Quand un chantier est trop gros pour la passe (nouvelle carte, traduction
complète), le dire tout de suite au lieu de le bâcler.

### 4. Vérifier, puis rendre compte
- Tests de simulation à chaque changement de règle.
- Parcours dans un navigateur sans écran pour chaque écran touché, en paysage et en portrait.
- Compte rendu : ce qui a changé pour le joueur, ce qui est vérifié et comment, ce qui ne l'est pas, le coût, et
  la décision attendue s'il y en a une.

## Mécaniques qui ont bien fonctionné (à réutiliser)

- **Autonomie notée par utilité** : chaque personnage note ses options (obéir, fuir, se cacher, aider) chaque
  seconde. Peu de code, beaucoup d'histoires qui émergent.
- **Information imparfaite** : brouillard sur ce que personne n'a regardé, renseignements qui vieillissent, liaison
  qui tombe. Le joueur décide sans tout savoir, ce qui crée la tension sans ajouter d'ennemis.
- **Un multiplicateur d'équipe qui retombe à zéro** (ici la « Synchro », gagnée en agissant sous la couverture d'un
  équipier, perdue quand quelqu'un est repéré). Simple à lire, donne envie de coordonner.
- **Conséquences qui reviennent** : un drapeau persistant par décision, relu par les dialogues, les missions et
  l'épilogue. Les scènes deviennent la mémoire de la partie.
- **Une base qui démarre nue** et s'équipe avec des objets trouvés sur la carte, visibles une fois posés. Donne un but
  à l'exploration et un sentiment de progrès que des jauges ne donnent pas.
- **Mini-jeux facultatifs** liés à l'action en cours, joués sur leur propre horloge par-dessus le jeu en pause, avec
  un bouton « laisser faire ». Un raté ne coûte rien : sinon le joueur les évite.
- **Objectifs secondaires tirés chaque jour**, sans toucher au générateur aléatoire de la partie (les tirer d'un
  hachage de la graine et du jour, sinon tous les tests déterministes bougent).
- **Aide et tutoriel** : un bouton « Suivant » qui fait l'action à la place du joueur vaut mieux qu'un bouton
  « Passer ». Un guide à la première ouverture de chaque écran, rappelable par « ? ». Des conseils uniques quand un
  événement survient pour la première fois.

## Erreurs à ne pas refaire (résumé ; détail dans la référence)

- Animer des personnages à la main, os par os, alors que de vrais clips existaient : deux passes perdues. Chercher
  d'abord ce que les outils disponibles proposent.
- Prendre un clip de catalogue sans le regarder : le « repos » penchait le buste et tendait un bras. Capturer chaque
  clip sur un personnage avant de l'adopter.
- Réutiliser un objet 3D mis en cache sans le détacher de son ancien parent : les mesures se font dans le repère
  précédent et tout part de travers à la deuxième partie.
- Mémoriser « tutoriel vu » sans offrir de moyen évident de le relancer : le joueur croit le tutoriel cassé.
- Écrire du texte lettre par lettre : sur une capture ou un appareil lent, on lit des mots coupés. Révéler par mots.
- Fenêtre d'interaction trop courte (une aide proposée pendant 2,5 secondes) : proposer dès que l'action est en route.
- Poses « expressives » non demandées (s'accroupir bras tendus) : en vue isométrique de loin, elles se lisent comme
  des défauts. Debout et sobre par défaut.
- Annoncer une livraison alors que seuls des tests automatiques tournaient : toujours rouvrir l'écran concerné.

## Ton et format des réponses pendant un projet de jeu

Répondre dans la langue de l'utilisateur. Commencer par ce qui a changé pour le joueur et où le voir (lien), puis ce
qui est vérifié, ce qui ne l'est pas, le coût, et la question qui reste. Pas de noms de fichiers ni d'identifiants
internes dans le compte rendu, sauf demande.

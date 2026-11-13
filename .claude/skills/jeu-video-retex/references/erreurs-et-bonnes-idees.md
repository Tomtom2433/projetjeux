# Erreurs et bonnes idées, en détail

Chaque entrée : ce qui s'est passé, pourquoi, et la parade. Tiré de la session LAST SIGNAL.

## Sommaire
1. Architecture et code
2. Rendu 3D et animation
3. Interface et mobile
4. Tutoriel et accompagnement
5. Conception de jeu
6. Méthode de travail et comptes rendus

## 1. Architecture et code

**Bonne idée : simulation pure et déterministe.** État en JSON, pas fixe (0,25 s), générateur aléatoire dans l'état.
Résultats : campagne de cinq jours testée en quatre secondes, sauvegarde triviale, « rejouer la journée » obtenu en
gardant une copie de l'état du matin, reproduction exacte d'un bogue par sa graine.

**Erreur : consommer le générateur aléatoire pour un ajout secondaire.** Tirer les objectifs secondaires avec le
générateur de la partie a décalé toute la suite et cassé un test sans rapport. Parade : tout tirage « décoratif » ou
ajouté après coup vient d'un hachage de la graine et du jour.

**Bonne idée : champs facultatifs et drapeaux pour les ajouts.** Ajouter `nextOrder?`, ou des drapeaux dans un
dictionnaire persistant, évite de changer la version de sauvegarde à chaque fonctionnalité.

**Erreur : chaînes de texte mêlées à la logique.** 2 400 lignes de français dans le code : la traduction est devenue
un chantier. Parade : dès le départ, un fichier de textes par langue, même s'il n'y en a qu'une.

**Erreur : perdre du travail avec une commande de restauration.** Un `git checkout` d'un fichier de tests a effacé
des tests non validés. Parade : valider avant toute commande qui écrase.

## 2. Rendu 3D et animation

**Erreur majeure : animation calculée os par os.** Trois passes pour faire marcher des personnages à la main
(détection des membres par leur forme, signes des axes, coudes qui ne pliaient pas parce que l'axe de rotation était
celui de l'os lui-même). Le résultat restait raide. La solution existait : squelette standard et clips enregistrés.
Parade : avant d'écrire de l'animation, regarder ce que proposent les outils branchés. Voir `pipeline-3d.md`.

**Erreur : objet en cache mesuré dans le mauvais repère.** Le modèle chargé une fois était réutilisé à la partie
suivante alors qu'il pendait encore sous l'ancien personnage (tourné, mis à l'échelle). Symptôme : bras levés à la
deuxième partie seulement. Parade : `removeFromParent()` et retour à la pose de repos avant toute mesure, ou cloner.

**Erreur : adopter un clip sans le regarder.** Le clip « Idle » du catalogue tournait les hanches de 40 à 75 degrés et
tendait un bras. Parade : capturer chaque clip en image, de face et de profil, avant de le garder. Pour le repos,
une pose calculée (bras le long du corps, respiration) est plus sûre qu'un clip de catalogue.

**Bonne idée : clips stockés comme écarts à la pose de repos.** Un clip fait pour un personnage se joue sur tous ceux
qui partagent le squelette, quelles que soient leurs proportions.

**Bonne idée : défilement des clips de marche par la distance parcourue.** Plus de pieds qui glissent, et la démarche
accélère et ralentit toute seule.

**Bonne idée : réserve de modèles animés plafonnée, repli sur des silhouettes.** Quatorze corps animés au plus, six en
qualité légère, le reste en instances simples. La fluidité tient sur mobile.

**Bonne idée : brouillard par nuanceur plutôt que par teinte.** Un masque dessiné sur un petit canevas dit où la brume
est levée ; un nuanceur ajoute le bruit animé. Coût négligeable, effet fort.

**Erreur : animations d'entrée d'interface qui partent d'une opacité nulle.** Sur un appareil lent ou une capture, la
fenêtre paraît vide. Parade : les éléments essentiels sont visibles dès la première image.

## 3. Interface et mobile

**Erreur : concevoir en paysage, découvrir le portrait par une capture de l'utilisateur.** Boutons sur le bandeau
d'état, mini-carte flottant sous la barre du bas. Parade : une mise en page portrait explicite dès le premier HUD, et
une capture à 390 × 760 dans chaque passe.

**Bonne idée : un bouton pour réduire ou masquer l'interface**, à trois états, mémorisé.

**Erreur : chemins d'images relatifs dans la feuille de style.** Après construction, ils se résolvent depuis le
dossier des ressources. Vérifier les images sur la version construite, pas seulement en développement.

**Erreur : `zoom` sur des éléments positionnés par transformation.** Les étiquettes placées en pixels se décalent.
Agrandir le texte par la taille de police pour ces éléments-là.

**Bonne idée : ne jamais coder un type d'action par la couleur seule.** Une couleur et un symbole par ordre, plus une
palette de rechange pour le daltonisme.

## 4. Tutoriel et accompagnement

**Erreur : « tutoriel vu » mémorisé, sans relance évidente.** Parade : « Nouvelle partie » relance toujours
l'introduction et la formation ; un second bouton la saute une fois qu'elle a été faite.

**Erreur : un bouton « Passer » dans le tutoriel.** L'utilisateur voulait avancer, pas sortir. Parade : « Suivant »
exécute l'étape (sélectionne, transmet l'ordre, fait avancer le temps jusqu'au résultat) et passe à la suivante.

**Bonne idée : trois niveaux d'aide.** Manuel complet, guide à la première ouverture de chaque écran avec rappel par
« ? », conseil unique à la première occurrence d'un événement (refus, liaison perdue, blessure).

**Bonne idée : un personnage donne le tutoriel.** Mara parle, l'instruction pratique est sur une seconde ligne.

## 5. Conception de jeu

**Bonne idée : scènes de dialogue jouées dans le monde.** Carte d'ouverture illustrée, bandes cinéma, caméra sur celui
qui parle, bulle au-dessus de la tête, didascalies. Règle de mise en scène retenue après correction : celui qui parle
regarde son interlocuteur et fait un pas vers lui, l'interlocuteur le regarde, les autres aussi. Personne ne parle le
dos tourné, même si le texte le suggère.

**Erreur : texte de bulle lettre par lettre.** Voir plus haut : révéler par mots entiers.

**Bonne idée : recrues.** Les personnes secourues deviennent jouables le lendemain. Peu de code si les survivants sont
une liste et non trois cas particuliers. Prévoir dès le départ que l'équipe peut grandir.

**Limite connue : équilibrage jamais joué par un humain.** Des scripts ne remplacent pas un joueur. Le dire à chaque
compte rendu tant que c'est vrai, et demander une partie complète sur téléphone.

## 6. Méthode de travail et comptes rendus

**Erreur : dire « livré » trop tôt.** Une fois, un message a annoncé une livraison complète alors que deux défauts
visibles restaient. Parade : rouvrir l'écran, regarder la capture, puis écrire.

**Bonne idée : séparer vérifié à l'écran, vérifié par test, non vérifié.** L'utilisateur sait où regarder.

**Bonne idée : annoncer le coût avant, le total après.** Et vérifier une image de référence peu chère avant de lancer
le modèle 3D coûteux qui en dépend.

**Erreur : re-demander une confirmation déjà donnée, ou au contraire dépenser sur une approbation ambiguë.** Parade :
le prix a été dit et l'utilisateur a dit « go » sur cette ligne précise, alors on y va ; sinon on demande une fois.

**Bonne idée : déployer à chaque jalon et vérifier que le site sert bien la nouvelle version** (comparer le nom du
fichier construit à celui servi), puis rappeler de recharger à cause du cache hors ligne.

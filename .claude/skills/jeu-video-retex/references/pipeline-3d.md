# Personnages 3D animés : la recette qui a marché

Objectif : des personnages réalistes, légers, tous animés par les mêmes clips. Testé avec les outils de génération
Magnific (les noms d'outils peuvent changer : chercher « models3d » et « images_generate »).

## Étapes

1. **Image de référence en pied** (peu chère). Personnage debout, de face, bras légèrement écartés, fond gris uni,
   éclairage doux, « semi-realistic game character concept art », sans texte. Donner le portrait existant en
   référence pour garder le visage. **Regarder l'image avant d'aller plus loin.**
2. **Modèle 3D depuis l'image**, avec peu de faces (8 000 pour un personnage principal, 3 500 pour un figurant
   dupliqué) et texture standard.
3. **Squelette standard** par l'outil de squelettage qui donne accès au catalogue d'animations (ici le fournisseur
   « meshy » : 24 articulations nommées Hips, Spine, LeftArm, LeftUpLeg…). Tous les personnages reçoivent ce même
   squelette.
4. **Clips** : les générer sur un seul personnage. Prendre les variantes « sur place » (inplace) pour la marche et la
   course. Catalogue utile : marche décontractée, course, marche blessée, parler mains ouvertes, se pencher pour
   ramasser, enchaînement de coups, regarder autour, démarche instable (infectés).
5. **Conversion** avec `scripts/glb_clips.py` :
   - `python3 glb_clips.py clips sortie.json marche course parler …` lit `marche.glb`, etc., et écrit un fichier de
     clips où chaque rotation est l'écart à la pose de repos. Les clips debout perdent leur rotation des hanches
     autour de la verticale, pour que le personnage regarde où le jeu le demande.
   - `python3 glb_clips.py slim entree.glb sortie.glb` retire les animations et recompresse la texture (768 px, JPEG).
     Un personnage pèse alors environ 1 Mo ; tous les clips ensemble, environ 350 Ko à 15 images par seconde.
6. **Lecture dans le jeu** : pour chaque os, `rotation = repos × écart`, avec fondu pondéré entre clips. Les clips de
   déplacement sont indexés par la distance parcourue ; les autres par l'horloge. Le repos est une pose calculée
   (bras ramenés le long du corps depuis la pose en T), pas un clip.

## Pièges rencontrés

- Le clip « Idle » du catalogue n'est pas neutre. Regarder chaque clip avant de l'adopter.
- Deux clips écartés parce qu'ils tendaient les bras sans objet visible : porter une charge, marcher accroupi.
- Pour dupliquer un personnage (horde), cloner le modèle avec l'utilitaire prévu pour les maillages à squelette,
  donner un matériau propre à chaque copie, et ne jamais poser le modèle source lui-même.
- Un modèle remis en service doit être détaché de son ancien parent et remis en pose de repos avant toute mesure.
- L'orientation « avant » se lit sur le modèle (du talon vers les orteils), elle ne se suppose pas.

## Ordres de grandeur de coût (crédits, à revérifier avec l'outil de simulation)

| Élément | Coût observé |
|---|---|
| Image de référence | 50 à 75 |
| Modèle 3D avec squelette de base | environ 1 035 |
| Squelette standard pour le catalogue | 120 |
| Un clip du catalogue | 120 |
| Un clip sur description libre | environ 540 (à éviter si le catalogue suffit) |

Toujours simuler le coût, l'annoncer, et faire l'essai sur un seul personnage avant de généraliser.

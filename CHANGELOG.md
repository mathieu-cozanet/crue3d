# Journal des versions

## 0.4.0 — 13 octobre 2026

- **Intégration** : page « Intégrer à votre site » qui génère le code à copier-coller (adresse, taille de zone,
  hauteur) ; mode intégré compact avec un bouton « Ouvrir en grand ».
- **Vidéo** : bouton « Vidéo » qui enregistre la montée des eaux, scénario par scénario, avec le nombre de
  bâtiments touchés, la légende et l'avertissement ; format vertical (réseaux sociaux) ou paysage ; MP4 quand le
  navigateur le permet, partage direct sur mobile.
- **Carte de couverture** : où Vigicrues a cartographié les zones inondées, avec recherche d'adresse
  (« ma commune est-elle couverte ? ») ; données régénérées chaque mois.

## 0.3.0 — 12 octobre 2026

- Nouveau rendu de l'eau : surface animée (vagues, reflets du soleil et du ciel), couleur continue selon la
  hauteur d'eau (même gamme que la légende), transparence sur les faibles hauteurs, écume sur les berges et
  autour des bâtiments dans l'eau.
- Berges naturelles : la surface est lissée et le rivage suit la rencontre de l'eau et du relief.
- L'eau monte et descend en douceur quand on change de scénario.
- Ligne d'eau sur les façades à la hauteur atteinte, au lieu de murs entièrement colorés.
- Les calculs (bilan, hauteur au pied des bâtiments) sont inchangés.

## 0.2.0 — 12 octobre 2026

- Calque **Arbres** (désactivé par défaut) : chaque arbre est détecté dans le relevé laser LiDAR HD de l'IGN,
  avec sa position, sa hauteur et la largeur de sa couronne mesurées. Téléchargement à la demande seulement ;
  arbres transparents quand une crue est affichée ; repli explicite là où le relevé n'existe pas encore.
- Nouvel écran de chargement animé autour du logo (goutte qui se remplit, ondes, arc en orbite), figé si le
  système demande de réduire les animations.

## 0.1.0 — 12 octobre 2026

Première version.

- Vue 3D d'une zone autour d'une adresse : relief IGN (2 m), bâtiments BD TOPO avec hauteur, routes, cours d'eau.
- Cartes de crue Vigicrues (ZIP / ZICH) : mode « Maintenant » d'après le niveau en temps réel (Hub'Eau, rafraîchi
  toutes les 5 minutes) et scénarios « Et si ça monte ? ».
- Hauteur d'eau au pied de chaque bâtiment (grille d'analyse de 1 m), par scénario.
- Bilan secours : bâtiments, logements, établissements non résidentiels, voies sous l'eau (ponts exclus),
  export CSV et GeoJSON.
- Enveloppe des PPRI (Géoportail de l'Urbanisme) ; simulation « baignoire » hors zones cartographiées.
- Site : page d'accueil, CGU, mentions légales, confidentialité, déclaration d'accessibilité, sitemap,
  application installable (PWA).
- Recherche d'adresse avec autocomplétion (Base Adresse Nationale) sur l'accueil et dans l'application :
  commune, département et type d'adresse affichés, navigation au clavier, compatible lecteur d'écran.
- Les liens partagés transportent les coordonnées : pas de second géocodage ni de risque d'homonyme.
- Jusqu'à deux nouvelles tentatives automatiques en cas d'erreur réseau ou de service public surchargé.

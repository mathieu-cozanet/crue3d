# Crue 3D

**Voir en 3D ce que l'eau recouvre, adresse par adresse, à partir des cartes officielles de crue.**

Crue 3D est un logiciel libre qui construit à la volée une maquette 3D d'un quartier (relief, bâtiments, routes)
et y superpose la zone inondée correspondant au niveau de la rivière, **mesuré en temps réel** ou **choisi parmi les
scénarios officiels**. Il s'adresse :

- **aux habitants** : « l'eau arrive-t-elle chez moi, et à partir de quel niveau de la rivière ? » ;
- **aux mairies et services de secours** : bâtiments et logements touchés, établissements non résidentiels,
  voies sous l'eau, avec export CSV / GeoJSON.

> ⚠️ Crue 3D est un outil d'information, **pas un dispositif d'alerte ni une prévision**. En cas de crue,
> suivez [Vigicrues](https://www.vigicrues.gouv.fr/) et les consignes de la préfecture et de la mairie.

## Fonctionnement

1. L'adresse est géolocalisée par la Base Adresse Nationale ; une zone de 500 m à 1,5 km autour est étudiée.
2. Le relief (IGN RGE ALTI®, grille de 2 m), les bâtiments et routes (IGN BD TOPO®) sont chargés directement depuis
   la Géoplateforme de l'IGN.
3. Les **zones d'inondation potentielle** de Vigicrues (ZIP) et leurs **classes de hauteur d'eau** (ZICH) sont
   chargées. Chaque carte correspond à un niveau d'eau à une **station de référence**.
4. Le niveau actuel de cette station est lu sur Hub'Eau (rafraîchi toutes les 5 minutes). Le mode « Maintenant »
   affiche le scénario cartographié **immédiatement inférieur ou égal** au niveau mesuré.
5. La hauteur d'eau au pied de chaque bâtiment est la classe la plus profonde rencontrée sur son emprise
   (grille d'analyse de 1 m). Les ponts et tunnels sont exclus du décompte des voies coupées.

Hors des tronçons cartographiés par Vigicrues, Crue 3D propose une simulation « baignoire » (plan d'eau horizontal),
clairement signalée comme indicative, et affiche l'enveloppe du PPRI quand elle est publiée.

Tout tourne **dans le navigateur** : pas de serveur, pas de compte, pas de collecte de données. Les services publics
interrogés acceptent les appels directs (CORS).

## Sources de données

| Donnée | Source | Licence |
|---|---|---|
| Zones inondées et hauteurs d'eau (ZIP / ZICH) | Vigicrues, via la Géoplateforme IGN (`VIGINOND-DIFFUSION`) | Etalab 2.0 |
| Niveau des rivières en temps réel | Hub'Eau – hydrométrie | Etalab 2.0 |
| Relief | IGN RGE ALTI® (`ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`) | Etalab 2.0 |
| Bâtiments, routes, hydrographie | IGN BD TOPO® | Etalab 2.0 |
| Enveloppe des PPRI | Géoportail de l'Urbanisme (servitudes PM1, aléa inondation) | Etalab 2.0 |
| Adresses | Base Adresse Nationale | Etalab 2.0 |

## Limites connues

- **Entre deux scénarios**, l'emprise réelle est plus grande que celle affichée (on montre le scénario inférieur).
- **Station éloignée** : la crue peut arriver avec plusieurs heures de décalage ; les affluents, embâcles,
  ruptures de digue et ruissellement ne sont pas représentés.
- **Point d'adresse** : la BAN place parfois le point sur la voie ou chez un voisin. Le bâtiment retenu est signalé,
  et l'utilisateur peut désigner le sien (« C'est mon bâtiment »).
- **Logements** : nombre issu de la BD TOPO, parfois non renseigné.
- **PPRI** : seule l'enveloppe (zones rouge et bleue confondues) est disponible en données ouvertes nationales.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173 (accueil) et /app/ (application)
npm test         # tests unitaires (vitest)
npm run build    # site statique dans dist/
npm run check    # vérifie que les informations légales et l'URL publique sont renseignées
```

Organisation :

```
index.html               page d'accueil
app/index.html           application
cgu/ mentions-legales/ confidentialite/ accessibilite/ 404.html   pages légales
site.config.js           identité de l'éditeur, hébergeur, URL publique, pages du sitemap
build/site-plugin.js     en-tête et pied de page communs, balises de partage, sitemap.xml, robots.txt
public/                  manifeste PWA, service worker, icônes, image de partage
src/
  config.js              points d'accès et classes de hauteur d'eau
  geo.js                 Lambert 93 ↔ WGS84, géométrie
  api/                   IGN (relief, BD TOPO), Vigicrues + Hub'Eau, BAN, GPU
  analysis.js            choix du scénario, exposition des bâtiments et des routes (fonctions pures, testées)
  raster.js              conversion des cartes de crue en grilles
  scene/viewer.js        scène 3D (Three.js)
  main.js                interface de l'application
```

Lien partageable : `app/?q=<adresse>&zone=<0|1|2>`.

## Mise en ligne

1. Renseigner l'éditeur dans `site.config.js` (nom, statut, adresse, SIREN, contact, directeur de la publication)
   et, si le site n'est pas sur GitHub Pages, l'hébergeur.
2. Sur GitHub : *Settings > Pages > Source = GitHub Actions*, puis créer la variable `SITE_URL`
   (*Settings > Secrets and variables > Actions > Variables*), par exemple `https://crue3d.fr`.
3. Pousser sur `main` : le workflow teste, vérifie les informations légales (`npm run check`), construit et publie.
   La mise en ligne est refusée tant qu'une information légale manque.
4. Déclarer `SITE_URL/sitemap.xml` dans Google Search Console et Bing Webmaster Tools.

Le site étant statique, une collectivité peut aussi l'héberger sur son propre serveur : copier le contenu de `dist/`.

## Pistes

- Emprises inondées **observées** par satellite pendant un événement (Copernicus EMS, GFM).
- Prise en compte des **prévisions** Vigicrues quand elles sont publiées pour la station.
- Cartes des Territoires à Risque Important d'inondation (TRI) en repli quand il n'y a pas de ZIP.
- Mode hors ligne (préchargement d'une commune) pour les postes de commandement.

## Licence

[GNU AGPL v3.0 ou ultérieure](LICENSE). Si vous proposez Crue 3D comme service en ligne modifié, vous devez publier
vos modifications sous la même licence.

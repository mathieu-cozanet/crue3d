# Contribuer à Crue 3D

Merci de votre intérêt ! Crue 3D est un outil d'information pour les habitants, les mairies et les services de
secours ; chaque retour de terrain l'améliore.

## Signaler un problème

Ouvrez un ticket en précisant :

- l'adresse ou la commune concernée (une adresse publique, jamais un domicile si vous ne souhaitez pas la rendre publique) ;
- le scénario affiché et ce que vous attendiez ;
- votre navigateur et votre appareil.

Pour une **faille de sécurité**, ne créez pas de ticket public : voir [SECURITY.md](SECURITY.md).

Un écart entre Crue 3D et une carte officielle est un bug prioritaire : joignez si possible une capture de la carte
Vigicrues ou du PPRI correspondant.

## Proposer une modification

```bash
npm install
npm run dev      # http://localhost:5173
npm test
```

- Les calculs (choix du scénario, exposition des bâtiments, voies coupées) sont des **fonctions pures** dans
  `src/analysis.js` : toute modification doit être accompagnée d'un test dans `tests/`.
- Pas de dépendance à un serveur : l'application doit rester un site statique qui interroge directement les
  services publics.
- Pas de traceur, de cookie ni de mesure d'audience.
- Textes de l'interface en français, clairs pour un public non spécialiste ; code et commentaires en anglais.
- Toute nouvelle source de données doit être ouverte, citée dans le README, les mentions légales et la page d'accueil.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous licence [AGPL-3.0-or-later](LICENSE).

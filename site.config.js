// Everything that identifies the deployment lives here (used by the pages, the sitemap and the legal notices).
// Values marked TODO_ must be filled before going live: `npm run check` fails while one remains.
// SITE_URL and REPO_URL can also come from the environment (CI variables).

const TODO = "TODO_";

export default {
  name: "Crue 3D",
  tagline: "Voir en 3D ce que l'eau recouvre",
  description: "Crue 3D affiche en 3D les zones inondées et la hauteur d'eau au pied de chaque bâtiment, d'après les cartes officielles Vigicrues et le niveau de la rivière en temps réel. Libre et gratuit.",
  url: (process.env.SITE_URL || "https://mathieu-cozanet.github.io/crue3d").replace(/\/$/, ""),  // no trailing slash
  repo: process.env.REPO_URL || "https://github.com/mathieu-cozanet/crue3d",
  lang: "fr",
  themeColor: "#1f6fb5",
  updated: "12 octobre 2026",

  // Éditeur du site (LCEN art. 6-III). A professional publisher, sole trader (EI) included, must show name,
  // address and registration number; only non-professional individuals may stay anonymous behind the host.
  publisher: {
    name: "Mathieu Cozanet Merlingeas (EI, enseigne ICTINUS)",
    status: "Mathieu COZANET, nom d'usage COZANET MERLINGEAS, entrepreneur individuel (micro-entreprise) exerçant sous l'enseigne ICTINUS",
    address: "Étage 0, Bâtiment M3 — 205 Route des Tuilières, Le Change, 24640 Bassillac et Auberoche, France",
    siren: "490 564 879",
    rcs: "RCS Périgueux 490 564 879",
    email: "contact@ictinus.fr",
    director: "Mathieu Cozanet Merlingeas",
  },

  // Hébergeur — GitHub Pages by default; change it if the site is served elsewhere.
  host: {
    name: "GitHub, Inc.",
    address: "88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis",
    url: "https://pages.github.com/",
  },

  // Public pages, for navigation and the sitemap.
  pages: [
    { path: "/", priority: 1.0, changefreq: "monthly" },
    { path: "/app/", priority: 0.9, changefreq: "monthly" },
    { path: "/couverture/", priority: 0.7, changefreq: "monthly" },
    { path: "/integrer/", priority: 0.6, changefreq: "monthly" },
    { path: "/cgu/", priority: 0.2, changefreq: "yearly" },
    { path: "/mentions-legales/", priority: 0.2, changefreq: "yearly" },
    { path: "/confidentialite/", priority: 0.2, changefreq: "yearly" },
    { path: "/accessibilite/", priority: 0.2, changefreq: "yearly" },
  ],
};

export const TODO_MARK = TODO;

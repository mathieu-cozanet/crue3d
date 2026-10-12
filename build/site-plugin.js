// Vite plugin: shared head/header/footer for every page, {{tokens}} from site.config.js, sitemap.xml and robots.txt.
import site, { TODO_MARK } from "../site.config.js";

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

function pagePath(file) {
  // "/cgu/index.html" -> "/cgu/", "/index.html" -> "/", "/404.html" -> "/404.html"
  return file.replace(/index\.html$/, "");
}

function relBase(path) {
  const depth = path.split("/").filter(Boolean).filter(s => !s.endsWith(".html")).length;
  return depth ? "../".repeat(depth) : "./";
}

const head = (path, base, title, description) => {
  const abs = site.url ? site.url + path : "";
  const image = site.url ? `${site.url}/og-image.png` : `${base}og-image.png`;
  return `
<meta name="theme-color" content="${site.themeColor}">
<link rel="icon" href="${base}icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="${base}icons/icon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png">
<link rel="manifest" href="${base}manifest.webmanifest">
${abs ? `<link rel="canonical" href="${abs}">` : ""}
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${site.name}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${abs ? `<meta property="og:url" content="${abs}">` : ""}
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Vue 3D d'un village au bord d'une rivière, zones inondées colorées selon la hauteur d'eau">
<meta name="twitter:card" content="summary_large_image">`;
};

const header = base => `
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="site-header">
  <a class="logo" href="${base}" aria-label="${site.name}, accueil">
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17z" fill="currentColor"/></svg>${site.name}
  </a>
  <nav aria-label="Navigation principale">
    <a href="${base}#comment">Comment ça marche</a>
    <a href="${base}#faq">Questions</a>
    ${site.repo ? `<a href="${site.repo}" rel="noopener">Code source</a>` : ""}
    <a class="btn primary" href="${base}app/">Ouvrir l'application</a>
  </nav>
</header>`;

const footer = base => `
<footer class="site-footer">
  <div class="cols">
    <div>
      <div class="logo"><svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17z" fill="currentColor"/></svg>${site.name}</div>
      <p>Logiciel libre (AGPL-3.0) d'information sur les inondations.<br>Pas un dispositif d'alerte : suivez <a href="https://www.vigicrues.gouv.fr/" rel="noopener">Vigicrues</a> et les consignes officielles. Urgence : 112.</p>
    </div>
    <nav aria-label="Informations légales">
      <a href="${base}mentions-legales/">Mentions légales</a>
      <a href="${base}cgu/">Conditions d'utilisation</a>
      <a href="${base}confidentialite/">Confidentialité</a>
      <a href="${base}accessibilite/">Accessibilité : non conforme</a>
      ${site.repo ? `<a href="${site.repo}" rel="noopener">Code source</a>` : ""}
    </nav>
  </div>
  <p class="small">Données : Vigicrues, Hub'Eau, IGN, Géoportail de l'Urbanisme, Base Adresse Nationale — Licence Ouverte Etalab 2.0.</p>
</footer>`;

export default function sitePlugin() {
  let outDir = "dist";
  return {
    name: "crue3d-site",
    configResolved(cfg) { outDir = cfg.build.outDir; },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const path = pagePath(ctx.path), base = relBase(path);
        const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || site.name;
        const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || site.description;
        // 404.html is served at any depth: anchor its relative links on the site root when it is known
        const notFoundBase = path === "/404.html" && site.url ? `<base href="${site.url}/">` : "";
        return html
          .replace("<!-- @head -->", notFoundBase + head(path, base, title, description))
          .replace("<!-- @header -->", header(base))
          .replace("<!-- @footer -->", footer(base))
          .replace(/\{\{base\}\}/g, base)
          .replace(/\{\{([a-zA-Z.]+)\}\}/g, (m, key) => {
            const v = get(site, key);
            return v == null ? m : String(v);
          });
      },
    },
    async closeBundle() {
      const fs = await import("node:fs/promises");
      const { join } = await import("node:path");
      const today = new Date().toISOString().slice(0, 10);
      if (site.url) {
        const urls = site.pages.map(p => `  <url><loc>${site.url}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority.toFixed(1)}</priority></url>`).join("\n");
        await fs.writeFile(join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
      } else {
        this.warn("SITE_URL non défini : sitemap.xml non généré et pas d'URL canonique.");
      }
      await fs.writeFile(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n${site.url ? `Sitemap: ${site.url}/sitemap.xml\n` : ""}`);
      const files = await fs.readdir(outDir, { recursive: true });
      const html = files.filter(f => f.endsWith(".html"));
      const pending = [];
      for (const f of html) if ((await fs.readFile(join(outDir, f), "utf8")).includes(TODO_MARK)) pending.push(f);
      if (pending.length) this.warn(`Informations légales à compléter dans site.config.js (pages : ${pending.join(", ")}). Lancez « npm run check » avant la mise en ligne.`);
    },
  };
}

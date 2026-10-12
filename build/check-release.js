// Release gate: refuses to deploy while legal information or the public URL is missing.
import site, { TODO_MARK } from "../site.config.js";

const problems = [];
const walk = (obj, path = "") => {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.includes(TODO_MARK)) problems.push(`${path}${k} : ${v.replace(TODO_MARK, "")}`);
    else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${path}${k}.`);
  }
};
walk(site);
if (!site.url) problems.push("url : définir SITE_URL (adresse publique du site, sans / final)");
if (!site.repo) problems.push("repo : définir REPO_URL (dépôt public du code, exigé par la licence AGPL)");

if (problems.length) {
  console.error("Mise en ligne bloquée — à compléter dans site.config.js ou l'environnement :\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("OK : informations légales et URL publiques renseignées.");

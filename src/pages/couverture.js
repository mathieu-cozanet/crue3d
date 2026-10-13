import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { attachAddressAutocomplete } from "../ui/autocomplete.js";
import { pointInRings } from "../geo.js";
import { fetchJSON } from "../api/http.js";

const $ = id => document.getElementById(id);
const appURL = new URL("../app/", location.href);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = mm => `${(mm / 1000).toFixed(2).replace(".", ",")} m`;

const map = L.map("covMap", { zoomSnap: 0.5, minZoom: 5 }).setView([46.6, 2.4], 6);
L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png", {
  maxZoom: 18, attribution: '© <a href="https://www.ign.fr/" rel="noopener">IGN</a> · Vigicrues',
}).addTo(map);

function appLink(lon, lat, label) {
  const u = new URL(appURL);
  u.searchParams.set("q", label);
  u.searchParams.set("lon", lon.toFixed(6));
  u.searchParams.set("lat", lat.toFixed(6));
  return u.href;
}

async function placeLabel(lon, lat) {
  try {
    const d = await fetchJSON(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`, { timeout: 8000 });
    return d.features?.[0]?.properties.label || "Point choisi sur la carte";
  } catch { return "Point choisi sur la carte"; }
}

let zones = [];
const NEAR_M = 500;   // the app studies ~1 km around the address: a mapped area this close shows up in 3D

/** Nearest mapped area: { zone, meters } (0 when inside), measured on a local flat approximation. */
function nearest(lon, lat) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = { zone: null, meters: Infinity };
  for (const f of zones) {
    const g = f.geometry;
    if (g.type === "Point") {
      const d = Math.hypot((g.coordinates[0] - lon) * kx, (g.coordinates[1] - lat) * ky);
      if (d < best.meters) best = { zone: f, meters: d };
      continue;
    }
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const rings of polys) {
      if (pointInRings(lon, lat, rings)) return { zone: f, meters: 0 };
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best.meters) best = { zone: f, meters: d };
      }
    }
  }
  return best;
}

function popupHTML(p, href) {
  return `<b>${esc(p.river || "Cours d'eau")}</b><br>Station de référence : ${esc(p.station)}<br>
    ${p.scenarios} scénario${p.scenarios > 1 ? "s" : ""} (${fmt(p.min)} à ${fmt(p.max)})<br>
    ${p.approx ? "<i>Emprise non affichée ici (carte trop volumineuse) : ouvrez Crue 3D près de la rivière.</i><br>" : p.small ? "<i>Petit secteur, représenté par un point.</i><br>" : p.mapped ? `<i>Emprise montrée : scénario à ${fmt(p.mapped)}.</i><br>` : ""}
    <a href="${href}">Ouvrir Crue 3D ici →</a>`;
}

fetchJSON(new URL("../data/couverture.json", location.href).href).then(data => {
  zones = data.features;
  L.geoJSON(data, {
    style: { color: "#1f6fb5", weight: 1, fillColor: "#2b78bf", fillOpacity: 0.35 },
    pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 7, color: "#1f6fb5", weight: 2, fillColor: "#fff", fillOpacity: 1, dashArray: "3 3" }),
    onEachFeature: (f, layer) => layer.on("click", async e => {
      const { lng, lat } = e.latlng;
      const popup = L.popup().setLatLng(e.latlng).setContent(popupHTML(f.properties, appLink(lng, lat, "Point choisi sur la carte"))).openOn(map);
      popup.setContent(popupHTML(f.properties, appLink(lng, lat, await placeLabel(lng, lat))));
    }),
  }).addTo(map);
  $("covMeta").textContent = `${zones.length} secteurs cartographiés · données du ${new Date(data.generated).toLocaleDateString("fr-FR")}.`;
}).catch(() => { $("covMeta").textContent = "Impossible de charger la couverture pour le moment."; });

let marker = null;
function check(a) {
  const [lon, lat] = a.lonlat;
  map.setView([lat, lon], 13);
  marker?.remove();
  marker = L.circleMarker([lat, lon], { radius: 8, color: "#d0463c", weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(map);
  const { zone, meters } = nearest(lon, lat);
  const ok = zone && meters <= NEAR_M, river = esc(zone?.properties.river || "un cours d'eau"), link = appLink(lon, lat, a.label);
  const dist = m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
  $("covResult").className = `cov-result ${ok ? "yes" : "no"}`;
  $("covResult").innerHTML = !zone ? "Couverture en cours de chargement, réessayez dans un instant."
    : meters === 0 ? `<b>Oui :</b> ce lieu est dans un secteur cartographié (${river}, station ${esc(zone.properties.station)}). <a href="${link}">Voir en 3D →</a>`
    : ok ? `<b>Oui :</b> un secteur cartographié (${river}) se trouve à ${dist(meters)} ; il apparaîtra dans la vue 3D autour de cette adresse. <a href="${link}">Voir en 3D →</a>`
    : `<b>Pas de carte Vigicrues autour de ce lieu</b> (le secteur le plus proche, sur ${river}, est à ${dist(meters)}). Crue 3D ne proposera qu'une simulation indicative. <a href="${link}">Ouvrir quand même →</a>`;
}

const ac = attachAddressAutocomplete($("covQ"), { onSelect: check });
$("covForm").addEventListener("submit", e => { e.preventDefault(); ac.resolve(); });

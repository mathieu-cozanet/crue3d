import { AREA_SIZES, DEFAULT_AREA, DEPTH_CLASSES, API } from "./config.js";
import { makeBBox, toL93, toWGS, polygonsOf, pointInRings, haversineKm } from "./geo.js";
import { fetchDEM, fetchSurfaceModel, fetchBuildings, fetchRoads, fetchWaterSurfaces, fetchStreams } from "./api/ign.js";
import { fetchFloodMaps, fetchStation, fetchWaterLevels } from "./api/vigicrues.js";
import { fetchPPRI } from "./api/others.js";
import { searchAddress } from "./api/ban.js";
import { attachAddressAutocomplete } from "./ui/autocomplete.js";
import { groupScenarios, selectScenario, footprintDepth, summarize, fmtLevel, depthLabel } from "./analysis.js";
import { rasterizeScenario, rasterizeLevel, analysisGrid, rasterizeMask } from "./raster.js";
import { canopyHeight, detectTrees } from "./trees.js";
import { FloodViewer } from "./scene/viewer.js";
import { FORMATS, pickMime, recordFloodVideo } from "./video.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, d = 1) => v.toFixed(d).replace(".", ",");
const EXAMPLE = "Rue de Maleffe 24640 Bassillac et Auberoche";

const state = {
  addr: null, bbox: null, dem: null, buildings: [], roads: [], ppri: [],
  station: null, stationInfo: null, levels: [], scenarios: [], rasters: [], depthCache: new Map(),
  mode: "now",        // "now" | scenario index | "bathtub"
  bathtub: 0, homeIndex: -1, homeGuessed: false,
};
let viewer = null;

// Embedded in another site (?embed): compact chrome and a link to open the full app.
const EMBED = new URL(location.href).searchParams.has("embed");
if (EMBED) document.documentElement.classList.add("embed");
function updateFullLink() {
  if (!EMBED) return;
  const full = new URL(location.href);
  full.searchParams.delete("embed");
  $("openFull").href = full.href;
  $("openFull").hidden = false;
}
updateFullLink();

// ---------- search ----------
const areaSel = $("area");
AREA_SIZES.forEach((a, i) => areaSel.add(new Option(a.label, i, i === DEFAULT_AREA, i === DEFAULT_AREA)));
const search = attachAddressAutocomplete($("q"), { onSelect: choose });
$("searchForm").addEventListener("submit", e => { e.preventDefault(); search.resolve(); });
$("example").onclick = async () => { const [a] = await searchAddress(EXAMPLE, 1); if (a) choose(a); };
areaSel.onchange = () => state.addr && load(state.addr);
$("aboutLink").onclick = e => { e.preventDefault(); $("about").showModal(); };

function choose(a) {
  $("q").value = a.label;
  const url = new URL(location.href);
  url.searchParams.set("q", a.label); url.searchParams.set("zone", areaSel.value);
  url.searchParams.set("lon", a.lonlat[0].toFixed(6)); url.searchParams.set("lat", a.lonlat[1].toFixed(6));
  history.replaceState(null, "", url);
  updateFullLink();
  load(a);
}

// ---------- loading ----------
function steps(list) {
  $("steps").innerHTML = list.map(([id, label]) => `<li id="st-${id}">${label}</li>`).join("");
  return (id, ok = true) => $(`st-${id}`)?.classList.add(ok ? "done" : "fail");
}

async function load(addr) {
  state.addr = addr;
  const size = AREA_SIZES[+areaSel.value];
  const bbox = state.bbox = makeBBox(addr.l93, size.w, size.h);
  $("empty").hidden = true; $("loading").hidden = false; $("card").hidden = true;
  const done = steps([["dem", "Relief (IGN)"], ["bati", "Bâtiments et routes (IGN BD TOPO)"], ["vigi", "Cartes de crue Vigicrues"], ["ppri", "PPRI (Géoportail de l'Urbanisme)"], ["level", "Niveau de la rivière en direct"]]);
  const track = (p, id) => p.then(v => (done(id), v), e => { done(id, false); throw e; });

  const [dem, bati, flood, ppri] = await Promise.allSettled([
    track(fetchDEM(bbox), "dem"),
    track(Promise.all([fetchBuildings(bbox), fetchRoads(bbox), fetchWaterSurfaces(bbox), fetchStreams(bbox)]), "bati"),
    track(fetchFloodMaps(bbox), "vigi"),
    track(fetchPPRI(bbox), "ppri"),
  ]);
  if (dem.status === "rejected") {
    $("loading").hidden = true;
    return fail(navigator.onLine === false ? "Vous êtes hors connexion : les cartes et niveaux d'eau ne peuvent pas être chargés."
      : `Impossible de charger le relief : ${dem.reason.message}`);
  }
  state.dem = dem.value;
  [state.buildings, state.roads, state.water, state.streams] = bati.status === "fulfilled" ? bati.value : [[], [], [], []];
  state.ppri = ppri.status === "fulfilled" ? ppri.value : [];
  state.ppriError = ppri.status === "rejected";
  const stations = flood.status === "fulfilled" ? groupScenarios(flood.value.zip, flood.value.zich) : [];
  state.floodError = flood.status === "rejected";
  state.station = stations[0] || null;
  state.scenarios = state.station?.scenarios || [];
  state.otherStations = stations.slice(1);
  state.depthCache.clear();
  state.rasters = state.scenarios.map(s => rasterizeScenario(s, bbox, state.dem));  // display, terrain grid
  const fine = analysisGrid(bbox);
  state.fineRasters = state.scenarios.map(s => rasterizeScenario(s, bbox, fine));   // building / road analysis

  state.levels = []; state.stationInfo = null;
  if (state.station) {
    const [info, levels] = await Promise.allSettled([fetchStation(state.station.code), fetchWaterLevels(state.station.code)]);
    state.stationInfo = info.status === "fulfilled" ? info.value : { code: state.station.code, label: state.station.label };
    state.levels = levels.status === "fulfilled" ? levels.value : [];
    done("level", levels.status === "fulfilled" && state.levels.length > 0);
  } else done("level", false);

  findHome();
  state.mode = state.scenarios.length ? "now" : "bathtub";
  state.bathtub = 0;

  document.querySelector(".layout").classList.add("with-panel");
  $("panel").hidden = false; $("legend").hidden = false; $("viewbtns").hidden = false;
  viewer ??= new FloodViewer($("viewer"), { onPick: showBuilding });
  viewer.load({ bbox, dem: state.dem, buildings: state.buildings, roads: state.roads, waterSurfaces: state.water,
    streams: state.streams, ppri: state.ppri, homeIndex: state.homeIndex });
  $("loading").hidden = true;
  state.trees = { status: "idle" };
  renderLegend(); renderLayers(); apply();
  if (viewer.layers.trees) loadTrees();
}

function fail(msg) {
  $("empty").hidden = false;
  $("empty").querySelector("p").innerHTML = `<span class="warn">${esc(msg)}</span>`;
}

/** Building at the address point, else the closest footprint within 40 m (BAN points often sit on the street). */
function findHome() {
  const [x, y] = state.addr.l93;
  let best = -1, bestD = 40;
  state.buildings.forEach((b, i) => {
    for (const rings of polygonsOf(b.geometry)) {
      if (pointInRings(x, y, rings)) { best = i; bestD = 0; return; }
      for (const [px, py] of rings[0]) { const d = Math.hypot(px - x, py - y); if (d < bestD) { bestD = d; best = i; } }
    }
  });
  state.homeIndex = best;
  state.homeGuessed = best >= 0 && bestD > 0;
}

// ---------- flood state ----------
const currentLevel = () => state.levels.at(-1);
function currentIndex() {
  if (state.mode === "now") return currentLevel() ? selectScenario(state.scenarios, currentLevel().mm) : -1;
  return typeof state.mode === "number" ? state.mode : -1;
}
function depthsFor(i) {
  if (!state.depthCache.has(i)) state.depthCache.set(i, Uint8Array.from(state.buildings, b => footprintDepth(state.fineRasters[i], b.geometry)));
  return state.depthCache.get(i);
}
function currentRaster() {
  if (state.mode === "bathtub") return state.bathtub > 0 ? rasterizeLevel(state.dem.min + state.bathtub, state.bbox, state.dem) : null;
  const i = currentIndex();
  return i >= 0 ? state.rasters[i] : null;
}

function apply() {
  const raster = currentRaster();
  const depths = state.mode === "bathtub"
    ? (raster ? Uint8Array.from(state.buildings, b => footprintDepth(raster, b.geometry)) : null)
    : (currentIndex() >= 0 ? depthsFor(currentIndex()) : null);
  state.depths = depths; state.raster = raster;
  state.analysisRaster = state.mode === "bathtub" || currentIndex() < 0 ? raster : state.fineRasters[currentIndex()];
  viewer.setFlood(raster);
  viewer.colorBuildings(depths);
  renderStation(); renderScenarios(); renderHome(); renderReport();
}

// ---------- panel: station + scenarios ----------
function renderStation() {
  const box = $("stationBox");
  if (!state.station) {
    box.innerHTML = `<div class="box"><b>Pas de carte Vigicrues sur cette zone</b>
      <p class="note">${state.floodError ? "Le service des cartes de crue n'a pas répondu." : "Ce tronçon de rivière n'est pas cartographié par Vigicrues (ou il n'y a pas de rivière surveillée ici)."}
      Seule une simulation « baignoire » indicative est possible, et l'enveloppe PPRI quand elle existe.</p></div>`;
    return;
  }
  const info = state.stationInfo || {}, lvl = currentLevel();
  const dist = info.lon ? haversineKm(state.addr.lonlat, [info.lon, info.lat]) : null;
  const first = state.scenarios[0]?.levelMm;
  const ago = lvl ? Math.round((Date.now() - lvl.t) / 60000) : null;
  box.innerHTML = `<div class="box">
    <div class="k">Station de référence${dist != null ? ` · à ${fmt(dist, 0)} km` : ""}</div>
    <div><b>${esc(info.label || state.station.label)}</b>${info.river ? ` <span class="k">(${esc(info.river)})</span>` : ""}</div>
    ${lvl ? `<div class="big" style="margin-top:6px">${fmtLevel(lvl.mm)}</div>
      <div class="k">mesuré ${ago < 60 ? `il y a ${ago} min` : `le ${lvl.t.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`}${trend()}</div>
      ${sparkline()}
      <div class="note">${lvl.mm < first ? `Sous le premier niveau cartographié (${fmtLevel(first)}) : pas de zone inondée cartographiée à ce niveau.`
        : `Niveau ≥ ${fmtLevel(state.scenarios[selectScenario(state.scenarios, lvl.mm)].levelMm)} : la carte correspondante est affichée en mode « Maintenant ».`}</div>`
      : `<p class="warn">Niveau en temps réel indisponible : utilisez les scénarios ci-dessous.</p>`}
    ${dist > 10 ? `<p class="note">Station éloignée : la crue peut arriver chez vous avec un décalage de plusieurs heures.</p>` : ""}
    <p class="note"><a href="${API.vigicruesStation(state.station.code)}" target="_blank" rel="noopener">Voir la station et la vigilance sur Vigicrues ↗</a></p>
  </div>`;
}

function trend() {
  const l = state.levels; if (l.length < 4) return "";
  const now = l.at(-1), past = l.find(o => now.t - o.t <= 3 * 3600e3) || l[0];
  const d = now.mm - past.mm;
  if (Math.abs(d) < 20) return " · stable";
  return ` · ${d > 0 ? "en hausse" : "en baisse"} de ${fmt(Math.abs(d) / 10, 0)} cm en ${Math.round((now.t - past.t) / 3600e3)} h`;
}

function sparkline() {
  const l = state.levels; if (l.length < 2) return "";
  const W = 340, H = 90, t0 = +l[0].t, t1 = +l.at(-1).t;
  const levels = state.scenarios.map(s => s.levelMm);
  const lo = Math.min(...l.map(o => o.mm)), hi = Math.max(...l.map(o => o.mm), levels[0] ?? 0);
  const pad = (hi - lo) * 0.1 + 50, y0 = lo - pad, y1 = hi + pad;
  const X = t => ((t - t0) / (t1 - t0 || 1)) * (W - 8) + 4, Y = mm => H - 14 - ((mm - y0) / (y1 - y0)) * (H - 22);
  const path = l.map((o, i) => `${i ? "L" : "M"}${X(+o.t).toFixed(1)},${Y(o.mm).toFixed(1)}`).join("");
  const thr = levels.filter(v => v <= y1).map(v => `<line x1="4" x2="${W - 4}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3"/><text x="${W - 4}" y="${Y(v) - 2}" font-size="9" text-anchor="end" fill="currentColor" fill-opacity=".6">${fmtLevel(v)}</text>`).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Niveau sur ${Math.round((t1 - t0) / 3600e3)} heures">
    ${thr}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="${X(t1)}" cy="${Y(l.at(-1).mm)}" r="3.5" fill="var(--accent)"/>
    <text x="4" y="${H - 2}" font-size="9" fill="currentColor" fill-opacity=".6">il y a ${Math.round((t1 - t0) / 3600e3)} h</text>
    <text x="${W - 4}" y="${H - 2}" font-size="9" text-anchor="end" fill="currentColor" fill-opacity=".6">maintenant</text></svg>`;
}

function renderScenarios() {
  const box = $("scenarioBox");
  if (!state.scenarios.length) {
    box.innerHTML = `<div class="box"><div class="k">Simulation « baignoire » (indicative)</div>
      <div><b id="btLbl"></b></div><input type="range" id="bt" min="0" max="10" step="0.1" value="${state.bathtub}">
      <p class="note">Plan d'eau horizontal à partir du point le plus bas de la zone : ne tient compte ni du débit, ni des digues, ni de la pente de la rivière.</p></div>`;
    const lbl = () => ($("btLbl").textContent = state.bathtub ? `+${fmt(state.bathtub)} m (altitude ${fmt(state.dem.min + state.bathtub)} m)` : "désactivée");
    lbl();
    let raf;
    $("bt").oninput = e => { state.bathtub = +e.target.value; lbl(); cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); };
    return;
  }
  const i = currentIndex();
  box.innerHTML = `<div class="box"><div class="k">Carte affichée</div>
    <div><b>${state.mode === "now" ? "Maintenant" : "Scénario"}</b> · ${i >= 0 ? `zone inondée pour ${fmtLevel(state.scenarios[i].levelMm)} à la station` : "aucune zone inondée cartographiée"}</div>
    <div class="chips">
      <button class="btn ${state.mode === "now" ? "on" : ""}" data-s="now" ${currentLevel() ? "" : "disabled"}>Maintenant</button>
      ${state.scenarios.map((s, k) => `<button class="btn ${state.mode === k ? "on" : ""}" data-s="${k}">${fmtLevel(s.levelMm)}</button>`).join("")}
      <button class="btn" id="play" title="Faire défiler les scénarios">▶</button>
    </div>
    <p class="note">Et si la rivière monte ? Choisissez un niveau à la station. Source : ${esc(state.scenarios[0].study || "Vigicrues")}.</p></div>`;
  box.querySelectorAll("[data-s]").forEach(b => (b.onclick = () => { stopPlay(); state.mode = b.dataset.s === "now" ? "now" : +b.dataset.s; apply(); }));
  $("play").onclick = togglePlay;
}

let playTimer = null;
function togglePlay() {
  if (playTimer) return stopPlay();
  let k = -1;
  const step = () => { k = (k + 1) % state.scenarios.length; state.mode = k; apply(); $("play").textContent = "❚❚"; };
  step(); playTimer = setInterval(step, 1600);
}
function stopPlay() { clearInterval(playTimer); playTimer = null; }

// ---------- tab: my address ----------
function renderHome() {
  const el = $("tab-home"), b = state.buildings[state.homeIndex];
  const inPPRI = (x, y) => state.ppri.some(f => polygonsOf(f.geometry).some(r => pointInRings(x, y, r)));
  const [ax, ay] = state.addr.l93;
  let html = `<div class="k">Adresse</div><div><b>${esc(state.addr.label)}</b></div>`;
  if (!b) {
    el.innerHTML = html + `<p class="note">Aucun bâtiment trouvé à moins de 40 m du point d'adresse. Cliquez sur un bâtiment dans la vue 3D pour voir son exposition.</p>`;
    return;
  }
  const d = state.depths?.[state.homeIndex] || 0;
  html += `<div class="box" style="margin-top:8px">
    <div class="k">Au pied du bâtiment, sur la carte affichée</div>
    <div class="big">${d ? depthLabel(d) + " d'eau" : "Hors d'eau"}</div>
    <span class="status ${d ? "wet" : "dry"}">${d ? "Zone inondée" : "Pas d'eau cartographiée"}</span>
    ${state.homeGuessed ? `<p class="note">Bâtiment le plus proche du point d'adresse. Si ce n'est pas le bon, cliquez sur le vôtre dans la 3D puis « C'est mon bâtiment ».</p>` : ""}
  </div>`;
  if (state.scenarios.length) {
    const first = state.scenarios.findIndex((_, k) => depthsFor(k)[state.homeIndex]);
    html += `<h2 class="sec">Selon le niveau à la station</h2><table><tr><th>Niveau à la station</th><th>Eau au pied du bâtiment</th></tr>
      ${state.scenarios.map((s, k) => `<tr class="click ${k === currentIndex() ? "cur" : ""}" data-s="${k}"><td>${fmtLevel(s.levelMm)}</td><td>${depthLabel(depthsFor(k)[state.homeIndex])}</td></tr>`).join("")}</table>
      <p class="note">${first >= 0 ? `L'eau atteint ce bâtiment à partir de <b>${fmtLevel(state.scenarios[first].levelMm)}</b> à la station (premier scénario cartographié qui le touche).`
        : "Aucun des scénarios cartographiés n'atteint ce bâtiment."}</p>`;
  }
  html += `<h2 class="sec">Réglementation</h2><p class="note" style="color:var(--text)">${state.ppriError ? "PPRI : service indisponible."
    : inPPRI(ax, ay) || polygonsOf(b.geometry)[0][0].some(([x, y]) => inPPRI(x, y))
      ? `Dans la zone réglementée du <b>PPRI ${esc(state.ppri[0]?.name || "")}</b> (zones rouge et bleue confondues).`
      : state.ppri.length ? "Hors de l'enveloppe du PPRI." : "Pas de PPRI inondation publié sur cette zone."}</p>`;
  el.innerHTML = html;
  el.querySelectorAll("tr[data-s]").forEach(tr => (tr.onclick = () => { stopPlay(); state.mode = +tr.dataset.s; apply(); }));
}

// ---------- tab: report for town hall / rescue ----------
function renderReport() {
  const el = $("tab-report");
  if (!state.raster) {
    el.innerHTML = `<p class="note">Aucune zone inondée sur la carte affichée. Choisissez un scénario (ou montez le niveau de la simulation) pour obtenir le bilan.</p>`;
    return;
  }
  const s = summarize(state.analysisRaster, state.buildings, state.roads);
  state.report = s;
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${s.hit.length}</b><span class="k">bâtiments touchés</span></div>
      <div class="stat"><b>${s.dwellings}</b><span class="k">logements${s.unknownDwellings ? ` (+${s.unknownDwellings} bât. non renseignés)` : ""}</span></div>
      <div class="stat"><b>${s.cutRoads.length}</b><span class="k">voies touchées</span></div>
    </div>
    <table>${DEPTH_CLASSES.map((c, i) => `<tr><td><span class="sw" style="display:inline-block;vertical-align:-2px;background:${c.color}"></span> ${c.label}</td><td class="num">${s.byClass[i]} bât.</td></tr>`).join("")}</table>
    ${s.sensitive.length ? `<h2 class="sec">Établissements non résidentiels touchés</h2><table>${s.sensitive.map(h => `<tr class="click" data-b="${state.buildings.indexOf(h.b)}"><td>${esc(h.b.properties.usage_1)}${h.b.properties.usage_2 ? ` / ${esc(h.b.properties.usage_2)}` : ""}</td><td class="num">${depthLabel(h.depth)}</td></tr>`).join("")}</table>` : ""}
    <h2 class="sec">Voies sous l'eau</h2>
    ${s.cutRoads.length ? `<table><tr><th>Voie</th><th class="num">Longueur</th><th class="num">Eau</th></tr>${s.cutRoads.slice(0, 40).map(r => `<tr><td>${esc(r.name)}<div class="k">${esc(r.nature || "")}</div></td><td class="num">${Math.round(r.wet)} m</td><td class="num">${depthLabel(r.depth)}</td></tr>`).join("")}</table>` : `<p class="note">Aucune voie touchée.</p>`}
    <h2 class="sec">Bâtiments touchés (les plus exposés d'abord)</h2>
    <table><tr><th>Usage</th><th class="num">Logts</th><th class="num">Eau</th></tr>${s.hit.slice(0, 60).map(h => `<tr class="click" data-b="${state.buildings.indexOf(h.b)}"><td>${esc(h.b.properties.usage_1 || "—")}</td><td class="num">${h.b.properties.nombre_de_logements ?? "?"}</td><td class="num">${depthLabel(h.depth)}</td></tr>`).join("")}</table>
    ${s.hit.length > 60 ? `<p class="note">${s.hit.length - 60} autres dans l'export.</p>` : ""}
    <div class="chips" style="margin-top:10px"><button class="btn" id="csv">Exporter CSV</button><button class="btn" id="geojson">Exporter GeoJSON</button></div>
    <p class="note">Hauteurs par classes Vigicrues au pied du bâtiment (point le plus exposé de son emprise). Logements : IGN BD TOPO, parfois non renseignés.</p>`;
  el.querySelectorAll("tr[data-b]").forEach(tr => (tr.onclick = () => { viewer.focusBuilding(+tr.dataset.b); showBuilding(+tr.dataset.b); }));
  $("csv").onclick = exportCSV; $("geojson").onclick = exportGeoJSON;
}

function scenarioTag() {
  if (state.mode === "bathtub") return `baignoire-${fmt(state.bathtub)}m`;
  const i = currentIndex(); return i >= 0 ? `station-${(state.scenarios[i].levelMm / 1000).toFixed(2)}m` : "aucun";
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function centroid(b) { const r = polygonsOf(b.geometry)[0][0]; return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; }
function exportCSV() {
  const rows = [["id_bdtopo", "id_rnb", "usage", "logements", "etages", "hauteur_m", "eau_au_pied", "x_l93", "y_l93", "lon", "lat"]];
  for (const h of state.report.hit) {
    const p = h.b.properties, c = centroid(h.b), w = toWGS(c);
    rows.push([p.cleabs, p.identifiants_rnb, p.usage_1, p.nombre_de_logements ?? "", p.nombre_d_etages ?? "", p.hauteur ?? "", depthLabel(h.depth), c[0].toFixed(1), c[1].toFixed(1), w[0].toFixed(6), w[1].toFixed(6)]);
  }
  download(`crue3d-batiments-${scenarioTag()}.csv`, "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n"), "text/csv");
}
function exportGeoJSON() {
  const features = state.report.hit.map(h => ({
    type: "Feature",
    properties: { id_bdtopo: h.b.properties.cleabs, usage: h.b.properties.usage_1, logements: h.b.properties.nombre_de_logements, eau_au_pied: depthLabel(h.depth), classe: h.depth },
    geometry: { type: "MultiPolygon", coordinates: polygonsOf(h.b.geometry).map(rings => rings.map(r => r.map(p => toWGS(p)))) },
  }));
  download(`crue3d-batiments-${scenarioTag()}.geojson`, JSON.stringify({ type: "FeatureCollection", features }), "application/geo+json");
}

// ---------- tab: layers ----------
function renderLayers() {
  const items = [["buildings", "Bâtiments"], ["water3d", "Surface de l'eau en 3D"], ["ppri", `Contour du PPRI${state.ppri.length ? "" : " (aucun ici)"}`]];
  const t = state.trees || { status: "idle" };
  const treeNote = {
    idle: "Relevé laser LiDAR HD de l'IGN, environ 3 Mo à télécharger.",
    loading: "Chargement du relevé LiDAR…",
    ready: `${t.count} arbre${t.count > 1 ? "s" : ""} détecté${t.count > 1 ? "s" : ""}, à leur hauteur réelle. Ils deviennent transparents quand une crue est affichée.`,
    none: "Pas de relevé LiDAR HD sur cette zone pour le moment.",
    error: "Relevé LiDAR indisponible pour le moment. Décochez puis recochez pour réessayer.",
  }[t.status];
  $("tab-layers").innerHTML = items.map(([id, label]) => `<label class="toggle"><input type="checkbox" data-l="${id}" ${viewer.layers[id] ? "checked" : ""}> ${label}</label>`).join("")
    + `<label class="toggle"><input type="checkbox" data-l="trees" ${viewer.layers.trees ? "checked" : ""}> Arbres</label>
       <p class="note" style="margin:0 0 6px 26px">${treeNote}</p>`
    + `<p class="note">Couleurs au sol et sur les façades : hauteur d'eau (classes Vigicrues). Trait rouge pointillé : enveloppe des zones réglementées du PPRI.</p>`;
  $("tab-layers").querySelectorAll("[data-l]").forEach(i => (i.onchange = () => {
    viewer.setLayer(i.dataset.l, i.checked);
    if (i.dataset.l === "trees" && i.checked && ["idle", "error"].includes(state.trees?.status)) loadTrees();
  }));
}

/** Trees are loaded on demand: the LiDAR surface model is the heaviest download of the app. */
async function loadTrees() {
  const bbox = state.bbox;
  state.trees = { status: "loading" };
  renderLayers();
  try {
    const surface = await fetchSurfaceModel(bbox);
    if (bbox !== state.bbox) return;                    // the user moved to another address meanwhile
    if (surface.coverage < 0.05) { state.trees = { status: "none" }; return; }
    const mask = rasterizeMask(state.buildings, bbox, surface, 1.5);
    const chm = canopyHeight(surface, bbox, (x, y) => viewer.heightAt(x, y), mask);
    const trees = detectTrees(chm, surface.cols, surface.rows, surface.res, bbox);
    viewer.setTrees(trees);
    state.trees = { status: trees.length ? "ready" : "none", count: trees.length };
  } catch {
    if (bbox === state.bbox) state.trees = { status: "error" };
  } finally {
    if (bbox === state.bbox) renderLayers();
  }
}

function renderLegend() {
  $("legend").innerHTML = `<div class="k" style="margin-bottom:4px">Hauteur d'eau</div>` + DEPTH_CLASSES.map(c => `<div class="row"><span class="sw" style="background:${c.color}"></span>${c.label}</div>`).join("");
}

document.querySelectorAll(".tabs button").forEach(b => (b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach(t => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
}));
document.querySelectorAll("[data-view]").forEach(b => (b.onclick = () => viewer.view(b.dataset.view)));

// ---------- building card ----------
function showBuilding(bi) {
  const card = $("card"), b = state.buildings[bi];
  if (bi == null || !b) { card.hidden = true; return; }
  const p = b.properties, d = state.depths?.[bi] || 0;
  card.innerHTML = `<button class="close" aria-label="Fermer">×</button>
    <h3>${esc(p.usage_1 || "Bâtiment")}${bi === state.homeIndex ? " · votre adresse" : ""}</h3>
    <div class="k">${p.nombre_de_logements != null ? `${p.nombre_de_logements} logement(s) · ` : ""}${p.nombre_d_etages ? `${p.nombre_d_etages} niveau(x) · ` : ""}${p.hauteur ? `${fmt(p.hauteur)} m de haut` : ""}</div>
    <div style="margin-top:8px"><span class="status ${d ? "wet" : "dry"}">${d ? `${depthLabel(d)} d'eau au pied` : "Hors d'eau"}</span></div>
    ${state.scenarios.length ? `<table style="margin-top:8px">${state.scenarios.map((s, k) => `<tr class="${k === currentIndex() ? "cur" : ""}"><td>${fmtLevel(s.levelMm)}</td><td>${depthLabel(depthsFor(k)[bi])}</td></tr>`).join("")}</table>` : ""}
    ${bi !== state.homeIndex ? `<button class="btn" id="setHome" style="margin-top:8px">C'est mon bâtiment</button>` : ""}`;
  card.hidden = false;
  card.querySelector(".close").onclick = () => { card.hidden = true; viewer.select(null); };
  const sh = $("setHome");
  if (sh) sh.onclick = () => { state.homeIndex = bi; state.homeGuessed = false; viewer.homeIndex = bi; viewer.group.remove(viewer.pin); viewer.buildPin(); renderHome(); showBuilding(bi); };
}

// ---------- video export ----------
const placeName = full => (full ? state.addr.label : (state.addr.city || state.addr.label.match(/\d{5}\s+(.+)$/)?.[1] || state.addr.label));

function videoSteps() {
  const station = state.stationInfo?.label || state.station?.label || "";
  const hit = k => depthsFor(k).reduce((n, v) => n + (v ? 1 : 0), 0);
  const steps = [{ hold: 2200, caption: "Rivière dans son lit", detail: station ? `Station de référence : ${station}` : "", run: () => { state.mode = -1; apply(); } }];
  state.scenarios.forEach((s, k) => steps.push({
    hold: 2700, caption: `Rivière à ${fmtLevel(s.levelMm)}`,
    detail: `${hit(k)} bâtiment${hit(k) > 1 ? "s" : ""} touché${hit(k) > 1 ? "s" : ""} · niveau mesuré à la station`,
    run: () => { state.mode = k; apply(); },
  }));
  steps.at(-1).hold = 4200;
  return steps;
}

let lastVideo = null;
$("videoBtn").onclick = () => {
  const ok = state.scenarios.length > 0 && pickMime();
  $("vidStatus").textContent = !pickMime() ? "Votre navigateur ne permet pas d'enregistrer une vidéo (essayez Chrome, Edge ou Safari récent)."
    : !state.scenarios.length ? "Pas de scénario Vigicrues sur cette zone : la vidéo n'est disponible que là où les crues sont cartographiées." : "";
  $("vidStart").disabled = !ok;
  $("videoDlg").showModal();
};
$("vidClose").onclick = () => $("videoDlg").close();
$("vidStart").onclick = async () => {
  const format = document.querySelector("input[name=vidFormat]:checked").value;
  const previous = state.mode;
  $("vidForm").hidden = true; $("vidStart").hidden = true; $("vidDownload").hidden = true; $("vidShare").hidden = true;
  $("vidPreview").hidden = false;
  $("vidClose").disabled = true;
  try {
    const site = new URL("../", location.href).href.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const { blob, ext, mime } = await recordFloodVideo(viewer, {
      format, place: placeName($("vidAddress").checked), site, steps: videoSteps(), preview: $("vidPreview"),
      onProgress: p => ($("vidStatus").textContent = `Enregistrement… ${Math.round(p * 100)} %`),
    });
    if (lastVideo) URL.revokeObjectURL(lastVideo);
    lastVideo = URL.createObjectURL(blob);
    const video = Object.assign(document.createElement("video"), { src: lastVideo, controls: true, loop: true, muted: true, playsInline: true });
    $("vidPreview").replaceChildren(video);
    const name = `crue3d-${placeName(false).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${format}.${ext}`;
    Object.assign($("vidDownload"), { href: lastVideo, download: name, hidden: false });
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      $("vidShare").hidden = false;
      $("vidShare").onclick = () => navigator.share({ files: [file], title: "Crue 3D" }).catch(() => {});
    }
    $("vidStatus").textContent = `Vidéo prête (${(blob.size / 1e6).toFixed(1)} Mo, ${ext.toUpperCase()}).`
      + (ext === "webm" ? " Ce navigateur produit du WebM : certains réseaux sociaux demandent du MP4 (Safari ou Chrome récent en produisent)." : "");
  } catch (e) {
    $("vidStatus").textContent = `Échec de l'enregistrement : ${e.message}`;
  } finally {
    state.mode = previous; apply();
    $("vidForm").hidden = false; $("vidStart").hidden = false; $("vidClose").disabled = false;
  }
};

// Refresh the real-time level every 5 minutes; the map follows it in "now" mode.
setInterval(async () => {
  if (!state.station || document.hidden) return;
  try {
    const levels = await fetchWaterLevels(state.station.code);
    if (levels.length && +levels.at(-1).t !== +(currentLevel()?.t ?? 0)) { state.levels = levels; apply(); }
  } catch { /* keep the last known level; the panel shows its timestamp */ }
}, 5 * 60e3);

// Dev only: /app/?loader shows the loading screen in a loop (not in production builds).
if (import.meta.env.DEV && new URL(location.href).searchParams.has("loader")) {
  $("empty").hidden = true;
  $("loading").hidden = false;
  const mark = steps([["dem", "Relief (IGN)"], ["bati", "Bâtiments et routes (IGN BD TOPO)"], ["vigi", "Cartes de crue Vigicrues"], ["ppri", "PPRI (Géoportail de l'Urbanisme)"], ["level", "Niveau de la rivière en direct"]]);
  let k = 0;
  setInterval(() => {
    const ids = ["dem", "bati", "vigi", "ppri", "level"];
    if (k === ids.length) { document.querySelectorAll("#steps li").forEach(li => (li.className = "")); k = 0; return; }
    mark(ids[k++]);
  }, 900);
}

if (import.meta.env.DEV) window.__crue = { state, depthsFor: i => depthsFor(i), showBuilding, get viewer() { return viewer; } };

// ---------- boot ----------
const params = new URL(location.href).searchParams;
if (params.get("zone")) areaSel.value = params.get("zone");
if (params.get("q")) {
  $("q").value = params.get("q");
  const lon = parseFloat(params.get("lon")), lat = parseFloat(params.get("lat"));
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    // shared links carry the coordinates: no second geocoding, no risk of landing on a homonym
    load({ label: params.get("q"), lonlat: [lon, lat], l93: toL93([lon, lat]) });
  } else {
    searchAddress(params.get("q"), 1).then(([a]) => (a ? load(a) : fail("Adresse introuvable."))).catch(e => fail(e.message));
  }
}

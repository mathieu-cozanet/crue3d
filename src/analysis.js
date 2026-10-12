// Pure functions: scenario selection and flood impact on buildings and roads.
// A "raster" is { data: Uint8Array, cols, rows, res, minx, maxy } where data holds 0 (dry) or depth class index + 1.
import { DEPTH_CLASSES } from "./config.js";
import { polygonsOf, linesOf, pointInRings } from "./geo.js";

export function classIndex(minMm) {
  const i = DEPTH_CLASSES.findIndex(c => c.min === minMm);
  return i >= 0 ? i : DEPTH_CLASSES.findIndex(c => minMm >= c.min && minMm < c.max);
}

/** Group Vigicrues ZIP/ZICH features by reference station, scenarios sorted by station level. */
export function groupScenarios(zip, zich) {
  const stations = new Map();
  for (const z of zip) {
    const p = z.properties;
    if (p.diffusion === false || !p.cdstationhydro) continue;
    const toMm = p.hauteurunite === "cm" ? 10 : p.hauteurunite === "m" ? 1000 : 1;
    if (!stations.has(p.cdstationhydro)) stations.set(p.cdstationhydro, { code: p.cdstationhydro, label: p.lbstationhydro, scenarios: [] });
    stations.get(p.cdstationhydro).scenarios.push({
      id: p.idzip, levelMm: p.hauteurstation * toMm, study: p.commentaire, date: p.hauteurdtvalidite,
      extent: z.geometry,
      classes: zich.filter(c => c.properties.idzip === p.idzip)
        .map(c => ({ k: classIndex(c.properties.hauteurmin), geometry: c.geometry }))
        .filter(c => c.k >= 0),
    });
  }
  for (const s of stations.values()) s.scenarios.sort((a, b) => a.levelMm - b.levelMm);
  return [...stations.values()].sort((a, b) => b.scenarios.length - a.scenarios.length);
}

/** Highest scenario whose station level is reached; -1 when the river is below the first mapped level. */
export function selectScenario(scenarios, levelMm) {
  let idx = -1;
  scenarios.forEach((s, i) => { if (levelMm >= s.levelMm) idx = i; });
  return idx;
}

export function rasterValue(r, x, y) {
  const c = Math.floor((x - r.minx) / r.res), row = Math.floor((r.maxy - y) / r.res);
  if (c < 0 || row < 0 || c >= r.cols || row >= r.rows) return 0;
  return r.data[row * r.cols + c];
}

/** Deepest class over a building footprint (cells whose centre falls inside, or the footprint vertices). */
export function footprintDepth(r, geometry) {
  let best = 0;
  for (const rings of polygonsOf(geometry)) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [x, y] of rings[0]) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      best = Math.max(best, rasterValue(r, x, y));
    }
    const c0 = Math.floor((minx - r.minx) / r.res), c1 = Math.floor((maxx - r.minx) / r.res);
    const r0 = Math.floor((r.maxy - maxy) / r.res), r1 = Math.floor((r.maxy - miny) / r.res);
    for (let row = Math.max(0, r0); row <= Math.min(r.rows - 1, r1); row++) {
      for (let c = Math.max(0, c0); c <= Math.min(r.cols - 1, c1); c++) {
        const v = r.data[row * r.cols + c];
        if (v <= best) continue;
        const x = r.minx + (c + 0.5) * r.res, y = r.maxy - (row + 0.5) * r.res;
        if (pointInRings(x, y, rings)) best = v;
      }
    }
  }
  return best;
}

/** Flooded length (m) and deepest class along a road, sampling every half cell. */
export function roadFlooding(r, geometry) {
  let wet = 0, total = 0, best = 0;
  const step = r.res / 2;
  for (const line of linesOf(geometry)) {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / step));
      total += len;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, v = rasterValue(r, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        if (v) { wet += len / n; best = Math.max(best, v); }
      }
    }
  }
  return { wet, total, depth: best };
}

export function roadName(p) {
  return p.cpx_toponyme_route_nommee || p.nom_collaboratif_gauche || p.nom_collaboratif_droite
    || p.cpx_numero || `${p.nature || "Voie"} sans nom`;
}

/** Impact summary for one flood raster: buildings by depth class, dwellings, non-residential, cut roads. */
export function summarize(r, buildings, roads) {
  const hit = [];
  for (const b of buildings) {
    const d = footprintDepth(r, b.geometry);
    if (d) hit.push({ b, depth: d });
  }
  hit.sort((a, b) => b.depth - a.depth);
  const byClass = DEPTH_CLASSES.map((_, i) => hit.filter(h => h.depth === i + 1).length);
  const dwellings = hit.reduce((s, h) => s + (h.b.properties.nombre_de_logements || 0), 0);
  const unknownDwellings = hit.filter(h => h.b.properties.usage_1 === "Résidentiel" && h.b.properties.nombre_de_logements == null).length;
  const sensitive = hit.filter(h => !["Résidentiel", "Annexe", "Agricole", "Indifférencié", null, undefined].includes(h.b.properties.usage_1));

  const byName = new Map();
  for (const rd of roads) {
    // bridges and tunnels are not at ground level: the flood map under them says nothing about the deck
    if (rd.properties.position_par_rapport_au_sol && rd.properties.position_par_rapport_au_sol !== "0") continue;
    const f = roadFlooding(r, rd.geometry);
    if (f.wet < 1) continue;
    const name = roadName(rd.properties);
    const cur = byName.get(name) || { name, wet: 0, depth: 0, nature: rd.properties.nature, importance: rd.properties.importance };
    cur.wet += f.wet; cur.depth = Math.max(cur.depth, f.depth);
    byName.set(name, cur);
  }
  const cutRoads = [...byName.values()].sort((a, b) => (a.importance || "9") - (b.importance || "9") || b.wet - a.wet);
  return { hit, byClass, dwellings, unknownDwellings, sensitive, cutRoads };
}

export const fmtLevel = mm => `${(mm / 1000).toFixed(2).replace(".", ",")} m`;
export const depthLabel = v => (v ? DEPTH_CLASSES[v - 1].label : "hors d'eau");

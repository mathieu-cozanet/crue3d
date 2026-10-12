import { API, LAYERS, DEM_RES, DEM_MAX_PX } from "../config.js";
import { bboxParam } from "../geo.js";
import { fetchJSON, fetchBuffer, qs } from "./http.js";

/**
 * All features of a Géoplateforme WFS layer inside the bbox, in Lambert-93 (paged).
 * Paging needs an explicit sort on layers without a primary key (e.g. Vigicrues), hence `sortBy`.
 */
export async function wfsGetAll(typeName, bbox, { sortBy, pageSize = 1000, max = 20000 } = {}) {
  const out = [];
  for (let start = 0; start < max; start += pageSize) {
    const url = `${API.wfs}?${qs({
      service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: typeName,
      srsName: "EPSG:2154", bbox: bboxParam(bbox), outputFormat: "application/json",
      count: pageSize, startIndex: start, ...(sortBy ? { sortBy } : {}),
    })}`;
    const page = await fetchJSON(url);
    out.push(...(page.features || []));
    if ((page.features || []).length < pageSize) break;
  }
  return out;
}

/** Terrain heights as a north-up grid (row 0 = north), cell centres every `res` metres. */
export async function fetchDEM(bbox) {
  let res = DEM_RES;
  while (bbox.w / res > DEM_MAX_PX || bbox.h / res > DEM_MAX_PX) res *= 2;
  const cols = Math.round(bbox.w / res), rows = Math.round(bbox.h / res);
  const url = `${API.wmsr}?${qs({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: LAYERS.dem, STYLES: "",
    CRS: "EPSG:2154", BBOX: `${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}`,
    WIDTH: cols, HEIGHT: rows, FORMAT: "image/x-bil;bits=32",
  })}`;
  return parseBIL(await fetchBuffer(url), cols, rows, res);
}

/** Little-endian float32 grid; IGN uses a large negative value for no-data. */
export function parseBIL(buffer, cols, rows, res) {
  if (buffer.byteLength !== cols * rows * 4) throw new Error("Relief IGN : taille de grille inattendue");
  const grid = new Float32Array(buffer.slice(0));
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const v of grid) if (v > -1000) { min = Math.min(min, v); max = Math.max(max, v); sum += v; n++; }
  if (!n) throw new Error("Relief IGN : aucune donnée sur cette zone");
  const mean = sum / n;
  for (let i = 0; i < grid.length; i++) if (!(grid[i] > -1000)) grid[i] = mean;
  return { grid, cols, rows, res, min, max };
}

export const fetchBuildings = bbox => wfsGetAll(LAYERS.buildings, bbox, { sortBy: "cleabs" });
export const fetchRoads = bbox => wfsGetAll(LAYERS.roads, bbox, { sortBy: "cleabs" });
export const fetchWaterSurfaces = bbox => wfsGetAll(LAYERS.waterSurfaces, bbox, { sortBy: "cleabs" });
export const fetchStreams = bbox => wfsGetAll(LAYERS.streams, bbox, { sortBy: "cleabs" });

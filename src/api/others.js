import { API } from "../config.js";
import { bboxPolygonWGS, toL93 } from "../geo.js";
import { fetchJSON, qs } from "./http.js";

const FLOOD_HAZARD = "11"; // GASPAR hazard code for "inondation"

/**
 * PPRI regulatory envelope (red + blue zones merged) from the Géoportail de l'Urbanisme, in Lambert-93.
 * PM1 servitudes cover every natural-risk plan, so we keep the ones whose generator is a flood hazard.
 */
export async function fetchPPRI(bbox) {
  const geom = JSON.stringify(bboxPolygonWGS(bbox));
  const [ass, gen] = await Promise.all([
    fetchJSON(`${API.gpu}/assiette-sup-s?${qs({ geom, categorie: "PM1" })}`),
    fetchJSON(`${API.gpu}/generateur-sup-s?${qs({ geom, categorie: "PM1" })}`),
  ]);
  const floodGens = new Set((gen.features || []).filter(f => f.properties.code_alea === FLOOD_HAZARD).map(f => f.properties.idgen));
  const toL = rings => rings.map(r => r.map(toL93));
  return (ass.features || [])
    .filter(f => floodGens.has(f.properties.idgen))
    .map(f => ({
      name: (f.properties.nomass || "").replace(/^PM1_/, "").replace(/_\d{8}_ass$/, "").replace(/_/g, " "),
      geometry: f.geometry.type === "Polygon"
        ? { type: "Polygon", coordinates: toL(f.geometry.coordinates) }
        : { type: "MultiPolygon", coordinates: f.geometry.coordinates.map(toL) },
    }));
}

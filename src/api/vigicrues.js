import { API, LAYERS, HISTORY_HOURS } from "../config.js";
import { fetchJSON, qs } from "./http.js";
import { wfsGetAll } from "./ign.js";

/** Vigicrues "zones d'inondation potentielle" (one polygon per station water level) and their depth classes. */
export async function fetchFloodMaps(bbox) {
  const [zip, zich] = await Promise.all([wfsGetAll(LAYERS.zip, bbox, { sortBy: "pk" }), wfsGetAll(LAYERS.zich, bbox, { sortBy: "pk" })]);
  return { zip, zich };
}

export async function fetchStation(code) {
  const d = await fetchJSON(`${API.hubeau}/referentiel/stations?${qs({ code_station: code, format: "json" })}`);
  const s = d.data?.[0];
  if (!s) return { code, label: code };
  return { code, label: s.libelle_station, river: s.libelle_cours_eau, lon: s.longitude_station, lat: s.latitude_station, active: s.en_service };
}

/** Real-time water heights (mm) for the last HISTORY_HOURS, oldest first. */
export async function fetchWaterLevels(code) {
  const since = new Date(Date.now() - HISTORY_HOURS * 3600e3).toISOString();
  const d = await fetchJSON(`${API.hubeau}/observations_tr?${qs({
    code_entite: code, grandeur_hydro: "H", date_debut_obs: since, size: 2000, sort: "asc",
  })}`);
  return (d.data || []).map(o => ({ t: new Date(o.date_obs), mm: o.resultat_obs })).filter(o => Number.isFinite(o.mm));
}

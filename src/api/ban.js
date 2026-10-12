// Base Adresse Nationale geocoding. Kept free of heavy imports: the landing page uses it too.
import { API } from "../config.js";
import { fetchJSON, qs } from "./http.js";

export const MIN_QUERY = 3;

/** Address autocomplete. Returns Lambert-93 coordinates directly (x, y given by the BAN). */
export async function searchAddress(q, limit = 6, { signal } = {}) {
  if (q.trim().length < MIN_QUERY) return [];
  const d = await fetchJSON(`${API.ban}?${qs({ q, limit, autocomplete: 1 })}`, { timeout: 10000, signal });
  return (d.features || []).map(f => {
    const p = f.properties;
    return {
      label: p.label, name: p.name, type: p.type, postcode: p.postcode, city: p.city, citycode: p.citycode,
      department: (p.context || "").split(",")[1]?.trim() || "",
      lonlat: f.geometry.coordinates, l93: [p.x, p.y],
    };
  });
}

import proj4 from "proj4";

proj4.defs("EPSG:2154",
  "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

export const toL93 = ([lon, lat]) => proj4("EPSG:4326", "EPSG:2154", [lon, lat]);
export const toWGS = ([x, y]) => proj4("EPSG:2154", "EPSG:4326", [x, y]);

/** Study area centred on a Lambert-93 point. Local scene coords are L93 minus the centre. */
export function makeBBox([cx, cy], w, h) {
  return { cx, cy, w, h, minx: cx - w / 2, maxx: cx + w / 2, miny: cy - h / 2, maxy: cy + h / 2 };
}

export const bboxParam = b => `${b.minx},${b.miny},${b.maxx},${b.maxy},EPSG:2154`;

export function bboxPolygonWGS(b) {
  const ring = [[b.minx, b.miny], [b.maxx, b.miny], [b.maxx, b.maxy], [b.minx, b.maxy], [b.minx, b.miny]].map(toWGS);
  return { type: "Polygon", coordinates: [ring] };
}

export const haversineKm = ([lon1, lat1], [lon2, lat2]) => {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};

/** Iterate polygons of a GeoJSON Polygon/MultiPolygon geometry as arrays of rings. */
export function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

export function linesOf(geom) {
  if (!geom) return [];
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  return [];
}

/** Even-odd point-in-polygon over all rings (holes handled). */
export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

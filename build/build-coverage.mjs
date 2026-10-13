// Builds public/data/couverture.json: where Vigicrues has mapped flood zones (ZIP), for the coverage map.
// For each reference station we keep its largest mapped flood (highest station level), simplified to ~100 m
// (plenty for a national map, and keeps the file around 2 MB).
// A few maps of large rivers are huge and the service may take minutes to send them: each download gets a
// time limit; past it we fall back to the next smaller scenario, and finally to the station point alone.
// Run: npm run coverage   (also refreshed monthly by .github/workflows/coverage.yml)
import { writeFile, mkdir } from "node:fs/promises";
import { simplifyPolygons } from "./simplify.mjs";

const WFS = "https://data.geopf.fr/wfs/ows";
const HUBEAU = "https://hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations";
const OUT = new URL("../public/data/couverture.json", import.meta.url);
const qs = p => new URLSearchParams(p).toString();

const MAX_BYTES = 40e6;   // past this, a single map is too heavy to parse and simplify in reasonable time

async function getJSON(url, tries = 3, timeoutMs = 120000) {
  for (let i = 1, throttled = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 && throttled < 8) {
        // rate limited by the Géoplateforme: wait as asked (or back off) and retry, without consuming a try
        const wait = (Number(r.headers.get("retry-after")) || 5 * ++throttled) * 1000;
        await r.body?.cancel();
        await new Promise(res => setTimeout(res, wait));
        i--;
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // read the body with a size cap instead of r.json(), which would happily load hundreds of MB
      const reader = r.body.getReader(), parts = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error(`réponse trop volumineuse (> ${MAX_BYTES / 1e6} Mo)`); }
        parts.push(value);
      }
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch (e) {
      if (i >= tries) throw new Error(`${e.message} — ${url.slice(0, 120)}`);
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}


// 1. every flood map, without geometry
const maps = [];
for (let start = 0; ; start += 1000) {
  const page = await getJSON(`${WFS}?${qs({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "VIGINOND-DIFFUSION:zip",
    propertyName: "idzip,cdstationhydro,lbstationhydro,hauteurstation,diffusion", outputFormat: "application/json",
    count: 1000, startIndex: start, sortBy: "pk",
  })}`);
  maps.push(...page.features.map(f => f.properties));
  if (page.features.length < 1000) break;
}
const stations = new Map();
for (const m of maps) {
  if (m.diffusion === false || !m.cdstationhydro) continue;
  const s = stations.get(m.cdstationhydro) || { code: m.cdstationhydro, label: m.lbstationhydro, levels: [], maps: [] };
  s.levels.push(m.hauteurstation);
  s.maps.push(m);
  stations.set(m.cdstationhydro, s);
}
console.log(`${maps.length} cartes, ${stations.size} stations`);

// 2. river names from Hub'Eau (batches of 50 stations)
const list = [...stations.values()];
for (let i = 0; i < list.length; i += 50) {
  const batch = list.slice(i, i + 50);
  // river names are a nicety: a Hub'Eau hiccup must not block the whole build
  const d = await getJSON(`${HUBEAU}?${qs({ code_station: batch.map(s => s.code).join(","), format: "json", size: 100 })}`, 2, 30000)
    .catch(e => { console.log(`  Hub'Eau indisponible pour un lot de stations (${e.message.split(" — ")[0]})`); return {}; });
  for (const r of d.data || []) {
    const s = stations.get(r.code_station);
    if (s) Object.assign(s, { river: r.libelle_cours_eau, name: r.libelle_station, lon: r.longitude_station, lat: r.latitude_station });
  }
}

// 3. geometry of the largest map of each station that arrives in time, simplified
const TOL = 0.001;   // ~100 m

const simplified = geometry => simplifyPolygons(geometry, TOL, 4);   // ~10 m rounding

let done = 0, approx = 0, smaller = 0;
const features = (await pool(list, 3, async s => {   // the Géoplateforme answers 429 above ~3 parallel heavy requests
  const props = {
    code: s.code, station: s.name || s.label, river: s.river || "",
    scenarios: s.levels.length, min: Math.min(...s.levels), max: Math.max(...s.levels),
  };
  const candidates = [...s.maps].sort((a, b) => b.hauteurstation - a.hauteurstation).slice(0, 3);
  let geometry = null;
  for (const [k, m] of candidates.entries()) {
    try {
      const d = await getJSON(`${WFS}?${qs({
        service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "VIGINOND-DIFFUSION:zip",
        outputFormat: "application/json", srsName: "EPSG:4326", CQL_FILTER: `idzip=${m.idzip}`,
      })}`, 1, 60000);
      const g = d.features?.[0]?.geometry;
      const t0 = Date.now();
      geometry = g && simplified(g);
      if (g && !geometry) {   // a tiny mapped area vanishes at ~100 m: keep it as a point rather than lose it
        const ring = (g.type === "Polygon" ? g.coordinates : g.coordinates[0])[0];
        const c = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length], [0, 0]);
        geometry = { type: "Point", coordinates: c.map(v => Math.round(v * 1e4) / 1e4) };
        props.small = true;
      }
      if (Date.now() - t0 > 3000) console.log(`  ${s.code} ${s.label} : simplification ${Math.round((Date.now() - t0) / 1000)} s`);
      if (geometry) { if (k) { smaller++; props.mapped = m.hauteurstation; } break; }
    } catch (e) {
      console.log(`  ${s.code} ${s.label} : carte ${m.idzip} trop lente (${e.message.split(" — ")[0]})`);
    }
  }
  if (++done % 25 === 0) console.log(`  ${done}/${list.length}`);
  if (geometry) return { type: "Feature", properties: props, geometry };
  if (s.lon == null) return null;
  approx++;
  return { type: "Feature", properties: { ...props, approx: true }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } };
})).filter(Boolean);
console.log(`${smaller} stations avec un scénario plus petit, ${approx} stations sans emprise (point seul)`);

await mkdir(new URL(".", OUT), { recursive: true });
const json = JSON.stringify({ type: "FeatureCollection", generated: new Date().toISOString().slice(0, 10), features });
await writeFile(OUT, json);
console.log(`${features.length} zones écrites, ${(json.length / 1e6).toFixed(2)} Mo`);

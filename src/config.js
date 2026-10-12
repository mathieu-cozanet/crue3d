// Public endpoints — all of them answer with CORS headers, so the app runs as a static site.
export const API = {
  ban: "https://api-adresse.data.gouv.fr/search/",
  wfs: "https://data.geopf.fr/wfs/ows",
  wmsr: "https://data.geopf.fr/wms-r/wms",
  hubeau: "https://hubeau.eaufrance.fr/api/v2/hydrometrie",
  gpu: "https://apicarto.ign.fr/api/gpu",
  vigicruesStation: code => `https://www.vigicrues.gouv.fr/station/${code}`,
};

export const LAYERS = {
  dem: "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES",
  buildings: "BDTOPO_V3:batiment",
  roads: "BDTOPO_V3:troncon_de_route",
  waterSurfaces: "BDTOPO_V3:surface_hydrographique",
  streams: "BDTOPO_V3:troncon_hydrographique",
  zip: "VIGINOND-DIFFUSION:zip",
  zich: "VIGINOND-DIFFUSION:zich",
};

// Study area around the address, in metres.
export const AREA_SIZES = [
  { label: "500 × 350 m", w: 500, h: 350 },
  { label: "1 000 × 700 m", w: 1000, h: 700 },
  { label: "1 500 × 1 000 m", w: 1500, h: 1000 },
];
export const DEFAULT_AREA = 1;

// Terrain grid resolution in metres (IGN RGE ALTI is 1 m; 2 m keeps the mesh light).
export const DEM_RES = 2;
export const DEM_MAX_PX = 1024;

// Vigicrues ZICH water-depth classes (mm). The last class is open-ended (hauteurmax = 9999999).
export const DEPTH_CLASSES = [
  { min: 0, max: 500, label: "0 – 0,5 m", color: "#a6d4ef" },
  { min: 500, max: 1000, label: "0,5 – 1 m", color: "#5aa9dc" },
  { min: 1000, max: 1500, label: "1 – 1,5 m", color: "#2b78bf" },
  { min: 1500, max: 2000, label: "1,5 – 2 m", color: "#17509a" },
  { min: 2000, max: Infinity, label: "plus de 2 m", color: "#0b2e66" },
];

export const HISTORY_HOURS = 48;

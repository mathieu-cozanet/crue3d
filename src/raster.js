// Rasterise Vigicrues depth-class polygons onto the terrain grid (browser canvas).
import { polygonsOf } from "./geo.js";

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

/**
 * Returns { data, cols, rows, res, minx, maxy } with 0 = dry, k + 1 = depth class k.
 * `grid` is the target grid: the terrain grid for display, or a finer one for building analysis.
 */
export function rasterizeScenario(scenario, bbox, grid) {
  const { cols, rows, res } = grid;
  const canvas = makeCanvas(cols, rows);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const px = x => (x - bbox.minx) / res, py = y => (bbox.maxy - y) / res;
  const fillGeom = (geometry, k) => {
    g.fillStyle = `rgb(${k},0,0)`;
    g.beginPath();
    for (const rings of polygonsOf(geometry)) for (const ring of rings) {
      ring.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
      g.closePath();
    }
    g.fill("evenodd");
  };
  // The flooded extent first, so pixels on the border between two depth classes stay fully covered
  // (otherwise antialiasing leaves dry-looking seams); then shallow to deep classes.
  if (scenario.extent) fillGeom(scenario.extent, 1);
  for (const cl of [...scenario.classes].sort((a, b) => a.k - b.k)) fillGeom(cl.geometry, cl.k + 1);
  const img = g.getImageData(0, 0, cols, rows).data;
  const data = new Uint8Array(cols * rows);
  // a cell is wet when more than half covered; its (unpremultiplied) red channel holds the class
  for (let i = 0; i < data.length; i++) if (img[i * 4 + 3] > 127) data[i] = Math.min(5, Math.max(1, Math.round(img[i * 4])));
  return { data, cols, rows, res, minx: bbox.minx, maxy: bbox.maxy };
}

/** 1 m grid over the area (capped for large areas), used to measure water at building footprints. */
export function analysisGrid(bbox, maxCells = 2.5e6) {
  let res = 1;
  while ((bbox.w / res) * (bbox.h / res) > maxCells) res *= 2;
  return { cols: Math.round(bbox.w / res), rows: Math.round(bbox.h / res), res };
}

/** "Bathtub" raster: every cell below the given altitude, depth class from the height of water. */
export function rasterizeLevel(altitude, bbox, dem) {
  const { cols, rows, res, grid } = dem;
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < data.length; i++) {
    const d = (altitude - grid[i]) * 1000;
    if (d > 0) data[i] = Math.min(5, Math.floor(d / 500) + 1);
  }
  return { data, cols, rows, res, minx: bbox.minx, maxy: bbox.maxy, bathtub: true, altitude };
}

/** 1 where a polygon (grown by `bufferM` metres) covers the cell: used to keep roofs out of the canopy. */
export function rasterizeMask(features, bbox, grid, bufferM = 0) {
  const { cols, rows, res } = grid;
  const canvas = makeCanvas(cols, rows);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const px = x => (x - bbox.minx) / res, py = y => (bbox.maxy - y) / res;
  g.fillStyle = g.strokeStyle = "#fff";
  g.lineWidth = (2 * bufferM) / res;
  g.lineJoin = "round";
  g.beginPath();
  for (const f of features) for (const rings of polygonsOf(f.geometry)) for (const ring of rings) {
    ring.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
    g.closePath();
  }
  g.fill("evenodd");
  if (bufferM > 0) g.stroke();
  const img = g.getImageData(0, 0, cols, rows).data;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4 + 3] > 64 ? 1 : 0;
  return mask;
}

// Water surface for rendering (pure). The analysis keeps using the official depth classes;
// this only shapes what is drawn: a smooth surface whose shoreline is where it meets the terrain.

/** Representative depth (m) of each Vigicrues class, used to draw the water and the façade water line. */
export const DEPTH_MID = [0.25, 0.75, 1.25, 1.75, 2.5];

/**
 * Absolute water-surface altitude per terrain cell (north-up grid, same cells as the DEM).
 * - flood map: ground + class depth, smoothed over wet cells (normalised box filter of `radius` cells),
 *   extended by one cell so the shoreline is drawn where the surface meets the terrain, not on cell edges;
 * - "bathtub": a flat plane at the given altitude;
 * - dry cells sit `dryDrop` metres under the ground (invisible, but ready to rise in an animation).
 */
export function waterSurface(raster, dem, { radius = 3, dryDrop = 0.6 } = {}) {
  const { grid, cols, rows } = dem, n = cols * rows, out = new Float32Array(n);
  if (!raster) { for (let i = 0; i < n; i++) out[i] = grid[i] - dryDrop; return out; }
  if (raster.bathtub) return out.fill(raster.altitude);

  // summed-area tables of wet surface altitudes and wet-cell counts
  const W = cols + 1, S = new Float64Array(W * (rows + 1)), C = new Float64Array(W * (rows + 1));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, k = raster.data[i];
    const s = k ? grid[i] + DEPTH_MID[k - 1] : 0, a = (r + 1) * W + c + 1;
    S[a] = s + S[a - W] + S[a - 1] - S[a - W - 1];
    C[a] = (k ? 1 : 0) + C[a - W] + C[a - 1] - C[a - W - 1];
  }
  const box = (T, r, c, rad) => {
    const r0 = Math.max(0, r - rad), r1 = Math.min(rows - 1, r + rad), c0 = Math.max(0, c - rad), c1 = Math.min(cols - 1, c + rad);
    return T[(r1 + 1) * W + c1 + 1] - T[r0 * W + c1 + 1] - T[(r1 + 1) * W + c0] + T[r0 * W + c0];
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (raster.data[i]) {
      out[i] = Math.max(box(S, r, c, radius) / box(C, r, c, radius), grid[i] + 0.05);
    } else if (box(C, r, c, 1) > 0) {
      out[i] = box(S, r, c, radius) / box(C, r, c, radius);   // may be under the ground: then not drawn
    } else {
      out[i] = grid[i] - dryDrop;
    }
  }
  return out;
}

/** Water line on a building façade (scene height), or just under its base when dry. */
export const facadeWaterTop = (depthClass, base) => (depthClass ? base + DEPTH_MID[depthClass - 1] : base - 0.6);

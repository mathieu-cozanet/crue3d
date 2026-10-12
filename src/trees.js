// Individual trees from the LiDAR canopy height model (surface model minus terrain). Pure functions.
// Grids are north-up (row 0 = north), cell centres every `res` metres from (minx, maxy).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Height above ground of the surface, NaN where there is no survey or where a building stands. */
export function canopyHeight(surface, origin, groundAt, mask) {
  const { grid, cols, rows, res } = surface;
  const chm = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (Number.isNaN(grid[i]) || mask?.[i]) { chm[i] = NaN; continue; }
    chm[i] = grid[i] - groundAt(origin.minx + (c + 0.5) * res, origin.maxy - (r + 0.5) * res);
  }
  return chm;
}

/** Fallback crown radius (m) from tree height, a rough allometry for temperate broadleaves. */
export const crownRadius = h => clamp(0.12 * h + 1.2, 1.5, 7);

/**
 * Tree tops = local maxima of the lightly smoothed canopy, with a search window growing with height
 * (tall trees have wide crowns, so nearby bumps belong to the same tree).
 * Returns [{ x, y, h, r }] in map coordinates, tallest first.
 */
export function detectTrees(chm, cols, rows, res, origin, { minHeight = 3, maxTrees = 25000 } = {}) {
  const n = cols * rows, sm = new Float32Array(n).fill(NaN);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (Number.isNaN(chm[i])) continue;
    let s = 0, k = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const v = chm[rr * cols + cc];
      if (!Number.isNaN(v)) { s += v; k++; }
    }
    sm[i] = s / k;
  }

  const trees = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = sm[i];
    if (!(h >= minHeight)) continue;
    const R = Math.max(1, Math.round(clamp(1 + 0.12 * h, 2, 6) / res));
    let isMax = true;
    for (let dr = -R; dr <= R && isMax; dr++) for (let dc = -R; dc <= R; dc++) {
      if (dr * dr + dc * dc > R * R || (!dr && !dc)) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc, v = sm[j];
      if (v > h || (v === h && j < i)) { isMax = false; break; }  // ties: keep the first cell only
    }
    if (!isMax) continue;
    let top = h;  // tree height = highest raw return around the smoothed peak
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) { const v = chm[rr * cols + cc]; if (v > top) top = v; }
    }
    trees.push({ c, r, h: top, cells: 0 });
  }
  measureCrowns(chm, cols, rows, res, trees);
  trees.sort((a, b) => b.h - a.h);
  return trees.slice(0, maxTrees).map(t => ({
    x: origin.minx + (t.c + 0.5) * res, y: origin.maxy - (t.r + 0.5) * res, h: t.h,
    r: t.cells ? clamp(Math.sqrt((t.cells * res * res) / Math.PI), 1.5, 9) : crownRadius(t.h),
  }));
}

/**
 * Crown size measured on the canopy itself: every vegetated cell goes to the nearest tree top
 * (within 9 m, and only if it stands at 40 % or more of that tree's height); the crown radius is the
 * radius of a disc of the same area. Dense woods thus render as a continuous canopy, not lollipops.
 */
function measureCrowns(chm, cols, rows, res, trees) {
  const maxR = 9 / res, B = Math.ceil(maxR), bcols = Math.ceil(cols / B), buckets = new Map();
  trees.forEach((t, k) => {
    const key = Math.floor(t.r / B) * bcols + Math.floor(t.c / B);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(k);
  });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = chm[r * cols + c];
    if (!(v >= 2)) continue;
    const br = Math.floor(r / B), bc = Math.floor(c / B);
    let best = -1, bestD = maxR * maxR;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      for (const k of buckets.get((br + dr) * bcols + bc + dc) || []) {
        const t = trees[k], d = (t.r - r) ** 2 + (t.c - c) ** 2;
        if (d < bestD && v >= 0.4 * t.h) { bestD = d; best = k; }
      }
    }
    if (best >= 0) trees[best].cells++;
  }
}

import { describe, it, expect } from "vitest";
import { canopyHeight, detectTrees, crownRadius } from "../src/trees.js";

const COLS = 60, ROWS = 40, origin = { minx: 1000, maxy: 2000 };

// Canopy made of Gaussian crowns (height h, radius s cells) centred on given cells
function canopy(crowns) {
  const g = new Float32Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    let v = 0;
    for (const [cc, rr, h, s] of crowns) v = Math.max(v, h * Math.exp(-((c - cc) ** 2 + (r - rr) ** 2) / (2 * s * s)));
    g[r * COLS + c] = v;
  }
  return g;
}

describe("tree detection", () => {
  it("finds one top per crown at the right place", () => {
    const trees = detectTrees(canopy([[15, 15, 20, 2.5], [45, 25, 12, 2]]), COLS, ROWS, 1, origin);
    expect(trees.length).toBe(2);
    expect(trees[0]).toMatchObject({ x: 1015.5, y: 1984.5 });
    expect(trees[0].h).toBeCloseTo(20, 0);
    expect(trees[1]).toMatchObject({ x: 1045.5, y: 1974.5 });
  });

  it("ignores low vegetation and bare ground", () => {
    expect(detectTrees(canopy([[30, 20, 2, 3]]), COLS, ROWS, 1, origin)).toEqual([]);
    expect(detectTrees(new Float32Array(COLS * ROWS), COLS, ROWS, 1, origin)).toEqual([]);
  });

  it("does not split a wide crown into several trees", () => {
    expect(detectTrees(canopy([[30, 20, 25, 4]]), COLS, ROWS, 1, origin).length).toBe(1);
  });

  it("finds nothing where there is no data", () => {
    expect(detectTrees(new Float32Array(COLS * ROWS).fill(NaN), COLS, ROWS, 1, origin)).toEqual([]);
  });

  it("measures wider crowns for wider canopies", () => {
    const [narrow] = detectTrees(canopy([[15, 20, 15, 1.5]]), COLS, ROWS, 1, origin);
    const [wide] = detectTrees(canopy([[30, 20, 15, 4]]), COLS, ROWS, 1, origin);
    expect(wide.r).toBeGreaterThan(narrow.r + 1.5);
    expect(wide.r).toBeLessThanOrEqual(9);
  });

  it("caps the number of trees, keeping the tallest", () => {
    const t = detectTrees(canopy([[10, 10, 8, 1.5], [30, 10, 15, 1.5], [50, 30, 11, 1.5]]), COLS, ROWS, 1, origin, { maxTrees: 2 });
    expect(t.map(x => Math.round(x.h))).toEqual([15, 11]);
  });
});

describe("canopy height", () => {
  const surface = { grid: Float32Array.from({ length: 4 }, (_, i) => 110 + i), cols: 2, rows: 2, res: 1 };
  it("subtracts the terrain and blanks masked or missing cells", () => {
    surface.grid[3] = NaN;
    const chm = canopyHeight(surface, origin, () => 100, Uint8Array.from([0, 1, 0, 0]));
    expect(chm[0]).toBe(10);
    expect(chm[1]).toBeNaN();
    expect(chm[2]).toBe(12);
    expect(chm[3]).toBeNaN();
  });
  it("crown radius grows with height within bounds", () => {
    expect(crownRadius(2)).toBe(1.5);
    expect(crownRadius(20)).toBeCloseTo(3.6);
    expect(crownRadius(80)).toBe(7);
  });
});

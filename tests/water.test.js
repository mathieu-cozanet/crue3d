import { describe, it, expect } from "vitest";
import { waterSurface, facadeWaterTop, DEPTH_MID } from "../src/water.js";

const COLS = 20, ROWS = 10;
const dem = (f = () => 100) => ({ cols: COLS, rows: ROWS, grid: Float32Array.from({ length: COLS * ROWS }, (_, i) => f(i % COLS, Math.floor(i / COLS))) });
// west half wet with class 2 (0.5–1 m), east half dry
const raster = () => ({ data: Uint8Array.from({ length: COLS * ROWS }, (_, i) => (i % COLS < 10 ? 2 : 0)) });

describe("water surface", () => {
  it("sits at ground + class depth inside a uniform flood", () => {
    const w = waterSurface(raster(), dem());
    expect(w[5 * COLS + 3]).toBeCloseTo(100 + DEPTH_MID[1]);
  });

  it("extends one cell past the mapped edge, then drops under the ground", () => {
    const w = waterSurface(raster(), dem());
    expect(w[5 * COLS + 10]).toBeCloseTo(100.75);   // first dry cell: shoreline drawn where the surface meets the terrain
    expect(w[5 * COLS + 15]).toBeCloseTo(99.4);     // far from the water
  });

  it("smooths the steps between depth classes", () => {
    const r = raster();
    for (let i = 0; i < r.data.length; i++) if (i % COLS < 5) r.data[i] = 4;   // 1.5–2 m next to 0.5–1 m
    const w = waterSurface(r, dem());
    const a = w[5 * COLS + 4], b = w[5 * COLS + 5];
    expect(a - b).toBeLessThan(1.75 - 0.75);
    expect(a).toBeGreaterThan(b);
  });

  it("never draws a wet cell under its own ground", () => {
    const d = dem((c) => (c === 3 ? 103 : 100));   // a bump inside the flooded area
    const w = waterSurface(raster(), d);
    expect(w[5 * COLS + 3]).toBeGreaterThan(103);
  });

  it("is a flat plane for the bathtub simulation, and under the ground when dry", () => {
    expect(new Set(waterSurface({ bathtub: true, altitude: 104.2 }, dem())).size).toBe(1);
    expect(waterSurface(null, dem())[0]).toBeCloseTo(99.4);
  });

  it("puts the façade water line at the class depth", () => {
    expect(facadeWaterTop(3, 10)).toBeCloseTo(11.25);
    expect(facadeWaterTop(0, 10)).toBeCloseTo(9.4);
  });
});

import { describe, it, expect } from "vitest";
import { decimate, douglasPeucker, simplifyPolygons } from "../build/simplify.mjs";

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

describe("coverage simplification", () => {
  it("removes nearly collinear points and keeps the corners", () => {
    const line = [[0, 0], [1, 0.001], [2, -0.001], [3, 0], [3, 3]];
    expect(douglasPeucker(line, 0.01)).toEqual([[0, 0], [3, 0], [3, 3]]);
  });

  it("decimates dense points in linear time, keeping both ends", () => {
    const dense = Array.from({ length: 100001 }, (_, i) => [i * 1e-6, 0]);
    const out = decimate(dense, 0.001);
    expect(out[0]).toEqual([0, 0]);
    expect(out.at(-1)).toEqual(dense.at(-1));
    expect(out.length).toBeLessThan(200);
  });

  it("handles a million-point ring quickly", () => {
    const n = 1e6, ring = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return [Math.cos(a) + 1e-5 * Math.sin(i), Math.sin(a)];
    });
    ring.push(ring[0]);
    const t0 = Date.now();
    const g = simplifyPolygons({ type: "Polygon", coordinates: [ring] }, 0.001);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(g.coordinates[0][0].length).toBeLessThan(400);
  });

  it("drops polygons whose outer ring collapses, keeps valid holes", () => {
    const g = simplifyPolygons({ type: "MultiPolygon", coordinates: [
      [square(0, 0, 1), square(0.2, 0.2, 0.3)],
      [square(5, 5, 0.00001)],
    ] }, 0.001);
    expect(g.coordinates.length).toBe(1);
    expect(g.coordinates[0].length).toBe(2);
    expect(simplifyPolygons({ type: "Polygon", coordinates: [square(0, 0, 0.00001)] }, 0.001)).toBeNull();
  });
});

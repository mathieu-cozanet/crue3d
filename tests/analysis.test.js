import { describe, it, expect } from "vitest";
import { groupScenarios, selectScenario, footprintDepth, roadFlooding, summarize, classIndex } from "../src/analysis.js";
import { parseBIL } from "../src/api/ign.js";
import { pointInRings } from "../src/geo.js";

// 10 x 10 raster of 1 m cells over [0,10] x [0,10]; west half dry, x in [5,8) class 1, x >= 8 class 3
function raster() {
  const data = new Uint8Array(100);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) data[r * 10 + c] = c >= 8 ? 3 : c >= 5 ? 1 : 0;
  return { data, cols: 10, rows: 10, res: 1, minx: 0, maxy: 10 };
}
const square = (x0, y0, s) => ({ type: "Polygon", coordinates: [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]] });

describe("scenarios", () => {
  const zip = [3000, 2400, 2750].map((h, i) => ({ properties: { idzip: i, hauteurstation: h, hauteurunite: "mm", cdstationhydro: "P1", lbstationhydro: "S", diffusion: true }, geometry: null }));
  const zich = [{ properties: { idzip: 1, hauteurmin: 0 }, geometry: null }, { properties: { idzip: 1, hauteurmin: 2000 }, geometry: null }];

  it("groups by station and sorts by level", () => {
    const [st] = groupScenarios(zip, zich);
    expect(st.scenarios.map(s => s.levelMm)).toEqual([2400, 2750, 3000]);
    expect(st.scenarios[0].classes.map(c => c.k)).toEqual([0, 4]);
  });
  it("picks the highest scenario reached", () => {
    const s = [{ levelMm: 2400 }, { levelMm: 2750 }, { levelMm: 3000 }];
    expect(selectScenario(s, 1444)).toBe(-1);
    expect(selectScenario(s, 2400)).toBe(0);
    expect(selectScenario(s, 2900)).toBe(1);
    expect(selectScenario(s, 5000)).toBe(2);
  });
  it("maps ZICH minimum heights to classes, open-ended last class", () => {
    expect(classIndex(0)).toBe(0);
    expect(classIndex(1500)).toBe(3);
    expect(classIndex(2000)).toBe(4);
  });
});

describe("impact", () => {
  it("dry building", () => expect(footprintDepth(raster(), square(1, 1, 3))).toBe(0));
  it("takes the deepest class over the footprint", () => expect(footprintDepth(raster(), square(4, 4, 5))).toBe(3));
  it("small building inside one cell", () => expect(footprintDepth(raster(), square(6.2, 6.2, 0.3))).toBe(1));

  it("measures flooded road length", () => {
    const f = roadFlooding(raster(), { type: "LineString", coordinates: [[0, 5], [10, 5]] });
    expect(f.total).toBeCloseTo(10);
    expect(f.wet).toBeCloseTo(5, 0);
    expect(f.depth).toBe(3);
  });

  it("summarises buildings, dwellings and roads", () => {
    const b = (g, props) => ({ geometry: g, properties: props });
    const s = summarize(raster(), [
      b(square(1, 1, 2), { usage_1: "Résidentiel", nombre_de_logements: 2 }),
      b(square(6, 1, 1), { usage_1: "Résidentiel", nombre_de_logements: 3 }),
      b(square(8.5, 1, 1), { usage_1: "Commercial et services", nombre_de_logements: 0 }),
    ], [{ geometry: { type: "LineString", coordinates: [[0, 5], [10, 5]] }, properties: { cpx_toponyme_route_nommee: "Rue du Moulin", importance: "4" } }]);
    expect(s.hit.length).toBe(2);
    expect(s.dwellings).toBe(3);
    expect(s.byClass).toEqual([1, 0, 1, 0, 0]);
    expect(s.sensitive.length).toBe(1);
    expect(s.cutRoads[0].name).toBe("Rue du Moulin");
  });

  it("ignores bridges when listing roads under water", () => {
    const bridge = { geometry: { type: "LineString", coordinates: [[0, 5], [10, 5]] }, properties: { cpx_numero: "D5", position_par_rapport_au_sol: "1" } };
    expect(summarize(raster(), [], [bridge]).cutRoads).toEqual([]);
  });
});

describe("geometry and parsing", () => {
  it("point in polygon with hole", () => {
    const rings = [[[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]];
    expect(pointInRings(2, 2, rings)).toBe(true);
    expect(pointInRings(5, 5, rings)).toBe(false);
  });
  it("parses BIL grids and fills no-data with the mean", () => {
    const f = new Float32Array([100, 102, -99999, 104]);
    const d = parseBIL(f.buffer, 2, 2, 2);
    expect(d.min).toBe(100);
    expect(d.max).toBe(104);
    expect(d.grid[2]).toBeCloseTo(102);
  });
  it("rejects grids of the wrong size", () => {
    expect(() => parseBIL(new ArrayBuffer(8), 2, 2, 2)).toThrow();
  });
});

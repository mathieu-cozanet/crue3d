// Polygon simplification for the coverage map: linear decimation, then iterative Douglas-Peucker.
// (A general-purpose library choked for tens of minutes on some 10^6-point river outlines.)

/** Drop points closer than `tol` (in both axes) to the last kept point. Linear time. */
export function decimate(ring, tol) {
  if (ring.length < 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const [x, y] = ring[i], [px, py] = out[out.length - 1];
    if (Math.abs(x - px) > tol || Math.abs(y - py) > tol) out.push(ring[i]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}

/** Ramer-Douglas-Peucker with an explicit stack (no recursion depth issue, no quadratic blow-up in practice). */
export function douglasPeucker(points, tol) {
  const n = points.length;
  if (n < 3) return points;
  const keep = new Uint8Array(n), t2 = tol * tol, stack = [[0, n - 1]];
  keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > max) { max = d; idx = i; }
    }
    if (max > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a (Multi)Polygon; rings that collapse below 4 points are dropped. Coordinates rounded to `decimals`. */
export function simplifyPolygons(geometry, tol, decimals = 4) {
  const f = 10 ** decimals;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const out = [];
  for (const poly of polys) {
    const rings = poly.map(r => douglasPeucker(decimate(r, tol / 2), tol).map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]));
    if (!rings[0] || rings[0].length < 4) continue;   // outer ring collapsed: holes alone mean nothing
    out.push([rings[0], ...rings.slice(1).filter(r => r.length >= 4)]);
  }
  return out.length ? { type: "MultiPolygon", coordinates: out } : null;
}

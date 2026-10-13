import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DEPTH_CLASSES } from "../config.js";
import { polygonsOf, linesOf } from "../geo.js";
import { rasterizeMask } from "../raster.js";
import { waterSurface, facadeWaterTop } from "../water.js";
import { createWaterMaterial, addFacadeWaterLine } from "./waterMaterial.js";

const RISE_MS = 1100;   // duration of the water rising / receding between two maps
const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const ROOF = new THREE.Color("#b8674c"), WALL = new THREE.Color("#ece5d8"), SELECTED = new THREE.Color("#ffc94d");
const CLASS_COLORS = DEPTH_CLASSES.map(c => new THREE.Color(c.color));

/**
 * 3D scene in local coordinates: x east, y north (metres from the bbox centre), heights relative to dem.min.
 * Three.js axes: X = east, Y = up, Z = south.
 */
export class FloodViewer {
  constructor(container, { onPick } = {}) {
    this.container = container;
    this.onPick = onPick;
    this.layers = { buildings: true, roads: true, ppri: true, water3d: true, trees: false };
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#d6e3ea");
    this.scene.fog = new THREE.Fog("#d6e3ea", 1500, 4000);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 8000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 3000;

    this.scene.add(new THREE.HemisphereLight("#e4f0ff", "#6b6146", 1.0));
    const sun = this.sun = new THREE.DirectionalLight("#fff4e0", 2.2);
    sun.position.set(500, 900, 600); // afternoon sun from the south-east (Z positive = south)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.5;
    this.scene.add(sun, sun.target);
    // uniforms shared by the water surface and the facade water line, so both move together
    this.shared = { uMix: { value: 1 }, uTime: { value: 0 }, uSunDir: { value: sun.position.clone().normalize() } };
    this.animated = [];

    this.ray = new THREE.Raycaster();
    this.group = new THREE.Group();
    this.scene.add(this.group);

    let down = null;
    r.domElement.addEventListener("pointerdown", e => (down = [e.clientX, e.clientY]));
    r.domElement.addEventListener("pointerup", e => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) this.pick(e);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    r.setAnimationLoop(t => this.frame(t));
  }

  resize() {
    if (this.capture) return;   // the recording owns the canvas size
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(t) {
    if (this.pin) this.pin.position.y = this.pinY + Math.sin(t / 350) * 1.2;
    this.shared.uTime.value = t / 1000;
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.start) / RISE_MS);
      this.shared.uMix.value = easeInOut(k);
      if (k === 1) {
        this.anim = null;
        if (this.water && !this.flood) this.water.visible = false;   // fully receded: skip drawing it
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(t);   // video capture copies the frame right after it is drawn
  }

  /**
   * Renders at a fixed size (independent of the window) with a slow orbit, for video capture.
   * Returns a function that restores the interactive view.
   */
  beginCapture(width, height) {
    const ratio = this.renderer.getPixelRatio();
    const cam = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.capture = true;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (height > width) {   // portrait: step back so the scene still fits the narrow frame
      const d = this.camera.position.clone().sub(this.controls.target);
      this.camera.position.copy(this.controls.target).add(d.multiplyScalar(1.35));
    }
    Object.assign(this.controls, { autoRotate: true, autoRotateSpeed: 0.55, enabled: false });
    return () => {
      Object.assign(this.controls, { autoRotate: false, enabled: true });
      this.onFrame = null;
      this.capture = false;
      this.renderer.setPixelRatio(ratio);
      this.camera.position.copy(cam.pos);
      this.controls.target.copy(cam.target);
      this.resize();
    };
  }

  // ---------- data ----------
  load({ bbox, dem, buildings, roads, waterSurfaces, streams, ppri, homeIndex }) {
    this.clear();
    Object.assign(this, { bbox, dem, buildingsData: buildings, roadsData: roads, waterSurfaces, streams, ppri, homeIndex });
    this.z0 = dem.min;
    this.local = ([x, y]) => [x - bbox.cx, y - bbox.cy];
    this.buildTerrain();
    this.paintBase();
    this.buildBuildings();
    this.buildWater();
    this.buildPin();
    const sc = this.sun.shadow.camera, half = Math.max(bbox.w, bbox.h) * 0.75;
    Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 4000 });
    sc.updateProjectionMatrix();
    this.setFlood(null);
    this.view("home");
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse?.(c => { c.geometry?.dispose(); if (c.material?.map) c.material.map.dispose(); c.material?.dispose?.(); });
    }
    this.pin = null;
    this.treesGroup = null;
    this.water = null;
    this.animated = [];
    this.anim = null;
    this.shared.uMix.value = 1;
  }

  /** Bilinear terrain height (absolute altitude) at a Lambert-93 point. */
  heightAt(x, y) {
    const { grid, cols, rows, res } = this.dem;
    const fx = THREE.MathUtils.clamp((x - this.bbox.minx) / res - 0.5, 0, cols - 1);
    const fy = THREE.MathUtils.clamp((this.bbox.maxy - y) / res - 0.5, 0, rows - 1);
    const c0 = Math.floor(fx), r0 = Math.floor(fy), c1 = Math.min(c0 + 1, cols - 1), r1 = Math.min(r0 + 1, rows - 1);
    const tx = fx - c0, ty = fy - r0, h = (r, c) => grid[r * cols + c];
    return (h(r0, c0) * (1 - tx) + h(r0, c1) * tx) * (1 - ty) + (h(r1, c0) * (1 - tx) + h(r1, c1) * tx) * ty;
  }

  buildTerrain() {
    const { grid, cols, rows, res } = this.dem, { w, h } = this.bbox;
    const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, x = -w / 2 + (c + 0.5) * res, y = h / 2 - (r + 0.5) * res;
      pos.set([x, grid[i] - this.z0, -y], i * 3);
      uv.set([(c + 0.5) / cols, 1 - (r + 0.5) / rows], i * 2);
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.terrainPos = pos;
    this.terrainIndex = idx;

    const scale = Math.min(2, 4096 / Math.max(w, h));
    this.tex = { scale, w: Math.round(w * scale), h: Math.round(h * scale) };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.tex.w; this.canvas.height = this.tex.h;
    this.baseCanvas = document.createElement("canvas");
    this.baseCanvas.width = this.tex.w; this.baseCanvas.height = this.tex.h;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.texture }));
    mesh.receiveShadow = true;
    this.terrain = mesh;
    this.group.add(mesh);
  }

  // texture pixel coordinates from Lambert-93
  tx(x) { return (x - this.bbox.minx) * this.tex.scale; }
  ty(y) { return (this.bbox.maxy - y) * this.tex.scale; }

  paintBase() {
    const g = this.baseCanvas.getContext("2d"), { grid, cols, rows, res } = this.dem;
    // hillshade at DEM resolution, light from the north-west
    const img = new ImageData(cols, rows), L = new THREE.Vector3(-1, 1.6, -1).normalize(), n = new THREE.Vector3();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const h = (rr, cc) => grid[THREE.MathUtils.clamp(rr, 0, rows - 1) * cols + THREE.MathUtils.clamp(cc, 0, cols - 1)];
      n.set(h(r, c - 1) - h(r, c + 1), 2 * res, h(r - 1, c) - h(r + 1, c)).normalize();
      const s = THREE.MathUtils.clamp(n.dot(L), 0, 1), k = (r * cols + c) * 4;
      img.data[k] = 150 + 70 * s; img.data[k + 1] = 168 + 62 * s; img.data[k + 2] = 118 + 52 * s; img.data[k + 3] = 255;
    }
    const tmp = document.createElement("canvas"); tmp.width = cols; tmp.height = rows;
    tmp.getContext("2d").putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(tmp, 0, 0, this.tex.w, this.tex.h);

    const fillPolys = (features, color) => {
      g.fillStyle = color;
      for (const f of features) for (const rings of polygonsOf(f.geometry)) {
        g.beginPath();
        for (const ring of rings) { ring.forEach(([x, y], i) => (i ? g.lineTo(this.tx(x), this.ty(y)) : g.moveTo(this.tx(x), this.ty(y)))); g.closePath(); }
        g.fill("evenodd");
      }
    };
    const strokeLines = (features, color, widthOf) => {
      g.strokeStyle = color; g.lineCap = g.lineJoin = "round";
      for (const f of features) {
        g.lineWidth = Math.max(1, widthOf(f.properties) * this.tex.scale);
        for (const line of linesOf(f.geometry)) {
          g.beginPath();
          line.forEach(([x, y], i) => (i ? g.lineTo(this.tx(x), this.ty(y)) : g.moveTo(this.tx(x), this.ty(y))));
          g.stroke();
        }
      }
    };
    fillPolys(this.waterSurfaces, "#7fb3d3");
    strokeLines(this.streams, "#6fa6cc", p => (p.largeur ? Math.min(p.largeur, 8) : 1.6));
    const width = p => p.largeur_de_chaussee || { 1: 9, 2: 7.5, 3: 6.5, 4: 5.5, 5: 4 }[p.importance] || 3;
    strokeLines(this.roadsData, "#8f8b84", p => width(p) + 1.2);
    strokeLines(this.roadsData, "#d9d5cc", width);
  }

  paintComposite() {
    const g = this.canvas.getContext("2d");
    g.clearRect(0, 0, this.tex.w, this.tex.h);
    g.drawImage(this.baseCanvas, 0, 0);
    if (this.flood) {
      // with the 3D water on, the ground only looks soaked; otherwise it carries the legend colours
      const { data, cols, rows } = this.flood, img = new ImageData(cols, rows), soaked = this.layers.water3d;
      for (let i = 0; i < data.length; i++) {
        if (!data[i]) continue;
        const c = CLASS_COLORS[data[i] - 1];
        img.data.set(soaked ? [52, 66, 58, 80] : [c.r * 255, c.g * 255, c.b * 255, 205], i * 4);
      }
      const tmp = document.createElement("canvas"); tmp.width = cols; tmp.height = rows;
      tmp.getContext("2d").putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(tmp, 0, 0, this.tex.w, this.tex.h);
    }
    if (this.layers.ppri && this.ppri?.length) {
      g.save();
      g.beginPath();
      for (const f of this.ppri) for (const rings of polygonsOf(f.geometry)) for (const ring of rings) {
        ring.forEach(([x, y], i) => (i ? g.lineTo(this.tx(x), this.ty(y)) : g.moveTo(this.tx(x), this.ty(y))));
        g.closePath();
      }
      g.strokeStyle = "rgba(200,40,40,.9)"; g.lineWidth = 1.2 * this.tex.scale;
      g.setLineDash([4 * this.tex.scale, 3 * this.tex.scale]); g.stroke();
      g.restore();
    }
    this.texture.needsUpdate = true;
  }

  buildBuildings() {
    const geos = [], owner = [];
    this.buildingRanges = [];
    let vertexCount = 0;
    this.buildingsData.forEach((b, bi) => {
      for (const rings of polygonsOf(b.geometry)) {
        const local = rings.map(r => {
          const pts = r.map(p => this.local(p));
          if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
          return pts.map(([x, y]) => new THREE.Vector2(x, y));
        });
        if (local[0].length < 3) continue;
        const shape = new THREE.Shape(local[0]);
        shape.holes = local.slice(1).filter(h => h.length >= 3).map(h => new THREE.Path(h));
        const base = Math.min(...rings[0].map(([x, y]) => this.heightAt(x, y))) - 0.4;
        const height = Math.max(b.properties.hauteur || 0, 2.5) + 0.4;
        b.base = base + 0.4;
        const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }); // already non-indexed
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, base - this.z0, 0);
        geo.deleteAttribute("uv");
        const n = geo.attributes.position.count;
        this.buildingRanges.push({ bi, start: vertexCount, count: n, base: base + 0.4 - this.z0 });
        for (let t = 0; t < n / 3; t++) owner.push(bi);
        vertexCount += n;
        geos.push(geo);
      }
    });
    if (!geos.length) return;
    const geo = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    const dry = new Float32Array(vertexCount);
    for (const r of this.buildingRanges) dry.fill(facadeWaterTop(0, r.base), r.start, r.start + r.count);
    geo.setAttribute("aWaterA", new THREE.BufferAttribute(dry, 1));
    geo.setAttribute("aWaterB", new THREE.BufferAttribute(dry.slice(), 1));
    geo.setAttribute("aStain", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    this.animated.push([geo, "aWaterA", "aWaterB"]);
    this.faceOwner = Uint32Array.from(owner);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    addFacadeWaterLine(material, this.shared);
    this.buildingsMesh = new THREE.Mesh(geo, material);
    this.buildingsMesh.castShadow = this.buildingsMesh.receiveShadow = true;
    this.buildingsMesh.visible = this.layers.buildings;
    this.group.add(this.buildingsMesh);
  }

  /** depths: Uint8Array per building (0 dry, k+1 class): the facades get an animated water line at that depth. */
  colorBuildings(depths) {
    this.depths = depths;
    if (!this.buildingsMesh) return;
    this.bake();
    const geo = this.buildingsMesh.geometry, top = geo.attributes.aWaterB, stain = geo.attributes.aStain;
    for (const { bi, start, count, base } of this.buildingRanges) {
      const d = depths?.[bi] || 0, c = d ? CLASS_COLORS[d - 1] : WALL;
      top.array.fill(facadeWaterTop(d, base), start, start + count);
      for (let v = start; v < start + count; v++) stain.setXYZ(v, c.r, c.g, c.b);
    }
    top.needsUpdate = stain.needsUpdate = true;
    this.paintBuildings();
  }

  paintBuildings() {
    if (!this.buildingsMesh) return;
    const col = this.buildingsMesh.geometry.attributes.color, nrm = this.buildingsMesh.geometry.attributes.normal;
    for (const { bi, start, count } of this.buildingRanges) {
      const sel = bi === this.selected;
      for (let v = start; v < start + count; v++) {
        const c = sel ? SELECTED : nrm.getY(v) > 0.5 ? ROOF : WALL;
        col.setXYZ(v, c.r, c.g, c.b);
      }
    }
    col.needsUpdate = true;
  }

  /**
   * Freeze what is on screen as the start of a new transition (A <- current blend of A and B), then restart.
   * Called before each new target, so water and facades always move from where they visibly are.
   */
  bake() {
    const m = this.shared.uMix.value;
    for (const [geo, a, b] of this.animated) {
      const A = geo.attributes[a].array, B = geo.attributes[b].array;
      if (m !== 0) for (let i = 0; i < A.length; i++) A[i] += (B[i] - A[i]) * m;
      geo.attributes[a].needsUpdate = true;
    }
    this.shared.uMix.value = 0;
    this.anim = { start: performance.now() };
  }

  /** Full-grid water mesh; each vertex carries its ground height and two water levels to blend between. */
  buildWater() {
    const n = this.dem.cols * this.dem.rows, ground = new Float32Array(n);
    for (let i = 0; i < n; i++) ground[i] = this.terrainPos[i * 3 + 1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.terrainPos.slice(), 3));
    geo.setAttribute("uv", this.terrain.geometry.attributes.uv);
    geo.setIndex(this.terrainIndex);
    geo.setAttribute("ground", new THREE.BufferAttribute(ground, 1));
    const dry = waterSurface(null, this.dem).map(v => v - this.z0);
    geo.setAttribute("wseA", new THREE.BufferAttribute(dry, 1));
    geo.setAttribute("wseB", new THREE.BufferAttribute(dry.slice(), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(this.bbox.w, this.bbox.h));
    this.animated.push([geo, "wseA", "wseB"]);
    this.water = new THREE.Mesh(geo, createWaterMaterial(this.shared, this.buildingProximity()));
    this.water.renderOrder = 2;
    this.water.visible = false;
    this.group.add(this.water);
  }

  /** Blurred building footprints (0..1) on the terrain grid: drives the foam rings around flooded buildings. */
  buildingProximity() {
    const { cols, rows } = this.dem;
    let a = Float32Array.from(rasterizeMask(this.buildingsData, this.bbox, this.dem, 0));
    const blur = (src, dx, dy, R = 2) => {
      const out = new Float32Array(src.length);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, k = 0;
        for (let t = -R; t <= R; t++) {
          const rr = r + t * dy, cc = c + t * dx;
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) { sum += src[rr * cols + cc]; k++; }
        }
        out[r * cols + c] = sum / k;
      }
      return out;
    };
    for (let pass = 0; pass < 2; pass++) a = blur(blur(a, 1, 0), 0, 1);
    const data = new Uint8Array(cols * rows);
    // texture rows run south to north, the grid north to south
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[(rows - 1 - r) * cols + c] = Math.round(a[r * cols + c] * 255);
    const tex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  buildPin() {
    const b = this.buildingsData[this.homeIndex];
    let x, y, top;
    if (b) {
      const ring = polygonsOf(b.geometry)[0][0];
      x = ring.reduce((s, p) => s + p[0], 0) / ring.length; y = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      top = b.base + Math.max(b.properties.hauteur || 0, 2.5);
    } else {
      [x, y] = [this.bbox.cx, this.bbox.cy]; top = this.heightAt(x, y);
    }
    const [lx, ly] = this.local([x, y]);
    this.home = { x: lx, z: -ly, ground: this.heightAt(x, y) - this.z0 };
    const pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.ConeGeometry(2.6, 8, 20).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: "#d0463c", emissive: "#3a0c08" }));
    head.position.y = 12;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 10, 8), new THREE.MeshStandardMaterial({ color: "#d0463c" }));
    stem.position.y = 4;
    pin.add(head, stem);
    pin.position.set(lx, top - this.z0 + 4, -ly);
    this.pinY = pin.position.y;
    this.pin = pin;
    this.group.add(pin);
  }

  /** Flood raster (or null): the water rises or recedes to the new map instead of jumping. */
  setFlood(raster) {
    const wasWet = !!this.flood;
    this.flood = raster;
    this.paintComposite();
    this.updateTreeLook();
    if (!this.water) return;
    this.bake();
    const target = this.water.geometry.attributes.wseB;
    target.array.set(waterSurface(raster, this.dem).map(v => v - this.z0));
    target.needsUpdate = true;
    this.water.visible = this.layers.water3d && (!!raster || wasWet);
  }

  setLayer(name, on) {
    this.layers[name] = on;
    if (name === "buildings" && this.buildingsMesh) this.buildingsMesh.visible = on;
    if (name === "ppri") this.paintComposite();
    if (name === "water3d") { this.paintComposite(); if (this.water) this.water.visible = on && !!this.flood; }
    if (name === "trees") this.updateTreeLook();
  }

  /** Trees from the LiDAR canopy: [{ x, y, h, r }] in Lambert-93, h = height above ground. */
  setTrees(trees) {
    if (this.treesGroup) {
      this.group.remove(this.treesGroup);
      this.treesGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      this.treesGroup = null;
    }
    if (!trees?.length) return;
    const n = trees.length;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 1, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshLambertMaterial({ color: "#6b5139" }), n);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ flatShading: true }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    trees.forEach((t, k) => {
      const [lx, ly] = this.local([t.x, t.y]);
      const base = this.heightAt(t.x, t.y) - this.z0;
      const depth = THREE.MathUtils.clamp(0.62 * t.h, 2, 18), trunkH = Math.max(0.8, t.h - depth + 0.6);
      const tr = 0.12 + 0.015 * t.h;
      m.compose(p.set(lx, base - 0.3, -ly), q.identity(), sc.set(tr, trunkH + 0.3, tr));
      trunks.setMatrixAt(k, m);
      m.compose(p.set(lx, base + t.h - depth / 2, -ly), q.setFromAxisAngle(up, k * 2.399), sc.set(t.r, depth / 2, t.r));
      crowns.setMatrixAt(k, m);
      const j = ((k * 104729) % 100) / 100;
      crowns.setColorAt(k, col.setHSL(0.26 + j * 0.07, 0.36, 0.25 + j * 0.1));
    });
    crowns.receiveShadow = true;
    this.treesGroup = new THREE.Group();
    this.treesGroup.add(trunks, crowns);
    this.group.add(this.treesGroup);
    this.updateTreeLook();
  }

  /** Trees turn see-through while a flood is displayed, so they never hide the water depths below. */
  updateTreeLook() {
    if (!this.treesGroup) return;
    this.treesGroup.visible = this.layers.trees;
    const see = !!this.flood;
    for (const mesh of this.treesGroup.children) {
      Object.assign(mesh.material, { transparent: see, opacity: see ? 0.28 : 1, depthWrite: !see });
      mesh.material.needsUpdate = true;
      mesh.castShadow = !see;
    }
  }

  select(bi) {
    this.selected = bi;
    this.paintBuildings();
  }


  pick(e) {
    if (!this.buildingsMesh?.visible) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.buildingsMesh)[0];
    const bi = hit ? this.faceOwner[hit.faceIndex] : null;
    this.select(bi);
    this.onPick?.(bi);
  }

  focusBuilding(bi) {
    const b = this.buildingsData[bi];
    if (!b) return;
    const ring = polygonsOf(b.geometry)[0][0];
    const [lx, ly] = this.local([ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]);
    const y = b.base - this.z0;
    this.controls.target.set(lx, y, -ly);
    this.camera.position.set(lx + 60, y + 55, -ly + 85);
    this.select(bi);
  }

  view(kind) {
    const { w, h } = this.bbox;
    if (kind === "top") { this.camera.position.set(0, Math.max(w, h) * 1.15, 1); this.controls.target.set(0, 0, 0); }
    else if (kind === "home" && this.home) {
      this.controls.target.set(this.home.x, this.home.ground, this.home.z);
      this.camera.position.set(this.home.x + 110, this.home.ground + 120, this.home.z + 180);
    } else { this.camera.position.set(w * 0.45, Math.max(w, h) * 0.45, h * 0.95); this.controls.target.set(0, 0, 0); }
    this.controls.update();
  }

  /** Azimuth for the compass (radians). */
  azimuth() { return this.controls.getAzimuthalAngle(); }
}

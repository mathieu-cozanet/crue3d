import * as THREE from "three";
import { DEPTH_CLASSES } from "../config.js";

// Animated flood water: colour follows the depth (same palette as the legend), small analytic waves for
// sun glints and sky reflection, foam on the shoreline and around flooded buildings, soft transparent edges.
// The surface interpolates between two states (wseA -> wseB) so water rises and recedes smoothly.

const vertexShader = /* glsl */ `
  attribute float ground;
  attribute float wseA;
  attribute float wseB;
  uniform float uMix;
  varying float vDepth;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    float wse = mix(wseA, wseB, uMix);
    vDepth = wse - ground;
    vec3 p = position;
    p.y = max(wse, ground - 0.8);
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform vec3 uC0, uC1, uC2, uC3, uC4;
  uniform sampler2D uNear;
  varying float vDepth;
  varying vec3 vWorld;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // continuous version of the legend: class colours blended around the 0.5 m boundaries
  vec3 depthColor(float d) {
    vec3 c = mix(uC0, uC1, smoothstep(0.35, 0.65, d));
    c = mix(c, uC2, smoothstep(0.85, 1.15, d));
    c = mix(c, uC3, smoothstep(1.35, 1.65, d));
    return mix(c, uC4, smoothstep(1.85, 2.15, d));
  }
  // gradient of a few travelling sine waves (amplitude a, wavenumber k, speed s along direction dir)
  vec2 wave(vec2 p, vec2 dir, float a, float k, float s) { return a * k * cos(dot(p, dir) * k + uTime * s) * dir; }

  void main() {
    if (vDepth <= 0.0) discard;
    vec2 p = vWorld.xz;
    // small waves fade out with distance: finer than a pixel they would only shimmer as stripes
    float dist = length(cameraPosition - vWorld);
    float mid = 1.0 - smoothstep(120.0, 450.0, dist), fine = 1.0 - smoothstep(50.0, 220.0, dist);
    vec2 g = wave(p, normalize(vec2(1.0, 0.35)), 0.05, 0.45, 1.1)
           + wave(p, normalize(vec2(-0.45, 1.0)), 0.035, 0.9, 1.7) * mid
           + wave(p, normalize(vec2(0.8, -0.6)), 0.02, 1.9, 2.6) * fine
           + wave(p, normalize(vec2(-0.9, -0.3)), 0.012, 3.7, 3.4) * fine;
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);

    vec3 col = depthColor(vDepth) * (0.62 + 0.38 * max(dot(n, L), 0.0));
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    col = mix(col, uSky, fres * 0.32);
    col += uSunColor * pow(max(dot(n, H), 0.0), 140.0) * 1.4 * (1.0 - 0.75 * smoothstep(300.0, 1200.0, dist));

    float shore = 1.0 - smoothstep(0.03, 0.25, vDepth);
    float near = texture2D(uNear, vUv).r;
    float ring = smoothstep(0.04, 0.3, near) * (1.0 - smoothstep(0.55, 0.95, near));
    float pattern = noise(p * 0.8 + vec2(uTime * 0.3, uTime * 0.17)) * 0.6 + noise(p * 2.4 - vec2(uTime * 0.45, 0.0)) * 0.4;
    float foam = clamp((shore * 1.1 + ring) * smoothstep(0.42, 0.7, pattern + 0.12), 0.0, 1.0);
    col = mix(col, vec3(0.94, 0.97, 0.99), foam * 0.8);

    float alpha = mix(0.55, 0.88, smoothstep(0.0, 1.3, vDepth));
    alpha = max(alpha, foam * 0.85) * smoothstep(0.0, 0.06, vDepth);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createWaterMaterial(shared, nearTexture) {
  const c = DEPTH_CLASSES.map(k => new THREE.Color(k.color));
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false,
    uniforms: {
      uMix: shared.uMix, uTime: shared.uTime, uSunDir: shared.uSunDir,
      uSunColor: { value: new THREE.Color("#fff6e3") },
      uSky: { value: new THREE.Color("#d6e3ea") },
      uC0: { value: c[0] }, uC1: { value: c[1] }, uC2: { value: c[2] }, uC3: { value: c[3] }, uC4: { value: c[4] },
      uNear: { value: nearTexture },
    },
  });
}

/**
 * Façade water mark for the buildings material: below the (animated) water line the wall takes the
 * depth colour, with a bright rippling line at the surface.
 */
export function addFacadeWaterLine(material, shared) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uMix = shared.uMix;
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float aWaterA;
        attribute float aWaterB;
        attribute vec3 aStain;
        uniform float uMix;
        varying float vWaterTop;
        varying float vY;
        varying vec3 vStain;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vWaterTop = mix(aWaterA, aWaterB, uMix);
        vY = (modelMatrix * vec4(transformed, 1.0)).y;
        vStain = aStain;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uTime;
        varying float vWaterTop;
        varying float vY;
        varying vec3 vStain;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float ripple = 0.03 * sin(uTime * 2.2 + vY * 3.0);
        float under = 1.0 - smoothstep(vWaterTop - 0.03, vWaterTop + 0.03, vY + ripple);
        diffuseColor.rgb = mix(diffuseColor.rgb, vStain, under * 0.75);
        float line = 1.0 - smoothstep(0.0, 0.08, abs(vY + ripple - vWaterTop));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), line * 0.7);`);
  };
  material.customProgramCacheKey = () => "facade-water-line";
}

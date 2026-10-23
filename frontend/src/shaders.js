// Shared GLSL snippets and small material helpers.
import * as THREE from "three";

export const NOISE = /* glsl */ `
float hash31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`;

export const SOFT_POINT = /* glsl */ `
float softDot(){ float d = length(gl_PointCoord - 0.5); return smoothstep(0.5, 0.0, d); }
`;

/** Shared uniforms: every material references the same objects, so one write updates them all. */
export function sharedUniforms() {
  const c = () => ({ value: new THREE.Color() });
  return {
    uTime: { value: 0 }, uOrbitT: { value: 0 }, uWarpT: { value: 0 },
    uA: c(), uB: c(), uC: c(), uD: c(), uDeep: c(), uBg1: c(), uBg2: c(),
    uEnergy: { value: 0 }, uPulse: { value: 0 }, uFlash: { value: 0 }, uDark: { value: 0 },
    uPx: { value: 500 }, uSize: { value: 1 },
    uRip: { value: new THREE.Vector4(0, 0, 1, -100) },
  };
}

export function shader(U, vertexShader, fragmentShader, opts = {}) {
  const { uniforms = {}, additive = true, side, transparent = true, depthWrite = false, defines } = opts;
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uI: { value: 0 }, ...uniforms },
    vertexShader, fragmentShader, transparent, depthWrite, side: side ?? THREE.FrontSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: { OCTAVES: 4, ...defines },
  });
}

let glowTex = null;
/** Soft radial glow texture used by sprites (sun, core, flares). */
export function glowTexture() {
  if (glowTex) return glowTex;
  const s = 128, cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d"), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.5, "rgba(255,255,255,0.12)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

let ringTex = null;
export function ringTexture() {
  if (ringTex) return ringTex;
  const s = 256, cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d"), grd = g.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,0)");
  grd.addColorStop(0.12, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.25)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  ringTex = new THREE.CanvasTexture(cv);
  return ringTex;
}

/** Mulberry32: seeded random so geometry looks the same every visit. */
export function seeded(seed = 1) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

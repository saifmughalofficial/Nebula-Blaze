// Renderer, camera, bloom, globe physics and the layer crossfader.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { sharedUniforms } from "./shaders.js";
import { Globe } from "./globe.js";
import { Effects } from "./effects.js";
import { THEMES, LAYERS, modeById } from "./themes.js";

const MODE_MOTION = { calm: "breathe", aurora: "sway", solar: "precess", quantum: "heartbeat", storm: "wobble",
  blackhole: "steady", supernova: "bounce", hyperdrive: "steady", galaxy: "figure8", datapulse: "breathe" };

// Colors are authored as plain display hex values; keep them as-is end to end.
THREE.ColorManagement.enabled = false;

export const QUALITY = {
  low:      { pr: 0.85, bloom: false, octaves: 2, density: 0.45 },
  balanced: { pr: 1.25, bloom: true,  octaves: 3, density: 0.75, bloomScale: 0.5 },
  ultra:    { pr: 2.0,  bloom: true,  octaves: 4, density: 1.0,  bloomScale: 1 },
};

const COLOR_KEYS = ["a", "b", "c", "d", "deep", "bg1", "bg2"];
const UNI = { a: "uA", b: "uB", c: "uC", d: "uD", deep: "uDeep", bg1: "uBg1", bg2: "uBg2" };

export class NebulaScene {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    this.camera.position.set(0, 0, 4.6);
    this.U = sharedUniforms();
    this.globe = new Globe(this.U);
    this.scene.add(this.globe.group);
    this.fx = new Effects(this.U, this.scene);
    this.layers = { ...this.fx.layers, ...this.globe.layers };
    // Fireworks are pooled bursts fired from the CPU; the layer level only sets their rate.
    this.layers.fireworks = { set: () => {} };
    this.motion = "steady"; this.lastFirework = 0;
    this.mScale = 1; this.mPitch = 0; this.mYaw = 0; this.mRoll = 0;
    this.levels = Object.fromEntries(LAYERS.map(([id]) => [id, 0]));
    this.targets = { ...this.levels };
    this.overrides = {};

    // Motion state
    this.yaw = 0; this.pitch = 0.32; this.roll = 0;
    this.yawVel = 0.5; this.pitchTarget = 0.32;
    this.dir = 1;               // auto-spin direction, set by the last strong motion
    this.autoSpin = 1;          // user setting multiplier
    this.modeSpin = 0.5;
    this.paused = false; this.pauseK = 1; this.slowmo = false; this.reduced = false;
    this.zoom = 4.6; this.zoomTarget = 4.6; this.focus = false;
    this.energy = 0; this.energyTarget = 0;
    this.hueCycle = false; this.hue = 0;
    this.pulsePeriod = 0; this.pulseClock = 0; this.pulse = 0;
    this.flash = 0;
    this.globeOpacity = 1; this.globeOpacityTarget = 1; this.dark = 0; this.darkTarget = 0;
    this.time = 0; this.orbitT = 0; this.warpT = 0;
    this.colors = Object.fromEntries(COLOR_KEYS.map((k) => [k, new THREE.Color()]));
    this.colorTargets = Object.fromEntries(COLOR_KEYS.map((k) => [k, new THREE.Color()]));
    this.onPulse = null;
    this.handDriving = false;
    this.lastStrike = 0;
    this.stats = { fps: 60, frames: 0, acc: 0 };

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.quality = "balanced";
    this.bloomOn = true;
    this.density = 1;
  }

  setTheme(id, instant = false) {
    const th = THEMES[id] || THEMES.aurora;
    this.themeId = id;
    for (const k of COLOR_KEYS) {
      this.colorTargets[k].set(th[k]);
      if (instant) this.colors[k].copy(this.colorTargets[k]);
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.overrides = {};
    this._applyTargets();
    this.modeSpin = mode.spin ?? 1;
    this.pulsePeriod = mode.pulse || 0;
    this.pulseClock = 0;
    this.globeOpacityTarget = mode.globeOpacity ?? 1;
    this.darkTarget = mode.dark || 0;
    this.motion = mode.motion || MODE_MOTION[mode.id] || "steady";
  }

  setOverride(id, on) {
    if (on === null) delete this.overrides[id]; else this.overrides[id] = on ? 1 : 0;
    this._applyTargets();
  }

  layerOn(id) { return (this.targets[id] || 0) > 0.01; }

  _applyTargets() {
    const L = this.mode?.layers || {};
    for (const [id] of LAYERS) {
      let v = id in this.overrides ? this.overrides[id] : L[id] || 0;
      if (this.reduced && (id === "warp" || id === "lightning")) v *= 0.3;
      this.targets[id] = v;
    }
  }

  setReduced(on) { this.reduced = on; this._applyTargets(); }

  setQuality(q) {
    const Q = QUALITY[q] || QUALITY.balanced;
    this.quality = q;
    this.prCap = Q.pr;
    this.renderScale = 1;
    // The full-screen sky is the only shader whose cost scales with screen size enough to matter.
    const sky = this.fx.nebulaMat;
    if (sky.defines.OCTAVES !== Q.octaves) { sky.defines.OCTAVES = Q.octaves; sky.needsUpdate = true; }
    this.qualityDensity = Q.density;
    this.bloomScale = Q.bloomScale || 0.5;
    this.bloomAllowed = Q.bloom;
    this.fx.setDensity(this.density * Q.density);
    this.resize();
  }

  setDensity(k) { this.density = k; this.fx.setDensity(k * (this.qualityDensity ?? 1)); }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.prCap || 1.25) * (this.renderScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    const bs = this.bloomScale || 0.5;
    this.bloom.resolution.set(w * pr * bs, h * pr * bs);
    this.bloom.setSize?.(Math.round(w * pr * bs), Math.round(h * pr * bs));
    this.camera.aspect = w / h;
    // Keep the whole globe on narrow portrait screens.
    this.fitDist = w / h < 0.8 ? 4.6 / Math.max(0.5, w / h / 0.8) : 4.6;
    if (!this.focus) this.zoomTarget = this.fitDist;
    this.camera.updateProjectionMatrix();
    this.U.uPx.value = (h * pr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /** Angular push, e.g. from a mouse flick or hand swipe. */
  impulse(dyaw, dpitch = 0) {
    this.yawVel += dyaw;
    this.pitchTarget = Math.max(-1.0, Math.min(1.0, this.pitchTarget + dpitch));
    if (Math.abs(dyaw) > 0.2) this.dir = Math.sign(dyaw);
  }

  reverse() { this.dir *= -1; this.yawVel = -this.yawVel; }

  reset() {
    this.yaw = 0; this.yawVel = 0.4 * this.dir; this.pitchTarget = 0.32; this.zoomTarget = this.fitDist || 4.6;
    this.focus = false; this.flash = 0.6;
  }

  setFocus(on) { this.focus = on; this.zoomTarget = (this.fitDist || 4.6) * (on ? 0.62 : 1); }

  rippleAt(local) { this.U.uRip.value.set(local.x, local.y, local.z, this.time); }

  update(dtRaw) {
    const dt = Math.min(0.05, dtRaw) * (this.slowmo ? 0.3 : 1);
    this.pauseK += ((this.paused ? 0 : 1) - this.pauseK) * Math.min(1, dt * 4);
    const pk = this.pauseK;
    this.time += dt * (0.25 + 0.75 * pk);
    const U = this.U;

    // Globe spin: drift back to the idle auto-spin in the current direction unless a hand is steering.
    const idle = this.modeSpin * this.autoSpin * 0.45 * this.dir * (this.reduced ? 0.5 : 1);
    if (!this.handDriving) this.yawVel += (idle - this.yawVel) * Math.min(1, dt * 0.9);
    this.yaw += this.yawVel * dt * pk;
    this.pitch += (this.pitchTarget - this.pitch) * Math.min(1, dt * 3);
    this.roll = this.reduced ? 0 : Math.sin(this.time * 0.35) * 0.04;
    this._motion(dt);
    this.globe.group.rotation.set(this.pitch + this.mPitch, this.mYaw, this.roll + this.mRoll);
    this.globe.spin.rotation.y = this.yaw;

    const speed = Math.abs(this.yawVel);
    this.energyTarget = Math.max(this.energyTarget * Math.pow(0.2, dt), Math.min(1, Math.max(0, (speed - 1.2) / 4)));
    this.energy += (this.energyTarget - this.energy) * Math.min(1, dt * 3);

    this.orbitT += dt * pk * (0.6 + this.modeSpin * 0.4 + this.energy * 2.5) * (this.reduced ? 0.5 : 1);
    this.warpT += dt * pk * (0.12 + this.energy * 0.5) * (this.reduced ? 0.4 : 1);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 2.5);
    this.camera.position.z = this.zoom;

    // Layer crossfade + colour morph.
    const k = Math.min(1, dt * 1.6);
    for (const [id] of LAYERS) {
      this.levels[id] += (this.targets[id] - this.levels[id]) * k;
      if (Math.abs(this.levels[id] - this.targets[id]) < 0.002) this.levels[id] = this.targets[id];
      this.layers[id]?.set(this.levels[id]);
    }
    const ck = Math.min(1, dt * 2);
    this.hue = this.hueCycle || this.mode?.hue || THEMES[this.themeId]?.hue ? (this.hue + dt * 0.08) % 1 : this.hue * (1 - ck);
    for (const key of COLOR_KEYS) {
      this.colors[key].lerp(this.colorTargets[key], ck);
      U[UNI[key]].value.copy(this.colors[key]);
      if (this.hue && key !== "deep" && key !== "bg1") U[UNI[key]].value.offsetHSL(this.hue, 0, 0);
    }
    this.globeOpacity += (this.globeOpacityTarget - this.globeOpacity) * k;
    this.globe.bodyMat.uniforms.uOpacity.value = this.globeOpacity;
    this.dark += (this.darkTarget - this.dark) * k;

    // Supernova beat.
    if (this.pulsePeriod && pk > 0.5) {
      this.pulseClock += dt;
      if (this.pulseClock > this.pulsePeriod) {
        this.pulseClock = 0; this.pulse = 1;
        this.onPulse?.();
      }
    }
    this.pulse *= Math.pow(0.08, dt);
    this.flash *= Math.pow(0.05, dt);

    // Fireworks: small bursts popping off random points just above the surface.
    const fw = this.levels.fireworks || 0;
    if (fw > 0.2 && pk > 0.5 && this.time - this.lastFirework > 0.35 + Math.random() * 0.9 / fw) {
      this.lastFirework = this.time;
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.9).normalize().multiplyScalar(1.25 + Math.random() * 0.8);
      const cols = [U.uA.value, U.uB.value, U.uC.value, U.uD.value];
      this.fx.burst(d, 0.35 + Math.random() * 0.5, cols[Math.floor(Math.random() * 4)], cols[Math.floor(Math.random() * 4)], 1.2);
    }

    // Lightning cadence.
    if (this.levels.lightning > 0.2 && pk > 0.5 && this.time - this.lastStrike > 0.25 + Math.random() * 1.4 / this.levels.lightning) {
      this.lastStrike = this.time;
      const d = this.fx.strike(U.uA.value);
      if (Math.random() < 0.35) this.flash = Math.max(this.flash, 0.25);
      this.lastBolt = d;
    }

    U.uTime.value = this.time;
    U.uOrbitT.value = this.orbitT; U.uWarpT.value = this.warpT;
    U.uEnergy.value = this.energy; U.uPulse.value = this.pulse; U.uFlash.value = this.flash; U.uDark.value = this.dark;
    this.globe.tick(this.time, dt * pk);
    this.fx.tick(this.time, dt * pk, this.yaw);

    const useBloom = this.bloomOn && this.bloomAllowed;
    if (useBloom) {
      this.bloom.strength = 0.55 + this.energy * 0.35 + this.pulse * 0.4;
      this.composer.render(dt);
    } else this.renderer.render(this.scene, this.camera);

    const s = this.stats;
    s.frames++; s.acc += dtRaw;
    if (s.acc >= 0.5) { s.fps = Math.round(s.frames / s.acc); s.frames = 0; s.acc = 0; }
  }

  /** Extra globe motion on top of the spin; blends smoothly when the style changes. */
  _motion(dt) {
    const t = this.time, m = this.reduced ? "steady" : this.motion;
    let s = 1, p = 0, y = 0, r = 0, tx = 0, ty = 0;
    if (m === "breathe") s = 1 + Math.sin(t * 1.2) * 0.035;
    else if (m === "sway") { r = Math.sin(t * 0.6) * 0.18; ty = Math.sin(t * 0.6 + 1) * 0.06; }
    else if (m === "precess") { p = Math.sin(t * 0.5) * 0.22; r = Math.cos(t * 0.5) * 0.22; }
    else if (m === "bounce") ty = Math.abs(Math.sin(t * 1.6)) * 0.18 - 0.06;
    else if (m === "heartbeat") { const b = t % 1.4; s = 1 + Math.exp(-b * 9) * 0.07 + (b > 0.25 ? Math.exp(-(b - 0.25) * 9) * 0.045 : 0); }
    else if (m === "wobble") { p = Math.sin(t * 2.3) * 0.08; y = Math.sin(t * 1.7) * 0.1; }
    else if (m === "figure8") { tx = Math.sin(t * 0.5) * 0.25; ty = Math.sin(t * 1.0) * 0.12; }
    const k = Math.min(1, dt * 2), g = this.globe.group;
    this.mScale += (s - this.mScale) * k; this.mPitch += (p - this.mPitch) * k;
    this.mYaw += (y - this.mYaw) * k; this.mRoll += (r - this.mRoll) * k;
    g.scale.setScalar(this.mScale);
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
  }

  snapshot() {
    // Render once more and read the canvas in the same task, so no preserveDrawingBuffer is needed.
    if (this.bloomOn && this.bloomAllowed) this.composer.render(0); else this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/png");
  }
}

export { modeById };

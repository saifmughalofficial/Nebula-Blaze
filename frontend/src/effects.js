// Space around the globe: nebula sky, stars, dust, orbit sparks, energy rings, comets, wave field,
// planets, black hole, galaxy, warp streaks, lightning, plus pooled bursts and shockwaves.
// Particles move in vertex shaders from a few uniforms, so the CPU never touches big arrays per frame.
import * as THREE from "three";
import { NOISE, SOFT_POINT, shader, glowTexture, ringTexture, seeded } from "./shaders.js";

const attr = (g, name, arr, size) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(arr), size));

export class Effects {
  constructor(U, scene, maxScale = 1) {
    this.U = U; this.scene = scene; this.layers = {}; this.counted = [];
    this.root = new THREE.Group();
    scene.add(this.root);
    this.rand = seeded(42);
    const S = maxScale;
    this._nebula(); this._stars(Math.round(7000 * S)); this._dust(Math.round(1500 * S));
    this._sparks(Math.round(5000 * S)); this._rings(); this._comets(); this._waves(Math.round(120 * Math.sqrt(S)));
    this._planets(); this._blackhole(Math.round(3000 * S)); this._galaxy(Math.round(11000 * S));
    this._warp(Math.round(800 * S)); this._lightning(); this._bursts(Math.round(420 * S)); this._shocks();
  }

  _add(id, obj, mats, parent = this.root) {
    parent.add(obj);
    this.layers[id] = { obj, mats: [].concat(mats), set(v) { this.mats.forEach((m) => (m.uniforms.uI.value = v)); obj.visible = v > 0.004; } };
  }
  /** Points whose draw range follows the particle-density setting. */
  _counted(points, n) { points.userData.max = n; this.counted.push(points); }
  setDensity(k) {
    for (const p of this.counted) p.geometry.setDrawRange(0, Math.max(1, Math.floor(p.userData.max * k)));
  }

  _nebula() {
    const mat = shader(this.U, /* glsl */ `
      varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, /* glsl */ `
      uniform float uI, uTime, uDark, uPulse; uniform vec3 uBg1, uBg2, uB, uD, uA; varying vec3 vP;
      ${NOISE}
      void main(){
        vec3 d = normalize(vP);
        float n = fbm(d * 2.2 + vec3(uTime * 0.012, 0.0, uTime * 0.008));
        float m = fbm(d * 4.5 - vec3(0.0, uTime * 0.01, 0.0) + n);
        float haze = smoothstep(0.35, 0.85, n) * uI;
        vec3 col = mix(uBg1, uBg2, smoothstep(-0.6, 0.9, d.y + n * 0.6) * (0.25 + 0.4 * uI));
        col += uB * haze * 0.12 + uD * smoothstep(0.55, 0.9, m) * 0.07 * uI + uA * pow(max(0.0, m - 0.5), 2.0) * uI * 0.12;
        col *= 1.0 - uDark * 0.7;
        col += uA * uPulse * 0.04;
        gl_FragColor = vec4(col, 1.0);
      }`, { additive: false, transparent: false, side: THREE.BackSide });
    this.nebulaMat = mat;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(95, 48, 32), mat);
    mesh.renderOrder = -10;
    this.root.add(mesh);
    // The sky is always drawn; the layer only fades the haze in and out.
    this.layers.nebula = { obj: mesh, mats: [mat], set: (v) => (mat.uniforms.uI.value = v) };
  }

  _stars(N) {
    const r = this.rand, pos = [], rr = [], sz = [];
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(35 + r() * 50);
      pos.push(v.x, v.y, v.z); rr.push(r()); sz.push(r() < 0.04 ? 3 + r() * 3 : 0.8 + r() * 1.6);
    }
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aR", rr, 1); attr(g, "aS", sz, 1);
    const mat = shader(this.U, /* glsl */ `
      uniform float uTime, uPx, uEnergy; uniform vec3 uA, uC; attribute float aR, aS; varying vec3 vCol; varying float vTw;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vTw = 0.55 + 0.45 * sin(uTime * (1.0 + aR * 3.0) + aR * 60.0);
        vCol = mix(vec3(1.0), aR < 0.5 ? uA : uC, 0.35 + 0.3 * aR);
        gl_PointSize = aS * 0.11 * (1.0 + uEnergy * 0.5) * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; varying vec3 vCol; varying float vTw; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(vCol * softDot() * vTw * uI, 1.0); }`);
    const p = new THREE.Points(g, mat);
    this.stars = p;
    this._counted(p, N);
    this._add("stars", p, mat);
  }

  _dust(N) {
    const r = this.rand, pos = [], rr = [];
    for (let i = 0; i < N; i++) { pos.push(r() * 24 - 12, r() * 24 - 12, r() * 24 - 12); rr.push(r()); }
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aR", rr, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
    const mat = shader(this.U, /* glsl */ `
      uniform float uTime, uPx, uWarpT; attribute float aR; varying float vA;
      void main(){ vec3 p = mod(position + vec3(sin(uTime * 0.1 + aR * 6.0), uTime * 0.04, uWarpT * 30.0) + 12.0, 24.0) - 12.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vA = smoothstep(-14.0, -3.0, mv.z) * smoothstep(0.5, -1.5, mv.z);
        gl_PointSize = (0.02 + aR * 0.03) * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; uniform vec3 uC; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(mix(uC, vec3(1.0), 0.5) * softDot() * vA * uI * 0.6, 1.0); }`);
    const p = new THREE.Points(g, mat);
    this._counted(p, N);
    this._add("dust", p, mat);
  }

  _sparks(N) {
    const r = this.rand, pos = [], orb = [];
    for (let i = 0; i < N; i++) {
      pos.push(0, 0, 0);
      const band = r();
      // radius, inclination, node, phase / speed packed in two vec4s
      orb.push(1.35 + Math.pow(band, 1.6) * 2.4, (r() - 0.5) * (band < 0.6 ? 0.35 : 1.4), r() * Math.PI * 2, r() * Math.PI * 2);
    }
    const spd = []; for (let i = 0; i < N; i++) spd.push(0.3 + r() * 0.9, r());
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aO", orb, 4); attr(g, "aS", spd, 2);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
    const mat = shader(this.U, /* glsl */ `
      uniform float uOrbitT, uPx, uEnergy, uTime; uniform vec3 uA, uD, uC; attribute vec4 aO; attribute vec2 aS; varying vec3 vCol; varying float vA;
      void main(){
        float ang = aO.w + uOrbitT * aS.x / sqrt(aO.x);
        vec3 p = vec3(cos(ang) * aO.x, 0.0, sin(ang) * aO.x);
        float ci = cos(aO.y), si = sin(aO.y); p = vec3(p.x, p.y * ci - p.z * si, p.y * si + p.z * ci);
        float cn = cos(aO.z), sn = sin(aO.z); p = vec3(p.x * cn + p.z * sn, p.y, -p.x * sn + p.z * cn);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vCol = mix(mix(uA, uD, aS.y), uC, smoothstep(2.5, 3.8, aO.x));
        vA = 0.5 + 0.5 * sin(uTime * 3.0 + aS.y * 50.0);
        gl_PointSize = (0.025 + aS.y * 0.03) * (1.0 + uEnergy * 1.2) * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; varying vec3 vCol; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(vCol * softDot() * (0.4 + vA * 0.8) * uI, 1.0); }`);
    const p = new THREE.Points(g, mat);
    this._counted(p, N);
    this._add("sparks", p, mat);
  }

  _rings() {
    const group = new THREE.Group(), mats = [];
    this.ringMeshes = [];
    const spec = [[1.55, 0.03, 24, 0.12, [1.2, 0, 0.2]], [1.85, 0.018, 60, -0.08, [1.45, 0.4, -0.3]], [2.2, 0.05, 12, 0.05, [0.9, -0.5, 0.6]]];
    for (const [rad, w, dashes, speed, rot] of spec) {
      const mat = shader(this.U, /* glsl */ `
        varying vec2 vXY; void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, /* glsl */ `
        uniform float uI, uTime, uPulse, uEnergy, uRad, uW, uDash, uSpd; uniform vec3 uA, uB, uD; varying vec2 vXY;
        void main(){
          float r = length(vXY), ang = atan(vXY.y, vXY.x) / 6.2831853;
          float edge = 1.0 - abs(r - uRad) / uW;
          float dash = smoothstep(0.35, 0.5, fract(ang * uDash + uTime * uSpd * (1.0 + uEnergy * 2.0)));
          float a = clamp(edge, 0.0, 1.0) * (0.25 + 0.75 * dash) * (1.0 + uPulse * 1.5);
          gl_FragColor = vec4(mix(uB, uA, dash) * a * uI + uD * uPulse * a * 0.4 * uI, 1.0);
        }`, { side: THREE.DoubleSide, uniforms: { uRad: { value: rad }, uW: { value: w }, uDash: { value: dashes }, uSpd: { value: speed } } });
      mats.push(mat);
      const m = new THREE.Mesh(new THREE.RingGeometry(rad - w, rad + w, 192, 1), mat);
      m.rotation.set(...rot);
      group.add(m);
      this.ringMeshes.push(m);
    }
    this.ringGroup = group;
    this._add("rings", group, mats);
  }

  _comets() {
    const r = this.rand, M = 10, K = 56, pos = [], au = [], av = [], ab = [], ap = [], ai = [];
    for (let m = 0; m < M; m++) {
      const u = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize();
      const v = new THREE.Vector3().crossVectors(u, new THREE.Vector3(r() - 0.5, 1, r() - 0.5)).normalize();
      const a = 2.2 + r() * 3.5, b = 1.6 + r() * 2.2, ph = r() * 6.28, sp = (0.35 + r() * 0.5) * (r() < 0.3 ? -1 : 1);
      for (let k = 0; k < K; k++) {
        pos.push(0, 0, 0); au.push(u.x, u.y, u.z); av.push(v.x, v.y, v.z); ab.push(a, b); ap.push(ph, sp, 0.45); ai.push(k / (K - 1));
      }
    }
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aU", au, 3); attr(g, "aV", av, 3); attr(g, "aAB", ab, 2); attr(g, "aP", ap, 3); attr(g, "aI", ai, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    const mat = shader(this.U, /* glsl */ `
      uniform float uOrbitT, uPx, uEnergy; uniform vec3 uA, uB; attribute vec3 aU, aV, aP; attribute vec2 aAB; attribute float aI;
      varying vec3 vCol; varying float vA;
      void main(){
        float th = aP.x + uOrbitT * aP.y - aI * aP.z * sign(aP.y);
        vec3 p = aU * cos(th) * aAB.x + aV * sin(th) * aAB.y;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float head = pow(1.0 - aI, 1.6);
        vCol = mix(uB, mix(uA, vec3(1.0), head * head), head); vA = head;
        gl_PointSize = (0.025 + 0.09 * head) * (1.0 + uEnergy * 0.8) * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; varying vec3 vCol; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(vCol * softDot() * vA * uI * 1.4, 1.0); }`);
    this._add("comets", new THREE.Points(g, mat), mat);
  }

  _waves(G) {
    const pos = [];
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) pos.push((i / (G - 1) - 0.5) * 16, 0, (j / (G - 1) - 0.5) * 16);
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
    const mat = shader(this.U, /* glsl */ `
      uniform float uTime, uPx, uPulse, uEnergy; varying float vH; varying float vA;
      void main(){ vec3 p = position; float d = length(p.xz);
        float h = sin(d * 2.6 - uTime * 2.0) * 0.16 * exp(-d * 0.12) + sin(p.x * 0.9 + uTime * 0.8) * sin(p.z * 0.7 - uTime * 0.6) * 0.12;
        h *= 1.0 + uPulse * 2.0 + uEnergy; p.y = -1.9 + h; vH = h;
        vA = 1.0 - smoothstep(3.0, 8.0, d);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = 0.035 * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; uniform vec3 uA, uC; varying float vH; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(mix(uC, uA, smoothstep(-0.15, 0.2, vH)) * softDot() * vA * uI * 0.8, 1.0); }`);
    this._add("waves", new THREE.Points(g, mat), mat);
  }

  _planets() {
    const group = new THREE.Group(), mats = [];
    const sunDir = new THREE.Vector3(-14, 6, -30).normalize();
    const planetMat = (key, rings = false) => shader(this.U, /* glsl */ `
      varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`, /* glsl */ `
      uniform float uI; uniform vec3 ${key}, uSun; varying vec3 vN; varying vec3 vW;
      void main(){ float l = max(dot(vN, uSun), 0.0); float band = 0.85 + 0.15 * sin(vW.y * 30.0);
        vec3 col = ${key} * (0.12 + 0.95 * l) * band + ${key} * pow(1.0 - abs(dot(vN, normalize(cameraPosition - vW))), 3.0) * 0.6;
        gl_FragColor = vec4(col * uI, uI); }`, { additive: false, depthWrite: true, uniforms: { uSun: { value: sunDir } } });
    this.planets = [];
    const keys = ["uA", "uC", "uB", "uD", "uA"];
    const radii = [1.9, 2.5, 3.2, 4.0, 4.9];
    radii.forEach((rad, i) => {
      const mat = planetMat(keys[i]);
      mat.transparent = true;
      mats.push(mat);
      const size = [0.09, 0.14, 0.12, 0.2, 0.1][i];
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 16), mat);
      const pivot = new THREE.Group();
      pivot.rotation.x = 0.28 + i * 0.03; pivot.rotation.z = (i - 2) * 0.05;
      pivot.add(mesh);
      const omat = shader(this.U, /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        `uniform float uI; uniform vec3 uB; void main(){ gl_FragColor = vec4(uB * 0.28 * uI, 1.0); }`);
      mats.push(omat);
      const pts = new THREE.EllipseCurve(0, 0, rad, rad, 0, Math.PI * 2).getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y));
      pivot.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), omat));
      if (i === 3) {
        const rmat = shader(this.U, `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          `uniform float uI; uniform vec3 uC; varying vec2 vUv; void main(){ gl_FragColor = vec4(uC * 0.5 * uI, 1.0); }`, { side: THREE.DoubleSide });
        mats.push(rmat);
        const ring = new THREE.Mesh(new THREE.RingGeometry(size * 1.4, size * 2.1, 48), rmat);
        ring.rotation.x = 1.2;
        mesh.add(ring);
      }
      group.add(pivot);
      this.planets.push({ mesh, rad, speed: 0.6 / Math.pow(rad, 1.5), phase: i * 1.7 });
    });
    const sunMat = new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd28a });
    const sun = new THREE.Sprite(sunMat);
    sun.position.copy(sunDir).multiplyScalar(30); sun.scale.setScalar(16);
    const sunCore = new THREE.Sprite(sunMat.clone()); sunCore.position.copy(sun.position); sunCore.scale.setScalar(5);
    group.add(sun, sunCore);
    this.sun = [sun, sunCore];
    this.root.add(group);
    const U = this.U;
    this.layers.planets = { obj: group, mats, set: (v) => {
      mats.forEach((m) => (m.uniforms.uI.value = v)); group.visible = v > 0.004;
      sun.material.opacity = v * 0.4; sunCore.material.opacity = v;
      sun.material.color.copy(U.uD.value).lerp(new THREE.Color(1, 0.85, 0.6), 0.6); sunCore.material.color.set(0xffffff);
    } };
  }

  _blackhole(N) {
    const group = new THREE.Group();
    group.rotation.x = -1.22; group.rotation.z = 0.18;
    const dmat = shader(this.U, /* glsl */ `
      varying vec2 vXY; void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, /* glsl */ `
      uniform float uI, uTime, uEnergy; uniform vec3 uA, uC, uD; varying vec2 vXY;
      ${NOISE}
      void main(){
        float r = length(vXY), a = atan(vXY.y, vXY.x) + uTime * (1.8 / pow(r, 1.5)) * (1.0 + uEnergy);
        float n = fbm(vec3(cos(a) * r * 2.2, sin(a) * r * 2.2, r * 3.0 - uTime * 0.2));
        float k = smoothstep(1.3, 1.55, r) * (1.0 - smoothstep(2.4, 3.5, r));
        vec3 hot = mix(vec3(1.0, 0.95, 0.85), uC, smoothstep(1.4, 2.0, r));
        vec3 col = mix(hot, mix(uA, uD, n), smoothstep(1.7, 3.0, r));
        gl_FragColor = vec4(col * k * (0.25 + n * 0.8) * uI * 0.55, 1.0);
      }`, { side: THREE.DoubleSide, defines: { OCTAVES: 3 } });
    group.add(new THREE.Mesh(new THREE.RingGeometry(1.3, 3.5, 160, 6), dmat));
    const r = this.rand, pos = [], dat = [];
    for (let i = 0; i < N; i++) { pos.push(0, 0, 0); dat.push(r(), r() * Math.PI * 2, 0.4 + r() * 0.8, (r() - 0.5) * 0.08); }
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aD", dat, 4);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    const pmat = shader(this.U, /* glsl */ `
      uniform float uTime, uPx, uEnergy; uniform vec3 uA, uC; attribute vec4 aD; varying vec3 vCol; varying float vA;
      void main(){
        float f = fract(aD.x - uTime * 0.05 * aD.z * (1.0 + uEnergy));
        float r = 1.1 + f * f * 4.0;
        float ang = aD.y + uTime * 1.4 / r;
        vec3 p = vec3(cos(ang) * r, sin(ang) * r, aD.w * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vCol = mix(vec3(1.0, 0.9, 0.8), mix(uC, uA, f), smoothstep(0.0, 0.4, f)); vA = smoothstep(0.0, 0.08, f) * (1.0 - f * 0.6) * 0.5;
        gl_PointSize = 0.03 * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; varying vec3 vCol; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(vCol * softDot() * vA * uI, 1.0); }`);
    const pts = new THREE.Points(g, pmat);
    this._counted(pts, N);
    group.add(pts);
    // Photon ring: a thin bright halo hugging the globe's silhouette, always facing the camera.
    const lens = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    lens.scale.setScalar(3.1);
    lens.renderOrder = 3;
    this.root.add(group, lens);
    const U = this.U;
    this.layers.blackhole = { obj: group, mats: [dmat, pmat], set: (v) => {
      dmat.uniforms.uI.value = v; pmat.uniforms.uI.value = v; group.visible = lens.visible = v > 0.004;
      lens.material.opacity = v * 0.6; lens.material.color.copy(U.uC.value).lerp(new THREE.Color(1, 1, 1), 0.5);
    } };
    this.lens = lens;
  }

  _galaxy(N) {
    const r = this.rand, pos = [], dat = [];
    for (let i = 0; i < N; i++) {
      const rad = 2.2 + Math.pow(r(), 1.4) * 10, arm = Math.floor(r() * 4);
      const base = arm * Math.PI / 2 + Math.log(rad) * 2.6 + (r() - 0.5) * (0.5 + 4 / rad) * 0.6;
      pos.push(0, 0, 0); dat.push(rad, base, (r() - 0.5) * 0.4 * (1 - rad / 14), r());
    }
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aD", dat, 4);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14);
    const mat = shader(this.U, /* glsl */ `
      uniform float uOrbitT, uPx, uTime; uniform vec3 uA, uB, uC; attribute vec4 aD; varying vec3 vCol; varying float vA;
      void main(){
        float ang = aD.y + uOrbitT * 0.25 / sqrt(aD.x);
        vec3 p = vec3(cos(ang) * aD.x, aD.z, sin(ang) * aD.x);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float k = smoothstep(2.0, 11.0, aD.x);
        vCol = mix(mix(vec3(1.0, 0.95, 0.9), uC, 0.4), mix(uA, uB, aD.w), k);
        vA = (0.5 + 0.5 * sin(uTime * 2.0 + aD.w * 40.0)) * (1.0 - k * 0.5);
        gl_PointSize = (0.03 + aD.w * 0.04) * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI; varying vec3 vCol; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(vCol * softDot() * (0.35 + vA) * uI * 0.8, 1.0); }`);
    const p = new THREE.Points(g, mat);
    p.rotation.set(0.55, 0, 0.25);
    this._counted(p, N);
    this._add("galaxy", p, mat);
  }

  _warp(N) {
    const r = this.rand, pos = [], dat = [];
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, rad = 1.6 + Math.pow(r(), 0.7) * 9, z = r(), s = 0.6 + r() * 0.8;
      for (const end of [0, 1]) { pos.push(0, 0, 0); dat.push(Math.cos(a) * rad, Math.sin(a) * rad, z, end * 10 + s); }
    }
    const g = new THREE.BufferGeometry();
    attr(g, "position", pos, 3); attr(g, "aD", dat, 4);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -20), 60);
    const mat = shader(this.U, /* glsl */ `
      uniform float uWarpT, uI, uEnergy; attribute vec4 aD; varying float vA; varying float vE;
      void main(){
        float end = floor(aD.w / 10.0), sp = aD.w - end * 10.0;
        float z = mix(-60.0, 6.0, fract(aD.z + uWarpT * sp));
        float len = (0.3 + 5.0 * uI) * (0.6 + uEnergy);
        vec3 p = vec3(aD.x, aD.y, z - end * len);
        vA = smoothstep(-60.0, -35.0, z) * smoothstep(6.0, 2.0, z); vE = end;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`, /* glsl */ `
      uniform float uI; uniform vec3 uA, uC; varying float vA; varying float vE;
      void main(){ gl_FragColor = vec4(mix(vec3(1.0), mix(uA, uC, vE), 0.6) * vA * (1.0 - vE * 0.85) * uI, 1.0); }`);
    const seg = new THREE.LineSegments(g, mat);
    this._add("warp", seg, mat);
  }

  _lightning() {
    const group = new THREE.Group();
    this.bolts = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
      const m = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const line = new THREE.Line(g, m);
      line.frustumCulled = false;
      group.add(line);
      this.bolts.push({ line, life: 0 });
    }
    this.boltTimer = 0.5;
    this.lightningI = 0;
    this.root.add(group);
    this.layers.lightning = { obj: group, mats: [], set: (v) => { this.lightningI = v; group.visible = v > 0.004; } };
  }

  /** Fires one lightning bolt from a random point on the globe. Returns the start direction. */
  strike(color) {
    const b = this.bolts.find((x) => x.life <= 0) || this.bolts[0];
    const r = Math.random, dir = new THREE.Vector3(r() - 0.5, r() - 0.5, r() * 0.8).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(dir, side);
    const arr = b.line.geometry.attributes.position.array, len = 0.8 + r() * 1.4;
    for (let i = 0; i < 26; i++) {
      const k = i / 25, jit = Math.sin(k * Math.PI) * 0.22;
      const p = dir.clone().multiplyScalar(1.02 + k * len).addScaledVector(side, (r() - 0.5) * jit).addScaledVector(up, (r() - 0.5) * jit);
      arr.set([p.x, p.y, p.z], i * 3);
    }
    b.line.geometry.attributes.position.needsUpdate = true;
    b.line.material.color.copy(color).lerp(new THREE.Color(1, 1, 1), 0.4);
    b.life = 0.35;
    return dir;
  }

  _bursts(N) {
    this.burstPool = [];
    for (let k = 0; k < 6; k++) {
      const r = this.rand, pos = [], dir = [];
      for (let i = 0; i < N; i++) {
        pos.push(0, 0, 0);
        const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.3 + r());
        dir.push(v.x, v.y, v.z, r());
      }
      const g = new THREE.BufferGeometry();
      attr(g, "position", pos, 3); attr(g, "aDir", dir, 4);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
      const mat = shader(this.U, /* glsl */ `
        uniform float uTime, uPx, uStart, uPow, uLife; uniform vec3 uOrigin; attribute vec4 aDir; varying float vA; varying float vR;
        void main(){
          float age = uTime - uStart, k = 1.0 - exp(-age * 2.8);
          vec3 p = uOrigin + aDir.xyz * k * uPow * (0.6 + aDir.w);
          float s = sin(age * aDir.w * 2.0), c = cos(age * aDir.w * 2.0); p.xz = mat2(c, -s, s, c) * p.xz;
          vA = clamp(1.0 - age / uLife, 0.0, 1.0); vR = aDir.w;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.02 + aDir.w * 0.05) * (0.4 + vA) * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
        uniform vec3 uCol, uCol2; varying float vA; varying float vR; ${SOFT_POINT}
        void main(){ gl_FragColor = vec4(mix(uCol, uCol2, vR) * softDot() * vA * vA * 1.6, 1.0); }`, {
        uniforms: { uStart: { value: -100 }, uPow: { value: 1 }, uLife: { value: 1.6 }, uOrigin: { value: new THREE.Vector3() },
          uCol: { value: new THREE.Color() }, uCol2: { value: new THREE.Color() } } });
      const p = new THREE.Points(g, mat);
      p.visible = false;
      this._counted(p, N);
      this.root.add(p);
      this.burstPool.push(p);
    }
    this.burstIdx = 0;
  }

  burst(origin, power = 1, colA, colB, life = 1.6) {
    const p = this.burstPool[this.burstIdx++ % this.burstPool.length], u = p.material.uniforms;
    u.uStart.value = this.U.uTime.value; u.uPow.value = power; u.uLife.value = life;
    u.uOrigin.value.copy(origin); u.uCol.value.copy(colA); u.uCol2.value.copy(colB);
    p.visible = true;
  }

  _shocks() {
    this.shockPool = [];
    for (let i = 0; i < 4; i++) {
      const mat = shader(this.U, `varying vec2 vXY; void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        /* glsl */ `uniform float uAge; uniform vec3 uCol; varying vec2 vXY;
        void main(){ float r = length(vXY); float a = smoothstep(0.82, 0.97, r) * smoothstep(1.0, 0.97, r) * (1.0 - uAge);
          gl_FragColor = vec4(uCol * a * 1.4, 1.0); }`, { side: THREE.DoubleSide, uniforms: { uAge: { value: 1 }, uCol: { value: new THREE.Color() } } });
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 128), mat);
      m.visible = false;
      this.root.add(m);
      this.shockPool.push({ m, age: 1, speed: 1 });
    }
    this.shockIdx = 0;
  }

  shockwave(color, tilt = 0, speed = 1) {
    const s = this.shockPool[this.shockIdx++ % this.shockPool.length];
    s.age = 0; s.speed = speed; s.m.visible = true;
    s.m.rotation.set(tilt, (Math.random() - 0.5) * tilt, 0);
    s.m.material.uniforms.uCol.value.copy(color);
  }

  tick(t, dt, yaw) {
    this.stars.rotation.y = yaw * 0.04 + t * 0.004;
    this.stars.rotation.x = Math.sin(t * 0.05) * 0.03;
    if (this.ringGroup.visible) this.ringMeshes.forEach((m, i) => { m.rotation.z += dt * (0.1 + i * 0.07) * (i % 2 ? -1 : 1); });
    if (this.layers.planets.obj.visible) {
      for (const p of this.planets) {
        const a = p.phase + this.U.uOrbitT.value * p.speed;
        p.mesh.position.set(Math.cos(a) * p.rad, 0, Math.sin(a) * p.rad);
        p.mesh.rotation.y += dt;
      }
    }
    for (const s of this.shockPool) {
      if (!s.m.visible) continue;
      s.age += dt * 0.55 * s.speed;
      s.m.scale.setScalar(1.1 + s.age * 4.5);
      s.m.material.uniforms.uAge.value = s.age;
      if (s.age >= 1) s.m.visible = false;
    }
    for (const p of this.burstPool) {
      if (p.visible && t - p.material.uniforms.uStart.value > p.material.uniforms.uLife.value) p.visible = false;
    }
    for (const b of this.bolts) {
      b.life -= dt;
      b.line.material.opacity = Math.max(0, b.life / 0.35) * this.lightningI * (0.6 + Math.random() * 0.4);
    }
  }
}

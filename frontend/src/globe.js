// The globe and everything attached to its surface: ocean body, glow grid, point-cloud continents,
// atmosphere, data arcs, pulse nodes, aurora curtains, energy shield and the quantum core.
import * as THREE from "three";
import { MASK_W, MASK_H, MASK_HEX } from "./worldmask.js";
import { NOISE, SOFT_POINT, shader, glowTexture, seeded } from "./shaders.js";

const isLand = (lat, lon) => {
  const u = (lon + Math.PI) / (2 * Math.PI), v = (Math.PI / 2 - lat) / Math.PI;
  const col = Math.min(MASK_W - 1, Math.floor(u * MASK_W)), row = Math.min(MASK_H - 1, Math.floor(v * MASK_H));
  const bit = row * MASK_W + col;
  return ((parseInt(MASK_HEX[bit >> 2], 16) >> (3 - (bit & 3))) & 1) === 1;
};
// lon 0 faces the camera (+z), east is +x, so continents are not mirrored.
const dirOf = (lat, lon, r = 1) => new THREE.Vector3(Math.cos(lat) * Math.sin(lon) * r, Math.sin(lat) * r, Math.cos(lat) * Math.cos(lon) * r);

const SPHERE_V = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;

const RIPPLE = /* glsl */ `
float ripple(vec3 n){
  float age = uTime - uRip.w; if (age < 0.0 || age > 2.2) return 0.0;
  float d = acos(clamp(dot(normalize(n), uRip.xyz), -1.0, 1.0));
  return exp(-pow((d - age * 1.7) * 12.0, 2.0)) * (1.0 - age / 2.2);
}`;

export class Globe {
  constructor(U, maxScale = 1) {
    this.U = U;
    this.group = new THREE.Group();     // yaw/pitch applied here
    this.spin = new THREE.Group();      // things that spin with the surface
    this.group.add(this.spin);
    this.layers = {};
    this.land = [];
    this._body(); this._grid(); this._land(maxScale); this._atmosphere(); this._arcs(); this._aurora();
    this._shield(); this._core();
  }

  _add(id, obj, mats, parent = this.spin) {
    parent.add(obj);
    this.layers[id] = { obj, mats: [].concat(mats), set(v) { this.mats.forEach((m) => (m.uniforms.uI.value = v)); obj.visible = v > 0.004; } };
  }

  _body() {
    const mat = shader(this.U, SPHERE_V, /* glsl */ `
      uniform float uI, uTime, uDark, uFlash, uOpacity; uniform vec3 uA, uB, uDeep; uniform vec4 uRip;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      ${RIPPLE}
      void main(){
        float fres = pow(1.0 - max(dot(vN, vV), 0.0), 2.4);
        vec3 n = normalize(vP);
        float bands = 0.5 + 0.5 * sin(n.y * 42.0 + uTime * 0.7);
        float scan = smoothstep(0.985, 1.0, 0.5 + 0.5 * sin(n.y * 5.0 - uTime * 1.3));
        vec3 col = uDeep * (1.0 - uDark * 0.85) + uB * 0.05 * bands + uA * fres * 0.7 + uA * scan * 0.08;
        col += uA * ripple(vP) * 1.2 + uA * uFlash * 0.25;
        gl_FragColor = vec4(col, uOpacity);
      }`, { additive: false, depthWrite: true, uniforms: { uOpacity: { value: 1 } } });
    this.bodyMat = mat;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
    mesh.renderOrder = 1;
    this.body = mesh;
    this.spin.add(mesh);
  }

  _grid() {
    const pos = [], t = [], step = Math.PI / 12, seg = 96;
    for (let lat = -5 * step; lat <= 5 * step + 1e-6; lat += step) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
        pos.push(...dirOf(lat, a, 1.004).toArray(), ...dirOf(lat, b, 1.004).toArray());
        t.push(i / seg, (i + 1) / seg);
      }
    }
    for (let lon = 0; lon < Math.PI * 2 - 1e-6; lon += step) {
      for (let i = 0; i < seg / 2; i++) {
        const a = -Math.PI / 2 + (i / (seg / 2)) * Math.PI, b = -Math.PI / 2 + ((i + 1) / (seg / 2)) * Math.PI;
        pos.push(...dirOf(a, lon, 1.004).toArray(), ...dirOf(b, lon, 1.004).toArray());
        t.push(i / (seg / 2), (i + 1) / (seg / 2));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
    const mat = shader(this.U, /* glsl */ `
      attribute float aT; varying float vT; varying float vFace; varying vec3 vP;
      void main(){ vT = aT; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = dot(normalize(normalMatrix * position), normalize(-mv.xyz)); gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI, uTime; uniform vec3 uA, uB; uniform vec4 uRip; varying float vT; varying float vFace; varying vec3 vP;
      ${RIPPLE}
      void main(){
        float travel = fract(vT * 3.0 - uTime * 0.16 + vP.y * 0.5);
        float glow = smoothstep(0.9, 1.0, travel);
        float a = (0.16 + glow * 0.75 + ripple(vP) * 1.5) * mix(0.12, 1.0, smoothstep(-0.25, 0.3, vFace));
        gl_FragColor = vec4(mix(uB, uA, glow) * a * uI, 1.0);
      }`);
    this._add("grid", new THREE.LineSegments(g, mat), mat);
  }

  _land(maxScale) {
    const N = Math.round(26000 * maxScale), pos = [], rnd = [], rand = seeded(7);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, lat = Math.asin(y), lon = ((i * golden) % (Math.PI * 2)) - Math.PI;
      if (!isLand(lat, lon)) continue;
      pos.push(...dirOf(lat, lon, 1.006).toArray());
      rnd.push(rand());
      if (rand() < 0.02) this.land.push(dirOf(lat, lon, 1));
    }
    // Shuffle so a partial draw range (particle density) stays evenly spread.
    const n = rnd.length, order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const P = new Float32Array(n * 3), R = new Float32Array(n);
    order.forEach((o, i) => { P.set(pos.slice(o * 3, o * 3 + 3), i * 3); R[i] = rnd[o]; });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("aR", new THREE.BufferAttribute(R, 1));
    this.landCount = n;
    const mat = shader(this.U, /* glsl */ `
      uniform float uTime, uPx, uSize, uEnergy; uniform vec3 uA, uC, uD; uniform vec4 uRip;
      attribute float aR; varying vec3 vCol; varying float vA;
      ${RIPPLE}
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float face = dot(normalize(normalMatrix * position), normalize(-mv.xyz));
        float tw = 0.75 + 0.35 * sin(uTime * 2.0 + aR * 40.0);
        float sweep = pow(0.5 + 0.5 * sin(atan(position.x, position.z) * 2.0 - uTime * 0.8 + position.y * 2.0), 10.0);
        float rp = ripple(position);
        vCol = mix(uA, uC, smoothstep(-0.6, 0.8, position.y)) + uD * sweep * 0.9 + vec3(rp);
        vA = smoothstep(-0.15, 0.25, face) * 0.85 + 0.15;
        gl_PointSize = (0.012 + rp * 0.02) * uSize * tw * (1.0 + uEnergy * 0.4) * uPx / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, /* glsl */ `
      uniform float uI; varying vec3 vCol; varying float vA; ${SOFT_POINT}
      void main(){ gl_FragColor = vec4(vCol * softDot() * vA * uI, 1.0); }`);
    this.landPoints = new THREE.Points(g, mat);
    this.landPoints.renderOrder = 2;
    this._add("land", this.landPoints, mat);
  }

  _atmosphere() {
    const mat = shader(this.U, SPHERE_V, /* glsl */ `
      uniform float uI, uTime, uPulse, uEnergy; uniform vec3 uA, uB; varying vec3 vN; varying vec3 vV;
      void main(){
        float d = dot(vN, vV);
        float k = pow(clamp(-d / 0.62, 0.0, 1.0), 3.0) * smoothstep(-1.0, -0.5, d);
        float breathe = 0.85 + 0.15 * sin(uTime * 1.3) + uPulse * 0.6 + uEnergy * 0.3;
        gl_FragColor = vec4(mix(uB, uA, k) * k * breathe * uI * 0.75, 1.0);
      }`, { side: THREE.BackSide });
    this._add("atmosphere", new THREE.Mesh(new THREE.SphereGeometry(1.26, 64, 48), mat), mat, this.group);
  }

  _arcs() {
    const rand = seeded(11), pos = [], t = [], off = [], sp = [], nodes = [], nodeR = [];
    const pts = this.land.length > 10 ? this.land : [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
    const M = 34, S = 48;
    for (let m = 0; m < M; m++) {
      const a = pts[Math.floor(rand() * pts.length)], b = pts[Math.floor(rand() * pts.length)];
      const ang = a.angleTo(b);
      if (ang < 0.3) continue;
      const h = 0.12 + 0.35 * (ang / Math.PI), o = rand(), s = 0.18 + rand() * 0.3;
      let prev = null;
      for (let i = 0; i <= S; i++) {
        const k = i / S, p = new THREE.Vector3().copy(a).lerp(b, k).normalize().multiplyScalar(1.01 + h * Math.sin(Math.PI * k));
        if (prev) { pos.push(...prev.toArray(), ...p.toArray()); t.push((i - 1) / S, k); off.push(o, o); sp.push(s, s); }
        prev = p;
      }
      nodes.push(...a.clone().multiplyScalar(1.012).toArray(), ...b.clone().multiplyScalar(1.012).toArray());
      nodeR.push(rand(), rand());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
    g.setAttribute("aO", new THREE.Float32BufferAttribute(off, 1));
    g.setAttribute("aS", new THREE.Float32BufferAttribute(sp, 1));
    const mat = shader(this.U, /* glsl */ `
      attribute float aT, aO, aS; varying float vT, vO, vS;
      void main(){ vT = aT; vO = aO; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, /* glsl */ `
      uniform float uI, uTime, uEnergy; uniform vec3 uA, uC, uD; varying float vT, vO, vS;
      void main(){
        float head = fract(uTime * vS * (1.0 + uEnergy) + vO) * 1.5 - 0.25;
        float x = (head - vT) / 0.28;
        float a = (x > 0.0 && x < 1.0 ? pow(1.0 - x, 1.5) : 0.0) + 0.06;
        gl_FragColor = vec4(mix(uC, uA, vT) * a * uI * 1.4 + uD * step(0.0, x) * step(x, 0.05) * uI, 1.0);
      }`);
    this._add("arcs", new THREE.LineSegments(g, mat), mat);

    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.Float32BufferAttribute(nodes, 3));
    ng.setAttribute("aR", new THREE.Float32BufferAttribute(nodeR, 1));
    const nmat = shader(this.U, /* glsl */ `
      uniform float uPx; attribute float aR; varying float vR; varying float vFace;
      void main(){ vR = aR; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = smoothstep(-0.1, 0.3, dot(normalize(normalMatrix * position), normalize(-mv.xyz)));
        gl_PointSize = 0.09 * uPx / -mv.z; gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI, uTime; uniform vec3 uD, uA; varying float vR; varying float vFace;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0, ph = fract(uTime * 0.6 + vR);
        float ring = smoothstep(0.09, 0.0, abs(d - ph)) * (1.0 - ph);
        float core = smoothstep(0.28, 0.0, d);
        gl_FragColor = vec4((uD * ring + mix(uA, vec3(1.0), 0.5) * core) * uI * vFace, 1.0);
      }`);
    this._add("nodes", new THREE.Points(ng, nmat), nmat);
  }

  _aurora() {
    const mats = [], group = new THREE.Group();
    for (const hemi of [1, -1]) {
      const mat = shader(this.U, /* glsl */ `
        uniform float uTime, uHemi; varying vec2 vUv;
        void main(){ vUv = uv; float lon = uv.x * 6.2831853;
          float lat = uHemi * (1.12 + 0.07 * sin(lon * 3.0 + uTime * 0.4) + 0.04 * sin(lon * 7.0 - uTime * 0.9));
          float r = 1.02 + uv.y * 0.34;
          vec3 p = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)) * r;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`, /* glsl */ `
        uniform float uI, uTime; uniform vec3 uA, uC, uD; varying vec2 vUv;
        void main(){
          float flow = 0.5 + 0.5 * sin(vUv.x * 70.0 + uTime * 1.6 + sin(vUv.x * 13.0 - uTime) * 2.5);
          float a = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.12, vUv.y) * (0.3 + 0.7 * flow);
          gl_FragColor = vec4((mix(uC, uA, vUv.y) + uD * 0.35 * vUv.y) * a * uI * 1.2, 1.0);
        }`, { side: THREE.DoubleSide, uniforms: { uHemi: { value: hemi } } });
      mats.push(mat);
      group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 180, 10), mat));
    }
    this._add("aurora", group, mats);
  }

  _shield() {
    const group = new THREE.Group();
    const edges = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.36, 3));
    const lmat = shader(this.U, /* glsl */ `
      varying vec3 vP; varying float vFace;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = dot(normalize(normalMatrix * position), normalize(-mv.xyz)); gl_Position = projectionMatrix * mv; }`, /* glsl */ `
      uniform float uI, uTime, uFlash, uPulse; uniform vec3 uA, uD; varying vec3 vP; varying float vFace;
      void main(){
        float band = exp(-pow((vP.y - sin(uTime * 0.7) * 1.36) * 5.0, 2.0));
        float a = (0.05 + 0.45 * band + uFlash * 0.6 + uPulse * 0.3) * mix(0.25, 1.0, 1.0 - abs(vFace));
        gl_FragColor = vec4(mix(uA, uD, band) * a * uI, 1.0);
      }`);
    group.add(new THREE.LineSegments(edges, lmat));
    const smat = shader(this.U, SPHERE_V, /* glsl */ `
      uniform float uI, uTime; uniform vec3 uA, uD; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        gl_FragColor = vec4(mix(uA, uD, 0.5 + 0.5 * sin(uTime)) * f * 0.55 * uI, 1.0); }`);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.36, 48, 32), smat));
    this.shieldGroup = group;
    this._add("shield", group, [lmat, smat], this.group);
  }

  _core() {
    const group = new THREE.Group();
    const mat = shader(this.U, SPHERE_V, /* glsl */ `
      uniform float uI, uTime, uEnergy; uniform vec3 uA, uD; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      ${NOISE}
      void main(){
        float n = fbm(vP * 4.0 + vec3(0.0, uTime * 0.6, uTime * 0.3));
        float f = pow(1.0 - max(dot(vN, vV), 0.0), 1.5);
        vec3 col = mix(uD, uA, n) * (0.6 + n) + vec3(1.0) * pow(n, 4.0) * 1.5 + uA * f;
        gl_FragColor = vec4(col * uI * (1.0 + uEnergy * 0.5), 1.0);
      }`, { defines: { OCTAVES: 3 } });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 48, 32), mat);
    core.renderOrder = 0;
    group.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(2.2);
    group.add(glow);
    this.electrons = [];
    const omats = [];
    for (let i = 0; i < 3; i++) {
      const curve = new THREE.EllipseCurve(0, 0, 0.72, 0.5, 0, Math.PI * 2);
      const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(96));
      const omat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      omats.push(omat);
      const loop = new THREE.LineLoop(g, omat);
      const pivot = new THREE.Group();
      pivot.rotation.set(i * 1.05, i * 0.7, i * 0.4);
      pivot.add(loop);
      const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      e.scale.setScalar(0.22);
      pivot.add(e);
      group.add(pivot);
      this.electrons.push({ sprite: e, phase: i * 2.1, speed: 2.2 + i * 0.6 });
    }
    this.coreGlow = glow; this.coreOrbitMats = omats; this.coreGroup = group;
    this.group.add(group);
    const U = this.U;
    this.layers.core = {
      obj: group, mats: [mat],
      set: (v) => {
        mat.uniforms.uI.value = v; group.visible = v > 0.004;
        glow.material.opacity = v * 0.9; glow.material.color.copy(U.uA.value);
        omats.forEach((m) => { m.opacity = v * 0.5; m.color.copy(U.uD.value); });
        this.electrons.forEach((e) => { e.sprite.material.opacity = v; e.sprite.material.color.copy(U.uC.value); });
      },
    };
  }

  /** Per-frame motion for parts that are cheaper to animate on the CPU. */
  tick(t, dt) {
    this.shieldGroup.rotation.y -= dt * 0.15;
    this.shieldGroup.rotation.x = Math.sin(t * 0.2) * 0.2;
    if (this.coreGroup.visible) {
      this.coreGroup.rotation.y += dt * 0.4;
      for (const e of this.electrons) {
        const a = e.phase + t * e.speed;
        e.sprite.position.set(Math.cos(a) * 0.72, Math.sin(a) * 0.5, 0);
      }
      this.coreGlow.scale.setScalar(2 + Math.sin(t * 3) * 0.2);
    }
  }

  /** Ray (world) → hit point on the globe in surface-local coordinates, or null. */
  pick(ray) {
    const oc = ray.origin, b = oc.dot(ray.direction), c = oc.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const tHit = -b - Math.sqrt(disc);
    if (tHit < 0) return null;
    const world = ray.origin.clone().addScaledVector(ray.direction, tHit);
    const local = this.spin.worldToLocal(world.clone()).normalize();
    return { world, local };
  }
}

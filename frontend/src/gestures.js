// Turns raw hand landmarks into smooth motion and debounced gestures. Pure logic, no DOM:
// tests/gesture-tests.js drives it with synthetic hands.

/** One Euro filter: smooth when still, responsive when moving fast. */
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.03, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }
  reset() { this.x = null; this.dx = 0; this.t = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(value, t) {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

/** Classifies a 21-landmark hand into open | fist | pinch | peace | point | other. */
export function classifyPose(lm, wasPinching = false) {
  if (!lm || lm.length < 21) return "none";
  const wrist = lm[0];
  const scale = dist(wrist, lm[9]) || 1e-6;
  const extended = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.12;
  const curled = (tip, pip) => dist(lm[tip], wrist) < dist(lm[pip], wrist) * 1.02;
  const idx = extended(8, 6), mid = extended(12, 10), ring = extended(16, 14), pinky = extended(20, 18);
  const pinchGap = dist(lm[4], lm[8]) / scale;
  // Hysteresis: a pinch starts below 0.28 hand-widths and only ends above 0.42.
  const pinching = pinchGap < (wasPinching ? 0.42 : 0.28) && dist(lm[8], wrist) > scale * 0.85;
  if (pinching) return "pinch";
  if (idx && mid && ring && pinky) return "open";
  if (curled(8, 6) && curled(12, 10) && curled(16, 14) && curled(20, 18)) return "fist";
  if (idx && mid && !ring && !pinky) return "peace";
  if (idx && !mid && !ring && !pinky) return "point";
  return "other";
}

/** Palm centre in mirrored, centred coordinates: x right = +1, y up = +1. */
export function palmCenter(lm) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  x /= ids.length; y /= ids.length;
  return { x: (0.5 - x) * 2, y: (0.5 - y) * 2 };
}

// How long a pose must be held before it counts (ms). Fist is longest so a passing fist never pauses.
export const DWELL = { open: 260, fist: 420, pinch: 140, peace: 320, point: 300, other: 0, none: 0 };
const COOLDOWN = 900;

export class GestureEngine {
  constructor() {
    this.smoothing = 0.5;
    this.fx = new OneEuro(); this.fy = new OneEuro();
    this.reset();
  }
  setSmoothing(s) {
    this.smoothing = s;
    // 0 → raw and twitchy, 1 → very calm.
    const min = 3.0 - s * 2.6;
    this.fx.minCutoff = this.fy.minCutoff = min;
  }
  reset() {
    this.present = false; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.speed = 0;
    this.pose = "none"; this.candidate = "none"; this.candidateSince = 0;
    this.lastFire = {}; this.lastT = 0; this.lostAt = 0;
    this.fx.reset(); this.fy.reset();
  }
  /**
   * @param {Array|null} lm   landmarks of the main hand, or null
   * @param {number} tMs      timestamp in ms
   * @returns {{present:boolean,x:number,y:number,vx:number,vy:number,speed:number,pose:string,events:string[]}}
   */
  update(lm, tMs) {
    const events = [];
    const t = tMs / 1000;
    if (!lm) {
      if (this.present) {
        // Brief dropouts (motion blur) are bridged for 250 ms before declaring the hand lost.
        if (!this.lostAt) this.lostAt = tMs;
        if (tMs - this.lostAt > 250) {
          this.present = false; this.pose = "none"; this.candidate = "none";
          this.fx.reset(); this.fy.reset();
          events.push("lost");
        }
      }
      this.vx *= 0.85; this.vy *= 0.85; this.speed = Math.hypot(this.vx, this.vy);
      return this.snapshot(events);
    }
    this.lostAt = 0;
    if (!this.present) { this.present = true; events.push("found"); }
    const p = palmCenter(lm);
    const nx = this.fx.filter(p.x, t), ny = this.fy.filter(p.y, t);
    const dt = this.lastT ? Math.min(0.2, Math.max(1e-3, t - this.lastT)) : 0;
    if (dt) {
      const k = 0.45;
      this.vx += ((nx - this.x) / dt - this.vx) * k;
      this.vy += ((ny - this.y) / dt - this.vy) * k;
    }
    this.lastT = t; this.x = nx; this.y = ny;
    this.speed = Math.hypot(this.vx, this.vy);

    const raw = classifyPose(lm, this.pose === "pinch");
    if (raw !== this.candidate) { this.candidate = raw; this.candidateSince = tMs; }
    if (raw !== this.pose && tMs - this.candidateSince >= (DWELL[raw] ?? 300)) {
      this.pose = raw;
      if (raw !== "other" && tMs - (this.lastFire[raw] || -1e9) > COOLDOWN) {
        this.lastFire[raw] = tMs;
        events.push(raw);
      }
    }
    return this.snapshot(events);
  }
  snapshot(events) {
    return { present: this.present, x: this.x, y: this.y, vx: this.vx, vy: this.vy, speed: this.speed, pose: this.pose, events };
  }
}

/**
 * Maps hand motion to globe spin. Flick style: horizontal hand motion pushes the spin, which keeps
 * going (and keeps its direction) after the hand stops. Steer style: hand offset from centre sets speed.
 * Returns the desired yaw velocity (rad/s) or null when the hand should not drive the globe.
 */
export function handSpin(g, { style = "flick", sensitivity = 1, deadZone = 0.12 } = {}) {
  if (!g.present) return null;
  if (style === "steer") {
    const off = Math.abs(g.x) < deadZone ? 0 : g.x - Math.sign(g.x) * deadZone;
    return off * 1.8 * sensitivity;
  }
  // Below 0.3 screen-halves per second is tremor or drift: keep the current spin.
  const v = Math.abs(g.vx);
  if (v < 0.3) return null;
  // Soft response curve: small slides give a gentle turn, only a real swipe spins fast.
  const shaped = Math.sign(g.vx) * Math.pow(v - 0.3, 1.4) * 0.75;
  return clamp(shaped * sensitivity, -3.2, 3.2);
}

/** Target pitch (rad) from hand height, clamped to a comfortable range. */
export function handPitch(g, sensitivity = 1) {
  if (!g.present) return null;
  const y = Math.abs(g.y) < 0.15 ? 0 : g.y - Math.sign(g.y) * 0.15;
  return clamp(-y * 0.4 * Math.min(1.5, sensitivity), -0.45, 0.45);
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

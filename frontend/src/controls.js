// Small UI helpers: toasts, gesture pill, mode title card, button ripples, fullscreen, cursor sparkles.

export const $ = (s) => document.querySelector(s);

export function toast(html, life = 3200) {
  const el = document.createElement("div");
  el.className = "toast";
  el.style.setProperty("--life", `${life}ms`);
  el.innerHTML = html;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, life);
  const all = $("#toasts").children;
  if (all.length > 4) all[0].remove();
}

let pillTimer = 0;
export function pill(text) {
  const el = $("#gesture-pill");
  el.textContent = text;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => el.classList.remove("show"), 1400);
}

export function titleCard(name, sub) {
  const el = $("#mode-title");
  el.querySelector("span").textContent = name;
  el.querySelector("small").textContent = sub;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

/** Material-style ripple on every button press. */
export function enableRipples() {
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn, .icon, .mode, .fx");
    if (!b) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    const span = document.createElement("span");
    span.className = "ripple";
    Object.assign(span.style, { width: `${s}px`, height: `${s}px`, left: `${e.clientX - r.left - s / 2}px`, top: `${e.clientY - r.top - s / 2}px` });
    b.appendChild(span);
    setTimeout(() => span.remove(), 650);
  });
}

export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export function canFullscreen() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}
export async function toggleFullscreen() {
  if (isFullscreen()) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  const el = document.documentElement;
  return (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
}

/** Lightweight 2D sparkle trail that follows the pointer (pooled, capped). */
export class Sparkles {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext("2d"); this.p = []; this.on = true; this.color = "#22f0d8";
    this.resize();
    addEventListener("resize", () => this.resize());
    addEventListener("pointermove", (e) => {
      if (!this.on || e.pointerType === "touch") return;
      for (let i = 0; i < 2; i++) this.spawn(e.clientX, e.clientY, 0.6);
    });
  }
  resize() { const d = Math.min(devicePixelRatio || 1, 2); this.d = d; this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; }
  spawn(x, y, power = 1) {
    if (this.p.length > 220) this.p.shift();
    const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random() * 1.6) * power;
    this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.3, life: 1, size: 1 + Math.random() * 2.5 });
  }
  pop(x, y) { for (let i = 0; i < 40; i++) this.spawn(x, y, 3); }
  tick(dt) {
    const g = this.g, d = this.d;
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!this.p.length) return;
    g.globalCompositeOperation = "lighter";
    g.fillStyle = this.color;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.life -= dt * 1.6; q.x += q.vx; q.y += q.vy; q.vx *= 0.96; q.vy *= 0.96;
      if (q.life <= 0) { this.p.splice(i, 1); continue; }
      g.globalAlpha = q.life * 0.9;
      g.beginPath(); g.arc(q.x * d, q.y * d, q.size * q.life * d, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
}

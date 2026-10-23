// Nebula Blaze entry point: boots the scene, wires gestures, pointer, keyboard and the HUD.
import * as THREE from "three";
import { NebulaScene } from "./scene.js";
import { THEMES, THEME_IDS, MODES, LAYERS, MOTIONS, TOTAL_ANIMATIONS, modeById, remixRecipe } from "./themes.js";
import { HandTracker, cameraHint } from "./handTracking.js";
import { GestureEngine, handSpin, handPitch } from "./gestures.js";
import { Sound } from "./audio.js";
import { $, toast, pill, titleCard, enableRipples, isFullscreen, canFullscreen, toggleFullscreen, Sparkles } from "./controls.js";

const DEFAULTS = {
  theme: "aurora", mode: "datapulse", quality: "auto", density: 1, bloom: true, hue: false, sparkles: true, sound: false, fps: false,
  sensitivity: 0.8, smoothing: 0.75, autoSpin: 1, style: "flick", slowmo: false, autopilot: false, reduced: false,
  pinch: "focus", peace: "theme", point: "reverse", radar: true, motion: "auto",
};
const STORE = "nebula-blaze-settings-v2";
let S = { ...DEFAULTS };
let stored = null;
try { stored = localStorage.getItem(STORE); } catch {}
try { Object.assign(S, JSON.parse(stored || "{}")); } catch {}
if (!stored && matchMedia("(prefers-reduced-motion: reduce)").matches) S.reduced = true;
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {} };

function fatal(msg) {
  $("#fatal-msg").textContent = msg;
  $("#fatal").classList.add("open");
  window.__bootFailed = true;
}

function webglOK() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

function autoQuality(renderer) {
  try {
    const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    if (/swiftshader|llvmpipe|software/i.test(name)) return "low";
    if (/intel|uhd|iris|mali|adreno|powervr|apple gpu/i.test(name) || matchMedia("(pointer: coarse)").matches) return "balanced";
    return "ultra";
  } catch { return "balanced"; }
}

if (!webglOK()) fatal("WebGL is not available. Enable hardware acceleration or try a recent Chrome, Edge or Firefox.");
else boot();

function boot() {
  let nebula;
  try { nebula = new NebulaScene($("#stage")); }
  catch (err) { console.error(err); fatal(`3D failed to start: ${err.message}`); return; }
  const sound = new Sound();
  const sparkles = new Sparkles($("#sparkle"));
  const tracker = new HandTracker();
  const gestures = new GestureEngine();
  const app = { nebula, tracker, gestures, settings: S, sound };
  window.nebula = app;
  enableRipples();

  // ---------- Theme & mode ----------
  let currentMode = modeById(S.mode);
  const setCSSColors = () => {
    const th = THEMES[nebula.themeId];
    for (const k of ["a", "b", "c", "d"]) document.documentElement.style.setProperty(`--${k}`, th[k]);
    sparkles.color = th.a;
  };
  function applyTheme(id, announce = true) {
    if (!THEMES[id]) return;
    S.theme = id; save();
    nebula.setTheme(id);
    setCSSColors();
    document.querySelectorAll(".swatch[data-theme]").forEach((b) => { b.classList.toggle("active", b.dataset.theme === id); b.setAttribute("aria-checked", b.dataset.theme === id); });
    if (announce) { pill(`🎨 ${THEMES[id].name}`); sound.play("blip"); nebula.flash = 0.4; }
  }
  function applyMode(mode, { announce = true, theme = false } = {}) {
    currentMode = mode;
    if (mode.id !== "remix") { S.mode = mode.id; save(); }
    nebula.setMode(mode);
    if (theme && mode.theme) applyTheme(mode.theme, false);
    document.querySelectorAll(".mode").forEach((b) => { b.classList.toggle("active", b.dataset.mode === mode.id); b.setAttribute("aria-checked", b.dataset.mode === mode.id); });
    if (S.motion !== "auto") nebula.motion = S.motion;
    renderFx();
    if (announce) {
      titleCard(mode.name, mode.desc);
      sound.play("whoosh");
      nebula.fx.shockwave(nebula.U.uA.value, 0, 1.2);
      nebula.rippleAt(new THREE.Vector3(0, 0, 1).applyQuaternion(nebula.globe.spin.getWorldQuaternion(new THREE.Quaternion()).invert()));
    }
  }
  const modesEl = $("#modes");
  MODES.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "mode"; b.dataset.mode = m.id; b.setAttribute("role", "radio");
    b.title = `${m.name} — ${m.desc} (${(i + 1) % 10})`;
    b.innerHTML = `<span class="ico">${m.icon}</span><span class="nm">${m.name}</span>`;
    b.onclick = () => applyMode(m, { theme: true });
    modesEl.appendChild(b);
  });
  const themesEl = $("#themes");
  for (const id of THEME_IDS) {
    const t = THEMES[id], b = document.createElement("button");
    b.className = "swatch"; b.dataset.theme = id; b.title = t.name; b.setAttribute("role", "radio"); b.setAttribute("aria-label", t.name);
    b.style.background = id === "rainbow" ? "conic-gradient(#ff3b6b, #ffd23b, #3bff9d, #3b8bff, #c43bff, #ff3b6b)" : `radial-gradient(circle at 35% 35%, ${t.c}, ${t.a} 40%, ${t.d})`;
    b.onclick = () => applyTheme(id);
    themesEl.appendChild(b);
  }
  const hueBtn = document.createElement("button");
  hueBtn.className = "swatch hue"; hueBtn.textContent = "HUE ⟳"; hueBtn.title = "Hue cycling";
  hueBtn.onclick = () => setSetting("hue", !S.hue);
  themesEl.appendChild(hueBtn);

  const nextTheme = () => applyTheme(THEME_IDS[(THEME_IDS.indexOf(S.theme) + 1) % THEME_IDS.length]);
  const nextMode = () => applyMode(MODES[(MODES.findIndex((m) => m.id === currentMode.id) + 1) % MODES.length], { theme: true });
  const fmt = (n) => n.toLocaleString("en-US");
  const remix = () => {
    const r = remixRecipe();
    r.name = `Animation #${fmt(r.number + 1)}`;
    r.desc = `${r.motion} motion · one of ${fmt(TOTAL_ANIMATIONS)} combinations`;
    applyMode(r, { theme: true });
    if (S.motion !== "auto") nebula.motion = S.motion;
    pill(`✧ ${r.name}`);
  };

  // ---------- Effects grid ----------
  const fxGrid = $("#fx-grid");
  for (const [id, name] of LAYERS) {
    const b = document.createElement("button");
    b.className = "fx"; b.dataset.fx = id; b.textContent = name;
    b.onclick = () => { nebula.setOverride(id, !nebula.layerOn(id)); renderFx(); sound.play("blip"); };
    fxGrid.appendChild(b);
  }
  function renderFx() {
    fxGrid.querySelectorAll(".fx").forEach((b) => {
      b.classList.toggle("on", nebula.layerOn(b.dataset.fx));
      b.classList.toggle("forced", b.dataset.fx in nebula.overrides);
    });
  }

  // ---------- Bursts ----------
  function supernova(origin = new THREE.Vector3(), big = true) {
    const U = nebula.U;
    nebula.fx.burst(origin, big ? 2.6 : 1.1, U.uA.value, U.uD.value, big ? 2 : 1.3);
    if (big) { nebula.fx.burst(origin, 1.6, U.uC.value, new THREE.Color(1, 1, 1), 1.6); nebula.fx.shockwave(U.uD.value, 0, 1); nebula.fx.shockwave(U.uA.value, 1.2, 0.8); }
    nebula.flash = Math.max(nebula.flash, big ? 0.9 : 0.4);
    nebula.pulse = Math.max(nebula.pulse, big ? 1 : 0.5);
    nebula.energyTarget = Math.max(nebula.energyTarget, big ? 0.8 : 0.3);
    sound.play(big ? "boom" : "blip");
  }
  nebula.onPulse = () => supernova(new THREE.Vector3(), !S.reduced);

  // ---------- Settings ----------
  const bind = {
    sensitivity: "#s-sensitivity", smoothing: "#s-smoothing", autoSpin: "#s-autoSpin", style: "#s-style", slowmo: "#s-slowmo",
    autopilot: "#s-autopilot", reduced: "#s-reduced", quality: "#s-quality", density: "#s-density", bloom: "#s-bloom", hue: "#s-hue",
    sparkles: "#s-sparkles", sound: "#s-sound", fps: "#s-fps", motion: "#s-motion", pinch: "#s-pinch", peace: "#s-peace", point: "#s-point", radar: "#s-radar",
  };
  function applySetting(k) {
    const v = S[k];
    switch (k) {
      case "sensitivity": break;
      case "smoothing": gestures.setSmoothing(v); break;
      case "autoSpin": nebula.autoSpin = v; break;
      case "slowmo": nebula.slowmo = v; break;
      case "reduced": nebula.setReduced(v); document.body.classList.toggle("reduced", v); break;
      case "quality": nebula.setQuality(v === "auto" ? autoQuality(nebula.renderer) : v); break;
      case "density": nebula.setDensity(v); break;
      case "bloom": nebula.bloomOn = v; break;
      case "hue": nebula.hueCycle = v; hueBtn.classList.toggle("on", v); break;
      case "sparkles": sparkles.on = v; break;
      case "sound": sound.setOn(v); break;
      case "fps": $("#fps").classList.toggle("hidden", !v); break;
      case "radar": $("#radar").classList.toggle("hidden", !v); break;
      case "autopilot": autopilotClock = 0; break;
      case "motion": if (v !== "auto") nebula.motion = v; else if (currentMode) nebula.setMode(currentMode); break;
    }
    const el = $(bind[k]);
    if (el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v; }
    const out = document.querySelector(`output[data-for="${k}"]`);
    if (out) out.textContent = k === "density" ? `${Math.round(v * 100)}%` : `${Number(v).toFixed(2)}×`;
  }
  function setSetting(k, v) { S[k] = v; save(); applySetting(k); }
  for (const [k, sel] of Object.entries(bind)) {
    const el = $(sel);
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
      setSetting(k, el.type === "checkbox" ? el.checked : el.type === "range" ? parseFloat(el.value) : el.value);
    });
  }
  let autopilotClock = 0;
  for (const k of Object.keys(bind)) applySetting(k);
  applyTheme(S.theme, false);
  nebula.setTheme(S.theme, true);
  applyMode(currentMode, { announce: false });

  // ---------- Panels ----------
  const panels = { settings: $("#settings"), about: $("#about"), help: $("#help") };
  function openPanel(id, force) {
    const el = panels[id], open = force ?? !el.classList.contains("open");
    for (const [k, p] of Object.entries(panels)) if (k !== id && open) { p.classList.remove("open"); p.setAttribute("aria-hidden", "true"); }
    el.classList.toggle("open", open);
    el.setAttribute("aria-hidden", String(!open));
    $("#b-settings").classList.toggle("on", panels.settings.classList.contains("open"));
    if (open) sound.play("blip");
  }
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => openPanel(b.dataset.close, false)));
  for (const m of [panels.about, panels.help]) m.addEventListener("click", (e) => { if (e.target === m) openPanel(m.id, false); });
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".tab-body").forEach((x) => x.classList.toggle("active", x.id === t.dataset.tab));
  }));
  $("#b-defaults").onclick = () => {
    S = { ...DEFAULTS, theme: S.theme, mode: S.mode }; app.settings = S; save();
    for (const k of Object.keys(bind)) applySetting(k);
    toast("Settings restored to defaults");
  };

  // ---------- Buttons ----------
  const setPaused = (p) => { nebula.paused = p; document.body.classList.toggle("paused", p); };
  $("#b-pause").onclick = () => { setPaused(!nebula.paused); pill(nebula.paused ? "⏸ Paused" : "▶ Resumed"); };
  $("#b-reverse").onclick = () => { nebula.reverse(); pill(nebula.dir > 0 ? "⟳ Spin right" : "⟲ Spin left"); sound.play("whoosh"); };
  $("#b-reset").onclick = () => { nebula.reset(); setPaused(false); pill("⌂ View reset"); };
  $("#b-remix").onclick = remix;
  $("#b-burst").onclick = () => supernova();
  $("#b-snap").onclick = snapshot;
  $("#b-settings").onclick = () => openPanel("settings");
  $("#b-about").onclick = () => openPanel("about");
  $("#b-about2").onclick = () => openPanel("about", true);
  $("#b-help").onclick = () => openPanel("help");
  $("#b-full").onclick = fullscreen;
  $("#b-camera").onclick = () => (tracker.running ? stopCamera() : startCamera());

  function snapshot() {
    const url = nebula.snapshot(), a = document.createElement("a");
    a.href = url; a.download = `nebula-blaze-${Date.now()}.png`; a.click();
    nebula.flash = 0.8; pill("📸 Snapshot saved"); sound.play("chime");
  }

  async function fullscreen() {
    if (!canFullscreen()) {
      toast(`Fullscreen is blocked in this frame. <a href="${location.href.split("#")[0]}" target="_blank" rel="noopener">Open Nebula in its own tab</a> and press F.`, 6000);
      return;
    }
    try { await toggleFullscreen(); } catch { toast("The browser refused fullscreen. Press F11 instead."); }
  }
  const onFs = () => { document.body.classList.toggle("fs", isFullscreen()); setTimeout(() => nebula.resize(), 60); };
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);

  // ---------- Camera ----------
  const statusEl = $("#status");
  const setStatus = (state, text) => { statusEl.dataset.state = state; statusEl.querySelector(".txt").textContent = text; };
  tracker.onStatus = (state, detail) => {
    if (state === "ready") setStatus("ready", "Camera ready · show your hand");
    else if (state === "off") setStatus("off", "Manual mode");
    else setStatus(state, detail);
    $("#b-camera").classList.toggle("on", state === "ready");
    $("#loader").classList.toggle("hidden", state !== "loading");
  };
  tracker.onProgress = (pct) => { $("#loader-bar").style.width = `${pct}%`; $("#loader-txt").textContent = `Loading hand model… ${pct}%`; };
  async function startCamera() {
    try {
      await tracker.start();
      toast("Camera on — the picture stays hidden. Move your hand to spin the globe ✋");
      sound.play("chime");
    } catch (err) {
      setStatus("error", err.message);
      toast(`${err.message}. Mouse, touch and keyboard still work. <a href="#" id="retry-cam">Retry</a>`, 7000);
      setTimeout(() => { const r = $("#retry-cam"); if (r) r.onclick = (e) => { e.preventDefault(); startCamera(); }; });
      setTimeout(() => setStatus("off", "Manual mode"), 7000);
    }
  }
  function stopCamera() {
    tracker.stop();
    gestures.reset();
    nebula.handDriving = false;
    toast("Camera stopped");
  }
  addEventListener("pagehide", () => tracker.stop());

  let lastGesture = null;
  tracker.onResult = (lm, t) => {
    const g = gestures.update(lm, t);
    lastGesture = g;
    for (const ev of g.events) onGesture(ev, g);
  };
  const POSE_LABEL = { open: "open palm", fist: "fist", pinch: "pinch", peace: "peace", point: "point", other: "hand", none: "no hand" };
  function runAction(action) {
    if (action === "focus") { nebula.setFocus(!nebula.focus); nebula.setOverride("shield", nebula.focus ? true : null); renderFx(); pill(nebula.focus ? "🔍 Focus mode" : "🔍 Focus off"); }
    else if (action === "burst") supernova();
    else if (action === "shield") { nebula.setOverride("shield", !nebula.layerOn("shield")); renderFx(); pill("🛡 Shield"); }
    else if (action === "mode") nextMode();
    else if (action === "theme") nextTheme();
    else if (action === "remix") remix();
    else if (action === "reverse") { nebula.reverse(); pill(nebula.dir > 0 ? "⟳ Spin right" : "⟲ Spin left"); }
  }
  function onGesture(ev, g) {
    wake();
    if (ev === "found") { setStatus("hand", "Hand detected"); return; }
    if (ev === "lost") { setStatus("ready", "No hand detected"); nebula.handDriving = false; return; }
    if (ev === "fist" && !nebula.paused) { setPaused(true); pill("✊ Paused"); sound.play("blip"); }
    else if (ev === "open" && nebula.paused) { setPaused(false); pill("✋ Resumed"); sound.play("chime"); }
    else if (ev === "pinch") { runAction(S.pinch); sound.play("chime"); }
    else if (ev === "peace") runAction(S.peace);
    else if (ev === "point" && S.point !== "none") runAction(S.point);
  }

  function applyHand(dt) {
    const g = lastGesture;
    if (!g || !tracker.running || !g.present) { nebula.handDriving = false; return; }
    const target = handSpin(g, { style: S.style, sensitivity: S.sensitivity });
    if (target !== null && g.pose !== "fist") {
      nebula.handDriving = true;
      // Ease toward the target and cap acceleration, so the globe glides instead of jerking.
      const step = Math.max(-dt * 6, Math.min(dt * 6, (target - nebula.yawVel) * Math.min(1, dt * 3.5)));
      nebula.yawVel += step;
      if (Math.abs(target) > 0.5) nebula.dir = Math.sign(target);
      if (g.speed > 3) nebula.energyTarget = Math.min(1, Math.max(nebula.energyTarget, (g.speed - 3) / 4));
    } else nebula.handDriving = S.style === "steer";
    const p = handPitch(g, S.sensitivity);
    if (p !== null) nebula.pitchTarget = 0.25 + p;
  }

  // ---------- Pointer / touch ----------
  const stage = $("#stage"), raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pointers = new Map();
  let drag = null, pinchDist = 0;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, vx: 0 };
    stage.classList.add("dragging");
    nebula.handDriving = true;
  });
  stage.addEventListener("pointermove", (e) => {
    wake();
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      nebula.zoomTarget = Math.max(2.2, Math.min(9, nebula.zoomTarget * (pinchDist / d)));
      pinchDist = d;
      return;
    }
    if (!drag) return;
    const now = performance.now(), dt = Math.max(1, now - drag.t) / 1000;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, k = 3.2 / innerHeight;
    nebula.yaw += dx * k; nebula.pitchTarget = Math.max(-1, Math.min(1, nebula.pitchTarget + dy * k));
    drag.vx = drag.vx * 0.6 + ((dx * k) / dt) * 0.4;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    nebula.yawVel = 0;
  });
  const endDrag = (e) => {
    pointers.delete(e.pointerId);
    stage.classList.remove("dragging");
    if (!drag) return;
    if (drag.moved < 6) clickGlobe(e);
    else { nebula.yawVel = Math.max(-10, Math.min(10, drag.vx)); if (Math.abs(drag.vx) > 0.3) nebula.dir = Math.sign(drag.vx); }
    nebula.handDriving = false;
    drag = null;
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("wheel", (e) => { e.preventDefault(); nebula.zoomTarget = Math.max(2.2, Math.min(9, nebula.zoomTarget * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  stage.addEventListener("dblclick", () => supernova());
  function clickGlobe(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, nebula.camera);
    const hit = nebula.globe.pick(raycaster.ray);
    sparkles.pop(e.clientX, e.clientY);
    if (!hit) return;
    nebula.rippleAt(hit.local);
    supernova(hit.world, false);
  }

  // ---------- Keyboard ----------
  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    wake();
    if (k === " ") { e.preventDefault(); $("#b-pause").click(); }
    else if (k === "f") fullscreen();
    else if (k === "r") $("#b-reset").click();
    else if (k === "arrowleft" || k === "arrowright") { e.preventDefault(); nebula.impulse(k === "arrowleft" ? -1.5 : 1.5); }
    else if (k === "arrowup" || k === "arrowdown") { e.preventDefault(); nebula.impulse(0, k === "arrowup" ? -0.15 : 0.15); }
    else if (k === "t") nextTheme();
    else if (k === "m") nextMode();
    else if (k === "x") remix();
    else if (k === "b") supernova();
    else if (k === "p") snapshot();
    else if (k === "c") $("#b-camera").click();
    else if (k === "s") openPanel("settings");
    else if (k === "a") openPanel("about");
    else if (k === "?" || k === "/") openPanel("help");
    else if (k === "h") { document.body.classList.toggle("ui-hidden"); pill(document.body.classList.contains("ui-hidden") ? "UI hidden — press H" : "UI shown"); }
    else if (k === "escape") Object.keys(panels).forEach((id) => openPanel(id, false));
    else if (/^[0-9]$/.test(k)) { const m = MODES[(Number(k) + 9) % 10]; if (m) applyMode(m, { theme: true }); }
  });

  // ---------- Idle UI fade ----------
  let lastActive = performance.now();
  function wake() { lastActive = performance.now(); document.body.classList.remove("ui-idle"); }
  addEventListener("pointermove", wake);

  // ---------- Welcome ----------
  function enter(withCamera) {
    $("#welcome").classList.add("gone");
    document.body.classList.remove("intro");
    sound.play("whoosh");
    setTimeout(() => { titleCard(currentMode.name, currentMode.desc); supernova(new THREE.Vector3(), !S.reduced); }, 350);
    if (withCamera) startCamera();
    else toast("Manual mode: drag to spin, scroll to zoom, click the globe. Turn the camera on any time (C).", 5000);
    setTimeout(() => $("#welcome").remove(), 1200);
  }
  $("#btn-start").onclick = () => enter(true);
  $("#btn-mouse").onclick = () => enter(false);
  if (cameraHint()) $("#btn-start").title = cameraHint();
  document.body.classList.remove("booting");
  document.body.classList.add("intro");
  const params = new URLSearchParams(location.search);
  if (params.has("skip")) enter(false);

  // ---------- Loop ----------
  addEventListener("resize", () => nebula.resize());
  new ResizeObserver(() => nebula.resize()).observe(stage);
  let last = performance.now(), slowSince = 0, uiClock = 0;
  const speedArc = $("#speedo-arc"), speedVal = $("#speedo-val"), speedDir = $("#speedo-dir");
  const radar = $("#radar"), radarDot = $("#radar-dot"), radarPose = $("#radar-pose"), fpsEl = $("#fps");
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    applyHand(dt);
    nebula.update(dt);
    sparkles.tick(dt);

    if (S.autopilot && !nebula.paused) {
      autopilotClock += dt;
      if (autopilotClock > 18) { autopilotClock = 0; Math.random() < 0.3 ? remix() : nextMode(); }
    }
    if (tracker.running && now - lastActive > 4500 && !document.querySelector(".panel.open, .modal.open")) document.body.classList.add("ui-idle");

    uiClock += dt;
    if (uiClock > 0.1) {
      uiClock = 0;
      const rpm = Math.abs(nebula.yawVel * nebula.pauseK) * 60 / (Math.PI * 2);
      speedVal.textContent = rpm.toFixed(rpm < 10 ? 1 : 0);
      speedArc.style.strokeDashoffset = String(226 - Math.min(1, rpm / 40) * 226);
      speedDir.classList.toggle("ccw", nebula.yawVel < 0);
      const g = lastGesture, has = !!(g && g.present && tracker.running);
      radar.classList.toggle("has-hand", has);
      if (has) radarDot.style.transform = `translate(${g.x * 34}px, ${-g.y * 34}px) scale(${g.pose === "pinch" ? 0.6 : g.pose === "fist" ? 1.4 : 1})`;
      radarPose.textContent = has ? POSE_LABEL[g.pose] || "hand" : tracker.running ? "no hand" : "camera off";
      if (S.fps) fpsEl.textContent = `${nebula.stats.fps} FPS · ${nebula.quality}`;
      // Adaptive resolution: if Auto quality runs slow for a few seconds, render fewer pixels.
      if (S.quality === "auto" && nebula.stats.fps < 40) {
        slowSince = slowSince || now;
        if (now - slowSince > 4000 && nebula.renderScale > 0.6) {
          nebula.renderScale = Math.max(0.6, nebula.renderScale - 0.15); nebula.resize(); slowSince = 0;
          toast("Lowered render resolution for smoother motion");
        }
      } else slowSince = 0;
    }
  }
  requestAnimationFrame(frame);
  window.__booted = true;
}

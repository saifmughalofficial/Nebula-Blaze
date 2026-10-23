// Color palettes and animation modes. A mode is a recipe of layer intensities (0..1); the scene
// crossfades every layer toward the recipe, so switching modes never flashes or reloads.

export const THEMES = {
  aurora:    { name: "Aurora",           a: "#22f0d8", b: "#14b8a6", c: "#34d399", d: "#a78bfa", bg1: "#020b14", bg2: "#0b2a3a", deep: "#03141c" },
  cyberpunk: { name: "Cyberpunk",        a: "#ff2bd6", b: "#8b5cf6", c: "#22d3ee", d: "#ff6ad5", bg1: "#0a0214", bg2: "#2a0a3d", deep: "#12041f" },
  solar:     { name: "Solar Flare",      a: "#ffb020", b: "#ff6a2b", c: "#ff5e7a", d: "#ff2bd6", bg1: "#140502", bg2: "#3a1206", deep: "#1c0703" },
  deepspace: { name: "Deep Space",       a: "#7aa2ff", b: "#4f46e5", c: "#e0e7ff", d: "#c4b5fd", bg1: "#02030c", bg2: "#10143a", deep: "#050824" },
  candy:     { name: "Candy Pop",        a: "#ff7ac6", b: "#5ef2c2", c: "#ffe066", d: "#6cc8ff", bg1: "#0d0716", bg2: "#2b1840", deep: "#160c24" },
  mono:      { name: "Monochrome Pulse", a: "#ffffff", b: "#c0c6d0", c: "#8a919e", d: "#e8ecf2", bg1: "#040506", bg2: "#16181c", deep: "#0b0c0f" },
  rainbow:   { name: "Rainbow Rush",     a: "#ff3b6b", b: "#ffd23b", c: "#3bff9d", d: "#3b8bff", bg1: "#05040e", bg2: "#1d1238", deep: "#0a0718", hue: true },
};

export const THEME_IDS = Object.keys(THEMES);

// Every visual layer the scene knows about. Effects panel toggles use the same ids.
export const LAYERS = [
  ["stars", "Starfield"], ["nebula", "Nebula haze"], ["grid", "Glow grid"], ["land", "Continents"],
  ["atmosphere", "Atmosphere"], ["arcs", "Data arcs"], ["nodes", "Pulse nodes"], ["rings", "Energy rings"],
  ["sparks", "Orbit sparks"], ["comets", "Comet trails"], ["aurora", "Aurora curtains"], ["waves", "Wave field"],
  ["planets", "Planets"], ["core", "Quantum core"], ["shield", "Energy shield"], ["blackhole", "Accretion disk"],
  ["galaxy", "Spiral galaxy"], ["warp", "Warp streaks"], ["lightning", "Lightning"], ["dust", "Space dust"],
  ["fireworks", "Fireworks"],
];

const BASE = { stars: 1, nebula: 1, grid: 1, land: 1, atmosphere: 1, nodes: 0.6, dust: 0.6 };

export const MODES = [
  { id: "calm", name: "Calm Orbit", icon: "◯", desc: "Slow, soft and serene", spin: 0.5, theme: "deepspace",
    layers: { ...BASE, sparks: 0.4, nodes: 0.4 } },
  { id: "aurora", name: "Aurora", icon: "≋", desc: "Polar light curtains and waves", spin: 0.8, theme: "aurora",
    layers: { ...BASE, aurora: 1, waves: 1, sparks: 0.5 } },
  { id: "solar", name: "Solar System", icon: "☉", desc: "Planets, orbits and comets", spin: 0.9, theme: "solar",
    layers: { ...BASE, planets: 1, comets: 1, rings: 0.4 } },
  { id: "quantum", name: "Quantum Core", icon: "⚛", desc: "A glowing heart inside a glass world", spin: 1.1, theme: "cyberpunk",
    layers: { ...BASE, core: 1, shield: 1, sparks: 1, land: 0.7, rings: 0.6 }, globeOpacity: 0.35 },
  { id: "storm", name: "Rainbow Storm", icon: "ϟ", desc: "Hue cycling lightning chaos", spin: 1.6, theme: "rainbow", hue: true,
    layers: { ...BASE, lightning: 1, sparks: 1, rings: 1, comets: 0.6, arcs: 0.6, fireworks: 0.6 } },
  { id: "blackhole", name: "Black Hole", icon: "●", desc: "Accretion disk and infalling matter", spin: 1.2, theme: "solar",
    layers: { ...BASE, blackhole: 1, nebula: 0.35, sparks: 0.3, grid: 0.5 }, dark: 1 },
  { id: "supernova", name: "Supernova", icon: "✺", desc: "Shockwaves on the beat", spin: 1.0, theme: "solar", pulse: 3.2,
    layers: { ...BASE, rings: 1, sparks: 0.8, shield: 0.4, fireworks: 1 } },
  { id: "hyperdrive", name: "Hyperdrive", icon: "»", desc: "Light-speed warp tunnel", spin: 2.2, theme: "cyberpunk",
    layers: { ...BASE, warp: 1, comets: 1, sparks: 0.7, dust: 1 } },
  { id: "galaxy", name: "Galaxy Spiral", icon: "✦", desc: "Spiral arms of a living galaxy", spin: 0.8, theme: "deepspace",
    layers: { ...BASE, galaxy: 1, comets: 0.4, nebula: 1 } },
  { id: "datapulse", name: "Data Pulse", icon: "⌗", desc: "Neon data arcs between cities", spin: 0.9, theme: "aurora",
    layers: { ...BASE, arcs: 1, nodes: 1, rings: 0.7, shield: 0.3 } },
];

export const MODE_IDS = MODES.map((m) => m.id);
export const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];

// Globe motion styles layered on top of the spin.
export const MOTIONS = ["steady", "breathe", "sway", "precess", "bounce", "heartbeat", "wobble", "figure8"];

// Every combination is addressable by one number, so the Remix button can name it:
// theme × any subset of 14 extra layers × motion × spin level × hue on/off × pulse on/off.
const EXTRAS = ["arcs", "rings", "sparks", "comets", "aurora", "waves", "planets", "core", "shield",
  "blackhole", "galaxy", "warp", "lightning", "fireworks"];
const SPINS = [0.4, 0.6, 0.8, 1.0, 1.25, 1.5, 1.9, 2.4];
export const TOTAL_ANIMATIONS = THEME_IDS.length * 2 ** EXTRAS.length * MOTIONS.length * SPINS.length * 2 * 2;

/** Decodes animation number n (0 … TOTAL_ANIMATIONS-1) into a mode-like recipe. */
export function animationRecipe(n) {
  n = ((Math.floor(n) % TOTAL_ANIMATIONS) + TOTAL_ANIMATIONS) % TOTAL_ANIMATIONS;
  const take = (k) => { const d = n % k; n = Math.floor(n / k); return d; };
  const theme = THEME_IDS[take(THEME_IDS.length)];
  const mask = take(2 ** EXTRAS.length);
  const motion = MOTIONS[take(MOTIONS.length)];
  const spin = SPINS[take(SPINS.length)];
  const hue = take(2) === 1, pulse = take(2) === 1;
  const layers = { ...BASE };
  EXTRAS.forEach((id, i) => { if (mask & (1 << i)) layers[id] = 0.75 + ((i * 37) % 25) / 100; });
  if (layers.core) layers.land = 0.7;
  return {
    id: "remix", name: "Remix", icon: "✧", desc: "", theme, spin, hue, pulse: pulse ? 3.5 : 0, motion,
    globeOpacity: layers.core ? 0.4 : 1, dark: layers.blackhole ? 0.8 : 0, layers,
  };
}

/** A random but readable remix: 2–5 extras, so the scene never turns to mush. */
export function remixRecipe(rand = Math.random) {
  for (;;) {
    const n = Math.floor(rand() * TOTAL_ANIMATIONS), r = animationRecipe(n);
    const extras = EXTRAS.filter((id) => r.layers[id]).length;
    if (extras >= 2 && extras <= 5) return { ...r, number: n };
  }
}

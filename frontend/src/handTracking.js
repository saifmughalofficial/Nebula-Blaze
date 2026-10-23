// Hidden camera + MediaPipe hand tracking. The video element is never shown: it sits off-screen at
// 1×1 px with opacity 0 purely so the browser keeps decoding frames. Frames stay in this browser.

const DETECT_WIDTH = 320;

export function cameraHint() {
  if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) return null;
  let port = location.port;
  try { port = new URL(new URLSearchParams(location.search).get("streamlitUrl") || location.href).port || port; } catch {}
  const url = `http://localhost${port ? `:${port}` : ""}/`;
  return !window.isSecureContext
    ? `Camera needs https or localhost. On this PC open ${url}`
    : "This browser has no camera support. Try Chrome or Edge.";
}

function friendly(err) {
  const n = err?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError") return "Camera permission was denied";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera found";
  if (n === "NotReadableError" || n === "AbortError") return "Camera is busy in another app";
  return err?.message || "Camera unavailable";
}

export class HandTracker {
  constructor() {
    this.state = "off"; // off | loading | waiting | ready | error
    this.onStatus = null;   // (state, detail) => void
    this.onResult = null;   // (landmarks|null, tMs) => void
    this.onProgress = null; // (pct) => void
    this.video = null; this.stream = null; this.worker = null; this.main = null;
    this.busy = false; this.running = false; this.lastSent = 0; this.fps = 0;
    this._urls = null;
    this._raf = 0;
    document.addEventListener("visibilitychange", () => { if (!document.hidden && this.running) this._loop(); });
  }

  _set(state, detail = "") { this.state = state; this.onStatus?.(state, detail); }

  async start() {
    if (this.running) return;
    const hint = cameraHint();
    if (hint) { this._set("error", hint); throw new Error(hint); }
    try {
      this._set("waiting", "Waiting for camera permission");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: "user" },
      });
    } catch (err) {
      const msg = friendly(err);
      this._set("error", msg);
      throw new Error(msg);
    }
    const v = this.video || document.createElement("video");
    Object.assign(v, { muted: true, playsInline: true, autoplay: true });
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;";
    if (!v.isConnected) document.body.appendChild(v);
    this.video = v;
    v.srcObject = this.stream;
    await v.play().catch(() => {});
    try {
      if (!this.worker && !this.main) {
        this._set("loading", "Loading hand model 0%");
        await this._initEngine();
      }
    } catch (err) {
      this.stop();
      this._set("error", "Hand model failed to load");
      throw err;
    }
    this.running = true;
    this._set("ready", "Camera ready");
    this._loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.busy = false;
    if (this.state !== "error") this._set("off", "Camera off");
  }

  async _download() {
    if (this._urls) return this._urls;
    const base = new URL("../vendor/mediapipe/", import.meta.url).href;
    const files = ["hand_landmarker.task", "wasm/vision_wasm_internal.wasm", "wasm/vision_wasm_internal.js"].map((f) => base + f);
    const loaded = files.map(() => 0), totals = [7.8e6, 9.4e6, 2.1e5];
    const sum = (a) => a.reduce((s, n) => s + n, 0);
    const blobs = await Promise.all(files.map(async (url, i) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed: ${url.split("/").pop()} (${res.status})`);
      const len = Number(res.headers.get("content-length"));
      if (len && !res.headers.get("content-encoding")) totals[i] = len;
      if (!res.body) return res.blob();
      const reader = res.body.getReader(), chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded[i] += value.length;
        this.onProgress?.(Math.min(99, Math.floor((sum(loaded) / sum(totals)) * 100)));
      }
      return new Blob(chunks);
    }));
    const url = (b, type) => URL.createObjectURL(new Blob([b], { type }));
    this._urls = {
      modelUrl: url(blobs[0], "application/octet-stream"),
      fileset: { wasmBinaryPath: url(blobs[1], "application/wasm"), wasmLoaderPath: url(blobs[2], "text/javascript") },
    };
    return this._urls;
  }

  async _initEngine() {
    const urls = await this._download();
    this.onProgress?.(100);
    try {
      this.worker = await new Promise((resolve, reject) => {
        const w = new Worker(new URL("./hand-worker.js", import.meta.url), { type: "module" });
        const timer = setTimeout(() => { w.terminate(); reject(new Error("worker timeout")); }, 30000);
        w.onmessage = ({ data }) => {
          if (data.type === "ready") { clearTimeout(timer); this.delegate = data.delegate; resolve(w); }
          else if (data.type === "error") { clearTimeout(timer); w.terminate(); reject(new Error(data.message)); }
        };
        w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || "worker failed")); };
        w.postMessage({ type: "init", ...urls });
      });
      this.worker.onmessage = ({ data }) => {
        if (data.type !== "result") return;
        this.busy = false;
        this.onResult?.(data.landmarks, performance.now());
      };
    } catch (err) {
      console.warn("Hand worker unavailable, using main thread:", err);
      const { FilesetResolver, HandLandmarker } = await import("../vendor/mediapipe/vision_bundle.mjs");
      this.main = await HandLandmarker.createFromOptions(urls.fileset || await FilesetResolver.forVisionTasks(""), {
        baseOptions: { modelAssetPath: urls.modelUrl, delegate: "CPU" }, runningMode: "VIDEO", numHands: 1,
      });
      this.delegate = "CPU (main thread)";
    }
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      if (!this.running || document.hidden) return;
      this._raf = requestAnimationFrame(tick);
      const v = this.video, now = performance.now();
      if (!v || v.readyState < 2 || this.busy || now - this.lastSent < 30) return;
      this.lastSent = now;
      if (this.worker) {
        this.busy = true;
        const s = Math.min(1, DETECT_WIDTH / (v.videoWidth || DETECT_WIDTH));
        createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * s), resizeHeight: Math.round(v.videoHeight * s), resizeQuality: "low" })
          .then((bitmap) => this.worker.postMessage({ type: "frame", bitmap, ts: Math.round(now) }, [bitmap]))
          .catch(() => { this.busy = false; });
      } else if (this.main) {
        try {
          const r = this.main.detectForVideo(v, Math.round(now));
          this.onResult?.(r.landmarks?.[0] || null, now);
        } catch { /* skip frame */ }
      }
    };
    tick();
  }
}

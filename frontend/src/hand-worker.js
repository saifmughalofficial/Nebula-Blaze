// Runs the MediaPipe Hand Landmarker off the main thread so the 3D scene keeps its frame rate.
import { FilesetResolver, HandLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";

// MediaPipe loads its WASM glue with importScripts(), which module workers lack. Sync XHR is allowed here.
self.importScripts = (...urls) => {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send();
    if (xhr.status !== 200) throw new Error(`Could not load ${url} (${xhr.status})`);
    (0, eval)(xhr.responseText);
  }
};

let landmarker = null;
let delegate = "CPU";
let lastTs = 0;

async function init({ fileset, modelUrl }) {
  const files = fileset || await FilesetResolver.forVisionTasks(new URL("../vendor/mediapipe/wasm", import.meta.url).href);
  const create = (target) => HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: modelUrl, delegate: target },
    runningMode: "VIDEO", numHands: 1,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await create("GPU");
    delegate = "GPU";
    const probe = new OffscreenCanvas(64, 64);
    probe.getContext("2d").fillRect(0, 0, 64, 64);
    landmarker.detectForVideo(probe.transferToImageBitmap(), ++lastTs);
  } catch {
    landmarker?.close?.();
    landmarker = await create("CPU");
    delegate = "CPU";
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try { await init(data); self.postMessage({ type: "ready", delegate }); }
    catch (err) { self.postMessage({ type: "error", message: String(err?.message || err) }); }
    return;
  }
  if (data.type === "frame") {
    lastTs = Math.max(data.ts, lastTs + 1);
    try {
      const r = landmarker.detectForVideo(data.bitmap, lastTs);
      const lm = r.landmarks?.[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) || null;
      self.postMessage({ type: "result", landmarks: lm });
    } catch (err) {
      self.postMessage({ type: "result", landmarks: null, error: String(err?.message || err) });
    } finally {
      data.bitmap.close();
    }
  }
};

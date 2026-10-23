"""Browser checks for Nebula Blaze (Playwright + real Chrome).

    python tests/run_tests.py                       # static server on a free port
    python tests/run_tests.py --url http://localhost:8799   # against the running Streamlit app

Covers gesture logic (synthetic landmarks), every mode and theme, layers, UI panels, credit visibility,
camera-denied fallback and console errors. Screenshots go to tests/out/.
"""
import argparse
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "out"

# Synthetic hands in MediaPipe image coordinates (x right, y down, 0..1).
HAND_JS = """
window.makeHand = (pose, cx = 0.5, cy = 0.55) => {
  const s = 0.18, P = [];
  const set = (i, x, y) => (P[i] = { x: cx + x * s, y: cy + y * s, z: 0 });
  set(0, 0, 0.9);
  const fingers = [[5, 6, 7, 8, -0.45], [9, 10, 11, 12, -0.12], [13, 14, 15, 16, 0.18], [17, 18, 19, 20, 0.45]];
  const ext = { open: [1,1,1,1], fist: [0,0,0,0], peace: [1,1,0,0], point: [1,0,0,0], pinch: [1,1,1,1] }[pose];
  fingers.forEach(([m, p, d, t, x], f) => {
    set(m, x * 0.8, 0.1); set(p, x * 0.85, -0.25);
    if (ext[f]) { set(d, x * 0.9, -0.5); set(t, x * 0.95, -0.75); } else { set(d, x * 0.7, 0.05); set(t, x * 0.6, 0.3); }
  });
  set(1, -0.5, 0.7); set(2, -0.8, 0.45); set(3, -0.95, 0.2); set(4, -1.05, 0.0);
  if (pose === "pinch") { P[8] = { x: cx - 0.4 * s, y: cy - 0.62 * s, z: 0 }; P[4] = { x: cx - 0.43 * s, y: cy - 0.6 * s, z: 0 }; }
  return P;
};
"""


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "frontend"))
    handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url")
    ap.add_argument("--channel", default="chrome")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=args.channel, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1366, "height": 768})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))

        if args.url:
            page.goto(args.url)
            page.wait_for_selector("iframe", timeout=60000)
            frame = None
            for _ in range(120):
                frame = next((f for f in page.frames if "nebula_blaze" in f.url or "index.html" in f.url), None)
                if frame and frame.evaluate("!!window.__booted"):
                    break
                page.wait_for_timeout(500)
            check("streamlit component boots", bool(frame and frame.evaluate("!!window.__booted")))
            box = page.locator("iframe").first.bounding_box()
            check("component fills window", box and box["height"] > 600, str(box))
            page.screenshot(path=str(OUT / "streamlit.png"))
            browser.close()
            return finish(results, errors)

        url = serve()
        page.goto(url)
        page.wait_for_function("window.__booted === true", timeout=30000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "welcome.png"))
        check("welcome visible", page.locator("#welcome").is_visible())
        check("no credit duplicate on welcome", not page.locator("#credit").is_visible())
        page.click("#btn-mouse")
        page.wait_for_timeout(1800)
        check("welcome dismissed", page.locator("#welcome").count() == 0)
        check("credit visible outside fullscreen", page.locator("#credit").inner_text() == "Manufactured by Saif Ur Rehman")
        page.screenshot(path=str(OUT / "main.png"))

        # Gesture engine unit checks.
        page.evaluate("(() => {" + HAND_JS + "})()")
        poses = page.evaluate("""async () => {
          const { classifyPose } = await import('./src/gestures.js');
          return ['open','fist','peace','point','pinch'].map(p => classifyPose(makeHand(p)));
        }""")
        check("pose classifier", poses == ["open", "fist", "peace", "point", "pinch"], str(poses))
        dwell = page.evaluate("""async () => {
          const { GestureEngine } = await import('./src/gestures.js');
          const g = new GestureEngine(); const ev = [];
          for (let t = 0; t < 1000; t += 33) ev.push(...g.update(makeHand('fist'), t).events);
          const one = g.update(makeHand('open'), 1033).events;   // single noisy frame: must not fire
          return { ev, one, pose: g.pose };
        }""")
        check("fist fires once after dwell", dwell["ev"] == ["found", "fist"], str(dwell))
        check("single frame does not trigger", dwell["one"] == [] and dwell["pose"] == "fist")
        jitter = page.evaluate("""async () => {
          const { GestureEngine, handSpin } = await import('./src/gestures.js');
          const g = new GestureEngine(); let maxV = 0, out = 0;
          for (let t = 0; t < 2000; t += 33) { const s = g.update(makeHand('open', 0.5 + (Math.random() - 0.5) * 0.004), t);
            maxV = Math.max(maxV, Math.abs(s.vx)); if (handSpin(s) !== null) out++; }
          return { maxV, out };
        }""")
        check("tremor ignored", jitter["out"] == 0, str(jitter))

        # Drive the live app with a hand moving right then left.
        spin = page.evaluate("""async () => {
          const n = window.nebula, sleep = (ms) => new Promise(r => setTimeout(r, ms));
          n.tracker.running = true;
          const feed = async (x0, x1, ms) => { const t0 = performance.now();
            while (performance.now() - t0 < ms) { const k = (performance.now() - t0) / ms;
              n.tracker.onResult(makeHand('open', x0 + (x1 - x0) * k), performance.now()); await sleep(33); } };
          await feed(0.75, 0.25, 500); const right = n.nebula.yawVel;
          await feed(0.25, 0.75, 500); const left = n.nebula.yawVel;
          for (let i = 0; i < 20; i++) { n.tracker.onResult(makeHand('fist', 0.75), performance.now()); await sleep(33); }
          const paused = n.nebula.paused;
          for (let i = 0; i < 15; i++) { n.tracker.onResult(makeHand('open', 0.75), performance.now()); await sleep(33); }
          const resumed = !n.nebula.paused;
          for (let i = 0; i < 15; i++) { n.tracker.onResult(null, performance.now()); await sleep(33); }
          const idle = !n.nebula.handDriving;
          n.tracker.running = false;
          return { right, left, paused, resumed, idle, dir: n.nebula.dir };
        }""")
        gentle = page.evaluate("""async () => {
          const n = window.nebula, sleep = (ms) => new Promise(r => setTimeout(r, ms));
          n.tracker.running = true; n.gestures.reset(); n.nebula.yawVel = 0.4; let maxV = 0;
          const t0 = performance.now();
          while (performance.now() - t0 < 1000) { const k = (performance.now() - t0) / 1000;
            n.tracker.onResult(makeHand('open', 0.55 - 0.08 * k), performance.now()); maxV = Math.max(maxV, Math.abs(n.nebula.yawVel)); await sleep(33); }
          for (let i = 0; i < 10; i++) { n.tracker.onResult(null, performance.now()); await sleep(33); }
          n.tracker.running = false; return maxV;
        }""")
        check("small slide turns gently", gentle < 1.0, f"max {gentle:.2f} rad/s")
        check("hand moving right spins right", spin["right"] > 0.3, str(spin))
        check("reverse movement reverses spin", spin["left"] < -0.1 and spin["dir"] == -1)
        check("fist pauses, palm resumes", spin["paused"] and spin["resumed"])
        check("no hand → idle", spin["idle"])

        # Every mode and theme renders without errors.
        n_modes = page.locator(".mode").count()
        for i in range(n_modes):
            page.locator(".mode").nth(i).click()
            page.wait_for_timeout(900)
            page.screenshot(path=str(OUT / f"mode-{i:02d}.png"))
        check("10 modes", n_modes == 10)
        for i in range(page.locator(".swatch[data-theme]").count()):
            page.locator(".swatch[data-theme]").nth(i).click()
            page.wait_for_timeout(150)
        check("7 themes", page.locator(".swatch[data-theme]").count() == 7)
        page.keyboard.press("x"); page.wait_for_timeout(600)
        pill_txt = page.locator("#gesture-pill").inner_text()
        check("remix names its animation number", "Animation #" in pill_txt, pill_txt)
        page.keyboard.press("b"); page.wait_for_timeout(600)
        page.mouse.click(683, 384); page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "remix-burst.png"))
        page.keyboard.press("Space"); page.wait_for_timeout(100)
        check("space pauses", page.evaluate("nebula.nebula.paused") is True)
        page.keyboard.press("Space")

        page.click("#b-settings"); page.wait_for_timeout(700)
        page.click(".tab[data-tab='t-fx']"); page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "settings.png"))
        page.locator(".fx[data-fx='lightning']").click()
        check("effects override", page.evaluate("nebula.nebula.layerOn('lightning')"))
        page.click(".tab[data-tab='t-visual']"); page.select_option("#s-quality", "low"); page.wait_for_timeout(300)
        check("quality low", page.evaluate("nebula.nebula.quality") == "low")
        page.select_option("#s-quality", "auto")
        page.keyboard.press("Escape"); page.wait_for_timeout(400)
        page.click("#b-about"); page.wait_for_timeout(600)
        about = page.locator("#about dl").inner_text()
        check("about details", all(s in about for s in ["Manufacturer", "Saif Ur Rehman", "Role", "Student", "Country", "Pakistan"]), about.replace("\n", " | "))
        page.screenshot(path=str(OUT / "about.png"))
        page.keyboard.press("Escape")

        page.evaluate("document.body.classList.add('fs')")
        check("credit hidden in fullscreen", not page.locator("#credit").is_visible())
        page.evaluate("document.body.classList.remove('fs')")

        page.wait_for_timeout(3000)
        fps = page.evaluate("nebula.nebula.stats.fps")
        check("frame rate", fps >= 20, f"{fps} fps, quality {page.evaluate('nebula.nebula.quality')}")

        # Camera denied → manual mode keeps working.
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, permissions=[])
        p2 = ctx.new_page()
        p2.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
        p2.goto(url)
        p2.wait_for_function("window.__booted === true", timeout=30000)
        p2.wait_for_timeout(800)
        p2.screenshot(path=str(OUT / "mobile-welcome.png"))
        p2.click("#btn-start")
        p2.wait_for_timeout(2500)
        state = p2.evaluate("document.querySelector('#status').dataset.state")
        check("camera unavailable handled", state in ("error", "off", "waiting"), state)
        p2.screenshot(path=str(OUT / "mobile.png"))
        sw = p2.evaluate("document.documentElement.scrollWidth")
        check("no horizontal scroll on phone", sw <= 390, str(sw))
        browser.close()
    return finish(results, errors)


def finish(results, errors):
    errs = [e for e in errors if "favicon" not in e and "Permission" not in e and "NotAllowed" not in e]
    if errs:
        print("Console errors:\n  " + "\n  ".join(errs[:15]))
    ok = all(results) and not errs
    print(f"\n{sum(results)}/{len(results)} checks passed, {len(errs)} console errors")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

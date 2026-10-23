# Nebula Blaze: gesture-controlled 3D globe

A fullscreen 3D globe that you steer with your hand. The camera picture and the hand tracking are never shown. Made by **Saif Ur Rehman** (student, Pakistan).

## Run
```
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.port 8799
```
Open http://localhost:8799. You can also double-click `RUN_STREAMLIT.bat`. The camera only works on `localhost` or `https`.

To deploy on Streamlit Community Cloud, push this folder to GitHub and set `app.py` as the main file.

## Features
- **10 animation modes**: Calm Orbit, Aurora, Solar System, Quantum Core, Rainbow Storm, Black Hole, Supernova, Hyperdrive, Galaxy Spiral, Data Pulse. There is also a **Remix** button that picks a random combination, and **Autopilot**, which cycles through the modes.
- **7 themes**, plus hue cycling. You can also turn 20 effect layers on or off yourself.
- **Gestures**:
  - Move your hand to spin the globe. It turns the way your hand moves, and reversing your hand reverses the spin.
  - Move your hand up or down to tilt it.
  - Swipe fast to give it an energy boost.
  - Open palm resumes, hold a fist to pause, pinch for focus mode, and the peace sign changes the theme. Each gesture's action can be changed in Settings.
- **Mouse and touch**: drag to spin (the globe keeps spinning after you let go), use the wheel or pinch to zoom, click the globe for a ripple and burst, and double-click for a supernova.
- **Keyboard**: press `?` to see the shortcuts.
- **Other**: fullscreen, snapshot, optional synthesized sound, and a reduced-motion option. Quality is set automatically, and the resolution drops if the frame rate falls.

## Privacy
Hand tracking (MediaPipe) runs in the browser using model files bundled in `frontend/vendor`. No video is sent to the server. Stopping the camera ends the camera stream.

## Tests
`python tests/run_tests.py` runs 22 checks in Chrome and saves screenshots to `tests/out/`. To check a running Streamlit app, add `--url http://localhost:8799`.

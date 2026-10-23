"""Nebula Blaze - gesture-controlled 3D globe experience.

Manufactured by Saif Ur Rehman (student, Pakistan).

Streamlit entry point. The experience itself is browser-side JavaScript (Three.js + MediaPipe) in
./frontend, served as a full-page Streamlit component. The camera, hand tracking and rendering all
run in the visitor's browser; no video reaches this Python server.

Run locally (Windows):

    python -m pip install -r requirements.txt
    python -m streamlit run app.py --server.port 8799

then open http://localhost:8799 (the camera needs localhost or https).
"""
import ipaddress
import mimetypes
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

FRONTEND = Path(__file__).resolve().parent / "frontend"

# Browsers refuse ES modules / WebAssembly served with the wrong type, and some systems lack these.
for mime, ext in (("text/javascript", ".js"), ("text/javascript", ".mjs"), ("text/css", ".css"),
                  ("application/wasm", ".wasm"), ("font/woff2", ".woff2"), ("application/octet-stream", ".task")):
    mimetypes.add_type(mime, ext)

st.set_page_config(page_title="Nebula Blaze - Gesture 3D Globe", page_icon="🌐", layout="wide",
                   initial_sidebar_state="collapsed")

st.markdown(
    """
    <style>
      #MainMenu, header, footer, [data-testid="stToolbar"], [data-testid="stDecoration"], [data-testid="stStatusWidget"] { display: none !important; }
      .stApp, [data-testid="stAppViewContainer"] { background: #04040c; }
      .block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      iframe { display: block; border: 0; width: 100%; }
    </style>
    """,
    unsafe_allow_html=True,
)


def camera_blocked_host():
    """Return the host name when the visitor opened a plain-http IP address (camera is blocked there)."""
    try:
        headers = st.context.headers
    except Exception:
        return None
    host = (headers.get("Host", "") or "").rsplit(":", 1)[0].strip("[]")
    if not host or host == "localhost" or host.endswith(".localhost"):
        return None
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return None  # a domain name, e.g. *.streamlit.app, served over https
    https = (headers.get("X-Forwarded-Proto", "") or "").lower() == "https"
    return None if ip.is_loopback or https else host


blocked = camera_blocked_host()
if blocked:
    port = st.get_option("server.port")
    st.warning(f"Camera is blocked on http://{blocked}. Browsers only allow it on localhost or https. "
               f"On this PC open http://localhost:{port}.", icon="📷")

nebula = components.declare_component("nebula_blaze", path=str(FRONTEND))
nebula(key="nebula_blaze", default=None)

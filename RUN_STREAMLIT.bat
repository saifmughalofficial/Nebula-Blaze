@echo off
cd /d "%~dp0"
start "" http://localhost:8799
python -m streamlit run app.py --server.port 8799 --server.headless true

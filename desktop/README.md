# Desktop (Windows)

From the project root (`projects/ryza-ai-revive/`):

```powershell
pip install -r desktop/requirements.txt
python desktop/app.py
```

This starts a local HTTP server on `127.0.0.1` (Spine cannot load from `file://`) and opens a 420×860 pywebview window.

Build an exe (onedir, assets stay next to the exe — do not use onefile, `web/` is ~572 MB):

```powershell
powershell -File scripts/build_desktop.ps1
```

Output: `output/desktop/RyzaChat/RyzaChat.exe`

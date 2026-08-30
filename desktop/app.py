# Desktop shell: local HTTP server + pywebview window.
# Spine/fetch cannot use file://, so we always serve from 127.0.0.1.

from __future__ import annotations

import os
import sys
import socket
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

# Reuse the CORS/LLM proxy from scripts/serve.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import serve as ryza_serve  # noqa: E402


def app_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def web_dir() -> Path:
    root = app_root()
    for candidate in (root / "web", Path(sys.executable).resolve().parent / "web",
                      Path(sys.executable).resolve().parent / "_internal" / "web"):
        if (candidate / "index.html").is_file():
            return candidate
    raise FileNotFoundError("web/index.html not found next to the executable or source tree")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 8765))
        return 8765


def pick_port() -> int:
    try:
        return free_port()
    except OSError:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])


def main() -> None:
    wd = web_dir()
    os.chdir(wd)
    ryza_serve.WEB = wd
    providers = app_root() / "config" / "providers.json"
    if providers.is_file():
        ryza_serve.PROVIDERS = providers
    port = pick_port()
    handler = partial(ryza_serve.Handler, directory=str(wd))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    import webview

    url = "http://127.0.0.1:%d/" % port
    webview.create_window(
        "ライザと話す — Ryza Chat",
        url,
        width=420,
        height=860,
        min_size=(360, 640),
        background_color="#07050a",
    )
    webview.start()
    httpd.shutdown()


if __name__ == "__main__":
    main()

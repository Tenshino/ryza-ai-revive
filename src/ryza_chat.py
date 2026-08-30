#encoding: utf-8
"""Ryza chat prototype: modern LLM + cloned-voice TTS, standing in for the
dead `api.craft.spiral-ai-app.com` backend.

Run:  python src/ryza_chat.py
Type a line to talk; `/q` quits, `/e` prints the last emotion tag.
"""
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from persona import SYSTEM_PROMPT, parse_tagged_reply  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "config", "providers.json"), encoding="utf-8"))
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

OUT_DIR = os.path.join(ROOT, "data", "vo")
os.makedirs(OUT_DIR, exist_ok=True)


def post(url, payload, api_key, timeout=180):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "api-key": api_key,
                 "Authorization": "Bearer " + api_key})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s: %s" % (e.code, e.read()[:300].decode("utf-8", "replace")))


def chat(history, user_text):
    llm = CFG["llm"]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += history + [{"role": "user", "content": user_text}]
    r = post(llm["base_url"] + "/chat/completions",
             {"model": llm["model"], "messages": messages,
              "temperature": llm.get("temperature", 0.9), "max_tokens": 400},
             llm["api_key"])
    return r["choices"][0]["message"]["content"]


def speak(text, path):
    """Synthesise with Ryza's cloned voice. Reference audio is her own
    prologue take, shipped inside the APK."""
    tts = CFG["tts"]
    ref = os.path.join(ROOT, tts["reference_audio"])
    b64 = base64.b64encode(open(ref, "rb").read()).decode()
    r = post(tts["base_url"] + "/chat/completions",
             {"model": tts["model_clone"],
              "messages": [{"role": "user", "content": ""},
                           {"role": "assistant", "content": text}],
              "audio": {"format": tts["format"],
                        "voice": "data:audio/wav;base64," + b64}},
             tts["api_key"], timeout=240)
    audio = r["choices"][0]["message"].get("audio") or {}
    if not audio.get("data"):
        raise RuntimeError("no audio returned")
    raw = base64.b64decode(audio["data"])
    open(path, "wb").write(raw)
    return path


def play(path):
    try:
        import winsound
        winsound.PlaySound(path, winsound.SND_FILENAME)
    except Exception as e:  # non-Windows, or no audio device
        print("  [audio saved: %s] (%s)" % (path, e))


def main():
    history = []
    print("Ryza chat prototype — /q to quit\n")
    while True:
        try:
            user = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user:
            continue
        if user in ("/q", "/quit"):
            break

        emotion, attitude, line = parse_tagged_reply(chat(history, user))
        history += [{"role": "user", "content": user},
                    {"role": "assistant", "content": line}]
        history = history[-20:]
        print("ryza[%s/%s]> %s" % (emotion, attitude, line))

        wav = os.path.join(OUT_DIR, "reply_%d.wav" % (len(history) // 2))
        try:
            play(speak(line, wav))
            print("  (voice -> %s)" % os.path.relpath(wav, ROOT))
        except Exception as e:
            print("  [tts failed: %s]" % e)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Prepare and transcribe the bundled Japanese voice clips without touching originals."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "training" / "ryza-jp"
LOCAL_MODEL = ROOT / ".asr-tools" / "models" / "whisper-large-v3-turbo"
DEFAULT_MODEL = str(LOCAL_MODEL if LOCAL_MODEL.is_dir() else "openai/whisper-large-v3-turbo")


def ffmpeg_path() -> Path:
    local_python = ROOT / ".asr-tools" / "python"
    if local_python.is_dir():
        sys.path.insert(0, str(local_python))
    try:
        import imageio_ffmpeg

        return Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception as error:
        raise RuntimeError(
            "workspace FFmpeg is unavailable; run: "
            "python -m pip install --target .asr-tools/python imageio-ffmpeg"
        ) from error


def source_records() -> list[dict]:
    records: list[dict] = []
    prologue = ROOT / "web" / "assets" / "audio" / "prologue" / "jp"
    for source in sorted(prologue.glob("*.m4a")):
        records.append({
            "id": f"normal__prologue__{source.stem}",
            "source": source,
            "source_rel": Path("prologue") / source.name,
            "style": "normal",
            "category": "prologue",
            "period": "",
        })

    alarm = ROOT / "web" / "assets" / "audio" / "alarm" / "ja"
    for source in sorted(alarm.rglob("*.m4a")):
        rel = source.relative_to(alarm)
        if len(rel.parts) != 4:
            raise RuntimeError(f"unexpected alarm path: {source}")
        style, category, period, filename = rel.parts
        records.append({
            "id": f"{style}__{category}__{period}__{Path(filename).stem.zfill(2)}",
            "source": source,
            "source_rel": Path("alarm") / rel,
            "style": style,
            "category": category,
            "period": period,
        })
    return records


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as audio:
        return audio.getnframes() / float(audio.getframerate())


def prepare(output: Path) -> list[dict]:
    ffmpeg = ffmpeg_path()
    source_root = output / "source"
    wav_root = output / "wavs"
    source_root.mkdir(parents=True, exist_ok=True)
    wav_root.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    records = source_records()
    for index, record in enumerate(records, 1):
        copied = source_root / record["source_rel"]
        wav_file = wav_root / f"{record['id']}.wav"
        copied.parent.mkdir(parents=True, exist_ok=True)
        if not copied.exists() or copied.stat().st_size != record["source"].stat().st_size:
            shutil.copy2(record["source"], copied)
        if not wav_file.exists() or wav_file.stat().st_size < 44:
            subprocess.run([
                str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(copied), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le",
                str(wav_file),
            ], check=True)
        manifest.append({
            "id": record["id"],
            "source": copied.relative_to(output).as_posix(),
            "wav": wav_file.relative_to(output).as_posix(),
            "style": record["style"],
            "category": record["category"],
            "period": record["period"],
            "duration_seconds": round(wav_duration(wav_file), 3),
        })
        if index % 25 == 0 or index == len(records):
            print(f"prepared {index}/{len(records)}", flush=True)

    manifest_path = output / "manifest.jsonl"
    temp = manifest_path.with_suffix(".jsonl.tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        for record in manifest:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    temp.replace(manifest_path)
    return manifest


def decode_16k(ffmpeg: Path, path: Path):
    import numpy as np

    result = subprocess.run([
        str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1",
    ], check=True, stdout=subprocess.PIPE)
    return np.frombuffer(result.stdout, dtype=np.float32).copy()


def load_transcripts(path: Path) -> dict[str, dict]:
    found: dict[str, dict] = {}
    if not path.exists():
        return found
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                item = json.loads(line)
                if item.get("id"):
                    found[item["id"]] = item
            except (ValueError, TypeError):
                continue
    return found


def write_review_files(output: Path, manifest: list[dict], transcripts: dict[str, dict]) -> None:
    text_counts: dict[str, int] = {}
    for transcript in transcripts.values():
        text = str(transcript.get("text", "")).strip()
        if text:
            text_counts[text] = text_counts.get(text, 0) + 1

    flagged: list[dict] = []
    review_path = output / "review.tsv"
    with review_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["id", "style", "category", "period", "duration_seconds", "wav", "text", "status", "quality_flags"])
        for item in manifest:
            transcript = transcripts.get(item["id"], {})
            text = str(transcript.get("text", "")).strip()
            flags: list[str] = []
            if not text:
                flags.append("empty")
            if text and not re.search(r"[\u3040-\u30ff]", text):
                flags.append("no_kana")
            if re.search(r"(.{2,})\1\1\1", text):
                flags.append("repetition")
            if item["duration_seconds"] < 2:
                flags.append("short_audio")
            if item["duration_seconds"] > 14:
                flags.append("long_audio")
            if item["duration_seconds"] and len(text) / item["duration_seconds"] > 14:
                flags.append("high_char_rate")
            if text_counts.get(text, 0) > 1:
                flags.append(f"duplicate_x{text_counts[text]}")
            if flags:
                flagged.append({"id": item["id"], "flags": flags, "text": text})
            writer.writerow([
                item["id"], item["style"], item["category"], item["period"],
                item["duration_seconds"], item["wav"], text,
                transcript.get("status", "missing"), ",".join(flags),
            ])

    (output / "quality_flags.json").write_text(
        json.dumps(flagged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    auto_list = output / "dataset.auto.list"
    with auto_list.open("w", encoding="utf-8", newline="\n") as handle:
        for item in manifest:
            text = str(transcripts.get(item["id"], {}).get("text", "")).replace("|", "｜").strip()
            if text:
                handle.write(f"{item['wav']}|ryza|JP|{text}\n")


def transcribe(output: Path, model_id: str, batch_size: int) -> None:
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    manifest_path = output / "manifest.jsonl"
    if not manifest_path.exists():
        raise RuntimeError("manifest is missing; run --prepare first")
    manifest = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line]
    transcript_path = output / "transcripts.auto.jsonl"
    transcripts = load_transcripts(transcript_path)
    pending = [item for item in manifest if item["id"] not in transcripts]
    print(f"ASR model={model_id} completed={len(transcripts)} pending={len(pending)}", flush=True)
    if not pending:
        write_review_files(output, manifest, transcripts)
        return

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_id, dtype=dtype, use_safetensors=True
    ).to(device)
    model.eval()
    ffmpeg = ffmpeg_path()

    with transcript_path.open("a", encoding="utf-8", newline="\n", buffering=1) as handle:
        for start in range(0, len(pending), batch_size):
            batch = pending[start:start + batch_size]
            audio = [decode_16k(ffmpeg, output / item["wav"]) for item in batch]
            inputs = processor(
                audio, sampling_rate=16000, return_tensors="pt", return_attention_mask=True
            )
            features = inputs.input_features.to(device=device, dtype=dtype)
            attention = inputs.attention_mask.to(device=device)
            with torch.inference_mode():
                tokens = model.generate(
                    features, attention_mask=attention, language="ja",
                    task="transcribe", max_length=160
                )
            texts = processor.batch_decode(
                tokens, skip_special_tokens=True, clean_up_tokenization_spaces=False
            )
            for item, text in zip(batch, texts):
                text = " ".join(str(text).strip().split())
                row = {
                    "id": item["id"],
                    "text": text,
                    "language": "ja",
                    "style": item["style"],
                    "status": "needs_review",
                    "model": model_id,
                }
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                transcripts[item["id"]] = row
            done = len(transcripts)
            print(f"transcribed {done}/{len(manifest)}", flush=True)

    write_review_files(output, manifest, transcripts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--transcribe", action="store_true")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=6)
    args = parser.parse_args()
    if not args.prepare and not args.transcribe:
        args.prepare = args.transcribe = True
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.prepare:
        prepare(output)
    if args.transcribe:
        transcribe(output, args.model, max(1, args.batch_size))


if __name__ == "__main__":
    main()

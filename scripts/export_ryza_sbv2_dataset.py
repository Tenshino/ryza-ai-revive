#!/usr/bin/env python3
"""Export approved Ryza Japanese rows into Style-Bert-VITS2 Data layout."""

from __future__ import annotations

import argparse
import csv
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "training" / "ryza-jp"
DEFAULT_OUTPUT = ROOT / "training" / "ryza-jp" / "sbv2-export" / "Data" / "ryza"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--speaker", default="ryza")
    parser.add_argument("--allow-needs-review", action="store_true")
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    combined = source / "review.tsv"
    split = [source / "review-normal.tsv", source / "review-whisper.tsv"]
    review_files = [combined] if combined.exists() else [path for path in split if path.exists()]
    if not review_files:
        raise SystemExit(f"missing review.tsv or split review sheets under: {source}")

    rows: list[dict[str, str]] = []
    for review in review_files:
        with review.open("r", encoding="utf-8-sig", newline="") as handle:
            rows.extend(csv.DictReader(handle, delimiter="\t"))
    if not rows:
        raise SystemExit("review sheets are empty")
    ids = [str(row.get("id", "")).strip() for row in rows]
    duplicates = sorted({item_id for item_id in ids if ids.count(item_id) > 1})
    if duplicates:
        raise SystemExit("duplicate IDs across review sheets: " + ", ".join(duplicates))

    accepted = {"approved"}
    if args.allow_needs_review:
        accepted.add("needs_review")
    selected = [row for row in rows if row.get("status", "").strip().lower() in accepted]
    if not selected:
        raise SystemExit(
            "no approved rows; listen and change each review sheet status to approved "
            "(or use --allow-needs-review only for a disposable trial)"
        )

    staging = output.with_name(output.name + ".tmp")
    if staging.exists():
        shutil.rmtree(staging)
    raw = staging / "raw"
    raw.mkdir(parents=True)
    esd: list[str] = []
    style_counts: dict[str, int] = {}

    for row in selected:
        text = str(row.get("text", "")).replace("|", "｜").strip()
        style = str(row.get("style", "normal")).strip().lower()
        item_id = str(row.get("id", "")).strip()
        if not item_id or not text or style not in {"normal", "whisper"}:
            raise SystemExit(f"invalid approved row: {item_id or '<missing id>'}")
        wav_source = (source / row["wav"]).resolve()
        if source not in wav_source.parents or not wav_source.is_file():
            raise SystemExit(f"missing or unsafe WAV path for {item_id}: {wav_source}")
        relative = Path(style) / f"{item_id}.wav"
        target = raw / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(wav_source, target)
        esd.append(f"{relative.as_posix()}|{args.speaker}|JP|{text}")
        style_counts[style] = style_counts.get(style, 0) + 1

    (staging / "esd.list").write_text("\n".join(esd) + "\n", encoding="utf-8")
    if output.exists():
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging.replace(output)
    counts = ", ".join(f"{name}={count}" for name, count in sorted(style_counts.items()))
    print(f"exported {len(selected)} approved rows ({counts}) to {output}")


if __name__ == "__main__":
    main()

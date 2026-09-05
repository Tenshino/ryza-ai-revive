#!/usr/bin/env python3
"""Package an official Style-Bert-VITS2 JP-Extra ONNX model for Ryza Chat."""

from __future__ import annotations

import argparse
import io
import json
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL_PYTHON = ROOT / ".asr-tools" / "python"
if LOCAL_PYTHON.is_dir():
    sys.path.insert(0, str(LOCAL_PYTHON))

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx", type=Path, required=True)
    parser.add_argument("--styles", type=Path, required=True, help="style_vectors.npy")
    parser.add_argument("--config", type=Path, help="optional Style-Bert-VITS2 config.json")
    parser.add_argument("--output", type=Path, required=True, help="output .sbv2 path")
    args = parser.parse_args()

    onnx = args.onnx.resolve()
    styles_path = args.styles.resolve()
    output = args.output.resolve()
    if not onnx.is_file() or onnx.suffix.lower() != ".onnx":
        raise SystemExit(f"missing ONNX model: {onnx}")
    if not styles_path.is_file():
        raise SystemExit(f"missing style vectors: {styles_path}")
    if output.suffix.lower() != ".sbv2":
        raise SystemExit("output must end in .sbv2")

    styles = np.load(styles_path, allow_pickle=False)
    if styles.ndim != 2 or styles.shape[0] < 1 or styles.shape[1] < 1:
        raise SystemExit(f"unexpected style vector shape: {styles.shape}")
    style_json = json.dumps(
        {"data": styles.tolist(), "shape": list(styles.shape)},
        ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")

    style_map = None
    if args.config:
        config = json.loads(args.config.read_text(encoding="utf-8"))
        style_map = config.get("data", {}).get("style2id")
        if style_map and len(style_map) != styles.shape[0]:
            raise SystemExit(
                f"config has {len(style_map)} styles but vectors have {styles.shape[0]} rows"
            )

    tar_bytes = io.BytesIO()
    with tarfile.open(fileobj=tar_bytes, mode="w") as archive:
        for name, data in (
            ("version.txt", b"1"),
            ("model.onnx", onnx.read_bytes()),
            ("style_vectors.json", style_json),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))

    try:
        import zstandard
    except ImportError as error:
        raise SystemExit(
            "zstandard is missing; run: python -m pip install --target .asr-tools/python zstandard"
        ) from error
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(output.suffix + ".tmp")
    compressor = zstandard.ZstdCompressor(level=19, threads=-1)
    temp.write_bytes(compressor.compress(tar_bytes.getvalue()))
    temp.replace(output)
    print(f"wrote {output} ({output.stat().st_size} bytes), vector shape={styles.shape}")
    if style_map:
        print("style IDs: " + ", ".join(f"{name}={value}" for name, value in style_map.items()))


if __name__ == "__main__":
    main()

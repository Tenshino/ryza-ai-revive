#!/usr/bin/env python3
"""Add ABI native libraries and third-party notices to an existing APK."""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: pack_apk_native.py <apk> <jniLibs-dir> <notices>", file=sys.stderr)
        return 2
    apk, jni_root, notices = map(Path, sys.argv[1:])
    license_dir = notices.parent / "native" / "ryza-tts" / "licenses"
    libraries = sorted(jni_root.glob("*/*.so"))
    if not libraries:
        print(f"no native libraries under {jni_root}", file=sys.stderr)
        return 1
    required = {"libryza_tts.so", "libc++_shared.so"}
    names = {item.name for item in libraries}
    missing = required - names
    if missing:
        print("missing native libraries: " + ", ".join(sorted(missing)), file=sys.stderr)
        return 1
    with zipfile.ZipFile(apk, "a") as archive:
        for library in libraries:
            abi = library.parent.name
            arcname = f"lib/{abi}/{library.name}"
            info = zipfile.ZipInfo.from_file(library, arcname)
            info.compress_type = zipfile.ZIP_STORED
            with library.open("rb") as source, archive.open(info, "w") as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
        archive.write(notices, "assets/licenses/THIRD_PARTY_NOTICES.md", zipfile.ZIP_DEFLATED)
        for license_file in sorted(license_dir.glob("*")):
            if license_file.is_file():
                archive.write(license_file, f"assets/licenses/{license_file.name}", zipfile.ZIP_DEFLATED)
    print("packed native libraries: " + ", ".join(item.name for item in libraries))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Third-Party Notices

Ryza Chat's optional embedded Style-Bert-VITS2 runtime uses the following independently licensed components. Model files are not bundled and have their own licenses.

## sbv2_core

Source: https://github.com/shadow01a/sbv2-api
Pinned revision: `ffb0b591e55d82091c4db210772c069859be99e9`
License: MIT
Copyright (c) 2024 tuna2134
Copyright (c) 2025- neodyland

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to inclusion of the copyright and permission notice. The software is provided "AS IS", without warranty of any kind.

## esaxx-rs

Source: https://github.com/Narsil/esaxx-rs
Version: 0.1.10
License: Apache License 2.0
Copyright: Nicolas Patry and contributors

The vendored copy comes from the canonical `sbv2-api` dependency tree and omits forced static CRT linkage so it can link with ONNX Runtime on Windows. The complete Apache License 2.0 text is retained at `native/ryza-tts/patches/esaxx-rs/LICENSE`.

## jpreprocess and NAIST-JDIC

Source: https://github.com/jpreprocess/jpreprocess
Version: 0.13.2
License: BSD-3-Clause

Japanese text preprocessing includes work derived from Open JTalk and the NAIST Japanese dictionary. The required copyright statements and redistribution conditions are reproduced in `native/ryza-tts/licenses/jpreprocess-naist-jdic-NOTICE.txt` and are included in packaged native runtime notices.

## ONNX Runtime

Source: https://github.com/microsoft/onnxruntime
License: MIT
Copyright (c) Microsoft Corporation

The native runtime is downloaded by the Rust `ort` dependency during a native build and linked into the optional TTS host. Platform support libraries required by that build are redistributed beside the host. It is provided "AS IS", without warranty of any kind.

## Microsoft Visual C++ Runtime

Windows builds redistribute the Visual C++ 2022 x64 runtime DLLs permitted by the Microsoft Visual Studio license terms. These files are unmodified and are staged from the installed Visual Studio Build Tools redistributable directory.

## LingChat relationship

LingChat (https://github.com/SlimeBoyOwO/LingChat) was inspected to identify its current engine choice and compatible model layout. LingChat application code is AGPL-3.0 and is not copied or linked into this implementation. This host independently integrates the MIT-licensed `sbv2_core` dependency used by LingChat.

## Models and voices

DeBERTa ONNX files, tokenizer data, Style-Bert-VITS2 voice models, voice clones, and generated audio are not covered by the notices above. Users must verify and comply with each selected model's license and any voice, likeness, or dataset rights before importing or distributing it.

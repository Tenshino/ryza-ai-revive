# Ryza Japanese voice dataset workspace

This directory is generated from the project's bundled Japanese clips. The
original files under `web/assets/audio` are never modified.

## Inventory

- 329 archived M4A source clips (unchanged and recoverable)
- 308 curated mono 44.1 kHz PCM WAV training files
- `normal`: 156 approved prologue/normal alarm lines
- `whisper`: 152 approved whisper alarm lines
- 39.05 minutes curated total; 21 short/ringtone/repeated samples removed

## Files

- `manifest.jsonl`: stable IDs, source/WAV paths, style/category, and duration.
- `transcripts.auto.jsonl`: resumable Whisper output. Every row is marked
  `needs_review`; it is not ground truth.
- `review-normal.tsv` / `review-whisper.tsv`: manually split UTF-8 BOM review
  sheets, including repetition, character-rate, and duplicate flags.
- `quality_flags.json`: retained duplicate-text hints for valid normal/whisper pairs.
- `removed-samples.json`: audit of the 21 excluded short/ringtone samples.
- `dataset.auto.list`: stale pre-split ASR draft kept only for provenance. It
  still references 329 old `wavs/` paths; do not train from this file. Use the
  approved-row exporter to generate the authoritative `esd.list`.

Audio copies and automatic transcripts are gitignored. Do not distribute them
or a derived voice model unless you hold the necessary game-audio, character,
and performer voice rights.

## Re-run or resume

```powershell
python scripts/prepare_ryza_jp_dataset.py --prepare
$env:HF_HOME = (Resolve-Path .asr-tools).Path + '\huggingface'
python scripts/prepare_ryza_jp_dataset.py --transcribe --batch-size 6
```

The transcription command skips IDs already present in
`transcripts.auto.jsonl`. Before training, listen to every row, correct the
Japanese text in both review TSV files, and change its status to `approved` or `exclude`.
Remove clips with music/noise/other speakers. Then export only approved rows:

```powershell
python scripts/export_ryza_sbv2_dataset.py
```

The result is `sbv2-export/Data/ryza/raw/{normal,whisper}` plus the official
relative-path `esd.list`. `--allow-needs-review` exists only for a disposable
pipeline test; do not use that output for the final voice model.

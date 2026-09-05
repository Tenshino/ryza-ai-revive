# Train a Ryza JP-Extra model for the embedded engine

The application contains inference only. Training runs in the official
Style-Bert-VITS2 environment, then its ONNX output is imported into Ryza Chat.

## 1. Review the transcripts

Open `review-normal.tsv` and `review-whisper.tsv` as UTF-8 in a spreadsheet. For every row:

1. Play the relative file in the `wav` column.
2. Correct `text` to exactly what is spoken. Do not paraphrase.
3. Set `status` to `approved`, or `exclude` for ringing, music, another speaker,
   unusable noise, bad cuts, or an uncertain transcript.
4. Inspect rows with `quality_flags` first. Flags are review hints, not automatic
   rejection; repeated text can be valid when delivery differs.

The curated set has already removed short and ringtone-like samples. Its current
range is 2.344-13.722 seconds, within the official trainer's recommended 2-14
second range.

## 2. Export the approved rows

From the Ryza Chat repository:

```powershell
python scripts/export_ryza_sbv2_dataset.py
```

This creates:

```text
training/ryza-jp/sbv2-export/Data/ryza/
  esd.list
  raw/
    normal/*.wav
    whisper/*.wav
```

The exporter refuses to continue while no rows are approved. The option
`--allow-needs-review` is only for a disposable pipeline test.

## 3. Install the official trainer

Use the latest GPU package from:

https://github.com/litagin02/Style-Bert-VITS2/releases/latest/download/sbv2.zip

Extract it to an ASCII path without spaces, for example `X:\SBV2-Train`.
Do not put it under this repository's path because that path contains non-ASCII
characters. Run `Install-Style-Bert-VITS2.bat`. The CPU installer cannot train.

Find the installed directory containing `App.bat`, `Train.bat`,
`preprocess_all.py`, and `train_ms_jp_extra.py`. Copy the exported `ryza`
directory into its `Data` directory, producing `Data/ryza/esd.list` and
`Data/ryza/raw/...`.

## 4. Preprocess and train

### Web UI

Run `Train.bat`, enter model name `ryza`, select JP-Extra, and use these initial
settings for the RTX 4070 SUPER 12 GB:

- batch size: `2`
- epochs: `30`
- save every steps: `500`
- validation items per language: `5`
- preprocessing processes: `4`
- normalize audio: off initially
- trim silence: off initially
- custom batch sampler: enabled/default
- freeze style/decoder/Japanese BERT: off

Run automatic preprocessing, then start training. Close other GPU-heavy apps.
Batch 3 may fit after confirming VRAM use; batch 4 is too close to the 12 GB
card limit.

### Equivalent CLI

In the official trainer's activated environment:

```powershell
python preprocess_all.py -m ryza --use_jp_extra -b 2 -e 30 -s 500 --num_processes 4 --val_per_lang 5
python train_ms_jp_extra.py
```

Training outputs appear under `model_assets/ryza`. Keep `config.json`,
`style_vectors.npy`, and all useful `.safetensors` checkpoints. Do not assume
the last checkpoint is best: compare several saved steps in `Editor.bat` with
sentences not present in the dataset.

For another 20-30 epochs, update the epoch target in `Data/ryza/config.json`,
then resume with `train_ms_jp_extra.py --skip_default_style` so existing style
vectors are not overwritten.

## 5. Export ONNX

Run `ConvertONNX.bat` and select the chosen `.safetensors` checkpoint, or run:

```powershell
python convert_onnx.py --model "model_assets\ryza\<chosen-checkpoint>.safetensors"
```

The optimized `<chosen-checkpoint>.onnx` is written next to the checkpoint.

## 6. Package and import

From the Ryza Chat repository:

```powershell
python scripts/package_sbv2_model.py `
  --onnx "X:\SBV2-Train\Style-Bert-VITS2\model_assets\ryza\<chosen-checkpoint>.onnx" `
  --styles "X:\SBV2-Train\Style-Bert-VITS2\model_assets\ryza\style_vectors.npy" `
  --config "X:\SBV2-Train\Style-Bert-VITS2\model_assets\ryza\config.json" `
  --output "training\ryza-jp\ryza.sbv2"
```

The command prints the numeric style map. With the expected directory layout it
is normally `Neutral=0`, `normal=1`, `whisper=2`; trust the printed map rather
than assuming these numbers.

In Ryza Chat settings:

1. Keep the already-installed DeBERTa ONNX and tokenizer.
2. Set voice ID to `ryza`.
3. Import `training/ryza-jp/ryza.sbv2` as the SBV2 voice.
4. Set speaker ID to `0`.
5. Select the printed style ID (`normal` or `whisper`).
6. Start with SDP ratio `0.2`, length scale `1.0`, style weight `1.0`.
7. Test Japanese speech, then test a normal translated chat reply.

Alternatively, import the ONNX file and a JSON style file separately. The
`.sbv2` package is simpler and keeps them together.

## Rights

Keep the dataset and derived model private unless you have permission to
redistribute the game audio, character voice, and performer-derived model.

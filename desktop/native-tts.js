'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_RESPONSE_CHARS = 24 * 1024 * 1024;
const MAX_TEXT_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 180000;

class NativeTtsHost {
  constructor(app, dialog) {
    this.app = app;
    this.dialog = dialog;
    this.child = null;
    this.stdout = '';
    this.pending = new Map();
    this.nextId = 1;
  }

  dataRoot() {
    return this.app.getPath('userData');
  }

  modelRoot() {
    return path.join(this.dataRoot(), 'models', 'tts-local');
  }

  executablePath() {
    return this.app.isPackaged
      ? path.join(process.resourcesPath, 'tts', 'ryza-tts.exe')
      : path.join(__dirname, '..', 'native', 'ryza-tts', 'dist', 'windows', 'ryza-tts.exe');
  }

  validateVoiceId(value) {
    const id = String(value || 'ryza');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw coded('INVALID_REQUEST', 'invalid voice id');
    return id;
  }

  voiceDir(voiceId) {
    return path.join(this.modelRoot(), 'voices', this.validateVoiceId(voiceId));
  }

  status(voiceId) {
    const id = this.validateVoiceId(voiceId);
    const debertaDir = path.join(this.modelRoot(), 'assets', 'deberta');
    const voiceDir = this.voiceDir(id);
    const sidecar = this.executablePath();
    return {
      runtimeAvailable: fs.existsSync(sidecar),
      debertaInstalled: fs.existsSync(path.join(debertaDir, 'deberta.onnx')) &&
        fs.existsSync(path.join(debertaDir, 'tokenizer.json')),
      voiceInstalled: fs.existsSync(path.join(voiceDir, 'model.sbv2')) ||
        (fs.existsSync(path.join(voiceDir, 'model.onnx')) &&
         fs.existsSync(path.join(voiceDir, 'style_vectors.json'))),
      ready: !!(this.child && !this.child.killed),
      modelRoot: this.modelRoot()
    };
  }

  async install(win, kind, voiceId) {
    const id = this.validateVoiceId(voiceId);
    const spec = {
      deberta: { extensions: ['onnx'], target: path.join(this.modelRoot(), 'assets', 'deberta', 'deberta.onnx') },
      tokenizer: { extensions: ['json'], target: path.join(this.modelRoot(), 'assets', 'deberta', 'tokenizer.json') },
      voice: { extensions: ['sbv2'], target: path.join(this.voiceDir(id), 'model.sbv2') },
      voiceOnnx: { extensions: ['onnx'], target: path.join(this.voiceDir(id), 'model.onnx') },
      styleVectors: { extensions: ['json'], target: path.join(this.voiceDir(id), 'style_vectors.json') }
    }[kind];
    if (!spec) throw coded('INVALID_REQUEST', 'unknown model asset kind');
    const picked = await this.dialog.showOpenDialog(win, {
      title: 'Import local TTS model',
      properties: ['openFile'],
      filters: [{ name: 'Model asset', extensions: spec.extensions }]
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, status: this.status(id) };
    const source = picked.filePaths[0];
    const info = await fs.promises.stat(source);
    if (!info.isFile() || info.size <= 0 || info.size > 2 * 1024 * 1024 * 1024) {
      throw coded('INVALID_ASSET', 'model asset must be a non-empty file under 2 GiB');
    }
    await fs.promises.mkdir(path.dirname(spec.target), { recursive: true });
    const temp = spec.target + '.importing';
    await fs.promises.copyFile(source, temp);
    try {
      // libuv uses replace-existing rename semantics on Windows. If it fails,
      // preserve the current model and remove only the staged copy.
      await fs.promises.rename(temp, spec.target);
    } catch (error) {
      await fs.promises.rm(temp, { force: true });
      throw error;
    }
    this.reset();
    return { canceled: false, status: this.status(id) };
  }

  openModelFolder() {
    fs.mkdirSync(this.modelRoot(), { recursive: true });
    return this.modelRoot();
  }

  validateSynthesis(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw coded('INVALID_REQUEST', 'request must be an object');
    const text = String(input.text || '');
    if (!text || Array.from(text).length > MAX_TEXT_CHARS) throw coded('INVALID_REQUEST', 'text must contain 1 to 4000 characters');
    const number = (name, fallback, min, max, integer) => {
      const raw = input[name] == null ? fallback : Number(input[name]);
      if (!Number.isFinite(raw) || raw < min || raw > max || (integer && !Number.isInteger(raw))) {
        throw coded('INVALID_REQUEST', 'invalid ' + name);
      }
      return raw;
    };
    return {
      action: 'synthesize',
      dataRoot: this.dataRoot(),
      voiceId: this.validateVoiceId(input.voiceId),
      text,
      styleId: number('styleId', 0, 0, 1000, true),
      speakerId: number('speakerId', 0, 0, 1000, true),
      sdpRatio: number('sdpRatio', 0, 0, 1, false),
      lengthScale: number('lengthScale', 1, 0.25, 4, false),
      styleWeight: number('styleWeight', 1, 0, 4, false)
    };
  }

  async synthesize(input) {
    const request = this.validateSynthesis(input);
    const result = await this.send(request);
    const audio = Buffer.from(String(result.audioBase64 || ''), 'base64');
    validateWav(audio);
    if (audio.length > 16 * 1024 * 1024) throw coded('OUTPUT_TOO_LARGE', 'audio exceeds 16 MiB');
    return new Uint8Array(audio);
  }

  ensureChild() {
    if (this.child && !this.child.killed) return;
    const exe = this.executablePath();
    if (!fs.existsSync(exe)) throw coded('RUNTIME_MISSING', 'native TTS runtime is not built or packaged');
    const child = spawn(exe, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { PATH: path.dirname(exe) + path.delimiter + (process.env.PATH || '') }
    });
    this.child = child;
    this.stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const line = String(chunk).replace(/\s+/g, ' ').slice(0, 1000);
      if (line) console.error('[native-tts] ' + line);
    });
    child.on('error', (error) => {
      if (this.child === child) this.child = null;
      this.failAll(coded('ENGINE_FAILURE', error.message));
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.failAll(coded('ENGINE_EXITED', 'native TTS process exited with code ' + code));
    });
  }

  send(request) {
    this.ensureChild();
    const id = String(this.nextId++);
    request.id = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(coded('TIMEOUT', 'native TTS request timed out'));
        this.reset();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify(request) + '\n', 'utf8', (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(coded('ENGINE_FAILURE', error.message));
      });
    });
  }

  onStdout(chunk) {
    this.stdout += chunk;
    if (this.stdout.length > MAX_RESPONSE_CHARS) {
      this.failAll(coded('OUTPUT_TOO_LARGE', 'native TTS response exceeds limit'));
      this.reset();
      return;
    }
    let newline;
    while ((newline = this.stdout.indexOf('\n')) !== -1) {
      const line = this.stdout.slice(0, newline);
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); }
      catch (_) { this.failAll(coded('ENGINE_FAILURE', 'native TTS returned invalid JSON')); this.reset(); return; }
      const pending = this.pending.get(String(response.id || ''));
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(String(response.id));
      if (response.ok) pending.resolve(response);
      else pending.reject(coded(response.error && response.error.code || 'ENGINE_FAILURE', response.error && response.error.message || 'native TTS failed'));
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  reset() {
    const child = this.child;
    this.child = null;
    this.stdout = '';
    this.failAll(coded('ENGINE_RESET', 'native TTS engine was reset'));
    if (child && !child.killed) child.kill();
  }
}

function coded(code, message) {
  const error = new Error(String(message || code));
  error.code = code;
  return error;
}

function validateWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw coded('INVALID_WAV', 'native TTS did not return RIFF/WAVE audio');
  }
  const declared = bytes.readUInt32LE(4) + 8;
  if (declared < 44 || declared > bytes.length || bytes.indexOf(Buffer.from('fmt '), 12) < 0 || bytes.indexOf(Buffer.from('data'), 12) < 0) {
    throw coded('INVALID_WAV', 'native TTS returned an inconsistent WAV file');
  }
}

module.exports = { NativeTtsHost, validateWav };

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use sbv2_core::tts::{SynthesizeOptions, TTSModelHolder};
use serde::{Deserialize, Serialize};

pub const MAX_TEXT_CHARS: usize = 4_000;
pub const MAX_WAV_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub data_root: String,
    #[serde(default = "default_voice_id")]
    pub voice_id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub style_id: i32,
    #[serde(default)]
    pub speaker_id: i64,
    #[serde(default = "default_sdp_ratio")]
    pub sdp_ratio: f32,
    #[serde(default = "default_length_scale")]
    pub length_scale: f32,
    #[serde(default = "default_style_weight")]
    pub style_weight: f32,
}

fn default_action() -> String {
    "synthesize".to_string()
}
fn default_voice_id() -> String {
    "ryza".to_string()
}
fn default_sdp_ratio() -> f32 {
    0.0
}
fn default_length_scale() -> f32 {
    1.0
}
fn default_style_weight() -> f32 {
    1.0
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<Status>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub deberta_installed: bool,
    pub voice_installed: bool,
    pub ready: bool,
}

#[derive(Debug, Serialize)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone)]
struct ModelPaths {
    root: PathBuf,
}

impl ModelPaths {
    fn new(data_root: &str) -> Result<Self> {
        let raw = data_root.trim();
        if raw.is_empty() {
            return Err(anyhow!("data root is empty"));
        }
        Ok(Self {
            root: PathBuf::from(raw).join("models").join("tts-local"),
        })
    }

    fn deberta(&self) -> PathBuf {
        self.root
            .join("assets")
            .join("deberta")
            .join("deberta.onnx")
    }
    fn tokenizer(&self) -> PathBuf {
        self.root
            .join("assets")
            .join("deberta")
            .join("tokenizer.json")
    }
    fn voice_dir(&self, voice_id: &str) -> PathBuf {
        self.root.join("voices").join(voice_id)
    }
}

#[derive(Default)]
pub struct EngineHost {
    data_root: Option<PathBuf>,
    holder: Option<TTSModelHolder>,
    loaded_voices: HashSet<String>,
}

impl EngineHost {
    pub fn handle(&mut self, req: Request) -> Response {
        let id = req.id.clone();
        let result = match req.action.as_str() {
            "status" => self.status_response(&req),
            "reset" => {
                self.reset();
                Ok(Response {
                    id: id.clone(),
                    ok: true,
                    audio_base64: None,
                    status: None,
                    error: None,
                })
            }
            "synthesize" => self.synthesize_response(&req),
            _ => Err(coded("INVALID_REQUEST", "unknown action")),
        };
        match result {
            Ok(response) => response,
            Err(error) => error_response(id, error),
        }
    }

    pub fn reset(&mut self) {
        self.holder = None;
        self.loaded_voices.clear();
        self.data_root = None;
    }

    fn status_response(&self, req: &Request) -> Result<Response> {
        validate_voice_id(&req.voice_id)?;
        let paths = ModelPaths::new(&req.data_root).map_err(|e| coded("INVALID_REQUEST", e))?;
        let voice = paths.voice_dir(&req.voice_id);
        let voice_installed = voice.join("model.sbv2").is_file()
            || (voice.join("model.onnx").is_file() && voice.join("style_vectors.json").is_file());
        Ok(Response {
            id: req.id.clone(),
            ok: true,
            audio_base64: None,
            status: Some(Status {
                deberta_installed: paths.deberta().is_file() && paths.tokenizer().is_file(),
                voice_installed,
                ready: self.holder.is_some()
                    && self
                        .data_root
                        .as_ref()
                        .map(|v| v == Path::new(&req.data_root))
                        .unwrap_or(false),
            }),
            error: None,
        })
    }

    fn synthesize_response(&mut self, req: &Request) -> Result<Response> {
        validate_request(req)?;
        let wav = self.synthesize(req)?;
        validate_wav(&wav).map_err(|e| coded("INVALID_WAV", e))?;
        if wav.len() > MAX_WAV_BYTES {
            return Err(coded(
                "OUTPUT_TOO_LARGE",
                "synthesized audio exceeds 16 MiB",
            ));
        }
        Ok(Response {
            id: req.id.clone(),
            ok: true,
            audio_base64: Some(BASE64.encode(wav)),
            status: None,
            error: None,
        })
    }

    fn synthesize(&mut self, req: &Request) -> Result<Vec<u8>> {
        let paths = ModelPaths::new(&req.data_root).map_err(|e| coded("INVALID_REQUEST", e))?;
        let requested_root = PathBuf::from(&req.data_root);
        if self.data_root.as_ref() != Some(&requested_root) {
            self.reset();
            self.data_root = Some(requested_root);
        }
        if self.holder.is_none() {
            let bert = fs::read(paths.deberta())
                .with_context(|| format!("missing {}", paths.deberta().display()))
                .map_err(|e| coded("ASSET_MISSING", e))?;
            let tokenizer = fs::read(paths.tokenizer())
                .with_context(|| format!("missing {}", paths.tokenizer().display()))
                .map_err(|e| coded("ASSET_MISSING", e))?;
            self.holder = Some(
                TTSModelHolder::new(bert, tokenizer, Some(1))
                    .map_err(|e| coded("ORT_INIT_FAILED", e))?,
            );
        }
        if !self.loaded_voices.contains(&req.voice_id) {
            let voice_dir = paths.voice_dir(&req.voice_id);
            let sbv2 = voice_dir.join("model.sbv2");
            let onnx = voice_dir.join("model.onnx");
            let holder = self
                .holder
                .as_mut()
                .ok_or_else(|| coded("ENGINE_FAILURE", "engine not initialized"))?;
            if sbv2.is_file() {
                let bytes = fs::read(&sbv2).map_err(|e| coded("VOICE_MISSING", e))?;
                holder
                    .load_sbv2file(&req.voice_id, bytes)
                    .map_err(|e| coded("VOICE_LOAD_FAILED", e))?;
            } else if onnx.is_file() {
                let style = voice_dir.join("style_vectors.json");
                let model_bytes = fs::read(&onnx).map_err(|e| coded("VOICE_MISSING", e))?;
                let style_bytes = fs::read(&style).map_err(|e| coded("VOICE_MISSING", e))?;
                holder
                    .load(&req.voice_id, style_bytes, model_bytes)
                    .map_err(|e| coded("VOICE_LOAD_FAILED", e))?;
            } else {
                return Err(coded(
                    "VOICE_MISSING",
                    format!("voice '{}' is not installed", req.voice_id),
                ));
            }
            self.loaded_voices.insert(req.voice_id.clone());
        }
        let options = SynthesizeOptions {
            sdp_ratio: req.sdp_ratio,
            length_scale: req.length_scale,
            style_weight: req.style_weight,
            split_sentences: true,
        };
        self.holder
            .as_mut()
            .ok_or_else(|| coded("ENGINE_FAILURE", "engine not initialized"))?
            .easy_synthesize(
                &req.voice_id,
                &req.text,
                req.style_id,
                req.speaker_id,
                options,
            )
            .map_err(|e| coded("SYNTHESIS_FAILED", e))
    }
}

fn validate_request(req: &Request) -> Result<()> {
    validate_voice_id(&req.voice_id)?;
    let chars = req.text.chars().count();
    if chars == 0 || chars > MAX_TEXT_CHARS {
        return Err(coded(
            "INVALID_REQUEST",
            "text must contain 1 to 4000 characters",
        ));
    }
    if !req.sdp_ratio.is_finite() || !(0.0..=1.0).contains(&req.sdp_ratio) {
        return Err(coded("INVALID_REQUEST", "sdpRatio must be between 0 and 1"));
    }
    if !req.length_scale.is_finite() || !(0.25..=4.0).contains(&req.length_scale) {
        return Err(coded(
            "INVALID_REQUEST",
            "lengthScale must be between 0.25 and 4",
        ));
    }
    if !req.style_weight.is_finite() || !(0.0..=4.0).contains(&req.style_weight) {
        return Err(coded(
            "INVALID_REQUEST",
            "styleWeight must be between 0 and 4",
        ));
    }
    if req.style_id < 0 || req.speaker_id < 0 {
        return Err(coded(
            "INVALID_REQUEST",
            "styleId and speakerId must be non-negative",
        ));
    }
    ModelPaths::new(&req.data_root).map_err(|e| coded("INVALID_REQUEST", e))?;
    Ok(())
}

fn validate_voice_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(coded(
            "INVALID_REQUEST",
            "voiceId must use 1-64 ASCII letters, digits, '-' or '_'",
        ));
    }
    Ok(())
}

pub fn validate_wav(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(anyhow!("output is not a RIFF/WAVE file"));
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8;
    if declared > bytes.len() || declared < 44 {
        return Err(anyhow!("WAV size header is inconsistent"));
    }
    if !bytes[12..declared].windows(4).any(|chunk| chunk == b"fmt ")
        || !bytes[12..declared].windows(4).any(|chunk| chunk == b"data")
    {
        return Err(anyhow!("WAV is missing fmt or data chunk"));
    }
    Ok(())
}

fn coded(code: &str, error: impl std::fmt::Display) -> anyhow::Error {
    anyhow!("{}:{}", code, error)
}

fn error_response(id: String, error: anyhow::Error) -> Response {
    let raw = error.to_string();
    let (code, message) = raw
        .split_once(':')
        .unwrap_or(("ENGINE_FAILURE", raw.as_str()));
    Response {
        id,
        ok: false,
        audio_base64: None,
        status: None,
        error: Some(ErrorInfo {
            code: code.to_string(),
            message: message.to_string(),
        }),
    }
}

static JNI_ENGINE: OnceLock<Mutex<EngineHost>> = OnceLock::new();

pub fn handle_json(input: &str) -> String {
    let response = match serde_json::from_str::<Request>(input) {
        Ok(req) => JNI_ENGINE
            .get_or_init(|| Mutex::new(EngineHost::default()))
            .lock()
            .map(|mut host| host.handle(req))
            .unwrap_or_else(|_| {
                error_response(
                    String::new(),
                    coded("ENGINE_FAILURE", "engine lock poisoned"),
                )
            }),
        Err(error) => error_response(String::new(), coded("INVALID_REQUEST", error)),
    };
    serde_json::to_string(&response).unwrap_or_else(|_| "{\"ok\":false,\"error\":{\"code\":\"ENGINE_FAILURE\",\"message\":\"response encoding failed\"}}".to_string())
}

#[cfg(all(target_os = "android", feature = "android-jni"))]
mod android {
    use jni::objects::{JClass, JString};
    use jni::sys::jstring;
    use jni::JNIEnv;

    use super::handle_json;

    #[no_mangle]
    pub extern "system" fn Java_com_ryza_chat_NativeTts_nativeHandle(
        mut env: JNIEnv,
        _class: JClass,
        input: JString,
    ) -> jstring {
        let text = env
            .get_string(&input)
            .map(|s| s.into())
            .unwrap_or_else(|_| "{}".to_string());
        let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle_json(&text)))
            .unwrap_or_else(|_| "{\"ok\":false,\"error\":{\"code\":\"ENGINE_FAILURE\",\"message\":\"native inference panicked\"}}".to_string());
        env.new_string(response)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_like_voice_ids() {
        assert!(validate_voice_id("ryza-v1").is_ok());
        assert!(validate_voice_id("../ryza").is_err());
        assert!(validate_voice_id("voice/name").is_err());
    }

    #[test]
    fn validates_minimal_wav_shape() {
        let mut wav = vec![0_u8; 44];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[4..8].copy_from_slice(&36_u32.to_le_bytes());
        wav[8..12].copy_from_slice(b"WAVE");
        wav[12..16].copy_from_slice(b"fmt ");
        wav[36..40].copy_from_slice(b"data");
        assert!(validate_wav(&wav).is_ok());
        wav[0] = b'X';
        assert!(validate_wav(&wav).is_err());
    }

    #[test]
    fn status_does_not_initialize_engine() {
        let mut host = EngineHost::default();
        let response = host.handle(Request {
            action: "status".into(),
            id: "1".into(),
            data_root: "missing".into(),
            voice_id: "ryza".into(),
            text: String::new(),
            style_id: 0,
            speaker_id: 0,
            sdp_ratio: 0.0,
            length_scale: 1.0,
            style_weight: 1.0,
        });
        assert!(response.ok);
        assert!(!response.status.unwrap().ready);
    }
}

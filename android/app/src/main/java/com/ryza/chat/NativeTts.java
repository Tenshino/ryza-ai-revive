package com.ryza.chat;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.system.Os;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Narrow asynchronous bridge to the embedded Style-Bert-VITS2 Rust runtime. */
final class NativeTts {
    private static final int PICK_ASSET = 7301;
    private static final int MAX_REQUEST_CHARS = 16_000;
    private static final int CALLBACK_CHUNK_CHARS = 256 * 1024;
    private static final long MAX_ASSET_BYTES = 2L * 1024 * 1024 * 1024;
    private static final boolean LIBRARY_AVAILABLE;

    static {
        boolean loaded;
        try {
            System.loadLibrary("ryza_tts");
            loaded = true;
        } catch (UnsatisfiedLinkError error) {
            loaded = false;
        }
        LIBRARY_AVAILABLE = loaded;
    }

    private final Activity activity;
    private final WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private PendingInstall pendingInstall;

    NativeTts(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    private static native String nativeHandle(String requestJson);

    @JavascriptInterface
    public String status(String voiceId) {
        try {
            String id = validateVoiceId(voiceId);
            File root = modelRoot();
            File deberta = new File(root, "assets/deberta");
            File voice = new File(root, "voices/" + id);
            boolean voiceReady = new File(voice, "model.sbv2").isFile()
                || (new File(voice, "model.onnx").isFile()
                    && new File(voice, "style_vectors.json").isFile());
            JSONObject out = new JSONObject();
            out.put("runtimeAvailable", LIBRARY_AVAILABLE);
            out.put("debertaInstalled", new File(deberta, "deberta.onnx").isFile()
                && new File(deberta, "tokenizer.json").isFile());
            out.put("voiceInstalled", voiceReady);
            out.put("ready", false);
            return out.toString();
        } catch (Exception error) {
            return errorJson("INVALID_REQUEST", error.getMessage());
        }
    }

    @JavascriptInterface
    public void synthesize(final String requestId, final String requestJson) {
        if (requestId == null || requestJson == null || requestJson.length() > MAX_REQUEST_CHARS) {
            callback(requestId, errorJson("INVALID_REQUEST", "request is missing or too large"));
            return;
        }
        if (!LIBRARY_AVAILABLE) {
            callback(requestId, errorJson("RUNTIME_MISSING", "native TTS library is not packaged"));
            return;
        }
        worker.execute(() -> {
            try {
                JSONObject request = new JSONObject(requestJson);
                String text = request.optString("text", "");
                if (text.isEmpty() || text.codePointCount(0, text.length()) > 4000) {
                    throw new IllegalArgumentException("text must contain 1 to 4000 characters");
                }
                request.put("action", "synthesize");
                request.put("id", requestId);
                request.put("dataRoot", activity.getFilesDir().getAbsolutePath());
                request.put("voiceId", validateVoiceId(request.optString("voiceId", "ryza")));
                callback(requestId, nativeHandle(request.toString()));
            } catch (Exception error) {
                callback(requestId, errorJson("INVALID_REQUEST", error.getMessage()));
            }
        });
    }

    @JavascriptInterface
    public void reset(final String requestId) {
        if (!LIBRARY_AVAILABLE) {
            callback(requestId, errorJson("RUNTIME_MISSING", "native TTS library is not packaged"));
            return;
        }
        worker.execute(() -> {
            try {
                JSONObject request = new JSONObject();
                request.put("action", "reset");
                request.put("id", requestId);
                request.put("dataRoot", activity.getFilesDir().getAbsolutePath());
                callback(requestId, nativeHandle(request.toString()));
            } catch (Exception error) {
                callback(requestId, errorJson("ENGINE_FAILURE", error.getMessage()));
            }
        });
    }

    @JavascriptInterface
    public void install(final String requestId, final String kind, final String voiceId) {
        activity.runOnUiThread(() -> {
            try {
                if (pendingInstall != null) throw new IllegalStateException("another model import is active");
                String id = validateVoiceId(voiceId);
                String mime;
                if ("tokenizer".equals(kind) || "styleVectors".equals(kind)) mime = "application/json";
                else if ("deberta".equals(kind) || "voiceOnnx".equals(kind)) mime = "application/octet-stream";
                else if ("voice".equals(kind)) mime = "application/octet-stream";
                else throw new IllegalArgumentException("unknown model asset kind");
                pendingInstall = new PendingInstall(requestId, kind, id);
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime);
                activity.startActivityForResult(intent, PICK_ASSET);
            } catch (Exception error) {
                callback(requestId, errorJson("INVALID_REQUEST", error.getMessage()));
            }
        });
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_ASSET) return false;
        final PendingInstall pending = pendingInstall;
        pendingInstall = null;
        if (pending == null) return true;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            callback(pending.requestId, "{\"ok\":true,\"canceled\":true}");
            return true;
        }
        final Uri uri = data.getData();
        worker.execute(() -> importAsset(pending, uri));
        return true;
    }

    void shutdown() {
        worker.shutdownNow();
    }

    private void importAsset(PendingInstall pending, Uri uri) {
        File target = targetFor(pending.kind, pending.voiceId);
        File temp = new File(target.getAbsolutePath() + ".importing");
        try {
            File parent = target.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs())) {
                throw new IllegalStateException("cannot create model directory");
            }
            long total = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = activity.getContentResolver().openInputStream(uri);
                 FileOutputStream out = new FileOutputStream(temp)) {
                if (in == null) throw new IllegalArgumentException("cannot open selected file");
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_ASSET_BYTES) throw new IllegalArgumentException("model asset exceeds 2 GiB");
                    out.write(buffer, 0, read);
                }
                out.getFD().sync();
            }
            if (total == 0) throw new IllegalArgumentException("model asset is empty");
            // Both paths are in app-private storage, so POSIX rename atomically
            // replaces an existing model without a delete-before-move window.
            Os.rename(temp.getAbsolutePath(), target.getAbsolutePath());
            if (LIBRARY_AVAILABLE) {
                JSONObject reset = new JSONObject();
                reset.put("action", "reset");
                reset.put("id", pending.requestId);
                reset.put("dataRoot", activity.getFilesDir().getAbsolutePath());
                nativeHandle(reset.toString());
            }
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("canceled", false);
            result.put("status", new JSONObject(status(pending.voiceId)));
            callback(pending.requestId, result.toString());
        } catch (Exception error) {
            temp.delete();
            callback(pending.requestId, errorJson("INVALID_ASSET", error.getMessage()));
        }
    }

    private File targetFor(String kind, String voiceId) {
        File root = modelRoot();
        if ("deberta".equals(kind)) return new File(root, "assets/deberta/deberta.onnx");
        if ("tokenizer".equals(kind)) return new File(root, "assets/deberta/tokenizer.json");
        if ("voice".equals(kind)) return new File(root, "voices/" + voiceId + "/model.sbv2");
        if ("voiceOnnx".equals(kind)) return new File(root, "voices/" + voiceId + "/model.onnx");
        if ("styleVectors".equals(kind)) return new File(root, "voices/" + voiceId + "/style_vectors.json");
        throw new IllegalArgumentException("unknown model asset kind");
    }

    private File modelRoot() {
        return new File(activity.getFilesDir(), "models/tts-local");
    }

    private static String validateVoiceId(String value) {
        String id = value == null || value.isEmpty() ? "ryza" : value;
        if (!id.matches("[A-Za-z0-9_-]{1,64}")) {
            throw new IllegalArgumentException("voice id must use ASCII letters, digits, '-' or '_'");
        }
        return id;
    }

    private void callback(String requestId, String resultJson) {
        final String id = requestId == null ? "" : requestId;
        final String result = resultJson == null ? errorJson("ENGINE_FAILURE", "empty native response") : resultJson;
        try {
            JSONObject parsed = new JSONObject(result);
            String audio = parsed.optString("audioBase64", "");
            if (audio.length() > CALLBACK_CHUNK_CHARS) {
                parsed.remove("audioBase64");
                parsed.put("audioChunked", true);
                final String metadata = parsed.toString();
                web.post(() -> {
                    for (int start = 0; start < audio.length(); start += CALLBACK_CHUNK_CHARS) {
                        String chunk = audio.substring(start, Math.min(start + CALLBACK_CHUNK_CHARS, audio.length()));
                        web.evaluateJavascript(
                            "window.RyzaNativeTtsBridge&&window.RyzaNativeTtsBridge._chunk("
                                + JSONObject.quote(id) + "," + JSONObject.quote(chunk) + ")", null);
                    }
                    resolveCallback(id, metadata);
                });
                return;
            }
        } catch (Exception ignored) {
            // _resolve will turn malformed native JSON into a rejected Promise.
        }
        web.post(() -> resolveCallback(id, result));
    }

    private void resolveCallback(String id, String result) {
        web.evaluateJavascript(
            "window.RyzaNativeTtsBridge&&window.RyzaNativeTtsBridge._resolve("
                + JSONObject.quote(id) + "," + JSONObject.quote(result) + ")", null);
    }

    private static String errorJson(String code, String message) {
        try {
            JSONObject error = new JSONObject();
            error.put("code", code == null ? "ENGINE_FAILURE" : code);
            error.put("message", message == null ? "native TTS failed" : message);
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", error);
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":{\"code\":\"ENGINE_FAILURE\",\"message\":\"native TTS failed\"}}";
        }
    }

    private static final class PendingInstall {
        final String requestId;
        final String kind;
        final String voiceId;

        PendingInstall(String requestId, String kind, String voiceId) {
            this.requestId = requestId;
            this.kind = kind;
            this.voiceId = voiceId;
        }
    }
}

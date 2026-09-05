package com.ryza.chat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Thin WebView shell. No androidx — the whole app is the bundled web build
 * served from AssetServer on 127.0.0.1 (Spine cannot load from file://).
 */
public class MainActivity extends Activity {
    private AssetServer server;
    private WebView web;
    private NativeTts nativeTts;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        server = new AssetServer(getAssets(), getFilesDir(), 0);
        final String appUrl;
        try {
            appUrl = server.startServer();
        } catch (IOException error) {
            throw new IllegalStateException("cannot start private asset server", error);
        }
        final Uri appUri = Uri.parse(appUrl);
        final String routePrefix = server.getRoutePrefix();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("http".equalsIgnoreCase(uri.getScheme())
                    && "127.0.0.1".equals(uri.getHost())
                    && uri.getPort() == appUri.getPort()
                    && uri.getPath() != null && uri.getPath().startsWith(routePrefix)) return false;
                if ("https".equalsIgnoreCase(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }
        });
        web.addJavascriptInterface(new VoiceStoreBridge(), "RyzaApp");
        nativeTts = new NativeTts(this, web);
        web.addJavascriptInterface(nativeTts, "RyzaNativeTts");
        web.loadUrl(appUrl);
    }

    @Override public void onPause()  { super.onPause();  if (web != null) web.onPause(); }
    @Override public void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (nativeTts != null && nativeTts.onActivityResult(requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (nativeTts != null) nativeTts.shutdown();
        if (server != null) server.stopServer();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Bridge used by ChatLog.saveVoice: writes TTS audio under
     *  /data/data/com.ryza.chat/files/voices/. */
    private class VoiceStoreBridge {
        @JavascriptInterface
        public String saveVoice(String name, String base64) {
            if (name == null || base64 == null) return "err";
            String safe = new File(name).getName();
            if (safe.isEmpty() || safe.contains("/") || safe.contains("\\") || safe.contains("..")) {
                return "err";
            }
            try {
                File dir = new File(getFilesDir(), "voices");
                if (!dir.exists() && !dir.mkdirs()) return "err";
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                FileOutputStream out = new FileOutputStream(new File(dir, safe));
                try {
                    out.write(data);
                } finally {
                    out.close();
                }
                return "ok";
            } catch (Exception e) {
                return "err";
            }
        }
    }
}

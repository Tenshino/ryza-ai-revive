package com.ryza.chat;

import android.content.res.AssetManager;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Tiny static server over AssetManager so Spine/fetch see http://127.0.0.1. */
final class AssetServer extends Thread {
    private final AssetManager assets;
    private final int port;
    private volatile boolean running = true;
    private ServerSocket server;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("svg", "image/svg+xml");
        MIME.put("wasm", "application/wasm");
        MIME.put("atlas", "text/plain; charset=utf-8");
        MIME.put("skel", "application/octet-stream");
        MIME.put("m4a", "audio/mp4");
        MIME.put("wav", "audio/wav");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("ttf", "font/ttf");
        MIME.put("woff2", "font/woff2");
    }

    AssetServer(AssetManager assets, int port) {
        this.assets = assets;
        this.port = port;
        setName("asset-http");
        setDaemon(true);
    }

    @Override public void run() {
        try {
            server = new ServerSocket(port, 64, InetAddress.getByName("127.0.0.1"));
            while (running) {
                Socket sock = server.accept();
                new Thread(() -> handle(sock), "asset-req").start();
            }
        } catch (IOException e) {
            if (running) e.printStackTrace();
        }
    }

    void stopServer() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) {}
    }

    private void handle(Socket sock) {
        try (Socket s = sock;
             InputStream in = new BufferedInputStream(s.getInputStream());
             OutputStream out = s.getOutputStream()) {
            String line = readLine(in);
            if (line == null || line.isEmpty()) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) { write(out, 400, "text/plain", "bad request"); return; }
            while (true) {
                String h = readLine(in);
                if (h == null || h.isEmpty()) break;
            }
            String path = URLDecoder.decode(parts[1], "UTF-8");
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            if (path.startsWith("/")) path = path.substring(1);
            if (path.isEmpty()) path = "index.html";
            if (path.contains("..")) { write(out, 403, "text/plain", "forbidden"); return; }
            try (InputStream file = assets.open(path)) {
                String ext = "";
                int dot = path.lastIndexOf('.');
                if (dot >= 0) ext = path.substring(dot + 1).toLowerCase(Locale.US);
                String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                byte[] data = readAll(file);
                writeBytes(out, 200, mime, data);
            } catch (IOException e) {
                write(out, 404, "text/plain", "not found: " + path);
            }
        } catch (IOException ignored) {}
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[16 * 1024];
        int n;
        while ((n = in.read(tmp)) >= 0) buf.write(tmp, 0, n);
        return buf.toByteArray();
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder b = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.append((char) c);
        }
        return c == -1 && b.length() == 0 ? null : b.toString();
    }

    private static void write(OutputStream out, int code, String mime, String body) throws IOException {
        writeBytes(out, code, mime, body.getBytes("UTF-8"));
    }

    private static void writeBytes(OutputStream out, int code, String mime, byte[] body) throws IOException {
        String status = code == 200 ? "OK" : (code == 404 ? "Not Found" : "Error");
        String head = "HTTP/1.1 " + code + " " + status + "\r\n"
            + "Content-Type: " + mime + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Connection: close\r\n\r\n";
        out.write(head.getBytes("UTF-8"));
        out.write(body);
        out.flush();
    }
}

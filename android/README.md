# Android WebView shell (no Flutter)

Open this folder in Android Studio and sync. `web/` is pulled in as assets via `sourceSets` (no copy). The APK will be large (~572 MB of art).

```text
android/
  settings.gradle
  build.gradle
  app/build.gradle
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/ryza/chat/MainActivity.java
  app/src/main/java/com/ryza/chat/AssetServer.java
```

`AssetServer` serves `web/` on `http://127.0.0.1:8765/` so fetch/Spine work the same as in the browser. LLM/TTS still need INTERNET.

Requires Android SDK (API 24+) and a JDK. This machine did not have `ANDROID_HOME` / `JAVA_HOME` when the shell was written, so the APK was not built here.

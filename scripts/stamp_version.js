/* Stamp config/version.json into the two shell manifests.

   The version used to live in three places (desktop/package.json,
   scripts/build_apk.ps1, android/app/build.gradle) and every release needed a
   manual three-way edit — the classic way to ship an exe and an APK that
   disagree. Now both build scripts call this, and the Gradle file stays
   correct for anyone building from Android Studio.

   usage: node scripts/stamp_version.js <version> <versionCode>
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const [version, code] = process.argv.slice(2);

if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^\d+$/.test(code || '')) {
  console.error('usage: node scripts/stamp_version.js <x.y.z> <versionCode>');
  process.exit(2);
}

function rewrite(file, label, fn) {
  const p = path.join(ROOT, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === null) {
    console.error('stamp_version: ' + label + ' not found in ' + file);
    process.exit(1);
  }
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log('  ' + file + ' → ' + label);
  } else {
    console.log('  ' + file + ' already at ' + label);
  }
}

rewrite('desktop/package.json', 'version ' + version, (s) => {
  if (!/"version":\s*"[^"]+"/.test(s)) return null;
  return s.replace(/"version":\s*"[^"]+"/, '"version": "' + version + '"');
});

rewrite('android/app/build.gradle', 'v' + version + ' / code ' + code, (s) => {
  if (!/versionCode\s+\d+/.test(s) || !/versionName\s+"[^"]+"/.test(s)) return null;
  return s
    .replace(/versionCode\s+\d+/, 'versionCode ' + code)
    .replace(/versionName\s+"[^"]+"/, 'versionName "' + version + '"');
});

console.log('version stamped: ' + version + ' (' + code + ')');

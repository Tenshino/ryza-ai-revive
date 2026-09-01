/* Origin-independent save file for the Electron shell.

   Chromium keys localStorage by origin, so http://127.0.0.1:8765 and
   :54321 are different worlds. The HTTP port in this shell is only a
   transport (and may be ephemeral). Progress lives in a JSON file under
   userData, injected into index.html before any page script runs. */
'use strict';

const fs = require('fs');
const path = require('path');

const NAME = 'ryza-web-storage.json';
const READY = 'ryza-web-storage.ready';

function storePath(userData) {
  return path.join(userData, NAME);
}

function readyPath(userData) {
  return path.join(userData, READY);
}

function harvestDone(userData) {
  try {
    if (fs.existsSync(readyPath(userData))) return true;
  } catch (e) {}
  return hasSnapshot(storePath(userData));
}

function markHarvestDone(userData) {
  try { fs.writeFileSync(readyPath(userData), '1'); } catch (e) {}
}

function load(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((k) => {
      if (typeof raw[k] === 'string') out[k] = raw[k];
      else if (raw[k] != null) out[k] = JSON.stringify(raw[k]);
    });
    return out;
  } catch (e) {
    return {};
  }
}

function save(file, obj) {
  if (!file || !obj || typeof obj !== 'object') return;
  if (pendingFile === file) {
    if (timer) { clearTimeout(timer); timer = null; }
    pendingObj = null;
  }
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

let timer = null;
let pendingFile = null;
let pendingObj = null;

function queueSave(file, obj) {
  pendingFile = file;
  pendingObj = obj;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, 80);
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (pendingFile && pendingObj) {
    try { save(pendingFile, pendingObj); } catch (e) {}
    pendingObj = null;
  }
}

/* Safe to embed in <script>: JSON.stringify does not escape '<' by itself. */
function embedJson(obj) {
  return JSON.stringify(obj || {})
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function bootScript(store) {
  return '<script>(function(){' +
    'var disk=' + embedJson(store) + ';' +
    'var rawSet=Storage.prototype.setItem;' +
    'var rawDel=Storage.prototype.removeItem;' +
    'var rawClr=Storage.prototype.clear;' +
    'function dump(){var o={},i,k;for(i=0;i<localStorage.length;i++){' +
      'k=localStorage.key(i);if(k)o[k]=localStorage.getItem(k);}return o;}' +
    'function flush(sync){var s=window.ryzaShell;if(!s)return;' +
      'if(sync&&s.saveWebStorageSync)s.saveWebStorageSync(dump());' +
      'else if(s.saveWebStorage)s.saveWebStorage(dump());}' +
    'try{if(Object.keys(disk).length){rawClr.call(localStorage);' +
      'Object.keys(disk).forEach(function(k){rawSet.call(localStorage,k,String(disk[k]));});}' +
    '}catch(e){}' +
    'Storage.prototype.setItem=function(k,v){rawSet.call(this,k,v);flush(false);};' +
    'Storage.prototype.removeItem=function(k){rawDel.call(this,k);flush(false);};' +
    'Storage.prototype.clear=function(){rawClr.call(this);flush(false);};' +
    'document.addEventListener("visibilitychange",function(){if(document.hidden)flush(true);});' +
    'window.addEventListener("pagehide",function(){flush(true);});' +
    '})();</script>';
}

/* Served once on 8765 to copy Chromium's old origin-scoped localStorage
   into the userData JSON. Must NOT clear storage. */
function harvestHtml() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    '<script>(function(){var o={},i,k;for(i=0;i<localStorage.length;i++){' +
      'k=localStorage.key(i);if(k)o[k]=localStorage.getItem(k);}' +
      'if(window.ryzaShell&&window.ryzaShell.saveWebStorageSync)' +
        'window.ryzaShell.saveWebStorageSync(o);' +
    '})();</script></body></html>';
}

function hasSnapshot(file) {
  return Object.keys(load(file)).length > 0;
}

function inject(html, store) {
  const boot = bootScript(store);
  const i = String(html || '').toLowerCase().indexOf('<head>');
  if (i < 0) return boot + html;
  const open = html.indexOf('>', i);
  if (open < 0) return boot + html;
  return html.slice(0, open + 1) + boot + html.slice(open + 1);
}

module.exports = {
  NAME, READY, storePath, readyPath, harvestDone, markHarvestDone,
  load, save, queueSave, flush, embedJson, bootScript, inject,
  harvestHtml, hasSnapshot
};

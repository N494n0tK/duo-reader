// 公開版のアプリ本体（DUOの本文は含まない）を端末に保存し、圏外でも開けるようにする。
// VERSION と FILES は tools/build_web.py が書き込む。中身が変わると VERSION が変わり、次に開いたときに更新される。
var VERSION = "6aa6c8dfed65";
var CACHE = "duo-shell-" + VERSION;
var FILES = ["./", "./index.html", "./assets/app.css", "./assets/app.js", "./assets/loader.js", "./assets/loader.css", "./manifest.webmanifest", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("duo-shell-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    var key = req.mode === "navigate" ? "./index.html" : req;
    return cache.match(key, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req);
    });
  }));
});

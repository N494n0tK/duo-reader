// 公開版のアプリ本体（DUOの本文は含まない）を端末に保存し、圏外でも開けるようにする。
// VERSION と FILES は tools/build_web.py が書き込む。中身が変わると VERSION が変わり、次に開いたときに更新される。
var VERSION = "81a4a61d947a";
var CACHE = "duo-shell-" + VERSION;
var FILES = ["./", "./index.html", "./assets/app.css?v=7abe848cf2", "./assets/app.js?v=ee932f3aac", "./assets/loader.js?v=eb1848a0b8", "./assets/loader.css?v=f1f5dd66fa", "./assets/marks.js?v=e6e75c5b73", "./widget.html", "./assets/widget.js?v=176d0a503b", "./assets/widget.css?v=dbd2568c6f", "./manifest.webmanifest", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png"];

// 公開直後は配信側に古いファイルが残っていることがあるので、版番号付きのURLで取り直してから保存する
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(FILES.map(function (f) {
      var url = (f === "./" ? "./index.html" : f) + (f.indexOf("?") > -1 ? "&" : "?") + "sw=" + VERSION;
      return fetch(url, { cache: "reload" }).then(function (res) {
        if (!res.ok) throw new Error(f + " " + res.status);
        return cache.put(f, res);
      });
    }));
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
    // ページを開くとき：widget.html はウィジェットのページ、それ以外はアプリ本体
    var key = req.mode !== "navigate" ? req : /\/widget\.html$/.test(new URL(req.url).pathname) ? "./widget.html" : "./index.html";
    return cache.match(key, { ignoreSearch: req.mode === "navigate" }).then(function (hit) {
      return hit || fetch(req);
    });
  }));
});

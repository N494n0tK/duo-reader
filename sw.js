// 公開版のアプリ本体（DUOの本文は含まない）を端末に保存し、圏外でも開けるようにする。
// VERSION と FILES は tools/build_web.py が書き込む。中身が変わると VERSION が変わり、次に開いたときに更新される。
var VERSION = "e3726ddb7080";
var CACHE = "duo-shell-" + VERSION;
var FILES = ["./", "./index.html", "./assets/app.css?v=c3c2a6ad64", "./assets/app.js?v=b1ba44f8d2", "./assets/loader.js?v=58630318be", "./assets/loader.css?v=e1147764e0", "./assets/marks.js?v=e6e75c5b73", "./widget.html", "./assets/widget.js?v=b7eb58712a", "./assets/widget.css?v=80c89cfd6a", "./manifest.webmanifest", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png"];

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

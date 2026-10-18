// ホーム画面ウィジェット（Web Widget アプリなど）用のページ。
// 1時間ごとに、決めた範囲の中からランダムに1文を選んで表示する。
// 例文は次のどちらかから読む（どちらもインターネット上には置かない）:
//   1. リンクの # 以降（アプリの「データ」→「ウィジェット用のリンク」で作る。# 以降はサーバーに送られない）
//   2. このブラウザに読み込んだデータ（アプリと同じ保存場所）。範囲と表示は ?from=1&to=560&show=both で指定
(function () {
  "use strict";

  var $wg = document.getElementById("wg");
  var params = new URLSearchParams(location.search);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad3(n) { return String(n).padStart(3, "0"); }

  // ---------- 1. リンクに入ったデータ ----------
  function base64urlToBytes(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function inflate(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  }
  function fromLink() {
    var m = location.hash.match(/[#&]d=([A-Za-z0-9_-]+)/);
    if (!m) return Promise.resolve(null);
    return inflate(base64urlToBytes(m[1])).then(function (text) {
      var d = JSON.parse(text);
      return {
        total: d.n, from: d.from, to: d.to, show: d.show,
        items: d.s.map(function (x) { return { id: x[0], en: x[1], ja: x[2], spans: x[3] }; })
      };
    });
  }

  // ---------- 2. このブラウザに読み込んだデータ ----------
  function fromStore() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var req = indexedDB.open("duo-reader", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("pack"); };
      req.onerror = function () { resolve(null); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var get = db.transaction("pack", "readonly").objectStore("pack").get("current");
          get.onsuccess = function () { db.close(); resolve(get.result || null); };
          get.onerror = function () { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      };
    }).then(function (pack) {
      if (!pack || !pack.duo) return null;
      var duo = pack.duo, N = duo.sentences.length;
      var from = clamp(+params.get("from") || 1, 1, N), to = clamp(+params.get("to") || N, 1, N);
      var marks = window.DuoMarks(duo).marks;
      return {
        total: N, from: Math.min(from, to), to: Math.max(from, to), show: params.get("show") || "both",
        items: duo.sentences.filter(function (s) { return s.id >= Math.min(from, to) && s.id <= Math.max(from, to); })
          .map(function (s) { return { id: s.id, en: s.en, ja: s.ja, spans: spans(marks(s.id)) }; })
      };
    });
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function spans(owner) {
    var out = [], i = 0;
    while (i < owner.length) {
      if (!owner[i]) { i++; continue; }
      var j = i;
      while (j < owner.length && owner[j] === owner[i]) j++;
      out.push([i, j]);
      i = j;
    }
    return out;
  }

  // ---------- 1時間ごとの1文：時刻から決まるので、何度開き直しても同じ時間帯なら同じ文 ----------
  function hourIndex(date) { return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 3600000); }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 範囲の全文を一巡するまで同じ文は出さない（巡ごとに順番を混ぜ直す）
  function pick(items, date) {
    var n = items.length, k = hourIndex(date), round = Math.floor(k / n);
    var random = rng(round * 7919 + items[0].id * 31 + n), order = items.map(function (_, i) { return i; });
    for (var i = n - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1)), t = order[i];
      order[i] = order[j]; order[j] = t;
    }
    return items[order[k % n]];
  }

  // ---------- 表示 ----------
  function markedEnglish(item) {
    var out = "", at = 0;
    (item.spans || []).forEach(function (sp) {
      out += esc(item.en.slice(at, sp[0])) + '<mark class="hl">' + esc(item.en.slice(sp[0], sp[1])) + "</mark>";
      at = sp[1];
    });
    return out + esc(item.en.slice(at));
  }

  function render(data) {
    var now = new Date(), item = pick(data.items, now), show = data.show;
    $wg.innerHTML =
      '<article class="wg-card">' +
        '<header class="wg-head">' +
          '<span class="wg-num">#' + pad3(item.id) + "</span>" +
          '<span class="wg-of">/ ' + data.total + "</span>" +
          '<span class="wg-time">' + now.getHours() + ":00</span>" +
          '<span class="wg-brand">DUO</span>' +
        "</header>" +
        '<div class="wg-body"><div class="wg-text">' +
          (show !== "ja" ? '<p class="wg-en" lang="en">' + markedEnglish(item) + "</p>" : "") +
          (show !== "en" ? '<p class="wg-ja' + (show === "ja" ? " solo" : "") + '">' + esc(item.ja) + "</p>" : "") +
        "</div></div>" +
      "</article>";
    fit();
    // 開いたままなら次の正時に入れ替える
    var next = new Date(now);
    next.setHours(now.getHours() + 1, 0, 2, 0);
    setTimeout(function () { render(data); }, next - now);
  }

  // ウィジェットアプリがスマホ画面ほどの縦長でページを開いても、上端の 4×2（338:158）の帯に収める
  function layout() {
    var W = window.innerWidth, H = Math.min(window.innerHeight, W * 158 / 338), root = document.documentElement.style;
    root.setProperty("--wg-w", W + "px");
    root.setProperty("--wg-h", H + "px");
    root.setProperty("--u", (H / 158).toFixed(4) + "px");
  }

  // 文の長さに合わせて、枠に収まるいちばん大きな文字にする
  function fit() {
    layout();
    var card = $wg.querySelector(".wg-card");
    if (!card) return;
    var body = card.querySelector(".wg-body"), text = card.querySelector(".wg-text");
    var box = $wg.getBoundingClientRect();
    var size = Math.min(box.width * 0.07, box.height * 0.17);
    for (var i = 0; i < 80; i++) {
      card.style.setProperty("--fs", size.toFixed(2) + "px");
      if (text.offsetHeight <= body.clientHeight || size <= 7) break;
      size *= 0.95;
    }
  }

  layout();

  function message(title, body) {
    $wg.innerHTML = '<article class="wg-card wg-msg"><header class="wg-head"><span class="wg-brand">DUO</span></header>' +
      '<div class="wg-body"><div class="wg-text"><p class="wg-msg-title">' + esc(title) + '</p><p class="wg-msg-body">' + esc(body) + "</p></div></div></article>";
  }

  if (params.get("theme") === "light") document.documentElement.dataset.theme = "light";
  // リンクの # 以降（データ）が変わったら読み直す（アプリの見本表示で範囲を変えたときなど）
  window.addEventListener("hashchange", function () { location.reload(); });

  fromLink().catch(function () { return null; }).then(function (data) {
    return data || fromStore();
  }).then(function (data) {
    if (!data) return message("例文データがありません", "DUO アプリの「データ」→「ウィジェット用のリンクを作る」で作ったリンクを貼ってください。");
    if (!data.items.length) return message("範囲に例文がありません", "範囲の番号を確かめてください。");
    render(data);
  }).then(function () {
    window.addEventListener("resize", fit);
  }).catch(function () {
    message("表示できませんでした", "リンクが途中で切れていないか確かめてください。");
  });
})();

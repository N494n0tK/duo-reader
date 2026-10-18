// スマホ（公開版）用の起動処理。
// 公開版にはDUOの本文が入っていない。利用者が端末で選んだデータファイル（duo-pack.json）を
// この端末の IndexedDB に保存し、そこから window.DUO_DATA / LEXICON_DATA を用意して app.js を起動する。
// データはどこにも送信しない。
(function () {
  "use strict";

  var DB_NAME = "duo-reader", STORE = "pack", KEY = "current";

  // ---------- この端末の保存場所（IndexedDB） ----------
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function withStore(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(req && req.result); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }
  function getPack() { return withStore("readonly", function (s) { return s.get(KEY); }); }
  function putPack(pack) { return withStore("readwrite", function (s) { return s.put(pack, KEY); }); }
  function deletePack() { return withStore("readwrite", function (s) { return s.delete(KEY); }); }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function day(iso) { return iso ? String(iso).slice(0, 10) : "—"; }
  function num(n) { return Number(n || 0).toLocaleString("ja-JP"); }

  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  // 選ばれたファイルを確かめて、保存できる形にする
  function parsePack(text, fileName) {
    var pack;
    try { pack = JSON.parse(text); } catch (e) { throw new Error("このファイルは読み込めませんでした（duo-pack.json を選んでください）。"); }
    var duo = pack && pack.duo;
    if (!pack || pack.format !== "duo-pack" || !duo || !Array.isArray(duo.words) || !Array.isArray(duo.sentences) || !duo.words.length) {
      throw new Error("DUO のデータファイルではないようです（duo-pack.json を選んでください）。");
    }
    pack.importedAt = new Date().toISOString();
    pack.fileName = fileName || "";
    return pack;
  }

  function importFile(file) {
    return readFile(file).then(function (text) {
      var pack = parsePack(text, file.name);
      return putPack(pack).then(function () {
        if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(function () {});
      }).then(function () { return { pack: pack, saved: true }; }, function () {
        return { pack: pack, saved: false }; // 保存できない環境でも今回は使えるようにする
      });
    });
  }

  // ---------- 起動 ----------
  function boot(pack) {
    window.DUO_DATA = pack.duo;
    window.LEXICON_DATA = pack.lexicon || null;
    document.body.classList.remove("needs-data");
    var old = document.querySelector(".importer");
    if (old) old.remove();
    var s = document.createElement("script");
    s.src = "assets/app.js?v=b1ba44f8d2";
    document.body.appendChild(s);
    setupDataButton(pack);
  }

  // ---------- データがまだないときの画面 ----------
  function showImporter() {
    document.body.classList.add("needs-data");
    var el = document.createElement("main");
    el.className = "importer";
    el.innerHTML =
      '<div class="importer-card">' +
        '<div class="brand"><span class="brand-mark">DUO</span><span class="brand-sub">Reader</span></div>' +
        '<p class="imp-lead">このアプリには DUO の本文が入っていません。Mac で作ったデータファイル <b>duo-pack.json</b> を読み込むと使えるようになります。</p>' +
        (isIOS && !standalone
          ? '<div class="imp-hint"><b>先にホーム画面に追加してください。</b>Safari とホーム画面のアプリでは保存場所が別です。Safari の共有ボタン（四角から矢印が出たマーク）→「ホーム画面に追加」で追加し、ホーム画面の DUO アイコンから開いて読み込みます。</div>'
          : "") +
        '<label class="imp-btn"><input type="file" class="imp-file">データファイルを選ぶ</label>' +
        '<p class="imp-status" role="status" aria-live="polite"></p>' +
        '<ol class="imp-steps">' +
          "<li>Mac の <b>phone/duo-pack.json</b> を AirDrop か iCloud Drive でこの端末に送る</li>" +
          "<li>上のボタンからそのファイルを選ぶ</li>" +
          "<li>以後はネットにつながっていなくても開けます</li>" +
        "</ol>" +
        '<p class="imp-note">データはこの端末の中だけに保存され、どこにも送信されません。</p>' +
      "</div>";
    document.body.appendChild(el);

    var status = el.querySelector(".imp-status");
    el.querySelector(".imp-file").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      status.className = "imp-status";
      status.textContent = "読み込んでいます…";
      importFile(file).then(function (r) {
        status.textContent = r.saved ? "読み込みました" : "この端末に保存できませんでした。今回だけ表示します。";
        setTimeout(function () { boot(r.pack); }, r.saved ? 250 : 1600);
      }, function (err) {
        status.className = "imp-status error";
        status.textContent = err.message;
        e.target.value = "";
      });
    });
  }

  // ---------- 読み込み済みデータの確認・入れ替え・削除 ----------
  function setupDataButton(pack) {
    var btn = document.getElementById("data-btn");
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener("click", function () { openSheet(pack); });
  }

  function openSheet(pack) {
    var duo = pack.duo, meta = duo.meta || {};
    var lx = pack.lexicon && pack.lexicon.meta;
    var sheet = document.createElement("div");
    sheet.className = "data-sheet";
    sheet.innerHTML =
      '<div class="data-card" role="dialog" aria-modal="true" aria-labelledby="data-title">' +
        '<h2 id="data-title">データ</h2>' +
        "<dl>" +
          "<dt>単語</dt><dd>" + num(duo.words.length) + "</dd>" +
          "<dt>例文</dt><dd>" + num(duo.sentences.length) + "</dd>" +
          "<dt>発音・語源</dt><dd>" + (lx ? "あり" : "なし") + "</dd>" +
          "<dt>データ作成日</dt><dd>" + esc(day(pack.builtAt || meta.builtAt)) + "</dd>" +
          "<dt>読み込んだ日</dt><dd>" + esc(day(pack.importedAt)) + "</dd>" +
          '<dt>保存</dt><dd class="persist">確認中…</dd>' +
        "</dl>" +
        '<p class="imp-status" role="status" aria-live="polite"></p>' +
        '<button type="button" class="sheet-btn wm-open" data-widget>ウィジェット用のリンクを作る</button>' +
        '<label class="imp-btn"><input type="file" class="imp-file">別のファイルを読み込む</label>' +
        '<button type="button" class="sheet-btn danger" data-delete>この端末からデータを消す</button>' +
        '<button type="button" class="sheet-btn" data-close>閉じる</button>' +
        (lx && lx.credits ? '<p class="imp-note">' + esc(lx.credits) + "</p>" : "") +
      "</div>";
    document.body.appendChild(sheet);
    requestAnimationFrame(function () { sheet.classList.add("open"); });

    var persist = sheet.querySelector(".persist");
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) {
        persist.textContent = p ? "この端末に保存済み（消えにくい設定）" : "この端末に保存済み";
      }, function () { persist.textContent = "この端末に保存済み"; });
    } else {
      persist.textContent = "この端末に保存済み";
    }

    function close() {
      sheet.classList.remove("open");
      setTimeout(function () { sheet.remove(); }, 300);
    }
    var status = sheet.querySelector(".imp-status");
    sheet.addEventListener("click", function (e) {
      if (e.target === sheet || e.target.closest("[data-close]")) close();
      if (e.target.closest("[data-widget]")) { close(); setTimeout(function () { openWidgetMaker(pack); }, 200); }
      if (e.target.closest("[data-delete]")) {
        if (!window.confirm("この端末に保存した DUO データを消します。もう一度使うにはファイルを読み込み直します。")) return;
        deletePack().then(function () { location.replace(location.pathname); });
      }
    });
    sheet.querySelector(".imp-file").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      status.className = "imp-status";
      status.textContent = "読み込んでいます…";
      importFile(file).then(function (r) {
        if (!r.saved) throw new Error("この端末に保存できませんでした。");
        status.textContent = "読み込みました。開き直します…";
        setTimeout(function () { location.reload(); }, 400);
      }).catch(function (err) {
        status.className = "imp-status error";
        status.textContent = err.message;
        e.target.value = "";
      });
    });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });
  }

  // ---------- ウィジェット用のリンク ----------
  // 選んだ範囲の例文を圧縮してリンクの # 以降に入れる（# 以降はサーバーに送られず、どこにも保存されない）。
  // Web Widget アプリに貼ると、widget.html が1時間ごとに1文を選んで表示する。
  function bytesToBase64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function deflate(text) {
    return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()
      .then(function (buf) { return new Uint8Array(buf); });
  }
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
  function widgetLink(pack, marks, from, to, show) {
    var items = pack.duo.sentences.filter(function (s) { return s.id >= from && s.id <= to; }).map(function (s) {
      return [s.id, show === "ja" ? "" : s.en, show === "en" ? "" : s.ja, show === "ja" ? [] : spans(marks(s.id))];
    });
    var json = JSON.stringify({ v: 1, n: pack.duo.sentences.length, from: from, to: to, show: show, s: items });
    var base = location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "") + "widget.html";
    return deflate(json).then(function (bytes) { return base + "#d=" + bytesToBase64url(bytes); });
  }

  function openWidgetMaker(pack) {
    var N = pack.duo.sentences.length, saved = {};
    try { saved = JSON.parse(localStorage.getItem("duo.widget") || "{}"); } catch (e) {}
    var cfg = { from: saved.from || 1, to: saved.to || N, show: saved.show || "both" };
    var SHOW = [["en", "英語"], ["ja", "日本語"], ["both", "両方"]];
    var sheet = document.createElement("div");
    sheet.className = "data-sheet";
    sheet.innerHTML =
      '<div class="data-card wm" role="dialog" aria-modal="true" aria-labelledby="wm-title">' +
        '<h2 id="wm-title">ウィジェット</h2>' +
        '<p class="wm-lead">Web Widget アプリに貼るリンクを作ります。1時間ごとに、範囲の中からランダムに1文を表示します（4×2 サイズ向け）。</p>' +
        '<div class="wm-row"><span class="wm-label">範囲</span>' +
          '<input class="wm-num" type="number" inputmode="numeric" min="1" max="' + N + '" data-k="from" value="' + cfg.from + '">' +
          '<span class="wm-tilde">〜</span>' +
          '<input class="wm-num" type="number" inputmode="numeric" min="1" max="' + N + '" data-k="to" value="' + cfg.to + '"></div>' +
        '<div class="wm-row"><span class="wm-label">表示</span><div class="wm-seg" role="radiogroup" style="--k:' +
          SHOW.findIndex(function (x) { return x[0] === cfg.show; }) + '"><span class="wm-thumb" aria-hidden="true"></span>' +
          SHOW.map(function (x) { return '<button type="button" role="radio" data-show="' + x[0] + '" aria-checked="' + (x[0] === cfg.show) + '">' + x[1] + "</button>"; }).join("") +
        "</div></div>" +
        '<div class="wm-preview"><iframe title="ウィジェットの見本" tabindex="-1"></iframe></div>' +
        '<p class="wm-meta" aria-live="polite">作っています…</p>' +
        '<button type="button" class="imp-btn wm-copy" data-copy disabled>リンクをコピー</button>' +
        (navigator.share ? '<button type="button" class="sheet-btn" data-share disabled>共有…</button>' : "") +
        '<button type="button" class="sheet-btn" data-close>閉じる</button>' +
        '<p class="imp-note">このリンクには選んだ範囲の例文が入っています。自分のウィジェット以外には貼らないでください。</p>' +
      "</div>";
    document.body.appendChild(sheet);
    requestAnimationFrame(function () { sheet.classList.add("open"); });

    var marks = window.DuoMarks(pack.duo).marks;
    var $meta = sheet.querySelector(".wm-meta"), $copy = sheet.querySelector("[data-copy]"), $share = sheet.querySelector("[data-share]");
    var $preview = sheet.querySelector(".wm-preview"), $frame = $preview.querySelector("iframe");
    var link = "", timer, ticket = 0;

    function scalePreview() { $preview.style.setProperty("--wk", $preview.clientWidth / 338); }
    function rebuild() {
      var from = Math.round(+sheet.querySelector('[data-k="from"]').value), to = Math.round(+sheet.querySelector('[data-k="to"]').value);
      if (!(from >= 1 && to <= N && from <= to)) {
        link = ""; $copy.disabled = true; if ($share) $share.disabled = true;
        $meta.className = "wm-meta error"; $meta.textContent = "範囲は 1〜" + N + " で、左を右以下にしてください";
        return;
      }
      cfg.from = from; cfg.to = to;
      try { localStorage.setItem("duo.widget", JSON.stringify(cfg)); } catch (e) {}
      if (!window.CompressionStream) { $meta.className = "wm-meta error"; $meta.textContent = "この端末では作れません（iOS 16.4 以降が必要です）"; return; }
      var my = ++ticket;
      $meta.className = "wm-meta"; $meta.textContent = "作っています…";
      widgetLink(pack, marks, from, to, cfg.show).then(function (url) {
        if (my !== ticket) return;
        link = url;
        $frame.src = url;
        $copy.disabled = false; if ($share) $share.disabled = false;
        $meta.textContent = (to - from + 1) + " 文 · リンク " + url.length.toLocaleString("ja-JP") + " 文字";
      });
    }
    function close() {
      sheet.classList.remove("open");
      setTimeout(function () { sheet.remove(); }, 300);
    }
    function copy() {
      // コピーはタップの中で行う必要があるので、リンクは前もって作っておく
      var done = function () { $copy.textContent = "コピーしました"; setTimeout(function () { $copy.textContent = "リンクをコピー"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, fallback);
      } else fallback();
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = link; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, link.length);
        try { document.execCommand("copy"); done(); } catch (e) {}
        ta.remove();
      }
    }

    sheet.addEventListener("input", function (e) {
      if (!e.target.classList.contains("wm-num")) return;
      clearTimeout(timer);
      timer = setTimeout(rebuild, 350);
    });
    sheet.addEventListener("click", function (e) {
      var b;
      if (e.target === sheet || e.target.closest("[data-close]")) return close();
      if ((b = e.target.closest("[data-show]"))) {
        cfg.show = b.dataset.show;
        sheet.querySelectorAll("[data-show]").forEach(function (x, i) {
          x.setAttribute("aria-checked", String(x === b));
          if (x === b) sheet.querySelector(".wm-seg").style.setProperty("--k", i);
        });
        return rebuild();
      }
      if (e.target.closest("[data-copy]") && link) return copy();
      if (e.target.closest("[data-share]") && link) navigator.share({ url: link }).catch(function () {});
    });
    scalePreview();
    window.addEventListener("resize", scalePreview);
    rebuild();
  }

  // ---------- 圏外でも開けるようにする（Service Worker） ----------
  if ("serviceWorker" in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(location.href)) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
    // 新しい版が届いたら一度だけ開き直して、すぐ新しい見た目にする
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
  }

  if (!window.indexedDB) { showImporter(); return; }
  getPack().then(function (pack) {
    if (pack && pack.duo) boot(pack);
    else showImporter();
  }, showImporter);
})();

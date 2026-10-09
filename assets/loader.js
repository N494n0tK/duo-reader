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
    s.src = "assets/app.js?v=0f9aba481a";
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

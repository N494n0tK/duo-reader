(function () {
  "use strict";

  var DATA = window.DUO_DATA;
  var app = document.getElementById("app");
  if (!DATA) {
    app.innerHTML = '<p class="empty">data/duo-data.js を読み込めませんでした。フォルダ構成を確認してください。</p>';
    return;
  }

  var SENTENCES = DATA.sentences;
  var WORDS = DATA.words;
  var PAGE = 100;

  var POS_NAMES = {
    "動": "動詞", "名": "名詞", "形": "形容詞", "副": "副詞", "定": "定型表現",
    "前": "前置詞", "接": "接続詞", "構": "構文", "助": "助動詞", "感": "間投詞",
    "代": "代名詞", "頭": "接頭辞", "尾": "接尾辞"
  };
  var POS_FILTERS = [
    { key: "", label: "すべて" },
    { key: "動", label: "動詞" },
    { key: "名", label: "名詞" },
    { key: "形", label: "形容詞" },
    { key: "副", label: "副詞" },
    { key: "定", label: "定型表現" },
    { key: "*", label: "その他" }
  ];
  var MAIN_POS = ["動", "名", "形", "副", "定"];

  // ---------- storage (optional) ----------
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function loadJson(key, fallback) {
    try { var v = JSON.parse(load(key)); return v && typeof v === "object" ? v : fallback; } catch (e) { return fallback; }
  }

  // ---------- the learner's own marks, kept on this device ----------
  // colors: { "12": "r", "w40": "g", ... }  r / y / g — a sentence by its number, a word by "w" + its id
  var COLORS = [["r", "赤"], ["y", "黄"], ["g", "緑"]];
  var colors = loadJson("duo.colors", {});
  function colorOf(key) { return colors[key] || ""; }
  // recent searches, newest first
  var recents = loadJson("duo.recent", []).filter(function (x) { return typeof x === "string"; }).slice(0, 10);
  function remember(q) {
    q = String(q || "").trim();
    if (!q) return;
    recents = [q].concat(recents.filter(function (x) { return norm(x) !== norm(q); })).slice(0, 10);
    save("duo.recent", JSON.stringify(recents));
  }
  // a search the learner paused on while typing: "res" then "respect" keeps only "respect",
  // and backing up from "respect" to "resp" does not push "resp" in front of it
  function rememberTyped(q) {
    q = String(q || "").trim();
    var top = recents[0] ? norm(recents[0]) : "", n = norm(q);
    if (n.length < 2 && !/^\d/.test(q)) return;
    if (top && top !== n && top.indexOf(n) === 0) return;
    if (top && n.indexOf(top) === 0) recents.shift();
    remember(q);
  }

  // ---------- text helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s).normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC").toLowerCase()
      .replace(/[~〜]/g, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // "12-22", "12〜22", "#12-#22": a range of numbers
  function parseRange(raw) {
    var m = String(raw).normalize("NFKC").trim().match(/^#?(\d{1,4})\s*[-~〜–—ー−]\s*#?(\d{1,4})$/);
    if (!m || !+m[1] || !+m[2]) return null;
    return [Math.min(+m[1], +m[2]), Math.max(+m[1], +m[2])];
  }
  function pad3(n) { return String(n).padStart(3, "0"); }
  function posLabel(pos) {
    return pos.split("・").map(function (p) { return POS_NAMES[p] || p; }).join("・");
  }
  function markQuery(text, q) {
    var t = esc(text);
    if (!q) return t;
    var re = new RegExp("(" + escRe(esc(q)) + ")", "ig");
    return t.replace(re, '<mark class="q">$1</mark>');
  }

  // ---------- indexes ----------
  var wordById = {};
  var wordsBySid = {};
  WORDS.forEach(function (w) {
    wordById[w.id] = w;
    (wordsBySid[w.sid] = wordsBySid[w.sid] || []).push(w);
    var plain = w.word.replace(/\[.*?\]/g, "").replace(/[()]/g, "");
    var alt = w.word.replace(/\S+\[(.*?)\]/g, "$1").replace(/[()]/g, "");
    w._keys = [norm(w.word), norm(plain), norm(alt)];
    w._meaning = norm(w.meaning);
    w._parts = w.pos.split("・");
  });
  SENTENCES.forEach(function (s) {
    s._en = norm(s.en);
    s._ja = norm(s.ja);
  });

  // ---------- game & tech terms (researched by GPT Luna; optional) ----------
  var TD = window.TERMS_DATA;
  var TERMS = TD ? TD.terms : [];
  var TERM_SOURCES = TD ? TD.sources : [];
  var termById = {}, termsByWord = {}, fieldCount = {};
  TERMS.forEach(function (t, n) {
    t._n = n;
    t._key = norm(t.term);
    t._gloss = norm(t.gloss || "");
    termById[t.id] = t;
    fieldCount[t.field] = (fieldCount[t.field] || 0) + 1;
    (t.duo || []).forEach(function (wid) { (termsByWord[wid] = termsByWord[wid] || []).push(t); });
  });
  var TERM_FILTERS = [{ key: "", label: "すべて" }, { key: "@game", label: "ゲーム・作品" }, { key: "@tech", label: "技術" }]
    .concat(["game", "tech"].reduce(function (list, domain) {
      var fields = Object.keys(fieldCount).filter(function (f) {
        return TERMS.some(function (t) { return t.field === f && t.domain === domain; });
      });
      fields.sort(function (a, b) { return /^その他/.test(a) - /^その他/.test(b) || fieldCount[b] - fieldCount[a]; });
      return list.concat(fields.map(function (f) { return { key: f, label: f }; }));
    }, []));
  var KIND_NAMES = { word: "単語", phrase: "フレーズ", proper_name: "固有名詞", api_identifier: "API名", term: "用語" };
  var EN_POS = {
    noun: "名詞", verb: "動詞", adjective: "形容詞", adverb: "副詞", preposition: "前置詞", conjunction: "接続詞",
    pronoun: "代名詞", interjection: "間投詞", "noun phrase": "名詞句", "verb phrase": "動詞句",
    "adjective phrase": "形容詞句", "adverb phrase": "副詞句", "proper noun": "固有名詞"
  };
  var QA_LABEL = { ok: "根拠を確認済み", fix: "修正の指摘あり", open: "未確認", none: "相互チェック未実施" };
  var QA_HELP = {
    ok: "別の担当が出典を開き直し、この内容を確かめました。",
    fix: "別の担当の確認で、意味や出典の位置に直すべき点が指摘されています。",
    open: "別の担当の確認で、出典の内容をまだ確かめきれていません。",
    none: "まだ別の担当による確認を受けていません。"
  };
  var SPOILER_HIDE = { mild: 1, major: 1, plot: 1, premise: 1 };
  function domainLabel(t) { return t.domain === "game" ? "ゲーム・作品" : "技術"; }
  function termPos(t) {
    return (t.pos || []).map(function (p) { return EN_POS[p.toLowerCase()] || p; }).join("・");
  }

  // ---------- pronunciation (Wiktionary / CMU, optional) ----------
  var LX = window.LEXICON_DATA || { words: {}, tokens: {} };
  var IPA_SRC = { wiktionary: "Wiktionary", cmudict: "CMU発音辞書", composed: "語ごとの発音をつないだもの" };

  // ---------- explanations: ChatGPT writes notes/s001.json … into the private repository duo-notes ----------
  // One file per sentence, in the "duo-note/1" shape (AI-SKILLs duo-deep-research/duo-note.schema.json):
  // a short look at the sentence, then a full card for each headword. A word's page shows only its own card.
  // The key to read the repository stays on this device; what was read is kept so it shows offline.
  var NOTES_URL = "https://api.github.com/repos/N494n0tK/duo-notes/contents/notes/";
  var notesKey = load("duo.notesKey") || "";
  var notes = {}, notesChecked = {};
  var notesDb = null;
  function openNotesDb() {
    if (!notesDb) notesDb = new Promise(function (resolve) {
      try {
        var req = indexedDB.open("duo-notes", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("notes"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return notesDb;
  }
  function notesStore(mode, fn) {
    return openNotesDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var req = fn(db.transaction("notes", mode).objectStore("notes"));
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }
  // { text, etag, at } — text "" means there is no note yet
  function readNote(sid) {
    if (notes[sid]) return Promise.resolve(notes[sid]);
    return notesStore("readonly", function (st) { return st.get(sid); }).then(function (rec) {
      if (rec) notes[sid] = rec;
      return rec;
    });
  }
  function fetchNote(sid) {
    var old = notes[sid], headers = { Authorization: "Bearer " + notesKey, Accept: "application/vnd.github.raw+json" };
    if (old && old.etag) headers["If-None-Match"] = old.etag;
    return fetch(NOTES_URL + "s" + pad3(sid) + ".json", { headers: headers, cache: "no-store" }).then(function (res) {
      if (res.status === 304) return old;
      if (res.status === 401 || res.status === 403) throw new Error("key");
      if (res.status !== 200 && res.status !== 404) throw new Error("net");
      return (res.status === 200 ? res.text() : Promise.resolve("")).then(function (text) {
        var rec = { text: text, etag: res.status === 200 ? res.headers.get("ETag") || "" : "", at: Date.now() };
        notes[sid] = rec;
        notesStore("readwrite", function (st) { return st.put(rec, sid); });
        return rec;
      });
    });
  }

  // inline marks inside the written text: **bold** (drawn as a marker), `code`, [name](https://…)
  function mdInline(s) {
    var codes = [];
    s = esc(String(s == null ? "" : s).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; }));
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*(?![\s*])(.+?)\*(?!\w)/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return "<code>" + esc(codes[+i]) + "</code>"; });
  }
  function list(x) { return Array.isArray(x) ? x.filter(function (v) { return v && typeof v === "object" || typeof v === "string"; }) : []; }
  function parseNote(text) {
    try { var n = JSON.parse(text); return n && typeof n === "object" && Array.isArray(n.words) ? n : null; } catch (e) { return null; }
  }

  var ROLE_NAMES = { S: "主語", V: "動詞", O: "目的語", C: "補語", M: "修飾", "接続": "接続" };
  var SURE = { "確実": "sure", "有力": "likely", "諸説あり": "split", "不明": "unknown" };
  var KIN = { "派生語": "derived", "同根語": "cognate", "別語源": "false" };
  // which part of a word card is open; kept while moving between words, so the learner stays on "語源" if they like it
  var ntTab = "ety";
  // the look at the whole sentence can be folded away with the v button; it stays folded on the next sentence too
  var ntSentOpen = load("duo.ntSent") !== "0";
  // the sentence's skeleton (S / V / O / C / M) drawn right on the example sentence; the 文型 button turns it on and off
  var synOn = load("duo.syn") !== "0", renderAt = 0;
  function roleKey(role) {
    var r = String(role || "").trim();
    return /^[SVOCM]/i.test(r) ? r.charAt(0).toUpperCase() : "X";
  }
  // a part inside a clause is written S′ V′ O′ …, inside a clause inside that S″ …, as in Japanese grammar books
  function roleTag(role, depth) {
    var r = String(role || "").trim();
    return r === "接続" || !depth ? r : r + (depth === 1 ? "\u2032" : "\u2033");
  }

  function exampleHtml(x) {
    if (!x || !x.en) return "";
    return '<p class="nt-ex"><span class="nt-ex-en" lang="en">' + mdInline(x.en) + '</span><span class="nt-ex-ja">' + mdInline(x.ja) + "</span></p>";
  }
  function sourcesHtml(src) {
    src = list(src).filter(function (x) { return /^https?:\/\//.test(x.url || ""); });
    if (!src.length) return "";
    return '<details class="nt-src"><summary>確認した資料 ' + src.length + "</summary><ul>" + src.map(function (x) {
      return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.name || x.url) + "</a></li>";
    }).join("") + "</ul></details>";
  }
  function duoWordId(text) {
    var t = String(text || "").toLowerCase().trim(), w = WORDS.filter(function (w) { return w.word.toLowerCase() === t; })[0];
    return w ? w.id : "";
  }

  // one headword: its core image up top, then a liquid segmented control over the parts that were written
  function wordCardHtml(w) {
    var ety = w.etymology && typeof w.etymology === "object" ? w.etymology : {}, steps = list(ety.steps), parts = list(w.parts);
    var panes = [];
    if (steps.length || parts.length || ety.story) {
      panes.push(["ety", "語源",
        (parts.length ? '<div class="nw-parts">' + parts.map(function (x, i) {
          return (i ? '<i class="nw-plus" aria-hidden="true">+</i>' : "") + '<span class="nw-part"><b lang="en">' + esc(x.part) + "</b><small>" + esc(x.meaning) + "</small></span>";
        }).join("") + "</div>" : "") +
        (steps.length ? '<ol class="nw-steps">' + steps.map(function (x, i) {
          return '<li style="--i:' + i + '"' + (i === steps.length - 1 ? ' class="now"' : "") + '><span class="nw-lang">' + esc(x.lang) + '</span><span class="nw-form" lang="und">' + esc(x.form) + "</span>" +
            (x.meaning ? '<span class="nw-gloss">' + esc(x.meaning) + "</span>" : "") + "</li>";
        }).join("") + "</ol>" : "") +
        (ety.story ? '<p class="nw-story">' + mdInline(ety.story) + "</p>" : "")]);
    }
    var senses = list(w.senses);
    if (senses.length) {
      panes.push(["sense", "意味", '<ol class="nw-senses">' + senses.map(function (x, i) {
        return '<li style="--i:' + i + '"><b>' + esc(x.label) + "</b>" + (x.note ? "<span>" + mdInline(x.note) + "</span>" : "") + exampleHtml(x.example) + "</li>";
      }).join("") + "</ol>" + (senses.length > 1 ? '<p class="nw-axis"><span>具体</span><i></i><span>抽象</span></p>' : "")]);
    }
    var fam = list(w.family);
    if (fam.length) {
      panes.push(["family", "仲間", '<div class="nw-family">' + fam.map(function (x, i) {
        var id = duoWordId(x.word), tag = id ? "button" : "div";
        return "<" + tag + ' class="nw-fam" data-kin="' + (KIN[x.relation] || "") + '" style="--i:' + i + '"' + (id ? ' type="button" data-href="#/w/' + id + '"' : "") + ">" +
          '<span class="nw-kin">' + esc(x.relation || "") + "</span>" +
          '<b lang="en">' + esc(x.word) + "</b>" + (x.meaning ? "<span>" + esc(x.meaning) + "</span>" : "") +
          (x.note ? "<small>" + mdInline(x.note) + "</small>" : "") + "</" + tag + ">";
      }).join("") + "</div>"]);
    }
    var cmp = list(w.compare);
    if (cmp.length) {
      panes.push(["compare", "使い分け", cmp.map(function (x, i) {
        return '<div class="nw-cmp" style="--i:' + i + '"><p class="nw-vs"><b lang="en">' + esc(w.word) + '</b><i aria-hidden="true">⇄</i><b lang="en">' + esc(x.word) + "</b></p>" +
          "<p>" + mdInline(x.diff) + "</p>" + exampleHtml(x.example) + "</div>";
      }).join("")]);
    }
    var ex = list(w.examples);
    if (ex.length) panes.push(["examples", "例文", '<div class="nw-examples">' + ex.map(exampleHtml).join("") + "</div>"]);

    var open = panes.some(function (p) { return p[0] === ntTab; }) ? ntTab : panes.length ? panes[0][0] : "";
    var k = 0;
    panes.forEach(function (p, i) { if (p[0] === open) k = i; });
    var tips = list(w.pitfalls).filter(function (x) { return typeof x === "string"; });
    return '<article class="nw" data-wid="' + esc(w.id) + '">' +
      '<header class="nw-head">' +
        '<div class="nw-title"><span class="nw-id">' + esc(w.id) + '</span><h3 class="nw-word" lang="en">' + esc(w.word) + "</h3>" +
          (ety.certainty ? '<span class="nw-sure" data-sure="' + (SURE[ety.certainty] || "") + '">語源 ' + esc(ety.certainty) + "</span>" : "") + "</div>" +
        (w.core ? '<p class="nw-core"><span>' + esc(w.core) + "</span></p>" : "") +
        (w.meaning ? '<p class="nw-meaning">' + mdInline(w.meaning) + "</p>" : "") +
      "</header>" +
      (panes.length > 1 ? '<div class="nw-tabs" role="tablist" style="--n:' + panes.length + ";--k:" + k + '"><span class="nw-thumb" aria-hidden="true"></span>' +
        panes.map(function (p) { return '<button type="button" class="nw-tab" role="tab" data-nt-tab="' + p[0] + '" aria-selected="' + (p[0] === open) + '">' + p[1] + "</button>"; }).join("") + "</div>" : "") +
      panes.map(function (p) { return '<div class="nw-pane" data-pane="' + p[0] + '"' + (p[0] === open ? "" : " hidden") + ">" + (panes.length === 1 ? '<p class="nw-pane-title">' + p[1] + "</p>" : "") + p[2] + "</div>"; }).join("") +
      (tips.length ? '<div class="nw-call nw-warn"><b>注意</b><ul>' + tips.map(function (x) { return "<li>" + mdInline(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      (w.memory ? '<div class="nw-call nw-memo"><b>覚え方</b><p>' + mdInline(w.memory) + '</p><small>覚えるためのイメージで、語源の史実とは別です</small></div>' : "") +
      sourcesHtml(w.sources) +
    "</article>";
  }

  // the sentence: what it says, its skeleton, the few points worth a word; then the card of the word in focus.
  // A headword's card shows only on its own page (tap the word in the sentence), never as a row of tabs.
  function sentenceNoteHtml(n, sid, wordId) {
    var words = list(n.words);
    var html = n.gist ? '<p class="nt-gist">' + mdInline(n.gist) + "</p>" : "";
    var parts = list(n.structure);
    // a clause (that / when / what / who … with its own S and V) opens up: its own parts sit inside it as S′ V′ …
    function chunkHtml(x, i, depth) {
      var inner = list(x.parts), name = ROLE_NAMES[x.role] || x.role;
      return '<span class="nt-chunk' + (inner.length ? " nt-group" : "") + '" data-role="' + roleKey(x.role) + '" style="--i:' + i + '">' +
        '<b title="' + esc(depth ? "節の中の" + name : name) + '">' + esc(roleTag(x.role, depth)) + "</b>" +
        (inner.length
          ? (x.clause ? '<em class="nt-kind">' + esc(x.clause) + "</em>" : '<span lang="en">' + esc(x.text) + "</span>") +
            '<span class="nt-inner">' + inner.map(function (y, j) { return chunkHtml(y, j, depth + 1); }).join("") + "</span>"
          : '<span lang="en">' + esc(x.text) + "</span>") +
        (x.note ? "<small>" + esc(x.note) + "</small>" : "") + "</span>";
    }
    if (parts.length) {
      html += '<div class="nt-struct">' + parts.map(function (x, i) { return chunkHtml(x, i, 0); }).join("") + "</div>";
    }
    var points = list(n.grammar);
    if (points.length) {
      html += '<div class="nt-points">' + points.map(function (x) {
        return '<details class="nt-point"><summary>' + esc(x.title) + "</summary><div><p>" + mdInline(x.body) + "</p>" + exampleHtml(x.example) + "</div></details>";
      }).join("") + "</div>";
    }
    html += sourcesHtml(n.sources);
    if (html) {
      html = '<div class="nt-sent' + (ntSentOpen ? "" : " closed") + '">' +
        '<button type="button" class="nt-fold" data-nt-fold aria-expanded="' + ntSentOpen + '"><span>文の解説</span><i class="nt-chev" aria-hidden="true"></i></button>' +
        '<div class="nt-sent-panel"><div class="nt-sent-in">' + html + "</div></div></div>";
    }
    if (wordId) {
      var w = words.filter(function (x) { return x.id === wordId; })[0];
      html += '<div class="nt-wordpane">' + (w ? wordCardHtml(w) : '<p class="note-msg">この単語の解説はまだありません。</p>') + "</div>";
    } else if (words.length) {
      html += '<p class="nt-hint">本文の単語をタップすると、その単語の解説が出ます</p>';
    }
    return '<div class="nt">' + html + "</div>";
  }

  function noteCard(sid, word) {
    return '<section class="sentence-card ety-card note-card" data-note="' + sid + '"' + (word ? ' data-note-word="' + word.id + '"' : "") + ' aria-label="解説">' +
      '<div class="card-head"><span class="card-num">解説</span><span class="note-state"></span></div><div class="note-body"></div></section>';
  }
  function keyForm() {
    return '<p class="note-msg">ChatGPT が書いた解説を読むには、GitHub の合鍵（duo-notes を読むだけのトークン）が要ります。この端末の中だけに保存します。</p>' +
      '<form class="note-key"><input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" aria-label="合鍵">' +
      '<button type="submit">保存</button></form>';
  }
  // state: "" / "offline" (showing what was saved) / "error" (nothing saved and no connection) / "key" (the key was refused)
  function paintNote(card, rec, state) {
    var sid = +card.dataset.note, id = card.dataset.noteWord, html;
    card.querySelector(".note-state").textContent = state === "offline" ? "圏外：保存した解説" : "";
    if (!notesKey) html = keyForm();
    else if (!rec) html = '<p class="note-msg">' + (state === "error" ? "解説を読めませんでした。電波のあるところで開き直してください。" : state === "key" ? "" : "読み込んでいます…") + "</p>";
    else if (!rec.text.trim()) html = '<p class="note-msg">この例文の解説はまだありません。</p>';
    else {
      var n = parseNote(rec.text);
      if (!n) html = '<p class="note-msg note-warn">解説ファイルの形が崩れていて表示できません。ChatGPT に「s' + pad3(sid) + '.json を duo-note.schema.json に合わせて直して」と頼んでください。</p>';
      else html = sentenceNoteHtml(n, sid, id);
    }
    paintSyntax(sid, n && list(n.structure));
    if (state === "key") html = '<p class="note-msg note-warn">合鍵が使えません（期限切れか、duo-notes を読む許可がありません）。下の「合鍵を入れ直す」から入れ直してください。</p>' + html;
    if (notesKey) html += '<button type="button" class="note-rekey" data-note-rekey>合鍵を入れ直す</button>';
    card.querySelector(".note-body").innerHTML = html;
  }
  // where each chunk of the skeleton sits in the sentence, in the order written, whole words only:
  // leaves [start, end, role, depth] are the colored words; groups [start, end, role, depth, kind] are clauses opened into parts
  function syntaxRanges(en, parts) {
    var low = en.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'), cur = 0, out = [];
    function letter(c) { return !!c && /[a-z0-9]/i.test(c); }
    function find(q, from) {
      // "n't" starts inside its word ("don't") and "do" ends there; every other chunk starts and ends on a word edge
      var glued = /^n'/.test(q);
      for (var i = low.indexOf(q, from); i > -1; i = low.indexOf(q, i + 1)) {
        var end = i + q.length, tail = low.charAt(end) === "n" && low.charAt(end + 1) === "'"; // "do" of "don't"
        if (!(!glued && letter(q.charAt(0)) && letter(low.charAt(i - 1))) && !(letter(q.charAt(q.length - 1)) && letter(low.charAt(end)) && !tail)) return i;
      }
      return -1;
    }
    // the note may spell out a contracted word: "is" for the 's of "it's", "not" for "n't"
    var SHORT = { is: ["'s"], has: ["'s"], are: ["'re"], am: ["'m"], have: ["'ve"], will: ["'ll"], would: ["'d"], had: ["'d"], not: ["n't"], us: ["'s"] };
    function locate(text) {
      var segs = [];
      // "not only … but also": a chunk written in pieces
      String(text || "").split(/\s*(?:\.{3}|\u2026|\u301c|~)\s*/).forEach(function (seg) {
        var q = seg.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'), at = -1;
        if (!q) return;
        [q, q.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")].concat(SHORT[q] || []).some(function (t) {
          if (!t) return false;
          at = find(t, cur);
          if (at < 0) at = find(t, 0);
          if (at > -1) q = t;
          return at > -1;
        });
        if (at < 0) return;
        segs.push([at, at + q.length]);
        cur = at + q.length;
      });
      return segs;
    }
    var leaves = [], groups = [];
    (function walk(items, depth) {
      items.forEach(function (x) {
        var inner = list(x.parts), segs = locate(x.text);
        if (!inner.length) { segs.forEach(function (g) { leaves.push([g[0], g[1], x.role, depth]); }); return; }
        // a clause: mark its whole stretch, then find its own parts inside it
        var after = cur;
        if (segs.length) { groups.push([segs[0][0], segs[segs.length - 1][1], x.role, depth, x.clause || ""]); cur = segs[0][0]; }
        walk(inner, depth + 1);
        cur = Math.max(after, cur);
      });
    })(parts, 0);
    return { leaves: leaves, groups: groups };
  }
  // color the words of the sentence by their part (S / V / O / C / M); the first word of each chunk carries its letter.
  // The lines are not there at once: a pen draws them left to right, chunk after chunk, after the highlighter has gone by.
  var SYN_PEN = 11, SYN_GAP = 50; // ms per letter, pause between chunks
  var SYN_WAIT = 0.5; // the first line waits this share of the highlighter's run before the pen comes down
  function sameLine(a, b) { return Math.abs(a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom) < 4; }
  function paintSyntax(sid, parts) {
    var card = $detail.querySelector('.sentence-card[data-sid="' + sid + '"]');
    if (!card) return;
    var en = card.querySelector(".sentence-en"), btn = card.querySelector("[data-syn]");
    var found = parts && parts.length ? syntaxRanges(SENTENCES[sid - 1].en, parts) : { leaves: [], groups: [] };
    var ranges = found.leaves, groups = found.groups;
    var sig = JSON.stringify(found);
    btn.hidden = !ranges.length;
    // the saved note and the fresh one are usually the same: leave the lines alone instead of drawing them twice
    if (card.dataset.synSig === sig) { card.classList.toggle("syn", synOn && ranges.length > 0); return; }
    card.dataset.synSig = sig;
    card.classList.remove("syn");
    Array.prototype.forEach.call(en.querySelectorAll(".syn-br"), function (b) { b.parentNode.removeChild(b); });
    Array.prototype.forEach.call(en.querySelectorAll(".wd[data-r]"), function (w) {
      delete w.dataset.r; delete w.dataset.tag; delete w.dataset.join;
      w.style.removeProperty("--sd"); w.style.removeProperty("--sl"); w.style.removeProperty("--tx");
    });
    if (!ranges.length) return;
    splitShared(card, en, ranges);
    var walker = document.createTreeWalker(en, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest("rt") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var at = 0, n, tagged = {}, words = [];
    while ((n = walker.nextNode())) {
      var wd = n.parentNode.closest(".wd");
      if (wd && /\S/.test(n.nodeValue)) {
        // a word that starts with a quotation mark ("You) belongs where its first letter is
        var pos = at + Math.max(0, n.nodeValue.search(/[A-Za-z0-9]/));
        for (var k = 0; k < ranges.length; k++) {
          if (pos >= ranges[k][0] && pos < ranges[k][1]) {
            if (!wd.dataset.r) words.push({ el: wd, k: k, at: at, len: n.nodeValue.length });
            else words[words.length - 1].len += n.nodeValue.length; // a word split by a marker edge
            wd.dataset.r = roleKey(ranges[k][2]);
            if (!tagged[k]) { tagged[k] = true; wd.dataset.tag = roleTag(ranges[k][2], ranges[k][3]); }
            break;
          }
        }
      }
      at += n.nodeValue.length;
    }
    // a clause opened into its parts stands in brackets [ … ] of its own color, its letter (O, M …) under the opening one
    var brackets = groups.map(function (g) {
      var inside = words.filter(function (w) { return w.at < g[1] && w.at + w.len > g[0]; });
      if (!inside.length) return null;
      var open = document.createElement("i"), close = document.createElement("i");
      open.className = "syn-br";
      close.className = "syn-br end";
      open.dataset.r = close.dataset.r = roleKey(g[2]);
      open.dataset.tag = roleTag(g[2], g[3]);
      if (g[4]) open.title = g[4];
      var a = edge(inside[0].el, -1), b = edge(inside[inside.length - 1].el, 1);
      a.parentNode.insertBefore(open, a);
      b.parentNode.insertBefore(close, b.nextSibling);
      return { open: open, close: close, first: inside[0], last: inside[inside.length - 1] };
    }).filter(Boolean);
    // the outermost element that starts (or ends) with this word, so a bracket goes outside the highlighter, not inside it
    function edge(el, dir) {
      while (el.parentNode !== en) {
        var sib = dir < 0 ? el.previousSibling : el.nextSibling;
        while (sib && (sib.nodeType === 3 ? !sib.nodeValue : sib.nodeName === "RT" || (sib.classList && sib.classList.contains("syn-br")))) sib = dir < 0 ? sib.previousSibling : sib.nextSibling;
        if (sib) break;
        el = el.parentNode;
      }
      return el;
    }
    // the pen's timing: each word starts where the last one left off; a new chunk waits a beat
    var t = 0, chunk = -1;
    words.forEach(function (w, i) {
      var next = words[i + 1], s = w.el.style;
      if (w.k !== chunk) { if (chunk > -1) t += SYN_GAP; chunk = w.k; }
      // the line runs on under the space to the next word of the same chunk
      var same = next && next.k === w.k, join = same && next.at > w.at + w.len && sameLine(w.el, next.el);
      if (join) w.el.dataset.join = "";
      var len = same ? next.at - w.at : w.len;
      s.setProperty("--sd", Math.round(t) + "ms");
      s.setProperty("--sl", Math.round(Math.max(45, len * SYN_PEN)) + "ms");
      w.sd = t;
      t += len * SYN_PEN;
      w.done = t;
    });
    card.dataset.synT = Math.round(t);
    brackets.forEach(function (b) {
      b.open.style.setProperty("--sd", Math.round(b.first.sd) + "ms");
      b.close.style.setProperty("--sd", Math.round(b.last.done) + "ms");
    });
    nudgeTags(card);
    if (!synOn) return;
    // a sentence just opened: let the highlighter get halfway through its words first. Moving between its words: lines already there.
    if (card.classList.contains("static")) {
      card.classList.add("syn-now", "syn");
      requestAnimationFrame(function () { requestAnimationFrame(function () { card.classList.remove("syn-now"); }); });
    } else drawSyntax(card, Math.max(0, (260 + en.querySelectorAll(".hl").length * 110) * SYN_WAIT - (performance.now() - renderAt)));
  }
  // letters that would sit on each other are nudged apart, in reading order. A bracket's letter hangs to the left of the
  // bracket, under the end of the word before, so it stays out of the way. Measured with the lines on: brackets take room only then.
  function nudgeTags(card) {
    var en = card.querySelector(".sentence-en"), lastEnd = -1, lastTop = null, on = card.classList.contains("syn");
    if (!en) return;
    if (!on) card.classList.add("syn-measure");
    Array.prototype.forEach.call(en.querySelectorAll(".wd[data-tag]"), function (el) { el.style.removeProperty("--tx"); });
    Array.prototype.forEach.call(en.querySelectorAll(".wd[data-tag]"), function (el) {
      var r = el.getBoundingClientRect(), shift = 0, tag = el.dataset.tag;
      if (lastTop !== null && Math.abs(r.bottom - lastTop) < 6 && r.left < lastEnd + 3) shift = lastEnd + 3 - r.left;
      if (shift) el.style.setProperty("--tx", Math.round(shift) + "px");
      lastEnd = r.left + shift + 9 + tag.replace(/[^\x00-\xff]/g, "").length * 6.5 + tag.replace(/[\x00-\xff]/g, "").length * 10;
      lastTop = r.bottom;
    });
    if (!on) card.classList.remove("syn-measure");
  }
  // one written word, two parts of the sentence ("it's" = S It + V 's): cut the word where one chunk ends and the next begins,
  // so each piece takes its own color. Both pieces keep the word's number, so hiding and clearing still treat it as one word.
  function splitShared(card, en, ranges) {
    function roleAt(i) {
      for (var k = 0; k < ranges.length; k++) if (i >= ranges[k][0] && i < ranges[k][1]) return k;
      return -1;
    }
    var walker = document.createTreeWalker(en, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest("rt") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var nodes = [], n, at = 0, cut = false;
    while ((n = walker.nextNode())) { nodes.push([n, at]); at += n.nodeValue.length; }
    nodes.forEach(function (x) {
      var node = x[0], start = x[1], wd = node.parentNode;
      if (!wd.classList || !wd.classList.contains("wd")) return;
      for (var i = node.nodeValue.length - 1; i > 0; i--) {
        var a = roleAt(start + i - 1), b = roleAt(start + i);
        if (a < 0 || b < 0 || a === b) continue;
        var piece = wd.cloneNode(false);
        piece.textContent = node.nodeValue.slice(i);
        node.nodeValue = node.nodeValue.slice(0, i);
        wd.parentNode.insertBefore(piece, wd.nextSibling);
        cut = true;
      }
    });
    if (cut && rv.card === card) rv.words = Array.prototype.slice.call(card.querySelectorAll(".wd"));
  }
  // put the pen down: the delays hold only while it draws, so a theme change afterwards recolors every word at once
  function drawSyntax(card, start) {
    card.style.setProperty("--s0", Math.round(start) + "ms");
    void card.offsetWidth;
    card.classList.add("syn", "syn-in");
    clearTimeout(card._synTimer);
    card._synTimer = setTimeout(function () { card.classList.remove("syn-in"); }, start + (+card.dataset.synT || 0) + 900);
  }

  function showNote() {
    var card = $detail.querySelector(".note-card");
    if (!card) return;
    var sid = +card.dataset.note;
    if (!notesKey) { paintNote(card, null); return; }
    readNote(sid).then(function (rec) {
      if (!card.isConnected) return;
      paintNote(card, rec);
      if (notesChecked[sid]) return;
      fetchNote(sid).then(function (fresh) {
        notesChecked[sid] = true;
        if (card.isConnected && fresh !== rec) paintNote(card, fresh);
      }, function (err) {
        if (!card.isConnected) return;
        paintNote(card, rec, err.message === "key" ? "key" : rec ? "offline" : "error");
      });
    });
  }

  // ---------- the CD's voice: the private repository duo-audio, read with the same key as the explanations ----------
  // index.json lists each track's stretches of speech (with what speech recognition heard in them) and which stretch is
  // which sentence; a track is fetched the first time one of its sentences is played and kept, so it plays offline after that.
  var AUDIO_URL = "https://api.github.com/repos/N494n0tK/duo-audio/contents/";
  // nothing here may wait forever: a stalled download or a storage that never answers would leave the button spinning
  function within(p, ms, why) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(why)); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  var audioDb = null;
  function audioStore(mode, fn) {
    // iPhone's storage sometimes never answers the first time it is opened: give up after a moment and try again next time
    if (!audioDb) audioDb = within(new Promise(function (resolve) {
      try {
        var req = indexedDB.open("duo-audio", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    }), 3000, "db").catch(function () { audioDb = null; return null; });
    return audioDb.then(function (db) {
      if (!db) return null;
      return within(new Promise(function (resolve) {
        try {
          var req = fn(db.transaction("files", mode).objectStore("files"));
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      }), 4000, "db").catch(function () { return null; });
    });
  }
  function audioFetch(name, etag, type) {
    var headers = { Authorization: "Bearer " + notesKey, Accept: "application/vnd.github.raw+json" };
    if (etag) headers["If-None-Match"] = etag;
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, type === "text" ? 15000 : 25000);
    var p = fetch(AUDIO_URL + encodeURIComponent(name), { headers: headers, cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (res.status === 304) return null;
      if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error("key");
      if (!res.ok) throw new Error("net");
      return res[type]().then(function (body) { return { body: body, etag: res.headers.get("ETag") || "" }; });
    }).catch(function (e) { throw new Error(e && e.message === "key" ? "key" : "net"); });
    p.then(function () { clearTimeout(t); }, function () { clearTimeout(t); });
    return within(p, type === "text" ? 16000 : 26000, "net");
  }

  function alignAudio(idx, texts) {
    var ids = {}, nid = 0;
    function words(s) {
      return (String(s || "").toLowerCase().replace(/[‘’]/g, "'").match(/[a-z0-9']+/g) || []).map(function (w) { return ids[w] || (ids[w] = ++nid); });
    }
    var C = [];
    idx.tracks.forEach(function (t, ti) { t.chunks.forEach(function (c) { C.push({ t: ti, s: c[0], e: c[1], w: words(c[2]) }); }); });
    var S = texts.map(words);
    var N = S.length, M = C.length, W = M + 1, SKIP = -0.6, NONE = -1, BAND = 50;
    var want = new Int32Array(nid + 1), got = new Int32Array(nid + 1);
    function sim(i, j, k) {
      var a = S[i], hit = 0, n = 0, q, w;
      for (q = 0; q < a.length; q++) want[a[q]]++;
      for (q = j; q < k; q++) for (w = 0; w < C[q].w.length; w++) { var x = C[q].w[w]; n++; if (++got[x] <= want[x]) hit++; }
      for (q = 0; q < a.length; q++) want[a[q]] = 0;
      for (q = j; q < k; q++) for (w = 0; w < C[q].w.length; w++) got[C[q].w[w]] = 0;
      return a.length + n ? 2 * hit / (a.length + n) : 0;
    }
    var dp = new Float64Array((N + 1) * W).fill(-1e9), bk = new Int8Array((N + 1) * W);
    dp[0] = 0;
    for (var i = 0; i <= N; i++) {
      var mid = Math.round(i * M / N), lo = Math.max(0, mid - BAND), hi = Math.min(M, mid + BAND);
      for (var j = lo; j <= hi; j++) {
        var v = dp[i * W + j];
        if (v < -1e8) continue;
        if (j < M && v + SKIP > dp[i * W + j + 1]) { dp[i * W + j + 1] = v + SKIP; bk[i * W + j + 1] = -1; }
        if (i === N) continue;
        if (v + NONE > dp[(i + 1) * W + j]) { dp[(i + 1) * W + j] = v + NONE; bk[(i + 1) * W + j] = 0; }
        for (var k = j + 1; k <= Math.min(M, j + 4) && C[k - 1].t === C[j].t; k++) {
          var x = v + sim(i, j, k);
          if (x > dp[(i + 1) * W + k]) { dp[(i + 1) * W + k] = x; bk[(i + 1) * W + k] = k - j; }
        }
      }
    }
    var out = new Array(N), total = dp[N * W + M];
    for (var a = N, b = M; a > 0 || b > 0;) {
      var s = bk[a * W + b];
      if (s === -1) { b--; continue; }
      a--;
      if (s > 0) { out[a] = [C[b - s].t, C[b - s].s, C[b - 1].e]; b -= s; } else out[a] = null;
    }
    return { map: out, score: total / N };
  }

  // sentence number → [track, start, end]; worked out once per index.json and kept
  var audioMapP = null;
  function audioMap() {
    if (audioMapP) return audioMapP;
    audioMapP = audioStore("readonly", function (st) { return st.get("index.json"); }).then(function (rec) {
      return audioFetch("index.json", rec && rec.etag, "text").then(function (fresh) {
        if (fresh) { rec = { body: fresh.body, etag: fresh.etag }; audioStore("readwrite", function (st) { return st.put(rec, "index.json"); }); }
        return rec;
      }, function (err) { if (rec) return rec; throw err; });
    }).then(function (rec) {
      var idx = JSON.parse(rec.body), key = rec.etag + "/" + SENTENCES.length, kept = loadJson("duo.audioMap", {});
      if (kept.key === key && Array.isArray(kept.map)) return { idx: idx, map: kept.map };
      // index.json carries the map already checked against the sentences; if the sentences on this device differ, work it out again
      var map = Array.isArray(idx.map) && idx.map.length === SENTENCES.length ? idx.map : alignAudio(idx, SENTENCES.map(function (x) { return x.en; })).map;
      save("duo.audioMap", JSON.stringify({ key: key, map: map }));
      return { idx: idx, map: map };
    });
    audioMapP.catch(function () { audioMapP = null; }); // try again on the next tap
    return audioMapP;
  }
  // a track, decoded; the last few are kept in memory
  var decoded = {}, decodedOrder = [];
  function audioTrack(idx, ti) {
    if (decoded[ti]) return decoded[ti];
    var name = idx.tracks[ti].file;
    var p = audioStore("readonly", function (st) { return st.get(name); }).then(function (rec) {
      if (rec && rec.body) return rec.body;
      return audioFetch(name, "", "arrayBuffer").then(function (got) {
        audioStore("readwrite", function (st) { return st.put({ body: got.body }, name); });
        return got.body;
      });
    }).then(function (buf) {
      return within(new Promise(function (resolve, reject) {
        var r = actx.decodeAudioData(buf.slice(0), resolve, reject);
        if (r && r.then) r.then(resolve, reject);
      }), 15000, "decode");
    });
    decoded[ti] = p;
    decodedOrder.push(ti);
    if (decodedOrder.length > 4) delete decoded[decodedOrder.shift()];
    p.catch(function () { if (decoded[ti] === p) delete decoded[ti]; });
    return p;
  }

  var actx = null, actxKind = "", playing = null;
  // the sound is "running" only while the clock moves; after the phone slept, a call came in or the app was in the
  // background, iPhone leaves it "interrupted" or "suspended" and anything played on it is silent
  function wakeAudio(AC) {
    if (actx && actx.state !== "running") {
      try { actx.close(); } catch (e) {}
      actx = null;
    }
    if (!actx) actx = new AC();
    if (actx.resume) { try { actx.resume(); } catch (e) {} }
    try { var tick = actx.createBufferSource(); tick.buffer = actx.createBuffer(1, 1, 22050); tick.connect(actx.destination); tick.start(0); } catch (e) {}
  }
  function audioRunning() {
    var ctx = actx;
    if (!ctx) return Promise.reject(new Error("mute"));
    if (ctx.state === "running") return Promise.resolve();
    return within(new Promise(function (resolve) {
      function check() { if (ctx.state === "running") { ctx.removeEventListener("statechange", check); resolve(); } }
      ctx.addEventListener("statechange", check);
      if (ctx.resume) ctx.resume().then(check, function () {});
      check();
    }), 2500, "mute");
  }
  function paintSay(sid, state, msg) {
    var card = $detail.querySelector('.sentence-card[data-sid="' + sid + '"]');
    if (!card) return;
    var btn = card.querySelector("[data-say]"), out = card.querySelector(".say-msg");
    if (btn) { btn.dataset.state = state || ""; btn.setAttribute("aria-pressed", state === "play" || state === "load"); }
    if (out) out.textContent = msg || "";
  }
  function sayStop() {
    if (!playing) return;
    var p = playing;
    playing = null;
    try { if (p.src) p.src.stop(); } catch (e) {}
    paintSay(p.sid, "");
  }
  function say(sid) {
    if (playing && playing.sid === sid) { sayStop(); return; }
    sayStop();
    if (!notesKey) { paintSay(sid, "", "音声を聞くには、解説と同じ GitHub の合鍵が要ります（下の解説から入れられます）。"); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { paintSay(sid, "", "このブラウザでは音声を鳴らせません。"); return; }
    // iPhone: play through the silent switch like a music app, and wake the audio while the finger is still on the button.
    // With "together with music" on, the voice is "ambient": it mixes with the music instead of stopping it ("transient"
    // still stopped it on iPhone), but then the silent switch mutes it too. The sound is set up again when the kind changes.
    var kind = sayMix ? "ambient" : "playback";
    try { if (navigator.audioSession) navigator.audioSession.type = kind; } catch (e) {}
    if (actx && actxKind !== kind) { try { actx.close(); } catch (e) {} actx = null; }
    actxKind = kind;
    wakeAudio(AC);
    var me = { sid: sid, src: null };
    playing = me;
    paintSay(sid, "load");
    audioMap().then(function (a) {
      var m = a.map[sid - 1];
      if (!m) throw new Error("none");
      return audioTrack(a.idx, m[0]).then(function (buf) { return audioRunning().then(function () { return [m, buf]; }); });
    }).then(function (x) {
      if (playing !== me) return;
      var m = x[0], buf = x[1], from = Math.max(0, m[1] - .12), to = Math.min(buf.duration, m[2] + .3);
      var ctx = actx, src = ctx.createBufferSource(), t0 = ctx.currentTime;
      // another speed: the stretch keeps the voice at its own pitch, so faster does not mean higher
      var fast = sayRate !== 1 ? stretchedClip(ctx, buf, from, to, sayRate) : null;
      src.buffer = fast || buf;
      // the voice's own volume; above 100% a limiter keeps the louder peaks from cracking
      var gain = ctx.createGain(), lim = ctx.createDynamicsCompressor();
      gain.gain.value = sayVol;
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .003; lim.release.value = .15;
      src.connect(gain);
      gain.connect(lim);
      lim.connect(ctx.destination);
      me.gain = gain;
      src.onended = function () { if (playing === me) { playing = null; paintSay(sid, ""); } };
      if (fast) { src.start(0); from = 0; to = fast.duration; }
      else src.start(0, from, to - from);
      me.src = src;
      paintSay(sid, "play");
      // if the clock does not move, nothing is heard: say so instead of showing the waves forever
      setTimeout(function () {
        if (playing === me && ctx.currentTime - t0 < .1) {
          sayStop();
          actx = null;
          paintSay(sid, "", "音が出ませんでした。もう一度タップしてください。");
        }
      }, 900);
      setTimeout(function () { if (playing === me) sayStop(); }, (to - from + 1.5) * 1000);
    }).catch(function (err) {
      if (playing !== me) return;
      playing = null;
      if (err.message === "mute") actx = null;
      paintSay(sid, "", err.message === "key" ? "合鍵で duo-audio を読めません。GitHub のトークンの設定で、読めるリポジトリに duo-audio を足してください。"
        : err.message === "none" ? "この例文の音声が見つかりませんでした。"
        : err.message === "net" ? "音声を読めませんでした（時間切れか圏外）。電波のあるところでもう一度タップしてください。"
        : err.message === "mute" ? "音が出ませんでした。もう一度タップしてください。"
        : "音声を鳴らせませんでした。");
    });
  }

  document.addEventListener("visibilitychange", function () { if (document.hidden) sayStop(); });

  // ---------- how the voice plays: speed, volume and "together with music", chosen by holding the speaker ----------
  // speed ×0.6 – ×1.5 and volume 20 % – 150 %, both in steps of 0.1
  var SAY_SCALES = {
    up: { min: .6, max: 1.5, step: .1, label: "速度", text: function (v) { return "×" + v.toFixed(1); } },
    down: { min: .2, max: 1.5, step: .1, label: "音量", text: function (v) { return Math.round(v * 100) + "%"; } }
  };
  function sayStep(v, sc) { return Math.max(sc.min, Math.min(sc.max, Math.round(v / sc.step) * sc.step)); }
  function sayRound(v) { return Math.round(v * 10) / 10; }
  var sayPref = loadJson("duo.say", {});
  var sayRate = typeof sayPref.rate === "number" ? sayRound(sayStep(sayPref.rate, SAY_SCALES.up)) : 1;
  var sayVol = typeof sayPref.vol === "number" ? sayRound(sayStep(sayPref.vol, SAY_SCALES.down)) : 1;
  var sayMix = !!sayPref.mix;
  function saveSayPref() { save("duo.say", JSON.stringify({ rate: sayRate, vol: sayVol, mix: sayMix })); }
  // the speaker shows what it will do: the speed and the volume in tags when not the usual, a note when the music plays on
  function sayBadges() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-say]"), function (b) {
      if (sayRate === 1) b.removeAttribute("data-rate"); else b.dataset.rate = sayRate.toFixed(1);
      var tag = b.querySelector(".say-vol");
      if (sayVol === 1) { if (tag) tag.remove(); }
      else {
        if (!tag) { tag = document.createElement("span"); tag.className = "say-vol"; tag.setAttribute("aria-hidden", "true"); b.appendChild(tag); }
        tag.textContent = Math.round(sayVol * 100) + "%";
      }
      b.classList.toggle("mix", sayMix);
    });
  }

  // Time stretch (WSOLA): the clip is cut into overlapping 40 ms pieces, laid down at a new spacing, and each piece is
  // nudged (±12 ms) to where it best continues the one before, so the speed changes and the pitch stays.
  var stretchCache = [];
  function stretchedClip(ctx, buf, from, to, rate) {
    for (var c = 0; c < stretchCache.length; c++) {
      var hit = stretchCache[c];
      if (hit.buf === buf && hit.from === from && hit.to === to && hit.rate === rate) return hit.out;
    }
    var out = stretch(ctx, buf, from, to, rate);
    stretchCache.push({ buf: buf, from: from, to: to, rate: rate, out: out });
    if (stretchCache.length > 6) stretchCache.shift();
    return out;
  }
  function stretch(ctx, buf, from, to, rate) {
    var sr = buf.sampleRate, nch = buf.numberOfChannels;
    var s0 = Math.max(0, Math.floor(from * sr)), n = Math.min(buf.length, Math.ceil(to * sr)) - s0;
    var W = Math.round(sr * .04) & ~1, Hs = W / 2, Ha = Hs * rate, tol = Math.round(sr * .012), STEP = 3;
    if (n < W * 2) return null;
    var ins = [], c, i;
    for (c = 0; c < nch; c++) ins.push(buf.getChannelData(c).subarray(s0, s0 + n));
    var mono = new Float32Array(n);
    for (c = 0; c < nch; c++) for (i = 0; i < n; i++) mono[i] += ins[c][i];
    var win = new Float32Array(W);
    for (i = 0; i < W; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / W); // two halves overlapping add up to 1
    var len = Math.ceil(n / rate) + W, outs = [];
    for (c = 0; c < nch; c++) outs.push(new Float32Array(len));
    var prev = 0, end = 0;
    for (var k = 0; ; k++) {
      var at = k * Hs, nominal = Math.round(k * Ha);
      if (at + W > len || nominal + W > n) break;
      var best = nominal;
      if (k > 0 && prev + Hs + Hs <= n) {
        // the piece that would naturally follow the last one: find the candidate that sounds most like it
        var target = prev + Hs, score = -Infinity;
        for (var d = -tol; d <= tol; d += 2) {
          var cand = nominal + d;
          if (cand < 0 || cand + W > n) continue;
          var dot = 0, en = 1e-9;
          for (i = 0; i < Hs; i += STEP) { var v = mono[cand + i]; dot += mono[target + i] * v; en += v * v; }
          var sc = dot / Math.sqrt(en);
          if (sc > score) { score = sc; best = cand; }
        }
      }
      for (c = 0; c < nch; c++) {
        var src = ins[c], dst = outs[c];
        for (i = 0; i < W; i++) dst[at + i] += src[best + i] * win[i];
      }
      prev = best;
      end = at + W;
    }
    var out = ctx.createBuffer(nch, Math.max(1, end), sr);
    for (c = 0; c < nch; c++) out.getChannelData(c).set(outs[c].subarray(0, end));
    return out;
  }

  // ---------- highlighter (assets/marks.js): which DUO word owns each character of a sentence ----------
  var sentenceMarks = window.DuoMarks(DATA).marks;

  function renderSentenceHtml(sid, activeId) {
    var s = SENTENCES[sid - 1];
    var owner = sentenceMarks(sid);
    var out = "", i = 0, labeled = {}, order = 0;
    while (i < s.en.length) {
      var id = owner[i], j = i;
      while (j < s.en.length && owner[j] === id) j++;
      var chunk = esc(s.en.slice(i, j));
      if (id) {
        var num = labeled[id] ? "" : String(+id);
        labeled[id] = true;
        var inner = num ? "<ruby>" + chunk + "<rt>" + num + "</rt></ruby>" : chunk;
        out += '<mark class="hl' + (id === activeId ? " on" : "") + '" data-wid="' + id + '" style="--d:' + (320 + order++ * 110) + 'ms">' + inner + "</mark>";
      } else {
        out += chunk;
      }
      i = j;
    }
    return out;
  }

  // ---------- state ----------
  var state = { tab: "words", q: "", pos: "", field: "", color: "", limit: PAGE, current: null };

  var $q = document.getElementById("q");
  var $results = document.getElementById("results");
  var $detail = document.getElementById("detail");
  var $posFilter = document.getElementById("pos-filter");
  var $countWords = document.getElementById("count-words");
  var $countSentences = document.getElementById("count-sentences");
  var $countTerms = document.getElementById("count-terms");
  var $tabBar = document.getElementById("tabs");
  if (TERMS.length) document.querySelector('[data-tab="terms"]').hidden = false;
  var $tabs = Array.prototype.slice.call(document.querySelectorAll(".tab:not([hidden])"));
  $tabBar.style.setProperty("--n", $tabs.length);

  document.getElementById("brand-count").innerHTML =
    "<span>" + WORDS.length.toLocaleString() + " 語</span><span>" + SENTENCES.length + " 例文</span>";

  // phones: the list scrolls under a fixed header, so leave room for the header's real height
  var $listHead = document.querySelector(".list-head");
  function syncHeadHeight() {
    document.querySelector(".pane-list").style.setProperty("--head-h", $listHead.offsetHeight + "px");
  }
  syncHeadHeight();
  if (window.ResizeObserver) new ResizeObserver(syncHeadHeight).observe($listHead);
  else window.addEventListener("resize", syncHeadHeight);

  // ---------- search ----------
  function scoreWord(w, q, wordStart) {
    if (/^\d{1,4}$/.test(q)) return +w.id === +q ? 200 : 0;
    var best = 0;
    for (var i = 0; i < w._keys.length; i++) {
      var k = w._keys[i];
      if (k === q) return 100;
      if (k.indexOf(q) === 0) best = Math.max(best, 80);
      else if (wordStart.test(k)) best = Math.max(best, 70);
      else if (k.indexOf(q) > -1) best = Math.max(best, 60);
    }
    if (!best && w._meaning.indexOf(q) > -1) best = 50;
    return best;
  }

  function posMatch(w) {
    if (!state.pos) return true;
    if (state.pos === "*") return !w._parts.some(function (p) { return MAIN_POS.indexOf(p) > -1; });
    return w._parts.indexOf(state.pos) > -1;
  }

  function searchWords(q, range) {
    var list = WORDS.filter(posMatch);
    if (range) return list.filter(function (w) { return +w.id >= range[0] && +w.id <= range[1]; });
    if (!q) return list;
    var scored = [];
    var wordStart = new RegExp("\\b" + escRe(q));
    list.forEach(function (w) {
      var sc = scoreWord(w, q, wordStart);
      if (sc) scored.push([sc, w]);
    });
    scored.sort(function (a, b) { return b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1); });
    return scored.map(function (x) { return x[1]; });
  }

  function searchSentences(q, range) {
    if (range) return SENTENCES.slice(range[0] - 1, range[1]);
    if (!q) return SENTENCES;
    if (/^\d{1,3}$/.test(q)) return SENTENCES.filter(function (s) { return s.id === +q; });
    return SENTENCES.filter(function (s) { return s._en.indexOf(q) > -1 || s._ja.indexOf(q) > -1; });
  }

  function fieldMatch(t) {
    if (!state.field) return true;
    if (state.field === "@game") return t.domain === "game";
    if (state.field === "@tech") return t.domain === "tech";
    return t.field === state.field;
  }

  function searchTerms(q) {
    var list = TERMS.filter(fieldMatch);
    if (!q) return list;
    var wordStart = new RegExp("\\b" + escRe(q));
    var scored = [];
    list.forEach(function (t) {
      var sc = t._key === q ? 100 : t._key.indexOf(q) === 0 ? 80 : wordStart.test(t._key) ? 70 :
        t._key.indexOf(q) > -1 ? 60 : t._gloss.indexOf(q) > -1 ? 50 : 0;
      if (sc) scored.push([sc, t]);
    });
    scored.sort(function (a, b) { return b[0] - a[0] || a[1]._n - b[1]._n; });
    return scored.map(function (x) { return x[1]; });
  }

  // ---------- list rendering ----------
  var TAB_NAMES = { words: "単語", sentences: "例文", terms: "ゲーム・技術の用語" };

  function colorMatch(s) {
    return !state.color || (state.color === "-" ? !colors[s.id] : colors[s.id] === state.color);
  }
  function colorAttrs(key) {
    var c = colorOf(key);
    return ' data-csid="' + key + '"' + (c ? ' data-color="' + c + '"' : "");
  }

  function recentList() {
    return '<section class="recent-list" aria-label="最近の検索"><div class="recent-head"><span>最近の検索</span><button type="button" data-recent-clear>消す</button></div>' +
      '<div class="recent-chips">' + recents.map(function (r, n) {
        return '<button type="button" class="recent-item" data-recent="' + esc(r) + '" style="--i:' + n + '">' + ICON.clock + "<span>" + esc(r) + "</span></button>";
      }).join("") + "</div></section>";
  }

  function renderList() {
    var q = norm(state.q), raw = state.q.trim(), range = parseRange(raw);
    var found = { words: searchWords(q, range), sentences: searchSentences(q, range).filter(colorMatch), terms: searchTerms(q) };
    $countWords.textContent = found.words.length.toLocaleString();
    $countSentences.textContent = found.sentences.length.toLocaleString();
    $countTerms.textContent = found.terms.length.toLocaleString();

    var html = "";
    var items = found[state.tab];
    var shown = items.slice(0, state.limit);

    if (!items.length) {
      html = '<p class="empty">' + (raw ? "「" + esc(raw) + "」に一致する" : "この色の") + TAB_NAMES[state.tab] + "はありません。";
      var other = $tabs.map(function (t) { return t.dataset.tab; })
        .filter(function (tab) { return tab !== state.tab && found[tab].length; })[0];
      if (other) html += '<br><button class="more" data-switch="' + other + '">' + TAB_NAMES[other] + "で " + found[other].length + " 件見つかりました</button>";
      else if (state.tab === "words" ? state.pos : state.tab === "sentences" ? state.color : state.field) html += '<br><button class="more" data-clear-filter>絞り込みを外す</button>';
      html += "</p>";
    } else if (state.tab === "words") {
      html = shown.map(function (w) {
        return '<button class="row" role="listitem" data-href="#/w/' + w.id + '"' + colorAttrs("w" + w.id) + (state.current === "w" + w.id ? ' aria-current="true"' : "") + ">" +
          '<span class="row-num">' + w.id + "</span>" +
          '<span class="row-head"><span class="row-word en">' + markQuery(w.word, raw) + '</span><span class="row-pos">' + esc(posLabel(w.pos)) + "</span></span>" +
          '<span class="row-sub ja">' + markQuery(w.meaning, raw) + "</span></button>";
      }).join("");
    } else if (state.tab === "sentences") {
      html = shown.map(function (s) {
        return '<button class="row" role="listitem" data-href="#/s/' + s.id + '"' + colorAttrs(s.id) + (state.current === "s" + s.id ? ' aria-current="true"' : "") + ">" +
          '<span class="row-num">' + pad3(s.id) + "</span>" +
          '<span class="row-sentence en">' + markQuery(s.en, raw) + "</span>" +
          '<span class="row-sub ja">' + markQuery(s.ja, raw) + "</span></button>";
      }).join("");
    } else {
      html = shown.map(function (t) {
        return '<button class="row" role="listitem" data-href="#/t/' + t.id + '"' + (state.current === "t" + t.id ? ' aria-current="true"' : "") + ">" +
          '<span class="row-num"><span class="dom dom-' + t.domain + '" title="' + domainLabel(t) + '"></span></span>' +
          '<span class="row-head"><span class="row-word">' + markQuery(t.term, raw) + '</span><span class="row-pos">' + esc(t.field) + "</span></span>" +
          '<span class="row-sub ja">' + markQuery(t.gloss || "", raw) + "</span></button>";
      }).join("");
    }
    if (items.length > shown.length) {
      html += '<button class="more" data-more>さらに表示（残り ' + (items.length - shown.length).toLocaleString() + " 件）</button>";
    }
    if (!raw && recents.length) html = recentList() + html;
    $results.innerHTML = html;
    Array.prototype.forEach.call($results.querySelectorAll(".row"), function (r, n) {
      if (n < 18) r.style.setProperty("--i", n);
    });
  }

  // rows glide in after a tab or filter change, not while typing
  var enterTimer;
  function renderListAnimated() {
    $results.classList.add("enter");
    renderList();
    clearTimeout(enterTimer);
    enterTimer = setTimeout(function () { $results.classList.remove("enter"); }, 900);
  }

  function renderFilter() {
    if (state.tab === "sentences") {
      var count = { r: 0, y: 0, g: 0 };
      Object.keys(colors).forEach(function (id) { if (count[colors[id]] >= 0 && SENTENCES[id - 1]) count[colors[id]]++; });
      $posFilter.innerHTML = '<button class="chip" data-filter="" aria-pressed="' + !state.color + '">すべて</button>' +
        COLORS.map(function (c) {
          return '<button class="chip chip-color" data-filter="' + c[0] + '" data-color="' + c[0] + '" aria-pressed="' + (state.color === c[0]) + '" aria-label="' + c[1] + '">' +
            '<i class="cdot" aria-hidden="true"></i>' + count[c[0]] + "</button>";
        }).join("") +
        '<button class="chip" data-filter="-" aria-pressed="' + (state.color === "-") + '">色なし</button>';
      return;
    }
    var terms = state.tab === "terms";
    var list = terms ? TERM_FILTERS : POS_FILTERS;
    var current = terms ? state.field : state.pos;
    $posFilter.innerHTML = list.map(function (f) {
      return '<button class="chip" data-filter="' + esc(f.key) + '" aria-pressed="' + (current === f.key) + '">' + esc(f.label) + "</button>";
    }).join("");
  }

  function setTab(tab) {
    state.tab = tab;
    state.limit = PAGE;
    $tabBar.dataset.active = tab;
    $tabs.forEach(function (t, k) {
      t.setAttribute("aria-selected", String(t.dataset.tab === tab));
      if (t.dataset.tab === tab) $tabBar.style.setProperty("--k", k);
    });
    renderFilter();
    renderListAnimated();
    $results.scrollTop = 0;
  }

  // ---------- detail rendering ----------
  var ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c1.6 0 2.7-1 3.6-2.3M13.4 9.3C14.3 8 15.4 7 17 7h3M17 4l3 3-3 3M17 14l3 3-3 3"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    prev5: '<svg viewBox="0 0 24 24"><path d="M12 5l-7 7 7 7M19 5l-7 7 7 7"/></svg>',
    next5: '<svg viewBox="0 0 24 24"><path d="M5 5l7 7-7 7M12 5l7 7-7 7"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M9 5h11v14H9l-6-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path class="drop" d="M12 3.6c3.4 4.1 5.7 7.2 5.7 10.1a5.7 5.7 0 0 1-11.4 0c0-2.9 2.3-6 5.7-10.1Z"/></svg>',
    say: '<svg viewBox="0 0 24 24"><path class="spk" d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path class="w1" d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path class="w2" d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.8V12l2.8 1.8"/></svg>'
  };

  // the color swatches: three colors and "no color"
  function swatches(current) {
    return COLORS.concat([["", "色なし"]]).map(function (c) {
      return '<button type="button" class="sw" data-tint="' + c[0] + '"' + (c[0] ? ' data-color="' + c[0] + '"' : "") +
        ' role="radio" aria-checked="' + (current === c[0]) + '" aria-label="' + c[1] + '"></button>';
    }).join("");
  }

  // the gauge: where this sentence sits in the book, with the learner's colors along it
  var BLOCK = 20;
  function colorStrip() {
    var out = "";
    Object.keys(colors).forEach(function (id) {
      if (SENTENCES[id - 1]) out += '<rect class="gs-' + colors[id] + '" x="' + (id - 1) + '" width="3.6" height="1"/>';
    });
    return '<svg class="gauge-strip" viewBox="0 0 ' + SENTENCES.length + ' 1" preserveAspectRatio="none" aria-hidden="true">' + out + "</svg>";
  }
  function peekText(sid) {
    var s = SENTENCES[sid - 1], body = document.body.classList;
    return !body.contains("hide-en") ? { text: s.en, en: true } : !body.contains("hide-ja") ? { text: s.ja, en: false } : { text: "", en: false };
  }

  var lastSid = null, lastP = 0, curKey = "";

  function renderDetail(kind, id, opts) {
    opts = opts || {};
    var word = kind === "w" ? wordById[id] : null;
    var sid = word ? word.sid : +id;
    var s = SENTENCES[sid - 1];
    var siblings = wordsBySid[sid] || [];
    var same = !opts.home && !opts.shuffle && sid === lastSid;
    if (playing && playing.sid !== sid) sayStop();
    var dir = same ? "same" : lastSid === null ? "" : opts.shuffle || sid > lastSid ? "dir-next" : "dir-prev";
    var p = (sid - 1) / (SENTENCES.length - 1);
    // on a word's page the color belongs to the word, as in the list
    var key = word ? "w" + word.id : String(sid), what = word ? "この単語の色" : "この例文の色";

    var html = '<article class="detail ' + dir + '">';

    html += '<div class="detail-top">';
    html += '<button class="nav-btn back" data-back title="一覧に戻る"><span class="sr">一覧に戻る</span>' + ICON.back + "</button>";
    // phones: a magnifier that stretches into a sentence search
    if (!opts.home) {
      html += '<div class="seek">' +
        '<div class="seek-bar">' +
          '<button class="seek-btn" type="button" data-seek-open aria-label="例文を検索">' + ICON.search + "</button>" +
          '<input class="seek-input" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" tabindex="-1" placeholder="英語・日本語・12-22" aria-label="例文を検索">' +
          '<button class="seek-close" type="button" data-seek-close aria-label="検索を閉じる">' + ICON.close + "</button>" +
        "</div>" +
        '<div class="seek-panel"><div class="seek-list"></div></div>' +
      "</div>";
      // phones: the position gauge; tap it and it opens into a big two-step picker
      html += '<div class="gauge" style="--p:' + lastP + '">' +
        '<button class="gauge-bar" type="button" data-gauge-open aria-label="例文の位置（タップで大きく）">' +
          '<span class="gauge-track">' + colorStrip() + '<span class="gauge-cursor"></span></span>' +
          '<span class="gauge-head"><span class="gauge-num"></span><span class="gauge-of">/ ' + SENTENCES.length + '</span><span class="gauge-range"></span></span>' +
        "</button>" +
        '<button class="gauge-close" type="button" data-gauge-close aria-label="閉じる">' + ICON.close + "</button>" +
        '<div class="gauge-panel"><div class="gauge-body">' +
          '<p class="gauge-peek" aria-live="polite"></p>' +
          '<div class="gauge-blocks" data-blocks aria-label="20文ずつのまとまり">' +
            Array.apply(null, Array(Math.ceil(SENTENCES.length / BLOCK))).map(function (_, k) { return '<i data-b="' + k + '"></i>'; }).join("") +
          "</div>" +
          '<div class="gauge-scale" aria-hidden="true"><span>1</span><span>' + SENTENCES.length + "</span></div>" +
          '<div class="gauge-cells" data-cells></div>' +
        "</div></div>" +
      "</div>";
    }
    html += '<span class="eyebrow">' + (opts.home ? "ランダムな一文" : word ? "単語 " + word.id : "例文") + "</span>";
    html += '<span class="spacer"></span>';
    // this page's color: tap and it drops down into the three colors and "none"
    html += '<div class="tint"' + (colorOf(key) ? ' data-color="' + colorOf(key) + '"' : "") + '><div class="tint-cap">' +
      '<button class="tint-btn" type="button" data-tint-open aria-label="' + what + '">' + ICON.drop + "</button>" +
      '<div class="tint-panel"><div class="tint-list"><div class="tint-sws" role="radiogroup" aria-label="' + what + '">' + swatches(colorOf(key)) + "</div>" +
        // under the colors: blur the Japanese / the English, right from here
        '<i class="tint-sep" aria-hidden="true"></i>' +
        '<button type="button" class="tint-hide" data-hide="ja" aria-pressed="' + document.body.classList.contains("hide-ja") + '" aria-label="日本語を隠す">あ</button>' +
        '<button type="button" class="tint-hide" data-hide="en" aria-pressed="' + document.body.classList.contains("hide-en") + '" aria-label="英語を隠す">A</button>' +
      "</div></div>" +
    "</div></div>";
    if (opts.home) {
      html += '<button class="nav-btn" data-shuffle title="別の例文"><span class="sr">別の例文</span>' + ICON.shuffle + "</button>";
    } else {
      html += '<button class="nav-btn" data-go="' + (sid - 1) + '"' + (sid <= 1 ? " disabled" : "") + ' title="前の例文（←）"><span class="sr">前の例文</span>' + ICON.prev + "</button>";
      html += '<button class="nav-btn" data-go="' + (sid + 1) + '"' + (sid >= SENTENCES.length ? " disabled" : "") + ' title="次の例文（→）"><span class="sr">次の例文</span>' + ICON.next + "</button>";
    }
    html += "</div>";

    html += '<div class="rail" data-rail role="slider" aria-label="例文の位置" aria-valuemin="1" aria-valuemax="' + SENTENCES.length + '" aria-valuenow="' + sid + '" style="--p:' + lastP + '">' +
      '<span class="rail-label">#' + pad3(sid) + '</span><span class="rail-cursor"></span><span class="rail-peek" aria-hidden="true"></span></div>';

    if (word) {
      html += '<header class="headword"><div class="headword-line"><h1 class="en"><span>' + esc(word.word) + "</span></h1>" +
        '<span class="pos-tag">' + esc(posLabel(word.pos)) + "</span></div>" +
        (LX.words[word.id] && LX.words[word.id].ipa
          ? '<p class="ipa"><span lang="en">' + esc(LX.words[word.id].ipa) + '</span><span class="ipa-src">米音 · ' + IPA_SRC[LX.words[word.id].ipaSrc] + "</span></p>"
          : "") +
        '<p class="meaning ja">' + esc(word.meaning) + "</p></header>";
    }

    html += '<section class="sentence-card' + (same ? " static" : "") + '"' + colorAttrs(key) + ' data-sid="' + sid + '" aria-label="例文 ' + sid + '">' +
      '<div class="card-head"><span class="card-num">#' + pad3(sid) + '</span><span class="card-of">/ ' + SENTENCES.length + "</span>" +
        '<button type="button" class="syn-btn" data-syn hidden aria-pressed="' + synOn + '" title="文型の色分け"><i class="syn-dots" aria-hidden="true"><b data-r="S"></b><b data-r="V"></b><b data-r="O"></b></i>文型</button>' +
        (notesKey ? '<button type="button" class="say-btn" data-say aria-pressed="false" aria-label="この例文の音声">' + ICON.say + "</button>" : "") + "</div>" +
      '<p class="sentence-en" lang="en">' + renderSentenceHtml(sid, word && word.id) + "</p>" +
      '<p class="sentence-ja">' + esc(s.ja) + '</p><p class="say-msg" role="status"></p></section>';

    html += noteCard(sid, word);

    var related = word ? termsByWord[word.id] || [] : [];
    if (related.length) {
      html += '<h2 class="section-title">ゲーム・技術ではこう使う ' + related.length + "</h2>";
      html += '<div class="word-list term-links">' + related.map(termItem).join("") + "</div>";
    }

    html += '<h2 class="section-title">この例文の単語 ' + siblings.length + "</h2>";
    html += '<div class="word-list">' + siblings.map(function (w) {
      return '<button class="word-item" data-href="#/w/' + w.id + '" data-wid="' + w.id + '"' + (word && w.id === word.id ? ' aria-current="true"' : "") + ">" +
        '<span class="n">' + w.id + "</span>" +
        '<span><span class="w en">' + esc(w.word) + '</span><span class="m ja">' + esc(w.meaning) + "</span></span>" +
        '<span class="p">' + esc(posLabel(w.pos)) + "</span></button>";
    }).join("") + "</div>";

    // bottom dock: « number » moves one sentence at a time; while the sentence is hidden it turns into ‹ › that clear it word by word
    if (!opts.home) {
      html += '<nav class="dock" aria-label="例文の移動">' +
        '<button class="nav-btn dock-l" data-go="' + Math.max(1, sid - 1) + '"' + (sid <= 1 ? ' data-end="1"' : "") + '>' +
          '<span class="dk-nav"><span class="sr">前の例文</span>' + ICON.prev5 + '</span><span class="dk-rv" aria-hidden="true">' + ICON.prev + "</span></button>" +
        '<span class="dock-num" title="ダブルタップで番号を入力">#' + pad3(sid) + '<small class="dk-of">/ ' + SENTENCES.length + '</small><small class="dk-prog"></small><i class="dk-bar" aria-hidden="true"></i></span>' +
        '<button class="nav-btn dock-r" data-go="' + Math.min(SENTENCES.length, sid + 1) + '"' + (sid >= SENTENCES.length ? ' data-end="1"' : "") + '>' +
          '<span class="dk-nav"><span class="sr">次の例文</span>' + ICON.next5 + '</span><span class="dk-rv" aria-hidden="true">' + ICON.next + "</span></button></nav>";
    }

    if (opts.home) {
      html += '<p class="home-keys"><kbd>/</kbd> 検索　<kbd>←</kbd><kbd>→</kbd> 前後の例文　<kbd>Esc</kbd> 閉じる</p>';
    }

    html += "</article>";
    $detail.innerHTML = html;
    renderAt = performance.now();
    if (!same) $detail.scrollTop = 0;

    // slide the rail and gauge cursors from the previous sentence to this one
    var rail = $detail.querySelector(".rail"), gauge = $detail.querySelector(".gauge");
    void rail.offsetWidth;
    rail.style.setProperty("--p", p);
    if (gauge) gauge.style.setProperty("--p", p);
    lastSid = sid;
    curKey = key;
    lastP = p;
    setupReveal(same);
    showNote();
    if (playing && playing.sid === sid) paintSay(sid, playing.src ? "play" : "load");
    sayBadges();
  }

  // ---------- hide & reveal: a hidden sentence is blurred and cleared one word at a time ----------
  // b[k] is how hidden word k still is (1 = blurred, 0 = clear). English words come first, then the Japanese phrases.
  var rv = { sid: 0, words: [], b: [], hidden: 0, done: false };
  var rvTimer, rvGuard = 0;
  function wrapEnglish(p) {
    var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest("rt") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var nodes = [], n, k = -1, gap = true;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach(function (piece) {
        if (!piece) return;
        if (/^\s+$/.test(piece)) { gap = true; frag.appendChild(document.createTextNode(piece)); return; }
        // a word continues across a marker edge ("individual" + "."), and lone punctuation joins the word before it
        if (gap && !(k >= 0 && !/[\w\d]/.test(piece))) k++;
        gap = false;
        var span = document.createElement("span");
        span.className = "wd";
        span.dataset.k = k;
        span.textContent = piece;
        frag.appendChild(span);
      });
      node.parentNode.replaceChild(frag, node);
    });
    return k + 1;
  }
  function wrapJapanese(p, k0) {
    var parts = p.textContent.match(/[^、。！？!?]+[、。！？!?」』）)]*|[、。！？!?」』）)]+/g) || [p.textContent];
    p.textContent = "";
    parts.forEach(function (part, i) {
      var span = document.createElement("span");
      span.className = "wd";
      span.dataset.k = k0 + i;
      span.textContent = part;
      p.appendChild(span);
    });
    return parts.length;
  }
  function setupReveal(keep) {
    var card = $detail.querySelector(".sentence-card[data-sid]");
    if (!card) return;
    var en = card.querySelector(".sentence-en"), ja = card.querySelector(".sentence-ja");
    if (!en.querySelector(".wd")) { card.dataset.nen = wrapEnglish(en); card.dataset.nja = wrapJapanese(ja, +card.dataset.nen); }
    var nEn = +card.dataset.nen, nJa = +card.dataset.nja, body = document.body.classList;
    var hideEn = body.contains("hide-en"), hideJa = body.contains("hide-ja");
    var sid = +card.dataset.sid, b = [];
    for (var k = 0; k < nEn + nJa; k++) b.push((k < nEn ? hideEn : hideJa) ? 1 : 0);
    // moving between the words of the same sentence keeps what was already cleared
    if (keep && rv.sid === sid && rv.b.length === b.length) b = b.map(function (x, i) { return Math.min(x, rv.b[i]); });
    rv = { sid: sid, words: Array.prototype.slice.call(card.querySelectorAll(".wd")), b: b, card: card, done: false };
    card.classList.toggle("rv", hideEn || hideJa);
    paintReveal(true);
  }
  function paintReveal(instant) {
    if (!rv.card || !rv.card.isConnected) return;
    rv.words.forEach(function (w) { w.style.setProperty("--b", rv.b[+w.dataset.k].toFixed(3)); });
    var total = 0, clear = 0;
    rv.b.forEach(function (x, k) { if (rv.card.classList.contains("rv") && isHideable(k)) { total++; if (x === 0) clear++; } });
    rv.hidden = rv.b.filter(function (x) { return x > 0; }).length;
    var dock = $detail.querySelector(".dock");
    if (!dock) return;
    dock.querySelector(".dk-prog").textContent = clear + "/" + total;
    dock.style.setProperty("--rp", total ? clear / total : 1);
    clearTimeout(rvTimer);
    if (rv.hidden) setDockMode(dock, true);
    // everything is clear: give the dock back to « » after a moment, so a quick extra tap does not jump to the next sentence
    else if (dock.classList.contains("reveal")) {
      if (instant) setDockMode(dock, false);
      else rvTimer = setTimeout(function () { setDockMode(dock, false); }, 650);
    } else setDockMode(dock, false);
  }
  function isHideable(k) {
    var nEn = +rv.card.dataset.nen, body = document.body.classList;
    return k < nEn ? body.contains("hide-en") : body.contains("hide-ja");
  }
  function setDockMode(dock, reveal) {
    if (dock.classList.contains("reveal") !== reveal) rvGuard = Date.now() + 380;
    dock.classList.toggle("reveal", reveal);
    Array.prototype.forEach.call(dock.querySelectorAll(".nav-btn"), function (btn) {
      btn.disabled = !reveal && btn.dataset.end === "1";
    });
  }
  // +1: clear the next hidden word; -1: hide the last cleared one again
  function revealStep(dir) {
    var k;
    if (dir > 0) {
      k = rv.b.findIndex(function (x) { return x > 0; });
      if (k > -1) rv.b[k] = 0;
    } else {
      for (k = rv.b.length - 1; k >= 0; k--) if (isHideable(k) && rv.b[k] < 1) { rv.b[k] = 1; break; }
    }
    paintReveal();
  }
  // rubbing the dock: the words clear little by little, in order
  function revealBy(amount) {
    while (amount > 0) {
      var k = rv.b.findIndex(function (x) { return x > 0; });
      if (k < 0) break;
      var take = Math.min(rv.b[k], amount);
      rv.b[k] = rv.b[k] - take < .02 ? 0 : rv.b[k] - take;
      amount -= take;
    }
    paintReveal();
  }

  function qaBadge(t) {
    return '<span class="qa qa-' + t.qa + '" title="' + esc(QA_HELP[t.qa]) + '">' + QA_LABEL[t.qa] + "</span>";
  }

  function termItem(t) {
    return '<button class="word-item" data-href="#/t/' + t.id + '">' +
      '<span class="n"><span class="dom dom-' + t.domain + '"></span></span>' +
      '<span><span class="w">' + esc(t.term) + '</span><span class="m">' + esc(t.field) + " · " + esc(t.gloss || "") + "</span></span>" +
      '<span class="p">' + qaBadge(t) + "</span></button>";
  }

  function renderTerm(id) {
    var t = termById[id];
    var hide = SPOILER_HIDE[t.spoiler];
    var tags = [KIND_NAMES[t.kind] || t.kind, termPos(t)].filter(Boolean);
    var html = '<article class="detail term-detail">';

    html += '<div class="detail-top">' +
      '<button class="nav-btn back" data-back title="一覧に戻る"><span class="sr">一覧に戻る</span>' + ICON.back + "</button>" +
      '<span class="eyebrow">' + domainLabel(t) + " · " + esc(t.field) + "</span></div>";

    html += '<header class="headword"><div class="headword-line"><h1 lang="en"><span>' + esc(t.term) + "</span></h1>" +
      tags.map(function (x) { return '<span class="pos-tag">' + esc(x) + "</span>"; }).join("") + "</div>" +
      (t.gloss ? '<p class="meaning ja">' + esc(t.gloss) + "</p>" : "") +
      '<p class="qa-line">' + qaBadge(t) + '<span class="qa-help">' + esc(QA_HELP[t.qa]) + "</span></p></header>";

    html += '<section class="sentence-card usage-card" aria-label="使われている場所">' +
      '<div class="card-head"><span class="card-num">' + esc(t.field) + "</span></div>" +
      (t.work || t.version ? '<p class="usage-work">' + (t.work && t.work !== t.field ? esc(t.work) : "") +
        (t.version ? '<span class="usage-version">' + esc(t.version) + "</span>" : "") + "</p>" : "");
    var body = "";
    if (t.note) body += '<p class="usage-note">' + esc(t.note) + "</p>";
    if (t.exEn) {
      var exLabel = t.domain === "tech" ? "例（Luna が作成。" + (t.verified === "direct" ? "出典で確認済み" : "未実行・未検証") + "）" : "出典からの短い引用";
      body += '<div class="usage-example"><span class="ex-label">' + exLabel + "</span>" +
        '<pre lang="en"><code>' + esc(t.exEn) + "</code></pre>" +
        (t.exJa ? '<p class="ex-ja">' + esc(t.exJa) + "</p>" : "") + "</div>";
    }
    html += hide
      ? '<div class="spoiler" data-spoiler><span class="spoiler-cover">ネタバレを含む説明です。タップで表示</span><div class="spoiler-body">' + body + "</div></div>"
      : body;
    if (t.where) html += '<p class="usage-where"><span>場所</span>' + esc(t.where) + "</p>";
    html += "</section>";

    var srcs = (t.src || []).map(function (i) { return TERM_SOURCES[i]; }).filter(Boolean);
    if (srcs.length) {
      html += '<h2 class="section-title">出典 ' + srcs.length + "</h2>";
      html += '<ul class="src-list">' + srcs.map(function (s) {
        var title = esc(s.title || s.url || "出典");
        return "<li>" + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + title + "</a>" : title) +
          (s.by ? '<span class="src-by">' + esc(s.by) + "</span>" : "") + "</li>";
      }).join("") + "</ul>";
    }

    if (t.duo) {
      html += '<h2 class="section-title">DUOにも載っている語</h2>';
      html += '<div class="word-list">' + t.duo.map(function (wid) {
        var w = wordById[wid];
        return '<button class="word-item" data-href="#/w/' + w.id + '"><span class="n">' + w.id + "</span>" +
          '<span><span class="w">' + esc(w.word) + '</span><span class="m ja">' + esc(w.meaning) + "</span></span>" +
          '<span class="p">例文 ' + pad3(w.sid) + "</span></button>";
      }).join("") + "</div>";
    }

    var nearby = TERMS.filter(function (x) { return x.field === t.field && x !== t; });
    var at = nearby.findIndex(function (x) { return x._n > t._n; });
    nearby = nearby.slice(Math.max(0, at), Math.max(0, at) + 8);
    if (nearby.length) {
      html += '<h2 class="section-title">' + esc(t.field) + " の用語</h2>";
      html += '<div class="word-list term-links">' + nearby.map(termItem).join("") + "</div>";
    }

    html += "</article>";
    $detail.innerHTML = html;
    $detail.scrollTop = 0;
  }

  var mobile = window.matchMedia("(max-width: 860px)");
  function randomSid() { return 1 + Math.floor(Math.random() * SENTENCES.length); }

  // ---------- routing ----------
  function route() {
    var m = location.hash.match(/^#\/(w|s|t)\/([\w-]+)$/);
    var valid = m && (m[1] === "w" ? wordById[m[2]] : m[1] === "t" ? termById[m[2]] : SENTENCES[+m[2] - 1]);
    if (valid) {
      state.current = m[1] + m[2];
      if (m[1] !== "t") save("duo.last", location.hash);
      if (m[1] === "t") renderTerm(m[2]);
      else renderDetail(m[1], m[2]);
      document.body.classList.add("show-detail");
    } else {
      state.current = null;
      // on phones the detail slides away, so keep its content until it is off screen
      if (!mobile.matches || !$detail.firstChild) renderDetail("s", randomSid(), { home: true });
      document.body.classList.remove("show-detail");
    }
    Array.prototype.forEach.call($results.querySelectorAll(".row"), function (r) {
      if (r.dataset.href === "#/" + (state.current ? state.current.replace(/^(\w)/, "$1/") : "")) r.setAttribute("aria-current", "true");
      else r.removeAttribute("aria-current");
    });
  }

  function go(href) {
    if (location.hash === href) route();
    else if (mobile.matches) { history.replaceState(null, "", href); route(); }
    else location.hash = href;
  }

  // ---------- events ----------
  var timer;
  function applyQuery() {
    clearTimeout(timer);
    if (state.q === $q.value) return;
    state.q = $q.value;
    state.limit = PAGE;
    renderList();
    $results.scrollTop = 0;
  }
  var $qClear = document.getElementById("q-clear");
  function syncClear() { $qClear.hidden = !$q.value; }
  $q.addEventListener("input", function () {
    syncClear();
    rememberSoon();
    clearTimeout(timer);
    timer = setTimeout(applyQuery, 90);
  });
  $qClear.addEventListener("click", function () {
    if ($q.value.trim() && $results.querySelector(".row")) rememberTyped($q.value);
    clearTimeout(typedTimer);
    $q.value = "";
    syncClear();
    applyQuery();
    $q.focus();
  });
  $q.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyQuery();
      clearTimeout(typedTimer);
      rememberTyped($q.value);
      var first = $results.querySelector(".row");
      if (first) { go(first.dataset.href); $q.blur(); }
    } else if (e.key === "Escape") {
      $q.blur();
    }
  });

  // remember a search once the typing pauses, and when leaving the field
  var typedTimer;
  function rememberSoon() {
    clearTimeout(typedTimer);
    typedTimer = setTimeout(function () { if ($q.value.trim() && $results.querySelector(".row")) rememberTyped($q.value); }, 1500);
  }
  $q.addEventListener("blur", function () { if ($q.value.trim() && $results.querySelector(".row")) { clearTimeout(typedTimer); rememberTyped($q.value); } });

  $tabs.forEach(function (t) {
    t.addEventListener("click", function () { setTab(t.dataset.tab); });
  });

  $posFilter.addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (!b) return;
    if (state.tab === "terms") state.field = b.dataset.filter;
    else if (state.tab === "sentences") state.color = b.dataset.filter;
    else state.pos = b.dataset.filter;
    state.limit = PAGE;
    renderFilter();
    renderListAnimated();
    $results.scrollTop = 0;
  });

  $results.addEventListener("click", function (e) {
    if (Date.now() < noClickUntil) return;
    if (e.target.closest("[data-recent-clear]")) {
      recents = [];
      save("duo.recent", "[]");
      renderList();
      return;
    }
    var rec = e.target.closest("[data-recent]");
    if (rec) {
      $q.value = rec.dataset.recent;
      syncClear();
      applyQuery();
      remember($q.value);
      $q.blur();
      return;
    }
    if (e.target.closest(".swipe-tray")) {
      var sw = e.target.closest("[data-tint]");
      if (sw && tray) { setColor(tray.row.dataset.csid, sw.dataset.tint); setTimeout(closeTray, 220); }
      return;
    }
    var row = e.target.closest("[data-href]");
    if (row) {
      if (state.q.trim()) remember(state.q);
      return go(row.dataset.href);
    }
    if (e.target.closest("[data-more]")) { state.limit += PAGE; renderList(); return; }
    var sw = e.target.closest("[data-switch]");
    if (sw) { setTab(sw.dataset.switch); return; }
    if (e.target.closest("[data-clear-filter]")) {
      if (state.tab === "terms") state.field = ""; else if (state.tab === "sentences") state.color = ""; else state.pos = "";
      renderFilter();
      renderList();
    }
  });

  // ---------- list: swipe a row to the right and colored glass comes out on the left ----------
  var TRAY_W = 184, rs = null, tray = null, noClickUntil = 0;
  function openTray(row) {
    closeTray(true);
    var el = document.createElement("div");
    el.className = "swipe-tray dragging";
    el.setAttribute("role", "radiogroup");
    el.setAttribute("aria-label", (row.dataset.csid.charAt(0) === "w" ? "単語 " + row.dataset.csid.slice(1) : "例文 " + row.dataset.csid) + " の色");
    el.innerHTML = '<div class="swipe-tray-in" style="width:' + (TRAY_W - 8) + 'px">' + swatches(colorOf(row.dataset.csid)) + "</div>";
    el.style.cssText = "top:" + row.offsetTop + "px;left:" + row.offsetLeft + "px;height:" + row.offsetHeight + "px";
    row.parentNode.insertBefore(el, row);
    tray = { el: el, row: row };
  }
  // the glass is exactly as wide as the gap the row leaves (8px short of it)
  function trayTo(dx) {
    tray.el.style.width = Math.max(0, dx - 8) + "px";
    tray.el.style.setProperty("--t", Math.min(1, dx / TRAY_W).toFixed(3));
  }
  function closeTray(now) {
    if (!tray) return;
    var t = tray;
    tray = null;
    t.row.classList.remove("swiping");
    t.row.style.transform = "";
    t.el.classList.remove("open", "dragging");
    t.el.style.width = "0px";
    t.el.style.setProperty("--t", 0);
    $results.scrollLeft = 0;
    if (now) t.el.remove();
    else setTimeout(function () { t.el.remove(); }, 450);
  }
  $results.addEventListener("touchstart", function (e) {
    rs = null;
    if (e.touches.length !== 1) return;
    if (tray && e.target.closest(".swipe-tray")) return;
    var row = e.target.closest(".row[data-csid]");
    if (tray && row !== tray.row) {
      // a tap anywhere else just puts the row back
      closeTray();
      noClickUntil = Date.now() + 500;
      return;
    }
    if (!row) return;
    // base: where the row starts — 0, or TRAY_W when it is already open and is being pushed back
    rs = { row: row, x: e.touches[0].clientX, y: e.touches[0].clientY, base: tray ? TRAY_W : 0, dx: tray ? TRAY_W : 0, on: false };
  }, { passive: true });
  $results.addEventListener("touchmove", function (e) {
    if (!rs) return;
    var t = e.touches[0], mx = t.clientX - rs.x, my = t.clientY - rs.y;
    if (!rs.on) {
      if (Math.abs(my) > 10 && Math.abs(my) >= Math.abs(mx)) { rs = null; return; }
      if (!rs.base && mx < -10) { rs = null; return; }
      if (Math.abs(mx) < 10) return;
      rs.on = true;
      if (!tray) openTray(rs.row);
      tray.el.classList.remove("open");
      tray.el.classList.add("dragging");
      rs.row.classList.add("swiping");
    }
    e.preventDefault();
    var x = rs.base + mx;
    rs.dx = x <= TRAY_W ? Math.max(0, x) : TRAY_W + (x - TRAY_W) / 4;
    rs.row.style.transform = "translateX(" + rs.dx + "px)";
    trayTo(rs.dx);
  }, { passive: false });
  function endRowSwipe() {
    var s = rs;
    rs = null;
    if (!s) return;
    if (!s.on) {
      // a tap on the open row puts it back
      if (s.base) { closeTray(); noClickUntil = Date.now() + 500; }
      return;
    }
    noClickUntil = Date.now() + 400;
    s.row.classList.remove("swiping");
    if (!tray) return;
    tray.el.classList.remove("dragging");
    if (s.dx > TRAY_W * (s.base ? .7 : .42)) {
      s.row.style.transform = "translateX(" + TRAY_W + "px)";
      trayTo(TRAY_W);
      tray.el.classList.add("open");
    } else closeTray();
  }
  $results.addEventListener("touchend", endRowSwipe);
  $results.addEventListener("touchcancel", endRowSwipe);
  $results.addEventListener("scroll", function () { if (tray && !rs) closeTray(); }, { passive: true });

  // ---------- sentence search on the detail screen (phones) ----------
  var seekQuery = "", seekTimer;
  function seekEl() { return $detail.querySelector(".seek"); }
  function openSeek() {
    var el = seekEl();
    if (!el) return;
    var input = el.querySelector(".seek-input");
    el.classList.add("open");
    el.parentNode.classList.add("seeking");
    input.tabIndex = 0;
    input.value = seekQuery;
    input.focus(); // must happen inside the tap for the iPhone keyboard to come up
    if (seekQuery) input.select();
    renderSeek();
  }
  function closeSeek() {
    var el = seekEl();
    if (!el || !el.classList.contains("open")) return;
    var input = el.querySelector(".seek-input");
    clearTimeout(seekTimer);
    input.blur();
    input.tabIndex = -1;
    el.classList.remove("open", "has-results");
    el.parentNode.classList.remove("seeking");
  }
  function fitSeek(el) {
    var vv = window.visualViewport, bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
    el.style.setProperty("--seek-max", Math.max(140, bottom - el.getBoundingClientRect().top - 46 - 14) + "px");
  }
  function renderSeek() {
    var el = seekEl();
    if (!el) return;
    var input = el.querySelector(".seek-input"), list = el.querySelector(".seek-list");
    seekQuery = input.value;
    var raw = seekQuery.trim(), q = norm(raw);
    if (!q) {
      // nothing typed yet: the recent searches
      if (!recents.length) { el.classList.remove("has-results"); return; }
      list.innerHTML = '<p class="seek-cap">最近の検索</p>' + recents.map(function (r, n) {
        return '<button type="button" class="seek-row seek-recent" data-seek-recent="' + esc(r) + '" style="--i:' + n + '">' +
          '<span class="seek-num">' + ICON.clock + '</span><span class="seek-en">' + esc(r) + "</span></button>";
      }).join("");
      list.scrollTop = 0;
      fitSeek(el);
      el.classList.add("has-results");
      return;
    }
    var hits = searchSentences(q, parseRange(raw)), LIMIT = 60;
    list.innerHTML = hits.length
      ? hits.slice(0, LIMIT).map(function (s, n) {
          return '<button type="button" class="seek-row" data-seek-go="' + s.id + '"' + colorAttrs(s.id) + (s.id === lastSid ? ' aria-current="true"' : "") +
            (n < 12 ? ' style="--i:' + n + '"' : "") + ">" +
            '<span class="seek-num">#' + pad3(s.id) + "</span>" +
            '<span class="seek-en en" lang="en">' + markQuery(s.en, raw) + "</span>" +
            '<span class="seek-ja ja">' + markQuery(s.ja, raw) + "</span></button>";
        }).join("") + (hits.length > LIMIT ? '<p class="seek-note">ほか ' + (hits.length - LIMIT) + " 件。もう少し絞り込んでください</p>" : "")
      : '<p class="seek-note">「' + esc(raw) + "」を含む例文はありません</p>";
    list.scrollTop = 0;
    fitSeek(el);
    el.classList.add("has-results");
  }
  $detail.addEventListener("submit", function (e) {
    var form = e.target.closest(".note-key");
    if (!form) return;
    e.preventDefault();
    var key = form.querySelector("input").value.trim();
    if (!key) return;
    notesKey = key;
    notesChecked = {};
    save("duo.notesKey", key);
    form.querySelector("input").blur();
    showNote();
  });
  $detail.addEventListener("input", function (e) {
    if (!e.target.classList.contains("seek-input")) return;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(renderSeek, 80);
  });
  $detail.addEventListener("keydown", function (e) {
    if (!e.target.classList.contains("seek-input")) return;
    if (e.key === "Escape") { e.preventDefault(); closeSeek(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      renderSeek();
      remember(seekQuery);
      var first = $detail.querySelector(".seek-row");
      if (first) first.click();
    }
  });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", function () {
    var el = seekEl();
    if (el && el.classList.contains("has-results")) fitSeek(el);
  });

  // ---------- top-bar pop-outs: the gauge and the color drop ----------
  function topBar() { return $detail.querySelector(".detail-top"); }
  function closePops() {
    var bar = topBar();
    if (!bar) return;
    var g = bar.querySelector(".gauge.open"), t = bar.querySelector(".tint.open");
    if (g) g.classList.remove("open");
    if (t) t.classList.remove("open");
    bar.classList.remove("gauging", "tinting");
    gauge = null;
  }
  function openTint() {
    var el = $detail.querySelector(".tint");
    if (!el) return;
    closeSeek(); closePops();
    el.classList.add("open");
    topBar().classList.add("tinting");
  }
  function setColor(key, c) {
    key = String(key);
    if (c) colors[key] = c; else delete colors[key];
    save("duo.colors", JSON.stringify(colors));
    // repaint everything that shows this sentence's (or word's) color, in place
    Array.prototype.forEach.call(document.querySelectorAll('[data-csid="' + key + '"]'), function (el) {
      if (c) el.dataset.color = c; else delete el.dataset.color;
    });
    var tint = $detail.querySelector(".tint");
    if (tint && key === curKey) {
      if (c) tint.dataset.color = c; else delete tint.dataset.color;
      Array.prototype.forEach.call(tint.querySelectorAll(".sw"), function (sw) { sw.setAttribute("aria-checked", String(sw.dataset.tint === c)); });
    }
    var strip = $detail.querySelector(".gauge-strip");
    if (strip) strip.outerHTML = colorStrip();
    if (state.tab === "sentences") renderFilter();
  }

  var gauge = null; // the open gauge: which block of 20 is shown
  function openGauge() {
    var el = $detail.querySelector(".gauge");
    if (!el) return;
    closeSeek(); closePops();
    gauge = { el: el, block: -1, sid: lastSid };
    showBlock(Math.floor((lastSid - 1) / BLOCK));
    gaugeShow(lastSid);
    el.classList.add("open");
    topBar().classList.add("gauging");
  }
  function showBlock(k) {
    if (!gauge || k === gauge.block) return;
    gauge.block = k;
    var from = k * BLOCK + 1, to = Math.min(SENTENCES.length, from + BLOCK - 1), html = "";
    for (var id = from; id <= to; id++) {
      html += '<button type="button" data-cell="' + id + '"' + colorAttrs(id) + (id === lastSid ? ' aria-current="true"' : "") + ">" + id + "</button>";
    }
    var cells = gauge.el.querySelector("[data-cells]");
    cells.innerHTML = html;
    cells.style.setProperty("--rows", Math.ceil((to - from + 1) / 10));
    Array.prototype.forEach.call(gauge.el.querySelectorAll("[data-b]"), function (b) {
      b.classList.toggle("sel", +b.dataset.b === k);
      b.classList.toggle("cur", +b.dataset.b === Math.floor((lastSid - 1) / BLOCK));
    });
    gauge.el.querySelector(".gauge-range").textContent = from + "–" + to;
  }
  function gaugeShow(sid) {
    gauge.sid = sid;
    gauge.el.querySelector(".gauge-num").textContent = "#" + pad3(sid);
    var peek = peekText(sid), $peek = gauge.el.querySelector(".gauge-peek");
    $peek.textContent = peek.text;
    $peek.classList.toggle("en", peek.en);
    Array.prototype.forEach.call(gauge.el.querySelectorAll("[data-cell]"), function (c) { c.classList.toggle("hot", +c.dataset.cell === sid); });
  }
  // press and slide: the top row picks a block of 20, the grid below picks the sentence; letting go there moves to it
  var gp = null;
  function gaugeAt(e) {
    var r = gp.area.getBoundingClientRect();
    var fx = Math.min(Math.max((e.clientX - r.left) / r.width, 0), .9999);
    if (gp.kind === "blocks") {
      var k = Math.floor(fx * Math.ceil(SENTENCES.length / BLOCK));
      showBlock(k);
      gaugeShow(Math.min(SENTENCES.length, k * BLOCK + 1 + (gauge.sid - 1) % BLOCK));
    } else {
      var rows = +gp.area.style.getPropertyValue("--rows") || 2;
      var fy = Math.min(Math.max((e.clientY - r.top) / r.height, 0), .9999);
      var sid = gauge.block * BLOCK + 1 + Math.floor(fy * rows) * 10 + Math.floor(fx * 10);
      gaugeShow(Math.min(sid, SENTENCES.length, (gauge.block + 1) * BLOCK));
    }
  }

  var lastNumTap = 0;
  $detail.addEventListener("click", function (e) {
    var t, seek = seekEl(), bar = topBar();
    if (seek && seek.classList.contains("open") && !e.target.closest(".seek, [data-back]")) { closeSeek(); return; }
    if (bar && bar.matches(".gauging, .tinting") && !e.target.closest(".gauge.open, .tint.open")) {
      closePops();
      if (!e.target.closest(".detail-top [data-back], .detail-top [data-seek-open], .detail-top [data-gauge-open]")) return;
    }
    if (e.target.closest("[data-seek-open]")) { if (seek.classList.contains("open")) seek.querySelector(".seek-input").focus(); else openSeek(); return; }
    if (e.target.closest("[data-seek-close]")) { closeSeek(); return; }
    if ((t = e.target.closest("[data-seek-recent]"))) {
      var input = seek.querySelector(".seek-input");
      input.value = t.dataset.seekRecent;
      renderSeek();
      return;
    }
    if ((t = e.target.closest("[data-seek-go]"))) {
      var to = +t.dataset.seekGo;
      remember(seekQuery);
      closeSeek();
      if (to !== lastSid) go("#/s/" + to);
      return;
    }
    if (e.target.closest("[data-gauge-open]")) { if (e.target.closest(".gauge.open")) closePops(); else openGauge(); return; }
    if (e.target.closest("[data-gauge-close]")) { closePops(); return; }
    if (e.target.closest(".gauge")) return;
    if (e.target.closest("[data-tint-open]")) { if (e.target.closest(".tint.open")) closePops(); else openTint(); return; }
    if ((t = e.target.closest("[data-hide]"))) {
      if (t.dataset.hide === "ja") setHideJa(!document.body.classList.contains("hide-ja"));
      else setHideEn(!document.body.classList.contains("hide-en"));
      return;
    }
    if ((t = e.target.closest("[data-tint]"))) {
      setColor(curKey, t.dataset.tint);
      setTimeout(closePops, 260); // let the choice show before the drop closes
      return;
    }
    if ((t = e.target.closest("[data-say]"))) { if (Date.now() > sayHoldGuard) say(+t.closest(".sentence-card").dataset.sid); return; }
    if ((t = e.target.closest("[data-syn]"))) {
      synOn = !synOn;
      save("duo.syn", synOn ? "1" : "0");
      t.setAttribute("aria-pressed", synOn);
      var sc = t.closest(".sentence-card");
      if (synOn) drawSyntax(sc, 0);
      else { clearTimeout(sc._synTimer); sc.classList.remove("syn", "syn-in"); }
      return;
    }
    if ((t = e.target.closest(".dock .nav-btn")) && t.closest(".reveal")) {
      if (Date.now() > rvGuard) revealStep(t.classList.contains("dock-r") ? 1 : -1);
      return;
    }
    if ((t = e.target.closest(".dock .nav-btn")) && Date.now() < rvGuard) return;
    // English: just the tapped word. Japanese: anywhere on it shows all of it at once, as it always did
    if ((t = e.target.closest(".rv .wd, .rv .sentence-ja")) && rv.card) {
      var nEn = +rv.card.dataset.nen, k;
      if (t.classList.contains("wd") && +t.dataset.k < nEn) {
        if (rv.b[+t.dataset.k] > 0) { rv.b[+t.dataset.k] = 0; paintReveal(); return; }
      } else if (rv.b.slice(nEn).some(function (x) { return x > 0; })) {
        for (k = nEn; k < rv.b.length; k++) rv.b[k] = 0;
        paintReveal();
        return;
      }
    }
    if (e.target.closest(".dock-num, .card-num")) {
      var now = Date.now();
      if (now - lastNumTap < 400) { lastNumTap = 0; openDial(); } else lastNumTap = now;
      return;
    }
    if ((t = e.target.closest(".hide-ja .ja, .hide-en .en")) && !t.classList.contains("shown")) {
      t.classList.add("shown");
      return;
    }
    if ((t = e.target.closest("[data-spoiler]")) && !t.classList.contains("shown")) { t.classList.add("shown"); return; }
    // while the sentence is hidden its explanation is blurred too; a tap shows it
    if ((t = e.target.closest(".note-body")) && !t.classList.contains("shown") && document.body.matches(".hide-en, .hide-ja")) { t.classList.add("shown"); e.preventDefault(); return; }
    if ((t = e.target.closest("[data-nt-fold]"))) {
      ntSentOpen = !ntSentOpen;
      save("duo.ntSent", ntSentOpen ? "1" : "0");
      t.parentNode.classList.toggle("closed", !ntSentOpen);
      t.setAttribute("aria-expanded", ntSentOpen);
      return;
    }
    if ((t = e.target.closest("[data-nt-tab]"))) {
      var card = t.closest(".nw"), tabs = card.querySelectorAll("[data-nt-tab]");
      ntTab = t.dataset.ntTab;
      Array.prototype.forEach.call(tabs, function (b, i) {
        b.setAttribute("aria-selected", b === t);
        if (b === t) t.parentNode.style.setProperty("--k", i);
      });
      Array.prototype.forEach.call(card.querySelectorAll(".nw-pane"), function (p) { p.hidden = p.dataset.pane !== ntTab; });
      return;
    }
    if (e.target.closest("[data-note-rekey]")) {
      var nb = e.target.closest(".note-body");
      nb.innerHTML = keyForm();
      nb.querySelector("input").focus();
      return;
    }
    if ((t = e.target.closest(".hl"))) { go("#/w/" + t.dataset.wid); return; }
    if ((t = e.target.closest("[data-href]"))) { go(t.dataset.href); return; }
    if ((t = e.target.closest("[data-go]"))) { go("#/s/" + t.dataset.go); return; }
    if (e.target.closest("[data-shuffle]")) { renderDetail("s", randomSid(), { home: true, shuffle: true }); return; }
    if (e.target.closest("[data-back]")) { go("#/"); }
  });

  // Hovering a word in the list lights up its marker in the sentence
  $detail.addEventListener("mouseover", function (e) {
    var item = e.target.closest(".word-item");
    Array.prototype.forEach.call($detail.querySelectorAll(".hl"), function (h) {
      h.classList.toggle("hover", !!item && h.dataset.wid === item.dataset.wid);
    });
  });

  function railSid(rail, e) {
    var r = rail.getBoundingClientRect();
    var x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    return Math.round(x / r.width * (SENTENCES.length - 1)) + 1;
  }
  $detail.addEventListener("mousemove", function (e) {
    var rail = e.target.closest("[data-rail]");
    if (!rail) return;
    rail.dataset.hover = "#" + pad3(railSid(rail, e));
    rail.style.setProperty("--hx", (e.clientX - rail.getBoundingClientRect().left) + "px");
  });

  // ---------- rail: press and drag to scrub through the 560 sentences ----------
  var scrub = null;
  function scrubTo(e) {
    var sid = railSid(scrub.rail, e);
    if (sid === scrub.sid) return;
    scrub.sid = sid;
    scrub.rail.style.setProperty("--p", (sid - 1) / (SENTENCES.length - 1));
    scrub.rail.setAttribute("aria-valuenow", sid);
    scrub.label.textContent = "#" + pad3(sid);
    scrub.peek.innerHTML = "<b>#" + pad3(sid) + "</b>" + esc(peekText(sid).text);
  }
  // rubbing the dock while the sentence is hidden clears it little by little (about one word per 44px of finger travel)
  var rub = null;
  $detail.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var area = e.target.closest("[data-blocks], [data-cells]");
    if (area && gauge) {
      e.preventDefault();
      try { area.setPointerCapture(e.pointerId); } catch (err) {}
      gp = { area: area, kind: area.hasAttribute("data-blocks") ? "blocks" : "cells" };
      gaugeAt(e);
      return;
    }
    var dock = e.target.closest(".dock.reveal");
    // no pointer capture here: it would take the tap away from the ‹ › buttons
    if (dock) rub = { dock: dock, x: e.clientX, y: e.clientY, path: 0 };
  });
  $detail.addEventListener("pointermove", function (e) {
    if (gp) { gaugeAt(e); return; }
    if (!rub) return;
    var d = Math.hypot(e.clientX - rub.x, e.clientY - rub.y);
    rub.x = e.clientX; rub.y = e.clientY;
    rub.path += d;
    if (rub.path < 10) return;
    rub.dock.classList.add("rubbing");
    rub.dock.style.setProperty("--rx", (e.clientX - rub.dock.getBoundingClientRect().left) + "px");
    revealBy(d / 44);
  });
  function endRub(e) {
    if (gp) {
      var g = gp;
      gp = null;
      if (g.kind === "cells" && e.type === "pointerup" && gauge) {
        var to = gauge.sid;
        closePops();
        if (to !== lastSid) go("#/s/" + to);
      }
    }
    if (rub) {
      rub.dock.classList.remove("rubbing");
      if (rub.path >= 10) rvGuard = Date.now() + 350; // a rub is not a tap
      rub = null;
    }
  }
  $detail.addEventListener("pointerup", endRub);
  $detail.addEventListener("pointercancel", endRub);

  $detail.addEventListener("pointerdown", function (e) {
    var rail = e.target.closest("[data-rail]");
    if (!rail || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    try { rail.setPointerCapture(e.pointerId); } catch (err) {}
    scrub = { rail: rail, sid: 0, label: rail.querySelector(".rail-label"), peek: rail.querySelector(".rail-peek") };
    rail.classList.add("dragging");
    scrubTo(e);
  });
  $detail.addEventListener("pointermove", function (e) { if (scrub) scrubTo(e); });
  function endScrub(e) {
    if (!scrub) return;
    var s = scrub;
    scrub = null;
    s.rail.classList.remove("dragging");
    if (e.type === "pointerup" && s.sid !== lastSid) {
      lastP = (s.sid - 1) / (SENTENCES.length - 1); // the new rail starts where the finger let go
      go("#/s/" + s.sid);
    } else {
      s.rail.style.setProperty("--p", lastP);
      s.label.textContent = "#" + pad3(lastSid);
    }
  }
  $detail.addEventListener("pointerup", endScrub);
  $detail.addEventListener("pointercancel", endScrub);

  // ---------- hold the speaker: a liquid dial. Up: speed, down: volume, left: "together with music" ----------
  // The page dims and blurs, the speaker lifts off, and three drops ooze out of it. The lifted drop follows the finger on a
  // spring and melts into whichever drop it reaches; letting go near the middle changes nothing. Let go on speed or volume
  // and that drop swells into a slider in the middle of the screen (the speaker sits at the edge, where a finger has no room
  // to slide); let go on the note and the music setting flips.
  var SAY_HOLD = 340, SAY_R = 86, sayHold = null, sayHoldGuard = 0;
  var SAY_OPTS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }
  };
  function sayGoo() {
    if (document.getElementById("say-goo")) return;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    // blur the drops together, then cut the blur back to a hard edge: where two drops come close they bridge like liquid
    svg.innerHTML = '<filter id="say-goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b"/>' +
      '<feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="g"/>' +
      '<feComposite in="SourceGraphic" in2="g" operator="atop"/></filter>';
    document.body.appendChild(svg);
  }
  function sayOptText(o, hot) {
    if (o === "left") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>' +
      "<small>" + (hot ? (sayMix ? "オフにする" : "音楽と一緒に") : (sayMix ? "音楽と一緒 ON" : "音楽と一緒に")) + "</small>";
    var sc = SAY_SCALES[o];
    return "<b>" + sc.text(o === "up" ? sayRate : sayVol) + "</b><small>" + (hot ? "離して調整" : sc.label) + "</small>";
  }
  function sayDialHint(pick) {
    if (!pick) return "上 速度　下 音量　左 音楽と一緒に";
    if (pick === "left") return sayMix ? "音楽を止めて再生に戻す" : "音楽を流したまま再生（消音モードでは鳴りません）";
    return pick === "up" ? "離すと速度を選べます（声の高さはそのまま）" : "離すと声の音量を選べます";
  }
  function openSayDial() {
    var h = sayHold;
    if (!h) return;
    sayGoo();
    var r = h.btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    // keep the three drops on screen: the dial may sit a little away from the speaker, and the lifted drop glides there
    var cx = Math.max(SAY_R + 44, Math.min(vw - 44, r.left + r.width / 2));
    var cy = Math.max(SAY_R + 64, Math.min(vh - SAY_R - 64, r.top + r.height / 2));
    var el = document.createElement("div");
    el.className = "sayd";
    el.style.setProperty("--cx", cx + "px");
    el.style.setProperty("--cy", cy + "px");
    el.style.setProperty("--r", SAY_R + "px");
    var blobs = "", ui = "";
    Object.keys(SAY_OPTS).forEach(function (o, i) {
      var on = o === "left" ? sayMix : o === "up" ? sayRate !== 1 : sayVol !== 1;
      blobs += '<i class="sayd-drop" data-o="' + o + '" style="--ox:' + SAY_OPTS[o].x + ";--oy:" + SAY_OPTS[o].y + ";--i:" + i + '"></i>';
      ui += '<span class="sayd-opt' + (on ? " on" : "") + '" data-o="' + o + '" style="--ox:' + SAY_OPTS[o].x + ";--oy:" + SAY_OPTS[o].y + ";--i:" + i + '">' + sayOptText(o, false) + "</span>";
    });
    el.innerHTML = '<div class="sayd-veil"></div>' +
      '<div class="sayd-stage"><div class="sayd-goo">' + blobs + '<i class="sayd-drop knob"></i></div>' +
      '<div class="sayd-ui">' + ui + '<span class="sayd-knob">' + ICON.say + "</span></div></div>" +
      '<p class="sayd-hint">' + sayDialHint(null) + "</p>";
    document.body.appendChild(el);
    h.btn.classList.add("held");
    document.documentElement.classList.add("say-holding");
    try { window.getSelection().removeAllRanges(); } catch (err) {}
    // the drop starts where the speaker is and glides to the dial's middle
    var d = { el: el, cx: cx, cy: cy, px: r.left + r.width / 2 - cx, py: r.top + r.height / 2 - cy, vx: 0, vy: 0, pick: null, raf: 0, closing: false,
      knob: el.querySelector(".sayd-drop.knob"), knobUi: el.querySelector(".sayd-knob"), hint: el.querySelector(".sayd-hint") };
    h.dial = d;
    void el.offsetWidth;
    el.classList.add("open");
    sayDialFrame();
  }
  // a spring pulls the drop toward the finger; past the ring it only gives a little, like stretched rubber
  function sayDialFrame() {
    var h = sayHold, d = h && h.dial;
    if (!d || d.closing) return;
    var mx = h.fx - h.x0, my = h.fy - h.y0, len = Math.hypot(mx, my);
    var reach = len <= SAY_R ? len : SAY_R + (len - SAY_R) * .22, tx = len ? mx / len * reach : 0, ty = len ? my / len * reach : 0;
    d.vx = (d.vx + (tx - d.px) * .2) * .7;
    d.vy = (d.vy + (ty - d.py) * .2) * .7;
    d.px += d.vx; d.py += d.vy;
    var sp = Math.min(.32, Math.hypot(d.vx, d.vy) * .028), ang = Math.atan2(d.vy, d.vx) * 180 / Math.PI;
    var tf = "translate(" + d.px.toFixed(1) + "px," + d.py.toFixed(1) + "px)";
    d.knob.style.transform = tf + " rotate(" + ang.toFixed(1) + "deg) scale(" + (1 + sp).toFixed(3) + "," + (1 - sp * .55).toFixed(3) + ")";
    d.knobUi.style.transform = tf;
    // the speaker fades as the drop melts into a choice, so the choice's own label reads clearly
    d.knobUi.style.opacity = Math.max(0, Math.min(1, 1 - (Math.hypot(d.px, d.py) - SAY_R * .3) / (SAY_R * .4))).toFixed(2);
    var pick = null;
    if (len > SAY_R * .42) {
      if (Math.abs(my) >= Math.abs(mx)) pick = my < 0 ? "up" : "down";
      else if (mx < 0) pick = "left";
    }
    if (pick !== d.pick) {
      if (d.pick) {
        d.el.querySelector('.sayd-drop[data-o="' + d.pick + '"]').classList.remove("hot");
        var was = d.el.querySelector('.sayd-opt[data-o="' + d.pick + '"]');
        was.classList.remove("hot"); was.innerHTML = sayOptText(d.pick, false);
      }
      if (pick) {
        d.el.querySelector('.sayd-drop[data-o="' + pick + '"]').classList.add("hot");
        var now = d.el.querySelector('.sayd-opt[data-o="' + pick + '"]');
        now.classList.add("hot"); now.innerHTML = sayOptText(pick, true);
      }
      d.el.classList.toggle("picking", !!pick);
      d.hint.textContent = sayDialHint(pick);
      d.pick = pick;
    }
    d.raf = requestAnimationFrame(sayDialFrame);
  }
  function closeSayDial(commit) {
    var h = sayHold, d = h && h.dial;
    sayHold = null;
    if (!d) return;
    d.closing = true;
    cancelAnimationFrame(d.raf);
    var pick = commit ? d.pick : null;
    if (pick === "left") { sayMix = !sayMix; saveSayPref(); sayBadges(); }
    // speed / volume: the chosen drop swells into the slider panel
    else if (pick) openSayPanel(pick, d.cx + SAY_OPTS[pick].x * SAY_R, d.cy + SAY_OPTS[pick].y * SAY_R, +h.btn.closest(".sentence-card").dataset.sid);
    // the chosen drop swallows the lifted one, then everything flows back into the speaker
    if (pick) {
      var o = SAY_OPTS[pick];
      d.knob.style.transform = d.knobUi.style.transform = "translate(" + o.x * SAY_R + "px," + o.y * SAY_R + "px)";
      d.el.querySelector('.sayd-opt[data-o="' + pick + '"]').classList.add("chosen");
      d.el.querySelector('.sayd-drop[data-o="' + pick + '"]').classList.add("chosen");
    }
    d.el.classList.add(pick ? "done" : "cancel");
    setTimeout(function () {
      d.el.classList.remove("open");
      d.knob.style.transform = d.knobUi.style.transform = d.knobUi.style.opacity = "";
      h.btn.classList.remove("held");
      if (!sayPanel) document.documentElement.classList.remove("say-holding");
      if (pick === "left") { h.btn.classList.remove("set"); void h.btn.offsetWidth; h.btn.classList.add("set"); }
      setTimeout(function () { d.el.remove(); }, 460);
    }, pick ? 200 : 0);
  }
  // the slider panel for speed or volume: drag the drop along the track, or tap a mark; each step takes effect at once
  // (the volume even while the voice is playing). 試し聞き plays this sentence with it; 完了 or a tap outside closes it.
  var sayPanel = null;
  function openSayPanel(kind, fromX, fromY, sid) {
    closeSayPanel(true);
    var sc = SAY_SCALES[kind], n = Math.round((sc.max - sc.min) / sc.step), ticks = "";
    var at = function (v) { return ((v - sc.min) / (sc.max - sc.min)).toFixed(4); };
    for (var i = 0; i <= n; i++) {
      var v = sayRound(sc.min + i * sc.step);
      ticks += '<i class="sayp-tick' + (v === 1 ? " one" : "") + '" style="--t:' + at(v) + '"></i>';
    }
    var el = document.createElement("div");
    el.className = "saypw";
    el.style.setProperty("--fx", Math.round(fromX - window.innerWidth / 2) + "px");
    el.style.setProperty("--fy", Math.round(fromY - window.innerHeight / 2) + "px");
    el.innerHTML = '<div class="saypw-veil" data-sayp="close"></div>' +
      '<section class="sayp" role="dialog" aria-label="' + sc.label + '">' +
        '<p class="sayp-title">' + sc.label + "<small>" + (kind === "up" ? "声の高さはそのまま" : "声だけの大きさ") + "</small></p>" +
        '<p class="sayp-val"></p>' +
        '<div class="sayp-track" data-sayp="track"><i class="sayp-rail"></i><i class="sayp-fill"></i>' + ticks + '<i class="sayp-thumb"></i></div>' +
        '<div class="sayp-scale"><span style="--t:0">' + sc.text(sc.min) + '</span><span style="--t:' + at(1) + '">' + sc.text(1) +
          '</span><span style="--t:1">' + sc.text(sc.max) + "</span></div>" +
        '<div class="sayp-row"><button type="button" data-sayp="reset">' + sc.text(1) + ' に戻す</button>' +
          '<button type="button" data-sayp="try">' + ICON.say + "試し聞き</button>" +
          '<button type="button" class="ok" data-sayp="close">完了</button></div>' +
      "</section>";
    document.body.appendChild(el);
    document.documentElement.classList.add("say-holding");
    sayPanel = { el: el, kind: kind, sid: sid, v: null, drag: null,
      val: el.querySelector(".sayp-val"), thumb: el.querySelector(".sayp-thumb"), track: el.querySelector(".sayp-track"),
      reset: el.querySelector('[data-sayp="reset"]') };
    sayPanelSet(kind === "up" ? sayRate : sayVol, true);
    void el.offsetWidth;
    el.classList.add("open");
    var p = sayPanel;
    el.addEventListener("click", function (e) {
      var t = e.target.closest("[data-sayp]");
      if (!t || p !== sayPanel) return;
      var what = t.dataset.sayp;
      if (what === "close") closeSayPanel();
      else if (what === "reset") sayPanelSet(1);
      else if (what === "try") say(p.sid);
    });
    p.track.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try { p.track.setPointerCapture(e.pointerId); } catch (err) {}
      p.drag = e.pointerId;
      el.classList.add("dragging");
      sayPanelAt(e.clientX);
    });
    p.track.addEventListener("pointermove", function (e) { if (p.drag === e.pointerId) sayPanelAt(e.clientX); });
    function stop(e) { if (p.drag === e.pointerId) { p.drag = null; el.classList.remove("dragging"); } }
    p.track.addEventListener("pointerup", stop);
    p.track.addEventListener("pointercancel", stop);
    el.addEventListener("touchstart", function (e) { if (e.target.closest(".sayp-track")) e.preventDefault(); }, { passive: false });
  }
  function sayPanelAt(x) {
    var p = sayPanel, sc = p && SAY_SCALES[p.kind];
    if (!p) return;
    var r = p.track.getBoundingClientRect(), t = Math.max(0, Math.min(1, (x - r.left) / r.width));
    sayPanelSet(sc.min + t * (sc.max - sc.min));
  }
  function sayPanelSet(v, first) {
    var p = sayPanel, sc = SAY_SCALES[p.kind];
    v = sayRound(sayStep(v, sc));
    if (v === p.v) return;
    p.v = v;
    p.el.style.setProperty("--v", ((v - sc.min) / (sc.max - sc.min)).toFixed(4));
    p.val.textContent = sc.text(v);
    p.reset.disabled = v === 1;
    if (first) return;
    if (p.kind === "up") sayRate = v;
    else {
      sayVol = v;
      if (playing && playing.gain && actx) { try { playing.gain.gain.setTargetAtTime(v, actx.currentTime, .03); } catch (e) {} }
    }
    saveSayPref();
    sayBadges();
    // each step: the drop wobbles like liquid and the number pops
    p.thumb.classList.remove("blob"); p.val.classList.remove("pop");
    void p.thumb.offsetWidth;
    p.thumb.classList.add("blob"); p.val.classList.add("pop");
  }
  function closeSayPanel(now) {
    var p = sayPanel;
    sayPanel = null;
    if (!p) return;
    document.documentElement.classList.remove("say-holding");
    if (now) { p.el.remove(); return; }
    p.el.classList.add("closing");
    p.el.classList.remove("open");
    var btn = $detail.querySelector('.sentence-card[data-sid="' + p.sid + '"] [data-say]');
    if (btn) { btn.classList.remove("set"); void btn.offsetWidth; btn.classList.add("set"); }
    setTimeout(function () { p.el.remove(); }, 480);
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sayPanel) closeSayPanel(); });
  $detail.addEventListener("pointerdown", function (e) {
    var btn = e.target.closest("[data-say]");
    if (!btn || sayHold || (e.pointerType === "mouse" && e.button !== 0)) return;
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    sayHold = { btn: btn, id: e.pointerId, x0: e.clientX, y0: e.clientY, fx: e.clientX, fy: e.clientY, dial: null };
    sayHold.timer = setTimeout(openSayDial, SAY_HOLD);
  });
  $detail.addEventListener("pointermove", function (e) {
    var h = sayHold;
    if (!h || e.pointerId !== h.id) return;
    h.fx = e.clientX; h.fy = e.clientY;
    if (h.dial) { e.preventDefault(); return; }
    // the finger moved off before the dial came up: this was not a hold
    if (Math.hypot(h.fx - h.x0, h.fy - h.y0) > 14) { clearTimeout(h.timer); sayHold = null; }
  });
  function endSayHold(e) {
    var h = sayHold;
    if (!h || e.pointerId !== h.id) return;
    clearTimeout(h.timer);
    if (!h.dial) { sayHold = null; return; }
    sayHoldGuard = Date.now() + 450; // the lift that closes the dial is not a tap on the speaker
    closeSayDial(e.type === "pointerup");
  }
  $detail.addEventListener("pointerup", endSayHold);
  $detail.addEventListener("pointercancel", endSayHold);
  $detail.addEventListener("contextmenu", function (e) { if (e.target.closest("[data-say]")) e.preventDefault(); });
  // iPhone reads a held finger as "select the text here": the touch on the speaker is kept from it. That also keeps back
  // the tap's click, so a short tap plays the voice here, on touchend (iPhone lets sound start from it).
  var sayTouch = null;
  $detail.addEventListener("touchstart", function (e) {
    var btn = e.target.closest("[data-say]");
    if (!btn || e.touches.length !== 1) { sayTouch = null; return; }
    e.preventDefault();
    sayTouch = { btn: btn, x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
  }, { passive: false });
  $detail.addEventListener("touchmove", function (e) {
    var t = sayTouch, f = e.touches[0];
    if (t && f && Math.hypot(f.clientX - t.x, f.clientY - t.y) > 14) t.moved = true;
  }, { passive: true });
  $detail.addEventListener("touchend", function () {
    var t = sayTouch;
    sayTouch = null;
    if (!t || t.moved || (sayHold && sayHold.dial) || Date.now() < sayHoldGuard) return;
    sayHoldGuard = Date.now() + 450; // a click, if one still comes, is the same tap
    say(+t.btn.closest(".sentence-card").dataset.sid);
  });
  $detail.addEventListener("touchcancel", function () { sayTouch = null; });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) return;
    if (sayHold) { clearTimeout(sayHold.timer); closeSayDial(false); }
    closeSayPanel(true);
  });

  // ---------- swipe left / right: next / previous sentence ----------
  var swipe = null;
  function swipeTarget(dx) {
    var sid = lastSid + (dx < 0 ? 1 : -1);
    return sid >= 1 && sid <= SENTENCES.length ? sid : 0;
  }
  $detail.addEventListener("touchstart", function (e) {
    swipe = null;
    if (e.touches.length !== 1 || !state.current || state.current.charAt(0) === "t") return;
    // the dock swipes like the rest of the page; only while a hidden sentence is being rubbed clear does it keep the finger
    if (e.target.closest(".rail, pre, input, .seek, .gauge, .tint, .dock.reveal, .say-btn")) return;
    if ($detail.querySelector(".gauge.open, .tint.open")) return;
    var t = e.touches[0];
    swipe = { x: t.clientX, y: t.clientY, dx: 0, on: false, time: Date.now(), art: null };
  }, { passive: true });
  $detail.addEventListener("touchmove", function (e) {
    if (!swipe) return;
    var t = e.touches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    if (!swipe.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { swipe = null; return; }
      if (Math.abs(dx) < 10) return;
      swipe.on = true;
      swipe.time = Date.now();
      swipe.art = $detail.querySelector(".detail");
      swipe.art.classList.add("settled", "swiping");
    }
    swipe.dx = swipeTarget(dx) ? dx : dx / 4; // rubber band at #001 and #560
    swipe.art.style.setProperty("--sx", swipe.dx + "px");
    swipe.art.style.setProperty("--so", Math.max(.35, 1 - Math.abs(swipe.dx) / 600));
  }, { passive: true });
  function endSwipe() {
    if (!swipe || !swipe.on) { swipe = null; return; }
    var s = swipe, art = s.art;
    swipe = null;
    art.classList.remove("swiping");
    var fast = Math.abs(s.dx) / Math.max(1, Date.now() - s.time) > .45;
    var target = swipeTarget(s.dx);
    if (target && (Math.abs(s.dx) > 72 || (fast && Math.abs(s.dx) > 28))) {
      art.style.setProperty("--sx", (s.dx < 0 ? -1 : 1) * window.innerWidth * .6 + "px");
      art.style.setProperty("--so", 0);
      setTimeout(function () { go("#/s/" + target); }, 140);
    } else {
      art.style.setProperty("--sx", "0px");
      art.style.setProperty("--so", 1);
    }
  }
  $detail.addEventListener("touchend", endSwipe);
  $detail.addEventListener("touchcancel", endSwipe);

  // ---------- number dial: double-tap the sentence number, type, jump ----------
  var dial = null;
  function openDial() {
    if (dial || !lastSid) return;
    var N = SENTENCES.length, typed = "", autoTimer = null;
    var el = document.createElement("div");
    el.className = "dial";
    el.innerHTML =
      '<div class="dial-card" role="dialog" aria-modal="true" aria-label="例文番号を入力して移動">' +
        '<div class="dial-screen"><span class="dial-num"></span><span class="dial-of">/ ' + N + "</span></div>" +
        '<p class="dial-peek" aria-live="polite"></p>' +
        '<div class="dial-keys">' +
          [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (k) { return '<button type="button" data-key="' + k + '">' + k + "</button>"; }).join("") +
          '<button type="button" class="fn" data-key="del" aria-label="1文字消す">' + ICON.del + "</button>" +
          '<button type="button" data-key="0">0</button>' +
          '<button type="button" class="go" data-key="go" aria-label="この例文へ移動">' + ICON.next + "</button>" +
        "</div>" +
      "</div>";
    document.body.appendChild(el);
    var card = el.querySelector(".dial-card"), $num = el.querySelector(".dial-num"),
      $peek = el.querySelector(".dial-peek"), $go = el.querySelector(".go");
    dial = { el: el };

    function value() { return +typed || 0; }
    function valid() { var n = value(); return n >= 1 && n <= N; }
    function update(pop) {
      $num.textContent = "#" + (typed || pad3(lastSid));
      $num.classList.toggle("ph", !typed);
      if (pop) { $num.classList.remove("pop"); void $num.offsetWidth; $num.classList.add("pop"); }
      $peek.textContent = !typed ? "番号を打つと、その例文へ移動します" : valid() ? SENTENCES[value() - 1].en : "1〜" + N + " の番号です";
      $peek.classList.toggle("en", !!typed && valid());
      $go.disabled = !valid();
    }
    function shake() { card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
    function jump() {
      if (!valid()) return shake();
      var n = value();
      close();
      if (n !== lastSid) go("#/s/" + n);
    }
    function press(key) {
      clearTimeout(autoTimer);
      if (key === "go") return jump();
      if (key === "del") { typed = typed.slice(0, -1); return update(false); }
      if (!typed && key === "0") return shake();
      if (typed.length >= 3 || +(typed + key) > N) return shake();
      typed += key;
      update(true);
      // no more digits could follow: go right away
      if (typed.length === 3 || value() * 10 > N) autoTimer = setTimeout(jump, 320);
    }
    function onKey(e) {
      e.stopPropagation();
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); press("del"); }
      else if (e.key === "Enter") { e.preventDefault(); press("go"); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    }
    function close() {
      clearTimeout(autoTimer);
      window.removeEventListener("keydown", onKey, true);
      el.classList.remove("open");
      dial = null;
      setTimeout(function () { el.remove(); }, 320);
    }
    el.addEventListener("click", function (e) {
      var k = e.target.closest("[data-key]");
      if (k) press(k.dataset.key);
      else if (!e.target.closest(".dial-card")) close();
    });
    window.addEventListener("keydown", onKey, true);
    update(false);
    requestAnimationFrame(function () { el.classList.add("open"); });
  }

  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $q.focus(); $q.select(); return; }
    if (e.key === "Escape" && state.current) { go("#/"); return; }
    // a hidden sentence: Space clears the next word, Shift+Space hides one again
    if (e.key === " " && state.current && rv.card && rv.card.isConnected && rv.card.classList.contains("rv")) {
      e.preventDefault();
      revealStep(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      var btn = $detail.querySelectorAll("[data-go]")[e.key === "ArrowLeft" ? 0 : 1];
      if (btn && !btn.disabled) { e.preventDefault(); go("#/s/" + btn.dataset.go); }
    }
  });

  // ---------- toggles ----------
  var $toggleJa = document.getElementById("toggle-ja"), $toggleEn = document.getElementById("toggle-en");
  function syncHideBtn(which, on) {
    var b = $detail.querySelector('[data-hide="' + which + '"]');
    if (b) b.setAttribute("aria-pressed", String(on));
  }
  function setHideJa(on) {
    document.body.classList.toggle("hide-ja", on);
    $toggleJa.setAttribute("aria-pressed", String(on));
    syncHideBtn("ja", on);
    Array.prototype.forEach.call(document.querySelectorAll(".ja.shown"), function (el) { el.classList.remove("shown"); });
    save("duo.hideJa", on ? "1" : "0");
    setupReveal(false);
  }
  function setHideEn(on) {
    document.body.classList.toggle("hide-en", on);
    $toggleEn.setAttribute("aria-pressed", String(on));
    syncHideBtn("en", on);
    Array.prototype.forEach.call(document.querySelectorAll(".en.shown"), function (el) { el.classList.remove("shown"); });
    save("duo.hideEn", on ? "1" : "0");
    setupReveal(false);
  }
  $toggleJa.addEventListener("click", function () { setHideJa(!document.body.classList.contains("hide-ja")); });
  $toggleEn.addEventListener("click", function () { setHideEn(!document.body.classList.contains("hide-en")); });

  var meta = document.querySelector('meta[name="theme-color"]');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    meta.setAttribute("content", theme === "light" ? "#ffffff" : "#11131b");
  }
  document.getElementById("toggle-theme").addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    save("duo.theme", next);
  });

  // ---------- start ----------
  applyTheme(document.documentElement.dataset.theme || "dark");
  setHideJa(load("duo.hideJa") === "1");
  setHideEn(load("duo.hideEn") === "1");
  renderFilter();
  renderListAnimated();
  // open where the learner left off last time
  var last = load("duo.last");
  if (!/^#\/(w|s|t)\//.test(location.hash) && last && /^#\/(w|s)\/[\w-]+$/.test(last)) {
    try { history.replaceState(null, "", last); } catch (e) {}
    document.documentElement.classList.add("no-anim");
    requestAnimationFrame(function () { requestAnimationFrame(function () { document.documentElement.classList.remove("no-anim"); }); });
  }
  route();
  window.addEventListener("hashchange", route);
})();

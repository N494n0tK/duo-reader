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

  // a phrase: the words it is made of, each with its pronunciation (the explanations come from the notes below)
  function partsCard(word) {
    var lx = LX.words[word.id];
    if (!lx || lx.etyJa || lx.etyEn || !lx.tokens || !lx.tokens.length) return "";
    return '<section class="sentence-card ety-card" aria-label="構成する語"><div class="card-head"><span class="card-num">構成する語</span></div><ul class="token-list">' +
      lx.tokens.map(function (t) {
        var info = LX.tokens[t] || {};
        var duo = WORDS.filter(function (w) { return w.word.toLowerCase() === t; })[0];
        return '<li><span class="tok" lang="en">' + (duo ? '<button class="tok-link" data-href="#/w/' + duo.id + '">' + esc(t) + "</button>" : esc(t)) + "</span>" +
          (info.ipa ? '<span class="tok-ipa">' + esc(info.ipa) + "</span>" : "") + "</li>";
      }).join("") + '</ul><p class="ety-credit">発音は Wiktionary（CC BY-SA 4.0）より</p></section>';
  }

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
  var synOn = load("duo.syn") !== "0";
  function roleKey(role) {
    var r = String(role || "").trim();
    return /^[SVOCM]/i.test(r) ? r.charAt(0).toUpperCase() : "X";
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
    if (parts.length) {
      html += '<div class="nt-struct">' + parts.map(function (x, i) {
        return '<span class="nt-chunk" data-role="' + roleKey(x.role) + '" style="--i:' + i + '"><b title="' + esc(ROLE_NAMES[x.role] || x.role) + '">' + esc(x.role) + '</b><span lang="en">' + esc(x.text) + "</span>" +
          (x.note ? "<small>" + esc(x.note) + "</small>" : "") + "</span>";
      }).join("") + "</div>";
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
  // where each chunk of the skeleton sits in the sentence: [start, end, role], in the order written, whole words only
  function syntaxRanges(en, parts) {
    var low = en.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'), cur = 0, out = [];
    function letter(c) { return !!c && /[a-z0-9]/i.test(c); }
    function find(q, from) {
      for (var i = low.indexOf(q, from); i > -1; i = low.indexOf(q, i + 1)) {
        if (!(letter(q.charAt(0)) && letter(low.charAt(i - 1))) && !(letter(q.charAt(q.length - 1)) && letter(low.charAt(i + q.length)))) return i;
      }
      return -1;
    }
    parts.forEach(function (x) {
      // "not only … but also": a chunk written in pieces
      String(x.text || "").split(/\s*(?:\.{3}|\u2026|\u301c|~)\s*/).forEach(function (seg) {
        var q = seg.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'), at = -1;
        if (!q) return;
        [q, q.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")].some(function (t) {
          if (!t) return false;
          at = find(t, cur);
          if (at < 0) at = find(t, 0);
          if (at > -1) q = t;
          return at > -1;
        });
        if (at < 0) return;
        out.push([at, at + q.length, x.role]);
        cur = at + q.length;
      });
    });
    return out;
  }
  // color the words of the sentence by their part (S / V / O / C / M); the first word of each chunk carries its letter
  function paintSyntax(sid, parts) {
    var card = $detail.querySelector('.sentence-card[data-sid="' + sid + '"]');
    if (!card) return;
    var en = card.querySelector(".sentence-en"), btn = card.querySelector("[data-syn]");
    Array.prototype.forEach.call(en.querySelectorAll(".wd[data-r]"), function (w) { delete w.dataset.r; delete w.dataset.tag; });
    var ranges = parts && parts.length ? syntaxRanges(SENTENCES[sid - 1].en, parts) : [];
    btn.hidden = !ranges.length;
    card.classList.toggle("syn", synOn && ranges.length > 0);
    if (!ranges.length) return;
    var walker = document.createTreeWalker(en, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest("rt") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var at = 0, n, tagged = {};
    while ((n = walker.nextNode())) {
      var wd = n.parentNode.closest(".wd");
      if (wd && /\S/.test(n.nodeValue)) {
        for (var k = 0; k < ranges.length; k++) {
          if (at >= ranges[k][0] && at < ranges[k][1]) {
            wd.dataset.r = roleKey(ranges[k][2]);
            if (!tagged[k]) { tagged[k] = true; wd.dataset.tag = String(ranges[k][2]).trim(); }
            break;
          }
        }
      }
      at += n.nodeValue.length;
    }
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
        '<button type="button" class="syn-btn" data-syn hidden aria-pressed="' + synOn + '" title="文型の色分け"><i class="syn-dots" aria-hidden="true"><b data-r="S"></b><b data-r="V"></b><b data-r="O"></b></i>文型</button></div>' +
      '<p class="sentence-en" lang="en">' + renderSentenceHtml(sid, word && word.id) + "</p>" +
      '<p class="sentence-ja">' + esc(s.ja) + "</p></section>";

    if (word) html += partsCard(word);
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
    if ((t = e.target.closest("[data-syn]"))) {
      synOn = !synOn;
      save("duo.syn", synOn ? "1" : "0");
      t.setAttribute("aria-pressed", synOn);
      t.closest(".sentence-card").classList.toggle("syn", synOn);
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
    if (e.target.closest(".rail, pre, input, .seek, .gauge, .tint, .dock.reveal")) return;
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

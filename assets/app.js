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

  // ---------- pronunciation & etymology (Wiktionary / CMU, optional) ----------
  var LX = window.LEXICON_DATA || { words: {}, tokens: {} };
  var IPA_SRC = { wiktionary: "Wiktionary", cmudict: "CMU発音辞書", composed: "語ごとの発音をつないだもの" };

  function wikiLink(title, label) {
    return '<a href="https://en.wiktionary.org/wiki/' + encodeURIComponent(title.replace(/ /g, "_")) + '#English" target="_blank" rel="noopener noreferrer">' + esc(label || title) + "</a>";
  }

  function firstSentence(text) {
    var m = String(text).replace(/\s+/g, " ").match(/^.*?[.;](\s|$)/);
    return (m ? m[0] : text).trim();
  }

  function etymologyCard(word) {
    var lx = LX.words[word.id];
    if (!lx) return "";
    var html = "";
    if (lx.etyJa || lx.etyEn) {
      html += '<section class="sentence-card ety-card" aria-label="語源"><div class="card-head"><span class="card-num">語源</span></div>';
      if (lx.etyJa) html += '<p class="ety-ja">' + esc(lx.etyJa) + "</p>";
      if (lx.parts) {
        html += '<p class="ety-parts">' + lx.parts.map(function (x) { return '<span class="part" lang="en">' + esc(x) + "</span>"; }).join('<span class="plus">+</span>') + "</p>";
      }
      if (lx.chain && lx.chain.length) {
        html += '<ol class="ety-chain">' + lx.chain.map(function (c) {
          return '<li><span class="lang">' + esc(c.lang) + '</span><span class="form" lang="und">' + esc(c.term) + "</span>" +
            (c.gloss ? '<span class="gloss">“' + esc(c.gloss) + "”</span>" : "") + "</li>";
        }).join("") + '<li class="now"><span class="lang">英語</span><span class="form" lang="en">' + esc(lx.wiki || word.word) + "</span></li></ol>";
      }
      if (lx.etyEn) {
        html += '<details class="ety-en"><summary>英語の原文（Wiktionary）</summary><p lang="en">' + esc(lx.etyEn) + "</p>" +
          '<p class="ety-credit">' + wikiLink(lx.wiki || word.word, "Wiktionary で開く") + "　CC BY-SA 4.0</p></details>";
      }
      if (!lx.etyJa) html += '<p class="ety-note">日本語の要約はまだありません。</p>';
      html += "</section>";
    } else if (lx.tokens && lx.tokens.length) {
      html += '<section class="sentence-card ety-card" aria-label="構成する語"><div class="card-head"><span class="card-num">構成する語</span></div><ul class="token-list">' +
        lx.tokens.map(function (t) {
          var info = LX.tokens[t] || {};
          var duo = WORDS.filter(function (w) { return w.word.toLowerCase() === t; })[0];
          var ja = duo && LX.words[duo.id] && LX.words[duo.id].etyJa;
          var ety = ja ? '<span class="tok-ety">' + esc(ja) + "</span>"
            : info.ety ? '<span class="tok-ety" lang="en">' + (info.multi ? "（主な語源）" : "") + esc(firstSentence(info.ety)) + " " + wikiLink(t, "→") + "</span>" : "";
          return '<li><span class="tok" lang="en">' + (duo ? '<button class="tok-link" data-href="#/w/' + duo.id + '">' + esc(t) + "</button>" : esc(t)) + "</span>" +
            (info.ipa ? '<span class="tok-ipa">' + esc(info.ipa) + "</span>" : "") + ety + "</li>";
        }).join("") + '</ul><p class="ety-credit">Wiktionary（CC BY-SA 4.0）より</p></section>';
    }
    return html;
  }

  // ---------- highlighter: find each DUO word inside its sentence ----------
  var PLACEHOLDER = /^(～|~|a|b|c|one's|oneself|one|someone|something|sb|sth|do|done|doing|to do|…|\.\.\.)$/i;

  function stem(t) {
    t = t.toLowerCase();
    var e = escRe(t);
    if (t.length <= 2) return e;
    var last = t.slice(-1);
    if (last === "e") return escRe(t.slice(0, -1)) + "(?:e|es|ed|er|est|ing|ely|en)?";
    if (last === "y") return escRe(t.slice(0, -1)) + "(?:y|ies|ied|ier|iest|ying|ily|yed|ys)";
    return e + "(?:" + escRe(last) + ")?(?:s|es|ed|ing|er|est|ly|en)?";
  }

  // "shrink-shrank-shrunk" / "chairman/chairwoman" / "geographic[al]" / "phenomenon[複：phenomena]"
  function alternatives(main, bracket) {
    var alts = main.split("/");
    if (/^[a-z]+(-[a-z]+){2}$/i.test(main)) alts = main.split("-");
    if (bracket) {
      bracket = bracket.replace(/^.*[:：]/, "");
      if (/^[a-z]{1,3}$/.test(bracket)) alts = alts.map(function (a) { return a + "[" + bracket + "]"; });
      else alts = alts.concat(bracket.split("/"));
    }
    return alts;
  }

  function altPattern(a) {
    var opt = a.match(/^(.*)\[([a-z]+)\]$/);
    if (opt) return escRe(opt[1].toLowerCase()) + "(?:" + opt[2] + ")?";
    return a.split(/\s+/).map(stem).join("\\s+");
  }

  function wordPatterns(word) {
    // "( )" and " [ ]" after a space are optional parts; "x[y]" without a space is an alternative
    var src = word.replace(/\(.*?\)/g, " ").replace(/\s\[[^\]]*\]/g, " ").replace(/[～〜]/g, " ~ ");
    var groups = [];
    var re = /([^\s\[\]]+)(?:\[([^\]]+)\])?/g, m;
    while ((m = re.exec(src))) {
      var alts = alternatives(m[1], m[2])
        .map(function (a) { return a.replace(/^[-"'“]+|[-.,!?"'”]+$/g, ""); })
        .filter(function (a) { return a && !PLACEHOLDER.test(a); });
      if (alts.length) groups.push(alts);
    }
    // a headword made only of "placeholder" words (e.g. the auxiliary "do") still needs a pattern
    if (!groups.length) groups = src.split(/\s+/).filter(Boolean).map(function (t) { return [t]; });
    if (groups.length > 1) {
      groups = groups.filter(function (g) { return !(g.length === 1 && /^be$/i.test(g[0])); });
    }
    return groups.map(function (alts) {
      // "resume" also finds "résumé"
      var body = alts.map(altPattern).join("|").replace(/e/g, "[eé]");
      return new RegExp("(?<![A-Za-z\u00c0-\u024f])(?:" + body + ")(?![A-Za-z\u00c0-\u024f])", "ig");
    });
  }

  var marksCache = {};
  function sentenceMarks(sid) {
    if (marksCache[sid]) return marksCache[sid];
    var s = SENTENCES[sid - 1];
    var owner = new Array(s.en.length).fill(null);
    (wordsBySid[sid] || []).forEach(function (w) {
      var from = 0, prevEnd = -1;
      wordPatterns(w.word).forEach(function (re) {
        var hit = find(re, from) || find(re, 0);
        if (!hit) return;
        // join the pieces of a phrase into one marker when only spaces separate them
        var start = prevEnd > -1 && prevEnd <= hit.start && /^\s+$/.test(s.en.slice(prevEnd, hit.start)) ? prevEnd : hit.start;
        for (var j = start; j < hit.end; j++) owner[j] = w.id;
        from = prevEnd = hit.end;
      });
    });
    // first match at or after `from` that no other word has claimed yet
    function find(re, from) {
      re.lastIndex = from;
      var m;
      while ((m = re.exec(s.en))) {
        var start = m.index, end = start + m[0].length, free = true;
        for (var i = start; i < end; i++) if (owner[i]) { free = false; break; }
        if (free && m[0].length) return { start: start, end: end };
        if (!m[0].length) re.lastIndex++;
      }
      return null;
    }
    return (marksCache[sid] = owner);
  }

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
  var state = { tab: "words", q: "", pos: "", field: "", limit: PAGE, current: null };

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

  document.getElementById("brand-count").textContent =
    WORDS.length.toLocaleString() + " 語 · " + SENTENCES.length + " 例文";

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

  function searchWords(q) {
    var list = WORDS.filter(posMatch);
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

  function searchSentences(q) {
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

  function renderList() {
    var q = norm(state.q);
    var found = { words: searchWords(q), sentences: searchSentences(q), terms: searchTerms(q) };
    $countWords.textContent = found.words.length.toLocaleString();
    $countSentences.textContent = found.sentences.length.toLocaleString();
    $countTerms.textContent = found.terms.length.toLocaleString();
    $posFilter.hidden = state.tab === "sentences";

    var raw = state.q.trim();
    var html = "";
    var items = found[state.tab];
    var shown = items.slice(0, state.limit);

    if (!items.length) {
      html = '<p class="empty">「' + esc(raw) + '」に一致する' + TAB_NAMES[state.tab] + "はありません。";
      var other = $tabs.map(function (t) { return t.dataset.tab; })
        .filter(function (tab) { return tab !== state.tab && found[tab].length; })[0];
      if (other) html += '<br><button class="more" data-switch="' + other + '">' + TAB_NAMES[other] + "で " + found[other].length + " 件見つかりました</button>";
      else if (state.tab === "words" ? state.pos : state.field) html += '<br><button class="more" data-clear-filter>絞り込みを外す</button>';
      html += "</p>";
    } else if (state.tab === "words") {
      html = shown.map(function (w) {
        return '<button class="row" role="listitem" data-href="#/w/' + w.id + '"' + (state.current === "w" + w.id ? ' aria-current="true"' : "") + ">" +
          '<span class="row-num">' + w.id + "</span>" +
          '<span class="row-head"><span class="row-word">' + markQuery(w.word, raw) + '</span><span class="row-pos">' + esc(posLabel(w.pos)) + "</span></span>" +
          '<span class="row-sub ja">' + markQuery(w.meaning, raw) + "</span></button>";
      }).join("");
    } else if (state.tab === "sentences") {
      html = shown.map(function (s) {
        return '<button class="row" role="listitem" data-href="#/s/' + s.id + '"' + (state.current === "s" + s.id ? ' aria-current="true"' : "") + ">" +
          '<span class="row-num">' + pad3(s.id) + "</span>" +
          '<span class="row-sentence">' + markQuery(s.en, raw) + "</span>" +
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
    shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c1.6 0 2.7-1 3.6-2.3M13.4 9.3C14.3 8 15.4 7 17 7h3M17 4l3 3-3 3M17 14l3 3-3 3"/></svg>'
  };

  var lastSid = null, lastP = 0;

  function renderDetail(kind, id, opts) {
    opts = opts || {};
    var word = kind === "w" ? wordById[id] : null;
    var sid = word ? word.sid : +id;
    var s = SENTENCES[sid - 1];
    var siblings = wordsBySid[sid] || [];
    var same = !opts.home && !opts.shuffle && sid === lastSid;
    var dir = same ? "same" : lastSid === null ? "" : opts.shuffle || sid > lastSid ? "dir-next" : "dir-prev";
    var p = (sid - 1) / (SENTENCES.length - 1);

    var html = '<article class="detail ' + dir + '">';

    html += '<div class="detail-top">';
    html += '<button class="nav-btn back" data-back title="一覧に戻る"><span class="sr">一覧に戻る</span>' + ICON.back + "</button>";
    html += '<span class="eyebrow">' + (opts.home ? "ランダムな一文" : word ? "単語 " + word.id : "例文") + "</span>";
    html += '<span class="spacer"></span>';
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
      html += '<header class="headword"><div class="headword-line"><h1><span>' + esc(word.word) + "</span></h1>" +
        '<span class="pos-tag">' + esc(posLabel(word.pos)) + "</span></div>" +
        (LX.words[word.id] && LX.words[word.id].ipa
          ? '<p class="ipa"><span lang="en">' + esc(LX.words[word.id].ipa) + '</span><span class="ipa-src">米音 · ' + IPA_SRC[LX.words[word.id].ipaSrc] + "</span></p>"
          : "") +
        '<p class="meaning ja">' + esc(word.meaning) + "</p></header>";
    }

    html += '<section class="sentence-card' + (same ? " static" : "") + '" aria-label="例文 ' + sid + '">' +
      '<div class="card-head"><span class="card-num">#' + pad3(sid) + '</span><span class="card-of">/ ' + SENTENCES.length + "</span></div>" +
      '<p class="sentence-en" lang="en">' + renderSentenceHtml(sid, word && word.id) + "</p>" +
      '<p class="sentence-ja ja">' + esc(s.ja) + "</p></section>";

    if (word) html += etymologyCard(word);

    var related = word ? termsByWord[word.id] || [] : [];
    if (related.length) {
      html += '<h2 class="section-title">ゲーム・技術ではこう使う ' + related.length + "</h2>";
      html += '<div class="word-list term-links">' + related.map(termItem).join("") + "</div>";
    }

    html += '<h2 class="section-title">この例文の単語 ' + siblings.length + "</h2>";
    html += '<div class="word-list">' + siblings.map(function (w) {
      return '<button class="word-item" data-href="#/w/' + w.id + '" data-wid="' + w.id + '"' + (word && w.id === word.id ? ' aria-current="true"' : "") + ">" +
        '<span class="n">' + w.id + "</span>" +
        '<span><span class="w">' + esc(w.word) + '</span><span class="m ja">' + esc(w.meaning) + "</span></span>" +
        '<span class="p">' + esc(posLabel(w.pos)) + "</span></button>";
    }).join("") + "</div>";

    if (!opts.home) {
      html += '<nav class="dock" aria-label="例文の移動">' +
        '<button class="nav-btn" data-go="' + (sid - 1) + '"' + (sid <= 1 ? " disabled" : "") + '><span class="sr">前の例文</span>' + ICON.prev + "</button>" +
        '<span class="dock-num">#' + pad3(sid) + "<small>/ " + SENTENCES.length + "</small></span>" +
        '<button class="nav-btn" data-go="' + (sid + 1) + '"' + (sid >= SENTENCES.length ? " disabled" : "") + '><span class="sr">次の例文</span>' + ICON.next + "</button></nav>";
    }

    if (opts.home) {
      html += '<p class="home-keys"><kbd>/</kbd> 検索　<kbd>←</kbd><kbd>→</kbd> 前後の例文　<kbd>Esc</kbd> 閉じる</p>';
    }

    html += "</article>";
    $detail.innerHTML = html;
    if (!same) $detail.scrollTop = 0;

    // slide the rail cursor from the previous sentence to this one
    var rail = $detail.querySelector(".rail");
    void rail.offsetWidth;
    rail.style.setProperty("--p", p);
    lastSid = sid;
    lastP = p;
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
  $q.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(applyQuery, 90);
  });
  $q.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyQuery();
      var first = $results.querySelector(".row");
      if (first) { go(first.dataset.href); $q.blur(); }
    } else if (e.key === "Escape") {
      $q.blur();
    }
  });

  $tabs.forEach(function (t) {
    t.addEventListener("click", function () { setTab(t.dataset.tab); });
  });

  $posFilter.addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (!b) return;
    if (state.tab === "terms") state.field = b.dataset.filter;
    else state.pos = b.dataset.filter;
    state.limit = PAGE;
    renderFilter();
    renderListAnimated();
    $results.scrollTop = 0;
  });

  $results.addEventListener("click", function (e) {
    var row = e.target.closest("[data-href]");
    if (row) return go(row.dataset.href);
    if (e.target.closest("[data-more]")) { state.limit += PAGE; renderList(); return; }
    var sw = e.target.closest("[data-switch]");
    if (sw) { setTab(sw.dataset.switch); return; }
    if (e.target.closest("[data-clear-filter]")) {
      if (state.tab === "terms") state.field = ""; else state.pos = "";
      renderFilter();
      renderList();
    }
  });

  $detail.addEventListener("click", function (e) {
    var t;
    if ((t = e.target.closest(".hide-ja .ja")) && !t.classList.contains("shown")) {
      t.classList.add("shown");
      return;
    }
    if ((t = e.target.closest("[data-spoiler]")) && !t.classList.contains("shown")) { t.classList.add("shown"); return; }
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
    scrub.peek.innerHTML = "<b>#" + pad3(sid) + "</b>" + esc(SENTENCES[sid - 1].en);
  }
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
    if (e.target.closest(".rail, pre, .ety-chain, input")) return;
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

  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $q.focus(); $q.select(); return; }
    if (e.key === "Escape" && state.current) { go("#/"); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      var btn = $detail.querySelectorAll("[data-go]")[e.key === "ArrowLeft" ? 0 : 1];
      if (btn && !btn.disabled) { e.preventDefault(); go("#/s/" + btn.dataset.go); }
    }
  });

  // ---------- toggles ----------
  var $toggleJa = document.getElementById("toggle-ja");
  function setHideJa(on) {
    document.body.classList.toggle("hide-ja", on);
    $toggleJa.setAttribute("aria-pressed", String(on));
    Array.prototype.forEach.call(document.querySelectorAll(".ja.shown"), function (el) { el.classList.remove("shown"); });
    save("duo.hideJa", on ? "1" : "0");
  }
  $toggleJa.addEventListener("click", function () { setHideJa(!document.body.classList.contains("hide-ja")); });

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
  renderFilter();
  renderListAnimated();
  route();
  window.addEventListener("hashchange", route);
})();

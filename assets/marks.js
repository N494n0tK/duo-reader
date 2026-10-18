// DUO の各単語が例文のどこにあるかを探す（蛍光ペンの位置）。アプリ本体とウィジェットで共通。
// 使い方: var marks = window.DuoMarks(DUO_DATA).marks; marks(例文番号) → 文字ごとに単語番号（なければ null）の配列
(function () {
  "use strict";

  window.DuoMarks = function (DATA) {
    var SENTENCES = DATA.sentences;
    var wordsBySid = {};
    DATA.words.forEach(function (w) { (wordsBySid[w.sid] = wordsBySid[w.sid] || []).push(w); });
    function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

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

    return { marks: sentenceMarks };
  };
})();

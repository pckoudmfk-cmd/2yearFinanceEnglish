/* Finance Vocabulary Hub: shared content-aware grader (runs in the browser, no server).
 *
 * It does NOT understand meaning. It checks logical features that a real answer must have and that a pile of
 * keywords cannot fake: relevance, claims (several ideas inside ONE sentence), reasoning (a cause or contrast
 * connector with a topic idea on each side), an example, known misconceptions, copying, and gibberish.
 *
 * Usage:  const res = Grader.score(text, rubric);   // res = {pts, max, gate, items:[{label,pts,max,ok,msg}]}
 *         Grader.renderRule(rubric)   -> HTML for the "how you get points" box shown BEFORE the task
 *         Grader.renderResult(res)    -> HTML checklist shown AFTER pressing Check
 *
 * rubric = {
 *   max: 5,                         // total points of the task (sum of criteria pts must equal max)
 *   minWords: 25,                   // below this the answer is not scored at all
 *   prompt: 'question text',        // optional: words copied from the question are not counted
 *   source: 'reading text',         // optional: answers copied from the reading are capped at 50%
 *   criteria: [
 *     {type:'claim',   pts:2, label:'...', all:[ ['scarc'], ['limited|finite|not enough'], ['wants|needs|unlimited'] ]},
 *     {type:'concepts',pts:1, label:'...', need:2, of:[ ['consumer'], ['producer'], ['goods'] ]},
 *     {type:'reason',  pts:1, label:'...', topics:[ ['scarc'],['demand'],['supply'],['resource'] ]},
 *     {type:'contrast',pts:1, label:'...', topics:[...]},
 *     {type:'example', pts:1, label:'...'},
 *     {type:'define',  pts:1, label:'...', term:['inflation'] },
 *   ],
 *   misconceptions: [ {re:'scarcity (means|is) (no|zero)', msg:'...'} ]   // optional, each costs 1 point (min total 0)
 * }
 * Every group is an array of regular-expression sources (case-insensitive) and matches if ANY of them matches.
 * Use \\b at the start of a word when needed, e.g. '\\blimited' so that 'unlimited' does not match.
 */
(function (root) {
  'use strict';

  var FUNC = ('the a an and or but of to in on at for with by from as is are was were be been being it its this that these those ' +
    'which who whom whose what when where why how if because so than then there their they them he she we you i not no can could ' +
    'may might will would should must do does did has have had also such more most many much some any each other between while ' +
    'both either neither only very about into over under through during per').split(' ');
  var FUNCSET = {}; FUNC.forEach(function (w) { FUNCSET[w] = 1; });

  var CAUSE = /\b(because|since|therefore|thus|as a result|consequently|hence|so that|due to|leads? to|led to|causes?|caused|results? in|resulted in|which means|this means|in order to|that is why|for this reason|so)\b/i;
  var CONTRAST = /\b(but|however|whereas|while|unlike|in contrast|on the other hand|although|though|differs? from|different from|rather than|instead of|compared (to|with))\b/i;
  var EXAMPLE = /\b(for example|for instance|such as|e\.g\.|like a|like an|e\.g|one example|an example|as an example|including)\b/i;
  var DEFINE = /\b(is|are|means?|refers? to|is defined as|are defined as|is called|are called|consists? of|involves?|is the|is a|is an|are the|describes?)\b/i;

  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function words(t) { return (t.toLowerCase().match(/[a-z][a-z'-]*/g) || []); }
  function sentences(t) {
    return norm(t).split(/(?<=[.!?])\s+|\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }
  function re(src) { try { return new RegExp(src, 'i'); } catch (e) { return new RegExp(String(src).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } }
  function groupHit(group, text) {
    for (var i = 0; i < group.length; i++) { if (re(group[i]).test(text)) return true; }
    return false;
  }
  function funcRatio(ws) {
    if (!ws.length) return 0;
    var n = 0; ws.forEach(function (w) { if (FUNCSET[w]) n++; });
    return n / ws.length;
  }
  function ngrams(ws, n) { var s = {}; for (var i = 0; i + n <= ws.length; i++) s[ws.slice(i, i + n).join(' ')] = 1; return s; }
  function copiedShare(text, source) {
    if (!source) return 0;
    var a = words(text), b = ngrams(words(source), 4);
    if (a.length < 4) return 0;
    var total = 0, hit = 0;
    for (var i = 0; i + 4 <= a.length; i++) { total++; if (b[a.slice(i, i + 4).join(' ')]) hit++; }
    return total ? hit / total : 0;
  }

  /* A sentence counts as "real" when it has at least 5 words and enough function words (so a string of nouns does not count). */
  function realSentences(text) {
    return sentences(text).filter(function (s) {
      var ws = words(s); return ws.length >= 5 && funcRatio(ws) >= 0.2;
    });
  }

  function gate(text, rb) {
    var ws = words(text);
    var minW = rb.minWords || 10;
    if (ws.length < Math.ceil(minW / 2)) return { ok: false, msg: 'Too short to be scored (at least ' + Math.ceil(minW / 2) + ' words are needed for any points).' };
    var uniq = {}; ws.forEach(function (w) { uniq[w] = 1; });
    if (ws.length >= 15 && Object.keys(uniq).length / ws.length < 0.45) return { ok: false, msg: 'Too many repeated words. Write different ideas, not the same words again.' };
    if (ws.length >= 12 && funcRatio(ws) < 0.2) return { ok: false, msg: 'This looks like a list of words, not sentences. Write full sentences with verbs and linking words.' };
    var fc = {}; var topF = 0; ws.forEach(function (w) { if (FUNCSET[w]) { fc[w] = (fc[w] || 0) + 1; if (fc[w] > topF) topF = fc[w]; } });
    if (ws.length >= 15 && topF / ws.length > 0.2) return { ok: false, msg: 'One small word (the, of, and...) is repeated too often. Write natural sentences.' };
    var cc = {}; var topC = 0; ws.forEach(function (w) { if (!FUNCSET[w] && w.length > 3) { cc[w] = (cc[w] || 0) + 1; if (cc[w] > topC) topC = cc[w]; } });
    if (ws.length >= 15 && topC > Math.max(4, ws.length * 0.15)) return { ok: false, msg: 'The same content word is repeated too many times. Use different words and ideas.' };
    if (realSentences(text).length < 1) return { ok: false, msg: 'No complete sentence found (a sentence needs at least 5 words).' };
    return { ok: true };
  }

  function score(text, rb) {
    text = norm(text);
    var out = { pts: 0, max: rb.max, gate: null, items: [], notes: [] };
    var g = gate(text, rb);
    if (!g.ok) { out.gate = g.msg; rb.criteria.forEach(function (c) { out.items.push({ label: c.label, pts: 0, max: c.pts, ok: false, msg: '' }); }); return out; }

    var sents = realSentences(text);
    var all = text.toLowerCase();
    var wc = words(text).length;
    var total = 0;

    rb.criteria.forEach(function (c) {
      var got = 0, msg = '', ok = false;
      if (c.type === 'claim') {
        // all groups must appear inside the SAME sentence
        for (var i = 0; i < sents.length; i++) {
          var s = sents[i].toLowerCase(), hit = 0;
          c.all.forEach(function (gr) { if (groupHit(gr, s)) hit++; });
          if (hit === c.all.length) { ok = true; break; }
        }
        got = ok ? c.pts : 0;
        if (!ok) {
          // partial credit (half, rounded down) when every idea is present but spread over different sentences
          var spread = c.all.every(function (gr) { return groupHit(gr, all); });
          if (spread && c.pts >= 2) { got = Math.floor(c.pts / 2); msg = 'The ideas are in your answer, but not connected in one sentence.'; }
        }
      } else if (c.type === 'concepts') {
        var f = 0; c.of.forEach(function (gr) { if (groupHit(gr, all)) f++; });
        var need = c.need || c.of.length;
        ok = f >= need;
        got = ok ? c.pts : Math.floor(c.pts * Math.min(f, need) / need * 100) / 100;
        got = Math.round(got * 2) / 2;
        msg = f + ' of ' + need + ' required ideas found.';
      } else if (c.type === 'reason' || c.type === 'contrast') {
        var CON = c.type === 'reason' ? CAUSE : CONTRAST;
        for (var j = 0; j < sents.length && !ok; j++) {
          var m = CON.exec(sents[j]);
          if (!m) continue;
          var before = sents[j].slice(0, m.index).toLowerCase(), after = sents[j].slice(m.index + m[0].length).toLowerCase();
          if (words(before).length < 2) { // sentence opens with the connector: "Because X, Y."
            var cm = after.indexOf(',');
            if (cm > 0) { before = after.slice(0, cm); after = after.slice(cm + 1); }
          }
          var topics = c.topics || [];
          var tb = topics.some(function (gr) { return groupHit(gr, before); });
          var ta = topics.some(function (gr) { return groupHit(gr, after); });
          if (words(before).length >= 2 && words(after).length >= 2 && tb && ta) ok = true;
        }
        got = ok ? c.pts : 0;
        if (!ok) msg = c.type === 'reason' ? 'No sentence links two topic ideas with a cause or result.' : 'No sentence compares two topic ideas.';
      } else if (c.type === 'example') {
        for (var k = 0; k < sents.length && !ok; k++) {
          var mm = EXAMPLE.exec(sents[k]);
          if (!mm) continue;
          var rest = sents[k].slice(mm.index + mm[0].length);
          if (words(rest).length >= 2) ok = true;
        }
        got = ok ? c.pts : 0;
        if (!ok) msg = 'No example found (use for example, such as, for instance + a real case).';
      } else if (c.type === 'define') {
        for (var d = 0; d < sents.length && !ok; d++) {
          var sl = sents[d].toLowerCase();
          if (groupHit(c.term, sl) && DEFINE.test(sl) && words(sl).length >= 6) ok = true;
        }
        got = ok ? c.pts : 0;
        if (!ok) msg = 'No sentence that explains what the term is.';
      } else if (c.type === 'length') {
        var full = c.words || rb.minWords || 25;
        ok = wc >= full;
        got = ok ? c.pts : (wc >= Math.ceil(full / 2) ? Math.floor(c.pts / 2) : 0);
        msg = wc + ' words (target ' + full + ').';
      } else if (c.type === 'structure') {
        var ns = c.sentences || 2;
        ok = sents.length >= ns;
        got = ok ? c.pts : 0;
        msg = sents.length + ' full sentences (target ' + ns + ').';
      }
      total += got;
      out.items.push({ label: c.label, pts: got, max: c.pts, ok: got >= c.pts, msg: msg });
    });

    // known misconceptions: each costs 1 point
    var penalty = 0;
    (rb.misconceptions || []).forEach(function (m) {
      for (var p = 0; p < sents.length; p++) {
        if (re(m.re).test(sents[p])) { penalty += 1; out.notes.push('⚠ ' + m.msg + ' (-1)'); break; }
      }
    });
    total = Math.max(0, total - penalty);

    var cs = copiedShare(text, rb.source);
    if (cs > 0.6) { total = Math.min(total, Math.floor(rb.max / 2)); out.notes.push('⚠ More than 60% of your answer is copied word for word from the text. The score is capped at half. Use your own words.'); }

    out.pts = Math.min(rb.max, Math.max(0, Math.round(total * 2) / 2));
    return out;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderRule(rb, title) {
    var h = '<div class="g-rule" style="border:1px solid var(--gold,#C9A84C);border-left-width:4px;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:.85rem;line-height:1.5">' +
      '<strong>' + esc(title || 'How you get points') + ' (maximum ' + rb.max + ')</strong><ul style="margin:6px 0 0 18px;padding:0">';
    rb.criteria.forEach(function (c) { h += '<li>' + esc(c.label) + ' <strong>' + c.pts + (c.pts === 1 ? ' point' : ' points') + '</strong></li>'; });
    h += '</ul>';
    h += '<div style="margin-top:6px;opacity:.85">The answer is checked for these ideas inside real sentences. A list of keywords, copied text or repeated words earns nothing. Minimum ' + (rb.minWords || 10) + ' words. You can press Check again and your best result is kept.</div></div>';
    return h;
  }

  function renderResult(res) {
    var h = '<strong>Score: ' + res.pts + ' / ' + res.max + '</strong>';
    if (res.gate) return h + '<div style="margin-top:6px">⛔ ' + esc(res.gate) + '</div>';
    h += '<ul style="margin:6px 0 0 18px;padding:0;list-style:none">';
    res.items.forEach(function (i) {
      h += '<li style="margin-bottom:3px">' + (i.ok ? '✅' : (i.pts > 0 ? '🟡' : '❌')) + ' ' + esc(i.label) + ' <strong>' + i.pts + '/' + i.max + '</strong>' + (i.ok || !i.msg ? '' : ' <span style="opacity:.75">(' + esc(i.msg) + ')</span>') + '</li>';
    });
    h += '</ul>';
    res.notes.forEach(function (n) { h += '<div style="margin-top:4px">' + esc(n) + '</div>'; });
    return h;
  }

  root.Grader = { score: score, renderRule: renderRule, renderResult: renderResult, words: words, sentences: sentences, _funcRatio: funcRatio };
})(typeof window !== 'undefined' ? window : globalThis);

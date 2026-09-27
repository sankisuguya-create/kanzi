// 画面（設計書 §4・§5）。メニュー → ふくしゅう（よむ・かく）／よしゅう、先生は先生用画面。
(function () {
  'use strict';
  var D = KANZI_DATA, ST = KANZI_STROKES;
  var app = document.getElementById('app');
  var S = { info: null, p: null, order: D.order, pointer: 0, lastRec: null, sinceFlush: 0 };
  var FLUSH_EVERY = 10;
  window.KanziState = S; // 検証・デバッグ用（tests/e2e.mjs が現在の字を読む）

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(sel) { return app.querySelector(sel); }
  function on(sel, fn) { var e = $(sel); if (e) e.addEventListener('click', fn); }
  // 先生のおためしでは「1日すすめる」で日付をずらせる（S.dayOffset）。本番の児童は常に0
  function nowMs() { return Date.now() + (S.dayOffset || 0) * 86400000; }
  function today() { return Sched.day(new Date(nowMs())); }

  var canSpeak = 'speechSynthesis' in window;
  function speak(t) {
    if (!canSpeak) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.rate = 0.9; speechSynthesis.speak(u); } catch (e) {}
  }

  // 例語は答えた回数ごとに入れ替える（音・訓を交互に：D7）
  function wordFor(c, reps) { var w = D.kanji[c].w; return w[(reps || 0) % w.length]; }

  function commit() {
    Platform.save(S.p);
    if (++S.sinceFlush >= FLUSH_EVERY) flush();
  }
  function flush() {
    S.sinceFlush = 0;
    if (!S.p) return Promise.resolve();
    return Platform.flush(S.p).then(function (m) { S.p = m; });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && S.p) flush(); });

  // ---------------- メニュー
  function menu() {
    S.lastRec = null;
    var p = S.p, t = today();
    var due = Sched.dueList(p, t, S.order), nDue = due.read.length + due.write.length;
    var queue = Sched.previewQueue(p, S.order, S.pointer);
    var act = Sched.activity(p), learned = Sched.learned(p), total = S.order.length;
    var pk = 'kanzi.g3.prevAct.' + (S.trial ? 'trial.' : '') + S.info.email, prev = Platform.store.get(pk);
    Platform.store.set(pk, act);
    var started = Object.keys(p.read).length;
    function modeBtn(id, label, n, dis) {
      return '<button class="big' + (n ? ' primary' : '') + '" id="' + id + '"' + (dis ? ' disabled' : '') + '>' + label + '<span class="meta">' + (dis ? 'よしゅうしてから' : n ? n + 'もん' : 'れんしゅう') + '</span></button>';
    }
    app.innerHTML =
      '<header class="top"><h1>3年生 かんじドリル</h1></header>' +
      '<main class="menu">' +
      '<section class="tree-box">' + Tree.render(act, learned, total, prev) + '</section>' +
      '<section class="actions">' +
      (queue.length ? '<button class="big" id="go-preview">よしゅう<span class="meta next-chars">' + esc(queue.slice(0, Sched.PREVIEW_CHUNK).join(' ')) + '</span></button>'
                    : '<div class="big done-note">3年の字は ぜんぶ よしゅうしたよ</div>') +
      '<div class="two">' + modeBtn('go-read', 'よむ', due.read.length, !started) + modeBtn('go-write', 'かく', due.write.length, !started) + '</div>' +
      '<div class="two"><button class="big" id="go-fk">カード<span class="meta">かんじ → よみ</span></button>' +
      '<button class="big" id="go-fy">カード<span class="meta">よみ → かんじ</span></button></div>' +
      '</section></main>' + (S.info.demo ? '<p class="demo-note">デモ（この端末にだけ保存）</p>' : '');
    on('#go-preview', startPreview);
    on('#go-read', function () { startMode('read'); });
    on('#go-write', function () { startMode('write'); });
    on('#go-fk', function () { startFlash('k'); });
    on('#go-fy', function () { startFlash('y'); });
  }

  // ---------------- ふくしゅう
  // よむ／かく: 期限が来た字を出す。期限の字がなければ、よしゅう済みの字から箱の小さい順に練習として出す
  var PRACTICE = { read: 10, write: 5 };
  function startMode(kind) {
    var p = S.p, t = today(), d = Sched.dueList(p, t, S.order), list = d[kind];
    if (!list.length) {
      var tbl = kind === 'read' ? p.read : p.write;
      list = Object.keys(p.read).sort(function (a, b) { return ((tbl[a] || [0])[0] - (tbl[b] || [0])[0]) || (S.order.indexOf(a) - S.order.indexOf(b)); }).slice(0, PRACTICE[kind]);
    }
    if (kind === 'write') list.forEach(function (c) { if (!p.write[c]) p.write[c] = [0, t, 0, 0]; }); // かくモードは読みの条件を待たない
    S.session = { items: list.map(function (c) { return { t: kind, c: c }; }), i: 0, n: 0 };
    nextItem();
  }

  // フラッシュカード: 答えの入力なし。タップで答え → もう一度タップで次へ。記録はしない
  function startFlash(dir) {
    var cs = Object.keys(S.p.read);
    if (!cs.length) cs = S.order.slice(0, 10).split('');
    for (var i = cs.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = cs[i]; cs[i] = cs[j]; cs[j] = x; }
    S.session = { items: cs.map(function (c) { return { t: 'flash', c: c, dir: dir }; }), i: 0, n: 0 };
    nextItem();
  }
  function flashCard(c, dir) {
    var w = wordFor(c, S.session.i), kan = Array.from(w[0]).map(function (ch) { return '<span class="' + (ch === c ? 'tg' : 'ot') + '">' + esc(ch) + '</span>'; }).join('');
    var front = dir === 'k' ? '<span class="word">' + kan + '</span>' : '<span class="fy">' + esc(w[1]) + '</span>';
    var back = dir === 'k' ? '<span class="fy">' + esc(w[1]) + '</span>' : '<span class="word">' + kan + '</span>';
    app.innerHTML = bar() + '<main class="read"><button class="card flash" id="card">' + front + '<span class="fback" id="fback" hidden>' + back + '</span></button></main>';
    on('#back', backToMenu);
    var shown = false;
    on('#card', function () {
      if (!shown) { shown = true; $('#fback').hidden = false; $('#card').classList.add('flipped'); speak(w[1]); return; }
      S.session.i++; S.session.n++; nextItem();
    });
  }
  function nextItem() {
    var s = S.session;
    if (s.i >= s.items.length) return reviewDone();
    var it = s.items[s.i];
    s.cur = it.c;
    if (it.t === 'read') readCard(it.c); else if (it.t === 'write') writeCard(it.c); else flashCard(it.c, it.dir);
  }
  function bar(extra) {
    var s = S.session;
    return '<header class="bar"><button class="back" id="back">もどる</button>' +
      '<span class="prog">' + Math.min(s.i + 1, s.items.length) + ' / ' + s.items.length + '</span>' + (extra || '<span></span>') + '</header>';
  }
  function backToMenu() { flush(); menu(); }

  // よむ: 読みをひらがなで入力して機械が採点する（設計書 D3）。
  // 1回目で正解した時だけ「できた」。間違えたら1回だけ打ち直せ、2回目も違えば答えを見せる。
  function readCard(c) {
    var e = S.p.read[c], w = wordFor(c, e && e[2]);
    var answers = [w[1]].concat(w[4] || []);
    var chars = Array.from(w[0]).map(function (ch) { return '<span class="' + (ch === c ? 'tg' : 'ot') + '">' + esc(ch) + '</span>'; }).join('');
    app.innerHTML = bar() +
      '<main class="read">' +
      '<div class="card" id="card"><span class="kana" id="kana">' + esc(w[1]) + '</span><span class="word">' + chars + '</span></div>' +
      '<form class="answer" id="form" autocomplete="off"><label class="q" for="yomi">よみを ひらがなで かこう</label>' +
      '<div class="answer-row"><input id="yomi" lang="ja" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">' +
      '<button class="btn-ok" id="ok" type="submit">こたえる</button></div></form>' +
      '<p class="rmsg" id="rmsg" aria-live="polite"></p>' +
      '<div class="after" id="after"><button class="btn-mada" id="idk" type="button">わからない</button></div>' +
      '</main>';
    on('#back', backToMenu);
    var input = $('#yomi'), msg = $('#rmsg'), composing = false, tries = 0, done = false;
    function say(t, cls) { msg.textContent = t; msg.className = 'rmsg' + (cls ? ' ' + cls : ''); }
    // 入力をひらがなだけに保つ（変換中は触らない）
    function tidy() {
      if (composing) return;
      var r = Kana.normalize(input.value, false), v = r.text + r.rest;
      if (v !== input.value) input.value = v;
      if (r.dropped) say('ひらがなで 入れてね'); else if (msg.textContent === 'ひらがなで 入れてね') say('');
    }
    input.addEventListener('compositionstart', function () { composing = true; });
    input.addEventListener('compositionend', function () { composing = false; tidy(); });
    input.addEventListener('input', tidy);
    input.focus();
    $('#form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (done || composing) return;
      var v = Kana.normalize(input.value, true).text;
      input.value = v;
      if (!v) { say('ひらがなで 入れてね'); return; }
      if (answers.indexOf(v) >= 0) return finish(tries === 0, true);
      tries++;
      if (tries < 2) { say('× ちがうよ。もういちど', 'ng'); input.select(); return; }
      finish(false, false);
    });
    on('#idk', function () { if (!done) finish(false, false); });
    function finish(ok, correct) {
      done = true;
      S.lastRec = Sched.answerRead(S.p, c, ok, today(), nowMs());
      S.session.i++; S.session.n++;
      commit();
      input.readOnly = true;
      $('#card').classList.add('flipped');
      speak(w[1]);
      say(correct ? (ok ? '✓ せいかい！' : '✓ せいかい（2かいめ）') : 'こたえは「' + w[1] + '」', correct ? 'good' : 'ans');
      $('#after').innerHTML = (canSpeak ? '<button class="speak" id="speak" type="button">🔊 きく</button>' : '') +
        '<button class="big primary" id="next" type="button">つぎへ</button>';
      on('#speak', function () { speak(w[1]); });
      var next = $('#next'), moved = false;
      function go() { if (moved) return; moved = true; nextItem(); }
      next.addEventListener('click', go);
      next.focus();
      setTimeout(function () { if (document.body.contains(next)) go(); }, ok ? 1100 : 2600); // 自動で次へ（まちがいは答えを読む時間を長めに）
    }
  }

  var STAGES = { trace: '① なぞる', hint: '② ヒント', free: '③ じぶんで' };
  function writeCard(c) {
    var e = S.p.write[c], w = wordFor(c, e && e[2]);
    var stages = e && e[0] > 0 ? ['free'] : ['trace', 'hint', 'free'];
    var si = 0, demoUsed = false;
    var prompt = Array.from(w[0]).map(function (ch) {
      return ch === c ? '<span class="blank"><ruby><span class="box">　</span><rt>' + esc(w[2]) + '</rt></ruby></span>' : '<span class="ot">' + esc(ch) + '</span>';
    }).join('');
    app.innerHTML = bar() +
      '<main class="write">' +
      '<div class="wl"><p class="prompt">' + prompt + '</p><p class="prompt-kana">' + esc(w[1]) + '</p>' +
      (stages.length > 1 ? '<ol class="stages">' + stages.map(function (s) { return '<li data-s="' + s + '">' + STAGES[s] + '</li>'; }).join('') + '</ol>' : '') +
      '<p class="msg" id="msg" aria-live="polite"></p>' +
      '<div class="tools"><button id="demo">おてほん</button><button id="redo">かきなおす</button></div></div>' +
      '<div class="padbox" id="pad"></div></main>';
    on('#back', backToMenu);
    var msg = $('#msg');
    function say(t) { msg.textContent = t; }
    function markStage() {
      app.querySelectorAll('.stages li').forEach(function (li, i) { li.className = i === si ? 'cur' : (i < si ? 'past' : ''); });
      say(stages[si] === 'trace' ? 'うすい線を なぞろう（●から かきはじめ）' : stages[si] === 'hint' ? 'つぎに かく 線だけ 見えるよ' : 'じぶんで かいてみよう');
    }
    var pad = new Ink.Pad($('#pad'), {
      strokes: ST[c], mode: stages[0],
      onMiss: function (kind) { say(kind === 'reverse' ? 'かく むきが ちがうよ。もういちど' : 'もういちど かいてみよう'); },
      onStroke: function () { if (stages[si] === 'free') say(''); },
      onDone: function (res) {
        if (si < stages.length - 1) { si++; setTimeout(function () { pad.setMode(stages[si]); markStage(); }, 350); return; }
        var ok = !res.assisted && !demoUsed;
        S.lastRec = Sched.answerWrite(S.p, c, ok, today(), nowMs());
        S.session.i++; S.session.n++;
        commit();
        var after = res.orderMiss > 0 ? (say('字は できたよ。かきじゅんを 見てみよう'), pad.demo(0.8)) : Promise.resolve();
        after.then(function () { result(ok, res.orderMiss > 0); });
      }
    });
    markStage();
    on('#demo', function () {
      if (stages[si] === 'free') demoUsed = true;
      say('見てから もういちど かこう');
      pad.demo();
    });
    on('#redo', function () { pad.reset(); markStage(); });
    function result(ok, orderMiss) {
      var box = document.createElement('div');
      box.className = 'result';
      box.innerHTML = '<p class="res ' + (ok ? 'good' : 'again') + '">' + (ok ? '✓ できた！' : '↺ また こんど かこう') + '</p>' +
        (orderMiss ? '<p class="res-note">かきじゅんを たしかめたよ</p>' : '') +
        '<button class="big primary" id="next">つぎへ</button>';
      $('.wl').appendChild(box);
      $('.tools').hidden = true;
      var moved = false, go = function () { if (!moved) { moved = true; nextItem(); } };
      on('#next', go);
      $('#next').focus();
      setTimeout(function () { if (!moved && document.body.contains(box)) go(); }, ok ? 1300 : 2200); // 自動で次へ
    }
  }

  function reviewDone() {
    flush();
    app.innerHTML = '<main class="done"><p class="done-big">おわり！</p><p>' + S.session.n + 'まい やったよ</p>' +
      '<button class="big primary" id="menu">メニューへ</button></main>';
    on('#menu', menu);
  }

  // ---------------- よしゅう
  function startPreview() {
    var q = Sched.previewQueue(S.p, S.order, S.pointer).slice(0, Sched.PREVIEW_CHUNK);
    S.session = { items: q.map(function (c) { return { t: 'preview', c: c }; }), i: 0, n: 0 };
    previewCard();
  }
  function previewCard() {
    var s = S.session;
    if (s.i >= s.items.length) return previewDone();
    var c = s.items[s.i].c, k = D.kanji[c];
    s.cur = c;
    var words = k.w.map(function (w, i) {
      return '<li><span class="pw">' + Array.from(w[0]).map(function (ch) { return ch === c ? '<b>' + esc(ch) + '</b>' : esc(ch); }).join('') + '</span>' +
        '<span class="pk">' + esc(w[1]) + '</span>' + (canSpeak ? '<button class="say" data-i="' + i + '" aria-label="きく">🔊</button>' : '') + '</li>';
    }).join('');
    app.innerHTML = bar() +
      '<main class="preview">' +
      '<div class="pv-pad"><div class="padbox" id="pad"></div>' +
      '<div class="tools"><button id="replay">かきじゅんを 見る</button><span class="strokes">' + k.n + 'かく</span></div></div>' +
      '<div class="pv-info"><ul class="words">' + words + '</ul>' +
      '<p class="pv-guide" id="guide">かきじゅんを 見てね</p>' +
      '<button class="big primary" id="next">つぎへ</button></div></main>';
    on('#back', backToMenu);
    var pad = new Ink.Pad($('#pad'), { strokes: ST[c], mode: 'show' });
    function show() {
      $('#guide').textContent = 'かきじゅんを 見てね';
      pad.demo().then(function () { pad.setMode('trace'); $('#guide').textContent = 'うすい線を なぞってみよう'; });
    }
    show();
    speak(k.w[0][1]);
    on('#replay', show);
    app.querySelectorAll('.say').forEach(function (b) { b.addEventListener('click', function () { speak(k.w[+b.dataset.i][1]); }); });
    on('#next', function () {
      Sched.preview(S.p, c, today(), nowMs());
      s.i++; s.n++;
      commit();
      previewCard();
    });
  }
  function previewDone() {
    flush();
    var left = Sched.previewQueue(S.p, S.order, S.pointer).length;
    app.innerHTML = '<main class="done"><p class="done-big">' + S.session.n + '字 よしゅうしたよ</p><p>あしたの ふくしゅうに 出てくるよ</p>' +
      (left ? '<button class="big" id="more">もう' + Math.min(Sched.PREVIEW_CHUNK, left) + '字 よしゅうする</button>' : '') +
      '<button class="big primary" id="menu">メニューへ</button></main>';
    on('#more', startPreview);
    on('#menu', menu);
  }

  // ---------------- 先生用（設計書 §5。児童ごとの記録は出さない）
  function teacher(klass) {
    klass = klass || S.klass || (S.info.classes || [])[0] || '';
    S.klass = klass;
    app.innerHTML = '<header class="top t"><h1>かんじドリル 先生用</h1><p class="sub">' + esc(klass) + (S.info.demo ? '（架空のデータ）' : '') + '</p>' +
      '<button class="try" id="show">書き順を 大きく見せる</button><button class="try" id="try">児童画面を ためす</button></header><main class="teacher"><p>よみこみ中…</p></main>';
    on('#try', function () { startTrial(klass); });
    on('#show', showPick);
    Promise.all([Platform.stats(klass), Platform.pointerOf(klass)]).then(function (r) {
      var st = r[0], pointer = r[1] || 0, order = S.order;
      var classes = (S.info.classes || []).length > 1 ? '<p><label>組 <select id="klass">' + S.info.classes.map(function (k) { return '<option' + (k === klass ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></label></p>' : '';
      var cells = Array.from(order).map(function (c, i) {
        return '<button class="cell' + (i < pointer ? ' taught' : '') + '" data-i="' + i + '" aria-pressed="' + (i < pointer) + '">' + esc(c) + '</button>';
      }).join('');
      var hard = Object.keys(st.perChar).map(function (c) { var v = st.perChar[c]; return { c: c, s: v[0], b: v[1], r: v[0] ? v[1] / v[0] : 0 }; })
        .filter(function (x) { return x.s >= 3 && x.b > 0; }).sort(function (a, b) { return b.r - a.r; }).slice(0, 20);
      $('.teacher').innerHTML = classes +
        '<section><h2>授業の進度</h2><p class="hint">授業で習った最後の字を押すと、そこまでが「習った字」になります（よしゅうで先に出ます）。いまは <b id="ptr">' + pointer + '</b> 字目まで。</p>' +
        '<div class="grid">' + cells + '</div></section>' +
        '<section><h2>学級でつまずいている字</h2><p class="hint">よしゅう済みの児童のうち、よむの自己採点で「まだ」になっている児童の割合が高い字（' + st.students + '人中。児童名は出しません）。</p>' +
        (hard.length ? '<ol class="hard">' + hard.map(function (x) { return '<li><span class="hc">' + esc(x.c) + '</span>' + x.s + '人中 ' + x.b + '人（' + Math.round(x.r * 100) + '%）</li>'; }).join('') + '</ol>' : '<p>まだ データが ありません。</p>') + '</section>' +
        '<details><summary>よしゅうの順番を変える（教科書の新出順を貼り付け）</summary><p class="hint">3年の200字を順番どおりに貼り付けます（区切りの空白・改行はあってもよい）。いまは「' + (order === D.order ? '配当表の順（仮）' : '設定済みの順') + '」。</p>' +
        '<textarea id="order" rows="5">' + esc(order) + '</textarea><p><button id="save-order">この順番にする</button> <span id="order-msg" aria-live="polite"></span></p></details>';
      var sel = $('#klass'); if (sel) sel.addEventListener('change', function () { teacher(sel.value); });
      app.querySelectorAll('.cell').forEach(function (b) {
        b.addEventListener('click', function () {
          var n = +b.dataset.i + 1;
          if (n === pointer) n = +b.dataset.i; // 同じ字をもう一度押すと1つ戻す
          pointer = n;
          app.querySelectorAll('.cell').forEach(function (x, i) { x.classList.toggle('taught', i < n); x.setAttribute('aria-pressed', i < n); });
          $('#ptr').textContent = n;
          Platform.setPointer(klass, n);
        });
      });
      on('#save-order', function () {
        var v = $('#order').value.replace(/[\s,、，・]/g, ''), m = $('#order-msg');
        var ok = Array.from(v).length === D.order.length && Array.from(v).every(function (c) { return D.kanji[c]; }) && new Set(Array.from(v)).size === D.order.length;
        if (!ok) { m.textContent = '× 3年の200字がちょうど1回ずつ入っていません（' + Array.from(v).length + '字）'; return; }
        Platform.setOrder(v).then(function () { S.order = v; m.textContent = '✓ 保存しました'; });
      });
    }).catch(function (e) { $('.teacher').innerHTML = '<p>よみこめませんでした: ' + esc(e && e.message || e) + '</p>'; });
  }

  // ---------------- 書き順の提示（先生がモニターに映す）
  // 1〜5字を選ぶ → 1字ずつ画面いっぱいに（右に音読み・左に訓読み）→ 最後にならべて書き順をくり返し再生
  var SHOW_MAX = 5;
  function showPick() {
    var picked = [];
    app.innerHTML = '<header class="top t"><h1>書き順を 大きく見せる</h1><p class="sub">見せる字を 順に押す（1〜' + SHOW_MAX + '字）</p></header>' +
      '<main class="teacher"><p class="picked" id="picked"></p>' +
      '<p><button class="big primary" id="go" disabled>はじめる</button></p>' +
      '<div class="grid">' + Array.from(S.order).map(function (c) { return '<button class="cell" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
      '<p><button id="cancel">先生画面にもどる</button></p></main>';
    function paint() {
      $('#picked').innerHTML = picked.length ? picked.map(function (c, i) { return '<span class="pk-item">' + (i + 1) + ' <b>' + esc(c) + '</b></span>'; }).join('') : '<span class="hint">まだ えらんでいません</span>';
      app.querySelectorAll('.cell').forEach(function (b) {
        var i = picked.indexOf(b.dataset.c);
        b.classList.toggle('taught', i >= 0);
        b.setAttribute('aria-pressed', i >= 0);
        b.disabled = i < 0 && picked.length >= SHOW_MAX;
      });
      $('#go').disabled = !picked.length;
    }
    app.querySelectorAll('.cell').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = picked.indexOf(b.dataset.c);
        if (i >= 0) picked.splice(i, 1); else if (picked.length < SHOW_MAX) picked.push(b.dataset.c);
        paint();
      });
    });
    on('#go', function () { showStart(picked.slice()); });
    on('#cancel', function () { teacher(S.klass); });
    paint();
  }

  function kanjiSvg(c, cls) {
    // 十字の点線（字全体のバランスの目安）。線は <line> にして、書き順アニメ（path が対象）に巻き込まない
    return '<svg viewBox="0 0 109 109" class="' + cls + '"><rect class="frame" x="0.8" y="0.8" width="107.4" height="107.4"/><line class="cross" x1="54.5" y1="1" x2="54.5" y2="108"/><line class="cross" x1="1" y1="54.5" x2="108" y2="54.5"/>' + ST[c].map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }
  // 読みがなの大きさ: 基本は 14vh（以前の倍）。長い読み・複数の読みが左右の余白に収まらない時だけ縮める
  function readSize(list) {
    var len = Math.max.apply(null, list.map(function (r) { return r.replace('.', '').length + (r.indexOf('.') >= 0 ? 0.7 : 0); }).concat([1]));
    var side = Math.max(120, (window.innerWidth - Math.min(window.innerHeight, window.innerWidth * 0.78)) / 2);
    var px = Math.min(window.innerHeight * 0.14, window.innerHeight * 0.88 / (len * 1.15), side * 0.9 / (list.length * 1.25 || 1));
    return Math.floor(px) + 'px';
  }
  // 読みを1文字ずつ縦に積む（CSS の縦書きより位置が安定し、区切りの縦棒を字の間に確実に置ける）
  var SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
  function stackChars(str, cls) {
    return Array.from(str).map(function (ch) {
      var c = 'ch' + (cls ? ' ' + cls : '') + (SMALL_KANA.indexOf(ch) >= 0 ? ' small' : '') + (ch === 'ー' ? ' long' : '');
      return '<span class="' + c + '">' + esc(ch) + '</span>';
    }).join('');
  }
  function readingHtml(list, kun) {
    return list.map(function (r) {
      var p = kun ? r.split('.') : [r];
      return '<span class="rd">' + stackChars(p[0]) + (p[1] ? '<span class="sep" aria-hidden="true"></span>' + stackChars(p[1], 'okuri') : '') + '</span>';
    }).join('');
  }

  function showStart(list) {
    var stage = document.createElement('div');
    stage.id = 'stage';
    document.body.appendChild(stage);
    try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {}); } catch (e) {}
    var idx = 0, loop = null;
    function stopLoop() { if (loop) { loop.stop = true; loop = null; } }
    function single() {
      stopLoop();
      var c = list[idx], k = D.kanji[c];
      stage.className = 'single';
      stage.innerHTML = '<div class="kun" aria-label="訓読み" style="font-size:' + readSize(k.kun) + '">' + readingHtml(k.kun, true) + '</div>' +
        '<div class="big-kanji">' + kanjiSvg(c, 'show-svg') + '</div>' +
        '<div class="on" aria-label="音読み" style="font-size:' + readSize(k.on) + '">' + readingHtml(k.on, false) + '</div>' +
        '<div class="stage-pos">' + (idx + 1) + ' / ' + list.length + '</div>';
      Ink.animate(Array.from(stage.querySelectorAll('.show-svg path')), 0.9);
    }
    // ならべて表示: 字がいちばん大きくなる行数を選ぶ
    function all() {
      stopLoop();
      // 字と字の間を少し空ける（十字の点線が隣の字とつながって見えないように）
      var W = stage.clientWidth, H = stage.clientHeight, n = list.length, best = { size: 0 }, gap = Math.round(Math.min(W, H) * 0.04);
      for (var rows = 1; rows <= n; rows++) {
        var cols = Math.ceil(n / rows), size = Math.min((W - gap * (cols - 1)) / cols, (H - gap * (rows - 1)) / rows);
        if (size > best.size) best = { size: size, rows: rows, cols: cols };
      }
      stage.className = 'all';
      stage.innerHTML = '<div class="all-grid" style="gap:' + gap + 'px;grid-template-columns:repeat(' + best.cols + ',' + Math.floor(best.size) + 'px);grid-auto-rows:' + Math.floor(best.size) + 'px">' +
        list.map(function (c) { return kanjiSvg(c, 'show-svg'); }).join('') + '</div>';
      var me = loop = { stop: false };
      var svgs = Array.from(stage.querySelectorAll('.show-svg'));
      (function play() {
        if (me.stop) return;
        Promise.all(svgs.map(function (svg) { return Ink.animate(Array.from(svg.querySelectorAll('path')), 0.9); }))
          .then(function () { setTimeout(function () {
            if (me.stop) return;
            svgs.forEach(function (svg) { svg.querySelectorAll('path').forEach(function (p) { p.getAnimations().forEach(function (a) { a.cancel(); }); }); });
            play();
          }, 1500); });
      })();
    }
    function next() { if (idx < list.length - 1) { idx++; single(); } else if (idx === list.length - 1) { idx++; all(); } }
    function prev() { if (idx > 0) { idx = Math.min(idx, list.length) - 1; single(); } }
    function exit() {
      stopLoop();
      document.removeEventListener('keydown', key);
      stage.remove();
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
      showPick();
    }
    function key(ev) {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); prev(); }
      else if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); next(); }
      else if (ev.key === 'Escape') exit();
    }
    stage.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.stage-exit')) return exit();
      next();
    });
    document.addEventListener('keydown', key);
    var x = document.createElement('button');
    single();
    x.className = 'stage-exit'; x.textContent = '×'; x.setAttribute('aria-label', 'おわる');
    document.body.appendChild(x);
    x.addEventListener('click', function () { x.remove(); exit(); });
    var obs = new MutationObserver(function () { if (!document.body.contains(stage)) { x.remove(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  }

  // ---------------- 先生のおためし（児童画面を試す。記録はこの端末だけ、サーバーへは送らない）
  function trialBar() {
    var bar = document.getElementById('trial-bar');
    if (!S.trial) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'trial-bar';
      document.body.insertBefore(bar, app);
    }
    bar.innerHTML = '<span class="tb-label">先生のおためし中（記録は この端末だけ）' + (S.dayOffset ? '・' + S.dayOffset + '日後' : '') + '</span>' +
      '<button id="tb-write">かく問題を 出す</button><button id="tb-day">1日すすめる</button><button id="tb-reset">はじめから</button><button id="tb-back">先生画面にもどる</button>';
    // 読みの条件（よむ箱3）を待たずに、書き問題を今日のふくしゅうに出す。まだ何もなければ最初の5字をよしゅう済みにする
    bar.querySelector('#tb-write').addEventListener('click', function () {
      var p = S.p, t = today();
      if (!Object.keys(p.read).length) Sched.previewQueue(p, S.order, S.pointer).slice(0, Sched.PREVIEW_CHUNK).forEach(function (c) { Sched.preview(p, c, t, nowMs()); });
      Object.keys(p.read).forEach(function (c) {
        if (p.read[c][0] < Sched.WRITE_UNLOCK_BOX) p.read[c][0] = Sched.WRITE_UNLOCK_BOX;
        if (!p.write[c]) p.write[c] = [0, t, 0, 0]; else p.write[c][1] = Math.min(p.write[c][1], t);
      });
      Platform.save(p);
      menu();
    });
    bar.querySelector('#tb-day').addEventListener('click', function () { S.dayOffset = (S.dayOffset || 0) + 1; trialBar(); menu(); });
    bar.querySelector('#tb-reset').addEventListener('click', function () {
      Platform.resetTrial(); S.p = Sched.newProgress(); S.dayOffset = 0;
      Platform.store.set('kanzi.g3.prevAct.trial.' + S.info.email, 0);
      trialBar(); menu();
    });
    bar.querySelector('#tb-back').addEventListener('click', endTrial);
  }
  function startTrial(klass) {
    // 進度は選んでいる組のものを使う（授業の進度に合わせた よしゅう の順も確かめられる）
    Platform.pointerOf(klass).then(function (ptr) {
      S.trial = true;
      S.pointer = ptr || 0;
      S.p = Platform.startTrial(S.info.email);
      S.dayOffset = 0;
      trialBar();
      menu();
    });
  }
  function endTrial() {
    S.trial = false; S.p = null; S.dayOffset = 0;
    Platform.endTrial();
    trialBar();
    teacher(S.klass);
  }

  // ---------------- 起動
  Platform.init().then(function (info) {
    S.info = info;
    if (info.order) S.order = info.order;
    S.pointer = info.pointer || 0;
    if (info.role === 'teacher') return teacher();
    if (info.role !== 'student') {
      app.innerHTML = '<main class="done"><p>このアカウントでは つかえません。学校のアカウントで ひらいてね。</p></main>';
      return;
    }
    S.p = info.progress || Sched.newProgress();
    menu();
  }).catch(function () {
    app.innerHTML = '<main class="done"><p>よみこめませんでした。</p><button class="big primary" onclick="location.reload()">もういちど ひらく</button></main>';
  });
})();

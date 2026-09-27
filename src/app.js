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
    app.innerHTML =
      '<header class="top"><h1>ヤルッキー</h1><p class="sub">3年生 かんじドリル</p></header>' +
      '<main class="menu">' +
      '<section class="tree-box">' + Tree.render(act, learned, total, prev) +
      '<p class="tree-cap"><span class="ico-leaf" aria-hidden="true"></span>はっぱ＝やった数 <b>' + act + '</b>' +
      '<span class="sep"></span><span class="ico-fruit" aria-hidden="true"></span>み＝おぼえた字 <b>' + learned + '</b> / ' + total + '</p></section>' +
      '<section class="actions">' +
      (nDue ? '<button class="big primary" id="go-review">ふくしゅう<span class="meta">' + nDue + 'まい</span></button>'
            : '<div class="big done-note">きょうの ふくしゅうは おわり ✓</div>') +
      (queue.length ? '<button class="big" id="go-preview">よしゅう<span class="meta next-chars">' + esc(queue.slice(0, Sched.PREVIEW_CHUNK).join(' ')) + '</span></button>'
                    : '<div class="big done-note">3年の字は ぜんぶ よしゅうしたよ</div>') +
      '</section></main>' + (S.info.demo ? '<p class="demo-note">デモ（この端末にだけ保存）</p>' : '');
    on('#go-review', startReview);
    on('#go-preview', startPreview);
  }

  // ---------------- ふくしゅう
  function startReview() {
    var d = Sched.dueList(S.p, today(), S.order);
    S.session = { items: d.read.map(function (c) { return { t: 'read', c: c }; }).concat(d.write.map(function (c) { return { t: 'write', c: c }; })), i: 0, n: 0 };
    nextItem();
  }
  function nextItem() {
    var s = S.session;
    if (s.i >= s.items.length) return reviewDone();
    var it = s.items[s.i];
    s.cur = it.c;
    if (it.t === 'read') readCard(it.c); else writeCard(it.c);
  }
  function bar(extra) {
    var s = S.session;
    return '<header class="bar"><button class="back" id="back">もどる</button>' +
      '<span class="prog">' + Math.min(s.i + 1, s.items.length) + ' / ' + s.items.length + '</span>' + (extra || '<span></span>') + '</header>';
  }
  function backToMenu() { flush(); menu(); }

  function readCard(c) {
    var e = S.p.read[c], w = wordFor(c, e && e[2]);
    var chars = Array.from(w[0]).map(function (ch) { return '<span class="' + (ch === c ? 'tg' : 'ot') + '">' + esc(ch) + '</span>'; }).join('');
    app.innerHTML = bar(S.lastRec && S.lastRec.kind === 'read' ? '<button class="undo" id="undo">ひとつ もどる</button>' : '<span></span>') +
      '<main class="read">' +
      '<button class="card" id="card" aria-label="タップすると こたえが 見られる"><span class="kana" id="kana">' + esc(w[1]) + '</span><span class="word">' + chars + '</span>' +
      '<span class="tap-hint" id="tap">タップして こたえを 見る</span></button>' +
      '<div class="judge" id="judge"><button class="btn-mada" id="mada">まだ</button><button class="btn-ok" id="ok">おぼえた</button></div>' +
      (canSpeak ? '<button class="speak" id="speak" hidden>🔊 もういちど きく</button>' : '') +
      '</main>';
    on('#back', backToMenu);
    on('#undo', undo);
    var flipped = false;
    on('#card', function () {
      if (flipped) return;
      flipped = true;
      $('#card').classList.add('flipped');
      $('#judge').classList.add('show');
      var sp = $('#speak'); if (sp) sp.hidden = false;
      speak(w[1]);
    });
    on('#speak', function () { speak(w[1]); });
    function answer(ok) {
      S.lastRec = Sched.answerRead(S.p, c, ok, today(), nowMs());
      S.lastRec.index = S.session.i;
      S.session.i++; S.session.n++;
      commit();
      nextItem();
    }
    on('#mada', function () { answer(false); });
    on('#ok', function () { answer(true); });
  }

  function undo() {
    if (!S.lastRec) return;
    Sched.undo(S.p, S.lastRec);
    S.session.i = S.lastRec.index; S.session.n--;
    S.lastRec = null;
    Platform.save(S.p);
    nextItem();
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
      on('#next', nextItem);
      $('#next').focus();
    }
  }

  function reviewDone() {
    flush();
    app.innerHTML = '<main class="done"><p class="done-big">ふくしゅう おわり！</p><p>' + S.session.n + 'まい やったよ</p>' +
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
    app.innerHTML = '<header class="top t"><h1>ヤルッキー 先生用</h1><p class="sub">' + esc(klass) + (S.info.demo ? '（架空のデータ）' : '') + '</p>' +
      '<button class="try" id="try">児童画面を ためす</button></header><main class="teacher"><p>よみこみ中…</p></main>';
    on('#try', function () { startTrial(klass); });
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
      '<button id="tb-day">1日すすめる</button><button id="tb-reset">はじめから</button><button id="tb-back">先生画面にもどる</button>';
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

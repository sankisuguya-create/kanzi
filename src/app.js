// 画面（設計書 §4・§5）。
// 児童: メニュー（学年タブ・木）→ 漢字を ぜんぶ見る（見る／選ぶ）／よむ／かく／カード／えらんだ漢字を見る
// 先生: 見せる学年・進度・つまずき集計、書き順の提示、児童画面のおためし
(function () {
  'use strict';
  var D = KANZI_DATA, ST = KANZI_STROKES;
  var app = document.getElementById('app');
  // 日本語の字形を使わせる（中国語フォント・中国語の字形を出さない）。GAS の埋め込みでも確実にするため JS でも付ける
  document.documentElement.lang = 'ja'; document.body.lang = 'ja';
  var S = { info: null, p: null, grades: [3], grade: 3, pointers: {}, orders: {}, sinceFlush: 0, session: null, open: {} };
  var FLUSH_EVERY = 10;
  var SIZE = { read: 10, write: 5, fk: 10, fy: 10 }; // 1回の問題数（えらんだ漢字は全部。上限 SEL_MAX）
  var SEL_MAX = 30;
  window.KanziState = S; // 検証・デバッグ用（tests/e2e.mjs が現在の字を読む）

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(sel) { return app.querySelector(sel); }
  function on(sel, fn) { var e = $(sel); if (e) e.addEventListener('click', fn); }
  // 先生のおためしでは「1日すすめる」で日付をずらせる（S.dayOffset）。本番の児童は常に0
  function nowMs() { return Date.now() + (S.dayOffset || 0) * 86400000; }
  function today() { return Sched.day(new Date(nowMs())); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

  var canSpeak = 'speechSynthesis' in window;
  function speak(t) {
    if (!canSpeak) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.rate = 0.9; speechSynthesis.speak(u); } catch (e) {}
  }

  // 学年ごとの出題順（先生が貼り付けた順があればそれ、なければ配当表の順）
  function orderOf(g) { return S.orders[g] || D.grades[g].order; }
  function maxGrade() { return Math.max.apply(null, S.grades); }
  // 習った漢字: 下の学年は全部。いちばん上の学年は先生の進度まで（進度を設定していなければ全部）
  function learnedChars(g) {
    var o = orderOf(g), ptr = S.pointers[g];
    return (g < maxGrade() || !ptr) ? o.split('') : o.slice(0, ptr).split('');
  }
  // 児童向けの文言: [漢|よみ] と書いた漢字は、その子の学年（見せる学年のいちばん上）までに習う字なら漢字、
  // まだ習わない字なら よみ（ひらがな）で出す。学年別漢字配当表どおりの交ぜ書き（例: 1・2年「かん字」、3年から「漢字」）
  function K(str) {
    var g = maxGrade();
    return String(str).replace(/\[([^|\]]+)\|([^\]]+)\]/g, function (_, k, r) { var i = D.kanji[k]; return i && i.g <= g ? k : r; });
  }
  // 次の漢字テストの範囲（先生が指定した字。学年をまたいでよい）
  function testChars() { return S.test && S.test.chars ? Array.from(S.test.chars).filter(function (c) { return D.kanji[c]; }) : []; }
  function allowedChars() { return S.grades.map(orderOf).join('').split(''); }

  // 例語は答えた回数ごとに入れ替える（音・訓を交互に：D7）
  function wordFor(c, n) { var w = D.kanji[c].w; return w[(n || 0) % w.length]; }
  function wordHtml(w, c) { return Array.from(w[0]).map(function (ch) { return '<span class="' + (ch === c ? 'tg' : 'ot') + '">' + esc(ch) + '</span>'; }).join(''); }

  function commit() {
    Platform.save(S.p);
    if (++S.sinceFlush >= FLUSH_EVERY) flush();
  }
  function flush() {
    S.sinceFlush = 0;
    if (!S.p) return Promise.resolve();
    var trial = !!S.trial;
    // 送信中に答えた分は Platform が「いまの S.p」と統合して返す。戻るまでに おためしの開始・終了があれば捨てる
    return Platform.flush(function () { return S.p; }).then(function (m) { if (S.p && !!S.trial === trial && m) S.p = m; });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && S.p) flush(); });

  // 画面を切り替えるたびに、動いている書き順アニメ・キー操作を止める
  var cleanup = [];
  function clearScreen() { cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = []; }
  function onKey(fn) { document.addEventListener('keydown', fn); cleanup.push(function () { document.removeEventListener('keydown', fn); }); }

  // タイトル「漢字の森」。森は筆順データの線で描き、3つの木（1〜4画・5〜8画・9〜12画）を別の色にする（色は飾り）
  function titleHtml(extra) {
    var st = ST['森'], trees = [[0, 4], [4, 8], [8, 12]];
    var mori = '<svg class="mori" viewBox="8 5.5 94.3 98" role="img" aria-label="森">' + trees.map(function (t, i) {
      return '<g class="tree' + (i + 1) + '">' + st.slice(t[0], t[1]).map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g>';
    }).join('') + '</svg>';
    return '<h1 class="title">漢字の' + mori + (extra ? '<span class="title-extra">' + extra + '</span>' : '') + '</h1>';
  }

  // ================= 児童: メニュー
  function tabs(cur, cls) {
    if (S.grades.length < 2) return '';
    return '<nav class="tabs ' + (cls || '') + '" role="tablist">' + S.grades.map(function (g) {
      return '<button role="tab" class="tab" data-g="' + g + '" aria-selected="' + (g === cur) + '">' + g + '年</button>';
    }).join('') + '</nav>';
  }
  function bindTabs(fn) { app.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { fn(+b.dataset.g); }); }); }

  function menu() {
    clearScreen();
    var p = S.p, g = S.grade;
    var act = Sched.activity(p), chars = allowedChars(), learned = Sched.learned(p, chars);
    var pk = 'kanzi.prevAct.' + (S.trial ? 'trial.' : '') + S.info.email, prev = Platform.store.get(pk);
    Platform.store.set(pk, act);
    var nSel = Sched.selected(p, orderOf(g)).length;
    app.innerHTML =
      '<header class="top">' + titleHtml() + tabs(g) + '</header>' +
      '<main class="menu">' +
      '<section class="tree-box">' + Tree.render(act, learned, chars.length, prev) + '</section>' +
      '<section class="actions">' +
      '<button class="big" id="go-browse">' + g + K('年の[漢|かん][字|じ]を ぜんぶ[見|み]る<span class="meta">') + orderOf(g).length + K('[字|じ]・[見|み]る／[選|えら]ぶ</span></button>') +
      K('<div class="two"><button class="big primary" id="go-read">[読|よ]む<span class="meta">[漢|かん][字|じ] → [読|よ]みを [書|か]く</span></button>') +
      K('<button class="big primary" id="go-write">[書|か]く<span class="meta">[読|よ]み → [漢|かん][字|じ]を [書|か]く</span></button></div>') +
      K('<div class="two"><button class="big" id="go-fk">カード<span class="meta">[漢|かん][字|じ] → [読|よ]み</span></button>') +
      K('<button class="big" id="go-fy">カード<span class="meta">[読|よ]み → [漢|かん][字|じ]</span></button></div>') +
      (testChars().length ? '<button class="big test" id="go-test">' + K('[次|つぎ]の[漢|かん][字|じ]テストの はんいを [見|み]る') + '<span class="meta">' + (S.test.label ? esc(S.test.label) + '・' : '') + testChars().length + K('[字|じ]') + '</span></button>' : '') +
      '<button class="big" id="go-seen"' + (nSel ? '' : ' disabled') + '>' + K('[選|えら]んだ[漢|かん][字|じ]を[見|み]る') + '<span class="meta">' + (nSel ? nSel + K('[字|じ]') : K('まだ [選|えら]んでいないよ')) + '</span></button>' +
      '</section></main>' + (S.info.demo && !S.trial ? '<p class="demo-note">デモ（この端末にだけ保存）</p>' : '');
    bindTabs(function (ng) { S.grade = ng; menu(); });
    on('#go-browse', function () { browse('look'); });
    on('#go-read', function () { chooser('read'); });
    on('#go-write', function () { chooser('write'); });
    on('#go-fk', function () { chooser('fk'); });
    on('#go-fy', function () { chooser('fy'); });
    on('#go-test', function () { viewChars(testChars(), 0, menu); });
    on('#go-seen', function () { var l = Sched.selected(S.p, orderOf(S.grade)); if (l.length) viewChars(l, 0, menu); });
  }

  // ================= 児童: 漢字を ぜんぶ見る（見る／えらぶ）
  function browse(mode) {
    clearScreen();
    var g = S.grade, order = orderOf(g).split('');
    app.innerHTML =
      '<header class="bar"><button class="back" id="back">もどる</button><span class="prog">' + g + K('年の[漢|かん][字|じ]（') + order.length + K('[字|じ]）') + '</span><span></span></header>' +
      '<div class="browse-tools"><div class="seg" role="group" aria-label="おしたときの うごき">' +
      '<button id="m-look" aria-pressed="' + (mode === 'look') + '">👀 ' + K('[見|み]る') + '</button><button id="m-pick" aria-pressed="' + (mode === 'pick') + '">✓ ' + K('[選|えら]ぶ') + '</button></div>' +
      '<span class="sel-count" id="selc"></span>' +
      (mode === 'pick' ? K('<button class="clear" id="clear">[選|えら]んだ[字|じ]を ぜんぶ はずす</button>') : '') + '</div>' +
      '<p class="browse-hint">' + (mode === 'look' ? K('[字|じ]を おすと、[書|か]き[順|じゅん]と [言|こと][葉|ば]が [見|み]られるよ') : K('[字|じ]を おすと、[問|もん][題|だい]に [出|だ]す[字|じ]に [選|えら]べるよ（もう[一|いち][度|ど] おすと はずれる）')) + '</p>' +
      '<div class="kgrid" id="kgrid">' + order.map(function (c) { return '<button class="kc" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    function paint() {
      var n = 0;
      app.querySelectorAll('.kc').forEach(function (b) {
        var s = Sched.isSel(S.p, b.dataset.c); if (s) n++;
        b.classList.toggle('sel', s);
        b.setAttribute('aria-pressed', s);
      });
      $('#selc').textContent = K('[選|えら]んだ[字|じ] ') + n;
    }
    on('#back', menu);
    on('#m-look', function () { browse('look'); });
    on('#m-pick', function () { browse('pick'); });
    on('#clear', function () { order.forEach(function (c) { if (Sched.isSel(S.p, c)) Sched.setSel(S.p, c, false, nowMs()); }); commit(); paint(); });
    app.querySelectorAll('.kc').forEach(function (b, i) {
      b.addEventListener('click', function () {
        if (mode === 'look') return viewChars(order, i, function () { browse('look'); });
        Sched.setSel(S.p, b.dataset.c, !Sched.isSel(S.p, b.dataset.c), nowMs());
        commit();
        paint();
      });
    });
    paint();
  }

  // ================= 字の表示（先生のモニター表示と同じ形: 外枠・十字・うす文字の上を黒で書き順、左右に読み）
  var SHOW_OPTS_KEY = 'kanzi.showOpts';
  function showOpts() { var o = Platform.store.get(SHOW_OPTS_KEY) || {}; return { base: o.base !== false }; }
  function kanjiSvg(c, cls, base) {
    // 十字の点線（字全体のバランスの目安）。線は <line> にして、書き順アニメ（path が対象）に巻き込まない
    return '<svg viewBox="0 0 109 109" class="' + cls + '"><rect class="frame" x="0.8" y="0.8" width="107.4" height="107.4"/><line class="cross" x1="54.5" y1="1" x2="54.5" y2="108"/><line class="cross" x1="1" y1="54.5" x2="108" y2="54.5"/>' +
      (base ? '<g class="base">' + ST[c].map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g>' : '') +
      '<g class="ink">' + ST[c].map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g></svg>';
  }
  // 読みがなの大きさ: 字の高さ H の14%を基本とし、長い読み・複数の読みが左右の幅 side に収まらない時だけ縮める
  function readSize(list, H, side) {
    var len = Math.max.apply(null, list.map(function (r) { return r.replace('.', '').length + (r.indexOf('.') >= 0 ? 0.7 : 0); }).concat([1]));
    return Math.floor(Math.min(H * 0.14, H * 0.88 / (len * 1.15), side * 0.9 / (list.length * 1.25 || 1))) + 'px';
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
  // 書き順をくり返し再生する。終わったら1.5秒止めてから最初から。戻り値で止める
  function playLoop(svgs) {
    var me = { stop: false };
    (function play() {
      if (me.stop) return;
      Promise.all(svgs.map(function (svg) { return Ink.animate(Array.from(svg.querySelectorAll('.ink path')), 0.9); }))
        .then(function () { setTimeout(function () {
          if (me.stop) return;
          svgs.forEach(function (svg) { svg.querySelectorAll('.ink path').forEach(function (p) { p.getAnimations().forEach(function (a) { a.cancel(); }); }); });
          play();
        }, 1500); });
    })();
    return function () { me.stop = true; };
  }
  // 左右に読み、中央に字（H: 字の一辺 px、side: 左右それぞれの幅 px）
  function monitorHtml(c, H, side) {
    var k = D.kanji[c];
    return '<div class="kun" aria-label="訓読み" style="font-size:' + readSize(k.kun, H, side) + '">' + readingHtml(k.kun, true) + '</div>' +
      '<div class="mon-kanji" style="width:' + H + 'px;height:' + H + 'px">' + kanjiSvg(c, 'show-svg', true) + '</div>' +
      '<div class="on" aria-label="音読み" style="font-size:' + readSize(k.on, H, side) + '">' + readingHtml(k.on, false) + '</div>';
  }

  // 1字ずつ見る（右に字、左にその字を使ったことば）。←→ で前後、「えらぶ」で問題に出す字にできる
  function viewChars(list, idx, back) {
    clearScreen();
    var c = list[idx], k = D.kanji[c];
    var H = Math.floor(Math.min(window.innerHeight * 0.66, window.innerWidth * 0.36)), side = Math.floor(H * 0.3);
    var words = k.w.map(function (w, i) {
      return '<li><span class="vw">' + wordHtml(w, c) + '</span><span class="vk">' + esc(w[1]) + '</span>' +
        (canSpeak ? '<button class="say" data-i="' + i + '" aria-label="きく">🔊</button>' : '') + '</li>';
    }).join('');
    app.innerHTML =
      '<header class="bar"><button class="back" id="back">もどる</button><span class="prog">' + (idx + 1) + ' / ' + list.length + '</span>' +
      '<span class="nav"><button id="prev"' + (idx ? '' : ' disabled') + '>← ' + K('[前|まえ]') + '</button><button id="next"' + (idx < list.length - 1 ? '' : ' disabled') + '>' + K('[次|つぎ]') + ' →</button></span></header>' +
      '<main class="view"><section class="vwords"><h2>' + esc(c) + K(' を [使|つか]う [言|こと][葉|ば]</h2>') + '<ul>' + words + '</ul>' +
      '<p class="vmeta">' + k.n + K('[画|かく]・') + k.g + '年</p>' +
      '<button class="pick-one" id="pick" aria-pressed="' + Sched.isSel(S.p, c) + '"></button></section>' +
      '<section class="monitor">' + monitorHtml(c, H, side) + '</section></main>';
    function paintPick() { var s = Sched.isSel(S.p, c); var b = $('#pick'); b.setAttribute('aria-pressed', s); b.textContent = s ? K('✓ [選|えら]んでいる（おすと はずす）') : K('☆ この[字|じ]を [選|えら]ぶ'); }
    paintPick();
    cleanup.push(playLoop(Array.from(app.querySelectorAll('.show-svg'))));
    on('#back', back);
    on('#prev', function () { if (idx > 0) viewChars(list, idx - 1, back); });
    on('#next', function () { if (idx < list.length - 1) viewChars(list, idx + 1, back); });
    on('#pick', function () { Sched.setSel(S.p, c, !Sched.isSel(S.p, c), nowMs()); commit(); paintPick(); });
    app.querySelectorAll('.say').forEach(function (b) { b.addEventListener('click', function () { speak(k.w[+b.dataset.i][1]); }); });
    onKey(function (ev) {
      if (ev.key === 'ArrowLeft' && idx > 0) viewChars(list, idx - 1, back);
      else if (ev.key === 'ArrowRight' && idx < list.length - 1) viewChars(list, idx + 1, back);
    });
  }

  // ================= 児童: 問題の始め方（どの字で やるか）
  var KIND_NAME = { read: '[読|よ]む', write: '[書|か]く', fk: 'カード（[漢|かん][字|じ] → [読|よ]み）', fy: 'カード（[読|よ]み → [漢|かん][字|じ]）' };
  function sources(kind) {
    var g = S.grade, order = orderOf(g), n = SIZE[kind], tbl = kind === 'write' ? 'write' : 'read';
    var due = Sched.dueList(S.p, today(), order)[tbl];
    var test = testChars();
    return (test.length ? [{ id: 'test', label: '[次|つぎ]の[漢|かん][字|じ]テストの はんい', sub: S.test.label ? esc(S.test.label) : '', list: shuffle(test.slice()).slice(0, SEL_MAX) }] : []).concat([
      { id: 'due', label: 'おすすめ', sub: '[忘|わす]れそうな[字|じ]', list: due.slice(0, n) },
      { id: 'sel', label: '[選|えら]んだ[漢|かん][字|じ]', sub: '[自|じ][分|ぶん]で [選|えら]んだ[字|じ]', list: Sched.selected(S.p, order).slice(0, SEL_MAX) },
      { id: 'rnd', label: '[習|なら]った[漢|かん][字|じ]から ランダム', sub: '', list: shuffle(learnedChars(g).slice()).slice(0, n) },
      { id: 'miss', label: 'まちがいの [多|おお]い[漢|かん][字|じ]', sub: '', list: Sched.missList(S.p, tbl, order).slice(0, n) }
    ]);
  }
  function chooser(kind) {
    clearScreen();
    var src = sources(kind);
    app.innerHTML =
      '<header class="bar"><button class="back" id="back">もどる</button><span class="prog">' + K(KIND_NAME[kind]) + '・' + S.grade + '年</span><span></span></header>' +
      K('<main class="chooser"><h2>どの[字|じ]で やる？</h2>') + src.map(function (s) {
        return '<button class="big' + (s.list.length ? '' : ' empty') + '" data-id="' + s.id + '"' + (s.list.length ? '' : ' disabled') + '>' + K(s.label) +
          '<span class="meta">' + (s.list.length ? s.list.length + K('[問|もん]') + (s.sub ? '・' + K(s.sub) : '') : K('[今|いま]は ないよ')) + '</span></button>';
      }).join('') + '</main>';
    on('#back', menu);
    app.querySelectorAll('.chooser .big').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = src.filter(function (x) { return x.id === b.dataset.id; })[0];
        startSession(kind, s.list.slice());
      });
    });
  }
  function startSession(kind, list) {
    S.session = { kind: kind, items: list, i: 0, results: {}, startedAt: nowMs() };
    nextItem();
  }
  function nextItem() {
    clearScreen();
    var s = S.session;
    if (s.i >= s.items.length) return sessionDone();
    var c = s.items[s.i];
    s.cur = c;
    if (s.kind === 'read') readCard(c); else if (s.kind === 'write') writeCard(c); else flashCard(c, s.kind === 'fk' ? 'k' : 'y');
  }
  function bar() {
    var s = S.session;
    return '<header class="bar"><button class="back" id="back">やめる</button>' +
      '<span class="prog">' + Math.min(s.i + 1, s.items.length) + ' / ' + s.items.length + '</span><span></span></header>';
  }
  // 途中でやめた回は木に数えない
  function quit() { flush(); menu(); }

  // よむ: 読みをひらがなで入力して機械が採点する（設計書 D3）。答えは送り仮名をのぞいた部分（悪い → わる）。
  // 1回目で正解した時だけ「できた」。間違えたら1回だけ打ち直せ、2回目も違えば答えを見せる。
  function readCard(c) {
    var e = S.p.read[c], w = wordFor(c, e && e[2]);
    var okuri = (w[0].match(/[ぁ-ゖ]+$/) || [''])[0];
    function strip(k) { return okuri && k.slice(-okuri.length) === okuri ? k.slice(0, -okuri.length) : k; }
    var full = [w[1]].concat(w[4] || []), answers = full.map(strip).concat(full); // 送り仮名まで書いても正解にする
    var shown = strip(w[1]);
    app.innerHTML = bar() +
      '<main class="read">' +
      '<div class="card" id="card"><span class="kana" id="kana">' + esc(w[1]) + '</span><span class="word">' + wordHtml(w, c) + '</span></div>' +
      '<form class="answer" id="form" autocomplete="off"><label class="q" for="yomi">' + K('[読|よ]みを ひらがなで [書|か]こう') + (okuri ? K('（[送|おく]りがなは [書|か]かない）') : '') + '</label>' +
      '<div class="answer-row"><input id="yomi" lang="ja" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">' +
      (okuri ? '<span class="okuri-after" aria-label="おくりがな">' + esc(okuri) + '</span>' : '') +
      K('<button class="btn-ok" id="ok" type="submit">[答|こた]える</button></div></form>') +
      '<p class="rmsg" id="rmsg" aria-live="polite"></p>' +
      '<div class="after" id="after"><button class="btn-mada" id="idk" type="button">わからない</button></div>' +
      '</main>';
    on('#back', quit);
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
      if (tries < 2) { say(K('× ちがうよ。もう[一|いち][度|ど]'), 'ng'); input.select(); return; }
      finish(false, false);
    });
    on('#idk', function () { if (!done) finish(false, false); });
    function finish(ok, correct) {
      done = true;
      Sched.answerRead(S.p, c, ok, today(), nowMs());
      S.session.results[c] = ok;
      S.session.i++;
      commit();
      input.readOnly = true;
      $('#card').classList.add('flipped');
      speak(w[1]);
      say(correct ? (ok ? K('✓ [正|せい][解|かい]！') : K('✓ [正|せい][解|かい]（2[回|かい]め）')) : K('[答|こた]えは「') + shown + '」' + (okuri ? '（' + okuri + '）' : ''), correct ? 'good' : 'ans');
      $('#after').innerHTML = (canSpeak ? K('<button class="speak" id="speak" type="button">🔊 [聞|き]く</button>') : '') +
        K('<button class="big primary" id="next" type="button">[次|つぎ]へ</button>');
      on('#speak', function () { speak(w[1]); });
      var next = $('#next'), moved = false;
      function go() { if (moved) return; moved = true; nextItem(); }
      next.addEventListener('click', go);
      next.focus();
      setTimeout(function () { if (document.body.contains(next)) go(); }, ok ? 1100 : 2600); // 自動で次へ（まちがいは答えを読む時間を長めに）
    }
  }

  // かく: 読みを見て、見本なしで書く。1画ずつ判定。同じ線を2回続けてまちがえたら正しい書き順を見せて「まちがい」で次へ
  function writeCard(c) {
    var e = S.p.write[c], w = wordFor(c, e && e[2]);
    var prompt = Array.from(w[0]).map(function (ch) {
      return ch === c ? '<span class="blank"><ruby><span class="box">　</span><rt>' + esc(w[2]) + '</rt></ruby></span>' : '<span class="ot">' + esc(ch) + '</span>';
    }).join('');
    app.innerHTML = bar() +
      '<main class="write">' +
      '<div class="wl"><p class="prompt">' + prompt + '</p><p class="prompt-kana">' + esc(w[1]) + '</p>' +
      K('<p class="msg" id="msg" aria-live="polite">□の [字|じ]を [書|か]こう</p>') +
      K('<div class="tools"><button id="redo">[書|か]きなおす</button></div></div>') +
      '<div class="padbox" id="pad"></div></main>';
    on('#back', quit);
    var msg = $('#msg'), finished = false;
    function say(t) { msg.textContent = t; }
    function record(ok, note) {
      if (finished) return; finished = true;
      Sched.answerWrite(S.p, c, ok, today(), nowMs());
      S.session.results[c] = ok;
      S.session.i++;
      commit();
      return note;
    }
    var pad = new Ink.Pad($('#pad'), {
      strokes: ST[c], mode: 'free',
      onMiss: function (kind) { say(kind === 'reverse' ? K('[書|か]く [向|む]きが ちがうよ。もう[一|いち][度|ど]') : K('もう[一|いち][度|ど] [書|か]いてみよう')); },
      onStroke: function () { say(''); },
      onStuck: function () {
        record(false);
        say(K('[正|ただ]しい [書|か]き[順|じゅん]を [見|み]よう'));
        pad.demo(0.8).then(function () { pad.mode = 'show'; pad.tplPaths.forEach(function (p) { p.setAttribute('class', 'g-demo'); }); result(false, false); });
      },
      onDone: function (res) {
        var ok = !res.assisted;
        record(ok);
        var after = res.orderMiss > 0 ? (say(K('[字|じ]は できたよ。[書|か]き[順|じゅん]を [見|み]てみよう')), pad.demo(0.8)) : Promise.resolve();
        after.then(function () { result(ok, res.orderMiss > 0); });
      }
    });
    on('#redo', function () { if (!finished) { pad.reset(); say(K('□の [字|じ]を [書|か]こう')); } });
    function result(ok, orderMiss) {
      var box = document.createElement('div');
      box.className = 'result';
      box.innerHTML = '<p class="res ' + (ok ? 'good' : 'again') + '">' + (ok ? '✓ できた！' : K('↺ また [今|こん][度|ど] [書|か]こう')) + '</p>' +
        (orderMiss ? K('<p class="res-note">[書|か]き[順|じゅん]を たしかめたよ</p>') : '') +
        K('<button class="big primary" id="next">[次|つぎ]へ</button>');
      $('.wl').appendChild(box);
      $('.tools').hidden = true;
      var moved = false, go = function () { if (!moved) { moved = true; nextItem(); } };
      on('#next', go);
      $('#next').focus();
      setTimeout(function () { if (!moved && document.body.contains(box)) go(); }, ok ? 1300 : 2200); // 自動で次へ
    }
  }

  // カード: 答えの入力なし。画面のどこを押しても 答え → 次 と進む（キーは Space・Enter・→）。記録はしない。
  // よみは上・漢字は下に固定し、答えの欄も はじめから場所をとっておく（visibility で隠すだけ）。答えが出ても字が動かない
  function flashCard(c, dir) {
    var w = wordFor(c, S.session.i), ans = dir === 'k' ? 'fy-row' : 'fk-row';
    app.innerHTML = bar() + '<main class="flash" id="flash"><div class="fcard" id="card">' +
      '<div class="frow fy-row' + (ans === 'fy-row' ? ' ans' : '') + '"><span class="fy">' + esc(w[1]) + '</span></div>' +
      '<div class="frow fk-row' + (ans === 'fk-row' ? ' ans' : '') + '"><span class="word">' + wordHtml(w, c) + '</span></div>' +
      K('<p class="ftap" id="ftap">おすと [答|こた]え</p></div></main>');
    on('#back', quit);
    var shown = false;
    function step() {
      if (!shown) { shown = true; $('#card').classList.add('flipped'); $('#ftap').textContent = K('おすと [次|つぎ]へ'); speak(w[1]); return; }
      S.session.i++; nextItem();
    }
    $('#flash').addEventListener('click', step);
    onKey(function (ev) { if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'ArrowRight') { ev.preventDefault(); step(); } });
  }

  // 最後まで終えた時: 木を育て、出た字の一覧（○×）と「えらぶ」のチェックを出す
  function sessionDone() {
    var s = S.session, graded = s.kind === 'read' || s.kind === 'write';
    Sched.finishSession(S.p, s.startedAt, s.items.length);
    Platform.save(S.p);
    flush();
    app.innerHTML =
      '<main class="done wide"><p class="done-big">おわり！ ' + s.items.length + K('[問|もん] やったよ</p>') +
      K('<p class="hint">チェックを はずすと、[選|えら]んだ[漢|かん][字|じ]から はずれるよ</p>') +
      '<ul class="endlist">' + s.items.map(function (c) {
        var r = s.results[c];
        return '<li><label><input type="checkbox" data-c="' + esc(c) + '"' + (Sched.isSel(S.p, c) ? ' checked' : '') + '>' +
          '<span class="ec">' + esc(c) + '</span>' + (graded ? '<span class="er ' + (r ? 'good' : 'again') + '">' + (r ? '○ できた' : '× まちがい') + '</span>' : '') + '</label></li>';
      }).join('') + '</ul>' +
      '<button class="big primary" id="menu">メニューへ</button></main>';
    app.querySelectorAll('.endlist input').forEach(function (cb) {
      cb.addEventListener('change', function () { Sched.setSel(S.p, cb.dataset.c, cb.checked, nowMs()); commit(); });
    });
    on('#menu', menu);
  }

  // ================= 先生用（設計書 §5・§13。担当学級だけ。子どもごとの記録は先生画面にだけ出す）
  var ALL_GRADES = [1, 2, 3, 4, 5, 6];
  // 学級キー「学年-組」を「3年1組」の形に
  function klassLabel(k) { var m = String(k).match(/^([1-6])-(.+)$/); return m ? m[1] + '年' + m[2] + (/組$/.test(m[2]) ? '' : '組') : String(k); }
  function dateLabel(ms) {
    if (!ms) return '—';
    var d = new Date(ms), days = Math.floor((Date.now() - ms) / 86400000);
    return (d.getMonth() + 1) + '/' + d.getDate() + (days <= 0 ? '（きょう）' : days <= 6 ? '（' + days + '日前）' : '');
  }
  // 先生画面のデータは学級ごとに1回の通信で読み、学年タブの切り替えでは読み直さない（reuse）。
  // 学級を変えた時・おためしから戻った時は読み直す
  function teacher(klass, tgrade, reuse) {
    clearScreen();
    klass = klass || S.klass || (S.info.classes || [])[0] || '';
    S.klass = klass;
    app.innerHTML = '<header class="top t">' + titleHtml('先生用') + '<p class="sub">' + esc(klassLabel(klass)) + (S.info.demo ? '（架空のデータ）' : '') + '</p>' +
      '<button class="try" id="show">書き順を 大きく見せる</button><button class="try" id="try">児童画面を ためす</button></header><main class="teacher"><p>よみこみ中…</p></main>';
    on('#try', function () { startTrial(klass); });
    on('#show', function () { showPick(); });
    if (!klass) {
      $('#try').hidden = true;
      $('.teacher').innerHTML = '<section><h2>担当の学級がありません</h2><p>スプレッドシートの「教師」シートに、あなたのメールアドレスと 学年・組 を入れてください（1人で何行でも。組を空けると その学年の全学級）。「書き順を 大きく見せる」は使えます。</p></section>';
      return;
    }
    var cached = reuse && S.view && S.view.klass === klass;
    (cached ? Promise.resolve(S.view) : Platform.teacherView(klass)).then(function (view) {
      view.klass = klass; view.pointers = view.pointers || {}; S.view = view;
      var kids = view.students || [], test = view.test || { label: '', chars: '' }, st = view.stats || { students: 0, perChar: {} };
      var grades = view.grades, pointers = view.pointers;
      tgrade = tgrade && grades.indexOf(tgrade) >= 0 ? tgrade : Math.max.apply(null, grades);
      (function () {
        var order = orderOf(tgrade), pointer = pointers[tgrade] || 0, isTop = tgrade === Math.max.apply(null, grades);
        var classes = (S.info.classes || []).length > 1 ? '<p><label>学級 <select id="klass">' + S.info.classes.map(function (k) { return '<option value="' + esc(k) + '"' + (k === klass ? ' selected' : '') + '>' + esc(klassLabel(k)) + '</option>'; }).join('') + '</select></label></p>' : '';
        var kidsHtml = '<section><h2>子どもごとの記録（' + kids.length + '人）</h2><p class="hint">この画面だけに出します（児童の画面には出しません）。「終えた回」は よむ・かく・カードを最後までやった回数、「おぼえた字」は よむで続けて正解して箱3以上になった字の数。</p>' +
          (kids.length ? '<div class="kids-wrap"><table class="kids"><thead><tr><th>番号</th><th>名前</th><th>最後に使った日</th><th>終えた回（問題数）</th><th>おぼえた字</th><th>まちがいの多い字</th></tr></thead><tbody>' +
            kids.map(function (k) {
              var idle = !k.last || (Date.now() - k.last) > 7 * 86400000;
              return '<tr' + (idle ? ' class="idle"' : '') + '><td>' + esc(k.no) + '</td><td>' + esc(k.name) + '</td><td>' + (idle ? '▲ ' : '') + esc(dateLabel(k.last)) + '</td>' +
                '<td>' + k.sessions + '（' + k.items + '）</td><td>' + k.learned + '</td><td class="kmiss">' + esc((k.miss || []).join(' ')) + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="hint">▲＝7日以上 使っていない</p>' : '<p>名簿に この学級の子どもが いません（「名簿」シートの 学年・組 を確認してください）。</p>') + '</section>';
        var hard = Object.keys(st.perChar).filter(function (c) { return D.kanji[c] && D.kanji[c].g === tgrade; })
          .map(function (c) { var v = st.perChar[c]; return { c: c, s: v[0], b: v[1], r: v[0] ? v[1] / v[0] : 0 }; })
          .filter(function (x) { return x.s >= 3 && x.b > 0; }).sort(function (a, b) { return b.r - a.r; }).slice(0, 20);
        var gradeTabs = grades.length > 1 ? '<nav class="tabs t" role="tablist">' + grades.map(function (g) { return '<button role="tab" class="ttab" data-g="' + g + '" aria-selected="' + (g === tgrade) + '">' + g + '年</button>'; }).join('') + '</nav>' : '';
        // 設定は開閉式（押すと開く）。見出しの右に いまの値を出すので、開かなくても状態がわかる。開いた・閉じたは画面を描き直しても保つ
        function fold(id, title, now, body) {
          return '<details class="tset" id="' + id + '"' + (S.open[id] ? ' open' : '') + '><summary><span class="ts-title">' + title + '</span><span class="ts-now" id="' + id + '-now">' + now + '</span></summary><div class="ts-body">' + body + '</div></details>';
        }
        function gradesNow(list) { return list.length > 1 && list[list.length - 1] - list[0] === list.length - 1 ? list[0] + '〜' + list[list.length - 1] + '年' : list.map(function (g) { return g + '年'; }).join('・'); }
        $('.teacher').innerHTML = classes +
          '<section class="tsets"><h2>設定</h2>' +
          fold('d-grades', '児童に見せる学年', esc(gradesNow(grades)),
            '<p class="hint">児童のメニューは、いちばん上の学年のタブで開きます。</p>' +
            '<div class="gchecks">' + ALL_GRADES.map(function (g) { return '<label class="opt"><input type="checkbox" data-g="' + g + '"' + (grades.indexOf(g) >= 0 ? ' checked' : '') + '> ' + g + '年</label>'; }).join('') + '</div>' +
            '<p class="hint" id="gmsg" aria-live="polite"></p>') +
          '</section><section class="tsets"><h2>' + tgrade + '年</h2>' + gradeTabs +
          fold('d-test', '次の漢字テストの範囲', '',
            '<p class="hint">字を押すと範囲に入る／外れる（押すたびに自動で保存）。上の学年タブを切り替えると、ほかの学年の字も足せます。児童の「読む・書く・カード」の はじめかたに「次の漢字テストの はんい」として出ます。</p>' +
            '<p><label>テストの名前 <input id="test-label" maxlength="40" value="' + esc(test.label || '') + '" placeholder="例: 9月の50問テスト"></label></p>' +
            '<p class="picked" id="test-picked"></p>' +
            '<div class="grid">' + Array.from(order).map(function (c) { return '<button class="tcell" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
            '<p><button id="test-clear">範囲を ぜんぶ はずす</button> <span id="test-msg" aria-live="polite"></span></p>') +
          fold('d-ptr', tgrade + '年の 授業の進度', isTop ? (pointer ? pointer + '字目まで' : '未設定（全部）') : '全部（下の学年）',
            '<p class="hint">' + (isTop
              ? '授業で習った最後の字を押すと、そこまでが「習った漢字」になります（「ならった漢字から ランダム」の出題範囲）。設定しないと ' + tgrade + '年の字は全部が対象です。いまは <b id="ptr">' + (pointer || '未設定') + '</b>' + (pointer ? ' 字目まで' : '') + '。'
              : tgrade + '年は下の学年なので、全部の字が「習った漢字」です。') + '</p>' +
            (isTop ? '<div class="grid">' + Array.from(order).map(function (c, i) { return '<button class="cell' + (i < pointer ? ' taught' : '') + '" data-i="' + i + '" aria-pressed="' + (i < pointer) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
              '<p><button id="unset">進度を 未設定にもどす</button></p>' : '')) +
          fold('d-order', tgrade + '年の 出題順', S.orders[tgrade] ? '設定済みの順' : '配当表の順（仮）',
            '<p class="hint">教科書の新出順を貼り付けます。' + tgrade + '年の' + D.grades[tgrade].order.length + '字を順番どおりに（区切りの空白・改行はあってもよい）。</p>' +
            '<textarea id="order" rows="5">' + esc(order) + '</textarea><p><button id="save-order">この順番にする</button> <span id="order-msg" aria-live="polite"></span></p>') +
          '<h3>学級でつまずいている字</h3><p class="hint">よむで答えたことのある児童のうち、最後の答えがまちがいだった児童の割合が高い字（' + st.students + '人中。児童名は出しません）。</p>' +
          (hard.length ? '<ol class="hard">' + hard.map(function (x) { return '<li><span class="hc">' + esc(x.c) + '</span>' + x.s + '人中 ' + x.b + '人（' + Math.round(x.r * 100) + '%）</li>'; }).join('') + '</ol>' : '<p>まだ データが ありません。</p>') +
          '</section>' + kidsHtml;
        app.querySelectorAll('details.tset').forEach(function (d) { d.addEventListener('toggle', function () { S.open[d.id] = d.open; }); });
        var sel = $('#klass'); if (sel) sel.addEventListener('change', function () { teacher(sel.value); });
        // 次の漢字テストの範囲: 押すたびに保存（自動保存）
        var tchars = Array.from(test.chars || '');
        function paintTest() {
          $('#d-test-now').textContent = tchars.length ? tchars.length + '字' + ($('#test-label').value.trim() ? '（' + $('#test-label').value.trim() + '）' : '') : 'なし';
          $('#test-picked').innerHTML = tchars.length ? '<b>' + tchars.length + '字</b> <span class="tlist">' + tchars.map(esc).join(' ') + '</span>' : '<span class="hint">まだ ありません</span>';
          app.querySelectorAll('.tcell').forEach(function (b) { var on = tchars.indexOf(b.dataset.c) >= 0; b.classList.toggle('tsel', on); b.setAttribute('aria-pressed', on); });
        }
        function saveTest() {
          var t = { label: $('#test-label').value.trim(), chars: tchars.join('') };
          view.test = t.chars ? t : null;
          Platform.setTest(klass, t).then(function () { $('#test-msg').textContent = '✓ 保存しました'; }, function () { $('#test-msg').textContent = '× 保存できませんでした'; });
        }
        app.querySelectorAll('.tcell').forEach(function (b) {
          b.addEventListener('click', function () {
            var i = tchars.indexOf(b.dataset.c);
            if (i >= 0) tchars.splice(i, 1); else tchars.push(b.dataset.c);
            paintTest(); saveTest();
          });
        });
        $('#test-label').addEventListener('change', function () { paintTest(); saveTest(); });
        on('#test-clear', function () { tchars = []; paintTest(); saveTest(); });
        paintTest();
        app.querySelectorAll('.gchecks input').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var list = Array.from(app.querySelectorAll('.gchecks input')).filter(function (x) { return x.checked; }).map(function (x) { return +x.dataset.g; });
            if (!list.length) { cb.checked = true; $('#gmsg').textContent = '× 1つ以上の学年を えらんでください'; return; }
            $('#gmsg').textContent = '保存中…';
            // 学年を変えたら、いちばん上の学年を開く
            Platform.setGrades(klass, list).then(function () { view.grades = list; teacher(klass, 0, true); }, function () { cb.checked = !cb.checked; $('#gmsg').textContent = '× 保存できませんでした'; });
          });
        });
        app.querySelectorAll('.ttab').forEach(function (b) { b.addEventListener('click', function () { teacher(klass, +b.dataset.g, true); }); });
        app.querySelectorAll('.cell').forEach(function (b) {
          b.addEventListener('click', function () {
            var n = +b.dataset.i + 1;
            if (n === pointer) n = +b.dataset.i; // 同じ字をもう一度押すと1つ戻す
            pointer = n;
            app.querySelectorAll('.cell').forEach(function (x, i) { x.classList.toggle('taught', i < n); x.setAttribute('aria-pressed', i < n); });
            $('#ptr').textContent = n || '未設定';
            $('#d-ptr-now').textContent = n ? n + '字目まで' : '未設定（全部）';
            pointers[tgrade] = n;
            Platform.setPointer(klass, tgrade, n).then(null, function () { $('#ptr').textContent = '× 保存できませんでした。もう一度 押してください'; });
          });
        });
        on('#unset', function () { Platform.setPointer(klass, tgrade, 0).then(function () { pointers[tgrade] = 0; teacher(klass, tgrade, true); }, function () { $('#ptr').textContent = '× 保存できませんでした'; }); });
        on('#save-order', function () {
          var v = $('#order').value.replace(/[\s,、，・]/g, ''), m = $('#order-msg'), base = D.grades[tgrade].order, arr = Array.from(v);
          var ok = arr.length === base.length && arr.every(function (c) { return base.indexOf(c) >= 0; }) && new Set(arr).size === base.length;
          if (!ok) { m.textContent = '× ' + tgrade + '年の' + base.length + '字がちょうど1回ずつ入っていません（' + arr.length + '字）'; return; }
          Platform.setOrder(tgrade, v).then(function () { S.orders[tgrade] = v; m.textContent = '✓ 保存しました'; $('#d-order-now').textContent = '設定済みの順'; }, function (e) { m.textContent = '× ' + (e && e.message || '保存できませんでした'); });
        });
      })();
    }).catch(function (e) { $('.teacher').innerHTML = '<p>よみこめませんでした: ' + esc(e && e.message || e) + '</p>'; });
  }

  // ================= 書き順の提示（先生がモニターに映す）
  // 1〜6字を選ぶ → 1字ずつ画面いっぱいに（右に音読み・左に訓読み）→ 最後にならべて書き順をくり返し再生
  var SHOW_MAX = 6;
  function showPick(picked, pg) {
    clearScreen();
    picked = picked || [];
    pg = pg || 3;
    app.innerHTML = '<header class="top t"><h1>書き順を 大きく見せる</h1><p class="sub">見せる字を 順に押す（1〜' + SHOW_MAX + '字）</p></header>' +
      '<main class="teacher"><p class="picked" id="picked"></p>' +
      '<p><label class="opt"><input type="checkbox" id="opt-base"' + (showOpts().base ? ' checked' : '') + '> 完成した字を うすく表示して、その上に書き順を黒で重ねる</label></p>' +
      '<p><button class="big primary" id="go" disabled>はじめる</button></p>' +
      '<nav class="tabs t" role="tablist">' + ALL_GRADES.map(function (g) { return '<button role="tab" class="ptab" data-g="' + g + '" aria-selected="' + (g === pg) + '">' + g + '年</button>'; }).join('') + '</nav>' +
      '<div class="grid">' + Array.from(orderOf(pg)).map(function (c) { return '<button class="cell" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
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
    app.querySelectorAll('.ptab').forEach(function (b) { b.addEventListener('click', function () { showPick(picked, +b.dataset.g); }); });
    $('#opt-base').addEventListener('change', function () { Platform.store.set(SHOW_OPTS_KEY, { base: this.checked }); });
    on('#go', function () { showStart(picked.slice(), function () { showPick(picked, pg); }); });
    on('#cancel', function () { teacher(S.klass); });
    paint();
  }

  function showStart(list, back) {
    var stage = document.createElement('div');
    stage.id = 'stage';
    document.body.appendChild(stage);
    // 全画面: 始める時に入り、Esc 等で抜けても、クリック・キー・右上のボタンでまた全画面に戻る
    function goFull() {
      if (document.fullscreenElement || !document.fullscreenEnabled) return;
      try { document.documentElement.requestFullscreen().catch(function () {}); } catch (e) {}
    }
    goFull();
    var idx = 0, stopAnim = null, base = showOpts().base;
    function stopLoop() { if (stopAnim) { stopAnim(); stopAnim = null; } }
    function single() {
      stopLoop();
      var c = list[idx], k = D.kanji[c], H = window.innerHeight, side = Math.max(120, (window.innerWidth - Math.min(H, window.innerWidth * 0.78)) / 2);
      stage.className = 'single';
      stage.innerHTML = '<div class="kun" aria-label="訓読み" style="font-size:' + readSize(k.kun, H, side) + '">' + readingHtml(k.kun, true) + '</div>' +
        '<div class="big-kanji">' + kanjiSvg(c, 'show-svg', base) + '</div>' +
        '<div class="on" aria-label="音読み" style="font-size:' + readSize(k.on, H, side) + '">' + readingHtml(k.on, false) + '</div>' +
        '<div class="stage-pos">' + (idx + 1) + ' / ' + list.length + '</div>';
      stopAnim = playLoop(Array.from(stage.querySelectorAll('.show-svg')));
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
        list.map(function (c) { return kanjiSvg(c, 'show-svg', base); }).join('') + '</div>';
      stopAnim = playLoop(Array.from(stage.querySelectorAll('.show-svg')));
    }
    function next() { if (idx < list.length - 1) { idx++; single(); } else if (idx === list.length - 1) { idx++; all(); } }
    function prev() { if (idx > 0) { idx = Math.min(idx, list.length) - 1; single(); } }
    function exit() {
      stopLoop();
      document.removeEventListener('keydown', key);
      document.removeEventListener('fullscreenchange', paintFull);
      full.remove(); x.remove();
      stage.remove();
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
      back();
    }
    function key(ev) {
      if (ev.key !== 'Escape') goFull();
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); prev(); }
      else if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); next(); }
      else if (ev.key === 'Escape') exit();
    }
    stage.addEventListener('click', function () { goFull(); next(); });
    document.addEventListener('keydown', key);
    // 全画面でない時だけ出すボタン。埋め込み（GAS）で全画面が許可されていない時は、全画面キーの案内にする
    var full = document.createElement('button');
    full.className = 'stage-full';
    full.textContent = document.fullscreenEnabled ? '⛶ 全画面' : '全画面キー（□）を押してね';
    full.addEventListener('click', function (ev) { ev.stopPropagation(); goFull(); });
    document.body.appendChild(full);
    function paintFull() { full.hidden = !!document.fullscreenElement; }
    document.addEventListener('fullscreenchange', paintFull);
    paintFull();
    var x = document.createElement('button');
    x.className = 'stage-exit'; x.textContent = '×'; x.setAttribute('aria-label', 'おわる');
    document.body.appendChild(x);
    x.addEventListener('click', exit);
    single();
  }

  // ================= 先生のおためし（児童画面を試す。記録はこの端末だけ、サーバーへは送らない）
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
      Platform.store.set('kanzi.prevAct.trial.' + S.info.email, 0);
      trialBar(); menu();
    });
    bar.querySelector('#tb-back').addEventListener('click', endTrial);
  }
  function startTrial(klass) {
    // 見せる学年・進度・テスト範囲は、先生画面で読んだ その学級のもの（読み直さない）
    var v = S.view && S.view.klass === klass ? Promise.resolve(S.view) : Platform.teacherView(klass);
    v.then(function (view) {
      S.trial = true;
      S.test = view.test || null;
      S.grades = view.grades.map(Number).sort(function (a, b) { return a - b; }); S.grade = maxGrade(); S.pointers = view.pointers || {};
      S.p = Platform.startTrial(S.info.email);
      S.dayOffset = 0;
      trialBar();
      menu();
    }, function (e) { alert('ひらけませんでした: ' + (e && e.message || e)); });
  }
  function endTrial() {
    S.trial = false; S.p = null; S.dayOffset = 0;
    Platform.endTrial();
    trialBar();
    teacher(S.klass);
  }

  // ================= 起動
  Platform.init().then(function (info) {
    S.info = info;
    S.orders = info.orders || {};
    S.pointers = info.pointers || {};
    S.test = info.test || null;
    S.grades = (info.grades && info.grades.length ? info.grades : [3]).map(Number).sort();
    S.grade = maxGrade();
    if (info.role === 'teacher') return teacher();
    if (info.role !== 'student') {
      app.innerHTML = '<main class="done"><p>このアカウントでは つかえません。学校のアカウントで ひらいてね。</p></main>';
      return;
    }
    S.p = Sched.norm(info.progress);
    menu();
  }).catch(function () {
    app.innerHTML = '<main class="done"><p>よみこめませんでした。</p><button class="big primary" onclick="location.reload()">もういちど ひらく</button></main>';
  });
})();

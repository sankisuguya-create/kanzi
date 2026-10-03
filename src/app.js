// 画面（設計書 §4・§5）。
// 児童: メニュー（学年タブ・木）→ 漢字を ぜんぶ見る（見る／選ぶ）／よむ／かく／カード／えらんだ漢字を見る
// 先生: 見せる学年・進度・つまずき集計、書き順の提示、児童画面のおためし
(function () {
  'use strict';
  var D = KANZI_DATA, ST = KANZI_STROKES;
  var app = document.getElementById('app');
  // 日本語の字形を使わせる（中国語フォント・中国語の字形を出さない）。GAS の埋め込みでも確実にするため JS でも付ける
  document.documentElement.lang = 'ja'; document.body.lang = 'ja';
  var S = { info: null, p: null, grades: [3], kana: [], grade: 3, pointers: {}, orders: {}, sinceFlush: 0, session: null, open: {}, gates: [] };
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
  // ひらがな・カタカナ（1年。先生が見せると決めた時だけタブに出る）。学年と同じ「タブ」として扱い、キーは h・k。
  // 漢字ではないので、できるのは「見る」と「書く」だけ。字の情報は D.kana にある（D.kanji と同じ形: n 画数・w 例語）
  var KANA_NAME = { h: 'ひらがな', k: 'カタカナ' };
  function isKana(g) { return g === 'h' || g === 'k'; }
  function gName(g) { return isKana(g) ? KANA_NAME[g] : g + '年'; }
  function info(c) { return D.kanji[c] || D.kana[c]; }
  function hira(str) { return String(str).replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); }); }
  // 見せる学年の設定（[1,2,'h','k'] のように かなも入る）を、漢字の学年と かなに分ける
  function applyGrades(list) {
    list = list || [];
    S.kana = ['h', 'k'].filter(function (x) { return list.indexOf(x) >= 0; });
    S.grades = list.map(Number).filter(function (g) { return g >= 1 && g <= 6; }).sort(function (a, b) { return a - b; });
    if (!S.grades.length) S.grades = [3];
    S.grade = maxGrade();
  }
  function tabKey(v) { return isKana(v) ? v : +v; }
  // 習った漢字: 下の学年は全部。いちばん上の学年は先生の進度まで（進度を設定していなければ全部）
  function learnedChars(g) {
    if (isKana(g)) return orderOf(g).split('');
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
  // 例語がない字（カタカナのヲ）は、その字だけを例語にする
  function wordFor(c, n) { var w = info(c).w; return w.length ? w[(n || 0) % w.length] : [c, hira(c), hira(c), 'kana']; }
  // 例語の学年より上の字にはルビ（w[4] = { 何字目: よみ }。交ぜ書きにしない）
  function rubyOf(w) { return w[4] && !Array.isArray(w[4]) ? w[4] : {}; }
  function withRuby(ch, rt) { return rt ? '<ruby>' + esc(ch) + '<rt>' + esc(rt) + '</rt></ruby>' : esc(ch); }
  function wordHtml(w, c) { var rb = rubyOf(w); return Array.from(w[0]).map(function (ch, i) { return '<span class="' + (ch === c ? 'tg' : 'ot') + '">' + withRuby(ch, rb[i]) + '</span>'; }).join(''); }

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

  // ================= 児童画面のボタンのオン・オフ（学級ごと。先生が おためし画面のチップで切り替える）
  // いま使わない活動を、先生の説明なしで児童が見分けられるようにする。キーは Sched.GATE_KEYS
  //   児童: オフのボタンは押せず、うすく見える（disabled。「選んだ漢字がない」時と同じ見た目）
  //   先生のおためし: ボタンの右上にチップを重ねる（ボタンの外にも中の文字にも場所を取らないので、並びは児童画面と同じ）
  var GATE_LABEL = { 'm.browse': 'ぜんぶ見る', 'm.read': '読む', 'm.write': '書く', 'm.fk': 'カード（漢字→読み）', 'm.fy': 'カード（読み→漢字）',
    'm.test': 'テストの範囲を見る', 'm.seen': '選んだ漢字を見る', 's.test': '出す字: テストの範囲', 's.due': '出す字: おすすめ',
    's.sel': '出す字: 選んだ漢字', 's.rnd': '出す字: ランダム', 's.miss': '出す字: まちがいの多い漢字' };
  var GATE_POLL_MS = 30000;
  function gateOff(k) { return S.gates.indexOf(k) >= 0; }
  function paintGates() {
    app.querySelectorAll('[data-gate]').forEach(function (b) {
      if (b.dataset.base === undefined) b.dataset.base = b.disabled ? '1' : ''; // 中身がなくて押せないボタン（えらんだ字が0など）
      var off = gateOff(b.dataset.gate), base = b.dataset.base === '1';
      b.classList.toggle('gated', off);
      if (!S.trial) { b.disabled = base || off; return; }
      // おためし: disabled にするとチップも押せなくなるので使わない。うすい見た目は .dim、押した時の動きは gateClick で止める
      b.disabled = false;
      b.classList.toggle('dim', base || off);
      if (base || off) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      var chip = b.querySelector('.gate-chip');
      if (!chip) { chip = document.createElement('span'); chip.className = 'gate-chip'; chip.setAttribute('role', 'switch'); chip.tabIndex = 0; b.appendChild(chip); }
      chip.setAttribute('aria-checked', String(!off));
      chip.setAttribute('aria-label', GATE_LABEL[b.dataset.gate] + 'を 児童に使わせる');
      chip.textContent = off ? '✕' : '✓';
      chip.title = off ? 'オフ（児童は押せない）。押すと オン' : 'オン（児童が使える）。押すと オフ';
    });
  }
  // おためしのチップ: 押すと切り替える。うすいボタン（オフ・中身なし）の本体を押しても何もしない
  function gateClick(ev) {
    if (!S.trial || !ev.target.closest) return;
    var b = ev.target.closest('[data-gate]');
    if (!b) return;
    if (ev.target.closest('.gate-chip')) { ev.stopPropagation(); ev.preventDefault(); toggleGate(b.dataset.gate); }
    else if (b.classList.contains('dim')) { ev.stopPropagation(); ev.preventDefault(); }
  }
  app.addEventListener('click', gateClick, true); // ボタン自身の動きより先に受ける
  app.addEventListener('keydown', function (ev) {
    if (S.trial && ev.target.classList && ev.target.classList.contains('gate-chip') && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault(); ev.stopPropagation(); toggleGate(ev.target.closest('[data-gate]').dataset.gate);
    }
  }, true);
  // 保存は1つずつ順に送る（続けて押した時に古い一覧が後から届いて上書きしないように）。
  // 送っている間に押された分は、終わってから最新の一覧を1回だけ送る。失敗したら最後に保存できた状態に戻す
  var gateSaving = false, gateDirty = false;
  function toggleGate(k) {
    S.gates = Sched.normGates(gateOff(k) ? S.gates.filter(function (x) { return x !== k; }) : S.gates.concat([k]));
    paintGates();
    saveGates();
  }
  function saveGates() {
    if (gateSaving) { gateDirty = true; return; }
    gateSaving = true; gateMsg('保存中…');
    Platform.setGates(S.klass, S.gates).then(function (v) {
      gateSaving = false;
      S.gatesSaved = v;
      if (S.view && S.view.klass === S.klass) S.view.gates = v;
      if (gateDirty) { gateDirty = false; return saveGates(); }
      S.gates = v; paintGates();
      gateMsg('✓ 保存（30秒ほどで 児童に とどく）');
    }, function () {
      gateSaving = false; gateDirty = false;
      S.gates = (S.gatesSaved || []).slice(); paintGates();
      gateMsg('× 保存できませんでした。もう一度 押してください');
    });
  }
  function gateMsg(t) { var m = document.getElementById('tb-msg'); if (m) m.textContent = t; }
  // 児童: メニュー・「どの字で やる？」を出すたびと、開いている間 30秒ごとに読み直す（授業中の切り替えを、開いたままの画面に届ける）
  var gateFetchedAt = 0;
  function watchGates() {
    paintGates();
    if (S.trial || !S.p) return;
    function fetch(force) {
      if (!force && Date.now() - gateFetchedAt < 5000) return; // メニューと選ぶ画面を行き来しても続けて読まない
      gateFetchedAt = Date.now();
      Platform.gates().then(function (v) { if (!S.trial && v.join() !== S.gates.join()) { S.gates = v; paintGates(); } }, function () {}); // 通信できなければ今のまま
    }
    fetch(false);
    var timer = setInterval(function () { if (document.visibilityState === 'visible') fetch(true); }, GATE_POLL_MS);
    function vis() { if (document.visibilityState === 'visible') fetch(false); }
    document.addEventListener('visibilitychange', vis);
    cleanup.push(function () { clearInterval(timer); document.removeEventListener('visibilitychange', vis); });
  }

  // ================= 児童: メニュー
  function tabs(cur, cls) {
    var list = S.kana.concat(S.grades);
    if (list.length < 2) return '';
    return '<nav class="tabs ' + (cls || '') + '" role="tablist">' + list.map(function (g) {
      return '<button role="tab" class="tab' + (isKana(g) ? ' kana' : '') + '" data-g="' + g + '" aria-selected="' + (g === cur) + '">' + gName(g) + '</button>';
    }).join('') + '</nav>';
  }
  function bindTabs(fn) { app.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { fn(tabKey(b.dataset.g)); }); }); }

  function menu() {
    clearScreen();
    var p = S.p, g = S.grade;
    // 森の成長は mount にも使うので1回だけ計算する（記録が増えるほど重いので）
    var growth = Sched.forestGrowth(p), act = growth.completed.length * Sched.FOREST_CAP + growth.log.length + growth.fraction;
    var pk = 'kanzi.prevGrowth.' + (S.trial ? 'trial.' : '') + S.info.email, prev = Platform.store.get(pk);
    Platform.store.set(pk, act);
    var nSel = Sched.selected(p, orderOf(g)).length;
    var kana = isKana(g), noun = kana ? KANA_NAME[g] : K('[漢|かん][字|じ]');
    app.innerHTML =
      '<header class="top">' + titleHtml() + tabs(g) + '</header>' +
      '<main class="menu">' +
      '<section class="tree-box"><div id="forest"></div></section>' +
      '<section class="actions">' +
      (kana
        ? '<button class="big" id="go-browse" data-gate="m.browse">' + noun + K('を ぜんぶ[見|み]る<span class="meta">') + orderOf(g).length + K('[字|じ]・[見|み]る／[選|えら]ぶ</span></button>') +
          '<button class="big primary" id="go-write" data-gate="m.write">' + K('[書|か]く<span class="meta">') + (g === 'h' ? K('[聞|き]いて ひらがなを [書|か]く') : K('ひらがな → カタカナを [書|か]く')) + '</span></button>'
        : '<button class="big" id="go-browse" data-gate="m.browse">' + g + K('年の[漢|かん][字|じ]を ぜんぶ[見|み]る<span class="meta">') + orderOf(g).length + K('[字|じ]・[見|み]る／[選|えら]ぶ</span></button>') +
          K('<div class="two"><button class="big primary" id="go-read" data-gate="m.read">[読|よ]む<span class="meta">[漢|かん][字|じ] → [読|よ]みを [書|か]く</span></button>') +
          K('<button class="big primary" id="go-write" data-gate="m.write">[書|か]く<span class="meta">[読|よ]み → [漢|かん][字|じ]を [書|か]く</span></button></div>') +
          K('<div class="two"><button class="big" id="go-fk" data-gate="m.fk">カード<span class="meta">[漢|かん][字|じ] → [読|よ]み</span></button>') +
          K('<button class="big" id="go-fy" data-gate="m.fy">カード<span class="meta">[読|よ]み → [漢|かん][字|じ]</span></button></div>') +
          (testChars().length ? '<button class="big test" id="go-test" data-gate="m.test">' + K('[次|つぎ]の[漢|かん][字|じ]テストの はんいを [見|み]る') + '<span class="meta">' + (S.test.label ? esc(S.test.label) + '・' : '') + testChars().length + K('[字|じ]') + '</span></button>' : '')) +
      '<button class="big" id="go-seen" data-gate="m.seen"' + (nSel ? '' : ' disabled') + '>' + K('[選|えら]んだ') + noun + K('を[見|み]る') + '<span class="meta">' + (nSel ? nSel + K('[字|じ]') : K('まだ [選|えら]んでいないよ')) + '</span></button>' +
      '</section></main>' + (S.info.demo && !S.trial ? '<p class="demo-note">デモ（この端末にだけ保存）</p>' : '');
    // メニューは画面の高さに収める（スクロールしない）。ほかの画面に移る時に外す
    document.body.classList.add('menu-screen');
    cleanup.push(function () { document.body.classList.remove('menu-screen'); });
    var forestView = Tree.mount($('#forest'), { progress: p, prevActivity: prev, growth: growth });
    S.treeView = forestView;
    cleanup.push(function () { forestView.destroy(); });
    bindTabs(function (ng) { S.grade = ng; menu(); });
    on('#go-browse', function () { browse('look'); });
    on('#go-read', function () { chooser('read'); });
    on('#go-write', function () { chooser('write'); });
    on('#go-fk', function () { chooser('fk'); });
    on('#go-fy', function () { chooser('fy'); });
    on('#go-test', testOverview);
    on('#go-seen', function () { var l = Sched.selected(S.p, orderOf(S.grade)); if (l.length) viewChars(l, 0, menu); });
    watchGates();
  }

  // テスト範囲は全字を先生の指定順で一覧。練習の30問上限・学年タブでは切り詰めない。
  function testOverview(focusChar, scroll) {
    clearScreen();
    var chars = testChars(), miss = {};
    chars.forEach(function (c) { // 自分が まちがいの おおい字（よむ・かくの まちがいが あわせて2回以上）→ あかい わく
      var n = (S.p.read[c] ? S.p.read[c][4] || 0 : 0) + (S.p.write[c] ? S.p.write[c][4] || 0 : 0);
      if (n >= 2) miss[c] = true;
    });
    app.innerHTML = '<header class="bar"><button class="back" id="back">もどる</button>' +
      '<span class="prog">' + K('[次|つぎ]の[漢|かん][字|じ]テストの はんい') + '</span><span></span></header>' +
      '<main class="test-overview"><h2>' + esc(S.test && S.test.label || K('[漢|かん][字|じ]テスト')) +
      ' <span class="test-count">' + chars.length + K('[字|じ]') + '</span></h2>' +
      '<p class="browse-hint">' + (chars.length ? K('[字|じ]を おすと、[読|よ]みと [書|か]き[順|じゅん]が [見|み]られるよ') + (Object.keys(miss).length ? K('。<span class="miss-mark">あかい わく</span>は まちがいが おおい字 だよ') : '') : 'まだ はんいが きまっていないよ') + '</p>' +
      '<div class="kgrid" id="test-grid">' + chars.map(function (c) {
        return '<button class="kc' + (miss[c] ? ' kmiss' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('') + '</div></main>';
    on('#back', menu);
    app.querySelectorAll('#test-grid .kc').forEach(function (b, i) {
      if (b.dataset.c === focusChar) b.focus({ preventScroll: true });
      b.addEventListener('click', function () {
        var y = window.scrollY;
        viewChars(chars, i, function () { testOverview(b.dataset.c, y); });
      });
    });
    window.scrollTo(0, scroll || 0);
  }

  // ================= 児童: 漢字を ぜんぶ見る（見る／えらぶ）
  function browse(mode) {
    clearScreen();
    var g = S.grade, order = orderOf(g).split('');
    app.innerHTML =
      '<header class="bar"><button class="back" id="back">もどる</button><span class="prog">' + (isKana(g) ? KANA_NAME[g] + '（' : g + K('年の[漢|かん][字|じ]（')) + order.length + K('[字|じ]）') + '</span><span></span></header>' +
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
  function showOpts() { var o = Platform.store.get(SHOW_OPTS_KEY) || {}; return { base: o.base !== false, color: !!o.color }; }
  function setShowOpt(k, v) { var o = showOpts(); o[k] = v; Platform.store.set(SHOW_OPTS_KEY, o); }
  // 一〜四画目の色分け（先生の提示）。何画目かは書き順の再生（描く順番）でも分かるので、色だけに頼らない。
  // 色は線用の4色（青・橙・茶・緑）。黒（5画目から）・うすい下地・白地と、どの色覚の型でも見分けられることを検査済み（docs/design.md §17）
  var COLOR_STROKES = 4;
  // color: 一〜四画目を色分けする（先生の提示だけ）
  function kanjiSvg(c, cls, base, color) {
    // 十字の点線（字全体のバランスの目安）。線は <line> にして、書き順アニメ（path が対象）に巻き込まない
    return '<svg viewBox="0 0 109 109" class="' + cls + (color ? ' colored' : '') + '"><rect class="frame" x="0.8" y="0.8" width="107.4" height="107.4"/><line class="cross" x1="54.5" y1="1" x2="54.5" y2="108"/><line class="cross" x1="1" y1="54.5" x2="108" y2="54.5"/>' +
      (base ? '<g class="base">' + ST[c].map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g>' : '') +
      '<g class="ink">' + ST[c].map(function (d, i) { return '<path' + (color && i < COLOR_STROKES ? ' class="s' + (i + 1) + '"' : '') + ' d="' + d + '"/>'; }).join('') + '</g>' +
      '</svg>';
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
    var k = info(c);
    return '<div class="kun" aria-label="訓読み" style="font-size:' + readSize(k.kun, H, side) + '">' + readingHtml(k.kun, true) + '</div>' +
      '<div class="mon-kanji" style="width:' + H + 'px;height:' + H + 'px">' + kanjiSvg(c, 'show-svg', true) + '</div>' +
      '<div class="on" aria-label="音読み" style="font-size:' + readSize(k.on, H, side) + '">' + readingHtml(k.on, false) + '</div>';
  }

  // 1字ずつ見る（右に字、左にその字を使ったことば）。←→ で前後、「えらぶ」で問題に出す字にできる
  function viewChars(list, idx, back) {
    clearScreen();
    var c = list[idx], k = info(c);
    var H = Math.floor(Math.min(window.innerHeight * 0.66, window.innerWidth * 0.36)), side = Math.floor(H * 0.3);
    var words = k.w.map(function (w, i) {
      return '<li><span class="vw">' + wordHtml(w, c) + '</span><span class="vk">' + esc(w[1]) + '</span>' +
        (canSpeak ? '<button class="say" data-i="' + i + '" aria-label="きく">🔊</button>' : '') + '</li>';
    }).join('');
    app.innerHTML =
      '<header class="bar"><button class="back" id="back">もどる</button><span class="prog">' + (idx + 1) + ' / ' + list.length + '</span>' +
      '<span class="nav"><button id="prev"' + (idx ? '' : ' disabled') + '>← ' + K('[前|まえ]') + '</button><button id="next"' + (idx < list.length - 1 ? '' : ' disabled') + '>' + K('[次|つぎ]') + ' →</button></span></header>' +
      '<main class="view"><section class="vwords"><h2>' + esc(c) + K(' を [使|つか]う [言|こと][葉|ば]</h2>') + '<ul>' + words + '</ul>' +
      '<p class="vmeta">' + k.n + K('[画|かく]・') + (k.g ? k.g + '年' : KANA_NAME[k.s]) + '</p>' +
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
  // 学級の集計から まちがいのおおい字（先生のおためし用。3人以上が答え、最後の答えがまちがいの人がいる字を割合の高い順）
  function classMissList(order) {
    var perChar = (S.view && S.view.stats && S.view.stats.perChar) || {}, out = [];
    for (var i = 0; i < order.length; i++) {
      var c = order.charAt(i), v = perChar[c];
      if (v && v[0] >= 3 && v[1] > 0) out.push({ c: c, r: v[1] / v[0], m: v[1] });
    }
    out.sort(function (a, b) { return (b.r - a.r) || (b.m - a.m); });
    return out.map(function (x) { return x.c; });
  }
  function sources(kind) {
    var g = S.grade, order = orderOf(g), n = SIZE[kind], tbl = kind === 'write' ? 'write' : 'read';
    var due = Sched.dueList(S.p, today(), order)[tbl];
    var kana = isKana(g), noun = kana ? KANA_NAME[g] : '[漢|かん][字|じ]';
    var test = kana ? [] : testChars(); // テストの範囲は漢字。かなのタブでは出さない
    return (test.length ? [{ id: 'test', label: '[次|つぎ]の[漢|かん][字|じ]テストの はんい', sub: S.test.label ? esc(S.test.label) : '', list: shuffle(test.slice()).slice(0, SEL_MAX) }] : []).concat([
      { id: 'due', label: 'おすすめ', sub: '[忘|わす]れそうな[字|じ]', list: due.slice(0, n) },
      { id: 'sel', label: '[選|えら]んだ' + noun, sub: '[自|じ][分|ぶん]で [選|えら]んだ[字|じ]', list: Sched.selected(S.p, order).slice(0, SEL_MAX) },
      { id: 'rnd', label: kana ? noun + 'から ランダム' : '[習|なら]った[漢|かん][字|じ]から ランダム', sub: '', list: shuffle(learnedChars(g).slice()).slice(0, n) },
      { id: 'miss', label: 'まちがいの [多|おお]い' + noun, sub: S.trial ? '[学|がく][級|きゅう]で おおい' : '', list: (S.trial ? classMissList(order) : Sched.missList(S.p, tbl, order)).slice(0, n) }
    ]);
  }
  function chooser(kind) {
    clearScreen();
    var src = sources(kind);
    // 横長の画面ではスクロールせずに全部の選択肢が見える（メニューと同じ仕組み）
    document.body.classList.add('chooser-screen');
    cleanup.push(function () { document.body.classList.remove('chooser-screen'); });
    app.innerHTML =
      '<header class="bar"><button class="back" id="back">もどる</button><span class="prog">' + K(KIND_NAME[kind]) + '・' + gName(S.grade) + '</span><span></span></header>' +
      K('<main class="chooser"><h2>どの[字|じ]で やる？</h2>') + src.map(function (s) {
        return '<button class="big' + (s.list.length ? '' : ' empty') + '" data-id="' + s.id + '" data-gate="s.' + s.id + '"' + (s.list.length ? '' : ' disabled') + '>' + K(s.label) +
          '<span class="meta">' + (s.list.length ? s.list.length + K('[問|もん]') + (s.sub ? '・' + K(s.sub) : '') : K('[今|いま]は ないよ')) + '</span></button>';
      }).join('') + '</main>';
    on('#back', menu);
    app.querySelectorAll('.chooser .big').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = src.filter(function (x) { return x.id === b.dataset.id; })[0];
        startSession(kind, s.list.slice());
      });
    });
    watchGates();
  }
  function startSession(kind, list) {
    S.session = { kind: kind, items: list, i: 0, results: {}, skipped: {}, startedAt: nowMs() }; // skipped: 「わからない」で答えを見た字（木には数えない）
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
    // 答えが一つに決まるように問う（例語は2字以上。data-src の書式を参照）:
    //   漢字だけの語（空港）は語全体の読み。かなを含む語は その字の読みだけ（港に船が入る → みなと）。
    //   その字＋送り仮名だけの語（悪い・始める）は、送り仮名を入力欄の後ろに出す（送り仮名まで書いても正解）
    var kanjiOnly = /^[\u4e00-\u9fff々]+$/.test(w[0]);
    var okuri = kanjiOnly ? '' : (w[0].slice(w[0].indexOf(c) + 1).match(/^[ぁ-ゖ]+/) || [''])[0];
    var inflect = !kanjiOnly && w[0] === c + okuri, part = !kanjiOnly && !inflect;
    var answers = kanjiOnly ? [w[1]] : [w[2], w[2] + okuri];
    var shown = kanjiOnly ? w[1] : w[2];
    if (!inflect) okuri = '';
    app.innerHTML = bar() +
      '<main class="read">' +
      '<div class="card' + (part ? ' part' : '') + '" id="card"><span class="kana" id="kana">' + esc(w[1]) + '</span><span class="word">' + wordHtml(w, c) + '</span></div>' +
      '<form class="answer" id="form" autocomplete="off"><label class="q" for="yomi">' + (part ? K('[線|せん]を[引|ひ]いた[字|じ]の [読|よ]みだけを ひらがなで [書|か]こう') : K('[読|よ]みを ひらがなで [書|か]こう') + (okuri ? K('（[送|おく]りがなは [書|か]かない）') : '')) + '</label>' +
      '<div class="answer-row"><input id="yomi" lang="ja" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">' +
      (okuri ? '<span class="okuri-after" aria-label="おくりがな">' + esc(okuri) + '</span>' : '') +
      K('<button class="btn-ok" id="ok" type="submit">[答|こた]える</button></div></form>') +
      '<p class="rmsg" id="rmsg" aria-live="polite"></p>' +
      '<div class="after" id="after"><button class="btn-mada" id="idk" type="button">' + K('わからない（[答|こた]えを [見|み]る）') + '</button></div>' +
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
    on('#idk', function () { if (!done) { S.session.skipped[c] = true; finish(false, false); } });
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
  // ひらがな: ことばの その字を□にして、ことばを読み上げる（□の上に読みは出さない。読み＝答えになるため）。
  // カタカナ: □の上に その字の ひらがなを出す（例: □イス の□の上に「あ」）
  function writeCard(c) {
    var e = S.p.write[c], w = wordFor(c, e && e[2]), hiraQ = !!(D.kana[c] && D.kana[c].s === 'h'), listen = hiraQ && canSpeak;
    var rb = rubyOf(w);
    var prompt = Array.from(w[0]).map(function (ch, i) {
      return ch === c ? '<span class="blank"><ruby><span class="box">　</span><rt>' + (listen ? '' : esc(w[2])) + '</rt></ruby></span>' : '<span class="ot">' + withRuby(ch, rb[i]) + '</span>';
    }).join('');
    app.innerHTML = bar() +
      '<main class="write">' +
      '<div class="wl"><p class="prompt">' + prompt + '</p>' +
      (listen ? '<p class="prompt-kana"><button class="speak" id="say" type="button">🔊 ' + K('[聞|き]く') + '</button></p>' : '<p class="prompt-kana">' + esc(w[1]) + '</p>') +
      K('<p class="msg" id="msg" aria-live="polite">□の [字|じ]を [書|か]こう</p>') +
      K('<div class="tools"><button id="redo">[書|か]きなおす</button><button class="btn-mada" id="skip">わからない（[書|か]き[順|じゅん]を [見|み]る）</button></div></div>') +
      '<div class="padbox" id="pad"></div></main>';
    on('#back', quit);
    if (listen) { speak(w[1]); on('#say', function () { speak(w[1]); }); }
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
      strokes: ST[c], mode: 'free', level: S.writeLevel === 'easy' ? 'easy' : 'normal', // 判定の強さは先生が学級ごとに選ぶ
      onMiss: function (kind) { say(kind === 'reverse' ? K('[書|か]く [向|む]きが ちがうよ。もう[一|いち][度|ど]') : K('もう[一|いち][度|ど] [書|か]いてみよう')); },
      onStroke: function () { say(''); },
      // ぐちゃぐちゃ書き込みは「わからない」を押したのと同じ: すぐ答えを見せる（森には数えない）
      onStuck: function (res) { if (res && res.scribble) S.session.skipped[c] = true; showAnswer(); },
      onDone: function (res) {
        var ok = !res.assisted;
        record(ok);
        var after = res.orderMiss > 0 ? (say(K('[字|じ]は できたよ。[書|か]き[順|じゅん]を [見|み]てみよう')), pad.demo(0.8)) : Promise.resolve();
        after.then(function () { result(ok, res.orderMiss > 0); });
      }
    });
    // まちがいが続いた時・「わからない」を押した時: 正しい書き順を見せて「まちがい」で次へ
    function showAnswer() {
      if (finished) return;
      record(false);
      pad.stuck = true;
      $('.tools').hidden = true;
      say(K('[正|ただ]しい [書|か]き[順|じゅん]を [見|み]よう'));
      pad.demo(0.8).then(function () { pad.mode = 'show'; pad.tplPaths.forEach(function (p) { p.setAttribute('class', 'g-demo'); }); result(false, false); });
    }
    on('#redo', function () { if (!finished) { pad.reset(); say(K('□の [字|じ]を [書|か]こう')); } });
    on('#skip', function () { if (!finished) { S.session.skipped[c] = true; showAnswer(); } });
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

  // 最後まで終えた時: 学習を記録（読む・書くなら木も育つ）し、出た字の一覧とチェックを出す
  function sessionDone() {
    var s = S.session, graded = s.kind === 'read' || s.kind === 'write';
    // 読む・書くの「わからない」以外の問題数が成長対象。カードは集計だけ残す。
    var nSkip = s.items.filter(function (c) { return s.skipped[c]; }).length;
    Sched.finishSession(S.p, s.startedAt, s.items.length - nSkip, s.kind);
    Platform.save(S.p);
    flush();
    app.innerHTML =
      '<main class="done wide"><p class="done-big">おわり！ ' + s.items.length + K('[問|もん] やったよ</p>') +
      (nSkip ? '<p class="hint">' + K('「わからない」の ') + nSkip + K('[問|もん]は、[木|き]には [入|はい]らないよ') + '</p>' : '') +
      K('<p class="hint">チェックを はずすと、[選|えら]んだ[漢|かん][字|じ]から はずれるよ</p>') +
      '<ul class="endlist">' + s.items.map(function (c) {
        var r = s.results[c];
        return '<li><label><input type="checkbox" data-c="' + esc(c) + '"' + (Sched.isSel(S.p, c) ? ' checked' : '') + '>' +
          '<span class="ec">' + esc(c) + '</span>' + (graded ? '<span class="er ' + (r ? 'good' : 'again') + '">' + (r ? '○ できた' : s.skipped[c] ? K('？ わからない') : '× まちがい') + '</span>' : '') + '</label></li>';
      }).join('') + '</ul>' +
      '<button class="big primary" id="menu">メニューへ</button></main>';
    app.querySelectorAll('.endlist input').forEach(function (cb) {
      cb.addEventListener('change', function () { Sched.setSel(S.p, cb.dataset.c, cb.checked, nowMs()); commit(); });
    });
    on('#menu', menu);
  }

  // ================= 先生用（設計書 §5・§13。担当学級だけ。子どもごとの記録は先生画面にだけ出す）
  var ALL_GRADES = [1, 2, 3, 4, 5, 6];
  var ALL_TABS = ['h', 'k', 1, 2, 3, 4, 5, 6]; // 見せる学年の選択肢（ひらがな・カタカナ・1〜6年）
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
      view.gates = Sched.normGates(view.gates);
      var kids = view.students || [], tests = Sched.normTests(view.tests !== undefined ? view.tests : view.test), st = view.stats || { students: 0, perChar: {} };
      // view.grades は見せるタブ全部（かなを含む）。学年タブ・進度・出題順は漢字の学年だけ
      var shown = view.grades, grades = shown.filter(function (g) { return !isKana(g); }).map(Number), pointers = view.pointers;
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
        function gatesNow(list) { return list.length ? 'オフ: ' + list.map(function (k) { return GATE_LABEL[k]; }).join('・') : 'ぜんぶ オン'; }
        function gradesNow(list) {
          var gs = list.filter(function (g) { return !isKana(g); }).map(Number), ks = list.filter(isKana).map(function (g) { return KANA_NAME[g]; });
          var gl = gs.length > 1 && gs[gs.length - 1] - gs[0] === gs.length - 1 ? gs[0] + '〜' + gs[gs.length - 1] + '年' : gs.map(function (g) { return g + '年'; }).join('・');
          return ks.concat([gl]).join('・');
        }
        // いまの進捗（子どもごとの記録）をいちばん上に。設定はその下
        $('.teacher').innerHTML = classes + kidsHtml +
          '<section class="tsets"><h2>設定</h2>' +
          fold('d-grades', '児童に見せる学年', esc(gradesNow(shown)),
            '<p class="hint">児童のメニューは、いちばん上の学年のタブで開きます。ひらがな・カタカナは「見る」と「書く」だけです（1年向け）。</p>' +
            '<div class="gchecks">' + ALL_TABS.map(function (g) { return '<label class="opt"><input type="checkbox" data-g="' + g + '"' + (shown.map(String).indexOf(String(g)) >= 0 ? ' checked' : '') + '> ' + gName(g) + '</label>'; }).join('') + '</div>' +
            '<p class="hint" id="gmsg" aria-live="polite"></p>') +
          fold('d-write', '書く問題の判定', view.writeLevel === 'easy' ? 'やさしい' : 'ふつう',
            '<p class="hint">児童の「書く」で、字の形をどこまで正解にするか（この学級の全員。書き順は どちらでも見ます）。</p>' +
            '<div class="wlevel">' + [['', 'ふつう', '字の形・位置のずれが小さい時だけ正解。2回続けてまちがえると正しい書き順を見せる'],
              ['easy', 'やさしい', 'ずれが大きくても正解にしやすい。3回続けてまちがえるまで待つ（形のちがう字を正解にすることも少し増える）']].map(function (o) {
              return '<label class="opt"><input type="radio" name="wlevel" value="' + o[0] + '"' + ((view.writeLevel || '') === o[0] ? ' checked' : '') + '> <b>' + o[1] + '</b> <span class="hint">' + o[2] + '</span></label>';
            }).join('') + '</div><p class="hint" id="wmsg" aria-live="polite"></p>') +
          fold('d-gates', '児童画面のボタン', esc(gatesNow(view.gates)),
            '<p class="hint">「児童画面を ためす」で、ボタンの右上の <b>✓</b>（児童が使える）／<b>✕</b>（使えない）を押して切り替えます（押すたびに自動で保存）。オフのボタンは、この学級の児童の画面で うすくなり、押せなくなります。開いたままの児童の画面にも 30秒ほどで とどきます。メニューのボタンと、読む・書く・カードの「どの字で やる？」の選び方を切り替えられます。</p>' +
            '<p><button id="gate-try">児童画面を ためして 切り替える</button>' + (view.gates.length ? ' <button id="gate-reset">ぜんぶ オンにもどす</button>' : '') + ' <span id="gate-msg" aria-live="polite"></span></p>') +
          '</section><section class="tsets"><h2>' + tgrade + '年</h2>' + gradeTabs +
          fold('d-test', '漢字テストの範囲', '',
            '<p class="hint">テストごとに 範囲を 作り、児童に見せるテストを 1つ えらびます（押すたびに自動で保存）。上の学年タブを切り替えると、ほかの学年の字も足せます。見せているテストは、児童の「読む・書く・カード」の はじめかたと メニューに出ます。</p>' +
            '<div id="test-mgr"></div>' +
            '<div id="test-editor">' +
            '<p><label>テストの名前 <input id="test-label" maxlength="40" placeholder="例: 9月の50問テスト"></label></p>' +
            '<p class="picked" id="test-picked"></p>' +
            '<div class="grid">' + Array.from(order).map(function (c) { return '<button class="tcell" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
            '<p class="hint">あかい わくは、学級で まちがいの おおい字です（よむで3人以上が答え、まちがいが3割以上）</p>' +
            '<p><button id="test-clear">このテストの範囲を ぜんぶ はずす</button> <span id="test-msg" aria-live="polite"></span></p></div>') +
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
          '</section>';
        app.querySelectorAll('details.tset').forEach(function (d) { d.addEventListener('toggle', function () { S.open[d.id] = d.open; }); });
        var sel = $('#klass'); if (sel) sel.addEventListener('change', function () { teacher(sel.value); });
        // 漢字テストの範囲: テストごとに管理。編集・見せる切替とも押すたびに保存（自動保存）
        // 学級で まちがいの おおい字（よむ: 3人以上が答え、最後の答えがまちがいの人が3割以上）→ あかい わく
        var fails = {};
        Object.keys(st.perChar).forEach(function (c) { var v = st.perChar[c]; if (v[0] >= 3 && v[1] * 10 >= v[0] * 3) fails[c] = true; });
        var testCur = (S.testCur && tests.list.some(function (t) { return t.id === S.testCur; }) ? S.testCur : null) || tests.active || (tests.list[0] && tests.list[0].id) || null;
        function curTest() { return tests.list.filter(function (t) { return t.id === testCur; })[0] || null; }
        function paintTest() {
          var cur = curTest(), tchars = cur ? Array.from(cur.chars) : [];
          var at = tests.list.filter(function (t) { return t.id === tests.active; })[0];
          $('#d-test-now').textContent = tests.list.length
            ? tests.list.length + 'テスト・' + (at ? '見せている: ' + (at.label || 'なまえなし') + ' ' + Array.from(at.chars).length + '字' : '見せていない')
            : 'なし';
          $('#test-mgr').innerHTML =
            '<p class="tmgr"><label>テスト <select id="test-sel">' +
              tests.list.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === testCur ? ' selected' : '') + '>' + esc(t.label || 'なまえなし'); }).join('') + '</select></label>' +
              ' <button id="test-new" type="button">＋ 新しいテスト</button>' +
              (cur ? ' <button id="test-del" type="button">このテストを 消す</button>' : '') + '</p>' +
            (cur ? '<p><label class="opt"><input type="checkbox" id="test-show"' + (tests.active === testCur ? ' checked' : '') + '> このテストを 児童に見せる</label></p>' : '<p class="hint">「＋ 新しいテスト」で作ります。</p>');
          $('#test-editor').hidden = !cur;
          $('#test-label').value = cur ? cur.label : '';
          $('#test-picked').innerHTML = tchars.length ? '<b>' + tchars.length + '字</b> <span class="tlist">' + tchars.map(esc).join(' ') + '</span>' : '<span class="hint">まだ ありません</span>';
          app.querySelectorAll('.tcell').forEach(function (b) { var on = tchars.indexOf(b.dataset.c) >= 0; b.classList.toggle('tsel', on); b.classList.toggle('tfail', !!fails[b.dataset.c]); b.setAttribute('aria-pressed', on); });
          // #test-mgr を 描き直したので 中の操作を 付け直す
          var sel = $('#test-sel'); if (sel) sel.addEventListener('change', function () { testCur = S.testCur = sel.value; paintTest(); });
          var show = $('#test-show'); if (show) show.addEventListener('change', function () {
            tests.active = show.checked ? testCur : (tests.active === testCur ? null : tests.active);
            paintTest(); saveTests();
          });
          on('#test-new', function () {
            var id = 't' + Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36);
            tests.list.push({ id: id, label: '', chars: '' });
            if (tests.list.length === 1 && !tests.active) tests.active = id; // 最初のテストは そのまま見せる
            testCur = S.testCur = id;
            paintTest(); saveTests();
          });
          on('#test-del', function () {
            tests.list = tests.list.filter(function (t) { return t.id !== testCur; });
            if (tests.active === testCur) tests.active = null;
            testCur = S.testCur = tests.active || (tests.list[0] && tests.list[0].id) || null;
            paintTest(); saveTests();
          });
        }
        function saveTests() {
          $('#test-msg').textContent = '保存中…';
          Platform.setTests(klass, tests).then(function (v) {
            view.tests = tests = Sched.normTests(v); view.test = Sched.activeTest(tests);
            $('#test-msg').textContent = '✓ 保存しました';
          }, function () { $('#test-msg').textContent = '× 保存できませんでした'; });
        }
        app.querySelectorAll('.tcell').forEach(function (b) {
          b.addEventListener('click', function () {
            var cur = curTest(); if (!cur) return;
            var arr = Array.from(cur.chars), i = arr.indexOf(b.dataset.c);
            if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.c);
            cur.chars = arr.join('');
            paintTest(); saveTests();
          });
        });
        $('#test-label').addEventListener('change', function () { var cur = curTest(); if (cur) { cur.label = $('#test-label').value.trim().slice(0, 40); } paintTest(); saveTests(); });
        on('#test-clear', function () { var cur = curTest(); if (cur) { cur.chars = ''; } paintTest(); saveTests(); });
        paintTest();
        app.querySelectorAll('.gchecks input').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var list = Array.from(app.querySelectorAll('.gchecks input')).filter(function (x) { return x.checked; }).map(function (x) { return tabKey(x.dataset.g); });
            if (!list.some(function (g) { return !isKana(g); })) { cb.checked = true; $('#gmsg').textContent = '× 1年〜6年から1つ以上 えらんでください'; return; }
            $('#gmsg').textContent = '保存中…';
            // 学年を変えたら、いちばん上の学年を開く
            Platform.setGrades(klass, list).then(function () { view.grades = list; teacher(klass, 0, true); }, function () { cb.checked = !cb.checked; $('#gmsg').textContent = '× 保存できませんでした'; });
          });
        });
        on('#gate-try', function () { startTrial(klass); });
        on('#gate-reset', function () {
          $('#gate-msg').textContent = '保存中…';
          Platform.setGates(klass, []).then(function (v) { view.gates = v; teacher(klass, tgrade, true); }, function () { $('#gate-msg').textContent = '× 保存できませんでした'; });
        });
        app.querySelectorAll('input[name="wlevel"]').forEach(function (r) {
          r.addEventListener('change', function () {
            var v = r.value, prev = view.writeLevel || '';
            $('#wmsg').textContent = '保存中…';
            Platform.setWriteLevel(klass, v).then(function () {
              view.writeLevel = v; $('#d-write-now').textContent = v === 'easy' ? 'やさしい' : 'ふつう'; $('#wmsg').textContent = '✓ 保存しました';
            }, function () {
              app.querySelector('input[name="wlevel"][value="' + prev + '"]').checked = true; $('#wmsg').textContent = '× 保存できませんでした';
            });
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
    // 学級が 習った字（下の学年は全部、いちばん上の学年は進度まで、かなは全部）を みどりの線で示す
    var view = S.view || null, hasView = !!view, learned = {};
    if (view) {
      if (isKana(pg)) orderOf(pg).split('').forEach(function (c) { learned[c] = true; });
      else {
        var gs = (view.grades || []).filter(function (g) { return !isKana(g); }).map(Number), top = gs.length ? Math.max.apply(null, gs) : 0;
        if (pg <= top) {
          var o = orderOf(pg), ptr = (view.pointers || {})[pg] || 0;
          Array.from(pg < top || !ptr ? o : o.slice(0, ptr)).forEach(function (c) { learned[c] = true; });
        }
      }
    }
    // 学年タブと漢字一覧を上に置き、一覧が最初から最上部に見えるようにする
    app.innerHTML = '<header class="top t"><h1>書き順を 大きく見せる</h1><p class="sub">見せる字を 順に押す（1〜' + SHOW_MAX + '字）</p></header>' +
      '<main class="teacher">' +
      '<nav class="tabs t" role="tablist">' + ALL_TABS.map(function (g) { return '<button role="tab" class="ptab" data-g="' + g + '" aria-selected="' + (g === pg) + '">' + gName(g) + '</button>'; }).join('') + '</nav>' +
      '<p class="hint">' + (hasView ? '<span class="learned-mark">みどり</span>の 線が ある字は この学級が 習った字' : '習った漢字は 出せません（学級の設定を開くと出ます）') + '</p>' +
      '<div class="grid">' + Array.from(orderOf(pg)).map(function (c) { return '<button class="cell' + (learned[c] ? ' learned' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
      '<p class="picked" id="picked"></p>' +
      '<p><label class="opt"><input type="checkbox" id="opt-base"' + (showOpts().base ? ' checked' : '') + '> 完成した字を うすく表示して、その上に書き順を黒で重ねる</label></p>' +
      '<p><label class="opt"><input type="checkbox" id="opt-color"' + (showOpts().color ? ' checked' : '') + '> 一〜四画目に色をつける（' +
        ['青', '橙', '茶', '緑'].map(function (n, i) { return '<span class="cswatch s' + (i + 1) + '">' + (i + 1) + n + '</span>'; }).join('') + '）</label></p>' +
      '<p><button class="big primary" id="go" disabled>はじめる</button></p>' +
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
    app.querySelectorAll('.ptab').forEach(function (b) { b.addEventListener('click', function () { showPick(picked, tabKey(b.dataset.g)); }); });
    $('#opt-base').addEventListener('change', function () { setShowOpt('base', this.checked); });
    $('#opt-color').addEventListener('change', function () { setShowOpt('color', this.checked); });
    on('#go', function () { showStart(picked.slice(), function () { showPick(picked, pg); }); });
    on('#cancel', function () { teacher(S.klass); });
    paint();
    // 学年タブ（その下に漢字一覧）が画面の最上部に来る位置に戻す
    var pickTabs = $('nav.tabs');
    if (pickTabs) pickTabs.scrollIntoView();
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
    var idx = 0, stopAnim = null, opts = showOpts(), base = opts.base, color = opts.color;
    function stopLoop() { if (stopAnim) { stopAnim(); stopAnim = null; } }
    function single() {
      stopLoop();
      var c = list[idx], k = info(c), H = window.innerHeight, side = Math.max(120, (window.innerWidth - Math.min(H, window.innerWidth * 0.78)) / 2);
      stage.className = 'single';
      stage.innerHTML = '<div class="kun" aria-label="訓読み" style="font-size:' + readSize(k.kun, H, side) + '">' + readingHtml(k.kun, true) + '</div>' +
        '<div class="big-kanji">' + kanjiSvg(c, 'show-svg', base, color) + '</div>' +
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
        list.map(function (c) { return kanjiSvg(c, 'show-svg', base, color); }).join('') + '</div>';
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
    document.body.classList.toggle('trial', !!S.trial); // 帯は画面の左に置く（style.css）。児童画面の高さを削らない
    if (!S.trial) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'trial-bar';
      document.body.insertBefore(bar, app);
    }
    bar.innerHTML = '<span class="tb-label">先生のおためし中（記録は この端末だけ）' + (S.dayOffset ? '・' + S.dayOffset + '日後' : '') + '</span>' +
      '<span class="tb-gate"><span class="tb-gl">ボタンの右上:</span> <span class="tb-gl"><b class="on">✓</b>児童が使える</span> <span class="tb-gl"><b class="off">✕</b>使えない</span><span id="tb-msg" aria-live="polite"></span></span>' +
      '<button id="tb-day">1日すすめる</button><button id="tb-reset">はじめから</button><button id="tb-back">先生画面にもどる</button>';
    bar.querySelector('#tb-day').addEventListener('click', function () { S.dayOffset = (S.dayOffset || 0) + 1; trialBar(); menu(); });
    bar.querySelector('#tb-reset').addEventListener('click', function () {
      Platform.resetTrial(); S.p = Sched.newProgress(); S.dayOffset = 0;
      Platform.store.set('kanzi.prevGrowth.trial.' + S.info.email, 0);
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
      applyGrades(view.grades); S.pointers = view.pointers || {}; S.writeLevel = view.writeLevel || '';
      S.gates = Sched.normGates(view.gates); S.gatesSaved = S.gates.slice();
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
    applyGrades(info.grades);
    S.writeLevel = info.writeLevel || '';
    S.gates = Sched.normGates(info.gates);
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

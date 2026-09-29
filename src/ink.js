// 書字パッドと1画ごとの判定（設計書 D5・§4「ふくしゅう：かく」）。
// 採点するのは字体（どの画か・向き・位置）だけ。とめ・はね・はらいは見ない（S4）。
// 書き順が違っても、まだ書いていない画に合えば受け付けて「順序違い」として数える（S5）。
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var N = 32; // 比較に使う点の数
  var TOL = 19; // 1画の平均ずれの許容（109四方の座標で。児童の入力精度に合わせて広め：R16）
  // 判定の強さ（先生が学級ごとに選ぶ）。easy＝やさしい: ずれ・長さの許容を広げ、3回続けてまちがえるまで待つ。書く向きは見る（書き順の学習のため）。
  // 3年の200字で実測（各画に なめらかなずれ・曲がりを加えて書く。docs/design.md §19）:
  //   ずれ±10で正解になる字 normal 123 → easy 195 ／ 同じ画数の別の字を書いて正解になる割合 normal 0.3% → easy 4.5%
  var LEVELS = {
    normal: { tol: TOL, minLen: 0.35, maxLen: 2.3, anyDir: false, stuckAfter: 2 },
    easy: { tol: 25, minLen: 0.25, maxLen: 3.0, anyDir: false, stuckAfter: 3 }
  };
  var MAX_SHIFT = 14; // 字全体のずれを補正する上限

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function polyLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  }

  // ぐちゃぐちゃ書き込み: パッド（109四方）を何往復もするほど長い線・鋭いきり返しの多い線は
  // 「どの画を書こうとしたか」が分からないので、判定を続けても合わない。すぐ答えを見せるきっかけにする。
  function scribble(pts, dlen) {
    if (dlen > 380) return true;
    var turns = 0;
    for (var i = 2; i < pts.length; i++) {
      var ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y;
      var bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y;
      var la = ax * ax + ay * ay, lb = bx * bx + by * by;
      if (la < 2.25 || lb < 2.25) continue; // 1.5未満の区間は手ぶれ（数えない）
      if (ax * bx + ay * by < -0.5 * Math.sqrt(la * lb)) turns++; // 120度を超えるきり返し
    }
    return turns >= 6;
  }

  // 折れ線を弧長で N 点に取り直す
  function resample(pts) {
    if (pts.length === 1) pts = [pts[0], { x: pts[0].x + 0.01, y: pts[0].y }];
    var L = polyLen(pts), step = L / (N - 1), out = [pts[0]], acc = 0;
    for (var i = 1; i < pts.length && out.length < N; i++) {
      var a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
      while (acc + d >= step * out.length && out.length < N) {
        var t = d ? (step * out.length - acc) / d : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      acc += d;
    }
    while (out.length < N) out.push(pts[pts.length - 1]);
    return out;
  }

  function meanDist(a, b, off, reverse) {
    var s = 0;
    for (var i = 0; i < N; i++) {
      var p = a[i], q = b[reverse ? N - 1 - i : i];
      s += Math.hypot(p.x - off.x - q.x, p.y - off.y - q.y);
    }
    return s / N;
  }

  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / pts.length, y: y / pts.length };
  }

  // お手本（筆順アニメ）。paths は SVG の path 要素の配列
  function animate(paths, speed) {
    var t = 0, anims = [];
    paths.forEach(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      var dur = (250 + len * 7) / (speed || 1);
      anims.push(p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, delay: t, fill: 'forwards', easing: 'linear' }));
      t += dur + 120;
    });
    return Promise.all(anims.map(function (a) { return a.finished; })).catch(function () {});
  }

  // 書字パッド
  // opts: { strokes: [d...], mode: 'trace'|'hint'|'free'|'show', onDone(result), onMiss(kind), onStroke(i) }
  function Pad(container, opts) {
    var self = this;
    this.opts = opts;
    container.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 109 109', class: 'pad', role: 'img', 'aria-label': 'かくところ' }, container);
    el('rect', { x: 1, y: 1, width: 107, height: 107, class: 'pad-frame' }, svg);
    el('path', { d: 'M54.5 4V105M4 54.5H105', class: 'pad-grid' }, svg);
    this.svg = svg;
    this.guide = el('g', { class: 'pad-guide' }, svg);
    this.ink = el('g', { class: 'pad-ink' }, svg);
    this.marks = el('g', { class: 'pad-marks' }, svg);
    this.tplPaths = opts.strokes.map(function (d) { return el('path', { d: d }, self.guide); });
    this.tpl = this.tplPaths.map(function (p) {
      var L = p.getTotalLength(), pts = [];
      for (var i = 0; i < N; i++) { var q = p.getPointAtLength(L * i / (N - 1)); pts.push({ x: q.x, y: q.y }); }
      return { pts: pts, len: L, c: centroid(pts) };
    });
    this.penSeen = false;
    this.bind();
    this.setMode(opts.mode || 'free');
  }

  Pad.prototype.reset = function () {
    this.done = this.tpl.map(function () { return false; });
    this.next = 0; // 次に期待する画
    this.shifts = [];
    this.result = { orderMiss: 0, misses: 0, assisted: false };
    this.streak = 0; // 同じ画で続けて外れた回数
    this.hintOn = false;
    this.stuck = false;
    this.ink.innerHTML = '';
    this.renderGuide();
  };

  Pad.prototype.setMode = function (m) {
    this.mode = m;
    this.reset();
  };

  Pad.prototype.offset = function () {
    if (!this.shifts.length) return { x: 0, y: 0 };
    var s = centroid(this.shifts);
    return { x: Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, s.x)), y: Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, s.y)) };
  };

  Pad.prototype.expected = function () {
    for (var i = 0; i < this.done.length; i++) if (!this.done[i]) return i;
    return -1;
  };

  // ガイド: なぞる＝全画を薄く、ヒント＝次の1画だけ、じぶんで＝なし（外れが続いたら次の1画を出す）
  Pad.prototype.renderGuide = function () {
    var m = this.mode, nx = this.expected(), hint = this.hintOn;
    this.tplPaths.forEach(function (p, i) {
      var show = m === 'show' || (m === 'trace' && !this.done[i]) || ((m === 'hint' || hint) && i === nx);
      p.setAttribute('class', show ? (i === nx && m !== 'show' ? 'g-next' : 'g-all') : 'g-hide');
      p.style.strokeDasharray = ''; p.style.strokeDashoffset = '';
    }, this);
    this.marks.innerHTML = '';
    if (nx >= 0 && (m === 'trace' || m === 'hint' || hint)) {
      var s = this.tpl[nx].pts[0];
      el('circle', { cx: s.x, cy: s.y, r: 3.2, class: 'start-dot' }, this.marks);
    }
  };

  Pad.prototype.bind = function () {
    var self = this, cur = null, pid = null;
    function pt(ev) {
      var r = self.rect || self.svg.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / r.width * 109, y: (ev.clientY - r.top) / r.height * 109 };
    }
    this.svg.addEventListener('pointerdown', function (ev) {
      if (self.mode === 'show' || self.stuck || self.expected() < 0) return;
      if (ev.pointerType === 'pen') self.penSeen = true;
      if (self.penSeen && ev.pointerType === 'touch') return; // ペンを使っている間は手のひらの接触を無視
      if (pid !== null) return;
      pid = ev.pointerId;
      self.svg.setPointerCapture(pid);
      self.rect = self.svg.getBoundingClientRect(); // 線を引いている間は同じ（イベントごとに取り直すと遅い）
      var q = pt(ev);
      cur = { pts: [q], str: q.x.toFixed(1) + ',' + q.y.toFixed(1), line: el('polyline', { class: 'stroke-live' }, self.ink) };
      cur.line.setAttribute('points', cur.str);
      ev.preventDefault();
    });
    this.svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerId !== pid || !cur) return;
      var p = pt(ev), last = cur.pts[cur.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.8) return;
      cur.pts.push(p);
      cur.str += ' ' + p.x.toFixed(1) + ',' + p.y.toFixed(1);
      cur.line.setAttribute('points', cur.str);
    });
    function end(ev) {
      if (ev.pointerId !== pid || !cur) return;
      pid = null;
      var c = cur; cur = null;
      self.judge(c);
    }
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
  };

  Pad.prototype.judge = function (c) {
    var drawn = resample(c.pts), dlen = polyLen(c.pts), off = this.offset();
    var nx = this.expected(), best = -1, bestS = Infinity, reversed = false, L = LEVELS[this.opts.level] || LEVELS.normal, TOL = L.tol;
    var fit = function (i) {
      var t = this.tpl[i];
      var f = meanDist(drawn, t.pts, off, false), r = meanDist(drawn, t.pts, off, true);
      var shortTpl = t.len < 22; // 点などの短い画は向きを問わない
      var lenOk = shortTpl || (dlen > t.len * L.minLen && dlen < t.len * L.maxLen + 15);
      return { s: shortTpl || L.anyDir ? Math.min(f, r) : f, rev: !shortTpl && r < f * 0.7 && r <= TOL, ok: lenOk };
    }.bind(this);
    var e = fit(nx);
    if (e.ok && e.s <= TOL) { best = nx; bestS = e.s; }
    else {
      for (var i = 0; i < this.tpl.length; i++) {
        if (this.done[i] || i === nx) continue;
        var f = fit(i);
        if (f.ok && f.s <= TOL && f.s < bestS) { best = i; bestS = f.s; }
      }
      if (best < 0 && e.rev) reversed = true;
    }
    if (best < 0) {
      c.line.setAttribute('class', 'stroke-miss');
      setTimeout(function () { if (c.line.parentNode) c.line.parentNode.removeChild(c.line); }, 450);
      this.result.misses++;
      this.streak++;
      // ぐちゃぐちゃ書き込みなら待たずに知らせる（呼び出し側は「わからない」と同じ扱いで答えを見せる）
      var messy = scribble(c.pts, dlen);
      if (messy) this.result.scribble = true;
      if (this.mode === 'free' && !this.stuck && (messy || (this.streak >= L.stuckAfter && !this.hintOn))) {
        this.result.assisted = true;
        // onStuck があれば、ヒントを出さずに知らせる（呼び出し側が正解の書き順を見せて次へ進む）
        if (this.opts.onStuck) { this.stuck = true; this.opts.onStuck(this.result); return; }
        if (!this.hintOn) { this.hintOn = true; this.renderGuide(); }
      }
      if (this.opts.onMiss) this.opts.onMiss(reversed ? 'reverse' : 'shape');
      return;
    }
    this.streak = 0;
    if (best !== nx) this.result.orderMiss++;
    this.done[best] = true;
    var dc = centroid(drawn), tc = this.tpl[best].c;
    this.shifts.push({ x: dc.x - tc.x, y: dc.y - tc.y });
    c.line.setAttribute('class', 'stroke-ok');
    this.renderGuide();
    if (this.opts.onStroke) this.opts.onStroke(best);
    if (this.expected() < 0 && this.opts.onDone) this.opts.onDone(this.result);
  };

  // お手本を再生（書いた線は消す）
  Pad.prototype.demo = function (speed) {
    var prev = this.mode;
    this.mode = 'show';
    this.ink.innerHTML = '';
    this.marks.innerHTML = '';
    this.tplPaths.forEach(function (p) { p.setAttribute('class', 'g-demo'); });
    var self = this;
    return animate(this.tplPaths, speed).then(function () {
      self.tplPaths.forEach(function (p) { p.getAnimations().forEach(function (a) { a.cancel(); }); });
      self.mode = prev;
      self.reset();
    });
  };

  root.Ink = { LEVELS: LEVELS, Pad: Pad, animate: animate, _resample: resample, _scribble: scribble };
})(this);

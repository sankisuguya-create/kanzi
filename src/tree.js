// メニューの「育つ木」。本人の取り組みだけで育つ（他の児童のデータは使わない：設計書 §1）。
// はっぱ＝取り組んだ数（よしゅう・ふくしゅうで1枚ずつ。まだ／おぼえた を問わない）、み＝おぼえた字。
// 軽さのため: 要素は最大約450個、描画はメニューを開いた時の1回だけ。常時動くアニメーションは置かない。
(function (root) {
  'use strict';
  var MAX_LEAVES = 240;
  var FULL = 1500; // この取り組み数で木が最大になる
  var GA = 2.399963; // 黄金角（葉が重ならず、増えても前の葉の位置が変わらない）

  function f1(n) { return Math.round(n * 10) / 10; }
  // 位置の揺らぎ（番号から決まるので、増えても前の葉・実は動かない）
  function jit(i, k) { var x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; }

  // prevActivity: 前回メニューを開いた時の数。増えた分の葉を「新しい葉」として一度だけ弾ませる
  function render(activity, learned, total, prevActivity) {
    var g = Math.min(1, Math.log(1 + activity) / Math.log(1 + FULL));
    var groundY = 228, trunkH = 26 + 104 * g, trunkW = 5 + 11 * g;
    var cx = 160, cy = groundY - trunkH - 18 * g;
    var rx = 16 + 104 * g, ry = 13 + 72 * g;
    var s = [];
    s.push('<svg viewBox="0 0 320 240" class="tree" role="img" aria-label="とりくんだ数 ' + activity + '、おぼえた字 ' + learned + '">');
    s.push('<ellipse cx="160" cy="' + (groundY + 4) + '" rx="150" ry="12" class="t-ground"/>');
    // 幹と枝
    s.push('<path class="t-trunk" d="M' + f1(cx - trunkW) + ' ' + groundY + ' Q' + f1(cx - trunkW * 0.4) + ' ' + f1(groundY - trunkH * 0.5) + ' ' + f1(cx - trunkW * 0.3) + ' ' + f1(cy) +
      ' L' + f1(cx + trunkW * 0.3) + ' ' + f1(cy) + ' Q' + f1(cx + trunkW * 0.4) + ' ' + f1(groundY - trunkH * 0.5) + ' ' + f1(cx + trunkW) + ' ' + groundY + 'Z"/>');
    if (g > 0.45) {
      var by = cy + ry * 0.35;
      s.push('<path class="t-branch" stroke-width="' + f1(trunkW * 0.45) + '" d="M' + cx + ' ' + f1(by + 10) + ' Q' + f1(cx - rx * 0.3) + ' ' + f1(by) + ' ' + f1(cx - rx * 0.55) + ' ' + f1(by - ry * 0.35) +
        'M' + cx + ' ' + f1(by + 4) + ' Q' + f1(cx + rx * 0.3) + ' ' + f1(by - 6) + ' ' + f1(cx + rx * 0.55) + ' ' + f1(by - ry * 0.45) + '"/>');
    }
    // はっぱ
    var nLeaves = Math.min(activity, MAX_LEAVES), prev = Math.min(prevActivity == null ? activity : prevActivity, MAX_LEAVES);
    for (var i = 0; i < nLeaves; i++) {
      var r = Math.sqrt((i + 0.6) / MAX_LEAVES), a = i * GA;
      var x = cx + Math.cos(a) * r * rx + jit(i, 1) * 9, y = cy + Math.sin(a) * r * ry + jit(i, 2) * 7;
      var rot = Math.round((a * 57.3) % 360);
      var shade = i % 3;
      s.push('<ellipse class="t-leaf l' + shade + (i >= prev ? ' t-new' : '') + '" cx="' + f1(x) + '" cy="' + f1(y) + '" rx="5.2" ry="2.8" transform="rotate(' + rot + ' ' + f1(x) + ' ' + f1(y) + ')"' +
        (i >= prev ? ' style="animation-delay:' + Math.min(i - prev, 20) * 40 + 'ms"' : '') + '/>');
    }
    if (activity === 0) s.push('<path class="t-sprout" d="M160 228 q-2 -12 -12 -16 q10 0 12 10 q2 -10 12 -10 q-10 4 -12 16z"/>');
    // み（おぼえた字）
    var nFruit = Math.min(learned, total);
    for (var j = 0; j < nFruit; j++) {
      var r2 = Math.sqrt((j + 0.5) / total) * 0.9, a2 = j * 2.62 + 1.2 + jit(j, 3) * 0.6;
      var fx = cx + Math.cos(a2) * r2 * rx + jit(j, 4) * 8, fy = cy + Math.sin(a2) * r2 * ry + jit(j, 5) * 6;
      s.push('<circle class="t-fruit" cx="' + f1(fx) + '" cy="' + f1(fy) + '" r="3"/>');
    }
    s.push('</svg>');
    return s.join('');
  }

  root.Tree = { render: render };
})(this);

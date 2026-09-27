// 樹形だけを描く。DOM操作・学習記録・カメラ・キャッシュには依存しない。
// tree = {type: 樹種番号, modes: パーツごとの色番号文字列}。同じ入力は同じ画像になる。
(function (root) {
  'use strict';
  const MODE_COLORS = [
    { h: 139, s: 31, l: 53 },
    { h: 199, s: 37, l: 61 },
    { h: 27, s: 56, l: 65 },
    { h: 274, s: 32, l: 65 },
    { h: 49, s: 52, l: 60 }
  ];
  const seed = (x) => {
    const y = Math.sin(x * 127.1 + 311.7) * 43758.5453;
    return y - Math.floor(y);
  };
  function modeAt(tree, i) {
    return Number(tree.modes[i] || 0);
  }
  function ellipse(g, x, y, rx, ry, fill) {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  function colors(type) {
    const h = 143;
    return {
      h,
      s: [29, 37, 57, 32, 27][type],
      l: [49, 77, 61, 57, 37][type],
      stem: type === 3 ? '#e4e4ce' : '#8e8870'
    };
  }
  function leaf(g, x, y, a, r, type, fill) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = fill;
    g.beginPath();
    if (type === 2) {
      for (let j = 0; j < 10; j++) {
        const t = -Math.PI / 2 + (j * Math.PI) / 5,
          rr = j % 2 ? r * 0.43 : r;
        const xx = Math.cos(t) * rr,
          yy = Math.sin(t) * rr;
        j ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
      }
      g.closePath();
    } else if (type === 4) {
      g.moveTo(0, -r);
      g.quadraticCurveTo(r * 0.7, 0, 0, r * 0.6);
      g.quadraticCurveTo(-r * 0.7, 0, 0, -r);
    } else {
      g.ellipse(0, 0, r * 0.53, r, a * 0.13, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  }
  function points(id, type) {
    return Array.from({ length: 36 }, (_, i) => {
      const a = i * 2.399963 + seed(id + 4) * 0.4,
        r = Math.sqrt((i + 0.5) / 36);
      let x, y;
      if (type === 4) {
        const row = Math.floor(i / 3),
          t = (row + 1) / 12;
        x = ((i % 3) - 1) * t * 58 + (seed(i + id * 40) - 0.5) * 14 * t;
        y = -252 + t * 192;
      } else {
        const rx = [101, 108, 114, 64][type],
          ry = [67, 68, 54, 92][type];
        x = Math.cos(a) * r * rx + (seed(i + id * 43) - 0.5) * 8;
        y = -[178, 170, 153, 172][type] + Math.sin(a) * r * ry;
        if (type === 2) y = Math.round(y / 28) * 28 + (seed(i + 17) - 0.5) * 7;
      }
      return { x, y, i, r: 16 + seed(id * 91 + i * 3) * 9 };
    });
  }
  function cluster(g, pt, type, mode, detail, id) {
    const hue = MODE_COLORS[mode].h,
      sat = MODE_COLORS[mode].s,
      light = MODE_COLORS[mode].l + (type === 1 ? 7 : 0) + (-pt.y - 120) * 0.04;
    g.save();
    g.translate(pt.x, pt.y);
    const rw = type === 4 ? pt.r * 1.4 : pt.r,
      rh = type === 4 ? pt.r * 0.48 : pt.r * 0.77;
    const gradient = g.createLinearGradient(-rw, -rh, rw, rh);
    gradient.addColorStop(0, `hsl(${hue} ${sat}% ${light + 12}%)`);
    gradient.addColorStop(0.6, `hsl(${hue} ${sat}% ${light}%)`);
    gradient.addColorStop(1, `hsl(${hue} ${sat}% ${light - 10}%)`);
    g.fillStyle = gradient;
    g.beginPath();
    const lobes = 14;
    for (let k = 0; k <= lobes; k++) {
      const a = (k / lobes) * Math.PI * 2,
        rr = 0.9 + 0.11 * Math.sin(k * 2.7 + id + pt.i);
      const x = Math.cos(a) * rw * rr,
        y = Math.sin(a) * rh * rr;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
    if (detail) {
      for (let k = 0; k < 9; k++) {
        const a = k * 2.399 + pt.i * 0.23,
          rr = Math.sqrt((k + 0.5) / 9),
          xx = Math.cos(a) * rw * rr,
          yy = Math.sin(a) * rh * rr;
        leaf(
          g,
          xx,
          yy,
          a,
          3.3 + seed(k + pt.i * 11) * 2.5,
          type,
          `hsl(${hue + seed(k) * 8} ${sat + 3}% ${light + 5 + seed(k + pt.i) * 15}%)`
        );
      }
      if (mode === 1 && pt.i % 4 === 0) {
        ellipse(g, -rw * 0.25, -rh * 0.1, 1.5, 2, 'rgba(244,255,240,.7)');
      } else if (mode === 2 && pt.i % 4 === 0) {
        g.strokeStyle = 'rgba(255,246,203,.65)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(0, -4);
        g.lineTo(4, 0);
        g.lineTo(0, 4);
        g.lineTo(-4, 0);
        g.closePath();
        g.stroke();
      }
    }
    g.restore();
  }
  // 種・新芽・苗木は成木の枝とは別の形で描く。
  function paintSprout(g, tree, n, res, layer) {
    g.save();
    g.scale(res / 320, res / 320);
    g.translate(160, 292);
    const h = 27 + n * 11;
    if (layer !== 'last') {
      ellipse(g, 0, 2, 28 + n * 5, 7, '#d0d9b3');
      ellipse(g, 0, -1, 8, 5, '#ab9567');
      if (n > 0) {
        g.strokeStyle = '#809c5e';
        g.lineWidth = 2.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(-4, -h * 0.6, 1, -h);
        g.stroke();
      }
    }
    if (n > 0) {
      const pairs = n;
      for (let j = 0; j < pairs; j++) {
        if ((layer === 'last' && j !== pairs - 1) || (layer === 'base' && j === pairs - 1)) continue;
        const y = -h + j * 13,
          color = MODE_COLORS[modeAt(tree, j)];
        for (const side of [-1, 1])
          leaf(g, side * 9, y - 3, side * 0.9, 11 - j * 0.7, 0, `hsl(${color.h} ${color.s}% ${color.l}%)`);
      }
    }
    g.restore();
    return { x: 160, y: 292 - h + (n - 1) * 13 };
  }
  function paintBranches(g, type, p, pts, n) {
    ellipse(g, 0, 1, type === 4 ? 65 : 96, 13, 'rgba(68,100,48,.12)');
    g.strokeStyle = p.stem;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const trunkTop = type === 4 ? -253 : type === 3 ? -235 : -153;
    g.lineWidth = type === 3 ? 7 : 12;
    g.beginPath();
    g.moveTo(-3, 0);
    g.bezierCurveTo(-1, -40, 5, -90, -2, trunkTop);
    g.stroke();
    g.strokeStyle = type === 3 ? '#9d9e83' : '#b6ab84';
    g.lineWidth = type === 3 ? 1 : 2.3;
    g.beginPath();
    g.moveTo(-5, -3);
    g.bezierCurveTo(-2, -35, 1, -80, -4, trunkTop * 0.92);
    g.stroke();
    if (type === 3) {
      g.strokeStyle = '#8e9580';
      g.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) {
        g.beginPath();
        g.moveTo(-3, -15 - k * 24);
        g.lineTo(k % 2 ? 2 : 0, -16 - k * 24);
        g.stroke();
      }
    }
    const hubs =
      type === 4
        ? [{ x: 0, y: -165 }]
        : type === 3
          ? [
              { x: -22, y: -158 },
              { x: 19, y: -189 },
              { x: 0, y: -224 }
            ]
          : [
              { x: -42, y: -145 },
              { x: 3, y: -180 },
              { x: 46, y: -147 }
            ];
    if (type !== 4) {
      for (const hub of hubs) {
        g.strokeStyle = p.stem;
        g.lineWidth = type === 3 ? 3.5 : 5;
        g.beginPath();
        g.moveTo(0, -64);
        g.bezierCurveTo(hub.x * 0.25, -108, hub.x * 0.78, hub.y + 25, hub.x, hub.y);
        g.stroke();
      }
    }
    for (let i = 0; i < n; i++) {
      const pt = pts[i],
        hub = hubs[type === 4 ? 0 : pt.x < -20 ? 0 : pt.x > 20 ? 2 : 1];
      g.strokeStyle = p.stem;
      g.lineWidth = 1.2 + (1 - i / 36) * 1.1;
      g.beginPath();
      if (type === 4) {
        g.moveTo(0, pt.y + 12);
        g.quadraticCurveTo(pt.x * 0.6, pt.y + 12, pt.x, pt.y);
      } else {
        g.moveTo(hub.x, hub.y);
        g.bezierCurveTo(hub.x * 0.7 + pt.x * 0.3, hub.y - 15, pt.x, pt.y + 12, pt.x, pt.y);
      }
      g.stroke();
    }
  }
  function paintCedarMantle(g, tree, n, p, layer) {
    const type = tree.type;
    if (type === 4 && layer !== 'last') {
      g.fillStyle = `hsl(${p.h} ${p.s}% ${p.l + 7}%)`;
      g.beginPath();
      g.moveTo(0, -259);
      g.quadraticCurveTo(-3, -246, -13, -231);
      g.quadraticCurveTo(0, -235, 13, -231);
      g.quadraticCurveTo(3, -246, 0, -259);
      g.fill();
    }
    // 杉の各段を重ねた連続面でつなぐ。葉の隙間から背景が横縞に抜けない。
    if (type === 4 && layer !== 'last') {
      for (let row = 0; row < Math.ceil(n / 3); row++) {
        const y = -263 + row * 16,
          top = row * 6.5,
          bottom = (row + 1.7) * 6.5;
        const color = MODE_COLORS[modeAt(tree, Math.min(n - 1, row * 3))];
        const fill = g.createLinearGradient(-bottom, y, bottom, y + 32);
        fill.addColorStop(0, `hsl(${color.h} ${color.s}% ${color.l + 3}%)`);
        fill.addColorStop(1, `hsl(${color.h} ${color.s}% ${color.l - 10}%)`);
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(-top, y);
        g.lineTo(top, y);
        g.quadraticCurveTo(top + 3, y + 13, bottom, y + 31);
        g.lineTo(bottom * 0.7, y + 28);
        g.lineTo(bottom * 0.48, y + 32);
        g.quadraticCurveTo(0, y + 36, -bottom * 0.5, y + 31);
        g.lineTo(-bottom, y + 32);
        g.quadraticCurveTo(-top - 2, y + 13, -top, y);
        g.closePath();
        g.fill();
      }
    }
  }
  function paintTree(g, id, tree, n, res, layer) {
    const type = tree.type,
      p = colors(type),
      pts = points(id, type),
      growth = 0.26 + 0.74 * Math.pow(n / 36, 0.46),
      detail = res >= 320;
    if (n <= 3) return paintSprout(g, tree, n, res, layer);
    g.save();
    g.scale(res / 320, res / 320);
    g.translate(160, 292);
    g.scale(growth, growth);
    if (layer !== 'last') paintBranches(g, type, p, pts, n);
    paintCedarMantle(g, tree, n, p, layer);
    const indexes = Array.from({ length: n }, (_, i) => i)
      .filter((i) => (layer === 'last' ? i === n - 1 : layer === 'base' ? i !== n - 1 : true))
      .sort((a, b) => pts[a].y - pts[b].y);
    for (const i of indexes) cluster(g, pts[i], type, modeAt(tree, i), detail, id);
    g.restore();
    return { x: 160 + pts[n - 1].x * growth, y: 292 + pts[n - 1].y * growth };
  }

  root.TreePainter = { paint: paintTree };
})(typeof globalThis !== 'undefined' ? globalThis : this);

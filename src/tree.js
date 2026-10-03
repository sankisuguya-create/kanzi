// 本人の学習履歴から育つ森。通信・乱数・時刻に依存せず同じ記録は同じ形と色になる。
// 36段階で1本、27本ごとに次の森。表示する森だけ描画する。
// 完成木の画像は画面をまたいで再利用（LRU、RGBA換算12MiBまで）。静止時のRAFは0。
(function (root) {
  'use strict';
  const STEP = root.Sched.FOREST_STEP,
    AREA = root.Sched.FOREST_TREES,
    MAX_PIXELS = 3 * 1024 * 1024;
  const NAMES = ['ケヤキ', 'サクラ', 'カエデ', 'シラカバ', 'スギ'];
  const cache = new Map();
  let cachePixels = 0;
  const seed = root.TreePainter.seed; // 擬似乱数は tree-painter.js の正本を共用
  const lots = [[0, 0]],
    dirs = [
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1]
    ];
  for (let ring = 1; lots.length < AREA; ring++) {
    let q = 0,
      r = -ring;
    for (const [dq, dr] of dirs)
      for (let step = 0; step < ring && lots.length < AREA; step++) {
        lots.push([
          (q + r * 0.5) * 146 + seed(lots.length) * 12 - 6,
          r * 83 + seed(lots.length + 41) * 10 - 5
        ]);
        q += dq;
        r += dr;
      }
  }
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function mount(host, options) {
    const growth = options.growth || root.Sched.forestGrowth(options.progress),
      n = growth.completed.length * AREA * STEP + growth.log.length + growth.fraction;
    const active = Math.max(0, Math.ceil(n / STEP) - 1),
      local = Math.floor(n - active * STEP);
    const currentRegion = Math.floor(active / AREA);
    const state = { focus: false, region: currentRegion };
    const records = new Map();
    let regionLog = '', logRegion = -1;
    function record(id) {
      const region = Math.floor(id / AREA);
      if (region !== logRegion) {
        regionLog = root.Sched.forestRegionLog(growth, region);
        logRegion = region;
      }
      if (!records.has(id))
        records.set(id, {
          type: id % 5,
          modes: regionLog
            .slice((id % AREA) * STEP, (id % AREA + 1) * STEP)
            .replace(/[prwky]/g, (c) => ({ p: '0', r: '1', w: '2', k: '3', y: '3' })[c]) // カードは2種類とも同じ色
        });
      return records.get(id);
    }
    host.innerHTML =
      '<canvas class="tree" role="img"></canvas>' +
      '<progress class="forest-progress" max="' + STEP + '" aria-label="今の木の成長"></progress>' +
      '<div class="forest-tools"><p class="forest-status" aria-live="polite"></p>' +
      '<button type="button" class="forest-focus" aria-pressed="false">育てている場所へ</button></div>' +
      '<div class="forest-regions" hidden><button type="button" class="forest-prev">前の森</button>' +
      '<span class="forest-region-name"></span><button type="button" class="forest-next">次の森</button></div>' +
      '<details class="forest-colors"><summary>葉の色</summary><div class="forest-legend" aria-label="学習モードと葉の色">' +
      '<span><i class="forest-r" style="background:' + root.TreePainter.COLORS[1] + '" aria-hidden="true"></i>よむ</span>' +
      '<span><i class="forest-w" style="background:' + root.TreePainter.COLORS[2] + '" aria-hidden="true"></i>かく</span>' +
      '</div><p class="forest-note">読む・書くで 育つよ。カードでは 育たないよ。</p></details>';
    const canvas = host.querySelector('canvas'),
      ctx = canvas.getContext('2d', { alpha: false });
    const status = host.querySelector('.forest-status'),
      focus = host.querySelector('.forest-focus');
    const regions = host.querySelector('.forest-regions'),
      previous = host.querySelector('.forest-prev'),
      next = host.querySelector('.forest-next');
    const abort = new AbortController(),
      listen = (el, event, fn) => el.addEventListener(event, fn, { signal: abort.signal });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true,
      disposed = false,
      raf = 0,
      transition = null,
      currentCamera = null,
      background = null,
      completedImage = null,
      completedKey = '',
      completedPaints = 0,
      bgKey = '',
      lastFrame = -Infinity,
      frames = 0;
    function sprite(id, n, res, layer = 'full') {
      const r = record(id),
        key = [id, n, res, layer, r.type, r.modes.slice(0, n)].join(':');
      if (cache.has(key)) {
        const hit = cache.get(key);
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const image = makeCanvas(res, res);
      const anchor = root.TreePainter.paint(image.getContext('2d'), id, r, n, res, layer, STEP);
      const result = { image, anchor };
      cache.set(key, result);
      cachePixels += res * res;
      while (cachePixels > MAX_PIXELS && cache.size > 1) {
        const oldest = cache.keys().next().value;
        const entry = cache.get(oldest);
        cachePixels -= entry.image.width * entry.image.height;
        cache.delete(oldest);
      }
      return result;
    }

    function data() {
      const region = state.focus ? currentRegion : state.region;
      return { region, start: region * AREA, count: Math.max(1, Math.min(AREA, active - region * AREA + 1)) };
    }
    function camera(w, h, count) {
      const pts = lots.slice(0, count);
      if (state.focus) {
        const p = lots[active % AREA];
        return { x: p[0], y: p[1] - 139, s: Math.min((w - 24) / 292, (h - 20) / 292, 1.18) };
      }
      const minX = Math.min(...pts.map((p) => p[0])) - 141,
        maxX = Math.max(...pts.map((p) => p[0])) + 141;
      const minY = Math.min(...pts.map((p) => p[1])) - 282,
        maxY = Math.max(...pts.map((p) => p[1])) + 15;
      return {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        s: Math.min((w - 24) / (maxX - minX), (h - 20) / (maxY - minY), 1.18)
      };
    }
    function paintBackground(w, h, dpr) {
      const key = [w, h, dpr].join(':');
      if (bgKey === key) return;
      background = makeCanvas(Math.round(w * dpr), Math.round(h * dpr));
      const g = background.getContext('2d');
      g.scale(dpr, dpr);
      const fill = g.createRadialGradient(w * 0.42, h * 0.26, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.7);
      fill.addColorStop(0, '#f2f2d6');
      fill.addColorStop(1, '#e7efdf');
      g.fillStyle = fill;
      g.fillRect(0, 0, w, h);
      bgKey = key;
    }
    function draw(now) {
      if (disposed || !visible || document.hidden) return;
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(devicePixelRatio || 1, 1.5),
        pw = Math.round(w * dpr),
        ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        bgKey = '';
      }
      const d = data();
      const isCompleted = !state.focus && d.region < growth.completed.length;
      const imageKey = [d.region, pw, ph].join(':');
      // 完成した森は一枚の画像として再利用。待機中の描画もアニメーションもない。
      if (isCompleted && completedImage && completedKey === imageKey) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(completedImage, 0, 0);
        currentCamera = camera(w, h, d.count);
        transition = null;
        frames++;
        return;
      }
      paintBackground(w, h, dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(background, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = camera(w, h, d.count);
      let t = 1,
        cam = target;
      // 初回のResizeObserver通知後、実際に見える最初の描画で成長を始める。
      if (
        frames === 0 &&
        Number.isFinite(options.prevActivity) &&
        options.prevActivity < n &&
        !isCompleted &&
        !reduced.matches
      ) {
        const oldId = Math.max(0, Math.ceil(options.prevActivity / STEP) - 1);
        const count =
          Math.floor(oldId / AREA) === currentRegion ? Math.min(d.count, (oldId % AREA) + 1) : d.count;
        transition = { start: now, from: camera(w, h, count), grow: true };
      }
      if (transition) {
        t = Math.min(1, Math.max(0, (now - transition.start) / 850));
        const e = 1 - Math.pow(1 - t, 3);
        cam = {};
        for (const k of ['x', 'y', 's']) cam[k] = transition.from[k] + (target[k] - transition.from[k]) * e;
      }
      currentCamera = cam;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(cam.s, cam.s);
      ctx.translate(-cam.x, -cam.y);
      const ordered = state.focus
        ? [active % AREA]
        : Array.from({ length: d.count }, (_, i) => i).sort((a, b) => lots[a][1] - lots[b][1]);
      for (const i of ordered) {
        const id = d.start + i,
          pos = lots[i],
          isActive = id === active,
          size = isActive ? local : STEP;
        const sx = (pos[0] - cam.x) * cam.s + w / 2,
          sy = (pos[1] - cam.y) * cam.s + h / 2;
        if (sx + 160 * cam.s < 0 || sx - 160 * cam.s > w || sy + 28 * cam.s < 0 || sy - 292 * cam.s > h)
          continue;
        const res = state.focus ? 480 : cam.s > 0.7 ? 320 : 160;
        ctx.save();
        ctx.translate(pos[0] - 160, pos[1] - 292);
        if (isActive && transition?.grow && t < 1) {
          const base = sprite(id, size, res, 'base'),
            last = sprite(id, size, res, 'last'),
            scale = 0.2 + 0.8 * (1 - Math.pow(1 - t, 3));
          ctx.drawImage(base.image, 0, 0, 320, 320);
          ctx.save();
          ctx.translate(last.anchor.x, last.anchor.y);
          ctx.scale(scale, scale);
          ctx.translate(-last.anchor.x, -last.anchor.y);
          ctx.drawImage(last.image, 0, 0, 320, 320);
          ctx.restore();
        } else ctx.drawImage(sprite(id, size, res).image, 0, 0, 320, 320);
        ctx.restore();
      }
      ctx.restore();
      frames++;
      if (transition && t >= 1) transition = null;
      if (isCompleted && !transition) {
        completedImage = makeCanvas(pw, ph);
        completedImage.getContext('2d').drawImage(canvas, 0, 0);
        completedKey = imageKey;
        completedPaints++;
      }
    }
    function tick(now) {
      raf = 0;
      if (disposed || !visible || document.hidden) {
        transition = null;
        return;
      }
      if (!host.isConnected) {
        destroy();
        return;
      }
      if (!transition || now - lastFrame >= 32) {
        draw(now);
        lastFrame = now;
      }
      if (transition) raf = requestAnimationFrame(tick);
    }
    function schedule() {
      if (!raf && visible && !document.hidden && !disposed) raf = requestAnimationFrame(tick);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      transition = null;
    }
    function render(animate) {
      const from = currentCamera,
        d = data();
      stop();
      records.clear(); // 前の表示の補助情報を保持し続けない（最大27本）。
      status.textContent =
        n === 0
          ? '小さな たねから はじまる'
          : !state.focus && d.region < growth.completed.length
            ? d.region + 1 + '番目の 森が できたよ（27本）'
          : active +
            1 +
            '本目の ' +
            NAMES[active % 5] +
            (local === STEP ? 'が 育ったよ' : local === 1 ? 'の 新芽が 出たよ' : 'が 育っているよ');
      const progress = host.querySelector('.forest-progress');
      progress.style.accentColor = root.TreePainter.COLORS[1]; // プログレスの色も葉の色の正本から
      progress.value = n - active * STEP;
      progress.hidden = !state.focus && d.region < growth.completed.length;
      focus.textContent = state.focus ? '森全体へ' : '育てている場所へ';
      focus.setAttribute('aria-pressed', String(state.focus));
      regions.hidden = state.focus || currentRegion === 0;
      previous.disabled = d.region === 0;
      next.disabled = d.region >= currentRegion;
      host.querySelector('.forest-region-name').textContent = d.region + 1 + '番目の森';
      canvas.setAttribute(
        'aria-label',
        n === 0
          ? '土からのぞく種'
          : state.focus
            ? NAMES[active % 5] + '一本、' + (active + 1) + '本目'
            : d.region + 1 + '番目の森、' + d.count + '本'
      );
      if (animate && from && !reduced.matches && visible && !document.hidden && (state.focus || d.region >= growth.completed.length))
        transition = { start: performance.now(), from, grow: false };
      schedule();
    }
    listen(focus, 'click', () => {
      state.focus = !state.focus;
      state.region = currentRegion;
      render(true);
    });
    listen(previous, 'click', () => {
      state.region = Math.max(0, state.region - 1);
      render(false);
    });
    listen(next, 'click', () => {
      state.region = Math.min(currentRegion, state.region + 1);
      render(false);
    });
    const resize = new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (
        canvas.width !== Math.round(canvas.clientWidth * dpr) ||
        canvas.height !== Math.round(canvas.clientHeight * dpr)
      ) {
        stop();
        schedule();
      }
    });
    resize.observe(canvas);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) schedule();
      else stop();
    });
    intersection.observe(host);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) stop();
      else schedule();
    });
    listen(reduced, 'change', () => {
      stop();
      schedule();
    });
    listen(window, 'pagehide', stop);
    listen(window, 'pageshow', schedule);
    function destroy() {
      if (disposed) return;
      stop();
      disposed = true;
      resize.disconnect();
      intersection.disconnect();
      abort.abort();
      background = null;
      completedImage = null;
      records.clear();
    }
    render(false);
    return {
      destroy,
      metrics: () => ({
        frames,
        cachePixels,
        cachedRecords: records.size,
        cachedImages: cache.size,
        visibleTrees: state.focus ? 1 : data().count,
        animating: !!transition,
        completedPaints,
        completedImagePixels: completedImage ? completedImage.width * completedImage.height : 0,
        disposed
      })
    };
  }
  root.Tree = { mount, STEP, AREA, NAMES };
})(typeof globalThis !== 'undefined' ? globalThis : this);

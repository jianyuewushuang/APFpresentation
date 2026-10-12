/* ============================================================
   js/field.js —— 势场可视化：平面热力图（含等势线）+ 三维势能曲面
   ------------------------------------------------------------
   约定（与主画布一致）：
     world → screen   X(x) = (x - v.x0)/(v.x1 - v.x0) * cw
                      Y(y) = ch - (y - v.y0)/(v.y1 - v.y0) * ch
   即绘图区铺满整张画布，热力图像素与叠加图层共用同一套映射，
   保证"颜色高点"与"禁飞区/起终点标记"完全对齐。
   ============================================================ */
(function (global) {
  'use strict';

  var A = global.APF;

  /* 蓝色渐变（白 → 深蓝） */
  var RAMP = [
    [0.00, [255, 255, 255]],
    [0.12, [232, 240, 253]],
    [0.30, [186, 211, 247]],
    [0.50, [124, 170, 236]],
    [0.70, [52, 122, 220]],
    [0.86, [11, 92, 213]],
    [1.00, [6, 40, 100]]
  ];

  function ramp(t) {
    var i;
    if (!(t > 0)) t = 0;
    if (t > 1) t = 1;
    for (i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        var a = RAMP[i - 1], b = RAMP[i];
        var u = (t - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * u),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * u),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * u)
        ];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }
  function css(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  /* ---------------- 势能计算 ---------------- */
  /* kind: 'att' 引力势 | 'rep' 斥力势 | 'total' 合成势 */
  function potentialAt(q, scene, p, kind) {
    if (kind === 'att') return A.potentialAtt(q, scene.goal, p);
    var rep = A.potentialRep(q, scene.goal, scene.obstacles, p);
    if (kind === 'rep') return rep;
    return A.potentialAtt(q, scene.goal, p) + rep;
  }

  /* 采样网格：val[j*W + i] 对应世界坐标 (x0+(i+.5)dx, y0+(j+.5)dy) */
  function sample(scene, p, kind, W, H, view) {
    var vals = new Float64Array(W * H);
    var dx = (view.x1 - view.x0) / W, dy = (view.y1 - view.y0) / H;
    var q = { x: 0, y: 0 }, idx = 0, i, j;
    for (j = 0; j < H; j++) {
      q.y = view.y0 + (j + 0.5) * dy;
      for (i = 0; i < W; i++) {
        q.x = view.x0 + (i + 0.5) * dx;
        var v = potentialAt(q, scene, p, kind);
        if (!isFinite(v) || v < 0) v = 0;
        vals[idx++] = v;
      }
    }
    return vals;
  }

  /* 归一化上界：用固定参考网格求全场最大值，
     使二维热力图与三维曲面共用同一个上界，色阶完全一致（与采样密度无关） */
  function fieldMax(scene, p, kind, view) {
    var W = 41, H = 29;
    var dx = (view.x1 - view.x0) / W, dy = (view.y1 - view.y0) / H;
    var q = { x: 0, y: 0 }, m = 0, i, j;
    for (j = 0; j < H; j++) {
      q.y = view.y0 + (j + 0.5) * dy;
      for (i = 0; i < W; i++) {
        q.x = view.x0 + (i + 0.5) * dx;
        var v = potentialAt(q, scene, p, kind);
        if (isFinite(v) && v > m) m = v;
      }
    }
    return m > 0 ? m : 1;
  }

  /* 势能动态范围极大（斥力接近禁飞区时可达 10⁶ 量级），需按场类型分别压缩：
       att  —— 量程平缓，用平方根压缩，保留"漏斗"曲率；
       rep / total —— 含 1/d² 奇点，用对数压缩，使影响半径 d_obs 内的渐变可见，
                      合成场里也不会被斥力量级淹没。 */
  function norm(v, vmax, kind) {
    if (!(v > 0)) return 0;
    var t;
    if (kind === 'att') {
      t = Math.sqrt(v / vmax);
    } else {
      var den = Math.log(1 + vmax);
      t = den > 0 ? Math.log(1 + v) / den : 0;
    }
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  /* ---------------- 等势线（Marching Squares） ---------------- */
  function strokeContours(ctx, g, W, H, X, Y, vx0, vy0, dx, dy, levels) {
    var li, j, i, lv, v00, v10, v11, v01, pxA, pxB, pyA, pyC, pts, t, c, lum;
    ctx.lineWidth = 1;
    for (li = 0; li < levels.length; li++) {
      lv = levels[li];
      /* 按该等势线所处底色明暗选择对比色，浅色区用深蓝、深色区用白色 */
      c = ramp(lv);
      lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
      ctx.strokeStyle = lum > 0.58 ? 'rgba(20,48,96,.42)' : 'rgba(255,255,255,.55)';
      ctx.beginPath();
      for (j = 0; j < H - 1; j++) {
        /* 注意：j 越大世界 y 越大 → 屏幕 y 越小，故 pyC < pyA */
        pyA = Y(vy0 + (j + 0.5) * dy);
        pyC = Y(vy0 + (j + 1.5) * dy);
        for (i = 0; i < W - 1; i++) {
          v00 = g[j * W + i];
          v10 = g[j * W + i + 1];
          v11 = g[(j + 1) * W + i + 1];
          v01 = g[(j + 1) * W + i];
          if ((v00 < lv) === (v10 < lv) && (v10 < lv) === (v11 < lv) && (v11 < lv) === (v01 < lv)) continue;
          pxA = X(vx0 + (i + 0.5) * dx);
          pxB = X(vx0 + (i + 1.5) * dx);
          pts = [];
          if ((v00 < lv) !== (v10 < lv)) { t = (lv - v00) / (v10 - v00); pts.push([pxA + (pxB - pxA) * t, pyA]); }
          if ((v10 < lv) !== (v11 < lv)) { t = (lv - v10) / (v11 - v10); pts.push([pxB, pyA + (pyC - pyA) * t]); }
          if ((v11 < lv) !== (v01 < lv)) { t = (lv - v11) / (v01 - v11); pts.push([pxB + (pxA - pxB) * t, pyC]); }
          if ((v01 < lv) !== (v00 < lv)) { t = (lv - v01) / (v00 - v01); pts.push([pxA, pyC + (pyA - pyC) * t]); }
          if (pts.length >= 2) {
            ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]);
            if (pts.length === 4) { ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); }
          }
        }
      }
      ctx.stroke();
    }
  }

  /* ---------------- 绘图区映射（铺满画布） ---------------- */
  function fitCanvas(canvas, ratio) {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth || 520;
    if (!cw) cw = canvas.parentNode.clientWidth - 24;
    var ch = Math.round(cw * ratio);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.height = ch + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    return { ctx: ctx, cw: cw, ch: ch };
  }

  function makeMap(cw, ch, view) {
    return {
      X: function (x) { return (x - view.x0) / (view.x1 - view.x0) * cw; },
      Y: function (y) { return ch - (y - view.y0) / (view.y1 - view.y0) * ch; }
    };
  }

  /* 禁飞区、起终点、坐标轴、色标（两个视图共用） */
  function overlayCommon(ctx, cw, ch, view, scene, MAP, opts) {
    var X = MAP.X, Y = MAP.Y, i, o, k;
    var span = Math.max(view.x1 - view.x0, view.y1 - view.y0);
    var step = span > 400 ? 100 : (span > 200 ? 50 : (span > 90 ? 20 : (span > 40 ? 10 : 5)));

    /* 坐标网格 */
    if (opts && opts.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,.42)';
      ctx.lineWidth = 1;
      for (k = Math.ceil(view.x0 / step) * step; k <= view.x1; k += step) {
        ctx.beginPath(); ctx.moveTo(X(k), 0); ctx.lineTo(X(k), ch); ctx.stroke();
      }
      for (k = Math.ceil(view.y0 / step) * step; k <= view.y1; k += step) {
        ctx.beginPath(); ctx.moveTo(0, Y(k)); ctx.lineTo(cw, Y(k)); ctx.stroke();
      }
    }

    /* 斥力影响范围（软约束）—— 斥力只在此圆内起作用 */
    if (opts && opts.influence) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(11,92,213,.55)';
      ctx.lineWidth = 1;
      for (i = 0; i < scene.obstacles.length; i++) {
        o = scene.obstacles[i];
        ctx.beginPath();
        ctx.arc(X(o.x), Y(o.y), Math.abs(X(o.x + opts.dObs) - X(o.x)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 禁飞区（硬约束） */
    for (i = 0; i < scene.obstacles.length; i++) {
      o = scene.obstacles[i];
      ctx.beginPath();
      ctx.arc(X(o.x), Y(o.y), Math.abs(X(o.x + o.r) - X(o.x)), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(201,42,42,.10)';
      ctx.fill();
      ctx.strokeStyle = '#c92a2a';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    /* 起点 / 目标 */
    ctx.fillStyle = '#17794a';
    ctx.beginPath();
    ctx.moveTo(X(scene.start.x), Y(scene.start.y) - 6);
    ctx.lineTo(X(scene.start.x) + 6, Y(scene.start.y));
    ctx.lineTo(X(scene.start.x), Y(scene.start.y) + 6);
    ctx.lineTo(X(scene.start.x) - 6, Y(scene.start.y));
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = '#c92a2a'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(X(scene.goal.x) - 7, Y(scene.goal.y)); ctx.lineTo(X(scene.goal.x) + 7, Y(scene.goal.y));
    ctx.moveTo(X(scene.goal.x), Y(scene.goal.y) - 7); ctx.lineTo(X(scene.goal.x), Y(scene.goal.y) + 7);
    ctx.stroke();

    /* 坐标标注 */
    ctx.fillStyle = '#5a636e';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('y/km', 6, 18);
    ctx.fillText('x/km', cw - 40, ch - 6);
  }

  /* ---------------- ① 平面热力图 ---------------- */
  function render2D(canvas, view, scene, p, kind) {
    var W = 200, H = 144;
    var s = sample(scene, p, kind, W, H, view);
    var vmax = fieldMax(scene, p, kind, view);
    var f = fitCanvas(canvas, 0.72);
    var ctx = f.ctx, cw = f.cw, ch = f.ch;
    var MAP = makeMap(cw, ch, view);
    var dx = (view.x1 - view.x0) / W, dy = (view.y1 - view.y0) / H;

    /* 归一化网格 */
    var g = new Float64Array(W * H);
    for (var n = 0; n < W * H; n++) g[n] = norm(s[n], vmax, kind);

    /* 像素图：注意第 0 行必须是屏幕最上方 = 世界 y 最大值 */
    var off = document.createElement('canvas');
    off.width = W; off.height = H;
    var octx = off.getContext('2d');
    var img = octx.createImageData(W, H);
    for (var j = 0; j < H; j++) {
      var row = (H - 1 - j) * W;          /* 上下翻转，使 y 大者在画布上方 */
      for (var i = 0; i < W; i++) {
        var c = ramp(g[row + i]);
        var o = (j * W + i) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, cw, ch);

    /* 等势线：与热力图使用同一套归一化值，故线一定落在同色区间上 */
    var levels = [0.14, 0.28, 0.42, 0.56, 0.70, 0.82, 0.92];
    strokeContours(ctx, g, W, H, MAP.X, MAP.Y, view.x0, view.y0, dx, dy, levels);

    overlayCommon(ctx, cw, ch, view, scene, MAP, { grid: true, influence: kind !== 'att', dObs: p.dObs });

    /* 色标 */
    var barW = 132, barH = 8, bx = cw - barW - 14, by = ch - 30;
    for (var b = 0; b < barW; b++) {
      ctx.fillStyle = css(ramp(b / barW));
      ctx.fillRect(bx + b, by, 1, barH);
    }
    ctx.strokeStyle = 'rgba(17,20,23,.35)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, barW, barH);
    ctx.fillStyle = '#5a636e'; ctx.font = '10px Consolas, monospace';
    ctx.fillText('低', bx - 14, by + 8);
    ctx.fillText('高', bx + barW + 3, by + 8);
  }

  /* ---------------- ② 三维势能曲面 ---------------- */
  function render3D(canvas, view, scene, p, kind) {
    var N = 34;
    var s = sample(scene, p, kind, N, N, view);
    var vmax = fieldMax(scene, p, kind, view);
    var f = fitCanvas(canvas, 0.72);
    var ctx = f.ctx, cw = f.cw, ch = f.ch;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);

    /* 归一化高度 z ∈ [0,1] */
    var z = new Float64Array(N * N);
    var zmin = Infinity, zmax = -Infinity, i, j2;
    for (i = 0; i < N * N; i++) {
      var t = norm(s[i], vmax, kind);
      z[i] = t;
      if (t < zmin) zmin = t;
      if (t > zmax) zmax = t;
    }
    var span = Math.max(zmax - zmin, 1e-6);
    for (i = 0; i < N * N; i++) z[i] = (z[i] - zmin) / span;

    /* 等轴投影参数自适应：保证最高峰与最近角都落在画布内 */
    var ax = cw * 0.94 / (2 * N);
    var ay = ax * 0.42;
    var baseH = (2 * N - 2) * ay;
    var az = Math.max(50, Math.min(ch * 0.55, ch - 20 - baseH));
    var oy = ch - 10 - baseH;
    var ox = cw / 2;

    function PX(ii, jj) { return ox + (ii - jj) * ax; }
    function PY(ii, jj, zz) { return oy + (ii + jj) * ay - zz * az; }

    /* 画家算法：i+j 由小到大 = 由远及近 */
    var quads = [];
    for (i = 0; i < N - 1; i++) {
      for (j2 = 0; j2 < N - 1; j2++) {
        quads.push({
          i: i, j: j2,
          z: (z[i * N + j2] + z[(i + 1) * N + j2] + z[i * N + j2 + 1] + z[(i + 1) * N + j2 + 1]) / 4
        });
      }
    }
    quads.sort(function (a, b) { return (a.i + a.j) - (b.i + b.j); });

    ctx.lineWidth = 0.6;
    for (var q = 0; q < quads.length; q++) {
      var qi = quads[q].i, qj = quads[q].j, qz = quads[q].z;
      var p00 = [PX(qi, qj), PY(qi, qj, z[qi * N + qj])];
      var p10 = [PX(qi + 1, qj), PY(qi + 1, qj, z[(qi + 1) * N + qj])];
      var p11 = [PX(qi + 1, qj + 1), PY(qi + 1, qj + 1, z[(qi + 1) * N + qj + 1])];
      var p01 = [PX(qi, qj + 1), PY(qi, qj + 1, z[qi * N + qj + 1])];
      ctx.beginPath();
      ctx.moveTo(p00[0], p00[1]);
      ctx.lineTo(p10[0], p10[1]);
      ctx.lineTo(p11[0], p11[1]);
      ctx.lineTo(p01[0], p01[1]);
      ctx.closePath();
      ctx.fillStyle = css(ramp(qz * 0.94));
      ctx.fill();
      ctx.strokeStyle = 'rgba(11,92,213,.30)';
      ctx.stroke();
    }

    /* 禁飞区与目标在底面的投影（虚线轮廓） */
    ctx.setLineDash([3, 3]);
    for (i = 0; i < scene.obstacles.length; i++) {
      var o = scene.obstacles[i];
      var gi = (o.x - view.x0) / (view.x1 - view.x0) * N;
      var gj = (o.y - view.y0) / (view.y1 - view.y0) * N;
      var rr = Math.max(5, (o.r / (view.x1 - view.x0) * N) * ax * 1.2);
      ctx.beginPath();
      ctx.ellipse(PX(gi, gj), PY(gi, gj, 0), rr, rr * 0.45, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(201,42,42,.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    var ggi = (scene.goal.x - view.x0) / (view.x1 - view.x0) * N;
    var ggj = (scene.goal.y - view.y0) / (view.y1 - view.y0) * N;
    ctx.strokeStyle = 'rgba(23,121,74,.95)';
    ctx.beginPath();
    ctx.ellipse(PX(ggi, ggj), PY(ggi, ggj, 0), 6, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    /* 标注 */
    ctx.fillStyle = '#737d89';
    ctx.font = '10.5px Consolas, monospace';
    ctx.fillText('纵轴：势能 U（归一化，0 = 最低）', 10, 16);
    ctx.fillText('底面：x / y (km)，红色虚线圈 = 禁飞区', 10, 30);
  }

  global.APFField = {
    render2D: render2D,
    render3D: render3D,
    potentialAt: potentialAt,
    norm: norm,
    ramp: ramp,
    css: css
  };

})(window);

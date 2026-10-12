/* ============================================================
   js/field.js —— 势场可视化：平面热力图 + 三维势能曲面
   ============================================================ */
(function (global) {
  'use strict';

  var A = global.APF;

  /* 蓝色渐变（白 → 深蓝） */
  var RAMP = [
    [0.00, [255, 255, 255]],
    [0.16, [226, 236, 252]],
    [0.38, [163, 195, 244]],
    [0.62, [74, 137, 224]],
    [0.82, [11, 92, 213]],
    [1.00, [6, 40, 100]]
  ];

  function ramp(t) {
    var i;
    if (t < 0) t = 0; if (t > 1) t = 1;
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

  /* 计算某点的势能值 */
  function potentialAt(q, scene, p, kind) {
    var att = A.potentialAtt(q, scene.goal, p);
    if (kind === 'att') return att;
    var rep = A.potentialRep(q, scene.goal, scene.obstacles, p);
    if (kind === 'rep') return rep;
    return att + rep;
  }

  /* 采样一个网格，返回 {val, vmax} */
  function sample(scene, p, kind, W, H, view) {
    var vals = new Float64Array(W * H), i, j, idx = 0;
    var dx = (view.x1 - view.x0) / W, dy = (view.y1 - view.y0) / H;
    var q = { x: 0, y: 0 };
    var finite = [];
    for (j = 0; j < H; j++) {
      q.y = view.y0 + (j + 0.5) * dy;
      for (i = 0; i < W; i++) {
        q.x = view.x0 + (i + 0.5) * dx;
        var v = potentialAt(q, scene, p, kind);
        if (!isFinite(v) || v < 0) v = 0;
        vals[idx++] = v;
        if (v > 0 && v < 1e7) finite.push(v);
      }
    }
    finite.sort(function (a, b) { return a - b; });
    var vmax = finite.length ? finite[Math.floor(finite.length * 0.94)] : 1;
    if (!(vmax > 0)) vmax = 1;
    return { vals: vals, vmax: vmax };
  }

  /* 归一化：对数压缩，突出低势能区域的形状 */
  function norm(v, vmax) {
    if (v <= 0) return 0;
    var t = Math.log(1 + v / vmax * 9) / Math.log(10);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  /* ---------------- 平面热力图 ---------------- */
  function render2D(canvas, view, scene, p, kind) {
    var W = 190, H = 132;
    var s = sample(scene, p, kind, W, H, view);
    var off = document.createElement('canvas');
    off.width = W; off.height = H;
    var octx = off.getContext('2d');
    var img = octx.createImageData(W, H);
    for (var i = 0; i < W * H; i++) {
      var c = ramp(norm(s.vals[i], s.vmax));
      var o = i * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth || 520, ch = Math.round(cw * 0.70);
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.height = ch + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, cw, ch);

    var pad = 26;
    var iw = cw - pad - 12, ih = ch - pad - 12;
    function X(x) { return pad + (x - view.x0) / (view.x1 - view.x0) * iw; }
    function Y(y) { return ch - 12 - (y - view.y0) / (view.y1 - view.y0) * ih; }

    /* 禁飞区 */
    ctx.lineWidth = 1.2;
    for (var k = 0; k < scene.obstacles.length; k++) {
      var o = scene.obstacles[k];
      ctx.beginPath();
      ctx.arc(X(o.x), Y(o.y), Math.abs(X(o.x + o.r) - X(o.x)), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(201,42,42,.14)';
      ctx.fill();
      ctx.strokeStyle = '#c92a2a';
      ctx.stroke();
    }

    /* 起终点 */
    ctx.fillStyle = '#17794a';
    ctx.fillRect(X(scene.start.x) - 3.5, Y(scene.start.y) - 3.5, 7, 7);
    ctx.strokeStyle = '#c92a2a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(scene.goal.x) - 5, Y(scene.goal.y)); ctx.lineTo(X(scene.goal.x) + 5, Y(scene.goal.y));
    ctx.moveTo(X(scene.goal.x), Y(scene.goal.y) - 5); ctx.lineTo(X(scene.goal.x), Y(scene.goal.y) + 5);
    ctx.stroke();

    /* 坐标轴 */
    ctx.strokeStyle = '#111417'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(cw - 12, Y(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, ch - 12); ctx.lineTo(pad, 12); ctx.stroke();
    ctx.fillStyle = '#737d89'; ctx.font = '10px Consolas, monospace';
    ctx.fillText('x/km ' + Math.round(view.x1), cw - 74, Y(0) - 5);
    ctx.fillText('y/km', pad - 20, 20);

    /* 色标 */
    var barW = 130, barH = 8, bx = cw - barW - 14, by = ch - 11;
    for (var b = 0; b < barW; b++) {
      ctx.fillStyle = css(ramp(b / barW));
      ctx.fillRect(bx + b, by, 1, barH);
    }
    ctx.strokeStyle = '#d3d8df'; ctx.strokeRect(bx, by, barW, barH);
    ctx.fillStyle = '#737d89'; ctx.font = '10px Consolas, monospace';
    ctx.fillText('低', bx - 14, by + 8);
    ctx.fillText('高', bx + barW + 3, by + 8);
  }

  /* ---------------- 三维势能曲面 ---------------- */
  function render3D(canvas, view, scene, p, kind) {
    var N = 34;
    var s = sample(scene, p, kind, N, N, view);

    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth || 520, ch = Math.round(cw * 0.70);
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.height = ch + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);

    /* 归一化高度 */
    var z = new Float64Array(N * N);
    var zmin = Infinity, zmax = -Infinity, i, j;
    for (i = 0; i < N * N; i++) {
      var t = norm(s.vals[i], s.vmax);
      z[i] = t;
      if (t < zmin) zmin = t;
      if (t > zmax) zmax = t;
    }
    var span = Math.max(zmax - zmin, 1e-6);
    for (i = 0; i < N * N; i++) z[i] = (z[i] - zmin) / span;

    var ox = cw / 2, oy = ch * 0.24;
    var ax = cw / (2 * N) * 0.92;
    var ay = ax * 0.52;
    var az = ch * 0.60;

    function PX(ii, jj, zz) { return ox + (ii - jj) * ax; }
    function PY(ii, jj, zz) { return oy + (ii + jj) * ay - zz * az; }

    /* 画家算法：按 i+j 从远到近绘制 */
    var quads = [];
    for (i = 0; i < N - 1; i++) {
      for (j = 0; j < N - 1; j++) {
        var zz = (z[i * N + j] + z[(i + 1) * N + j] + z[i * N + j + 1] + z[(i + 1) * N + j + 1]) / 4;
        quads.push({ i: i, j: j, z: zz });
      }
    }
    quads.sort(function (a, b) { return (a.i + a.j) - (b.i + b.j); });

    ctx.lineWidth = 0.5;
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
      var c = ramp(0.28 + qz * 0.72);
      ctx.fillStyle = css(c);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.72)';
      ctx.stroke();
    }

    /* 底座投影：障碍物位置 */
    ctx.strokeStyle = '#c92a2a'; ctx.fillStyle = 'rgba(201,42,42,.10)'; ctx.lineWidth = 1;
    for (var k = 0; k < scene.obstacles.length; k++) {
      var o = scene.obstacles[k];
      var gi = (o.x - view.x0) / (view.x1 - view.x0) * N;
      var gj = (o.y - view.y0) / (view.y1 - view.y0) * N;
      var cx = PX(gi, gj), cy = PY(gi, gj, 0);
      var rr = Math.max(3, (o.r / (view.x1 - view.x0) * N) * ax * 1.1);
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.5, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    /* 目标点投影（势能最低点） */
    var ggi = (scene.goal.x - view.x0) / (view.x1 - view.x0) * N;
    var ggj = (scene.goal.y - view.y0) / (view.y1 - view.y0) * N;
    ctx.fillStyle = '#17794a';
    ctx.beginPath();
    ctx.arc(PX(ggi, ggj), PY(ggi, ggj, 0), 3.5, 0, Math.PI * 2);
    ctx.fill();

    /* 说明 */
    ctx.fillStyle = '#737d89'; ctx.font = '10.5px Consolas, monospace';
    ctx.fillText('纵轴：势能 U（归一化）', 12, 16);
    ctx.fillText('横轴：x / y (km)', 12, 30);
  }

  global.APFField = { render2D: render2D, render3D: render3D, ramp: ramp, css: css };

})(window);

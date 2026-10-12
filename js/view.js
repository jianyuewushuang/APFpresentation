/* ============================================================
   js/view.js —— 主画布：渲染 + 鼠标交互
   ============================================================ */
(function (global) {
  'use strict';

  var A = global.APF;
  var CH_RATIO = 0.72;
  var ASPECT = 1 / CH_RATIO;

  function View(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = null;
    this.result = null;
    this.view = null;
    this.progress = 0;
    this.opts = { vec: false, influence: true, force: true, grid: true, field: false };
    this.fieldKind = 'total';      // 叠加到仿真台上的势场类型：att | rep | total
    this.params = null;            // 当前参数（由 setResult 注入），用于生成热力图
    this._field = null;            // 热力图离屏缓存
    this._fieldKey = '';
    this._fieldT = 0;
    this.addMode = false;
    this.drag = null;
    this.onChange = null;
    this.onHover = null;
    this._bind();
  }

  /* ---------- 坐标换算 ---------- */
  View.prototype._scale = function () {
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    var v = this.view;
    return { cw: cw, ch: ch, sx: cw / (v.x1 - v.x0), sy: ch / (v.y1 - v.y0) };
  };
  View.prototype.X = function (x) { var s = this._scale(); return (x - this.view.x0) * s.sx; };
  View.prototype.Y = function (y) { var s = this._scale(); return s.ch - (y - this.view.y0) * s.sy; };
  View.prototype.toWorld = function (px, py) {
    var s = this._scale();
    return { x: this.view.x0 + px / s.sx, y: this.view.y0 + (s.ch - py) / s.sy };
  };

  View.prototype.resize = function () {
    if (!this.scene) return;
    this.setResult(this.result, true, this.progress);
  };

  View.prototype.setScene = function (scene) {
    this.scene = scene;
    this.result = null;
    this.view = A.computeView(scene, null, ASPECT);
    this.progress = 0;
    this.fitCanvas();
    this.draw();
  };

  /* keepView=true 时保持当前视野（拖动/调参时不跳动）；progress 为 null 则跳到终点 */
  View.prototype.setResult = function (result, keepView, progress) {
    this.result = result;
    if (result) { this.scene = result.scene; this.params = result.params; }
    if (!keepView) this.view = A.computeView(this.scene, result, ASPECT);
    this.fitCanvas();
    var last = result ? result.frames.length - 1 : 0;
    if (progress === null || progress === undefined) this.progress = last;
    else this.progress = Math.max(0, Math.min(progress, last));
    this.draw();
  };

  View.prototype.fitCanvas = function () {
    var dpr = window.devicePixelRatio || 1;
    var cw = this.canvas.parentNode.clientWidth - 20;
    if (cw < 200) cw = 200;
    var ch = Math.round(cw * CH_RATIO);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  View.prototype.setProgress = function (n) {
    if (!this.result) { this.progress = 0; return; }
    this.progress = Math.max(0, Math.min(n, this.result.frames.length - 1));
  };

  /* ---------- 势场热力图叠加（离屏缓存，避免动画时每帧重算） ---------- */
  View.prototype.fieldKey = function () {
    if (!this.scene || !this.params || !this.view) return '';
    var s = this.scene, p = this.params, v = this.view;
    var parts = [this.fieldKind, p.kAtt, p.dT, p.kRep, p.dObs, p.n, p.mode,
      v.x0.toFixed(2), v.x1.toFixed(2), v.y0.toFixed(2), v.y1.toFixed(2),
      s.start.x.toFixed(1), s.start.y.toFixed(1), s.goal.x.toFixed(1), s.goal.y.toFixed(1)];
    for (var i = 0; i < s.obstacles.length; i++) {
      parts.push(s.obstacles[i].x.toFixed(1), s.obstacles[i].y.toFixed(1), s.obstacles[i].r.toFixed(1));
    }
    return parts.join('|');
  };

  View.prototype.drawField = function () {
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    var key = this.fieldKey();
    if (!key) return;
    var F = global.APFField, self = this;
    /* 拖动/调参时限制重建频率：先沿用旧图，过 100 ms 再刷新；
       节流期内另排一次延时重绘，保证松手后画面一定是最新的 */
    if (key !== this._fieldKey) {
      if (!this._field || (Date.now() - this._fieldT) > 100) {
        this._field = F.buildHeatmap(this.view, this.scene, this.params, this.fieldKind, 220, 152);
        this._fieldKey = key;
        this._fieldT = Date.now();
      } else {
        if (this._fieldTimer) clearTimeout(this._fieldTimer);
        this._fieldTimer = setTimeout(function () { self.draw(); }, 130);
      }
    }
    var ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.globalAlpha = 0.7;          /* 作为底图时降低浓度，保持整页"白底 + 蓝色点缀"的观感 */
    ctx.drawImage(this._field.canvas, 0, 0, cw, ch);
    ctx.restore();
  };

  /* ---------- 绘制 ---------- */
  View.prototype.draw = function () {
    if (!this.scene || !this.view) return;
    var ctx = this.ctx, self = this;
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    var v = this.view;
    var onField = this.opts.field && !!this.params;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);

    /* 势场热力图（最底层） */
    if (onField) this.drawField();

    var span = Math.max(v.x1 - v.x0, v.y1 - v.y0);
    var step = span > 400 ? 100 : (span > 200 ? 50 : (span > 90 ? 20 : (span > 40 ? 10 : 5)));

    /* 网格 */
    if (this.opts.grid) {
      ctx.strokeStyle = onField ? 'rgba(255,255,255,.45)' : '#eef1f5'; ctx.lineWidth = 1;
      var gx = Math.ceil(v.x0 / step) * step;
      for (; gx <= v.x1; gx += step) {
        ctx.beginPath(); ctx.moveTo(this.X(gx), 0); ctx.lineTo(this.X(gx), ch); ctx.stroke();
      }
      var gy = Math.ceil(v.y0 / step) * step;
      for (; gy <= v.y1; gy += step) {
        ctx.beginPath(); ctx.moveTo(0, this.Y(gy)); ctx.lineTo(cw, this.Y(gy)); ctx.stroke();
      }
      ctx.strokeStyle = onField ? 'rgba(255,255,255,.70)' : '#d3d8df';
      if (v.y0 < 0 && v.y1 > 0) { ctx.beginPath(); ctx.moveTo(0, this.Y(0)); ctx.lineTo(cw, this.Y(0)); ctx.stroke(); }
      if (v.x0 < 0 && v.x1 > 0) { ctx.beginPath(); ctx.moveTo(this.X(0), 0); ctx.lineTo(this.X(0), ch); ctx.stroke(); }
      ctx.font = '10px Consolas, monospace';
      /* 叠加热力图时给刻度加白色描边，保证深浅背景上都看得清 */
      if (onField) { ctx.save(); ctx.shadowColor = 'rgba(255,255,255,.95)'; ctx.shadowBlur = 4; }
      ctx.fillStyle = onField ? '#1b2430' : '#98a2ad';
      for (gx = Math.ceil(v.x0 / step) * step; gx <= v.x1; gx += step) ctx.fillText(gx + '', this.X(gx) + 3, ch - 5);
      for (gy = Math.ceil(v.y0 / step) * step; gy <= v.y1; gy += step) {
        if (!(v.y0 < 0 && v.y1 > 0 && Math.abs(gy) < step * 0.5)) ctx.fillText(gy + '', 4, this.Y(gy) - 3);
      }
      ctx.fillStyle = onField ? '#1b2430' : '#5a636e';
      ctx.fillText('y/km', 4, 13);
      ctx.fillText('x/km', cw - 34, ch - 5);
      if (onField) ctx.restore();
    }

    /* 斥力影响范围 */
    if (this.opts.influence && this.scene.obstacles.length) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = onField ? 'rgba(20,45,90,.6)' : '#9dbdf0';
      ctx.lineWidth = 1;
      /* 底色明暗跨度大，加白色描边保证虚线在任何区域都看得见 */
      if (onField) { ctx.shadowColor = 'rgba(255,255,255,.95)'; ctx.shadowBlur = 3; }
      for (var i = 0; i < this.scene.obstacles.length; i++) {
        var o = this.scene.obstacles[i];
        var p = this.result && this.result.moving ? this.result.obsFrames[this.progress][i] : o;
        var rr = (this.result ? this.result.params.dObs : 30);
        ctx.beginPath();
        ctx.arc(this.X(p.x), this.Y(p.y), Math.abs(this.X(p.x + rr) - this.X(p.x)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 势场力矢量网格 */
    if (this.opts.vec) this.drawVectorField();

    /* 障碍物 */
    for (var k = 0; k < this.scene.obstacles.length; k++) {
      var ob = this.scene.obstacles[k];
      var pos = this.result && this.result.moving ? this.result.obsFrames[this.progress][k] : ob;
      var px = this.X(pos.x), py = this.Y(pos.y), pr = Math.abs(this.X(pos.x + pos.r) - this.X(pos.x));
      /* 禁飞区全透明，只画轮廓（不遮挡背后的势场与航路） */
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.strokeStyle = onField ? '#c92a2a' : '#0b5cd5'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = onField ? '#c92a2a' : '#0b5cd5'; ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillText('#' + (k + 1), px - 7, py + 3.5);
      /* 半径手柄 */
      ctx.strokeStyle = '#0b5cd5'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(px + pr, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    /* 航路 */
    if (this.result) {
      var fr = this.result.frames;
      var n = Math.min(this.progress, fr.length - 1);
      if (n > 0) {
        ctx.lineWidth = 2.4; ctx.strokeStyle = '#c92a2a'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(this.X(fr[0].x), this.Y(fr[0].y));
        for (var m = 1; m <= n; m++) ctx.lineTo(this.X(fr[m].x), this.Y(fr[m].y));
        ctx.stroke();
        /* 逃逸段标记 */
        ctx.fillStyle = '#a35d00';
        for (m = 0; m <= n; m++) {
          if (fr[m].esc) ctx.fillRect(this.X(fr[m].x) - 1, this.Y(fr[m].y) - 1, 2, 2);
        }
      }

      /* 当前步受力 */
      var cur = fr[n];
      if (this.opts.force && n > 0) {
        this.arrow(cur.x, cur.y, cur.fa, '#0b5cd5', 'F_att');
        this.arrow(cur.x, cur.y, cur.fr, '#e08a1e', 'F_rep');
        this.arrow(cur.x, cur.y, cur.ft, '#111417', 'F');
      }

      /* 无人机 */
      var dx = this.X(cur.x), dy = this.Y(cur.y);
      ctx.fillStyle = '#0b5cd5'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx, dy - 7); ctx.lineTo(dx + 7, dy); ctx.lineTo(dx, dy + 7); ctx.lineTo(dx - 7, dy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    /* 起点 / 目标 */
    var sp = this.scene.start, gp = this.scene.goal;
    ctx.fillStyle = '#17794a';
    ctx.beginPath();
    ctx.moveTo(this.X(sp.x), this.Y(sp.y) - 7); ctx.lineTo(this.X(sp.x) + 7, this.Y(sp.y));
    ctx.lineTo(this.X(sp.x), this.Y(sp.y) + 7); ctx.lineTo(this.X(sp.x) - 7, this.Y(sp.y));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#17794a'; ctx.font = 'bold 10.5px "Microsoft YaHei"';
    ctx.fillText('起点', this.X(sp.x) + 10, this.Y(sp.y) + 4);

    var gx2 = this.X(gp.x), gy2 = this.Y(gp.y);
    ctx.strokeStyle = '#c92a2a'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(gx2 - 8, gy2); ctx.lineTo(gx2 + 8, gy2);
    ctx.moveTo(gx2, gy2 - 8); ctx.lineTo(gx2, gy2 + 8);
    ctx.stroke();
    ctx.fillStyle = '#c92a2a'; ctx.font = 'bold 10.5px "Microsoft YaHei"';
    ctx.fillText('目标', gx2 + 11, gy2 + 4);

    /* HUD */
    var hud = [];
    if (this.result) {
      hud.push(['步数 k', this.progress + ' / ' + this.result.iters]);
      hud.push(['航路长度', this.result.length.toFixed(2) + ' km']);
      hud.push(['最小安全间隔', this.result.minGap === null ? '—' : this.result.minGap.toFixed(2) + ' km']);
      var st = this.result.reached ? '已抵达目标' : (this.result.stalled ? '停滞（局部极小）' : '未抵达');
      hud.push(['规划结果', st]);
    }
    ctx.font = '11px Consolas, monospace';
    var bx = 8, by = 9;
    for (var h = 0; h < hud.length; h++) {
      var txt = hud[h][0] + '：' + hud[h][1];
      var w = ctx.measureText(txt).width + 12;
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(bx, by, w, 17);
      ctx.strokeStyle = '#e7eaee'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, w, 17);
      ctx.fillStyle = h === 3 && this.result && !this.result.reached && this.result.stalled ? '#c92a2a' : '#3d444d';
      ctx.fillText(txt, bx + 6, by + 12.5);
      by += 19;
    }
  };

  View.prototype.arrow = function (wx, wy, f, color, label) {
    var mag = A.hypot(f.x, f.y);
    if (mag < 1e-9) return;
    var L = 10 + Math.min(46, Math.log10(1 + mag) * 16);
    var x0 = this.X(wx), y0 = this.Y(wy);
    var ux = f.x / mag, uy = -f.y / mag;
    var x1 = x0 + ux * L, y1 = y0 + uy * L;
    var ctx = this.ctx;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * 7 - uy * 3.6, y1 - uy * 7 + ux * 3.6);
    ctx.lineTo(x1 - ux * 7 + uy * 3.6, y1 - uy * 7 - ux * 3.6);
    ctx.closePath(); ctx.fill();
    if (label) {
      ctx.font = '10px Consolas, monospace';
      ctx.fillText(label, x1 + ux * 4 + 2, y1 + uy * 4 + 3);
    }
  };

  View.prototype.drawVectorField = function () {
    var ctx = this.ctx, cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    var p = this.result ? this.result.params : global.APF_CFG.DEFAULTS;
    var obs = this.result && this.result.moving ? this.result.obsFrames[this.progress] : this.scene.obstacles;
    var cols = 15, rows = 11;
    ctx.lineWidth = 1;
    for (var i = 0; i < cols; i++) {
      for (var j = 0; j < rows; j++) {
        var wx = this.view.x0 + (i + 0.5) / cols * (this.view.x1 - this.view.x0);
        var wy = this.view.y0 + (j + 0.5) / rows * (this.view.y1 - this.view.y0);
        var inObs = false;
        for (var k = 0; k < obs.length; k++) {
          if (A.hypot(wx - obs[k].x, wy - obs[k].y) < obs[k].r) inObs = true;
        }
        if (inObs) continue;
        var q = { x: wx, y: wy };
        var fa = A.attractionForce(q, this.scene.goal, p);
        var frep = A.repulsionForce(q, this.scene.goal, obs, p);
        var fx = fa.x + frep.x, fy = fa.y + frep.y;
        var mag = A.hypot(fx, fy);
        if (mag < 1e-9) continue;
        var L = 3 + Math.min(11, Math.log10(1 + mag) * 4);
        var x0 = this.X(wx), y0 = this.Y(wy);
        var ux = fx / mag, uy = -fy / mag;
        var x1 = x0 + ux * L, y1 = y0 + uy * L;
        var col = this.opts.field ? 'rgba(17,20,23,.50)' : 'rgba(11,92,213,.45)';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x0 - ux * L * 0.5, y0 - uy * L * 0.5); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * 3.4 - uy * 1.8, y1 - uy * 3.4 + ux * 1.8);
        ctx.lineTo(x1 - ux * 3.4 + uy * 1.8, y1 - uy * 3.4 - ux * 1.8);
        ctx.closePath(); ctx.fill();
      }
    }
  };

  /* ---------- 交互 ---------- */
  View.prototype._bind = function () {
    var self = this, cv = this.canvas;
    var dragging = false;

    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left, y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top };
    }

    function pick(p) {
      if (!self.scene) return null;
      var w = self.toWorld(p.x, p.y);
      var i, o, d, s = self._scale();
      /* 起点 / 目标 */
      d = A.hypot(w.x - self.scene.goal.x, w.y - self.scene.goal.y);
      if (d * s.sx < 11) return { type: 'goal' };
      d = A.hypot(w.x - self.scene.start.x, w.y - self.scene.start.y);
      if (d * s.sx < 11) return { type: 'start' };
      /* 障碍：半径手柄 → 移动 */
      for (i = 0; i < self.scene.obstacles.length; i++) {
        o = self.scene.obstacles[i];
        var pos0 = self.result && self.result.moving ? self.result.obsFrames[self.progress][i] : o;
        d = A.hypot(w.x - pos0.x, w.y - pos0.y);
        if (Math.abs(d - o.r) * s.sx < 9) return { type: 'radius', i: i };
        if (d < o.r) return { type: 'obstacle', i: i };
      }
      return { type: 'empty', world: w };
    }

    cv.addEventListener('mousedown', function (e) {
      var p = pos(e), hit = pick(p);
      if (!hit) return;
      if (self.addMode && (hit.type === 'empty')) {
        self.scene.obstacles.push({ x: +hit.world.x.toFixed(1), y: +hit.world.y.toFixed(1), r: 12 });
        self.addMode = false;
        if (self.onAdd) self.onAdd();
        return;
      }
      if (hit.type === 'empty') return;
      self.drag = hit;
      dragging = true;
      cv.classList.add('moving');
      e.preventDefault();
    });

    cv.addEventListener('mousemove', function (e) {
      var p = pos(e);
      if (!dragging) {
        var hit = pick(p);
        cv.className = (self.addMode ? 'grab' : (hit && hit.type !== 'empty' ? 'grab' : ''));
        return;
      }
      var w = self.toWorld(p.x, p.y);
      var d = self.drag;
      if (d.type === 'start') { self.scene.start.x = w.x; self.scene.start.y = w.y; }
      else if (d.type === 'goal') { self.scene.goal.x = w.x; self.scene.goal.y = w.y; }
      else if (d.type === 'obstacle') {
        var o = self.scene.obstacles[d.i];
        o.x = w.x; o.y = w.y;
        if (o.vx || o.vy) { o.vx = 0; o.vy = 0; }
      } else if (d.type === 'radius') {
        var o2 = self.scene.obstacles[d.i];
        o2.r = Math.max(2, Math.min(60, A.hypot(w.x - o2.x, w.y - o2.y)));
      }
      if (self.onDrag) self.onDrag(d);
      e.preventDefault();
    });

    function up() {
      if (!dragging) return;
      dragging = false;
      self.drag = null;
      cv.classList.remove('moving');
      if (self.onDragEnd) self.onDragEnd();
    }
    cv.addEventListener('mouseup', up);
    cv.addEventListener('mouseleave', up);
  };

  global.APFView = View;

})(window);

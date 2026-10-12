/* ============================================================
   js/app.js —— 界面主控：参数绑定、动画、缺陷卡片、势场刷新
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.APF_CFG, A = global.APF, F = global.APFField;

  var state = {
    scene: null,
    result: null,
    fieldKind: 'att',
    playing: false
  };

  var view = null;
  var els = {};
  var anim = { last: 0, acc: 0 };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function fmt(v, n) { return (v === null || v === undefined) ? '—' : v.toFixed(n === undefined ? 2 : n); }

  /* ================= 场景 ================= */
  function cloneScene(s) {
    return {
      title: s.title,
      start: { x: s.start.x, y: s.start.y },
      goal: { x: s.goal.x, y: s.goal.y },
      obstacles: (s.obstacles || []).map(function (o) {
        return { x: o.x, y: o.y, r: o.r, vx: o.vx, vy: o.vy };
      }),
      params: Object.assign({}, CFG.DEFAULTS, s.params || {})
    };
  }

  function loadScene(s) {
    state.scene = cloneScene(s);
    writeParamsToUI(state.scene.params);
    $('#stageTitle').textContent = state.scene.title || '自定义场景';
    renderObsList();
    recompute(false, 0);
    state.playing = true;
    anim.acc = 0;
    setPlayBtn();
  }

  /* ================= 参数 UI ================= */
  var PARAM_KEYS = ['kAtt', 'dT', 'kRep', 'dObs', 'eta', 'n', 'maxDisp', 'kv'];

  function writeParamsToUI(p) {
    PARAM_KEYS.forEach(function (k) {
      var nEl = $('[data-num="' + k + '"]'), rEl = $('[data-range="' + k + '"]');
      if (nEl) nEl.value = p[k];
      if (rEl) rEl.value = Math.min(Math.max(p[k], +rEl.min), +rEl.max);
    });
    $('[data-sel="mode"]').value = p.mode;
    $('[data-sel="escape"]').value = p.escape;
  }

  function readParamsFromUI() {
    var p = state.scene.params;
    PARAM_KEYS.forEach(function (k) {
      var v = parseFloat($('[data-num="' + k + '"]').value);
      if (isFinite(v)) p[k] = v;
    });
    p.mode = $('[data-sel="mode"]').value;
    p.escape = $('[data-sel="escape"]').value;
    return p;
  }

  var recTimer = null;
  function scheduleRecompute() {
    readParamsFromUI();
    if (recTimer) clearTimeout(recTimer);
    recTimer = setTimeout(function () {
      recTimer = null;
      recompute(true, view.progress);
      state.playing = false;
      setPlayBtn();
    }, 120);
  }

  function bindParamInputs() {
    $$('[data-num]').forEach(function (nEl) {
      var k = nEl.getAttribute('data-num');
      nEl.addEventListener('input', function () {
        var v = parseFloat(nEl.value);
        if (!isFinite(v)) return;
        var rEl = $('[data-range="' + k + '"]');
        if (rEl) rEl.value = Math.min(Math.max(v, +rEl.min), +rEl.max);
        scheduleRecompute();
      });
    });
    $$('[data-range]').forEach(function (rEl) {
      var k = rEl.getAttribute('data-range');
      rEl.addEventListener('input', function () {
        $('[data-num="' + k + '"]').value = rEl.value;
        scheduleRecompute();
      });
    });
    $('[data-sel="mode"]').addEventListener('change', scheduleRecompute);
    $('[data-sel="escape"]').addEventListener('change', scheduleRecompute);
  }

  /* ================= 计算 + 渲染 ================= */
  function recompute(keepView, progress) {
    if (!state.scene) return;
    state.result = A.simulate(state.scene);
    view.setResult(state.result, keepView, progress);
    syncProgressUI();
    renderReadout();
    updateField(true);
  }

  function syncProgressUI() {
    var n = state.result ? state.result.frames.length - 1 : 0;
    els.progress.max = n;
    els.progress.value = view.progress;
    els.progText.textContent = view.progress + ' / ' + n;
  }

  function renderReadout() {
    var r = state.result;
    if (!r) { els.readout.innerHTML = ''; return; }
    var gapCls = r.minGap === null ? '' : (r.minGap < 0 ? 'bad' : 'good');
    var items = [
      ['航路长度', fmt(r.length) + '<small>km</small>', ''],
      ['终点残距', fmt(r.endDist) + '<small>km</small>', r.reached ? 'good' : 'bad'],
      ['迭代步数', r.iters + '<small>步</small>', ''],
      ['最小安全间隔', (r.minGap === null ? '—' : fmt(r.minGap) + '<small>km</small>'), gapCls],
      ['是否抵达目标', r.reached ? '是' : (r.stalled ? '停滞' : '否'), r.reached ? 'good' : 'bad'],
      ['逃逸触发', r.escapes + '<small>次</small>', '']
    ];
    els.readout.innerHTML = items.map(function (it) {
      return '<div class="ro"><div class="ro-k">' + it[0] + '</div><div class="ro-v ' + it[2] + '">' + it[1] + '</div></div>';
    }).join('');
  }

  /* ================= 障碍列表 ================= */
  function renderObsList() {
    var list = els.obsList, obs = state.scene.obstacles;
    if (!obs.length) { list.innerHTML = '<div class="obs-empty">暂无禁飞区，点击下方按钮后在画布上放置。</div>'; return; }
    list.innerHTML = obs.map(function (o, i) {
      return '<div class="obs-item" data-i="' + i + '">' +
        '<span class="oi-n">#' + (i + 1) + '</span>' +
        '<span class="oi-v">x<input type="number" data-oi="x" step="1" value="' + (+o.x).toFixed(1) + '">' +
        'y<input type="number" data-oi="y" step="1" value="' + (+o.y).toFixed(1) + '"></span>' +
        '<span class="oi-v">r<input type="number" data-oi="r" step="0.5" min="2" value="' + (+o.r).toFixed(1) + '"></span>' +
        '<button class="oi-del" data-del="' + i + '" title="删除">删除</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('input[data-oi]'), function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.closest('.obs-item').getAttribute('data-i');
        var key = inp.getAttribute('data-oi');
        var v = parseFloat(inp.value);
        if (!isFinite(v)) return;
        state.scene.obstacles[i][key] = v;
        if (key === 'x' || key === 'y') { state.scene.obstacles[i].vx = 0; state.scene.obstacles[i].vy = 0; }
        scheduleRecompute();
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-del]'), function (btn) {
      btn.addEventListener('click', function () {
        state.scene.obstacles.splice(+btn.getAttribute('data-del'), 1);
        renderObsList();
        recompute(false, view.progress);
      });
    });
  }

  /* 拖动时仅同步数值，不重建 DOM */
  function syncObsInputs() {
    Array.prototype.forEach.call(els.obsList.querySelectorAll('.obs-item'), function (item) {
      var i = +item.getAttribute('data-i');
      var o = state.scene.obstacles[i];
      if (!o) return;
      var ix = item.querySelector('[data-oi="x"]'), iy = item.querySelector('[data-oi="y"]'), ir = item.querySelector('[data-oi="r"]');
      if (document.activeElement !== ix) ix.value = (+o.x).toFixed(1);
      if (document.activeElement !== iy) iy.value = (+o.y).toFixed(1);
      if (document.activeElement !== ir) ir.value = (+o.r).toFixed(1);
    });
  }

  /* ================= 势场可视化 ================= */
  var fieldTimer = null;
  function updateField(now) {
    if (fieldTimer) { clearTimeout(fieldTimer); fieldTimer = null; }
    var run = function () {
      var p = state.scene.params, v = view.view;
      F.render2D(els.field2d, v, state.scene, p, state.fieldKind);
      F.render3D(els.field3d, v, state.scene, p, state.fieldKind);
      var notes = {
        att: '引力场 U_att(q)：目标点是唯一的最低点，呈“漏斗形”。距离较远处切换为圆锥势场，梯度大小恒定，避免引力无限增大。',
        rep: '斥力场 U_rep(q)：每个禁飞区在影响半径 d_obs 内形成一道陡壁，越贴近边界势能越高，在边界处趋于无穷大，从而形成“硬墙”。',
        total: '合成势场 U = U_att + U_rep：谷底是目标点，四周是障碍物筑起的“山峰”。无人机沿负梯度方向运动，即可绕开山峰、滚向谷底。'
      };
      els.fieldNote.textContent = notes[state.fieldKind];
    };
    if (now) run(); else fieldTimer = setTimeout(run, 90);
  }

  /* ================= 动画 ================= */
  function tick(ts) {
    if (anim.last === 0) anim.last = ts;
    var dt = Math.min(ts - anim.last, 120);
    anim.last = ts;
    if (state.playing && state.result) {
      var perSec = +els.speed.value;
      anim.acc += dt;
      var inc = Math.floor(anim.acc / 1000 * perSec);
      if (inc > 0) {
        anim.acc -= inc / perSec * 1000;
        advance(inc);
      }
    }
    requestAnimationFrame(tick);
  }

  function advance(n) {
    var max = state.result.frames.length - 1;
    var np = view.progress + n;
    if (np >= max) { np = max; state.playing = false; setPlayBtn(); }
    view.setProgress(np);
    view.draw();
    els.progress.value = np;
    els.progText.textContent = np + ' / ' + max;
  }

  function setPlayBtn() {
    els.btnPlay.textContent = state.playing ? '❚❚ 暂停' : '▶ 播放路径动画';
  }

  /* ================= 缺陷卡片 ================= */
  function sceneOf(d, which) {
    if (d.useSlidePreset) return which === 'bad' ? CFG.cond2Scene() : CFG.slideScene();
    return d[which].scene;
  }

  function metricText(key, r) {
    switch (key) {
      case 'length': return '<span class="k">航路长度</span> ' + fmt(r.length) + ' km';
      case 'endDist': return '<span class="k">终点残距</span> ' + fmt(r.endDist) + ' km';
      case 'minGap': return '<span class="k">最小安全间隔</span> ' + (r.minGap === null ? '—' : fmt(r.minGap) + ' km');
      case 'iters': return '<span class="k">迭代步数</span> ' + r.iters;
      case 'reached': return '<span class="k">抵达目标</span> ' + (r.reached ? '是' : '否');
      default: return '';
    }
  }

  function buildDefectCards() {
    var host = $('#defList');
    host.innerHTML = CFG.DEFECTS.map(function (d) {
      return '' +
        '<article class="def" id="def-' + d.id + '">' +
          '<div class="def-head">' +
            '<span class="def-no">' + d.no + '</span>' +
            '<span class="def-name">' + d.name + '</span>' +
            '<span class="def-en">' + d.en + '</span>' +
          '</div>' +
          '<div class="def-body">' +
            '<div class="def-col bad">' +
              '<h4>现象与成因</h4>' +
              '<p>' + d.cause + '</p>' +
            '</div>' +
            '<div class="def-col good">' +
              '<h4>改进措施</h4>' +
              '<p>' + d.fix + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="def-foot">' +
            '<button class="btn btn-blue" data-load="' + d.id + '|bad">在仿真台复现缺陷</button>' +
            '<button class="btn" data-load="' + d.id + '|good">载入改进方案</button>' +
            '<span class="def-loading">' + d.bad.label + ' &nbsp;→&nbsp; ' + d.good.label + '</span>' +
          '</div>' +
        '</article>';
    }).join('');

    Array.prototype.forEach.call(host.querySelectorAll('[data-load]'), function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-load').split('|');
        var d = CFG.DEFECTS.filter(function (x) { return x.id === parts[0]; })[0];
        loadScene(sceneOf(d, parts[1]));
        toast((parts[1] === 'bad' ? '已载入缺陷场景：' : '已载入改进方案：') + d[parts[1]].note);
        document.getElementById('sim').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function fillDefectMetrics() {
    var jobs = [];
    CFG.DEFECTS.forEach(function (d) {
      ['bad', 'good'].forEach(function (which) { jobs.push([d, which]); });
    });
    var i = 0;
    (function next() {
      if (i >= jobs.length) return;
      var job = jobs[i++];
      var d = job[0], which = job[1];
      var el = document.querySelector('[data-metric="' + which + '-' + d.id + '"]');
      if (el) {
        var r = A.simulate(sceneOf(d, which));
        el.innerHTML = d.metrics.map(function (k) { return metricText(k, r); }).join(' &nbsp;｜&nbsp; ') +
          '<br>' + (which === 'bad' ? d.bad.note : d.good.note);
      }
      setTimeout(next, 16);
    })();
  }

  /* ================= 提示 ================= */
  var toastTimer = null;
  function toast(msg) {
    var old = document.querySelector('.toast');
    if (old) old.parentNode.removeChild(old);
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3600);
  }

  /* ================= 幻灯片参考值对照 ================= */
  function fillSlideRefs() {
    var r1 = A.simulate(CFG.slideScene());
    var r2 = A.simulate(CFG.cond2Scene());
    var e1 = $('#mLen1'), e2 = $('#mLen2');
    if (e1) e1.textContent = fmt(r1.length) + ' km（幻灯片参考 149.2545 km，误差 ' + fmt(Math.abs(r1.length - 149.2545) / 149.2545 * 100, 2) + '%）';
    if (e2) e2.textContent = fmt(r2.length) + ' km（幻灯片参考 168.0207 km，误差 ' + fmt(Math.abs(r2.length - 168.0207) / 168.0207 * 100, 2) + '%）';
  }

  /* ================= 初始化 ================= */
  function init() {
    els.progress = $('#progress');
    els.progText = $('#progText');
    els.speed = $('#speed');
    els.readout = $('#readout');
    els.obsList = $('#obsList');
    els.field2d = $('#field2d');
    els.field3d = $('#field3d');
    els.fieldNote = $('#fieldNote');
    els.btnPlay = $('#btnPlay');

    view = new global.APFView($('#stage'));

    view.onDrag = function () {
      state.scene.title = '自定义场景 · 拖动调整中';
      $('#stageTitle').textContent = state.scene.title;
      syncObsInputs();
      view.draw();
      if (recTimer) clearTimeout(recTimer);
      recTimer = setTimeout(function () {
        recTimer = null;
        readParamsFromUI();
        recompute(true, view.progress);
        state.playing = false;
        setPlayBtn();
      }, 130);
    };
    view.onDragEnd = function () {
      state.scene.title = '自定义场景';
      $('#stageTitle').textContent = state.scene.title;
      readParamsFromUI();
      if (recTimer) { clearTimeout(recTimer); recTimer = null; }
      recompute(false, view.progress);
      state.playing = false;
      setPlayBtn();
    };
    view.onAdd = function () {
      state.scene.title = '自定义场景';
      $('#stageTitle').textContent = state.scene.title;
      renderObsList();
      recompute(false, 0);
      var ab = $('#btnAddObs');
      ab.classList.remove('on');
      $('#addHint').innerHTML = hintDefault;
      toast('已添加禁飞区：拖动圆心可移动，拖动外圈可缩放半径');
    };

    bindParamInputs();

    /* 预设 */
    $$('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-preset');
        loadScene(k === 'slide2' ? CFG.cond2Scene() : CFG.slideScene());
      });
    });

    /* 播放控制 */
    els.btnPlay.addEventListener('click', function () {
      if (!state.result) return;
      if (view.progress >= state.result.frames.length - 1) view.setProgress(0);
      state.playing = !state.playing;
      anim.acc = 0;
      setPlayBtn();
    });
    $('#btnStep').addEventListener('click', function () { state.playing = false; setPlayBtn(); advance(1); });
    $('#btnEnd').addEventListener('click', function () { state.playing = false; setPlayBtn(); advance(1e9); });
    $('#btnReplay').addEventListener('click', function () {
      loadScene(state.scene);
    });

    els.progress.addEventListener('input', function () {
      state.playing = false; setPlayBtn();
      view.setProgress(+els.progress.value);
      view.draw();
      els.progText.textContent = view.progress + ' / ' + (state.result ? state.result.frames.length - 1 : 0);
    });

    /* 添加 / 清空障碍 */
    var hintDefault = $('#addHint').innerHTML;
    $('#btnAddObs').addEventListener('click', function () {
      view.addMode = !view.addMode;
      this.classList.toggle('on', view.addMode);
      $('#addHint').innerHTML = view.addMode
        ? '已进入放置模式：请在画布空白处点击以放置禁飞区。'
        : hintDefault;
    });
    $('#btnClearObs').addEventListener('click', function () {
      state.scene.obstacles = [];
      renderObsList();
      recompute(false, 0);
    });

    /* 显示选项 */
    $$('[data-chk]').forEach(function (c) {
      var key = c.getAttribute('data-chk');
      view.opts[key] = c.checked;
      c.addEventListener('change', function () {
        view.opts[key] = c.checked;
        view.draw();
      });
    });

    /* 势场切换 */
    $$('#fieldSeg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#fieldSeg .seg-btn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        state.fieldKind = b.getAttribute('data-field');
        updateField(true);
      });
    });

    var rzTimer = null;
    window.addEventListener('resize', function () {
      if (rzTimer) clearTimeout(rzTimer);
      rzTimer = setTimeout(function () {
        if (!state.scene) return;
        view.resize();
        updateField(true);
      }, 160);
    });

    buildDefectCards();
    fillSlideRefs();
    loadScene(CFG.slideScene());
    fillDefectMetrics();

    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window);

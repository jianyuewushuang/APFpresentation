/* ============================================================
   js/apf.js —— 人工势场法核心算法
   引力势/斥力势、力合成、位置迭代、逃逸机制、动态避让
   ============================================================ */
(function (global) {
  'use strict';

  var DMIN = 0.35;   // 距离下限，避免 1/d 数值爆炸

  function hypot(x, y) { return Math.sqrt(x * x + y * y); }

  /* 第 k 步的障碍物位置（支持匀速运动障碍） */
  function obstaclesAt(obstacles, k) {
    var out = [], i, o;
    for (i = 0; i < obstacles.length; i++) {
      o = obstacles[i];
      out.push({ x: o.x + (o.vx || 0) * k, y: o.y + (o.vy || 0) * k, r: o.r });
    }
    return out;
  }

  function hasMotion(obstacles) {
    for (var i = 0; i < obstacles.length; i++) {
      if (obstacles[i].vx || obstacles[i].vy) return true;
    }
    return false;
  }

  /* ---------- ① 引力场 ---------- */
  function potentialAtt(q, goal, p) {
    var d = hypot(goal.x - q.x, goal.y - q.y);
    if (d <= p.dT) return 0.5 * p.kAtt * d * d;
    return p.dT * p.kAtt * d - 0.5 * p.kAtt * p.dT * p.dT;
  }

  function attractionForce(q, goal, p) {
    var vx = goal.x - q.x, vy = goal.y - q.y, d = hypot(vx, vy);
    if (d < 1e-12) return { x: 0, y: 0 };
    if (d <= p.dT) return { x: p.kAtt * vx, y: p.kAtt * vy };
    var s = (p.dT * p.kAtt) / d;
    return { x: vx * s, y: vy * s };
  }

  /* ---------- ② 斥力场 ---------- */
  /* mode slide   : d = ‖q − q_obs‖，U_rep = ½K_rep(1/d − 1/d_obs)²‖q − q_g‖ⁿ   （幻灯片原式）
     mode khatib  : d = ‖q − q_obs‖ − r，U_rep = ½K_rep(1/d − 1/d_obs)²        （经典 Khatib，含边界） */
  function repD(q, o, p) {
    var dc = hypot(q.x - o.x, q.y - o.y);
    var d = (p.mode === 'khatib') ? (dc - o.r) : dc;
    return { dc: Math.max(dc, 1e-6), d: Math.max(d, DMIN) };
  }

  function potentialRep(q, goal, obs, p) {
    var u = 0, i, o, r, base, dg;
    dg = hypot(goal.x - q.x, goal.y - q.y);
    for (i = 0; i < obs.length; i++) {
      o = obs[i];
      r = repD(q, o, p);
      if (r.d > p.dObs) continue;
      base = 1 / r.d - 1 / p.dObs;
      u += 0.5 * p.kRep * base * base * ((p.mode === 'khatib') ? 1 : Math.pow(dg, p.n));
    }
    return u;
  }

  function repulsionForce(q, goal, obs, p) {
    var fx = 0, fy = 0, i, o, r, base, a1x, a1y, dgx, dgy, dgl, a2x, a2y, t1, t2, g;
    dgx = goal.x - q.x; dgy = goal.y - q.y;
    dgl = hypot(dgx, dgy) || 1e-12;
    a2x = dgx / dgl; a2y = dgy / dgl;
    for (i = 0; i < obs.length; i++) {
      o = obs[i];
      r = repD(q, o, p);
      if (r.d > p.dObs) continue;
      a1x = (q.x - o.x) / r.dc;
      a1y = (q.y - o.y) / r.dc;
      base = 1 / r.d - 1 / p.dObs;
      if (p.mode === 'khatib') {
        t1 = p.kRep * base / (r.d * r.d);
        fx += t1 * a1x; fy += t1 * a1y;
      } else {
        g = Math.pow(dgl, p.n);
        t1 = p.kRep * base * (1 / (r.d * r.d)) * g;
        t2 = (p.n / 2) * p.kRep * base * base * Math.pow(dgl, p.n - 1);
        fx += t1 * a1x + t2 * a2x;
        fy += t1 * a1y + t2 * a2y;
      }
    }
    return { x: fx, y: fy };
  }

  /* ---------- ③ 相对速度避让项（动态障碍改进） ---------- */
  function velocityForce(q, obs, vObs, vRob, p) {
    var fx = 0, fy = 0, i, o, ux0, uy0, dc, ux, uy, vrx, vry, closing, tx, ty, tl, w, reach;
    if (!p.kv) return { x: 0, y: 0 };
    for (i = 0; i < obs.length; i++) {
      o = obs[i];
      ux0 = q.x - o.x; uy0 = q.y - o.y; dc = hypot(ux0, uy0);
      reach = p.dObs + o.r;
      if (dc > reach || dc < 1e-9) continue;
      ux = ux0 / dc; uy = uy0 / dc;
      vrx = vObs.x - vRob.x; vry = vObs.y - vRob.y;
      closing = vrx * ux + vry * uy;
      if (closing <= 1e-6) continue;              // 未在接近
      tx = -vry; ty = vrx;                        // 垂直于相对速度
      tl = hypot(tx, ty);
      if (tl < 1e-9) continue;
      tx /= tl; ty /= tl;
      if (tx * ux + ty * uy < 0) { tx = -tx; ty = -ty; }  // 取背离障碍的一侧
      w = 1 - dc / reach;
      fx += p.kv * closing * w * tx;
      fy += p.kv * closing * w * ty;
    }
    return { x: fx, y: fy };
  }

  /* ---------- ④ 位置迭代仿真 ---------- */
  function simulate(scene) {
    var p = Object.assign({}, global.APF_CFG.DEFAULTS, scene.params || {});
    var obstacles = scene.obstacles || [];
    var moving = hasMotion(obstacles);
    var q = { x: scene.start.x, y: scene.start.y };
    var prev = { x: q.x, y: q.y };
    var maxIter = p.maxIter || 4000;
    var frames = [], obsFrames = moving ? [] : null;

    var best = hypot(q.x - scene.goal.x, q.y - scene.goal.y);
    var sinceBest = 0, reached = false, stalled = false;
    var minGap = Infinity, escapes = 0, sumEscapeSteps = 0;
    var minX = q.x, maxX = q.x, minY = q.y, maxY = q.y;

    for (var k = 0; k < maxIter; k++) {
      var obs = moving ? obstaclesAt(obstacles, k) : obstacles;
      var vObs = moving ? { x: (obstacles[0].vx || 0), y: (obstacles[0].vy || 0) } : null;

      var fAtt = attractionForce(q, scene.goal, p);
      var fRep = repulsionForce(q, scene.goal, obs, p);
      var fx = fAtt.x + fRep.x, fy = fAtt.y + fRep.y;

      /* 相对速度避让 */
      if (p.kv && moving) {
        var vRob = { x: (q.x - prev.x) / p.eta, y: (q.y - prev.y) / p.eta };
        var fv = velocityForce(q, obs, vObs, vRob, p);
        fx += fv.x; fy += fv.y;
      }

      /* 局部极小逃逸 */
      var escaping = false;
      if (p.escape !== 'none' && sinceBest > 150) {
        escaping = true;
        var gain = p.kAtt * p.dT;
        if (p.escape === 'tangent') {
          var flip = (Math.floor(sinceBest / 150) % 2 === 0) ? 1 : -1;
          var pl = hypot(-fAtt.y, fAtt.x) || 1e-12;
          fx += flip * (-fAtt.y / pl) * gain;
          fy += flip * (fAtt.x / pl) * gain;
        } else {
          fx += (Math.random() - 0.5) * gain * 2;
          fy += (Math.random() - 0.5) * gain * 2;
        }
        if (sinceBest === 151) escapes++;
        sumEscapeSteps++;
      }

      /* 输出当前步受力 */
      frames.push({
        x: q.x, y: q.y,
        fa: fAtt, fr: fRep,
        ft: { x: fAtt.x + fRep.x, y: fAtt.y + fRep.y },
        fsum: { x: fx, y: fy },
        esc: escaping,
        k: k
      });
      if (moving) obsFrames.push(obs.map(function (o) { return { x: o.x, y: o.y, r: o.r }; }));

      /* 位置迭代 q ← q + η·F，含单步位移限幅 */
      var sx = fx * p.eta, sy = fy * p.eta;
      var dm = hypot(sx, sy);
      if (dm > p.maxDisp) { sx *= p.maxDisp / dm; sy *= p.maxDisp / dm; }
      prev = { x: q.x, y: q.y };
      q = { x: q.x + sx, y: q.y + sy };

      if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;

      for (var j = 0; j < obs.length; j++) {
        var gap = hypot(q.x - obs[j].x, q.y - obs[j].y) - obs[j].r;
        if (gap < minGap) minGap = gap;
      }

      var dist = hypot(q.x - scene.goal.x, q.y - scene.goal.y);
      if (dist < p.goalTol) { reached = true; break; }
      if (dist < best - 1e-7) { best = dist; sinceBest = 0; } else sinceBest++;

      if (sinceBest > (p.stallStop || 1400)) { stalled = true; break; }
      if (Math.abs(q.x) > 1e6 || Math.abs(q.y) > 1e6) break;
    }

    /* 收尾：补上终止点 */
    var last = frames[frames.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) {
      frames.push({ x: q.x, y: q.y, fa: { x: 0, y: 0 }, fr: { x: 0, y: 0 }, ft: { x: 0, y: 0 }, fsum: { x: 0, y: 0 }, esc: false, k: frames.length });
      if (moving) obsFrames.push(obstaclesAt(obstacles, frames.length - 1));
    }

    var length = 0;
    for (var m = 1; m < frames.length; m++) {
      length += hypot(frames[m].x - frames[m - 1].x, frames[m].y - frames[m - 1].y);
    }

    return {
      frames: frames,
      obsFrames: obsFrames,
      moving: moving,
      length: length,
      iters: frames.length - 1,
      reached: reached,
      stalled: stalled,
      escapes: escapes,
      escapeSteps: sumEscapeSteps,
      minGap: isFinite(minGap) ? minGap : null,
      hitObs: isFinite(minGap) ? minGap < 0 : false,
      endDist: hypot(q.x - scene.goal.x, q.y - scene.goal.y),
      end: { x: q.x, y: q.y },
      params: p,
      obstacles: obstacles,
      scene: scene,
      bbox: [minX, minY, maxX, maxY]
    };
  }

  /* ---------- 视图范围自适应 ---------- */
  function computeView(scene, result, aspect) {
    var padRatio = 0.10;
    aspect = aspect || 1.4;
    var xs = [], ys = [], i, o;
    xs.push(scene.start.x, scene.goal.x);
    ys.push(scene.start.y, scene.goal.y);
    for (i = 0; i < (scene.obstacles || []).length; i++) {
      o = scene.obstacles[i];
      xs.push(o.x - o.r, o.x + o.r);
      ys.push(o.y - o.r, o.y + o.r);
    }
    if (result && result.bbox) {
      xs.push(result.bbox[0], result.bbox[2]);
      ys.push(result.bbox[1], result.bbox[3]);
    }
    if (result && result.moving && result.obsFrames && result.obsFrames.length) {
      var f = result.obsFrames;
      for (i = 0; i < f.length; i += Math.max(1, Math.floor(f.length / 40))) {
        xs.push(f[i][0].x - f[i][0].r, f[i][0].x + f[i][0].r);
        ys.push(f[i][0].y - f[i][0].r, f[i][0].y + f[i][0].r);
      }
    }
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
    var mx = Math.max(w, h) * padRatio;
    x0 -= mx; x1 += mx; y0 -= mx; y1 += mx;
    w = x1 - x0; h = y1 - y0;
    var cx, cy, needW, needH;
    if (w / h < aspect) {            // 太窄 → 横向扩展
      needW = h * aspect; cx = (x0 + x1) / 2; x0 = cx - needW / 2; x1 = cx + needW / 2;
    } else {                          // 太扁 → 纵向扩展
      needH = w / aspect; cy = (y0 + y1) / 2; y0 = cy - needH / 2; y1 = cy + needH / 2;
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  global.APF = {
    hypot: hypot,
    computeView: computeView,
    obstaclesAt: obstaclesAt,
    hasMotion: hasMotion,
    potentialAtt: potentialAtt,
    potentialRep: potentialRep,
    attractionForce: attractionForce,
    repulsionForce: repulsionForce,
    velocityForce: velocityForce,
    simulate: simulate
  };

})(window);

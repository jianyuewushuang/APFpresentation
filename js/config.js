/* ============================================================
   js/config.js —— 参数默认值、幻灯片任务场景、缺陷场景库
   ============================================================ */
(function (global) {
  'use strict';

  /* 幻灯片任务：起点 (0,0) → 目标 (100,100)，两个圆形禁飞区 */
  var SLIDE_OBSTACLES = [
    { x: 20, y: 40, r: 17.5 },
    { x: 80, y: 60, r: 17.5 }
  ];

  /* 默认参数（幻灯片「参数条件 1」） */
  var DEFAULTS = {
    kAtt: 0.5,     // 引力尺度因子 K_att
    dT: 20,        // 引力距离因子 d_t
    kRep: 43.75,   // 斥力尺度因子 K_rep
    dObs: 30,      // 斥力距离因子 d_obs
    eta: 0.05,     // 迭代步长 η
    n: 2,          // 斥力幂次因子
    maxDisp: 3,    // 单步位移限幅 (km/步)
    kv: 0,         // 相对速度避让增益 K_v
    mode: 'slide', // 斥力公式：slide(幻灯片原式) | khatib(经典)
    escape: 'none',// 局部极小逃逸：none | tangent | random
    goalTol: 0.5,
    maxIter: 4000,
    stallStop: 1400
  };

  var PARAM_META = {
    kAtt: { name: '引力尺度因子', sym: 'K_att' },
    dT: { name: '引力距离因子', sym: 'd_t' },
    kRep: { name: '斥力尺度因子', sym: 'K_rep' },
    dObs: { name: '斥力距离因子', sym: 'd_obs' },
    eta: { name: '迭代步长', sym: 'η' },
    n: { name: '斥力幂次因子', sym: 'n' },
    maxDisp: { name: '单步位移限幅', sym: 'v_max' },
    kv: { name: '相对速度避让增益', sym: 'K_v' }
  };

  /* ---------- 场景构造 ---------- */
  function slideScene() {
    return {
      title: '幻灯片任务 · 参数条件 1',
      start: { x: 0, y: 0 },
      goal: { x: 100, y: 100 },
      obstacles: SLIDE_OBSTACLES.map(function (o) { return { x: o.x, y: o.y, r: o.r }; }),
      params: Object.assign({}, DEFAULTS)
    };
  }

  function cond2Scene() {
    var s = slideScene();
    s.title = '幻灯片任务 · 参数条件 2';
    s.params.kRep = 140;
    s.params.dObs = 40;
    return s;
  }

  /* ---------- 缺陷场景库 ---------- */
  /* 每个缺陷提供 bad（缺陷状态）与 good（施加改进后）两个场景，页面加载时实算指标 */

  var DEFECTS = [
    {
      id: 'localmin',
      no: '①',
      name: '局部极小值陷阱',
      en: 'Local Minima',
      cause: '当引力与若干斥力恰好相互抵消（合力 ≈ 0）时，无人机停在并非目标的位置。典型场景是凹形/U 形障碍——无人机沿引力方向飞入"口袋"，被两侧与后墙的斥力顶住，形成受力平衡的驻点。',
      fix: '增设"停滞检测 + 切向逃逸力"：当连续若干步与目标的距离不再下降时，沿引力方向的垂直切向施加一个固定大小的扰动，把无人机推离驻点；若一次逃逸未能脱困，则翻转切向方向再次尝试。也可用随机扰动、虚拟目标点或引力场改造。',
      bad: {
        label: '缺陷：无逃逸机制',
        note: '无人机飞入 U 形禁飞区包围圈后停滞，30 000 步内始终无法脱困。',
        scene: {
          title: '缺陷① 局部极小值（无逃逸）',
          start: { x: 0, y: 55 },
          goal: { x: 100, y: 55 },
          obstacles: [
            { x: 64, y: 26, r: 13 }, { x: 55, y: 40, r: 13 }, { x: 53, y: 55, r: 13 },
            { x: 55, y: 70, r: 13 }, { x: 64, y: 84, r: 13 }
          ],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 60, dObs: 30, eta: 0.02,
            mode: 'slide', escape: 'none', maxDisp: 3, maxIter: 6000, stallStop: 1300
          })
        }
      },
      good: {
        label: '改进：切向逃逸力',
        note: '停滞 150 步后自动注入切向扰动，无人机绕出包围圈并抵达目标。',
        scene: {
          title: '缺陷① 改进：切向逃逸力',
          start: { x: 0, y: 55 },
          goal: { x: 100, y: 55 },
          obstacles: [
            { x: 64, y: 26, r: 13 }, { x: 55, y: 40, r: 13 }, { x: 53, y: 55, r: 13 },
            { x: 55, y: 70, r: 13 }, { x: 64, y: 84, r: 13 }
          ],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 60, dObs: 30, eta: 0.02,
            mode: 'slide', escape: 'tangent', maxDisp: 3, maxIter: 6000, stallStop: 1300
          })
        }
      },
      metrics: ['endDist', 'length', 'reached']
    },
    {
      id: 'gnron',
      no: '②',
      name: '目标不可达（GNRON）',
      en: 'Goal Non-Reachable with Obstacles Nearby',
      cause: '经典 Khatib 斥力场的斥力势随 1/d² 增长，且没有与目标距离挂钩。当障碍靠近目标时，目标点本身的斥力不为零，无人机在抵达目标前就被斥力顶住，只能停在距目标数公里的地方反复徘徊。',
      fix: '把斥力势乘以到目标距离的幂次 ‖q − q_g‖ⁿ —— 这正对应幻灯片中的斥力公式。如此一来目标点处 ‖q − q_g‖ = 0，斥力自动衰减为零，无人机可以贴近目标。',
      bad: {
        label: '缺陷：经典 Khatib 斥力（无目标因子）',
        note: '障碍位于目标附近，无人机被斥力挡住，最终停在离目标数公里处。',
        scene: {
          title: '缺陷② 目标不可达（经典 Khatib）',
          start: { x: 0, y: 50 },
          goal: { x: 100, y: 50 },
          obstacles: [{ x: 86, y: 56, r: 8 }],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 5000, dObs: 40, eta: 0.02,
            mode: 'khatib', escape: 'none', maxDisp: 3, maxIter: 3000, stallStop: 1200
          })
        }
      },
      good: {
        label: '改进：斥力乘 ‖q − q_g‖ⁿ 目标因子',
        note: '改用幻灯片原式后，目标点处斥力归零，无人机顺利抵达。',
        scene: {
          title: '缺陷② 改进：含目标距离因子',
          start: { x: 0, y: 50 },
          goal: { x: 100, y: 50 },
          obstacles: [{ x: 86, y: 56, r: 8 }],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 25, dObs: 40, eta: 0.02,
            mode: 'slide', escape: 'none', maxDisp: 3, maxIter: 3000, stallStop: 1200
          })
        }
      },
      metrics: ['endDist', 'length', 'reached']
    },
    {
      id: 'stepsize',
      no: '③',
      name: '步长过大导致弹跳与侵入禁飞区',
      en: 'Step-Size Sensitivity',
      cause: '位置迭代是 q ← q + η·F，步长 η 固定。进入斥力区后合力急剧增大，若 η 偏大又不对单步位移限幅，一步就会跨过平衡位置甚至越过障碍边界；随后被更强的斥力弹回，形成"弹射—折返"的剧烈抖动。航路长度明显变长，并可能直接侵入禁飞区。',
      fix: '对单步位移限幅（等效于限制无人机最大速度）：|η·F| ≤ v_max。更平滑的做法是让步长随合力归一化（定步长推进），或在接近障碍时自适应减小 η。',
      bad: {
        label: '缺陷：η = 0.35 km/步 且单步限幅放到 10 km',
        note: '航路被"弹"成折线，最小安全间隔为负，航路侵入禁飞区。',
        scene: {
          title: '缺陷③ 步长过大（限幅过松）',
          start: { x: 0, y: 50 },
          goal: { x: 100, y: 50 },
          obstacles: [{ x: 50, y: 56, r: 15 }],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 200, dObs: 45, eta: 0.35,
            mode: 'khatib', escape: 'none', maxDisp: 10, maxIter: 3000, stallStop: 1400
          })
        }
      },
      good: {
        label: '改进：单步位移限幅 0.5 km',
        note: '限幅后轨迹平滑、零折返，航路长度接近直线距离，全程保持安全间隔。',
        scene: {
          title: '缺陷③ 改进：步长限幅',
          start: { x: 0, y: 50 },
          goal: { x: 100, y: 50 },
          obstacles: [{ x: 50, y: 56, r: 15 }],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 200, dObs: 45, eta: 0.35,
            mode: 'khatib', escape: 'none', maxDisp: 0.5, maxIter: 3000, stallStop: 1400
          })
        }
      },
      metrics: ['length', 'minGap', 'iters']
    },
    {
      id: 'margin',
      no: '④',
      name: '安全裕度不足导致侵入禁飞区',
      en: 'Insufficient Safety Margin',
      cause: '斥力距离因子 d_obs 是"软约束"（斥力作用半径），禁飞区半径 r 是"硬约束"。若 d_obs 设置得比 r 还小，无人机在进入禁飞区之前根本感受不到任何斥力，等开始被推开时已经身处禁飞区内部。此时无论把 K_rep 加到多大都无法补救——因为无穷大的斥力只能把无人机挡在 d_obs 的球面之外。',
      fix: '令 d_obs 明显大于 r，预留安全裕度（工程上常取 d_obs ≥ r + 5 ~ 15 km）。同时把最大 K_rep 与 d_obs 联合标定，而不是单独调 K_rep。',
      bad: {
        label: '缺陷：d_obs = 16 km < r = 17.5 km',
        note: '斥力影响半径小于禁飞区半径，航路必然切进禁飞区。',
        scene: {
          title: '缺陷④ 安全裕度不足（d_obs = 16）',
          start: { x: 0, y: 0 },
          goal: { x: 100, y: 100 },
          obstacles: SLIDE_OBSTACLES.map(function (o) { return { x: o.x, y: o.y, r: o.r }; }),
          params: Object.assign({}, DEFAULTS, { dObs: 16, maxIter: 3000 })
        }
      },
      good: {
        label: '改进：d_obs = 30 km ≥ r + 12.5 km',
        note: '预留足够安全裕度后，航路与禁飞区边界保持正的间隔。',
        scene: {
          title: '缺陷④ 改进：预留安全裕度（d_obs = 30）',
          start: { x: 0, y: 0 },
          goal: { x: 100, y: 100 },
          obstacles: SLIDE_OBSTACLES.map(function (o) { return { x: o.x, y: o.y, r: o.r }; }),
          params: Object.assign({}, DEFAULTS, { dObs: 30, maxIter: 3000 })
        }
      },
      metrics: ['minGap', 'length', 'reached']
    },
    {
      id: 'dynamic',
      no: '⑤',
      name: '动态障碍物无法避让',
      en: 'Moving Obstacle Conflict',
      cause: '经典势场只使用障碍物的"当前位置"，不包含速度信息。当障碍迎面驶来且与航线共线时，斥力方向与引力方向严格反向、没有侧向分量，无人机被障碍一路"顶"着后退，永远到不了目标；即便不碰撞，也会在障碍前反复进退。',
      fix: '引入相对速度项：在影响半径内，当相对速度在视线方向的分量为正（正在接近）时，沿垂直于相对速度、且背离障碍的切向施加避让力 K_v·|v_rel|·(1 − d/d_obs)，使无人机提前定侧绕行。',
      bad: {
        label: '缺陷：静态势场（K_v = 0）',
        note: '障碍迎面驶来，无人机被一路顶回，越退越远，无法抵达目标。',
        scene: {
          title: '缺陷⑤ 动态障碍（静态势场）',
          start: { x: 0, y: 35 },
          goal: { x: 100, y: 35 },
          obstacles: [{ x: 78, y: 35, r: 12, vx: -0.3, vy: 0 }],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 200, dObs: 30, eta: 0.05,
            mode: 'khatib', escape: 'none', kv: 0, maxDisp: 3, maxIter: 400, stallStop: 1400
          })
        }
      },
      good: {
        label: '改进：相对速度避让项 K_v = 60',
        note: '加入相对速度项后，无人机提前侧向绕行，保持安全间隔并抵达目标。',
        scene: {
          title: '缺陷⑤ 改进：相对速度避让',
          start: { x: 0, y: 35 },
          goal: { x: 100, y: 35 },
          obstacles: [{ x: 78, y: 35, r: 12, vx: -0.3, vy: 0 }],
          params: Object.assign({}, DEFAULTS, {
            kAtt: 1, dT: 20, kRep: 200, dObs: 30, eta: 0.05,
            mode: 'khatib', escape: 'none', kv: 60, maxDisp: 3, maxIter: 400, stallStop: 1400
          })
        }
      },
      metrics: ['reached', 'minGap', 'length']
    },
    {
      id: 'sensitive',
      no: '⑥',
      name: '参数敏感、缺乏通用取值',
      en: 'Parameter Sensitivity',
      cause: '同一张地图、同一套算法，仅把 K_rep 由 43.75 调到 140、d_obs 由 30 调到 40，航路长度就从 150.4 km 增加到 169.1 km（+12.4%），迭代次数从 436 增至 578（+33%）。斥力越强航路越保守，但过弱又会侵入禁飞区，两者之间存在依赖场景的"甜区"，没有通用最优参数。',
      fix: '工程上常用三条路径：① 以 K_rep / d_obs 等无量纲组合做归一化标定，减少独立自由度；② 分层规划——先用粗略参数求可行解，再在可行域内细化；③ 自适应/模糊调参，按当前最小安全间隔在线调整 K_rep 与 d_obs；④ 多组参数并行计算后择优（如本例直接对比两组参数取短者）。',
      bad: {
        label: '参数条件 2：K_rep = 140，d_obs = 40',
        note: '斥力更早更强，绕行幅度明显增大，航路更长、迭代更多。',
        scene: null
      },
      good: {
        label: '参数条件 1：K_rep = 43.75，d_obs = 30',
        note: '同一地图，参数更"柔和"，航路更短且仍完全避开禁飞区。',
        scene: null
      },
      metrics: ['length', 'iters', 'minGap'],
      useSlidePreset: true
    }
  ];

  global.APF_CFG = {
    DEFAULTS: DEFAULTS,
    PARAM_META: PARAM_META,
    SLIDE_OBSTACLES: SLIDE_OBSTACLES,
    DEFECTS: DEFECTS,
    slideScene: slideScene,
    cond2Scene: cond2Scene
  };

})(window);

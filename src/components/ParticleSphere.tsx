import { useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

/**
 * 粒子球 / 知识球（Canvas 2D，零依赖）
 *
 * 视觉分层（视差）：
 *  - 外壳（~73%，正向 1x）+ 中层（~20%，0.62x）+ 内核（~7%，反向 0.4x），三层异速营造活物感
 *
 * 状态机（props 驱动）：
 *  - 空闲：1x 自转；kbLine 模式下标注线轮播知识条目（可点击）
 *  - thinking：连线淡出，粒子沿半径逃逸挣扎，平滑加速 3x
 *  - burstSignal 递增：裂变 —— 径向爆开 + 双冲击波 + 弹性归位
 *
 * 高级感细节：入场汇聚（散→聚+回弹）、亮星十字星芒、鼠标手电筒（附近连线点亮）、
 * absorbText 文字粒子吸收（问题化成粒子飞进球）、DPR 高清、Reduced Motion 降级、卸载清理。
 */

export interface KBSphereLabel {
  icon: string;
  text: string;
}

export interface ParticleSphereHandle {
  /** 问题文字化成粒子飞进球内（在球可见时调用） */
  absorbText: (text: string) => void;
  /** 全屏入场用：钉住球心/半径（画布非球体几何时）；null 还原为画布自身居中 */
  setViewBox: (vb: { cx: number; cy: number; r: number } | null) => void;
}

export interface ParticleSphereProps {
  width?: number | string;
  height?: number | string;
  mode?: 'light' | 'dark';
  /** 思考态：连线淡出 + 逃逸挣扎 + 平滑加速 3x */
  thinking?: boolean;
  /** 输出/裂变阶段：不生成新连线 */
  streaming?: boolean;
  /** 递增触发一次裂变 */
  burstSignal?: number;
  /** 首次挂载播放「散→聚」入场动画（默认开） */
  intro?: boolean;
  /** 入场动画播完（或被 reduced-motion 跳过）时回调，用于全屏层退场 */
  onIntroDone?: () => void;
  /** 全屏入场钉位（球心/半径）；引擎延迟创建，经 prop 在创建时应用 */
  viewBox?: { cx: number; cy: number; r: number } | null;
  kbLine?: boolean;
  kbItems?: KBSphereLabel[];
  /** 点击知识标签回调（连线即入口） */
  onLabelClick?: (item: KBSphereLabel) => void;
  dots?: number;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const LIGHT_STOPS = [[99, 102, 241], [129, 140, 248], [168, 85, 247], [217, 70, 239], [236, 72, 153]];
const DARK_STOPS = [[168, 183, 255], [144, 158, 252], [170, 140, 252], [205, 178, 255], [248, 165, 235]];
const STEPS = 24;
const lerpC = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
function gradientColor(stops: number[][], t: number) {
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  return lerpC(stops[i], stops[i + 1], seg - i);
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const SPRITE = 48;
function makeSprite(colorStr: string, strong: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  const a = (v: number) => colorStr.replace('rgb', 'rgba').replace(')', `,${v})`);
  if (strong) {
    grd.addColorStop(0, a(0.95)); grd.addColorStop(0.22, a(0.85));
    grd.addColorStop(0.5, a(0.18)); grd.addColorStop(1, a(0));
  } else {
    grd.addColorStop(0, a(0.9)); grd.addColorStop(0.18, a(0.5));
    grd.addColorStop(0.45, a(0.16)); grd.addColorStop(1, a(0));
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}

interface Pt {
  x: number; y: number; z: number;
  /** 入场散布起点 */
  ix: number; iy: number; iz: number;
  introDelay: number;
  /** 视差层速：外壳 1 / 中层 0.62 / 内核 -0.4 */
  layerSpeed: number;
  sprite: number;
  base: number; bright: boolean;
  burstMul: number;
  strF: number; strP: number; strA: number; esc: number; rr: number;
  tw: number;
}

function buildPoints(n: number): Pt[] {
  const pts: Pt[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const nCore = Math.max(24, Math.floor(n * 0.07));
  const nMid = Math.floor(n * 0.20);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rXY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    let rad: number, layerSpeed: number;
    if (i < nCore) { rad = 0.42 + Math.random() * 0.08; layerSpeed = -0.4; }
    else if (i < nCore + nMid) { rad = 0.58 + Math.random() * 0.24; layerSpeed = 0.62; }
    else { rad = 0.9 + Math.random() * 0.1; layerSpeed = 1; }
    const t = (1 - y) / 2;
    const base = 0.55 + Math.pow(Math.random(), 3.2) * 2.1;
    // 入场散布：随机方向、2.0~3.2 倍半径
    const dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dr = 2.0 + Math.random() * 1.2;
    pts.push({
      x: Math.cos(theta) * rXY * rad, y: y * rad, z: Math.sin(theta) * rXY * rad,
      ix: (dx / dl) * dr, iy: (dy / dl) * dr, iz: (dz / dl) * dr,
      introDelay: Math.random() * 0.35,
      layerSpeed,
      sprite: Math.min(STEPS - 1, Math.round(t * (STEPS - 1))),
      base, bright: base > 2.0 && Math.random() < 0.7,
      burstMul: 0.7 + Math.random() * 0.9,
      strF: 1.5 + Math.random() * 2.5, strP: Math.random() * Math.PI * 2,
      strA: 0.6 + Math.random() * 0.8, esc: Math.random() < 0.06 ? 1.9 : 0.35, rr: rad,
      tw: Math.random() * Math.PI * 2,
    });
  }
  return pts;
}

function neighborPairs(pts: Pt[], k: number): [number, number][] {
  const pairs = new Set<number>();
  const order = pts.map((_, i) => i).sort((a, b) => pts[a].y - pts[b].y);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const a = pts[i];
    // 免排序：窗口内线性维护最近 2 个（k=2），构建耗时 ~7x 下降，消除入场起始卡顿
    let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
    for (let oj = Math.max(0, oi - 70); oj < Math.min(order.length, oi + 71); oj++) {
      const j = order[oj];
      if (j === i) continue;
      const b = pts[j];
      const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (dd < d1) { d2 = d1; b2 = b1; d1 = dd; b1 = j; }
      else if (dd < d2) { d2 = dd; b2 = j; }
    }
    if (b1 >= 0) pairs.add(i < b1 ? i * 100000 + b1 : b1 * 100000 + i);
    if (k > 1 && b2 >= 0) pairs.add(i < b2 ? i * 100000 + b2 : b2 * 100000 + i);
  }
  return [...pairs].map(c => [c % 100000, Math.floor(c / 100000)] as [number, number]);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface Conn {
  pi: number; slot: number; item: KBSphereLabel;
  phase: 'grow' | 'hold' | 'fade';
  t: number; hold: number; dead?: boolean;
}

interface Absorber {
  x0: number; y0: number;
  pi: number;
  delay: number; t: number; dur: number;
  sprite: number;
}

interface LabelRect { x: number; y: number; w: number; h: number; item: KBSphereLabel }

class SphereEngine {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprites: Record<'light' | 'dark', HTMLCanvasElement[]>;
  private reduceMotion: boolean;
  private interactive: boolean;

  pts: Pt[] = [];
  pairs: [number, number][] = [];
  kbItems: KBSphereLabel[] = [];
  onLabelClick: ((item: KBSphereLabel) => void) | null = null;
  thinking = false;
  streaming = false;
  mode: 'light' | 'dark';
  kbLine: boolean;

  private w = 300; private h = 300;
  private rotY = Math.random() * Math.PI * 2;
  private rotX = 0.3;
  private t = 0;
  private introT = 0;
  private introEnabled: boolean;
  private mouse = { x: -9999, y: -9999 };
  private conns: Conn[] = [];
  private nextSpawn = 1.6;
  private kbIdx = 0;
  private staticInit = false;
  private burstT = -1;
  private energy = 0;
  private energyKill = false;
  private speedCur = 1;
  private rafId = 0;
  /** 慢帧自适应：滚动均帧耗 >20ms 持续 90 帧 → 星图连线隔行绘制（qLines=2） */
  private frameAvg = 16; private lastFrameT = 0; private slowCnt = 0; private qLines = 1;
  private running = true;
  private absorbers: Absorber[] = [];
  private labelRects: LabelRect[] = [];
  /** 全屏入场：球心/半径钉位（画布几何 ≠ 球体几何时生效） */
  private vb: { cx: number; cy: number; r: number } | null = null;
  /** 预分配投影/绘制顺序缓冲：消除每帧 2200 对象字面量的 GC 压力 */
  private projBuf: { sx: number; sy: number; persp: number }[] = [];
  private orderBuf: number[] = [];
  private orderMini: number[] = [];
  private introFired = false;
  private onIntroDoneCb: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, opts: {
    mode: 'light' | 'dark'; kbLine: boolean; dots: number; interactive: boolean; intro: boolean;
    onIntroDone?: () => void;
  }) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.mode = opts.mode;
    this.kbLine = opts.kbLine;
    this.interactive = opts.interactive;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.introEnabled = opts.intro && !this.reduceMotion;
    this.onIntroDoneCb = opts.onIntroDone ?? null;
    if (!this.introEnabled) { this.introFired = true; queueMicrotask(() => this.onIntroDoneCb?.()); }
    this.sprites = {
      light: Array.from({ length: STEPS }, (_, s) => makeSprite(rgb(gradientColor(LIGHT_STOPS, s / (STEPS - 1))), true)),
      dark: Array.from({ length: STEPS }, (_, s) => makeSprite(rgb(gradientColor(DARK_STOPS, s / (STEPS - 1))), false)),
    };
    this.rebuild(opts.dots);
    canvas.addEventListener('mousemove', this.onMouse);
    canvas.addEventListener('mouseleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.draw();
  }

  /** 小尺寸（角落模式）：连线/星芒过密会糊成一片，全部收敛 */
  private get mini() {
    return this.w < 240 || this.h < 240;
  }

  private onMouse = (e: MouseEvent) => {
    const r = this.cv.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    const hov = this.labelRects.some(L =>
      this.mouse.x >= L.x && this.mouse.x <= L.x + L.w && this.mouse.y >= L.y && this.mouse.y <= L.y + L.h);
    this.cv.style.cursor = hov ? 'pointer' : (this.interactive ? 'crosshair' : 'default');
  };
  private onLeave = () => { this.mouse.x = -9999; };
  private onResize = () => this.resize();
  private onClick = (e: MouseEvent) => {
    if (!this.onLabelClick || !this.labelRects.length) return;
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (const L of this.labelRects) {
      if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) { this.onLabelClick(L.item); return; }
    }
  };

  destroy() {
    this.running = false;
    clearTimeout(this.settleTimer);
    cancelAnimationFrame(this.rafId);
    this.cv.removeEventListener('mousemove', this.onMouse);
    this.cv.removeEventListener('mouseleave', this.onLeave);
    this.cv.removeEventListener('click', this.onClick);
    window.removeEventListener('resize', this.onResize);
  }

  rebuild(n: number) {
    this.pts = buildPoints(n);
    this.pairs = neighborPairs(this.pts, 2);
    this.conns = [];
    this.projBuf = this.pts.map(() => ({ sx: 0, sy: 0, persp: 1 }));
    this.orderBuf = this.pts.map((_, i) => i);
    this.orderMini = this.orderBuf.filter(i2 => i2 % 6 === 0);
  }

  burst() {
    this.burstT = 0;
    this.energyKill = true;
  }

  fadeConns() {
    for (const c of this.conns) if (c.phase !== 'fade') { c.phase = 'fade'; c.t = 0; }
  }

  /** 问题文字 → 粒子，从画布下方飞入球面（从左到右错峰出发，像被球读进去） */
  absorbText(text: string) {
    if (!text || !this.pts.length) return;
    const oc = document.createElement('canvas');
    const og = oc.getContext('2d')!;
    const font = 'bold 54px -apple-system, PingFang SC, sans-serif';
    og.font = font;
    oc.width = Math.min(860, Math.ceil(og.measureText(text).width) + 24);
    oc.height = 74;
    og.font = font;
    og.fillStyle = '#fff';
    og.textBaseline = 'middle';
    og.fillText(text, 12, 38);
    const img = og.getImageData(0, 0, oc.width, oc.height).data;
    const step = oc.width > 520 ? 7 : 5;
    const sampled: { x: number; y: number }[] = [];
    for (let y = 0; y < oc.height; y += step) {
      for (let x = 0; x < oc.width; x += step) {
        if (img[(y * oc.width + x) * 4 + 3] > 120) sampled.push({ x: x / oc.width, y: y / oc.height });
      }
    }
    if (!sampled.length) return;
    const cap = Math.min(300, sampled.length);
    for (let i = 0; i < cap; i++) {
      const s = sampled[Math.floor(Math.random() * sampled.length)];
      this.absorbers.push({
        x0: this.w * (0.15 + s.x * 0.7),
        y0: this.h * (0.68 + s.y * 0.14),
        pi: Math.floor(Math.random() * this.pts.length),
        delay: s.x * 0.4 + Math.random() * 0.12,
        t: 0, dur: 0.7 + Math.random() * 0.25,
        sprite: Math.floor(Math.random() * STEPS),
      });
    }
  }

  private settleTimer = 0;
  resize() {
    clearTimeout(this.settleTimer);
    const w = this.cv.clientWidth || 300;
    const h = this.cv.clientHeight || (this.kbLine ? 320 : 300);
    // 全屏入场等超大画布降低 DPR：首帧缓冲分配与逐帧清除成本大幅下降
    const dpr = Math.min(window.devicePixelRatio || 1, w * h > 640000 ? 1 : 2);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    // 量化分配：morph 期间尺寸逐帧变化，变化 <10% 时复用现有缓冲（元素 CSS 拉伸显示），
    // 避免逐帧销毁/重建画布 backing store 造成掉帧；停稳后 300ms 精确对齐一次
    const dw = Math.abs(W - this.cv.width) / Math.max(1, this.cv.width);
    const dh = Math.abs(H - this.cv.height) / Math.max(1, this.cv.height);
    if (!this.cv.width || dw > 0.1 || dh > 0.1) {
      this.cv.width = W; this.cv.height = H;
    } else if (this.cv.width !== W || this.cv.height !== H) {
      this.settleTimer = window.setTimeout(() => {
        this.cv.width = W; this.cv.height = H;
        this.ctx.setTransform(this.cv.width / w, 0, 0, this.cv.height / h, 0, 0);
      }, 300);
    }
    this.ctx.setTransform(this.cv.width / w, 0, 0, this.cv.height / h, 0, 0);
    this.w = w; this.h = h;
  }

  setViewBox(vb: { cx: number; cy: number; r: number } | null) { this.vb = vb; }

  private project() {
    const { w, h } = this;
    const R = this.vb ? this.vb.r : Math.min(w, h) * (this.kbLine ? 0.33 : 0.42);
    const cx = this.vb ? this.vb.cx : w / 2;
    const cy = this.vb ? this.vb.cy : h / 2;
    const tgtE = this.thinking ? 1 : 0;
    const rate = this.energyKill ? 0.12 : 0.022;
    this.energy += (tgtE - this.energy) * rate;
    if (this.energyKill && this.energy < 0.03) { this.energy = 0; this.energyKill = false; }
    let disp = 0;
    if (this.burstT >= 0) {
      const bp = this.burstT / 1.15;
      const out = Math.min(1, bp / 0.22);
      const back = bp < 0.28 ? 0 : Math.min(1, (bp - 0.28) / 0.72);
      const easeOut = 1 - Math.pow(1 - out, 3);
      const easeInOut = back < 0.5 ? 2 * back * back : 1 - Math.pow(-2 * back + 2, 2) / 2;
      disp = 1.05 * easeOut * (1 - easeInOut);
    }
    // 涟漪式呼吸：待机时球体半径正弦涨落，相位随粒子深度（核心→外壳）延迟，
    // 呼吸波自内向外传播；思考（energy）与裂变（disp）期间振幅自然退场
    const breathAmp = this.reduceMotion ? 0 : 0.045 * (1 - this.energy) * (1 - Math.min(1, disp / 1.05));
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);
    const baseRot = this.rotY;
    const introActive = this.introEnabled && this.introT < 1.6;
    // 全屏入场（vb 生效时）：散布按画布对角线放大，粒子自屏幕边缘外飞入，画布矩形边界不可见
    const iSpread = this.vb ? (Math.hypot(w, h) * 0.5) / (R * 2.6) : 1;
    const proj = this.projBuf;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      // 视差：每层绕 Y 轴异速（内核反向）
      const a = baseRot * p.layerSpeed;
      const cosY = Math.cos(a), sinY = Math.sin(a);
      let px = p.x, py = p.y, pz = p.z;
      if (introActive) {
        const d = clamp01((this.introT - p.introDelay) / 0.85);
        if (d < 1) {
          // easeOutBack：散→聚 + 轻微回弹
          const u2 = d === 0 ? 0 : 1 + 1.28 * Math.pow(d - 1, 3) + 2.28 * Math.pow(d - 1, 2);
          const ix = p.ix * iSpread, iy = p.iy * iSpread, iz = p.iz * iSpread;
          px = ix + (p.x - ix) * u2;
          py = iy + (p.y - iy) * u2;
          pz = iz + (p.z - iz) * u2;
        }
      }
      const x = px * cosY - pz * sinY;
      const z = px * sinY + pz * cosY;
      const y2 = py * cosX - z * sinX;
      const z2 = py * sinX + z * cosX;
      const persp = 1.8 / (1.8 + z2);
      let sx = cx + x * R * persp;
      let sy = cy + y2 * R * persp;
      let strain = 0;
      if (this.energy > 0.01) {
        const wave = 0.5 + 0.5 * Math.sin(this.t * p.strF + p.strP);
        const spike = Math.pow(Math.max(0, Math.sin(this.t * p.strF * 0.7 + p.strP * 1.7)), 3);
        strain = this.energy * (0.10 * wave + 0.15 * spike * p.esc) * p.strA * (0.3 + 0.7 * p.rr);
      }
      let mul = 1 + disp * p.burstMul + strain;
      if (breathAmp > 0.001) mul *= 1 + breathAmp * Math.sin(this.t * 1.57 - p.rr * 1.9);
      sx = cx + (sx - cx) * mul;
      sy = cy + (sy - cy) * mul;
      if (this.interactive && this.mouse.x > -999) {
        const dx = sx - this.mouse.x, dy = sy - this.mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 2400) {
          const d = Math.sqrt(d2) || 1;
          const off = (1 - d / 49) * 10;
          sx += dx / d * off; sy += dy / d * off;
        }
      }
      const q = proj[i]; q.sx = sx; q.sy = sy; q.persp = persp;
    }
    return { proj, cx, cy, R, disp };
  }

  private updateConns(proj: { sx: number; persp: number }[], dt: number) {
    if (!this.kbLine || this.mini) {
      for (const c of this.conns) if (c.phase !== 'fade') { c.phase = 'fade'; c.t = 0; }
      if (!this.kbLine) { this.conns = []; }
      return null;
    }
    const { w, h } = this;
    const slots = [
      { x: w * 0.015, y: h * 0.24, align: 'left' as const },
      { x: w * 0.985, y: h * 0.18, align: 'right' as const },
      { x: w * 0.015, y: h * 0.74, align: 'left' as const },
      { x: w * 0.985, y: h * 0.80, align: 'right' as const },
    ];
    this.nextSpawn -= dt;
    const introDone = !this.introEnabled || this.introT > 1.4;
    const wantSpawn = introDone && !this.thinking && !this.streaming && (this.reduceMotion
      ? (!this.staticInit && this.conns.length < 2)
      : (this.nextSpawn <= 0 && this.conns.length < 2));
    if (wantSpawn && this.kbItems.length) {
      const used = new Set(this.conns.map(c => c.slot));
      const free = [0, 1, 2, 3].filter(s => !used.has(s));
      if (free.length) {
        const slot = free[Math.floor(Math.random() * free.length)];
        const side = slots[slot].align === 'left' ? -1 : 1;
        let pool: number[] = [];
        for (let i = 0; i < proj.length; i += 5) {
          const q = proj[i];
          if (q.persp > 1.02 && Math.sign(q.sx - w / 2) === side) pool.push(i);
        }
        if (!pool.length) for (let i = 0; i < proj.length; i += 5) if (proj[i].persp > 1.02) pool.push(i);
        if (pool.length) {
          const pi = pool[Math.floor(Math.random() * pool.length)];
          this.conns.push({
            pi, slot, item: this.kbItems[this.kbIdx++ % this.kbItems.length],
            phase: this.reduceMotion ? 'hold' : 'grow', t: 0, hold: 2.8 + Math.random() * 1.2,
          });
          if (this.reduceMotion && this.conns.length >= 2) this.staticInit = true;
        }
      }
      this.nextSpawn = 2.2 + Math.random() * 1.3;
    }
    for (const c of this.conns) {
      c.t += dt;
      if (c.phase === 'grow' && c.t > 0.85) { c.phase = 'hold'; c.t = 0; }
      else if (c.phase === 'hold' && (c.t > c.hold || (proj[c.pi] && proj[c.pi].persp < 0.97))) { c.phase = 'fade'; c.t = 0; }
      else if (c.phase === 'fade' && c.t > 0.8) c.dead = true;
    }
    this.conns = this.conns.filter(c => !c.dead);
    return slots;
  }

  private drawConns(ctx: CanvasRenderingContext2D, proj: { sx: number; sy: number }[], slots: { x: number; y: number; align: 'left' | 'right' }[] | null) {
    this.labelRects = [];
    if (!this.conns.length || !slots) return;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    for (const c of this.conns) {
      const q = proj[c.pi];
      const slot = slots[c.slot];
      const label = `${c.item.icon} ${c.item.text}`;
      ctx.font = '11px -apple-system, PingFang SC, sans-serif';
      const tw = ctx.measureText(label).width;
      const chW = tw + 32, chH = 24;
      const bx = slot.align === 'left' ? slot.x : slot.x - chW;
      const ly = slot.y;
      const endX = slot.align === 'left' ? bx + chW + 2 : bx - 2;
      const midX = slot.align === 'left' ? bx + chW + 26 : bx - 26;
      let prog: number, alpha: number;
      if (c.phase === 'grow') { prog = ease(Math.min(1, c.t / 0.85)); alpha = Math.min(1, prog * 1.5); }
      else if (c.phase === 'hold') { prog = 1; alpha = 1; }
      else { prog = 1; alpha = 1 - ease(Math.min(1, c.t / 0.8)); }
      const ctrlX = (q.sx + midX) / 2, ctrlY = ly;
      const pts: [number, number][] = [];
      const N = 24;
      for (let s = 0; s <= N; s++) {
        const u = s / N;
        pts.push([
          (1 - u) * (1 - u) * q.sx + 2 * (1 - u) * u * ctrlX + u * u * midX,
          (1 - u) * (1 - u) * q.sy + 2 * (1 - u) * u * ctrlY + u * u * ly,
        ]);
      }
      pts.push([endX, ly]);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha * 0.85;
      const grad = ctx.createLinearGradient(q.sx, q.sy, endX, ly);
      grad.addColorStop(0, 'rgba(139,127,247,.75)');
      grad.addColorStop(1, 'rgba(139,127,247,.28)');
      ctx.strokeStyle = grad; ctx.lineWidth = 1;
      const upto = Math.max(2, Math.floor(pts.length * prog));
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let s = 1; s < upto; s++) ctx.lineTo(pts[s][0], pts[s][1]);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(q.sx, q.sy, 4.2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#a855f7';
      ctx.beginPath(); ctx.arc(q.sx, q.sy, 1.3, 0, Math.PI * 2); ctx.fill();
      if (prog > 0.72 && alpha > 0.02) {
        ctx.globalAlpha = Math.min(1, (prog - 0.72) / 0.28) * alpha;
        const by = ly - chH / 2;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e4e0f7'; ctx.lineWidth = 1;
        roundRect(ctx, bx, by, chW, chH, 12); ctx.fill(); ctx.stroke();
        const dotX = slot.align === 'left' ? bx + 12 : bx + chW - 12;
        ctx.fillStyle = '#a855f7';
        ctx.beginPath(); ctx.arc(dotX, ly, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#46436a';
        ctx.fillText(label, slot.align === 'left' ? bx + 20 : bx + chW - 20 - tw, ly + 4);
        if (alpha > 0.6) this.labelRects.push({ x: bx, y: by, w: chW, h: chH, item: c.item });
      }
      ctx.restore();
    }
  }

  private draw = () => {
    if (!this.running) return;
    // 真实帧耗时滚动均值（performance.now 而非固定 dt），供慢帧自适应
    const nowMs = performance.now();
    if (this.lastFrameT) {
      const gap = nowMs - this.lastFrameT;
      // 忽略 >100ms 的间隔（后台标签页 vsync 暂停后的恢复帧），避免污染慢帧均值
      if (gap < 100) {
        this.frameAvg += (gap - this.frameAvg) * 0.05;
        if (this.frameAvg > 20 && this.introT > 2 && this.qLines === 1 && ++this.slowCnt > 90) this.qLines = 2;
      }
    }
    this.lastFrameT = nowMs;
    const dt = 1 / 60;
    if (this.burstT >= 0) { this.burstT += dt; if (this.burstT > 1.15) this.burstT = -1; }
    if (this.introEnabled) this.introT += dt;
    if (this.introEnabled && !this.introFired && this.introT > 1.65) {
      this.introFired = true;
      this.onIntroDoneCb?.();
    }
    const target = this.thinking ? 3 : 1;
    this.speedCur += (target - this.speedCur) * (this.reduceMotion ? 1 : 0.028);
    const speed = this.speedCur * 0.0032;
    this.rotY += this.reduceMotion ? 0 : speed;
    this.rotX = 0.3 + Math.sin(this.t * 0.35) * 0.12;
    this.t += this.reduceMotion ? 0 : dt;

    const { ctx, w, h } = this;
    // 入场淡入：粒子/连线/轨道环在最初 0.35s 渐显（物质化），避免全屏元素瞬闪
    const iFade = this.introEnabled && this.introT < 0.35 ? clamp01(this.introT / 0.35) : 1;
    ctx.clearRect(0, 0, w, h);
    const dark = this.mode === 'dark';
    const { proj, cx, cy, R, disp } = this.project();
    const slots = this.updateConns(proj, this.reduceMotion ? 0 : dt);

    const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.35);
    if (dark) {
      g.addColorStop(0, 'rgba(129,140,248,.07)'); g.addColorStop(1, 'rgba(168,85,247,0)');
    } else {
      g.addColorStop(0, 'rgba(99,102,241,.05)'); g.addColorStop(1, 'rgba(99,102,241,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, Math.PI * 2); ctx.fill();

    // —— 科技感元素 ——
    // 能量核心脉冲：中心亮核随呼吸律动，裂变时同步膨胀
    const pulse = this.reduceMotion ? 0.7 : 0.6 + 0.4 * Math.sin(this.t * 1.57);
    const coreSz = Math.max(10, R * (this.mini ? 1.35 : 0.30) * (0.85 + 0.3 * pulse) * (1 + disp * 0.7));
    ctx.globalAlpha = (0.55 + 0.35 * pulse) * iFade;
    ctx.drawImage(this.sprites[dark ? 'dark' : 'light'][18], cx - coreSz / 2, cy - coreSz / 2, coreSz, coreSz);
    ctx.globalAlpha = 1;

    // 陀螺仪轨道环 ×2：缓慢进动、随球俯仰、thinking 加速、裂变联动膨胀；每环 2 颗轨道粒子巡行
    if (!this.mini && R > 60) {
      const spin = this.speedCur;
      for (let ri = 0; ri < 2; ri++) {
        const ringR = R * (1.16 + ri * 0.17) * (1 + disp * 0.55);
        const tilt = this.rotX * 0.8 + (ri ? 1.05 : 0.35);
        const squash = Math.max(0.18, Math.abs(Math.cos(tilt)));
        const prec = this.t * (ri ? -0.10 : 0.16) * spin;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(prec);
        ctx.strokeStyle = dark ? `rgba(168,183,255,${0.26 * iFade})` : `rgba(99,102,241,${0.28 * iFade})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, ringR, ringR * squash, 0, 0, Math.PI * 2);
        ctx.stroke();
        for (let s = 0; s < 2; s++) {
          const th = this.t * (0.5 + 0.23 * ri + 0.17 * s) * spin + s * Math.PI + ri * 1.7;
          const px = Math.cos(th) * ringR, py = Math.sin(th) * ringR * squash;
          const sz = 7 + (s ? 0 : 3);
          ctx.globalAlpha = 0.85 * iFade;
          ctx.drawImage(this.sprites[dark ? 'dark' : 'light'][12], px - sz / 2, py - sz / 2, sz, sz);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
    }

    if (dark) ctx.globalCompositeOperation = 'lighter';
    // 星图连线 + 鼠标手电筒（附近连线点亮）
    ctx.lineWidth = dark ? 0.4 : 0.5;
    ctx.strokeStyle = dark ? '#8f7fe8' : '#6366f1';
    const mouseActive = this.interactive && this.mouse.x > -999 && !this.mini;
    if (!this.mini) for (let pI = 0; pI < this.pairs.length; pI += this.qLines) {
      const [i, j] = this.pairs[pI];
      const a = proj[i], b = proj[j];
      const depth = (a.persp + b.persp) / 2;
      if (depth < 0.9) continue;
      let alpha = (depth - 0.9) * (dark ? 0.30 : 0.16);
      if (mouseActive) {
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        const d = Math.hypot(mx - this.mouse.x, my - this.mouse.y);
        if (d < 130) alpha = Math.min(0.85, alpha * (1 + 2.4 * (1 - d / 130)));
      }
      ctx.globalAlpha = alpha * iFade;
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    // 粒子 + 亮星十字星芒
    const order = (this.mini ? this.orderMini : this.orderBuf)
      .sort((a, b) => proj[a].persp - proj[b].persp);
    const sprites = this.sprites[this.mode];
    const rscale = R / 123; // 粒子尺寸随球半径等比缩放：hero=1，morph 途中/移动端自动缩小
    for (const i of order) {
      const q = proj[i], p = this.pts[i];
      const dn = clamp01((q.persp - 0.64) / 0.92);
      let alpha: number, size: number;
      if (this.mini) {
        // 角落光珠：统一微光点 + 深度微调，配大柔光核心 —— 精致而非噪点糊
        alpha = 0.5 + dn * 0.4;
        size = 0.55 + dn * 0.75;
      } else if (dark && dn < 0.38) {
        const blur = 1 - dn / 0.38;
        alpha = 0.05 + dn * 0.22 + blur * 0.04;
        size = p.base * (2.6 - dn * 2.0) * (1 + blur * 1.2);
      } else if (!dark && dn < 0.3) {
        alpha = 0.05 + dn * 0.4;
        size = p.base * (0.9 - dn * 0.3);
      } else {
        alpha = 0.30 + (dn - 0.38) * 0.9;
        size = p.base * (dark ? (0.85 + dn * 1.35) : (0.8 + dn * 1.5));
      }
      if (!this.mini) {
        size *= rscale;
        if (p.bright) {
          const twv = 0.65 + Math.sin(this.t * 1.8 + p.tw) * 0.35;
          alpha = Math.min(1, alpha * (0.7 + twv * 0.6));
          size *= 1.25 + twv * 0.35;
        }
      }
      ctx.globalAlpha = Math.min(1, alpha) * iFade;
      ctx.drawImage(sprites[p.sprite], q.sx - size * 2, q.sy - size * 2, size * 4, size * 4);
      if (p.bright && dn > 0.55 && !this.mini) {
        const len = size * 4.2 * (0.7 + 0.3 * Math.sin(this.t * 2 + p.tw));
        ctx.globalAlpha = alpha * 0.28;
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(q.sx - len, q.sy); ctx.lineTo(q.sx + len, q.sy);
        ctx.moveTo(q.sx, q.sy - len); ctx.lineTo(q.sx, q.sy + len);
        ctx.stroke();
      }
    }
    // 文字吸收粒子：从下方飞向球面目标点（目标随球旋转实时更新）
    if (this.absorbers.length) {
      const alive: Absorber[] = [];
      for (const ab of this.absorbers) {
        ab.t += dt;
        const u = clamp01((ab.t - ab.delay) / ab.dur);
        if (u >= 1) continue;
        const e = 1 - Math.pow(1 - u, 2.4);
        const tgt = proj[ab.pi] || { sx: cx, sy: cy };
        const midX2 = (ab.x0 + tgt.sx) / 2, midY2 = Math.min(ab.y0, tgt.sy) - 30;
        const x = (1 - e) * (1 - e) * ab.x0 + 2 * (1 - e) * e * midX2 + e * e * tgt.sx;
        const y = (1 - e) * (1 - e) * ab.y0 + 2 * (1 - e) * e * midY2 + e * e * tgt.sy;
        ctx.globalAlpha = Math.sin(Math.PI * u) * 0.9;
        const s = 1.6 + e * 1.2;
        ctx.drawImage(sprites[ab.sprite], x - s * 2, y - s * 2, s * 4, s * 4);
        alive.push(ab);
      }
      this.absorbers = alive;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (this.burstT >= 0) {
      const bp = this.burstT / 1.15;
      for (let k = 0; k < 2; k++) {
        const lp = (bp - k * 0.13) / (1 - k * 0.13);
        if (lp <= 0 || lp >= 1) continue;
        ctx.globalAlpha = (1 - lp) * 0.35;
        ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1.5 * (1 - lp) + 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, R * (0.5 + lp * 1.6), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    this.drawConns(ctx, proj, slots);
    this.rafId = requestAnimationFrame(this.draw);
  };
}

const ParticleSphere = forwardRef<ParticleSphereHandle, ParticleSphereProps>(function ParticleSphere({
  width = 300, height, mode = 'light', thinking = false, streaming = false, burstSignal = 0,
  intro = true, onIntroDone, viewBox, kbLine = false, kbItems = [], onLabelClick, dots, interactive = true, className, style,
}, ref) {
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SphereEngine | null>(null);
  const baseDots = dots ?? (isMobile ? 1000 : 2200);

  const vbRef = useRef(viewBox);
  vbRef.current = viewBox;

  // useLayoutEffect：无入场的重建在绘制前同步画好首帧（零空白帧）；带入场路径只调度 rAF，布局阶段零开销
  useLayoutEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let engine: SphereEngine | null = null;
    let raf2 = 0;
    const create = () => {
      engine = new SphereEngine(cv, {
        mode, kbLine, dots: baseDots, interactive, intro, onIntroDone,
      });
      engine.kbItems = kbItems;
      engineRef.current = engine;
      if (vbRef.current) engine.setViewBox(vbRef.current);
      engine.resize();
    };
    // 带入场动画的首挂载：延迟一帧，让页面先完成首绘（重载不卡）；
    // 无入场的挂载（如 Portal 换回页面内重建）：同步创建并立即画首帧，杜绝一帧空白闪烁
    let raf = 0;
    if (intro) {
      raf = requestAnimationFrame(() => {
        create();
        raf2 = requestAnimationFrame(() => engineRef.current?.resize());
      });
    } else {
      create();
    }
    // 球在 中心↔左上角 morph 期间尺寸连续变化，ResizeObserver 实时重设画布
    const ro = new ResizeObserver(() => engineRef.current?.resize());
    ro.observe(cv);
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(raf2); ro.disconnect(); engine?.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setViewBox(viewBox ?? null);
  }, [viewBox]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (thinking && !e.thinking) e.fadeConns();
    e.thinking = thinking;
    e.streaming = streaming;
    e.mode = mode;
    e.kbItems = kbItems;
    e.onLabelClick = onLabelClick ?? null;
  }, [thinking, streaming, mode, kbItems, onLabelClick]);

  const prevBurst = useRef(burstSignal);
  useEffect(() => {
    if (burstSignal > prevBurst.current) engineRef.current?.burst();
    prevBurst.current = burstSignal;
  }, [burstSignal]);

  useImperativeHandle(ref, () => ({
    absorbText: (text: string) => engineRef.current?.absorbText(text),
    setViewBox: (vb: { cx: number; cy: number; r: number } | null) => engineRef.current?.setViewBox(vb),
  }), []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: width as number | string, height: (height ?? width) as number | string, display: 'block', ...style }}
      aria-hidden="true"
    />
  );
});

export default ParticleSphere;

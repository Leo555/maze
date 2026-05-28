/**
 * Canvas 渲染器
 *
 * 设计：
 *   - 自适应缩放：根据窗口大小决定 cellSize，确保迷宫居中显示
 *   - 雾气视野：通过径向渐变遮罩实现"光圈视野"
 *   - 已探索记忆：visited 数组记录走过的格子，雾外仍然可看到淡色轮廓
 *   - 拖尾：在玩家身后短暂留下渐淡的光斑
 *   - HiDPI：自动适配 devicePixelRatio
 */

import type { Maze } from '../maze/Generator';
import type { Theme } from '../config/theme';
import type { Player } from '../entities/Player';
import type { Entity } from '../maze/LevelBuilder';
import type { ParticleSystem } from '../fx/Particles';
import { VISION_RADIUS } from '../config/levels';
import type { LevelConfig } from '../config/levels';
import type { Path } from './types';

interface RenderContext {
  cellSize: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  // === 静态层离屏缓存 ===
  // 把每帧固定不变的「背景 + 地板 + 墙体阴影 + 墙体」预渲染到一张离屏 canvas，
  // 主循环只需 drawImage 一次即可。仅在 maze / 主题 / 尺寸变化时失效。
  // 31×31 关卡每帧可省下数千次 fillRect → 显著降低 Canvas 负担。
  private staticLayer: HTMLCanvasElement | null = null;
  private staticDirty = true;
  private staticKey = ''; // 缓存 key：mazeRef + theme.name + dpr + cssSize
  private lastMaze: Maze | null = null;
  private lastTheme: Theme | null = null;

  // 已探索的格子（用于在雾外保留淡淡的轮廓）
  visited: boolean[][] = [];

  // resize 节流（rAF）
  private resizePending = false;

  // 完整地图揭示倒计时（晨雾灯效果）
  // revealStart：本次揭示开始时间（用于散开动画）
  // revealUntil：揭示彻底结束时间（用于聚拢动画与判定是否揭示中）
  revealStart = 0;
  revealUntil = 0;

  // 关卡完成动画（0=正常，>0 表示渐隐进度）
  fadeOut = 0;

  // 关卡进入动画（0~1，从 0 渐显）
  fadeIn = 1;

  // 屏幕震动
  shakeAmount = 0;
  shakeTime = 0;

  // 彩蛋 / 复盘：显示最佳路径（覆盖在迷宫之上）
  // bestPath = 路径格子序列；为 null 时不绘制。由用户手动关闭，不自动消失
  bestPath: Path | null = null;
  // 复盘：显示玩家实际走过的路径（与 bestPath 同时显示用于对比）
  playerPath: Path | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
  }

  resize = (): void => {
    // 节流：连续 resize 事件合并到下一帧统一执行
    if (this.resizePending) return;
    this.resizePending = true;
    requestAnimationFrame(this.applyResize);
  };

  private applyResize = (): void => {
    this.resizePending = false;
    // dpr 上限 3：4K 屏 / 部分 retina 平板有 dpr=2.5/3 但视觉收益已饱和，
    // 再往上只会拖性能与显存（静态层 canvas 体积是 dpr² 倍增长）
    const rawDpr = window.devicePixelRatio || 1;
    this.dpr = Math.min(rawDpr, 3);
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;
    // 用 round 而非 floor，避免某些 dpr（如 1.25 / 1.5）下丢半像素后被浏览器二次插值导致的墙边羽化
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    // 关闭主 ctx 的图像平滑：drawImage 静态层时不做插值，墙边保持锐利
    this.ctx.imageSmoothingEnabled = false;
    this.staticDirty = true; // 尺寸变化 → 静态层需重建
  };

  resetVisited(maze: Maze): void {
    this.visited = [];
    for (let y = 0; y < maze.height; y++) {
      this.visited.push(new Array(maze.width).fill(false));
    }
    this.visited[maze.start.y][maze.start.x] = true;
    this.fadeIn = 1;
    this.fadeOut = 0;
    this.revealStart = 0;
    this.revealUntil = 0;
    this.bestPath = null;
    this.playerPath = null;
    this.staticDirty = true; // 新关卡 → 静态层需重建
  }

  markVisited(x: number, y: number): void {
    if (this.visited[y]) this.visited[y][x] = true;
  }

  triggerShake(amount = 4, duration = 0.18): void {
    this.shakeAmount = amount;
    this.shakeTime = duration;
  }

  triggerReveal(seconds: number): void {
    const now = performance.now() / 1000;
    // 仅在本次拾取真的延长时间时才重置 start，避免连续拾取每次都从头淡出
    const newUntil = Math.max(this.revealUntil, now + seconds);
    if (this.revealUntil <= now) {
      // 上次揭示已结束，本次是全新一次拾取 → 重置 start 触发开头淡出
      this.revealStart = now;
    }
    this.revealUntil = newUntil;
  }

  triggerFadeOut(): void {
    this.fadeOut = 0.001;
  }

  /**
   * 彩蛋：显示最佳路径，持续显示直到调用 clearBestPath() 主动关闭。
   * 路径绘制在迷宫之上、雾遮罩之下，配合发光效果突出显示。
   */
  showBestPath(cells: Path): void {
    this.bestPath = cells.length > 0 ? cells : null;
  }

  /** 立刻清除最佳路径（关卡切换 / 用户主动关闭时调用） */
  clearBestPath(): void {
    this.bestPath = null;
  }

  /**
   * 复盘：显示玩家实际走过的路径（含回头与绕路）。
   * 与 bestPath 一起显示用于对比；颜色低饱和、线宽较细，避免压过最优路径主线。
   */
  showPlayerPath(cells: Path): void {
    this.playerPath = cells.length > 0 ? cells : null;
  }

  clearPlayerPath(): void {
    this.playerPath = null;
  }

  /** 计算当前布局参数 */
  private layout(maze: Maze): RenderContext {
    // 自适应外边距：让迷宫尽可能占满屏幕
    //   - 桌面（宽屏）：留 32px 让外圈光晕/雾气更柔和
    //   - 平板：24px
    //   - 手机：12px（顶部 HUD 与底部小地图通过半透明叠在迷宫上）
    const minSide = Math.min(this.cssWidth, this.cssHeight);
    let margin: number;
    if (minSide < 420) margin = 8;
    else if (minSide < 720) margin = 16;
    else margin = 32;

    const availW = this.cssWidth - margin * 2;
    const availH = this.cssHeight - margin * 2;
    const cellSize = Math.floor(Math.min(availW / maze.width, availH / maze.height));
    const totalW = cellSize * maze.width;
    const totalH = cellSize * maze.height;
    return {
      cellSize,
      offsetX: Math.floor((this.cssWidth - totalW) / 2),
      offsetY: Math.floor((this.cssHeight - totalH) / 2),
      width: totalW,
      height: totalH,
    };
  }

  update(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) {
        this.shakeTime = 0;
        this.shakeAmount = 0;
      }
    }
    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt / 0.6);
    }
    if (this.fadeOut > 0 && this.fadeOut < 1) {
      this.fadeOut = Math.min(1, this.fadeOut + dt / 1.0);
    }
  }

  draw(
    maze: Maze,
    theme: Theme,
    config: LevelConfig,
    player: Player,
    entities: Entity[],
    particles: ParticleSystem
  ): void {
    const ctx = this.ctx;
    const layout = this.layout(maze);

    // 画布尺寸过小或迷宫尺寸异常时跳过绘制，避免下游渐变 / 几何参数为 0 导致异常
    if (layout.cellSize <= 0 || this.cssWidth <= 0 || this.cssHeight <= 0) {
      return;
    }

    // 检查静态层是否需要重建（maze 实例 / theme 引用 / dpr / 尺寸 变更时）
    this.ensureStaticLayer(maze, theme, layout);

    // === 整体设置 ===
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 屏幕震动
    if (this.shakeAmount > 0) {
      const sx = (Math.random() - 0.5) * 2 * this.shakeAmount;
      const sy = (Math.random() - 0.5) * 2 * this.shakeAmount;
      ctx.translate(sx, sy);
    }

    // === 静态层（背景 + 地板 + 墙体阴影 + 墙体）一次 drawImage 贴上 ===
    if (this.staticLayer) {
      ctx.drawImage(this.staticLayer, 0, 0, this.cssWidth, this.cssHeight);
    }

    // === 已探索区域底色 ===
    this.drawExploredOverlay(ctx, maze, theme, layout);

    // === 出口 ===
    this.drawExit(ctx, maze, theme, layout);

    // === 实体（道具） ===
    this.drawEntities(ctx, theme, entities, layout);

    // === 玩家 ===
    this.drawPlayer(ctx, theme, player, layout);

    // === 粒子 ===
    particles.draw(ctx, layout.cellSize, layout.offsetX, layout.offsetY);

    // === 视野遮罩 ===
    this.drawFog(ctx, theme, config, player, layout);

    // === 彩蛋 / 复盘：路径叠加（穿透雾气显示） ===
    // 玩家路径先画（在底层，作为对比参考），最佳路径后画（金色亮线在上层视觉强突出）
    if (this.playerPath) {
      this.drawPlayerPath(ctx, layout);
    }
    if (this.bestPath) {
      this.drawBestPath(ctx, theme, layout);
    }

    // === 进入/退出渐变 ===
    if (this.fadeIn > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${this.fadeIn})`;
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    }
    if (this.fadeOut > 0) {
      ctx.fillStyle = `rgba(245, 239, 230, ${this.fadeOut * 0.85})`;
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    }

    ctx.restore();
  }

  /**
   * 确保静态层缓存有效。
   * 关卡 / 主题 / 视口尺寸变化时触发重建：
   *   - 创建一张 cssWidth × cssHeight × dpr 的离屏 canvas
   *   - 一次性把背景、地板、墙阴影、墙体绘制上去
   *   - 后续每帧直接 drawImage 一次即可（DPR 由 ctx.scale 还原）
   */
  private ensureStaticLayer(maze: Maze, theme: Theme, layout: RenderContext): void {
    const key = `${this.cssWidth}x${this.cssHeight}@${this.dpr}|${theme.bg}`;
    const mazeChanged = this.lastMaze !== maze;
    const themeChanged = this.lastTheme !== theme;
    const sizeChanged = this.staticKey !== key;
    if (!this.staticDirty && !mazeChanged && !themeChanged && !sizeChanged && this.staticLayer) {
      return;
    }

    const w = Math.round(this.cssWidth * this.dpr);
    const h = Math.round(this.cssHeight * this.dpr);
    if (w <= 0 || h <= 0) return;

    // 复用已有 canvas（仅尺寸不一致时重建），避免反复分配大块显存
    if (!this.staticLayer || this.staticLayer.width !== w || this.staticLayer.height !== h) {
      this.staticLayer = document.createElement('canvas');
      this.staticLayer.width = w;
      this.staticLayer.height = h;
    }
    const sctx = this.staticLayer.getContext('2d');
    if (!sctx) return;

    sctx.setTransform(1, 0, 0, 1, 0, 0); // 重置
    sctx.clearRect(0, 0, w, h);
    // 关闭离屏 ctx 的图像平滑，让墙体/地板的硬边在 dpr 缩放下不被重新插值
    sctx.imageSmoothingEnabled = false;
    sctx.scale(this.dpr, this.dpr);

    // 背景
    sctx.fillStyle = theme.bg;
    sctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // 地板 + 墙体（一次性绘制到离屏）
    this.drawFloor(sctx, theme, layout);
    this.drawWalls(sctx, maze, theme, layout);

    this.staticDirty = false;
    this.staticKey = key;
    this.lastMaze = maze;
    this.lastTheme = theme;
  }

  private drawFloor(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    layout: RenderContext
  ): void {
    ctx.fillStyle = theme.floor;
    ctx.fillRect(layout.offsetX, layout.offsetY, layout.width, layout.height);
  }

  private drawExploredOverlay(
    ctx: CanvasRenderingContext2D,
    maze: Maze,
    theme: Theme,
    layout: RenderContext
  ): void {
    // 性能优化：用单一 Path2D 累加所有已访问格子，一次 fill 完成。
    // 这是每帧调用的热路径，N×N 关卡若用 fillRect 逐次调用代价显著。
    const cs = layout.cellSize;
    const path = new Path2D();
    let hit = false;
    for (let y = 0; y < maze.height; y++) {
      const row = this.visited[y];
      if (!row) continue;
      for (let x = 0; x < maze.width; x++) {
        if (row[x]) {
          path.rect(layout.offsetX + x * cs, layout.offsetY + y * cs, cs, cs);
          hit = true;
        }
      }
    }
    if (!hit) return;
    ctx.fillStyle = theme.floorAccent;
    ctx.globalAlpha = 0.5;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }

  private drawExit(
    ctx: CanvasRenderingContext2D,
    maze: Maze,
    theme: Theme,
    layout: RenderContext
  ): void {
    const cs = layout.cellSize;
    const ex = layout.offsetX + maze.exit.x * cs;
    const ey = layout.offsetY + maze.exit.y * cs;
    const cx = ex + cs / 2;
    const cy = ey + cs / 2;

    // 出口光晕
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2);
    const radius = cs * (0.45 + pulse * 0.12);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, theme.exit);
    grad.addColorStop(0.5, this.hexToRgba(theme.exit, 0.5));
    grad.addColorStop(1, this.hexToRgba(theme.exit, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(ex - cs * 0.3, ey - cs * 0.3, cs * 1.6, cs * 1.6);

    // 出口标记
    ctx.fillStyle = theme.exit;
    const inner = cs * 0.4;
    this.roundRect(ctx, cx - inner / 2, cy - inner / 2, inner, inner, cs * 0.08);
    ctx.fill();
  }

  private drawEntities(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    entities: Entity[],
    layout: RenderContext
  ): void {
    const cs = layout.cellSize;
    const t = performance.now() / 1000;

    for (const e of entities) {
      if (!e.active) continue;
      const cx = layout.offsetX + (e.x + 0.5) * cs;
      const cy = layout.offsetY + (e.y + 0.5) * cs;
      const float = Math.sin(t * 2 + e.x + e.y) * cs * 0.04;

      switch (e.kind) {
        case 'key':
          this.drawKey(ctx, cx, cy + float, cs, theme.accent);
          break;
        case 'hourglass':
          this.drawHourglass(ctx, cx, cy + float, cs, theme.accent);
          break;
        case 'map_shard':
          this.drawMapShard(ctx, cx, cy + float, cs, theme.accent);
          break;
        default:
          break;
      }
    }
  }

  private drawKey(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cs: number,
    color: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    // 光晕
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, cs * 0.45);
    grad.addColorStop(0, this.hexToRgba(color, 0.5));
    grad.addColorStop(1, this.hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, cs * 0.45, 0, Math.PI * 2);
    ctx.fill();
    // 钥匙形状（圆环 + 矩形齿）
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-cs * 0.08, 0, cs * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(0, -cs * 0.04, cs * 0.22, cs * 0.08);
    ctx.fillRect(cs * 0.16, -cs * 0.04, cs * 0.04, cs * 0.12);
    ctx.restore();
  }

  private drawHourglass(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cs: number,
    color: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = this.hexToRgba(color, 0.3);
    ctx.beginPath();
    ctx.arc(0, 0, cs * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    const w = cs * 0.22;
    const h = cs * 0.28;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(0, 0);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawMapShard(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cs: number,
    color: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 6);
    ctx.fillStyle = this.hexToRgba(color, 0.3);
    ctx.beginPath();
    ctx.arc(0, 0, cs * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    const s = cs * 0.22;
    this.roundRect(ctx, -s / 2, -s / 2, s, s, cs * 0.04);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.2);
    ctx.lineTo(s * 0.3, s * 0.2);
    ctx.moveTo(-s * 0.1, s * 0.3);
    ctx.lineTo(s * 0.3, -s * 0.1);
    ctx.stroke();
    ctx.restore();
  }

  private drawWalls(
    ctx: CanvasRenderingContext2D,
    maze: Maze,
    theme: Theme,
    layout: RenderContext
  ): void {
    const cs = layout.cellSize;
    // 墙厚度对齐到 2 的倍数：保证 wallThickness/2 仍是整数 → 偏移落在像素边界，不被亚像素抗锯齿吃糊
    const rawT = Math.max(2, Math.round(cs * 0.18));
    const wallThickness = rawT % 2 === 0 ? rawT : rawT + 1;
    const half = wallThickness / 2;
    const shadowOffset = Math.max(1, Math.round(cs * 0.04)); // 之前固定 +2，按 cellSize 自适应

    // 性能优化：用 Path2D 批处理代替逐次 fillRect。
    // 同色矩形累加进一个 path → 一次 fill()，可省下 90%+ 的 fillStyle / 提交开销。
    // 静态层只在关卡切换时跑一次，但 cellCount × 2~4 条墙可能多达数千次，仍值得。

    // 1) 阴影层：S / E 墙的偏移投影
    const shadowPath = new Path2D();
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const c = maze.cells[y][x];
        const px = layout.offsetX + x * cs;
        const py = layout.offsetY + y * cs;
        if (c.walls.S) {
          shadowPath.rect(px - half + shadowOffset, py + cs - half + shadowOffset, cs + wallThickness, wallThickness);
        }
        if (c.walls.E) {
          shadowPath.rect(px + cs - half + shadowOffset, py - half + shadowOffset, wallThickness, cs + wallThickness);
        }
      }
    }
    ctx.fillStyle = theme.wallShadow;
    ctx.fill(shadowPath);

    // 2) 主墙体：N / W / S / E 四面
    const wallPath = new Path2D();
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const c = maze.cells[y][x];
        const px = layout.offsetX + x * cs;
        const py = layout.offsetY + y * cs;
        if (c.walls.N) {
          wallPath.rect(px - half, py - half, cs + wallThickness, wallThickness);
        }
        if (c.walls.W) {
          wallPath.rect(px - half, py - half, wallThickness, cs + wallThickness);
        }
        if (c.walls.S) {
          wallPath.rect(px - half, py + cs - half, cs + wallThickness, wallThickness);
        }
        if (c.walls.E) {
          wallPath.rect(px + cs - half, py - half, wallThickness, cs + wallThickness);
        }
      }
    }
    ctx.fillStyle = theme.wall;
    ctx.fill(wallPath);
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    player: Player,
    layout: RenderContext
  ): void {
    const cs = layout.cellSize;
    const cx = layout.offsetX + (player.state.px + 0.5) * cs;
    const cy = layout.offsetY + (player.state.py + 0.5) * cs;

    // 玩家光晕
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.8);
    glowGrad.addColorStop(0, theme.playerGlow);
    glowGrad.addColorStop(1, this.hexToRgba(theme.player, 0));
    ctx.fillStyle = glowGrad;
    ctx.fillRect(cx - cs, cy - cs, cs * 2, cs * 2);

    // 玩家本体（圆角方块 + 朝向小三角）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.state.rotation);
    const size = cs * 0.55;
    ctx.fillStyle = theme.player;
    this.roundRect(ctx, -size / 2, -size / 2, size, size, cs * 0.1);
    ctx.fill();
    // 朝向小三角
    ctx.fillStyle = theme.bg;
    ctx.beginPath();
    ctx.moveTo(size * 0.1, -size * 0.18);
    ctx.lineTo(size * 0.32, 0);
    ctx.lineTo(size * 0.1, size * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawFog(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    config: LevelConfig,
    player: Player,
    layout: RenderContext
  ): void {
    const radius = VISION_RADIUS[config.vision];
    if (radius >= 100) return;

    // 「晨雾灯」效果：在 reveal 期间整体淡化雾，并在头尾各 FADE 秒做平滑过渡，
    // 营造"雾散开 → 看清布局 → 雾重新聚拢"的诗意呼吸感，而非生硬的开关。
    const now = performance.now() / 1000;
    let fogIntensity = 1; // 1 = 完全显雾；0 = 雾完全散开
    if (now < this.revealUntil) {
      const FADE = 0.6; // 散开/聚拢的过渡时长（秒）
      const sinceStart = now - this.revealStart;
      const untilEnd = this.revealUntil - now;
      // 开头 FADE 秒：1 → 0（雾散开）
      // 中间稳定阶段：0（完全无雾）
      // 结尾 FADE 秒：0 → 1（雾聚拢）
      // 取两端淡化值的较大者，自然处理"短揭示（< 2*FADE）头尾交叠"的边界情况
      const fadeOutFromStart = sinceStart < FADE ? 1 - sinceStart / FADE : 0;
      const fadeInToEnd = untilEnd < FADE ? 1 - untilEnd / FADE : 0;
      fogIntensity = Math.max(fadeOutFromStart, fadeInToEnd);
    }
    if (fogIntensity <= 0.001) return;

    const cs = layout.cellSize;
    const cx = layout.offsetX + (player.state.px + 0.5) * cs;
    const cy = layout.offsetY + (player.state.py + 0.5) * cs;
    const r = radius * cs;

    // 把 theme.fog 的 alpha 乘以 fogIntensity，实现整体淡入淡出
    const fadedFog = this.scaleFogAlpha(theme.fog, fogIntensity);
    const fadedFogMid = this.scaleFogAlpha(theme.fog, fogIntensity * 0.36);

    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, fadedFogMid);
    grad.addColorStop(1, fadedFog);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  /** 把 rgba(r,g,b,a) 字符串里的 alpha 乘以 mul，返回新的 rgba 字符串 */
  private scaleFogAlpha(rgba: string, mul: number): string {
    // 形如 rgba(60, 75, 100, 0.22) → 提取数字 + 替换 alpha
    const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (!m) return rgba;
    const r = m[1];
    const g = m[2];
    const b = m[3];
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    const finalA = Math.max(0, Math.min(1, a * mul));
    return `rgba(${r}, ${g}, ${b}, ${finalA.toFixed(3)})`;
  }

  /**
   * 彩蛋：绘制最佳路径
   *   - 主色：theme.exit（出口色，自然又显眼）
   *   - 双层线：外层柔和发光（高斯感），内层主色高亮
   *   - 头尾两端的剩余时长 t（0~1）做整体淡入淡出，避免突兀消失
   *   - 沿路径还点缀一些小圆点，配合波动呼吸增强动效
   */
  private drawBestPath(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    layout: RenderContext
  ): void {
    if (!this.bestPath || this.bestPath.length < 2) return;
    const cs = layout.cellSize;
    const ox = layout.offsetX;
    const oy = layout.offsetY;

    // 路径常驻显示，仅做呼吸动效（无淡出）
    const t = performance.now() / 600;

    ctx.save();

    // 1) 外层光晕：粗、半透明
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.hexToRgba(theme.exit, 0.32);
    ctx.lineWidth = cs * 0.42;
    ctx.beginPath();
    for (let i = 0; i < this.bestPath.length; i++) {
      const c = this.bestPath[i];
      const px = ox + (c.x + 0.5) * cs;
      const py = oy + (c.y + 0.5) * cs;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // 2) 内层亮线
    ctx.strokeStyle = this.hexToRgba(theme.exit, 0.95);
    ctx.lineWidth = cs * 0.18;
    ctx.stroke();

    // 3) 沿途点：每隔 2 个格放一个小圆点，呼吸缩放
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI);
    ctx.fillStyle = this.hexToRgba('#ffffff', 0.85);
    for (let i = 1; i < this.bestPath.length - 1; i += 2) {
      const c = this.bestPath[i];
      const px = ox + (c.x + 0.5) * cs;
      const py = oy + (c.y + 0.5) * cs;
      ctx.beginPath();
      ctx.arc(px, py, cs * (0.05 + 0.025 * pulse), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ============ 工具 ============
  /**
   * 复盘：绘制玩家实际走过的路径
   *   - 用低饱和的「玩家蓝」色（区别于金色最优路径）
   *   - 单层细线，无发光效果，避免压过最优路径主线
   *   - 重叠段会被后续 drawBestPath 的金线覆盖（视觉上自然形成"重合处贴着金线"的效果）
   *   - 使用 Path2D 单次 stroke，开销极低
   */
  private drawPlayerPath(
    ctx: CanvasRenderingContext2D,
    layout: RenderContext
  ): void {
    if (!this.playerPath || this.playerPath.length < 2) return;
    const cs = layout.cellSize;
    const ox = layout.offsetX;
    const oy = layout.offsetY;

    const path = new Path2D();
    for (let i = 0; i < this.playerPath.length; i++) {
      const c = this.playerPath[i];
      const px = ox + (c.x + 0.5) * cs;
      const py = oy + (c.y + 0.5) * cs;
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 外层柔光（半透明、稍粗）
    ctx.strokeStyle = 'rgba(80, 110, 170, 0.28)';
    ctx.lineWidth = cs * 0.32;
    ctx.stroke(path);
    // 内层主线
    ctx.strokeStyle = 'rgba(80, 110, 170, 0.9)';
    ctx.lineWidth = cs * 0.12;
    ctx.stroke(path);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private hexToRgba(input: string, a: number): string {
    if (input.startsWith('rgba') || input.startsWith('rgb')) {
      // 已经是 rgba/rgb，直接返回（忽略 a 调整）
      return input;
    }
    const hex = input.replace('#', '');
    let r: number, g: number, b: number;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
}

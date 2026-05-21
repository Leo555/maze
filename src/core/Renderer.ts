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

  // 已探索的格子（用于在雾外保留淡淡的轮廓）
  visited: boolean[][] = [];

  // 完整地图揭示倒计时（地图碎片效果）
  revealUntil = 0;

  // 关卡完成动画（0=正常，>0 表示渐隐进度）
  fadeOut = 0;

  // 关卡进入动画（0~1，从 0 渐显）
  fadeIn = 1;

  // 屏幕震动
  shakeAmount = 0;
  shakeTime = 0;

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
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;
    this.canvas.width = Math.floor(this.cssWidth * this.dpr);
    this.canvas.height = Math.floor(this.cssHeight * this.dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
  };

  resetVisited(maze: Maze): void {
    this.visited = [];
    for (let y = 0; y < maze.height; y++) {
      this.visited.push(new Array(maze.width).fill(false));
    }
    this.visited[maze.start.y][maze.start.x] = true;
    this.fadeIn = 1;
    this.fadeOut = 0;
    this.revealUntil = 0;
  }

  markVisited(x: number, y: number): void {
    if (this.visited[y]) this.visited[y][x] = true;
  }

  triggerShake(amount = 4, duration = 0.18): void {
    this.shakeAmount = amount;
    this.shakeTime = duration;
  }

  triggerReveal(seconds: number): void {
    this.revealUntil = Math.max(this.revealUntil, performance.now() / 1000 + seconds);
  }

  triggerFadeOut(): void {
    this.fadeOut = 0.001;
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

    // === 整体设置 ===
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 背景
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // 屏幕震动
    if (this.shakeAmount > 0) {
      const sx = (Math.random() - 0.5) * 2 * this.shakeAmount;
      const sy = (Math.random() - 0.5) * 2 * this.shakeAmount;
      ctx.translate(sx, sy);
    }

    // === 地板 ===
    this.drawFloor(ctx, maze, theme, layout);

    // === 已探索区域底色 ===
    this.drawExploredOverlay(ctx, maze, theme, layout);

    // === 出口 ===
    this.drawExit(ctx, maze, theme, layout);

    // === 实体（道具） ===
    this.drawEntities(ctx, theme, entities, layout);

    // === 墙体 ===
    this.drawWalls(ctx, maze, theme, layout);

    // === 玩家 ===
    this.drawPlayer(ctx, theme, player, layout);

    // === 粒子 ===
    particles.draw(ctx, layout.cellSize, layout.offsetX, layout.offsetY);

    // === 视野遮罩 ===
    this.drawFog(ctx, theme, config, player, layout);

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

  private drawFloor(
    ctx: CanvasRenderingContext2D,
    _maze: Maze,
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
    ctx.fillStyle = theme.floorAccent;
    ctx.globalAlpha = 0.5;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (this.visited[y]?.[x]) {
          ctx.fillRect(
            layout.offsetX + x * layout.cellSize,
            layout.offsetY + y * layout.cellSize,
            layout.cellSize,
            layout.cellSize
          );
        }
      }
    }
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
        case 'dash_shoes':
          this.drawDashShoes(ctx, cx, cy + float, cs, theme.accent);
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

  private drawDashShoes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cs: number,
    color: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-cs * 0.18, 0);
    ctx.lineTo(cs * 0.18, -cs * 0.1);
    ctx.lineTo(cs * 0.18, cs * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawWalls(
    ctx: CanvasRenderingContext2D,
    maze: Maze,
    theme: Theme,
    layout: RenderContext
  ): void {
    const cs = layout.cellSize;
    const wallThickness = Math.max(2, cs * 0.18);
    const half = wallThickness / 2;

    // 阴影层
    ctx.fillStyle = theme.wallShadow;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const c = maze.cells[y][x];
        const px = layout.offsetX + x * cs;
        const py = layout.offsetY + y * cs;
        if (c.walls.S) {
          ctx.fillRect(px - half + 2, py + cs - half + 2, cs + wallThickness, wallThickness);
        }
        if (c.walls.E) {
          ctx.fillRect(px + cs - half + 2, py - half + 2, wallThickness, cs + wallThickness);
        }
      }
    }

    // 主墙体
    ctx.fillStyle = theme.wall;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const c = maze.cells[y][x];
        const px = layout.offsetX + x * cs;
        const py = layout.offsetY + y * cs;
        if (c.walls.N) {
          ctx.fillRect(px - half, py - half, cs + wallThickness, wallThickness);
        }
        if (c.walls.W) {
          ctx.fillRect(px - half, py - half, wallThickness, cs + wallThickness);
        }
        if (c.walls.S) {
          ctx.fillRect(px - half, py + cs - half, cs + wallThickness, wallThickness);
        }
        if (c.walls.E) {
          ctx.fillRect(px + cs - half, py - half, wallThickness, cs + wallThickness);
        }
      }
    }
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
    const revealing = performance.now() / 1000 < this.revealUntil;
    if (revealing) return;

    const cs = layout.cellSize;
    const cx = layout.offsetX + (player.state.px + 0.5) * cs;
    const cy = layout.offsetY + (player.state.py + 0.5) * cs;
    const r = radius * cs;

    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, this.hexToRgba(theme.fog.replace(/[\d.]+\)/, '0.2)'), 0.2));
    grad.addColorStop(1, theme.fog);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  // ============ 工具 ============
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

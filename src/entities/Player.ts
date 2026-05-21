/**
 * 玩家：网格步进缓动移动
 *
 * 状态机：
 *   - idle：在某格中心，可接受新指令
 *   - moving：从 (fromX, fromY) 朝 (toX, toY) 平滑过渡，progress ∈ [0, 1]
 *
 * 移动指令：通过 tryMove(dir) 触发，会校验墙体后启动一次步进
 */

import type { Maze, Dir } from '../maze/Generator';
import { Easing } from '../core/utils';

const DIR_TO_KEY: Record<string, Dir> = {
  up: 'N',
  down: 'S',
  left: 'W',
  right: 'E',
};

const DXY: Record<Dir, [number, number]> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

export interface PlayerState {
  // 网格坐标
  gx: number;
  gy: number;
  // 像素插值（renderer 直接用）
  px: number;
  py: number;
  // 朝向角度（弧度，0=右）
  rotation: number;
  // 是否在移动中
  moving: boolean;
}

export class Player {
  state: PlayerState;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private progress = 0;
  private stepDuration = 0.15; // 秒
  private dashCooldown = 0; // 剩余冷却秒
  private dashCooldownMax = 3;
  private dashing = false;
  private dashStepsLeft = 0;
  // 移动事件回调
  onArrive: ((gx: number, gy: number) => void) | null = null;
  onBump: ((dir: string) => void) | null = null;
  onStep: (() => void) | null = null;

  constructor(gx: number, gy: number) {
    this.state = {
      gx,
      gy,
      px: gx,
      py: gy,
      rotation: 0,
      moving: false,
    };
    this.fromX = this.toX = gx;
    this.fromY = this.toY = gy;
  }

  isIdle(): boolean {
    return !this.state.moving;
  }

  getDashCooldownRatio(): number {
    return 1 - this.dashCooldown / this.dashCooldownMax;
  }

  tryMove(maze: Maze, dir: 'up' | 'down' | 'left' | 'right'): boolean {
    if (!this.isIdle()) return false;
    const d = DIR_TO_KEY[dir];
    if (!d) return false;

    // 旋转角度（始终面向移动方向）
    this.state.rotation = { N: -Math.PI / 2, S: Math.PI / 2, W: Math.PI, E: 0 }[d];

    if (!maze.canMove(this.state.gx, this.state.gy, d)) {
      this.onBump?.(dir);
      return false;
    }

    const [dx, dy] = DXY[d];
    this.fromX = this.state.gx;
    this.fromY = this.state.gy;
    this.toX = this.state.gx + dx;
    this.toY = this.state.gy + dy;
    this.progress = 0;
    this.state.moving = true;
    this.onStep?.();
    return true;
  }

  triggerDash(): boolean {
    if (this.dashCooldown > 0) return false;
    this.dashCooldown = this.dashCooldownMax;
    this.dashing = true;
    this.dashStepsLeft = 4; // 短冲刺：连续快速 4 步
    return true;
  }

  /** 是否处于冲刺中（可让外部加速持续按住的方向） */
  isDashing(): boolean {
    return this.dashing && this.dashStepsLeft > 0;
  }

  consumeDashStep(): void {
    if (this.dashStepsLeft > 0) this.dashStepsLeft--;
    if (this.dashStepsLeft <= 0) this.dashing = false;
  }

  /** 当前每步耗时（冲刺时缩短） */
  currentStepDuration(): number {
    return this.dashing ? this.stepDuration * 0.55 : this.stepDuration;
  }

  update(dt: number): void {
    if (this.dashCooldown > 0) {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    }
    if (!this.state.moving) return;
    this.progress += dt / this.currentStepDuration();
    if (this.progress >= 1) {
      this.progress = 1;
      this.state.gx = this.toX;
      this.state.gy = this.toY;
      this.state.px = this.toX;
      this.state.py = this.toY;
      this.state.moving = false;
      this.onArrive?.(this.toX, this.toY);
    } else {
      const t = Easing.easeOutQuad(this.progress);
      this.state.px = this.fromX + (this.toX - this.fromX) * t;
      this.state.py = this.fromY + (this.toY - this.fromY) * t;
    }
  }
}

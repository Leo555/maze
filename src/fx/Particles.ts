/**
 * 粒子系统：道具拾取爆发、玩家拖尾
 */

import { Easing } from '../core/utils';

interface Particle {
  x: number; // 格坐标
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export class ParticleSystem {
  private particles: Particle[] = [];

  burst(x: number, y: number, color: string, count = 16): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.5 + Math.random() * 1.5; // 格/秒
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.3,
        size: 0.05 + Math.random() * 0.05,
        color,
      });
    }
  }

  trail(x: number, y: number, color: string): void {
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.4,
      size: 0.18,
      color,
    });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // 阻尼
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cellSize: number, offsetX: number, offsetY: number): void {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      const alpha = 1 - Easing.easeOutQuad(t);
      const size = p.size * cellSize * (1 - t * 0.4);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      const cx = offsetX + (p.x + 0.5) * cellSize;
      const cy = offsetY + (p.y + 0.5) * cellSize;
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.particles.length = 0;
  }
}

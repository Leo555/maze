/**
 * 小地图：在 HUD 右下角绘制玩家已探索区域
 */

import type { Maze } from '../maze/Generator';
import type { Theme } from '../config/theme';
import type { Player } from '../entities/Player';

export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private size: number;

  constructor(container: HTMLElement, size = 140) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);
  }

  draw(
    maze: Maze,
    theme: Theme,
    visited: boolean[][],
    player: Player,
    revealAll: boolean
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    const padding = 6;
    const inner = this.size - padding * 2;
    const cellSize = inner / Math.max(maze.width, maze.height);
    const offsetX = padding + (inner - cellSize * maze.width) / 2;
    const offsetY = padding + (inner - cellSize * maze.height) / 2;

    // 背景
    ctx.fillStyle = this.alpha(theme.floor, 0.3);
    ctx.fillRect(offsetX, offsetY, cellSize * maze.width, cellSize * maze.height);

    // 已探索/全揭示
    ctx.fillStyle = this.alpha(theme.floorAccent, 0.7);
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (revealAll || visited[y]?.[x]) {
          ctx.fillRect(
            offsetX + x * cellSize,
            offsetY + y * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }

    // 墙体（仅画细线）
    ctx.strokeStyle = this.alpha(theme.wall, 0.9);
    ctx.lineWidth = Math.max(0.5, cellSize * 0.15);
    ctx.lineCap = 'round';
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (!revealAll && !visited[y]?.[x]) continue;
        const c = maze.cells[y][x];
        const px = offsetX + x * cellSize;
        const py = offsetY + y * cellSize;
        ctx.beginPath();
        if (c.walls.N) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + cellSize, py);
        }
        if (c.walls.W) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + cellSize);
        }
        if (c.walls.S) {
          ctx.moveTo(px, py + cellSize);
          ctx.lineTo(px + cellSize, py + cellSize);
        }
        if (c.walls.E) {
          ctx.moveTo(px + cellSize, py);
          ctx.lineTo(px + cellSize, py + cellSize);
        }
        ctx.stroke();
      }
    }

    // 出口
    ctx.fillStyle = theme.exit;
    ctx.beginPath();
    ctx.arc(
      offsetX + (maze.exit.x + 0.5) * cellSize,
      offsetY + (maze.exit.y + 0.5) * cellSize,
      cellSize * 0.5,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // 玩家
    ctx.fillStyle = theme.player;
    ctx.beginPath();
    ctx.arc(
      offsetX + (player.state.px + 0.5) * cellSize,
      offsetY + (player.state.py + 0.5) * cellSize,
      cellSize * 0.45,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  private alpha(input: string, a: number): string {
    if (input.startsWith('rgba') || input.startsWith('rgb')) return input;
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

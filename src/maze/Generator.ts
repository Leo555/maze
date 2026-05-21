/**
 * 迷宫数据结构与生成
 *
 * 采用"墙在格子边"的二维网格表示：
 *   - cells[y][x] 表示一个格子，包含上下左右四面墙的状态
 *   - 墙打开 = false，墙关闭（未打通）= true
 *
 * 生成算法：递归回溯（Recursive Backtracker）
 *   - 从起点出发，随机选择一个未访问的邻居打通墙，递归
 *   - 走入死胡同则回溯
 *   - 风格：长走廊 + 死胡同，最有探索感
 */

import { createRng, shuffle } from '../core/utils';

export interface Cell {
  x: number;
  y: number;
  walls: { N: boolean; S: boolean; E: boolean; W: boolean };
  visited: boolean;
}

export type Dir = 'N' | 'S' | 'E' | 'W';

const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DXY: Record<Dir, [number, number]> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

export class Maze {
  width: number;
  height: number;
  cells: Cell[][];
  start: { x: number; y: number };
  exit: { x: number; y: number };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = [];
    for (let y = 0; y < height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) {
        row.push({
          x,
          y,
          walls: { N: true, S: true, E: true, W: true },
          visited: false,
        });
      }
      this.cells.push(row);
    }
    this.start = { x: 0, y: 0 };
    this.exit = { x: width - 1, y: height - 1 };
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  cell(x: number, y: number): Cell | null {
    return this.inBounds(x, y) ? this.cells[y][x] : null;
  }

  /** 判断从 (x,y) 朝 dir 方向是否可通行（即那面墙是打开的） */
  canMove(x: number, y: number, dir: Dir): boolean {
    const c = this.cell(x, y);
    if (!c) return false;
    if (c.walls[dir]) return false;
    const [dx, dy] = DXY[dir];
    return this.inBounds(x + dx, y + dy);
  }

  /** 打通两格之间的墙 */
  carve(x: number, y: number, dir: Dir): void {
    const c = this.cell(x, y);
    if (!c) return;
    const [dx, dy] = DXY[dir];
    const n = this.cell(x + dx, y + dy);
    if (!n) return;
    c.walls[dir] = false;
    n.walls[OPPOSITE[dir]] = false;
  }
}

/**
 * 递归回溯生成
 * 使用迭代版本（栈），避免递归过深
 */
export function generateMaze(width: number, height: number, seed: number): Maze {
  const rng = createRng(seed);
  const maze = new Maze(width, height);

  const stack: Cell[] = [];
  const start = maze.cells[0][0];
  start.visited = true;
  stack.push(start);

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const dirs: Dir[] = shuffle(['N', 'S', 'E', 'W'], rng);
    let advanced = false;

    for (const d of dirs) {
      const [dx, dy] = DXY[d];
      const nx = current.x + dx;
      const ny = current.y + dy;
      const next = maze.cell(nx, ny);
      if (next && !next.visited) {
        maze.carve(current.x, current.y, d);
        next.visited = true;
        stack.push(next);
        advanced = true;
        break;
      }
    }

    if (!advanced) stack.pop();
  }

  // 注入约 8% 环路：随机打掉一些内墙，避免唯一解
  const loopCount = Math.floor(width * height * 0.08);
  for (let i = 0; i < loopCount; i++) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    const dirs: Dir[] = ['N', 'S', 'E', 'W'];
    const d = dirs[Math.floor(rng() * 4)];
    const [dx, dy] = DXY[d];
    if (maze.inBounds(x + dx, y + dy)) {
      maze.carve(x, y, d);
    }
  }

  // 起点和出口
  maze.start = { x: 0, y: 0 };
  maze.exit = { x: width - 1, y: height - 1 };

  return maze;
}

/**
 * BFS 求最短路径长度（用于评分对比）
 */
export function shortestPathLength(
  maze: Maze,
  from: { x: number; y: number },
  to: { x: number; y: number }
): number {
  const dist: number[][] = [];
  for (let y = 0; y < maze.height; y++) {
    dist.push(new Array(maze.width).fill(-1));
  }
  dist[from.y][from.x] = 0;
  const queue: [number, number][] = [[from.x, from.y]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (x === to.x && y === to.y) return dist[y][x];
    const dirs: Dir[] = ['N', 'S', 'E', 'W'];
    for (const d of dirs) {
      if (!maze.canMove(x, y, d)) continue;
      const [dx, dy] = DXY[d];
      const nx = x + dx;
      const ny = y + dy;
      if (dist[ny][nx] === -1) {
        dist[ny][nx] = dist[y][x] + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return -1;
}

/**
 * BFS 求所有格子到起点的距离（用于放置道具：远的、分支的位置）
 */
export function distanceField(
  maze: Maze,
  from: { x: number; y: number }
): number[][] {
  const dist: number[][] = [];
  for (let y = 0; y < maze.height; y++) {
    dist.push(new Array(maze.width).fill(-1));
  }
  dist[from.y][from.x] = 0;
  const queue: [number, number][] = [[from.x, from.y]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const dirs: Dir[] = ['N', 'S', 'E', 'W'];
    for (const d of dirs) {
      if (!maze.canMove(x, y, d)) continue;
      const [dx, dy] = DXY[d];
      const nx = x + dx;
      const ny = y + dy;
      if (dist[ny][nx] === -1) {
        dist[ny][nx] = dist[y][x] + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return dist;
}

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
import type { Pos, Path } from '../core/types';

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
  start: Pos;
  exit: Pos;

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
 * BSF 求最短路径长度（用于评分对比）
 */
export function shortestPathLength(
  maze: Maze,
  from: Pos,
  to: Pos
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
 * BFS 求从 from 到 to 的最短完整路径（格子序列，含起点与终点）。
 * 找不到时返回空数组。
 */
export function shortestPath(
  maze: Maze,
  from: Pos,
  to: Pos
): Path {
  const w = maze.width;
  const h = maze.height;
  // parent[y][x] = 上一个格的索引 (y*w + x)；-1 表示未访问；起点为自身
  const parent: number[][] = [];
  for (let y = 0; y < h; y++) parent.push(new Array(w).fill(-1));
  parent[from.y][from.x] = from.y * w + from.x;

  const queue: [number, number][] = [[from.x, from.y]];
  let found = false;
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (x === to.x && y === to.y) {
      found = true;
      break;
    }
    const dirs: Dir[] = ['N', 'S', 'E', 'W'];
    for (const d of dirs) {
      if (!maze.canMove(x, y, d)) continue;
      const [dx, dy] = DXY[d];
      const nx = x + dx;
      const ny = y + dy;
      if (parent[ny][nx] === -1) {
        parent[ny][nx] = y * w + x;
        queue.push([nx, ny]);
      }
    }
  }
  if (!found) return [];

  // 回溯
  const path: Path = [];
  let cx = to.x;
  let cy = to.y;
  while (true) {
    path.push({ x: cx, y: cy });
    if (cx === from.x && cy === from.y) break;
    const p = parent[cy][cx];
    cx = p % w;
    cy = Math.floor(p / w);
  }
  path.reverse();
  return path;
}

/**
 * BFS 求所有格子到起点的距离（用于放置道具：远的、分支的位置）
 */
export function distanceField(
  maze: Maze,
  from: Pos
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

/**
 * 求「依次经过任意顺序的所有 waypoints 后到达 to」的最短路径（旅行商型问题）。
 *
 * 算法：
 *   1) 对 from + waypoints 共 (k+1) 个起点分别做一次 BFS，得到任意两点间最短距离矩阵
 *   2) 用 bitmask DP 求"访问 mask 内所有点、当前停在 i"的最短长度
 *      - dp[mask][i] = 经过 mask 中所有点（含 i）后停在第 i 个 waypoint 的最短距离
 *      - 复杂度 O(2^k * k^2)；k ≤ 8 时仅约 2 万次操作
 *   3) 取 min over i 的 dp[full][i] + dist(waypoint_i, to)，回溯出访问顺序
 *   4) 把每段 (waypoint_a → waypoint_b) 用 BFS 求出实际格子路径并拼接
 *
 * waypoints 为空时退化为普通最短路径；找不到完整可达路径时返回 []。
 */
export function shortestPathThroughWaypoints(
  maze: Maze,
  from: Pos,
  waypoints: Pos[],
  to: Pos
): Path {
  if (waypoints.length === 0) {
    return shortestPath(maze, from, to);
  }
  const k = waypoints.length;
  // 索引约定：0 = from，1..k = waypoints[i-1]，k+1 = to
  const points = [from, ...waypoints, to];
  const n = points.length;

  // 对每个起点跑 BFS，得到到所有格的距离场
  // distFields[i][y][x] = 从 points[i] 到 (x,y) 的最短距离，-1 表示不可达
  const distFields: number[][][] = points.map((p) => distanceField(maze, p));

  // 距离矩阵
  const dist: number[][] = [];
  for (let i = 0; i < n; i++) {
    dist.push(new Array(n).fill(-1));
    for (let j = 0; j < n; j++) {
      dist[i][j] = distFields[i][points[j].y][points[j].x];
    }
  }

  // 任一段不可达 → 整体不可达
  // （只校验「from→任何 waypoint」「waypoint→to」「waypoint→waypoint」）
  for (let j = 1; j <= k; j++) {
    if (dist[0][j] < 0) return [];
    if (dist[j][k + 1] < 0) return [];
  }

  // bitmask DP：mask 的最低位代表 waypoint 0（即 points[1]），最高位代表 waypoint k-1
  // dp[mask][i] = 已访问 mask 中的 waypoint 集合，当前停在 waypoint i 的最短总长
  const FULL = (1 << k) - 1;
  const INF = Number.MAX_SAFE_INTEGER;
  const dp: number[][] = [];
  const prev: number[][] = []; // prev[mask][i] = 上一个 waypoint 索引（用于回溯）；-1 表示来自 from
  for (let m = 0; m <= FULL; m++) {
    dp.push(new Array(k).fill(INF));
    prev.push(new Array(k).fill(-2));
  }
  // 初始：从 from 到第 i 个 waypoint
  for (let i = 0; i < k; i++) {
    const d = dist[0][i + 1];
    if (d >= 0) {
      dp[1 << i][i] = d;
      prev[1 << i][i] = -1;
    }
  }
  // 转移
  for (let mask = 1; mask <= FULL; mask++) {
    for (let i = 0; i < k; i++) {
      if (!(mask & (1 << i))) continue;
      if (dp[mask][i] === INF) continue;
      // 从 i 走向下一个未访问 waypoint j
      for (let j = 0; j < k; j++) {
        if (mask & (1 << j)) continue;
        const d = dist[i + 1][j + 1];
        if (d < 0) continue;
        const nMask = mask | (1 << j);
        const nDist = dp[mask][i] + d;
        if (nDist < dp[nMask][j]) {
          dp[nMask][j] = nDist;
          prev[nMask][j] = i;
        }
      }
    }
  }

  // 找到最优终点 waypoint：min over i (dp[FULL][i] + dist(waypoint_i, to))
  let bestI = -1;
  let bestTotal = INF;
  for (let i = 0; i < k; i++) {
    const dToExit = dist[i + 1][k + 1];
    if (dp[FULL][i] === INF || dToExit < 0) continue;
    const total = dp[FULL][i] + dToExit;
    if (total < bestTotal) {
      bestTotal = total;
      bestI = i;
    }
  }
  if (bestI < 0) return [];

  // 回溯访问顺序
  const order: number[] = [];
  let curMask = FULL;
  let curI = bestI;
  while (curI !== -1) {
    order.push(curI);
    const p = prev[curMask][curI];
    curMask ^= 1 << curI;
    curI = p;
  }
  order.reverse(); // [w0, w1, ..., wk-1]，访问顺序

  // 拼接实际格子路径：from → waypoints[order[0]] → ... → to
  const fullPath: Path = [];
  let prevPoint = from;
  for (const idx of order) {
    const target = waypoints[idx];
    const seg = shortestPath(maze, prevPoint, target);
    if (seg.length === 0) return [];
    if (fullPath.length === 0) fullPath.push(...seg);
    else fullPath.push(...seg.slice(1)); // 去重首格
    prevPoint = target;
  }
  // 最后一段 → to
  const lastSeg = shortestPath(maze, prevPoint, to);
  if (lastSeg.length === 0) return [];
  if (fullPath.length === 0) fullPath.push(...lastSeg);
  else fullPath.push(...lastSeg.slice(1));

  return fullPath;
}

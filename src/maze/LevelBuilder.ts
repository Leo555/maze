/**
 * 关卡运行时数据
 *
 * 由 LevelBuilder 基于关卡配置构建：
 *   - 迷宫
 *   - 玩家初始状态
 *   - 道具/机关位置（基于 BFS 距离场放置）
 */

import { generateMaze, distanceField, shortestPathLength } from '../maze/Generator';
import type { Maze } from '../maze/Generator';
import type { LevelConfig } from '../config/levels';
import { createRng, randomSeed, shuffle } from '../core/utils';

export type EntityKind =
  | 'key'
  | 'hourglass'
  | 'map_shard'
  | 'dash_shoes'
  | 'one_way_door'
  | 'portal'
  | 'moving_wall'
  | 'chaser';

export interface Entity {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  active: boolean;
  data?: Record<string, unknown>; // 单向门朝向、传送门配对、移动墙周期等
}

export interface LevelRuntime {
  config: LevelConfig;
  maze: Maze;
  optimalPath: number; // 最短路径长度（用于评分）
  entities: Entity[];
  seed: number;
}

export function buildLevel(config: LevelConfig, seed: number = randomSeed()): LevelRuntime {
  const maze = generateMaze(config.size, config.size, seed);
  const optimal = shortestPathLength(maze, maze.start, maze.exit);

  const rng = createRng(seed ^ 0x9e3779b9);

  // 计算距离场，方便挑选远离起点 / 出口的格子
  const distFromStart = distanceField(maze, maze.start);

  // 收集所有可放置的格子（不能是起点/出口）
  const candidates: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if ((x === maze.start.x && y === maze.start.y) ||
          (x === maze.exit.x && y === maze.exit.y)) continue;
      const d = distFromStart[y][x];
      if (d > 0) candidates.push({ x, y, d });
    }
  }

  // 按距离从远到近排序，优先放置在偏远位置
  candidates.sort((a, b) => b.d - a.d);

  const entities: Entity[] = [];
  const used = new Set<string>();
  const k = (x: number, y: number) => `${x},${y}`;

  // 从前 N% 的候选中随机抽（远但不要全集中在最远点）
  const pickFar = (count: number, ratio = 0.5): Array<{ x: number; y: number }> => {
    const pool = candidates
      .filter((c) => !used.has(k(c.x, c.y)))
      .slice(0, Math.max(count * 2, Math.floor(candidates.length * ratio)));
    shuffle(pool, rng);
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count && i < pool.length; i++) {
      const c = pool[i];
      used.add(k(c.x, c.y));
      out.push({ x: c.x, y: c.y });
    }
    return out;
  };

  // 钥匙：远离起点
  pickFar(config.keys, 0.6).forEach((p, i) =>
    entities.push({ id: `key_${i}`, kind: 'key', x: p.x, y: p.y, active: true })
  );
  // 沙漏：均匀分布（取中间距离）
  const midPool = candidates
    .filter((c) => !used.has(k(c.x, c.y)))
    .filter((c) => c.d > optimal * 0.2 && c.d < optimal * 0.9);
  shuffle(midPool, rng);
  for (let i = 0; i < config.hourglasses && i < midPool.length; i++) {
    const c = midPool[i];
    used.add(k(c.x, c.y));
    entities.push({ id: `hg_${i}`, kind: 'hourglass', x: c.x, y: c.y, active: true });
  }
  // 地图碎片：放分支死胡同（这里简化为随机偏远位置）
  pickFar(config.mapShards, 0.7).forEach((p, i) =>
    entities.push({ id: `map_${i}`, kind: 'map_shard', x: p.x, y: p.y, active: true })
  );

  return {
    config,
    maze,
    optimalPath: optimal,
    entities,
    seed,
  };
}

/**
 * 关卡运行时数据
 *
 * 由 LevelBuilder 基于关卡配置构建：
 *   - 迷宫
 *   - 玩家初始状态
 *   - 道具/机关位置（基于 BFS 距离场放置）
 */

import {
  generateMaze,
  distanceField,
  shortestPathLength,
  shortestPathThroughWaypoints,
} from '../maze/Generator';
import type { Maze } from '../maze/Generator';
import type { LevelConfig } from '../config/levels';
import { createRng, randomSeed, shuffle } from '../core/utils';

export type EntityKind = 'key' | 'hourglass' | 'map_shard';

export interface Entity {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  active: boolean;
}

export interface LevelRuntime {
  config: LevelConfig;
  maze: Maze;
  optimalPath: number; // 最短路径长度（用于评分）
  /** 运行时计算的三星时间阈值（秒），基于 optimalPath 与视野等动态得出 */
  star3Time: number;
  /** 运行时计算的二星时间阈值（秒） */
  star2Time: number;
  entities: Entity[];
  seed: number;
}

export function buildLevel(config: LevelConfig, seed: number = randomSeed()): LevelRuntime {
  const maze = generateMaze(config.size, config.size, seed);
  // 起点 → 终点的"裸"最短路径（不考虑钥匙），用于实体放置时的距离参考
  const baseOptimal = shortestPathLength(maze, maze.start, maze.exit);

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
    .filter((c) => c.d > baseOptimal * 0.2 && c.d < baseOptimal * 0.9);
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

  // 真正的最短「通关」路径：必须依次经过所有钥匙再到出口
  // 否则结算页的「最短路径」会显示成不收钥匙的直线长度，与实际可走路径严重偏离
  const keyPositions = entities
    .filter((e) => e.kind === 'key')
    .map((e) => ({ x: e.x, y: e.y }));
  let optimalPath = baseOptimal;
  if (keyPositions.length > 0) {
    const fullPath = shortestPathThroughWaypoints(
      maze,
      maze.start,
      keyPositions,
      maze.exit
    );
    if (fullPath.length >= 2) {
      // path.length 是格数；步数（与玩家 steps 同口径）= 格数 - 1
      optimalPath = fullPath.length - 1;
    }
  }

  // ===== 运行时星级时间阈值 =====
  // 基于真实最优步数动态生成，比 levels.ts 里的静态公式（size×4）更准
  //
  // 设计：
  //   · 每步耗时 ≈ 0.7s（步进缓动 0.15s + 操作思考/反应 ~0.55s）
  //   · 视野受限关卡需要更多探索时间，按视野等级加倍率
  //   · 倒计时关卡稍微紧一点（玩家本来就有时间压力，会跑得更急）
  //   · star2 比 star3 留出 ~80% 富余空间
  //
  // 例：第 1 关 size=11 optimal≈70 → star3 ≈ 70×0.7 ≈ 49s（与原静态值 50 接近，
  // 但变得依据真实路径而非 size）
  const visionMul: Record<LevelConfig['vision'], number> = {
    full: 1.0,
    large: 1.15,
    medium: 1.35,
    small: 1.6,
  };
  const STEP_SECONDS = 0.7;
  const baseTime = optimalPath * STEP_SECONDS * visionMul[config.vision];
  // 倒计时关卡的星 3 略紧一档
  const tightness = config.timeLimit > 0 ? 0.92 : 1.0;
  const star3Time = Math.max(8, Math.round(baseTime * 1.0 * tightness));
  const star2Time = Math.max(15, Math.round(baseTime * 1.8 * tightness));

  return {
    config,
    maze,
    optimalPath,
    star3Time,
    star2Time,
    entities,
    seed,
  };
}

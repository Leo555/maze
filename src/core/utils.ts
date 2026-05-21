/**
 * 通用工具函数
 */

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 缓动函数（仅保留实际使用到的） */
export const Easing = {
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
};

/** Mulberry32 种子随机数生成器 */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * 关卡 → 确定性 seed
 *
 * 设计目标：
 *   - 同一 levelId 任何时刻、任何设备、任何用户都得到相同 seed → 同一迷宫布局
 *   - levelId 微小差异（1 vs 2）也能产生差异极大的迷宫，避免视觉相似
 *   - 不依赖 Math.random / Date.now，纯函数
 *
 * 实现：
 *   - 把 levelId 与一个项目级 namespace（'maze' 的 FNV-1a 哈希常量）混合
 *   - 经过几轮 xorshift + Math.imul 充分扩散，输出无符号 32 位整数
 *   - 与 createRng (Mulberry32) 配合时随机性已足够（生成回溯算法 + 实体放置）
 *
 * 修改 SEED_NAMESPACE 会让所有关卡布局重新洗牌一次（相当于全局 reset）；
 * 不要轻易改，否则全员存档与排行榜对应的迷宫会失配。
 */
const SEED_NAMESPACE = 0x6d61_7a65; // 'maze' 的 ASCII 拼接（确定值）

export function seedForLevel(levelId: number): number {
  let h = (levelId | 0) ^ SEED_NAMESPACE;
  // xorshift + 乘法混合，3 轮足以让相邻 levelId 输出毫无相似度
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/** 数组洗牌（in-place），可选种子 RNG */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 格式化时间 mm:ss */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

/** 格式化时间，含十分位（用于结算） */
export function formatTimePrecise(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const ss = s - m * 60;
  return `${m.toString().padStart(2, '0')}:${ss.toFixed(1).padStart(4, '0')}`;
}

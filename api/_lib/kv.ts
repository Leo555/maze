/**
 * KV 数据访问层（仅后端使用）
 *
 * 数据键空间：
 *   - code:{8位}                 → CodeRecord       玩家进度（主数据，TTL 1 年滚动续期）
 *   - nick:{8位}                 → string           昵称（可选，TTL 1 年）
 *   - lb:overall                 → ZSET             综合榜：member=code, score=综合分
 *   - lb:lvl:{1..100}            → ZSET             单关速通榜：member=code, score=bestTime(秒)
 *   - meta:firstSeen:{8位}       → number           首次创建时间戳（首次写时设置，永久）
 *   - meta:dau:{YYYY-MM-DD}      → SET<code>        当日活跃集合（TTL 8 天）
 *   - meta:total                 → number           总用户数（每次首次创建递增）
 *
 * 排行榜分数：见 shared/types.ts calcOverallScore；单关榜 score 越小越靠前
 */

import { kv } from '@vercel/kv';
import {
  type SaveData,
  type OverallRankItem,
  type LevelRankItem,
  calcOverallScore,
  parseOverallScore,
  isValidCode,
  isValidNick,
} from '../../shared/types.js';

/** 用户数据 TTL：1 年。每次读写都会续期 */
const TTL_SECONDS = 365 * 24 * 60 * 60;
/** DAU 集合自然过期：8 天（保证至少看到 7 天历史） */
const DAU_TTL_SECONDS = 8 * 24 * 60 * 60;

interface CodeRecord {
  progress: SaveData;
  updatedAt: number;
}

// ============================================================
// 进度
// ============================================================

export async function getProgress(code: string): Promise<SaveData | null> {
  const rec = await kv.get<CodeRecord>(`code:${code}`);
  if (!rec) return null;
  void kv.expire(`code:${code}`, TTL_SECONDS);
  return rec.progress;
}

export async function setProgress(
  code: string,
  progress: SaveData
): Promise<void> {
  const rec: CodeRecord = { progress, updatedAt: Date.now() };
  await kv.set(`code:${code}`, rec, { ex: TTL_SECONDS });
}

/** 获取最后更新时间（admin 用），不影响 TTL */
export async function getUpdatedAt(code: string): Promise<number | null> {
  const rec = await kv.get<CodeRecord>(`code:${code}`);
  return rec?.updatedAt ?? null;
}

// ============================================================
// 昵称
// ============================================================

export async function getNick(code: string): Promise<string | null> {
  return kv.get<string>(`nick:${code}`);
}

export async function setNick(code: string, nick: string): Promise<void> {
  await kv.set(`nick:${code}`, nick, { ex: TTL_SECONDS });
}

/** 批量取昵称（排行榜渲染用，N+1 → 1 次 RTT） */
export async function mgetNick(codes: string[]): Promise<(string | null)[]> {
  if (codes.length === 0) return [];
  const keys = codes.map((c) => `nick:${c}`);
  return (await kv.mget<string[]>(...keys)) as (string | null)[];
}

// ============================================================
// 排行榜
// ============================================================

/**
 * 在玩家进度变更后更新排行榜（fire-and-forget 调用，失败不影响主流程）。
 *
 * 包含两件事：
 *   1. 综合榜 lb:overall 用 calcOverallScore 写入
 *   2. 玩家本次刚改善的关卡（最多就是当前 unlocked-1 这一关）的速通榜
 *      —— 简化处理：每次 save 都把所有已通关关的 bestTime 同步到对应榜上
 *      （N=100 其实可以接受，但为减小 KV 调用，只更新 bestTime/bestStars
 *       发生变化的关。这里直接全量写最简单，pipeline 一次发出）
 */
export async function updateLeaderboards(
  code: string,
  progress: SaveData
): Promise<void> {
  const score = calcOverallScore(progress);

  const pipe = kv.pipeline();
  // 综合榜
  pipe.zadd('lb:overall', { score, member: code });

  // 单关榜：每个有记录且已通关的关卡
  for (const key of Object.keys(progress.records)) {
    const lvId = Number(key);
    if (!Number.isInteger(lvId) || lvId < 1 || lvId > 100) continue;
    const r = progress.records[lvId];
    if (!r || !r.cleared || !Number.isFinite(r.bestTime)) continue;
    pipe.zadd(`lb:lvl:${lvId}`, { score: r.bestTime, member: code });
  }
  await pipe.exec();
}

/** 综合榜 top N（按 score 降序） */
export async function getOverallTop(limit: number): Promise<OverallRankItem[]> {
  const safe = Math.max(1, Math.min(100, Math.floor(limit)));
  // ZRANGE key 0 N-1 REV WITHSCORES
  const raw = (await kv.zrange('lb:overall', 0, safe - 1, {
    rev: true,
    withScores: true,
  })) as (string | number)[];

  // raw 形如 [member1, score1, member2, score2, ...]
  const codes: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    codes.push(String(raw[i]));
    scores.push(Number(raw[i + 1]));
  }
  const nicks = await mgetNick(codes);

  return codes.map((c, i) => {
    const { cleared, stars } = parseOverallScore(scores[i]);
    return {
      rank: i + 1,
      code: c,
      nick: nicks[i] ?? null,
      cleared,
      stars,
    };
  });
}

/** 单关速通榜（按用时升序） */
export async function getLevelTop(
  levelId: number,
  limit: number
): Promise<LevelRankItem[]> {
  const safe = Math.max(1, Math.min(100, Math.floor(limit)));
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 100) return [];

  const raw = (await kv.zrange(`lb:lvl:${levelId}`, 0, safe - 1, {
    withScores: true,
  })) as (string | number)[];

  const codes: string[] = [];
  const times: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    codes.push(String(raw[i]));
    times.push(Number(raw[i + 1]));
  }

  // 拼装最终数据：除了 nick，还要 bestStars，需要从 progress 里取
  const [nicks, progresses] = await Promise.all([
    mgetNick(codes),
    Promise.all(codes.map((c) => getProgress(c))),
  ]);

  return codes.map((c, i) => {
    const stars = progresses[i]?.records[levelId]?.bestStars ?? 0;
    return {
      rank: i + 1,
      code: c,
      nick: nicks[i] ?? null,
      bestTime: times[i],
      bestStars: stars,
    };
  });
}

/**
 * 查询某个 code 在综合榜上的排名（1-based）。
 * 不在榜上返回 null。
 */
export async function getOverallRank(code: string): Promise<number | null> {
  // ZREVRANK 直接拿降序排名
  const r = await kv.zrevrank('lb:overall', code);
  return typeof r === 'number' ? r + 1 : null;
}

// ============================================================
// 元信息（admin 大盘）
// ============================================================

/** 标记某 code 今日活跃（save 接口调用） */
export async function markActive(code: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = `meta:dau:${day}`;
  const pipe = kv.pipeline();
  pipe.sadd(key, code);
  pipe.expire(key, DAU_TTL_SECONDS);
  await pipe.exec();
}

/** 首次见到此 code 时记录创建时间 + 总用户数 +1 */
export async function ensureFirstSeen(code: string): Promise<void> {
  const key = `meta:firstSeen:${code}`;
  // setnx 原子保证只第一次写入
  const ok = await kv.set(key, Date.now(), { nx: true });
  if (ok) {
    void kv.incr('meta:total');
  }
}

export async function getTotalUsers(): Promise<number> {
  const n = await kv.get<number>('meta:total');
  return typeof n === 'number' ? n : 0;
}

/** 取最近 N 天的 DAU（含今天，按日期升序） */
export async function getRecentDau(days: number): Promise<{ day: string; count: number }[]> {
  const safe = Math.max(1, Math.min(7, Math.floor(days)));
  const dates: string[] = [];
  const now = Date.now();
  for (let i = safe - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  // SCARD 是 O(1)，逐个发即可；pipeline 一次往返
  const pipe = kv.pipeline();
  for (const day of dates) pipe.scard(`meta:dau:${day}`);
  const counts = (await pipe.exec()) as number[];
  return dates.map((day, i) => ({ day, count: Number(counts[i] ?? 0) }));
}

/**
 * 各关通过率（已通关人数 / 综合榜总人数）。
 * 实现：lb:lvl:{i} 的 ZCARD 即该关有记录人数，再除以总用户数。
 */
export async function getLevelClearStats(): Promise<
  { levelId: number; cleared: number }[]
> {
  const pipe = kv.pipeline();
  for (let i = 1; i <= 100; i++) pipe.zcard(`lb:lvl:${i}`);
  const counts = (await pipe.exec()) as number[];
  return counts.map((c, i) => ({ levelId: i + 1, cleared: Number(c ?? 0) }));
}

// ============================================================
// 用户列表（admin）
// ============================================================

export interface AdminUserRow {
  rank: number;
  code: string;
  nick: string | null;
  cleared: number;
  stars: number;
  updatedAt: number | null;
  firstSeen: number | null;
}

/** 按综合榜倒排取一段用户（admin 用户列表分页） */
export async function adminListUsers(
  offset: number,
  limit: number
): Promise<AdminUserRow[]> {
  const safeOff = Math.max(0, Math.floor(offset));
  const safeLim = Math.max(1, Math.min(100, Math.floor(limit)));

  const raw = (await kv.zrange(
    'lb:overall',
    safeOff,
    safeOff + safeLim - 1,
    { rev: true, withScores: true }
  )) as (string | number)[];

  const codes: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    codes.push(String(raw[i]));
    scores.push(Number(raw[i + 1]));
  }

  const [nicks, updateds, firstSeens] = await Promise.all([
    mgetNick(codes),
    Promise.all(codes.map((c) => getUpdatedAt(c))),
    (async (): Promise<(number | null)[]> => {
      if (codes.length === 0) return [];
      const ks = codes.map((c) => `meta:firstSeen:${c}`);
      return (await kv.mget<number[]>(...ks)) as (number | null)[];
    })(),
  ]);

  return codes.map((c, i) => {
    const { cleared, stars } = parseOverallScore(scores[i]);
    return {
      rank: safeOff + i + 1,
      code: c,
      nick: nicks[i] ?? null,
      cleared,
      stars,
      updatedAt: updateds[i],
      firstSeen: firstSeens[i] ?? null,
    };
  });
}

/** admin：单个用户完整详情 */
export async function adminGetUser(code: string): Promise<{
  code: string;
  nick: string | null;
  progress: SaveData | null;
  updatedAt: number | null;
  firstSeen: number | null;
  rank: number | null;
} | null> {
  if (!isValidCode(code)) return null;
  const [progress, nick, updatedAt, firstSeen, rank] = await Promise.all([
    getProgress(code),
    getNick(code),
    getUpdatedAt(code),
    kv.get<number>(`meta:firstSeen:${code}`),
    getOverallRank(code),
  ]);
  if (!progress) return null;
  return { code, nick, progress, updatedAt, firstSeen, rank };
}

// 让 isValidNick 在本文件可访问（避免 import 顺序问题）
export { isValidNick };

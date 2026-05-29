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

/**
 * 昵称改名冷却：7 天内只能改一次（避免刷榜骚扰 / 滥用昵称制造混淆）。
 *
 * 设计：
 *   - 用 KV key `nick:cd:{code}` 占位，TTL 7 天
 *   - SET NX EX 原子操作：成功 = 拿到改名权；失败 = 仍在冷却期
 *   - 注意：这是"已设过昵称的改名冷却"，所以由 nick 接口判断"是否首次"后再决定是否检查
 *     首次设置（getNick 返回 null）必须放行，否则玩家被永久卡死
 *
 * @returns ok=true 时调用方可以继续；ok=false 时附带 retryAfterSec 用于前端文案
 */
const NICK_COOLDOWN_SEC = 7 * 24 * 60 * 60;

export async function tryAcquireNickChangeSlot(
  code: string
): Promise<{ ok: boolean; retryAfterSec?: number }> {
  const key = `nick:cd:${code}`;
  try {
    const got = await kv.set(key, Date.now(), { nx: true, ex: NICK_COOLDOWN_SEC });
    if (got) return { ok: true };
    // 拿不到锁，查剩余 TTL 给前端展示
    const ttl = await kv.ttl(key);
    return {
      ok: false,
      retryAfterSec: typeof ttl === 'number' && ttl > 0 ? ttl : NICK_COOLDOWN_SEC,
    };
  } catch {
    // KV 异常：fail-open（避免抖动卡死合法用户）
    return { ok: true };
  }
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
 * 「上榜资格」规则：
 *   只有设置了昵称的玩家才能进入榜单。这是产品策略层面的硬约束：
 *     - 排行榜不再返回任何 code 信息（隐私 + 安全），改用昵称做唯一可见标识
 *     - 没有昵称的条目无法展示，留在 ZSET 里只会污染 top N 排序结果
 *   实现上：调用前查一次 nick:{code}，缺失则跳过整个 pipeline 写入。
 *   一旦玩家后续设置了昵称，setNick → backfillLeaderboards 会把当前进度补回榜单。
 *
 * 包含两件事：
 *   1. 综合榜 lb:overall 用 calcOverallScore 写入
 *   2. 玩家所有已通关关卡的速通榜
 *      —— 简化处理：每次 save 都把所有已通关关的 bestTime 同步到对应榜上
 *      （N=100 其实可以接受，但为减小 KV 调用，只更新 bestTime/bestStars
 *       发生变化的关。这里直接全量写最简单，pipeline 一次发出）
 */
export async function updateLeaderboards(
  code: string,
  progress: SaveData
): Promise<void> {
  // 上榜资格：必须先有昵称
  const nick = await getNick(code);
  if (!nick) return;

  await writeLeaderboards(code, progress);
}

/**
 * 把当前 code 的全部进度写入排行榜（不查 nick，调用方需自行保证昵称已存在）。
 *
 * 使用场景：setNick 成功后，把"以前已通关但因无昵称未上榜"的进度补回榜单。
 * 内部辅助函数，不暴露给 handler。
 */
async function writeLeaderboards(
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

/**
 * setNick 成功后调用：把已有进度回填到排行榜。
 *
 * 时序：玩家先玩（unlocked 增长）但没设昵称 → 此时 updateLeaderboards 因 nick 缺失
 * 跳过写入 → 玩家后来设了昵称 → 此函数把 progress 写入榜单，让玩家立即可见排名。
 *
 * 与 updateLeaderboards 的区别：
 *   - updateLeaderboards: 在 save 路径调用，要查 nick 决定是否写
 *   - backfillLeaderboards: 在 setNick 路径调用，nick 刚被写入所以无需再查
 *
 * fail-open：写榜失败不影响 setNick 主流程；下一次 save 会自然重试 updateLeaderboards。
 */
export async function backfillLeaderboards(code: string): Promise<void> {
  const progress = await getProgress(code);
  if (!progress) return; // 还没玩过，无须回填
  await writeLeaderboards(code, progress);
}

/**
 * 综合榜 top N（按 score 降序）。
 *
 * 上榜资格 = 已设昵称：updateLeaderboards 已经在 nick 缺失时跳过 ZSET 写，
 * 但旧数据 / 极端竞态下 ZSET 里仍可能有 nick 现在缺失的 member，
 * 这里再做一次过滤兜底，确保前端拿到的每条记录 nick 都是非空字符串。
 *
 * @param limit  返回条目数（最多 100）
 * @param viewerCode  可选；请求方自己的 code，用于在响应中标记 isMe（不会回包给前端）
 */
export async function getOverallTop(
  limit: number,
  viewerCode?: string
): Promise<OverallRankItem[]> {
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

  // 过滤 nick 缺失的条目；rank 在过滤后重新编号，保证前端看到的是连续 1..N
  const out: OverallRankItem[] = [];
  for (let i = 0; i < codes.length; i++) {
    const nick = nicks[i];
    if (!nick) continue; // 上榜资格保护：nick 缺失则跳过
    const { cleared, stars } = parseOverallScore(scores[i]);
    out.push({
      rank: out.length + 1,
      nick,
      cleared,
      stars,
      // 关键：code 不出包；isMe 由后端比对 viewerCode 后下发，前端零计算、零暴露
      isMe: viewerCode ? codes[i] === viewerCode : false,
    });
  }
  return out;
}

/**
 * 单关速通榜（按用时升序）。
 *
 * 同 getOverallTop：过滤 nick 缺失的条目，确保返回 nick 都是非空字符串。
 *
 * @param viewerCode  可选；请求方自己的 code，用于标记 isMe
 */
export async function getLevelTop(
  levelId: number,
  limit: number,
  viewerCode?: string
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

  const out: LevelRankItem[] = [];
  for (let i = 0; i < codes.length; i++) {
    const nick = nicks[i];
    if (!nick) continue; // 上榜资格保护
    const stars = progresses[i]?.records[levelId]?.bestStars ?? 0;
    out.push({
      rank: out.length + 1,
      nick,
      bestTime: times[i],
      bestStars: stars,
      isMe: viewerCode ? codes[i] === viewerCode : false,
    });
  }
  return out;
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

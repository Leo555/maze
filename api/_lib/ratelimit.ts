/**
 * 写接口限流 + 多端并发检测
 *
 * 设计前提：
 *   - 一局游戏最快通关约 10s（迷宫求解 + 走完 + 提交结算）
 *   - 一个 code 代表一个真人玩家
 *   - 玩家可以在不同设备切换玩，但不允许多端同时玩同一个 code
 *
 * 三层限流（命中即拒，附带友好错误码供前端文案路由）：
 *
 *   L1 频率上限   30s 内最多 1 次 save        维度 code            error: too_fast
 *     - 真人 10s 通关 + UI + 网络 RTT，30s 留足缓冲；脚本重放必命中
 *
 *   L2 突发上限   5 min 内最多 12 次 save     维度 code            error: too_many_requests
 *     - 真人 5 分钟最多 5-8 局（含读秒/卡关），12 次留 1.5 倍冗余
 *
 *   L3 IP 滥用    1 hour 内同一 IP 用 ≥ 4 个不同 code   维度 IP    error: ip_abuse
 *     - 单 IP 用多个 code 写入是典型的脚本批量/刷数据模式
 *
 * 多端并发检测：
 *
 *   每次 save 在 KV 写一条 sess:{code} = { ip, uaHash, ts }（TTL 60s）
 *   下次 save 时：
 *     - sess 不存在或 ≥ 30s → 视为换设备/重连，正常
 *     - sess 存在且 IP 与 UA 都一致 → 同一会话
 *     - sess 存在但 IP/UA 不一致 + 距离上次 < 30s → 多端并发，拒绝
 *
 * 注意：所有 KV 调用失败时按"放行"处理（fail-open），避免 KV 抖动让玩家无法保存进度
 * （限流是辅助，反作弊主防线是 unlocked 增量 ≤ 5 与 origin 校验）。
 */

import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';

/** L1 最小提交间隔（秒）—— 一局最快 10s，给到 30s 缓冲足够 */
const MIN_INTERVAL_SEC = 30;
/** L2 5 分钟上限 */
const BURST_WINDOW_SEC = 5 * 60;
const BURST_MAX = 12;
/** L3 IP 滥用：1 小时内不同 code 数 */
const IP_ABUSE_WINDOW_SEC = 60 * 60;
const IP_ABUSE_MAX_CODES = 4;
/** 多端并发判定：sess 存在且最近 30s 内 IP/UA 不一致就拒绝 */
const CONCURRENT_THRESHOLD_SEC = 30;
const SESS_TTL_SEC = 60;

export type WriteRateError =
  | 'too_fast' // L1
  | 'too_many_requests' // L2
  | 'ip_abuse' // L3
  | 'concurrent_play'; // 多端并发

export interface WriteRateResult {
  ok: boolean;
  error?: WriteRateError;
  /** 当前会话锚（用于错误响应附带 retryAfter 等信息） */
  retryAfterSec?: number;
}

/** 计算 UA 摘要（不存原文，省空间 & 避免敏感信息落 KV） */
function uaHash(ua: string): string {
  return createHash('sha1').update(ua).digest('hex').slice(0, 12);
}

interface SessRecord {
  ip: string;
  ua: string; // 已是 hash
  ts: number; // 毫秒
}

/**
 * 写接口前置限流闸门：依次跑 L1 → 多端并发 → L2 → L3，命中即返回。
 *
 * fail-open 原则：KV 任何步骤异常都按"放行"处理（避免 KV 故障导致玩家不能保存）。
 */
export async function checkWriteRate(
  code: string,
  ip: string,
  ua: string
): Promise<WriteRateResult> {
  const now = Date.now();
  const uaH = uaHash(ua || 'unknown');

  // === L1 + 多端并发：依赖 sess:{code} ===
  let sess: SessRecord | null = null;
  try {
    sess = await kv.get<SessRecord>(`sess:${code}`);
  } catch {
    sess = null;
  }
  if (sess) {
    const elapsedSec = (now - sess.ts) / 1000;

    // 多端并发：30s 内出现不同 IP 且不同 UA 的 save → 不是同一玩家
    // （只判 IP 不够：家里 wifi 切 4G 也会换 IP；只判 UA 不够：同设备多浏览器；
    // 两者都变才足够强地暗示"不同人"）
    const ipChanged = sess.ip !== ip;
    const uaChanged = sess.ua !== uaH;
    if (ipChanged && uaChanged && elapsedSec < CONCURRENT_THRESHOLD_SEC) {
      return { ok: false, error: 'concurrent_play' };
    }

    // L1 频率上限（同一会话内）：30s 间隔
    // 跨设备但都被认作"同一玩家"也走这条规则——10s 通关 + 30s 间隔不会误伤
    if (elapsedSec < MIN_INTERVAL_SEC) {
      return {
        ok: false,
        error: 'too_fast',
        retryAfterSec: Math.ceil(MIN_INTERVAL_SEC - elapsedSec),
      };
    }
  }

  // === L2 突发上限：5 min 12 次 ===
  try {
    const burstKey = `rl:save:burst:${code}`;
    const n = await kv.incr(burstKey);
    if (n === 1) void kv.expire(burstKey, BURST_WINDOW_SEC);
    if (n > BURST_MAX) {
      return { ok: false, error: 'too_many_requests' };
    }
  } catch {
    // KV 异常：fail-open
  }

  // === L3 IP 滥用：1 hour 内 IP 写过的不同 code 数 ===
  // 用 SET 存：rl:save:ip:{ip} 包含该 IP 用过的所有 code，SCARD 即数量
  try {
    const ipSetKey = `rl:save:ip:${ip}`;
    const pipe = kv.pipeline();
    pipe.sadd(ipSetKey, code);
    pipe.expire(ipSetKey, IP_ABUSE_WINDOW_SEC);
    pipe.scard(ipSetKey);
    const results = (await pipe.exec()) as unknown[];
    const count = Number(results[2] ?? 0);
    if (count > IP_ABUSE_MAX_CODES) {
      return { ok: false, error: 'ip_abuse' };
    }
  } catch {
    // KV 异常：fail-open
  }

  return { ok: true };
}

/**
 * 在写入成功之后调用，更新 sess:{code} 锚点。
 *
 * 注意：必须在 setProgress 成功之后调用，否则限流会因为"上次 sess"未更新
 * 而把同一玩家的连续 save 误判为多端并发。
 */
export async function commitWriteSession(
  code: string,
  ip: string,
  ua: string
): Promise<void> {
  const rec: SessRecord = {
    ip,
    ua: uaHash(ua || 'unknown'),
    ts: Date.now(),
  };
  try {
    await kv.set(`sess:${code}`, rec, { ex: SESS_TTL_SEC });
  } catch {
    // sess 写入失败不影响主流程
  }
}

// ============================================================
// 写互斥锁（防 TOCTOU）
// ============================================================

/** 单次 save 的临界区最大持续时间（秒）；包含 getProgress + 校验 + setProgress */
const WRITE_LOCK_TTL_SEC = 5;

/**
 * 抢同一 code 的写入互斥锁。
 *
 * 防御场景：
 *   并发两次 save（A 与 B）几乎同时到达，都先 getProgress 拿到 unlocked=10，
 *   都通过 unlock_delta_too_large 校验（incoming.unlocked=15 ≤ 10+5），
 *   都写入 → 攻击者用两次并发提交即可在云端把 unlocked 从 10 推到 20，
 *   绕过单次 +5 的限制。
 *
 * 实现：用 KV 的 SET NX 做分布式互斥锁。同一 code 同时只能有一次 save 在临界区内。
 *
 * KV 异常处理：fail-open（拿锁失败照样放行）。理由：
 *   - KV 真挂了时正常玩家通关 100% 受影响；攻击者刚好抓住 KV 抖动窗口的概率极低
 *   - 多端并发与 unlock 增量校验在 KV 正常时已能挡住绝大多数滥用
 *   - 把锁做成强制，会把 KV 抖动放大成"全员无法保存"的故障
 *
 * 用法：
 *   const release = await acquireWriteLock(code);
 *   try { ... 临界区 ... } finally { await release(); }
 */
export async function acquireWriteLock(
  code: string
): Promise<{ ok: boolean; release: () => Promise<void> }> {
  const key = `lock:save:${code}`;
  try {
    // SET NX EX：仅当 key 不存在时才设置，TTL 5s 自动兜底防死锁
    const got = await kv.set(key, '1', { nx: true, ex: WRITE_LOCK_TTL_SEC });
    if (got) {
      return {
        ok: true,
        release: async () => {
          try {
            await kv.del(key);
          } catch {
            /* 失败也无所谓，TTL 会兜底 */
          }
        },
      };
    }
    // 拿不到锁 → 当前 code 有另一次 save 进行中
    return { ok: false, release: async () => {} };
  } catch {
    // KV 异常：fail-open，放行但不持锁
    return { ok: true, release: async () => {} };
  }
}

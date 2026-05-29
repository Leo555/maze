/**
 * POST /api/save
 *
 * 保存进度。
 *   入参：{ code: '12345678', progress: SaveData }
 *   返回：{ progress }（写入后的最终值）
 *
 * 鉴权：无（持有 code = 持有写权限）
 *
 * 反作弊（多层联动）：
 *   1. 同源校验（checkOrigin）
 *   2. 限流 / 多端并发检测（_lib/ratelimit）
 *      - L1 5s 最小提交间隔（仅挡脚本重放，真人节奏不受影响）
 *      - L2 5 min 12 次突发上限
 *      - L3 1 hour 同 IP 用 ≥ 4 个 code 视为滥用
 *      - 多端并发：sess 锚点 30s 内 IP+UA 都变 → 拒绝
 *   3. unlocked 增量 ≤ 5（防止本地直接改成全通关后强推）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp } from './_lib/http.js';
import {
  getProgress,
  setProgress,
  updateLeaderboards,
  markActive,
  ensureFirstSeen,
} from './_lib/kv.js';
import { checkWriteRate, commitWriteSession, acquireWriteLock } from './_lib/ratelimit.js';
import { normalizeSave, isValidCode, type SaveData } from '../shared/types.js';

const MAX_UNLOCK_DELTA = 5;

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!checkOrigin(req)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }

  // 解析 body
  const raw = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const code = String(body?.code || '').trim();
  if (!isValidCode(code)) {
    json(res, 400, { error: 'bad_code' });
    return;
  }
  const incoming = normalizeSave(body?.progress);
  if (!incoming) {
    json(res, 400, { error: 'bad_progress' });
    return;
  }

  // 多层限流 + 多端并发
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || '');
  const rate = await checkWriteRate(code, ip, ua);
  if (!rate.ok) {
    // 多端并发用 409 Conflict（语义上是"资源被另一处占用"）；
    // 限流类（too_fast / too_many_requests / ip_abuse）统一 429
    const status = rate.error === 'concurrent_play' ? 409 : 429;
    const payload: Record<string, unknown> = { error: rate.error };
    if (rate.retryAfterSec) payload.retryAfterSec = rate.retryAfterSec;
    json(res, status, payload);
    return;
  }

  // 反作弊：相比云端 unlocked 增量不能超过 5
  // 关键：getProgress → 校验 → setProgress 必须在同一互斥锁内，
  // 否则两个并发 save 都读到旧 unlocked、都通过校验、都写入 → 累计 +10 绕过限制
  const lock = await acquireWriteLock(code);
  if (!lock.ok) {
    // 同一 code 已有另一次 save 在进行 → 当作过快提交
    json(res, 429, { error: 'too_fast', retryAfterSec: 2 });
    return;
  }

  // current 在锁内读到，并要带出 finally 给排行榜 diff 用
  let current: SaveData | null = null;
  try {
    current = await getProgress(code);
    if (current && incoming.unlocked > current.unlocked + MAX_UNLOCK_DELTA) {
      json(res, 400, { error: 'unlock_delta_too_large' });
      return;
    }

    await setProgress(code, incoming);
  } finally {
    await lock.release();
  }

  // 更新会话锚点：必须在 setProgress 成功后，避免把同一玩家的连续 save
  // 误判为多端并发
  void commitWriteSession(code, ip, ua).catch(() => {});

  // 副作用（fire-and-forget，失败不影响主响应）：
  //   - 排行榜更新（综合榜 + 单关速通榜，带 prev 做 diff 处理"清除/退化"场景）
  //   - 活跃天 / 首次创建标记 / 总用户数
  void updateLeaderboards(code, incoming, current).catch(() => {});
  void markActive(code).catch(() => {});
  void ensureFirstSeen(code).catch(() => {});

  json(res, 200, { progress: incoming });
}

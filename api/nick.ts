/**
 * POST /api/nick
 *
 * 设置 / 更新昵称（玩家身份的唯一可见标识，也是上榜资格）。
 *   入参：{ code: '12345678', nick: '迷雾旅人' }
 *   返回：{ nick }
 *
 * 鉴权：无（持有 code = 持有写权限，与 save 一致）
 *
 * 限制：
 *   - 同 IP+code 每 5 分钟最多 5 次（防误操作 / 抖动重试）
 *   - 已设过昵称的改名 7 天冷却（防刷榜骚扰）；首次设置不限
 *
 * 副作用：
 *   - 首次设置成功后回填排行榜：玩家此前已有的进度会立即出现在榜单上
 *   - 已存在昵称的改名不需要回填（榜单 ZSET member 是 code，nick 只用于展示，
 *     展示时由 mgetNick 现拉，不需要重写榜单）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp } from './_lib/http.js';
import { isValidCode, isValidNick } from '../shared/types.js';
import {
  setNick,
  getNick,
  tryAcquireNickChangeSlot,
  backfillLeaderboards,
} from './_lib/kv.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 5 * 60;
const RATE_LIMIT_MAX = 5;

async function isRateLimited(ip: string, code: string): Promise<boolean> {
  const key = `rl:nick:${ip}:${code}`;
  const n = await kv.incr(key);
  if (n === 1) void kv.expire(key, RATE_LIMIT_WINDOW_SEC);
  return n > RATE_LIMIT_MAX;
}

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

  const raw = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const code = String(body?.code || '').trim();
  if (!isValidCode(code)) {
    json(res, 400, { error: 'bad_code' });
    return;
  }
  const nick = typeof body?.nick === 'string' ? body.nick : '';
  if (!isValidNick(nick)) {
    json(res, 400, { error: 'bad_nick' });
    return;
  }

  if (await isRateLimited(getClientIp(req), code)) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  // 判断是否首次设置：决定是否走改名冷却 + 是否回填排行榜
  const existing = await getNick(code);
  const isFirstTime = existing === null;
  // 幂等：新昵称与现有完全一致 → 直接 200 成功，不走冷却也不回填
  // 这样前端"重复点保存"或"鉴权重试"不会被冷却误伤
  if (existing === nick) {
    json(res, 200, { nick });
    return;
  }

  if (!isFirstTime) {
    // 已设过昵称的改名 → 7 天冷却
    const slot = await tryAcquireNickChangeSlot(code);
    if (!slot.ok) {
      json(res, 429, {
        error: 'nick_too_frequent',
        retryAfterSec: slot.retryAfterSec,
      });
      return;
    }
  }

  await setNick(code, nick);

  // 首次设置：把已有进度回填榜单（让玩家立刻可见排名）
  // fire-and-forget：失败不影响主响应；下一次 save 也会自然写榜
  if (isFirstTime) {
    void backfillLeaderboards(code).catch(() => {});
  }

  json(res, 200, { nick });
}

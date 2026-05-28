/**
 * POST /api/account/adopt
 *
 * 把指定 8 位编号对应的账号"领取"到本机。
 *   - 入参：{ code: '12345678' }
 *   - 行为：
 *     1. 校验 code 存在 → 找到 userId
 *     2. 轮换该用户 token（旧设备 cookie 立即失效）
 *     3. 把新 token 通过 Set-Cookie 写到本机的 maze_auth
 *     4. 返回 { code, progress }（账号此刻起被本机持有）
 *
 * 与 /api/sync 的区别：
 *   - /api/sync 仅只读拉取进度，不影响任何账号归属；
 *   - /api/adopt 真正"切换账号到本机"，调用后本机拥有该账号写权限，
 *     原持有该账号的设备需要重新 adopt 或重新 init 才能继续写云端。
 *
 * 安全：
 *   - 同源校验
 *   - IP 限频（同 /api/sync 同水位，防止暴力枚举编号占用别人账号）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setAuthCookie, json, checkOrigin } from '../_lib/http.js';
import { getUserIdByCode, getUserById, rotateUserToken } from '../_lib/kv.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 5 * 60;
const RATE_LIMIT_MAX = 30;

async function isRateLimited(ip: string): Promise<boolean> {
  const key = `rl:adopt:${ip}`;
  const n = await kv.incr(key);
  if (n === 1) {
    void kv.expire(key, RATE_LIMIT_WINDOW_SEC);
  }
  return n > RATE_LIMIT_MAX;
}

function safeJsonParse(s: string): { code?: unknown } | null {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? parsed : null;
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

  // IP 限流
  const ip =
    String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() || req.socket.remoteAddress || 'unknown';
  if (await isRateLimited(ip)) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  // 解析 body
  let body: { code?: unknown } | null;
  if (typeof req.body === 'string') {
    body = safeJsonParse(req.body);
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as { code?: unknown };
  } else {
    body = null;
  }
  const code = String((body && body.code) || '').trim();
  if (!/^\d{8}$/.test(code)) {
    json(res, 400, { error: 'bad_code' });
    return;
  }

  // 查 userId
  const userId = await getUserIdByCode(code);
  if (!userId) {
    json(res, 404, { error: 'not_found' });
    return;
  }
  const existing = await getUserById(userId);
  if (!existing) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  // 轮换 token：旧设备的 cookie 立即失效，新 token 写入本机
  const rotated = await rotateUserToken(userId);
  if (!rotated) {
    json(res, 500, { error: 'rotate_failed' });
    return;
  }

  setAuthCookie(res, rotated.user.userId, rotated.token);
  json(res, 200, {
    code: rotated.user.code,
    progress: rotated.user.progress,
  });
}

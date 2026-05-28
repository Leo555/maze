/**
 * POST /api/account/adopt
 *
 * 把指定 8 位编号对应的账号"绑定"到本机：
 *   - 入参：{ code: '12345678' }
 *   - 行为：
 *     1. 校验 code 存在 → 找到 userId
 *     2. 把该账号当前 token 通过 Set-Cookie 写到本机的 maze_auth
 *     3. 返回 { code, progress }
 *
 * 共享语义（多设备同账号）：
 *   - 不轮换 token：所有持有此账号编号的设备都能 adopt 拿到同一个 token，
 *     从而都具备写云端的权限
 *   - 与 /api/save 的 last-write-wins 配合：任何端通关都覆盖云端，
 *     其他端启动时拉到最新版本，自然实现"多端共享一份进度"
 *
 * 与 /api/sync 的区别：
 *   - /api/sync 只读拉进度，不下发 cookie；
 *   - /api/adopt 真正"把账号搬到本机"，调用后本机能写云端。
 *
 * 安全：
 *   - 同源校验
 *   - IP 限频（防止暴力枚举编号）
 *   - 编号是 8 位数字（[10000000, 99999999]），空间 ~9e7；配合限频足够。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setAuthCookie, json, checkOrigin } from '../_lib/http.js';
import { getUserIdByCode, getUserById } from '../_lib/kv.js';
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

  // 查 userId 并取出账号当前 token
  const userId = await getUserIdByCode(code);
  if (!userId) {
    json(res, 404, { error: 'not_found' });
    return;
  }
  const user = await getUserById(userId);
  if (!user) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  // 不轮换 token：直接把账号现有 token 下发到本机，
  // 与原持有该账号的其他设备共享同一份写权限
  setAuthCookie(res, user.userId, user.token);
  json(res, 200, {
    code: user.code,
    progress: user.progress,
  });
}

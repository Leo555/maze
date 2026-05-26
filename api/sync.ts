/**
 * GET /api/sync?code=12345678
 *
 * 用 8 位编号查任意账号的进度（只读，无需鉴权）。
 *
 * 这是\"分享你的进度给别人"的能力——
 * 别人输入或扫码你的编号 → 只读拉取你的进度合并到他自己账号 → 不会影响你的数据。
 *
 * 安全：
 *   - 只读，不接受写
 *   - 简易 IP 限流（防暴力枚举编号）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './_lib/http.js';
import { getUserIdByCode, getUserById } from './_lib/kv.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 5 * 60;
const RATE_LIMIT_MAX = 30;

async function isRateLimited(ip: string): Promise<boolean> {
  const key = `rl:sync:${ip}`;
  const n = await kv.incr(key);
  if (n === 1) {
    void kv.expire(key, RATE_LIMIT_WINDOW_SEC);
  }
  return n > RATE_LIMIT_MAX;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const code = String(req.query.code || '').trim();
  if (!/^\d{8}$/.test(code)) {
    json(res, 400, { error: 'bad_code' });
    return;
  }

  // IP 取 x-forwarded-for 第一段，兜底用 socket
  const ip =
    String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() || req.socket.remoteAddress || 'unknown';
  if (await isRateLimited(ip)) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

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
  json(res, 200, { progress: user.progress });
}

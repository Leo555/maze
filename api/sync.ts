/**
 * GET /api/sync?code=12345678
 *
 * 用 8 位 code 拉取进度（只读）。
 * 限流：同 IP 5 分钟最多 30 次。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, getClientIp } from './_lib/http.js';
import { getProgress } from './_lib/kv.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 5 * 60;
const RATE_LIMIT_MAX = 30;

async function isRateLimited(ip: string): Promise<boolean> {
  const key = `rl:sync:${ip}`;
  const n = await kv.incr(key);
  if (n === 1) void kv.expire(key, RATE_LIMIT_WINDOW_SEC);
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

  if (await isRateLimited(getClientIp(req))) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  const progress = await getProgress(code);
  if (!progress) {
    json(res, 404, { error: 'not_found' });
    return;
  }
  json(res, 200, { progress });
}

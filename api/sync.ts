/**
 * GET /api/sync?code=xxxxxxxx
 *
 * 用 8 位字母数字 code 拉取进度（只读）。
 * 鉴权：无（持有 code = 持有读权限）
 * 同源校验：必须来自白名单 Origin/Referer，拦第三方网页直接拉取
 * 限流：同 IP 5 分钟最多 30 次。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp } from './_lib/http.js';
import { getProgress } from './_lib/kv.js';
import { isValidCode } from '../shared/types.js';
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
  if (!checkOrigin(req)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }

  const code = String(req.query.code || '').trim();
  if (!isValidCode(code)) {
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

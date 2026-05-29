/**
 * GET /api/leaderboard
 *
 * 查询：
 *   ?type=overall&limit=50           综合榜 top N
 *   ?type=level&id=12&limit=50       第 12 关速通榜
 *
 * 鉴权：无（公开榜单）
 * 同源校验：仅允许白名单站点直接调用
 * 限流：同 IP 5 分钟最多 60 次
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp, getQueryParam } from './_lib/http.js';
import { getOverallTop, getLevelTop } from './_lib/kv.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 5 * 60;
const RATE_LIMIT_MAX = 60;

async function isRateLimited(ip: string): Promise<boolean> {
  const key = `rl:lb:${ip}`;
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

  if (await isRateLimited(getClientIp(req))) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  const type = (getQueryParam(req, 'type') || 'overall').toLowerCase();
  const limit = Number(getQueryParam(req, 'limit') || '50');

  if (type === 'overall') {
    const items = await getOverallTop(limit);
    json(res, 200, { type, items });
    return;
  }

  if (type === 'level') {
    const id = Number(getQueryParam(req, 'id') || '0');
    if (!Number.isInteger(id) || id < 1 || id > 100) {
      json(res, 400, { error: 'bad_level_id' });
      return;
    }
    const items = await getLevelTop(id, limit);
    json(res, 200, { type, levelId: id, items });
    return;
  }

  json(res, 400, { error: 'bad_type' });
}

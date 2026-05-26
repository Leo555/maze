/**
 * 用 8 位编号查询云端进度（只读，无需登录）
 *
 *   GET /api/sync?code=12345678
 *
 * 响应：
 *   200 { progress }                   成功
 *   400 { error: 'invalid_code' }     编号格式错
 *   404 { error: 'not_found' }         编号不存在
 *
 * 安全：
 *   - 编号是 9 千万空间内的随机映射，硬猜需大量尝试
 *   - 加 IP + UA 简易速率限制（KV 计数，5 分钟 30 次硬上限）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { json } from './_lib/http';
import { getOpenidByCode, getUser } from './_lib/kv';

const RATE_LIMIT_WINDOW_SEC = 300; // 5 分钟
const RATE_LIMIT_MAX = 30; // 5 分钟内最多 30 次（防爆破）

/** 简易 IP 限流：返回 true 表示放行 */
async function rateLimit(req: VercelRequest): Promise<boolean> {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const key = `rl:sync:${ip}`;
  // INCR 并设置过期：第一次设置 TTL，之后 TTL 不刷新（窗口式）
  const n = await kv.incr(key);
  if (n === 1) {
    // 注意 ioredis 是 EXPIRE，@vercel/kv 是 expire（小写）
    await kv.expire(key, RATE_LIMIT_WINDOW_SEC);
  }
  return n <= RATE_LIMIT_MAX;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!/^\d{8}$/.test(code)) {
    json(res, 400, { error: 'invalid_code' });
    return;
  }

  if (!(await rateLimit(req))) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  const openid = await getOpenidByCode(code);
  if (!openid) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  const user = await getUser(openid);
  if (!user) {
    // 极端情况：编号索引在但用户记录被删了
    json(res, 404, { error: 'not_found' });
    return;
  }

  json(res, 200, { progress: user.progress });
}

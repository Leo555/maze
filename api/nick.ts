/**
 * POST /api/nick
 *
 * 设置 / 更新昵称。
 *   入参：{ code: '12345678', nick: '迷雾旅人' }
 *   返回：{ nick }
 *
 * 鉴权：无（持有 code = 持有写权限，与 save 一致）
 * 限流：同 IP+code 每 5 分钟最多 5 次（防刷榜骚扰）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp } from './_lib/http.js';
import { isValidCode, isValidNick } from '../shared/types.js';
import { setNick } from './_lib/kv.js';
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

  await setNick(code, nick);
  json(res, 200, { nick });
}

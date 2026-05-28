/**
 * POST /api/save
 *
 * 保存进度。
 *   入参：{ code: '12345678', progress: SaveData }
 *   返回：{ progress }（写入后的最终值）
 *
 * 鉴权：无（持有 code = 持有写权限）
 *
 * 反作弊：上行进度相对云端 unlocked 增量不超过 5。
 *   如客户端 unlocked 比云端高 6 关以上 → 拒绝（防止本地改成全通关后强推）。
 *
 * 限流：同 IP+code 每 60s 最多 30 次。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp } from './_lib/http.js';
import { getProgress, setProgress } from './_lib/kv.js';
import { normalizeSave, isValidCode } from '../shared/types.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX = 30;
const MAX_UNLOCK_DELTA = 5;

async function isRateLimited(ip: string, code: string): Promise<boolean> {
  const key = `rl:save:${ip}:${code}`;
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

  // 限流
  const ip = getClientIp(req);
  if (await isRateLimited(ip, code)) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  // 反作弊：相比云端 unlocked 增量不能超过 5
  const current = await getProgress(code);
  if (current && incoming.unlocked > current.unlocked + MAX_UNLOCK_DELTA) {
    json(res, 400, { error: 'unlock_delta_too_large' });
    return;
  }

  await setProgress(code, incoming);
  json(res, 200, { progress: incoming });
}

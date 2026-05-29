/**
 * GET /api/leaderboard
 *
 * 查询：
 *   ?type=overall&limit=50           综合榜 top N
 *   ?type=level&id=12&limit=50       第 12 关速通榜
 *   可选附带 ?me=<8 位 code>           标记请求方自己（响应中对应行 isMe=true）
 *
 * 鉴权：无（公开榜单）
 * 同源校验：仅允许白名单站点直接调用
 * 限流：同 IP 5 分钟最多 60 次
 *
 * 安全说明：
 *   响应不返回任何玩家的 code（持有 code = 持有写权限），
 *   isMe 由后端比对后下发，前端不需要也无法独立判定。
 *   me 参数虽然会出现在 access log 中，但仅暴露请求方自己的 code，
 *   与既有 /api/sync?code=... 的暴露面一致，不放大攻击面。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp, getQueryParam } from './_lib/http.js';
import { getOverallTop, getLevelTop } from './_lib/kv.js';
import { isValidCode } from '../shared/types.js';
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

  // 可选 me 参数：用于在响应中标记请求方自己。
  // 非法值（不符合 8 位 code 格式）静默忽略——避免给第三方网站枚举 code 的接口
  const meRaw = (getQueryParam(req, 'me') || '').trim();
  const viewerCode = isValidCode(meRaw) ? meRaw : undefined;

  if (type === 'overall') {
    const items = await getOverallTop(limit, viewerCode);
    json(res, 200, { type, items });
    return;
  }

  if (type === 'level') {
    const id = Number(getQueryParam(req, 'id') || '0');
    if (!Number.isInteger(id) || id < 1 || id > 100) {
      json(res, 400, { error: 'bad_level_id' });
      return;
    }
    const items = await getLevelTop(id, limit, viewerCode);
    json(res, 200, { type, levelId: id, items });
    return;
  }

  json(res, 400, { error: 'bad_type' });
}

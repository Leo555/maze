/**
 * 查询当前用户的云端进度（基于 HttpOnly cookie 中的 openid）
 *
 *   GET /api/me
 *
 * 响应：
 *   200 { code, progress }    成功
 *   401 { error: 'unauthenticated' }   未登录（无 cookie 或 cookie 失效）
 *   404 { error: 'not_found' }         cookie 中 openid 不在 KV 中（被清过）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readUidCookie, json } from './_lib/http';
import { getUser } from './_lib/kv';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const openid = readUidCookie(req);
  if (!openid) {
    json(res, 401, { error: 'unauthenticated' });
    return;
  }

  const user = await getUser(openid);
  if (!user) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  json(res, 200, { code: user.code, progress: user.progress });
}

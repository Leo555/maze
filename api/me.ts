/**
 * GET /api/me
 *
 * 凭 maze_auth cookie 查自己的账号信息。
 *   - cookie 不存在或 token 不匹配 → 401 unauthenticated
 *   - 命中 → 返回 { code, hasWx, progress }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readAuthCookie, json } from './_lib/http.js';
import { getUserByToken } from './_lib/kv.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const auth = readAuthCookie(req);
  if (!auth) {
    json(res, 401, { error: 'unauthenticated' });
    return;
  }
  const user = await getUserByToken(auth.userId, auth.token);
  if (!user) {
    json(res, 401, { error: 'unauthenticated' });
    return;
  }
  json(res, 200, {
    code: user.code,
    hasWx: !!user.openid,
    progress: user.progress,
  });
}

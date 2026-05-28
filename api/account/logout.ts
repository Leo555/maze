import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearAuthCookie, json } from '../_lib/http.js';

/**
 * 通用退出账号接口（与微信无关）
 *
 * GET /api/account/logout
 * - 清除 maze_auth 与历史 maze_uid cookie
 * - 302 回首页
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }
  clearAuthCookie(res);
  res.setHeader('Location', '/');
  res.status(302).end();
}

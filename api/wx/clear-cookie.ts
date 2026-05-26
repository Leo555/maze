/**
 * 清空身份 cookie 端点（仅供调试与用户主动登出使用）。
 *
 *   GET /api/wx/clear-cookie
 *
 * 流程：
 *   1. 删除 maze_auth + 历史 maze_uid cookie
 *   2. 302 重定向回首页
 *
 * 用户再次访问首页时（且仍在微信内），main.ts 会因为没有 cookie 自动触发新的授权流程。
 * 用于排查"绑定到错误账号"或调试 cookie 链路。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearAuthCookie, json } from '../_lib/http.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }
  clearAuthCookie(res);
  // 用 setHeader 而非 writeHead，避免覆盖 Set-Cookie 头（callback.ts 同样的坑）
  res.setHeader('Location', '/');
  res.status(302).end();
}

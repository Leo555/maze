/**
 * 兼容历史回调：GET /api/wx/callback
 *
 * 当前项目不再依赖微信授权，保留该路由仅为了老链接不 404。
 * 统一跳转首页并带上失败标记，前端会优雅处理。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from '../_lib/http.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  res.setHeader('Location', '/?wx=fail');
  res.status(302).end();
}

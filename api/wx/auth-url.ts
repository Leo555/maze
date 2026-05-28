/**
 * 兼容历史接口：GET /api/wx/auth-url
 *
 * 当前项目已切换为“匿名账号 + 编号/二维码同步”，
 * 不再使用微信网页授权，因此固定返回 { url: null }。
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

  json(res, 200, { url: null });
}

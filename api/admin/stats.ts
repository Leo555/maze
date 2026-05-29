/**
 * GET /api/admin/stats?token=ADMIN_CODE
 *
 * 大盘统计：
 *   - totalUsers   累计创建过 code 的人数
 *   - dau          最近 7 天每日活跃数
 *   - levelClears  每关已通关人数（用于做"漏斗图"）
 *
 * 鉴权：ADMIN_CODE 环境变量
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, checkAdmin } from '../_lib/http.js';
import {
  getTotalUsers,
  getRecentDau,
  getLevelClearStats,
} from '../_lib/kv.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!checkOrigin(req)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  const auth = checkAdmin(req);
  if (!auth.ok) {
    json(res, auth.status, {
      error: auth.status === 503 ? 'admin_not_configured' : 'unauthorized',
    });
    return;
  }

  const [totalUsers, dau, levelClears] = await Promise.all([
    getTotalUsers(),
    getRecentDau(7),
    getLevelClearStats(),
  ]);

  json(res, 200, { totalUsers, dau, levelClears });
}

/**
 * GET /api/admin/user?token=ADMIN_CODE&target=XXXXXXXX
 *
 * 单个用户完整详情（进度 / 昵称 / 时间戳 / 综合榜排名）。
 *
 * 鉴权：ADMIN_CODE
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, checkAdmin, getQueryParam } from '../_lib/http.js';
import { adminGetUser } from '../_lib/kv.js';
import { isValidCode } from '../../shared/types.js';

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

  const target = (getQueryParam(req, 'target') || '').trim();
  if (!isValidCode(target)) {
    json(res, 400, { error: 'bad_target' });
    return;
  }

  const data = await adminGetUser(target);
  if (!data) {
    json(res, 404, { error: 'not_found' });
    return;
  }
  json(res, 200, data);
}

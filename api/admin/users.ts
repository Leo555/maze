/**
 * GET /api/admin/users?token=ADMIN_CODE&offset=0&limit=50
 *
 * 用户列表（按综合榜倒排分页）。
 *
 * 鉴权：ADMIN_CODE
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, checkAdmin, getQueryParam } from '../_lib/http.js';
import { adminListUsers } from '../_lib/kv.js';

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

  const offset = Number(getQueryParam(req, 'offset') || '0');
  const limit = Number(getQueryParam(req, 'limit') || '50');
  const items = await adminListUsers(offset, limit);
  json(res, 200, { offset, limit, items });
}

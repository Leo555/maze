/**
 * POST /api/account/init
 *
 * 创建匿名账号。
 *   - 任何浏览器/微信内首次访问时调用
 *   - 后端生成 userId/token/code，写 KV
 *   - 通过 Set-Cookie 下发 maze_auth=userId.token
 *   - 响应体返回 { code, progress }
 *
 * 安全：
 *   - 强校验同源（防止恶意第三方站点替用户创建账号占资源）
 *   - 客户端可选传入 initialProgress：服务端用 normalizeSave 兜底字段，
 *     避免有人传超大对象塞爆 KV
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setAuthCookie, json, checkOrigin } from '../_lib/http.js';
import { createAnonymousUser } from '../_lib/kv.js';
import { DEFAULT_SAVE, normalizeSave } from '../../shared/types.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!checkOrigin(req)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }

  // 客户端可选传入当前本地进度作为初始值
  let initial = DEFAULT_SAVE;
  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body)
        : (req.body as { progress?: unknown });
    if (body && typeof body === 'object') {
      const normalized = normalizeSave((body as { progress?: unknown }).progress);
      if (normalized) initial = normalized;
    }
  } catch {
    /* 忽略 body 解析失败；使用默认空进度 */
  }

  const user = await createAnonymousUser(initial);
  setAuthCookie(res, user.userId, user.token);
  json(res, 200, {
    code: user.code,
    progress: user.progress,
  });
}

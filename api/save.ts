/**
 * POST /api/save
 *
 * 凭 maze_auth cookie 上行进度。
 *
 * 服务端会做 pickRicher 仲裁：
 *   - 拿当前云端进度 vs 客户端上行的进度
 *   - 取"更进度"的一份写回
 *   - 这避免了多设备并发下"老进度回写覆盖新进度"的退化
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readAuthCookie, json, checkOrigin } from './_lib/http.js';
import { getUserByToken, updateUserProgress } from './_lib/kv.js';
import { normalizeSave, pickRicher } from '../shared/types.js';

function safeJsonParse(s: string): { progress?: unknown } | null {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

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

  // 解析 body：兼容 string 或 object
  let body: { progress?: unknown } | null;
  if (typeof req.body === 'string') {
    body = safeJsonParse(req.body);
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as { progress?: unknown };
  } else {
    body = null;
  }
  const incoming = body ? normalizeSave(body.progress) : null;
  if (!incoming) {
    json(res, 400, { error: 'bad_request' });
    return;
  }

  const merged = pickRicher(user.progress, incoming);
  const next = await updateUserProgress(user.userId, merged);
  if (!next) {
    json(res, 500, { error: 'update_failed' });
    return;
  }
  json(res, 200, { code: next.code, progress: next.progress });
}

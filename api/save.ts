/**
 * POST /api/save
 *
 * 凭 maze_auth cookie 上行进度。
 *
 * 写入语义（last-write-wins）：
 *   - 直接用客户端上行的进度覆盖云端，不做合并仲裁
 *   - 多设备共享同一账号时：手机/电脑谁后通关，云端就是谁的版本
 *   - 其他设备下次启动 bootstrap 时会用云端版本覆盖本地，从而看到最新进度
 *
 * 取舍：
 *   - 优点：多端切换体验一致、行为可预期
 *   - 代价：两端"几乎同时通关"的边界场景下，后写者会覆盖先写者新增的关，
 *     这是单账号多设备共享设计下用户接受的语义。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readAuthCookie, json, checkOrigin } from './_lib/http.js';
import { getUserByToken, updateUserProgress } from './_lib/kv.js';
import { normalizeSave } from '../shared/types.js';

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

  // last-write-wins：直接用客户端进度覆盖云端
  const next = await updateUserProgress(user.userId, incoming);
  if (!next) {
    json(res, 500, { error: 'update_failed' });
    return;
  }
  json(res, 200, { code: next.code, progress: next.progress });
}

/**
 * 保存当前用户的云端进度（基于 HttpOnly cookie 中的 openid）
 *
 *   POST /api/save
 *   Body: { progress: SaveData }
 *
 * 响应：
 *   200 { code, progress }    保存成功（返回服务端最终的进度，已 merge）
 *   400 { error: 'bad_request' }  请求体格式错
 *   401 { error: 'unauthenticated' }  无 cookie
 *   403 { error: 'forbidden' }    跨域来源
 *
 * 合并策略：
 *   服务端取「客户端上传 vs 服务端已有」中"更进度"的一份。
 *   这避免：用户在 A 设备通到 50 关，B 设备进度只到 10 关时上行
 *   覆盖了服务端的 50 关数据。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readUidCookie, json, checkOrigin } from './_lib/http.js';
import { getUser, updateUserProgress } from './_lib/kv.js';
import { normalizeSave, pickRicher } from '../shared/types.js';

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

  const openid = readUidCookie(req);
  if (!openid) {
    json(res, 401, { error: 'unauthenticated' });
    return;
  }

  // Vercel Functions 默认会自动 parse JSON body 到 req.body（对象）；
  // 但也支持以字符串形式接收，做双向兜底。
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

  const user = await getUser(openid);
  if (!user) {
    json(res, 401, { error: 'unauthenticated' });
    return;
  }

  // 服务端做最终仲裁：取更进度的一份，避免回退覆盖
  const merged = pickRicher(user.progress, incoming);
  const updated = await updateUserProgress(openid, merged);
  if (!updated) {
    json(res, 500, { error: 'save_failed' });
    return;
  }

  json(res, 200, { code: updated.code, progress: updated.progress });
}

function safeJsonParse(s: string): { progress?: unknown } | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

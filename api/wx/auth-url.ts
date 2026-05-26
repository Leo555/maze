/**
 * 返回当前可用的微信授权跳转 URL。
 *
 *   GET /api/wx/auth-url
 *
 * 前端在微信内首次访问时调用此接口，拿到 URL 后做 location.replace 跳转。
 * 把构造逻辑放后端的好处：AppID 改了无需改前端。
 *
 * 响应：
 *   200 { url } 或 200 { url: null } （未配置 AppID 时）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from '../_lib/http';
import { buildAuthUrl } from '../_lib/wx';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  if (!process.env.WX_APPID) {
    json(res, 200, { url: null });
    return;
  }

  // 回调地址：协议 + host + 我们的回调路由
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'maze.lz5z.com';
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const redirect = `${proto}://${host}/api/wx/callback`;

  json(res, 200, { url: buildAuthUrl(redirect) });
}

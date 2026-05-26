/**
 * 微信网页授权回调端点
 *
 *   GET /api/wx/callback?code=xxx&state=xxx
 *
 * 流程：
 *   1. 用 code 调微信换 openid
 *   2. ensureUser：已存在则取出，新用户则分配 8 位编号并写库
 *   3. set-cookie 写入身份（HttpOnly cookie）
 *   4. 302 重定向回首页（带 ?wx=ok 让前端弹一次"绑定成功"toast）
 *
 * 前端不应直接拿到 openid（它是 HttpOnly cookie），
 * 但能通过 /api/me 间接拿到 code + progress。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exchangeOpenid } from '../_lib/wx.js';
import { ensureUser } from '../_lib/kv.js';
import { setUidCookie, json } from '../_lib/http.js';
import { DEFAULT_SAVE } from '../../shared/types.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    json(res, 400, { error: 'missing_code' });
    return;
  }

  const openid = await exchangeOpenid(code);
  if (!openid) {
    // code 失效或换取失败：重定向回首页带错误标识
    res.setHeader('Location', '/?wx=fail');
    res.status(302).end();
    return;
  }

  // 注：新用户进度初始化为空，老用户已有进度直接返回
  // 真实进度合并在前端做（本地有进度时上行覆盖）
  const user = await ensureUser(openid, DEFAULT_SAVE);

  // 关键：用 setHeader 而非 writeHead 来设置 Location，
  // 否则 writeHead 的第二参数会覆盖之前 setUidCookie 设置的 Set-Cookie 头，
  // 导致前端拿不到身份 cookie，后续所有 /api/me /api/save 都会 401。
  setUidCookie(res, openid);
  res.setHeader('Location', `/?wx=ok&code=${encodeURIComponent(user.code)}`);
  res.status(302).end();
}

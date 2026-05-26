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
    res.writeHead(302, { Location: '/?wx=fail' });
    res.end();
    return;
  }

  // 注：新用户进度初始化为空，老用户已有进度直接返回
  // 真实进度合并在前端做（本地有进度时上行覆盖）
  const user = await ensureUser(openid, DEFAULT_SAVE);

  setUidCookie(res, openid);
  // 把 code 也带回前端，让 UI 立刻能展示
  res.writeHead(302, {
    Location: `/?wx=ok&code=${encodeURIComponent(user.code)}`,
  });
  res.end();
}

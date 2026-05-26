/**
 * 微信网页授权回调端点
 *
 *   GET /api/wx/callback?code=xxx&state=xxx
 *
 * v2 流程（4 种场景）：
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ 用 code 换 openid                                                   │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ 已有 maze_auth cookie（老 token） → currentUser                    │
 *   │   ├─ openid 已绑过别人 → 把那边的 progress 合并到 currentUser，    │
 *   │   │   并把 openid 索引指向 currentUser（旧 user 进度保留但失去 openid）│
 *   │   └─ openid 未绑 → 直接给 currentUser 绑上 openid                  │
 *   │                                                                    │
 *   │ 没有 maze_auth cookie（首次访问 / 浏览器没建账号过）                │
 *   │   ├─ openid 已绑 → 直接 setAuthCookie 拿回老账号                   │
 *   │   ├─ 历史 v1 数据存在 user:{openid} → 迁移到新 schema，setAuthCookie│
 *   │   └─ openid 也是新的 → createAnonymousUser + bindOpenid            │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * 安全：
 *   - 用户 token 校验保护，避免恶意第三方提交假 cookie 抢账号
 *   - 失败时不暴露内部错误，统一 ?wx=fail
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exchangeOpenid } from '../_lib/wx.js';
import {
  bindOpenid,
  createAnonymousUser,
  getUserById,
  getUserByToken,
  getUserIdByOpenid,
  readLegacyUserByOpenid,
  replaceProgress,
  rebindCodeToUser,
  deleteLegacyOpenidRecord,
} from '../_lib/kv.js';
import {
  setAuthCookie,
  readAuthCookie,
  json,
} from '../_lib/http.js';
import { DEFAULT_SAVE, pickRicher } from '../../shared/types.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const wxCode = typeof req.query.code === 'string' ? req.query.code : '';
  if (!wxCode) {
    json(res, 400, { error: 'missing_code' });
    return;
  }

  const openid = await exchangeOpenid(wxCode);
  if (!openid) {
    // code 失效或换取失败：重定向回首页带错误标识
    res.setHeader('Location', '/?wx=fail');
    res.status(302).end();
    return;
  }

  // 1) 拉取当前 token 对应的用户（如果有）
  const auth = readAuthCookie(req);
  const currentUser = auth ? await getUserByToken(auth.userId, auth.token) : null;

  // 2) 拉取 openid 对应的用户（如果有）
  let openidUserId = await getUserIdByOpenid(openid);

  // 2.1) v1 历史兼容：openid 索引不存在但旧 user:{openid} 存在 → 迁移
  if (!openidUserId) {
    const legacy = await readLegacyUserByOpenid(openid);
    if (legacy) {
      // 把老 user 数据迁移到新 schema：
      //   - 新建 anonymous user 拿到新 userId/token
      //   - 复用老 code（保留用户的"编号"心智）
      //   - 绑定 openid 索引指向新 userId
      //   - 删除老 user:{openid} 记录避免下次重复迁移
      const newUser = await createAnonymousUser(legacy.progress);
      await rebindCodeToUser({
        userId: newUser.userId,
        oldAutoCode: newUser.code, // 自动分配的临时 code（要丢弃）
        targetCode: legacy.code, // 老用户的 code（要保留）
        openid,
      });
      await deleteLegacyOpenidRecord(openid);
      openidUserId = newUser.userId;
    }
  }

  // 3) 分支处理
  let finalUserId: string;
  let finalCode: string;

  if (currentUser) {
    // 已有 token 的设备
    if (openidUserId && openidUserId !== currentUser.userId) {
      // 场景 A：老微信账号存在 + 当前 token 也是另一账号
      // 把 openid 端的进度合并进 currentUser，并把 openid 索引指向 currentUser
      const oldUser = await getUserById(openidUserId);
      if (oldUser) {
        const merged = pickRicher(currentUser.progress, oldUser.progress);
        await replaceProgress(currentUser.userId, merged);
      }
      await bindOpenid(currentUser.userId, openid);
      finalUserId = currentUser.userId;
      finalCode = currentUser.code;
    } else if (!openidUserId) {
      // 场景 B：openid 是新的 → 直接绑到 currentUser
      await bindOpenid(currentUser.userId, openid);
      finalUserId = currentUser.userId;
      finalCode = currentUser.code;
    } else {
      // 场景 C：openid 已绑 + 恰好就是 currentUser（重复授权）
      finalUserId = currentUser.userId;
      finalCode = currentUser.code;
    }
    setAuthCookie(res, finalUserId, currentUser.token);
  } else if (openidUserId) {
    // 场景 D：当前没 token，但 openid 已绑老账号 → 拿回那个账号的 token
    const oldUser = await getUserById(openidUserId);
    if (!oldUser) {
      // 索引脏了，兜底新建
      const created = await createAnonymousUser(DEFAULT_SAVE);
      await bindOpenid(created.userId, openid);
      finalUserId = created.userId;
      finalCode = created.code;
      setAuthCookie(res, finalUserId, created.token);
    } else {
      finalUserId = oldUser.userId;
      finalCode = oldUser.code;
      setAuthCookie(res, oldUser.userId, oldUser.token);
    }
  } else {
    // 场景 E：当前没 token + openid 也是新的 → 创建新账号 + 绑 openid
    const created = await createAnonymousUser(DEFAULT_SAVE);
    await bindOpenid(created.userId, openid);
    finalUserId = created.userId;
    finalCode = created.code;
    setAuthCookie(res, finalUserId, created.token);
  }

  // 兼容性：旧 cookie 名 maze_uid 残留时也清掉，避免后续读到老数据
  // setAuthCookie 已写入新的 maze_auth；这里不再处理 maze_uid（它会因 ITP 7 天 / 自然过期消失）

  res.setHeader('Location', `/?wx=ok&code=${encodeURIComponent(finalCode)}`);
  res.status(302).end();
}

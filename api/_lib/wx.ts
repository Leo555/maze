/**
 * 微信网页授权工具（仅后端使用）。
 *
 * 流程：
 *   1. 前端跳转到 https://open.weixin.qq.com/connect/oauth2/authorize?...
 *   2. 用户授权后回到我们配置的 redirect_uri，带上 ?code=xxx
 *   3. 后端用 code 调微信 access_token 接口，换取 openid
 *   4. snsapi_base 流程到此结束（只拿到 openid）；snsapi_userinfo 还能拿昵称头像
 */

const APPID = process.env.WX_APPID ?? '';
const APPSECRET = process.env.WX_APPSECRET ?? '';

/** 微信 access_token 接口返回 */
interface WxTokenResp {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  openid?: string;
  scope?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 用授权 code 换取 openid。
 *
 * @returns openid（成功）或 null（失败）
 *
 * 错误场景：
 *   - code 已被使用过（微信 code 一次性，5 分钟有效）
 *   - APPID/APPSECRET 配错
 *   - 用户拒绝授权
 */
export async function exchangeOpenid(code: string): Promise<string | null> {
  if (!APPID || !APPSECRET) {
    console.error('WX_APPID / WX_APPSECRET 未配置');
    return null;
  }
  const url =
    `https://api.weixin.qq.com/sns/oauth2/access_token` +
    `?appid=${encodeURIComponent(APPID)}` +
    `&secret=${encodeURIComponent(APPSECRET)}` +
    `&code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as WxTokenResp;
    if (data.errcode || !data.openid) {
      console.error('exchangeOpenid failed:', data);
      return null;
    }
    return data.openid;
  } catch (err) {
    console.error('exchangeOpenid network error:', err);
    return null;
  }
}

/** 构造网页授权 URL（snsapi_base：静默授权，无弹窗） */
export function buildAuthUrl(redirectUri: string, state = ''): string {
  return (
    `https://open.weixin.qq.com/connect/oauth2/authorize` +
    `?appid=${encodeURIComponent(APPID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=snsapi_base` +
    `&state=${encodeURIComponent(state)}` +
    `#wechat_redirect`
  );
}

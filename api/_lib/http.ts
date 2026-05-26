/**
 * Vercel Functions 通用工具（Node Runtime）。
 *
 * 这一层封装统一的：
 *   - 解析 cookie / 设置 cookie
 *   - JSON 响应包装
 *   - CORS / Origin 校验（暂宽松，仅同源）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const COOKIE_NAME = 'maze_uid';
/** cookie 寿命：400 天（Chrome 上限） */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** 从请求 Cookie 头中读取我们的身份 cookie（含 openid） */
export function readUidCookie(req: VercelRequest): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 写入身份 cookie（HttpOnly + SameSite=Lax + Secure） */
export function setUidCookie(res: VercelResponse, openid: string): void {
  const value = encodeURIComponent(openid);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax; Secure`
  );
}

/** 清空身份 cookie */
export function clearUidCookie(res: VercelResponse): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`
  );
}

/** 标准 JSON 响应 */
export function json(
  res: VercelResponse,
  status: number,
  body: Record<string, unknown>
): void {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 不缓存 API 响应
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.send(JSON.stringify(body));
}

/** 简易同源校验：拒绝非本站域名的写请求 */
export function checkOrigin(req: VercelRequest): boolean {
  const allowed = process.env.ALLOWED_ORIGIN || 'https://maze.lz5z.com';
  const origin = req.headers.origin;
  // 允许无 origin（同源 form 提交、手机 App webview）
  if (!origin) return true;
  return origin === allowed;
}

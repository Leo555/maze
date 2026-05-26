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

/**
 * 同源校验：仅拒绝跨域来源的写请求。
 *
 * ALLOWED_ORIGIN 环境变量支持多个值（逗号分隔）；
 * 比较时去掉末尾斜杠与首尾空白，避免人为配置失误。
 *
 * 不带 Origin 头的请求一律放行（同源 form 提交、Service Worker、原生 App webview 都不带）。
 */
export function checkOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;

  const normalize = (s: string): string => s.trim().replace(/\/+$/, '').toLowerCase();
  const allowedRaw = process.env.ALLOWED_ORIGIN || 'https://maze.lz5z.com';
  const allowList = allowedRaw.split(',').map(normalize).filter(Boolean);
  return allowList.includes(normalize(origin));
}

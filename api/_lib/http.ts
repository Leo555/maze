/**
 * Vercel Functions 通用工具（Node Runtime）。
 *
 * 这一层封装统一的：
 *   - 解析 cookie / 设置 cookie
 *   - JSON 响应包装
 *   - Origin 同源校验
 *
 * v2 鉴权模型：
 *   cookie 形式 `maze_auth=<userId>.<token>`
 *   - userId 部分明文（UUID），用于查 user 记录
 *   - token 部分私密，与 KV 中存储的 user.token 比对
 *   - 仅当二者匹配才视为已鉴权
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const COOKIE_NAME = 'maze_auth';
/** cookie 寿命：400 天（Chrome 上限） */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** v1 历史 cookie 名（仅在 callback 迁移时读取） */
const LEGACY_UID_COOKIE = 'maze_uid';

/** 通用 cookie 读取 */
function readCookie(req: VercelRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 鉴权信息（已分解 userId + token） */
export interface AuthInfo {
  userId: string;
  token: string;
}

/** 从请求中读取并解析鉴权 cookie */
export function readAuthCookie(req: VercelRequest): AuthInfo | null {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return null;
  const idx = raw.indexOf('.');
  if (idx <= 0) return null;
  const userId = raw.slice(0, idx);
  const token = raw.slice(idx + 1);
  if (!userId || !token) return null;
  return { userId, token };
}

/** 写入鉴权 cookie */
export function setAuthCookie(
  res: VercelResponse,
  userId: string,
  token: string
): void {
  const value = encodeURIComponent(`${userId}.${token}`);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax; Secure`
  );
}

/** 清空鉴权 cookie（同时清掉历史 maze_uid，避免老 cookie 残留干扰） */
export function clearAuthCookie(res: VercelResponse): void {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
    `${LEGACY_UID_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
  ]);
}

/** 标准 JSON 响应 */
export function json(
  res: VercelResponse,
  status: number,
  body: Record<string, unknown>
): void {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

  const normalize = (s: string): string =>
    s.trim().replace(/\/+$/, '').toLowerCase();
  const allowedRaw = process.env.ALLOWED_ORIGIN || 'https://maze.lz5z.com';
  const allowList = allowedRaw.split(',').map(normalize).filter(Boolean);
  return allowList.includes(normalize(origin));
}

/**
 * Vercel Functions 通用工具（极简版）
 *
 * 只剩两个职责：
 *   1. 标准 JSON 响应包装
 *   2. 同源校验（防止第三方站点用浏览器写云端）
 *
 * 不再有 cookie / token / 鉴权概念——8 位 code 由前端持有，
 * 前端持有 = 拥有写权限。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

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
 * ALLOWED_ORIGIN 环境变量支持多个值（逗号分隔）。
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

/** 取请求方 IP（限流用） */
export function getClientIp(req: VercelRequest): string {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || 'unknown';
}

/**
 * Vercel Functions 通用工具（极简版）
 *
 * 只剩两个职责：
 *   1. 标准 JSON 响应包装
 *   2. 同源校验（防止第三方站点用浏览器读/写云端）
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

const DEFAULT_ALLOWED = 'https://maze.lz5z.com';

function normalize(s: string): string {
  return s.trim().replace(/\/+$/, '').toLowerCase();
}

function getAllowList(): string[] {
  const raw = process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED;
  return raw.split(',').map(normalize).filter(Boolean);
}

/**
 * 严格同源校验（写/读接口共用）。
 *
 * 策略：
 *   1. 优先看 Origin 头（POST + application/json 的请求浏览器必发）
 *   2. Origin 缺失时退而看 Referer 头（GET 同源浏览器不发 Origin 但发 Referer）
 *   3. 两者都缺失 → 视为"非浏览器请求"，按你的需求一律拒绝
 *
 * 安全模型说明：
 *   - 该校验对抗"第三方网站用浏览器嵌 iframe / fetch 偷调"等场景（浏览器无法伪造 Origin/Referer）
 *   - 但无法对抗 curl / Postman / 脚本（这些工具可以伪造或省略所有头）
 *     真正抵御脚本攻击的是：
 *       a) 8 位 code 不可猜（crypto 随机 + 32^8 ≈ 1.1 万亿空间）
 *       b) IP+code 维度限流
 *       c) unlocked 增量 ≤ 5 的反作弊
 *
 * 配置：
 *   ALLOWED_ORIGIN 环境变量（逗号分隔多个值），默认 https://maze.lz5z.com
 *   本地开发时建议设为 https://maze.lz5z.com,http://localhost:5173,http://localhost:3000
 */
export function checkOrigin(req: VercelRequest): boolean {
  const allowList = getAllowList();

  // 1. Origin 头校验（POST + JSON 请求必发）
  const origin = req.headers.origin;
  if (origin) {
    return allowList.includes(normalize(origin));
  }

  // 2. Origin 缺失：用 Referer 兜底（GET 同源浏览器虽然不发 Origin，但通常发 Referer）
  const referer = req.headers.referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return allowList.includes(normalize(refOrigin));
    } catch {
      return false;
    }
  }

  // 3. Origin 与 Referer 都缺失 → 非浏览器请求 → 拒绝
  // 注意：这会拒绝 curl / Postman / 没带 Referrer-Policy 的特殊场景，
  // 这正是"只允许 maze.lz5z.com 页面调用"诉求的预期行为。
  return false;
}

/** 取请求方 IP（限流用） */
export function getClientIp(req: VercelRequest): string {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || 'unknown';
}

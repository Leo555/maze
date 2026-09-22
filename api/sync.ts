/**
 * GET /api/sync?code=xxxxxxxx
 *
 * 用 8 位字母数字 code 拉取进度（只读）。
 * 鉴权：无（持有 code = 持有读权限）
 * 同源校验：必须来自白名单 Origin/Referer，拦第三方网页直接拉取
 * 限流：同 IP 5 分钟最多 30 次。
 *
 * 响应同时返回 progress + nick：
 *   - 玩家启动 / 切换 code 时只发一次请求即可同步两者
 *   - 昵称仅在云端有时返回，缺失时为 null（前端兜底显示 maskCode 即可）
 *
 * 关于 "code 不存在" 的响应约定（2026-09 调整）：
 *   历史返回 404 { error: 'not_found' }，但从业务视角看，"查一个 code 没查到"
 *   属于合法查询空结果，不是错误。前端本就把它当作"云端无进度 → 用本地"处理，
 *   却让 DevTools Network 面板飘一条红色 404 记录，且被浏览器扩展 / 监控 SDK
 *   （如 Sentry Network Breadcrumbs）当作接口异常。
 *
 *   现改为：progress 不存在时返回 200 { progress: null, nick: null }，
 *   语义与 leaderboard 空结果（200 空数组）一致，本项目所有查询接口的
 *   "查不到" 一律用 200 + null/[] 表达。前端 pullByCode 已收敛为
 *   "progress == null → 视为无云端存档"。
 *
 *   仍保留 4xx 的情况：
 *     - bad_code   400：入参格式错，属于客户端错误
 *     - forbidden  403：同源校验不过，安全强信号必须保留
 *     - rate limit 429：限流，需要提醒开发者/前端退避
 *
 * 实现说明：
 *   query 解析用 WHATWG URL（new URL + searchParams）而不是 req.query。
 *   `req.query` 由 Vercel runtime 注入，部分历史版本内部仍用 node:url.parse()，
 *   会触发 [DEP0169] DeprecationWarning（Function logs 中可见）。
 *   用 WHATWG URL 自己解析既符合现代规范、也避免业务路径依赖该旧 API。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json, checkOrigin, getClientIp, getQueryParam } from './_lib/http.js';
import { getProgress, getNick } from './_lib/kv.js';
import { isValidCode } from '../shared/types.js';
import { kv } from '@vercel/kv';

const RATE_LIMIT_WINDOW_SEC = 5 * 60;
const RATE_LIMIT_MAX = 30;

async function isRateLimited(ip: string): Promise<boolean> {
  const key = `rl:sync:${ip}`;
  const n = await kv.incr(key);
  if (n === 1) void kv.expire(key, RATE_LIMIT_WINDOW_SEC);
  return n > RATE_LIMIT_MAX;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!checkOrigin(req)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }

  const code = (getQueryParam(req, 'code') || '').trim();
  if (!isValidCode(code)) {
    json(res, 400, { error: 'bad_code' });
    return;
  }

  if (await isRateLimited(getClientIp(req))) {
    json(res, 429, { error: 'too_many_requests' });
    return;
  }

  // 并发拉取 progress + nick：节省一次 RTT
  // 注意：progress 不存在视为"云端无存档"，返回 200 + null（详见文件头说明）。
  // KV 中 nick 单独存在但 progress 缺失是异常状态，仍按"无存档"处理，前端
  // 拿到 progress=null 会走本地存档流程；nick 也不返回，避免误显示成"云端昵称"。
  const [progress, nick] = await Promise.all([getProgress(code), getNick(code)]);
  if (!progress) {
    json(res, 200, { progress: null, nick: null });
    return;
  }
  json(res, 200, { progress, nick: nick ?? null });
}

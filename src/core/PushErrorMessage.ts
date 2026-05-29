/**
 * 云端写入失败的统一文案路由。
 *
 * 后端在 ratelimit / 反作弊命中时返回不同的 error 字段，
 * 前端把这些错误码映射成对玩家友好的提示。
 *
 * 集中管理的好处：未来文案微调或多语言时只需要改这一处。
 */

import type { PushError } from './CloudSync';

export function pushErrorMessage(err?: PushError, retryAfterSec?: number): string {
  switch (err) {
    case 'too_fast':
      // 30s 间隔上限，给个具体秒数让玩家知道何时可重试
      return retryAfterSec
        ? `操作过于频繁，请 ${retryAfterSec} 秒后再试`
        : '操作过于频繁，请稍后再试';
    case 'too_many_requests':
      return '提交过于频繁，请稍作休息后再试';
    case 'ip_abuse':
      return '检测到异常访问，已临时限制。如非本人操作请忽略';
    case 'concurrent_play':
      // 多端并发：明确告知用户，引导停止其他设备
      return '此编号正在另一台设备上游玩，请勿同时多端使用';
    case 'unlock_delta_too_large':
      return '检测到进度异常，本次未保存';
    case 'forbidden':
      return '请求被拦截，请刷新页面后重试';
    case 'bad_code':
      return '编号无效';
    case 'bad_progress':
      return '进度数据异常';
    case 'network':
    default:
      return '网络异常，进度暂存本地，稍后将自动重试';
  }
}

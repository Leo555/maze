/**
 * 昵称设置失败的统一文案路由（与 PushErrorMessage 同模式）。
 *
 * 集中管理：UI 层（基础设置 / 启动门槛页）通过同一映射给出一致提示。
 */

import type { NickError } from './CloudSync';

/** 把秒数格式化为"X 天" / "X 小时" / "X 分钟"，给改名冷却用 */
function formatCooldown(sec: number): string {
  if (sec >= 86400) return `${Math.ceil(sec / 86400)} 天`;
  if (sec >= 3600) return `${Math.ceil(sec / 3600)} 小时`;
  if (sec >= 60) return `${Math.ceil(sec / 60)} 分钟`;
  return `${Math.max(1, Math.ceil(sec))} 秒`;
}

export function nickErrorMessage(
  err?: NickError,
  retryAfterSec?: number
): string {
  switch (err) {
    case 'bad_nick':
      return '昵称需 1-12 字、不含控制字符';
    case 'bad_code':
      return '账号异常，请刷新页面后重试';
    case 'too_many_requests':
      return '操作过于频繁，请稍后再试';
    case 'nick_too_frequent':
      return retryAfterSec
        ? `昵称已修改过，请 ${formatCooldown(retryAfterSec)}后再改`
        : '昵称修改过于频繁，请稍后再试';
    case 'forbidden':
      return '请求被拦截，请刷新页面后重试';
    case 'network':
    default:
      return '网络异常，请稍后重试';
  }
}

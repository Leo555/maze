/**
 * 应用入口
 *
 * 启动顺序（按性能优先级排序）：
 *   1. 立即创建 Game（首屏关键路径）
 *   2. 在浏览器空闲时再注入 Vercel Analytics（非关键，不阻塞首屏）
 */

import './styles.css';
import { Game } from './core/Game';

new Game();

// === Vercel Web Analytics（延迟注入，避免阻塞首屏渲染）===
// inject() 内部会同步加载 va.vercel-scripts.com 的 script.js（~3KB）
// 推迟到 idle 阶段，保证用户先看到主菜单再去发请求
// 本地 dev 不会发送任何请求（mode=development）
const scheduleAnalytics = (): void => {
  // 动态导入 → @vercel/analytics 不进入主 bundle，省掉首屏 ~2KB（gzip ~1KB）
  import('@vercel/analytics').then(({ inject }) => {
    inject({ mode: import.meta.env.DEV ? 'development' : 'production' });
  });
};
// requestIdleCallback 在 Safari 上不可用 → 用 setTimeout 兜底
if ('requestIdleCallback' in window) {
  (window as Window & {
    requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback(scheduleAnalytics, { timeout: 2000 });
} else {
  setTimeout(scheduleAnalytics, 1000);
}


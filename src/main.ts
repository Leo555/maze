/**
 * 应用入口
 *
 * 启动顺序（按性能优先级排序）：
 *   1. 立即创建 Game（首屏关键路径）
 *   2. 在浏览器空闲时再注入 Vercel Analytics（非关键，不阻塞首屏）
 */

import './styles.css';
import { Game } from './core/Game';

// === iOS Safari 缩放防护（必须在 Game 之前安装）===
// iOS 10+ 的 Safari 会忽略 viewport meta 的 user-scalable=no（无障碍政策），
// 双指或双击仍会触发整页缩放，且缩放状态会持久化在浏览器内存里——
// 用户哪怕刷新页面也无法恢复，必须手动手势缩回去，体验灾难。
//
// 三层防护：
//   1. gesturestart/gesturechange/gestureend：iOS 专属手势事件，preventDefault 阻断双指缩放
//   2. dblclick：阻断双击放大
//   3. 多指 touchstart：兜底（部分老 iOS 不触发 gesture 事件）
//
// 必须用非 passive 监听（passive 时 preventDefault 无效）
const blockZoom = (e: Event): void => {
  e.preventDefault();
};
document.addEventListener('gesturestart', blockZoom, { passive: false });
document.addEventListener('gesturechange', blockZoom, { passive: false });
document.addEventListener('gestureend', blockZoom, { passive: false });
document.addEventListener('dblclick', blockZoom, { passive: false });
// 兜底：双指及以上同时按下，直接 preventDefault
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);

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



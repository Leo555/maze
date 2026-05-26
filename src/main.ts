/**
 * 应用入口
 *
 * 启动顺序（按性能优先级排序）：
 *   1. 立即创建 Game（首屏关键路径）
 *   2. 在浏览器空闲时再注入 Vercel Analytics（非关键，不阻塞首屏）
 */

import './styles.css';
import { Game } from './core/Game';
import { isInWeChat, isStandalone } from './core/Environment';
import { maybeShowAddToHomeScreen } from './ui/AddToHomeScreen';

// === 全局环境标记（CSS 可针对 body[data-env] 做差异化样式）===
// 在游戏初始化前打标，让首次绘制就带着正确的环境信息
{
  const flags: string[] = [];
  if (isInWeChat()) flags.push('wechat');
  if (isStandalone()) flags.push('standalone');
  if (flags.length > 0) document.body.dataset.env = flags.join(' ');
}

// === 100vh fallback（修复微信 X5 / iOS Safari 工具栏遮挡）===
// 现代浏览器都支持 100dvh，但旧版微信 X5 内核有时返回错误值。
// 用 JS 主动测算后写入 CSS 变量 --app-height，CSS 用 var(--app-height) 兜底。
const updateAppHeight = (): void => {
  document.documentElement.style.setProperty(
    '--app-height',
    `${window.innerHeight}px`
  );
};
updateAppHeight();
window.addEventListener('resize', updateAppHeight);
// 微信内横竖屏切换不会发 resize，要监听 orientationchange
window.addEventListener('orientationchange', () => {
  // orientationchange 后 innerHeight 可能还没更新，多打一次确保拿到最新值
  setTimeout(updateAppHeight, 100);
});

// === iOS Safari / 微信内置浏览器 缩放与下拉防护 ===
// iOS 10+ 的 Safari 会忽略 viewport meta 的 user-scalable=no（无障碍政策），
// 双指或双击仍会触发整页缩放，且缩放状态会持久化在浏览器内存里——
// 用户哪怕刷新页面也无法恢复。微信 X5 内核同样存在双击放大行为。
//
// 三层防护：
//   1. gesturestart/gesturechange/gestureend：iOS 专属手势事件，preventDefault 阻断双指缩放
//   2. dblclick：阻断双击放大
//   3. 多指 touchstart：兜底（部分老 iOS / 微信 X5 不触发 gesture 事件）
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
// 微信 X5 内核默认会响应 body 的下拉触发"刷新页面"行为，影响游戏滑动；
// touchmove 在 body 上 preventDefault 阻断系统级下拉刷新
document.addEventListener(
  'touchmove',
  (e) => {
    // 仅在 game 容器内阻断（避免误伤未来可能加的可滚动 UI）
    const target = e.target as HTMLElement | null;
    if (target && target.closest('#app')) e.preventDefault();
  },
  { passive: false }
);

new Game();

// 第 2 次以上访问的 iOS Safari 用户，提示「添加到主屏」
// 加到主屏后 localStorage 不再受 ITP 7 天清理影响，进度持久化大幅提升
maybeShowAddToHomeScreen();

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




/**
 * 应用入口
 *
 * 启动顺序（首屏性能优先）：
 *   1. 立即 new Game() —— 用本地存档启动，0 阻塞、首屏可交互
 *   2. 后台并行：云端拉最新进度 / ?recover=xxxxxxxx adopt
 *      —— 主菜单 & 同步面板已订阅 storage.onChange，
 *         云端数据到了会自动刷新对应 UI，无需 await
 *   3. 浏览器空闲时再注入 Vercel Analytics（非关键，不阻塞首屏）
 *
 * 性能历史：之前是 await storage.bootstrapPromise（最多 1500ms）后再 new Game()，
 * 慢网下首屏 TTI 会被云端 RTT 拖到 1.5s+。改为立即启动后，即使在 4G/弱网
 * 也能瞬开，云端进度晚到几百毫秒对玩家几乎不可感知（主菜单卡片会平滑刷新）。
 */

import './styles.css';
import { Game } from './core/Game';
import { isInWeChat, isStandalone } from './core/Environment';
import { maybeShowAddToHomeScreen } from './ui/AddToHomeScreen';
import { storage } from './core/Storage';
import { showToast } from './ui/Toast';
import { pushErrorMessage } from './core/PushErrorMessage';
import { isValidCode } from '../shared/types';
import { maybeShowAccountGate } from './ui/overlays/AccountGate';

// === 全局环境标记（CSS 可针对 body[data-env] 做差异化样式）===
{
  const flags: string[] = [];
  if (isInWeChat()) flags.push('wechat');
  if (isStandalone()) flags.push('standalone');
  if (flags.length > 0) document.body.dataset.env = flags.join(' ');
}

// === 100vh fallback（修复微信 X5 / iOS Safari 工具栏遮挡）===
const updateAppHeight = (): void => {
  document.documentElement.style.setProperty(
    '--app-height',
    `${window.innerHeight}px`
  );
};
updateAppHeight();
window.addEventListener('resize', updateAppHeight);
window.addEventListener('orientationchange', () => {
  setTimeout(updateAppHeight, 100);
});

// === iOS Safari / 微信内置浏览器 缩放与下拉防护 ===
const blockZoom = (e: Event): void => {
  e.preventDefault();
};
document.addEventListener('gesturestart', blockZoom, { passive: false });
document.addEventListener('gesturechange', blockZoom, { passive: false });
document.addEventListener('gestureend', blockZoom, { passive: false });
document.addEventListener('dblclick', blockZoom, { passive: false });
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest('#app')) return;
    // overlay 内部的可滚动元素（关卡选择列表、设置面板等）必须放行
    // 否则触屏滑动会被全局拦截，列表无法滚动
    // 判定：从 target 向上找，存在任何"内容溢出且 overflow-y 允许滚动"的祖先就放行
    if (isInsideScrollable(target)) return;
    e.preventDefault();
  },
  { passive: false }
);

/**
 * 判断元素是否在某个"可滚动容器"内部。
 * 用于区分"需要拦截的全局橡皮筋"和"用户在列表里正常滚动"两种 touchmove。
 */
function isInsideScrollable(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const style = getComputedStyle(cur);
    const oy = style.overflowY;
    const canScrollY =
      (oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight;
    if (canScrollY) return true;
    cur = cur.parentElement;
  }
  return false;
}

const params = new URLSearchParams(location.search);
const recoverCode = params.get('recover');

// === 立即启动 Game（用本地存档，0 阻塞）===
new Game();
// 启动账号门槛：等 bootstrap 完成 → 无昵称则弹（设置昵称 / 输入编号 二选一）
// 不阻塞游戏启动，玩家在弹框关闭前看不到主菜单交互（CSS 层级保证）
maybeShowAccountGate();
// 第 2 次以上访问的 iOS Safari 用户，提示「添加到主屏」
maybeShowAddToHomeScreen();

// === 全局云端写入失败提示 ===
// 通关 push 在后台进行，失败时由 Storage 通过 onPushError 通知；
// 这里统一弹 Toast，避免每个调用处都要重复处理。
// 短间隔内多次触发只展示一次，避免限流场景刷屏。
let lastPushErrAt = 0;
storage.onPushError((err, retryAfterSec) => {
  const now = Date.now();
  if (now - lastPushErrAt < 1500) return;
  lastPushErrAt = now;
  // concurrent_play / ip_abuse / unlock_delta_too_large 是相对严重的安全提示，
  // 用 error 类型 + 较长展示时间；其它（network/too_fast）用 info 较温和
  const severe =
    err === 'concurrent_play' ||
    err === 'ip_abuse' ||
    err === 'unlock_delta_too_large';
  showToast(
    pushErrorMessage(err, retryAfterSec),
    severe ? 'error' : 'info',
    severe ? 4500 : 2400
  );
});

// === 后台异步：?recover=xxxxxxxx 扫码恢复 + 云端进度同步 ===
// 主菜单 / 同步面板订阅了 storage.onChange，云端数据到了会自动刷新 UI
if (recoverCode && isValidCode(recoverCode)) {
  history.replaceState(null, '', location.pathname + location.hash);
  storage.adoptCode(recoverCode).then((ok) => {
    if (ok) {
      showToast(`已恢复编号 ${recoverCode} 的进度`, 'success', 2800);
    } else {
      showToast('编号不存在或操作过于频繁', 'error', 2400);
    }
  });
}

// === Vercel Web Analytics（延迟注入，避免阻塞首屏渲染）===
// 只在线上域名注入，避免本地 vite preview / 自部署环境出现
// /_vercel/insights/script.js 404 噪声
const isProdHost =
  location.hostname === 'maze.lz5z.com' || location.hostname.endsWith('.vercel.app');
const scheduleAnalytics = (): void => {
  if (!isProdHost) return;
  import('@vercel/analytics').then(({ inject }) => {
    inject({ mode: import.meta.env.DEV ? 'development' : 'production' });
  });
};
if ('requestIdleCallback' in window) {
  (window as Window & {
    requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback(scheduleAnalytics, { timeout: 2000 });
} else {
  setTimeout(scheduleAnalytics, 1000);
}

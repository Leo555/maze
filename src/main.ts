/**
 * 应用入口
 *
 * 启动顺序：
 *   1. 处理 ?recover=xxxxxxxx：在 Game 初始化前完成 code 切换
 *   2. 等待 Storage bootstrap（拉云端最新进度），最多 1.5s 超时兜底
 *   3. new Game()
 *   4. 浏览器空闲时再注入 Vercel Analytics（非关键，不阻塞首屏）
 */

import './styles.css';
import { Game } from './core/Game';
import { isInWeChat, isStandalone } from './core/Environment';
import { maybeShowAddToHomeScreen } from './ui/AddToHomeScreen';
import { storage } from './core/Storage';
import { showToast } from './ui/Toast';
import { isValidCode } from '../shared/types';

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
    if (target && target.closest('#app')) e.preventDefault();
  },
  { passive: false }
);

const params = new URLSearchParams(location.search);
const recoverCode = params.get('recover');

/** Promise 超时兜底；超时不抛错只 resolve undefined */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(undefined);
    }, ms);
    p.then((v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }).catch(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

async function bootstrap(): Promise<void> {
  // === 1. ?recover=xxxxxxxx：扫码 / 链接恢复 ===
  if (recoverCode && isValidCode(recoverCode)) {
    history.replaceState(null, '', location.pathname + location.hash);
    const ok = await withTimeout(storage.adoptCode(recoverCode), 1500);
    setTimeout(() => {
      if (ok) {
        showToast(`已恢复编号 ${recoverCode} 的进度`, 'success', 2800);
      } else {
        showToast('编号不存在或操作过于频繁', 'error', 2400);
      }
    }, 600);
  }

  // === 2. 等待云端进度 bootstrap 完成 ===
  await withTimeout(storage.bootstrapPromise, 1500);

  // === 3. 启动 Game ===
  new Game();

  // 第 2 次以上访问的 iOS Safari 用户，提示「添加到主屏」
  maybeShowAddToHomeScreen();
}

void bootstrap();

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

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
import { fetchAuthUrl } from './core/CloudSync';
import { showToast } from './ui/Toast';

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

// === 微信内首次访问 → 触发授权 ===
// 在微信内第一次打开页面时，自动跳转到微信授权页（snsapi_base 静默授权），
// 授权完回到 /api/wx/callback → 后台分配 8 位编号 → 重定向回首页 ?code=xxx
//
// 跳过条件（任一满足即不再触发）：
//   - 不在微信内（普通浏览器）
//   - 已存在身份 cookie（document.cookie 中含 maze_uid，意味着此设备已绑定）
//   - URL 已带 wx=ok / wx=fail 参数（说明刚回调过，避免循环）
//   - localStorage 里有 wx_skip 标记（用户主动选择"暂不授权"）
const params = new URLSearchParams(location.search);
const justReturned = params.get('wx') === 'ok' || params.get('wx') === 'fail';
const hasUidCookie = document.cookie.includes('maze_uid=');
const skipWxAuth = (() => {
  try {
    return localStorage.getItem('wx_skip_auth') === '1';
  } catch {
    return false;
  }
})();

if (
  isInWeChat() &&
  !hasUidCookie &&
  !justReturned &&
  !skipWxAuth
) {
  // 异步获取授权 URL 后再跳转，避免阻塞渲染
  void fetchAuthUrl().then((url) => {
    if (url) {
      // 用 location.replace 不留下历史栈记录
      location.replace(url);
    }
  });
}

// 处理回调返回的 ?wx=ok&code=xxx：提示用户编号，并清理 URL
if (justReturned) {
  const wxStatus = params.get('wx');
  if (wxStatus === 'ok') {
    const code = params.get('code') || '';
    if (code) {
      // 延迟到 Game 启动完后再展示，避免与启动动画重叠
      setTimeout(() => {
        // 用全局 toast 取代原本的 alert（阻塞 + 丑），并把停留时间拉长到 5 秒
        // 让用户来得及看清编号；与 Hud 内部 toast 互不干扰
        showToast(
          `同步成功！你的进度编号：${code}\n请截图保存，在其他设备输入即可恢复进度`,
          'success',
          5000
        );
      }, 800);
    }
  }
  // 清理 URL，避免分享时泄露 code
  history.replaceState(null, '', location.pathname + location.hash);
}

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




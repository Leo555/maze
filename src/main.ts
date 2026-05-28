/**
 * 应用入口
 *
 * 启动顺序：
 *   1. 解析 URL（?recover= / ?wx=）：扫码恢复链接需要在 Game 初始化前完成 adopt，
 *      否则主菜单会先渲染本地老进度再跳变到云端进度
 *   2. 等待 Storage bootstrap（拉云端最新进度），最多 1.5s 超时兜底
 *   3. new Game()：基于已经被刷新的本地 storage 渲染主菜单
 *   4. 浏览器空闲时再注入 Vercel Analytics（非关键，不阻塞首屏）
 */

import './styles.css';
import { Game } from './core/Game';
import { isInWeChat, isStandalone } from './core/Environment';
import { maybeShowAddToHomeScreen } from './ui/AddToHomeScreen';
import { adoptAccount } from './core/CloudSync';
import { storage } from './core/Storage';
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

// === 入口：先把"账号 + 云端进度"拿到位，再启动 Game ===
//
// 关键体验问题：如果直接 new Game()，主菜单会先按 localStorage 中的本地进度渲染，
// 等 Storage 异步拉到云端最新进度后再跳变。这一闪一变非常糟糕，
// 尤其是用户在另一台设备刚通了几关、回到本机时编号/已通关数等都会经历视觉跳变。
//
// 因此入口改为异步：
//   1. 处理 ?recover= 扫码 adopt（拿到目标账号的 token cookie + 进度）
//   2. 等待 storage.bootstrapPromise（拉自身 cookie 对应的云端进度）
//   3. 给个 1.5s 超时：网络慢/挂时不卡用户，先用本地启动；
//      云端晚到的进度会通过 storage.onChange 让 UI 自然刷新
//   4. new Game()
const params = new URLSearchParams(location.search);
const wxStatus = params.get('wx');
const justReturned = wxStatus === 'ok' || wxStatus === 'fail';
const recoverCode = params.get('recover');

/** 给 Promise 加超时兜底；超时不抛错只 resolve，让启动继续 */
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
  // === 1. 扫码 / 链接恢复：?recover=xxxxxxxx ===
  // 必须在 Game 初始化前完成，否则主菜单会先渲染本机原账号进度再跳变到目标账号进度
  if (recoverCode && /^\d{8}$/.test(recoverCode)) {
    // 立刻清掉 URL 参数，避免用户截图分享时把编号泄露
    // （编号本身只能读不能写，泄露危险性低，但仍是用户隐私）
    const cleanUrl = location.pathname + location.hash;
    history.replaceState(null, '', cleanUrl);

    // adopt 设置带短超时（1.2s）：失败/慢网络下不阻塞启动，由 toast 反馈
    const me = await withTimeout(adoptAccount(recoverCode), 1200);
    if (me) {
      storage.adoptRemoteAccount(me.code, me.progress);
      // 启动后再 toast，避免被 Game 的入场动效压住
      setTimeout(() => {
        showToast(`已切换到编号 ${me.code} 的进度`, 'success', 2800);
      }, 600);
    } else {
      setTimeout(() => {
        showToast('编号不存在或操作过于频繁', 'error', 2400);
      }, 600);
    }
  }

  // === 2. 等云端进度 bootstrap 完成（已带本机 cookie 的拉取）===
  // 1.5s 兜底：网络慢/挂时不卡用户，云端晚到时通过 storage.onChange 让 UI 自然刷新
  await withTimeout(storage.bootstrapPromise, 1500);

  // === 3. 启动 Game ===
  new Game();

  // 第 2 次以上访问的 iOS Safari 用户，提示「添加到主屏」
  // 加到主屏后 localStorage 不再受 ITP 7 天清理影响，进度持久化大幅提升
  maybeShowAddToHomeScreen();

  // === 4. 微信回调 ?wx=ok&code=xxx：toast 提示编号 ===
  if (justReturned) {
    if (wxStatus === 'ok') {
      const code = params.get('code') || '';
      if (code) {
        setTimeout(() => {
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
}

void bootstrap();

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




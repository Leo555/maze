/**
 * 云端进度同步模块。
 *
 * 职责：
 *   - 启动时调用 /api/me 拉取云端进度（如果 cookie 有效）
 *   - 必要时（首次通关）触发 /api/account/init 创建匿名账号
 *   - 用户输入编号或扫码后调用 /api/sync 拉取
 *   - 通关后调用 /api/save 上行（防抖 1.5s）
 *
 * 设计原则：
 *   - 所有云调用 fire-and-forget：失败不影响游戏体验
 *   - 上行采用 last-write-wins：服务端直接覆盖云端进度
 *   - 与 Storage 解耦：CloudSync 只暴露 fetchMine / pullByCode / adoptAccount / push / init
 *     合并/覆盖逻辑由 Storage 调用方决定
 */

import type { SaveData, MeResponse } from '../../shared/types';

interface SyncResponse {
  progress: SaveData;
}

interface SaveResponse {
  code: string;
  progress: SaveData;
}


/**
 * 拉取自己的账号信息（基于 HttpOnly cookie）。
 * 401 表示「我没有 token cookie」，返回 null，不视为错误。
 */
export async function fetchMine(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (res.status === 200) return (await res.json()) as MeResponse;
    return null;
  } catch {
    return null;
  }
}

/**
 * 创建匿名账号：服务端生成 token cookie + 8 位 code，并把当前本地进度作为初始值。
 * 用于浏览器/微信首次需要写云端时（一般是第一次通关时调用）。
 */
export async function initAccount(
  initialProgress: SaveData
): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/account/init', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: initialProgress }),
      cache: 'no-store',
    });
    if (res.status === 200) return (await res.json()) as MeResponse;
    return null;
  } catch {
    return null;
  }
}

/** 用 8 位编号拉取他人/旧设备的进度（只读，不会影响 cookie） */
export async function pullByCode(code: string): Promise<SaveData | null> {
  if (!/^\d{8}$/.test(code)) return null;
  try {
    const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (res.status === 200) {
      const data = (await res.json()) as SyncResponse;
      return data.progress;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 把 8 位编号对应的账号"领取"到本机：
 *   - 后端轮换该账号 token，旧设备立即失去写权限
 *   - 新 token 通过 Set-Cookie 写到本机
 *   - 之后本机用 cookie 写云端就是写到这个账号上
 *
 * 与 pullByCode 的区别：
 *   - pullByCode = 只读，不影响账号归属
 *   - adoptAccount = 切换账号归属到本机
 */
export async function adoptAccount(code: string): Promise<MeResponse | null> {
  if (!/^\d{8}$/.test(code)) return null;
  try {
    const res = await fetch('/api/account/adopt', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      cache: 'no-store',
    });
    if (res.status === 200) return (await res.json()) as MeResponse;
    return null;
  } catch {
    return null;
  }
}

/**
 * 推送本地进度到云端（需要 cookie）。
 *
 * 防抖策略：通关密集时合并为一次写；同时确保页面被关闭/切到后台前
 * 一定能把最新进度送出去（微信内退出 webview 是常见场景）。
 *
 * 关键：
 *   1. 800ms 短防抖 → 用户停手后很快推送，降低关页时机的窗口
 *   2. visibilitychange / pagehide → 立即用 sendBeacon 同步发出 pending 数据
 *      （fetch 在 unload 阶段不可靠；sendBeacon 是浏览器 API 中唯一保证关页前可发出的）
 */
const PUSH_DEBOUNCE_MS = 800;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProgress: SaveData | null = null;

export function pushDebounced(progress: SaveData): void {
  pendingProgress = progress;
  if (pushTimer) {
    // 已有待发送的定时器：保留窗口期，在用户连续通关时合并为一次写
    return;
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const data = pendingProgress;
    pendingProgress = null;
    if (!data) return;
    void pushImmediate(data);
  }, PUSH_DEBOUNCE_MS);
}

/**
 * 同步把 pending 进度送出（页面隐藏/卸载时调用）。
 *
 * 使用 navigator.sendBeacon：
 *   - 浏览器允许在 unload / visibilitychange→hidden 阶段发出
 *   - 不会被 fetch 那种 "page is being unloaded" 中断
 *   - 不接受响应（不需要也不关心）
 *
 * 由于 sendBeacon 不带 `credentials: include` 选项，但**同源**请求会自动带 cookie，
 * 我们站点是同源访问 /api/save，cookie 会随请求发送，鉴权依然有效。
 */
function flushPendingSync(): void {
  if (!pendingProgress) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const data = pendingProgress;
  pendingProgress = null;

  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const blob = new Blob([JSON.stringify({ progress: data })], {
        type: 'application/json',
      });
      const ok = navigator.sendBeacon('/api/save', blob);
      if (ok) return;
    }
    // sendBeacon 不可用或失败 → fire-and-forget fetch（带 keepalive 提升 unload 时存活率）
    void fetch('/api/save', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: data }),
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {
      /* fire-and-forget */
    });
  } catch {
    /* 任何异常都不能影响关页流程 */
  }
}

/**
 * 安装页面卸载/隐藏时的强制 flush。
 * 模块加载时调一次即可（main.ts 不需要额外接入）。
 */
function installFlushHooks(): void {
  if (typeof window === 'undefined') return;
  // visibilitychange→hidden：iOS Safari/微信切后台/锁屏前最可靠的"页面要不见了"信号
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingSync();
    }
  });
  // pagehide：bfcache 友好的 unload 替代，桌面/移动通用
  window.addEventListener('pagehide', flushPendingSync);
  // beforeunload 兜底（微信 X5 上行为不一致，多挂一道）
  window.addEventListener('beforeunload', flushPendingSync);
}

installFlushHooks();

/** 立即上行（不防抖）；返回服务端最终的进度（可能更进度） */
export async function pushImmediate(
  progress: SaveData
): Promise<SaveData | null> {
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress }),
      cache: 'no-store',
    });
    if (res.status === 200) {
      const data = (await res.json()) as SaveResponse;
      return data.progress;
    }
    return null;
  } catch {
    return null;
  }
}

/** 聚合命名空间，方便 Storage 用 cloud.fetchMine() 形式调用 */
export const cloud = {
  fetchMine,
  initAccount,
  pullByCode,
  adoptAccount,
  pushDebounced,
  pushImmediate,
};

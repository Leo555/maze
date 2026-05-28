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
 *   - 上行用最新进度（pickRicher 在服务端再做一次仲裁）
 *   - 与 Storage 解耦：CloudSync 只暴露 fetchMine / pullByCode / push / init
 *     合并逻辑由 Storage 调用方决定
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
 * 使用模块级变量做 1.5s 防抖：通关密集时合并为一次写。
 */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProgress: SaveData | null = null;

export function pushDebounced(progress: SaveData): void {
  pendingProgress = progress;
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!pendingProgress) return;
    void pushImmediate(pendingProgress);
    pendingProgress = null;
  }, 1500);
}

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

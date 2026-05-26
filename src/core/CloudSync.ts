/**
 * 云端进度同步模块。
 *
 * 职责：
 *   - 启动时调用 /api/me 拉取云端进度（如果 cookie 有效）
 *   - 用户输入编号后调用 /api/sync 拉取
 *   - 通关后调用 /api/save 上行（防抖 1.5s，避免短时间多次写）
 *   - 微信内首次打开时触发授权跳转
 *
 * 设计原则：
 *   - 所有云调用 fire-and-forget：失败不影响游戏体验
 *   - 上行用最新进度（pick richer 在服务端再做一次仲裁）
 *   - 与 Storage 解耦：CloudSync 只暴露 fetchMine / pullByCode / push
 *     合并逻辑由 Storage 调用方决定
 */

import type { SaveData } from './Storage';

interface MeResponse {
  code: string;
  progress: SaveData;
}

interface SyncResponse {
  progress: SaveData;
}

interface SaveResponse {
  code: string;
  progress: SaveData;
}

interface AuthUrlResponse {
  url: string | null;
}

/**
 * 拉取自己的云端进度（基于 HttpOnly cookie）。
 * 401/404 都表示「我不是已登录用户」，返回 null，不视为错误。
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
export async function pushImmediate(progress: SaveData): Promise<SaveData | null> {
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

/** 取微信授权跳转 URL */
export async function fetchAuthUrl(): Promise<string | null> {
  try {
    const res = await fetch('/api/wx/auth-url', { cache: 'no-store' });
    if (res.status === 200) {
      const data = (await res.json()) as AuthUrlResponse;
      return data.url;
    }
    return null;
  } catch {
    return null;
  }
}

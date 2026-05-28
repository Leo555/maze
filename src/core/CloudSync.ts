/**
 * 云端进度同步（极简版）
 *
 * 三个接口：
 *   - pullByCode：用 8 位 code 拉取进度
 *   - pushProgress：用 8 位 code 写进度
 *
 * 失败 fire-and-forget，不影响游戏体验。
 */

import type { SaveData } from '../../shared/types';

interface SyncResponse {
  progress: SaveData;
}

interface SaveResponse {
  progress: SaveData;
}

/** 用 8 位 code 拉取进度 */
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

/** 用 8 位 code 上行进度 */
export async function pushProgress(
  code: string,
  progress: SaveData
): Promise<SaveData | null> {
  if (!/^\d{8}$/.test(code)) return null;
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, progress }),
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

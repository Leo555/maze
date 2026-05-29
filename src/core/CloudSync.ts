/**
 * 云端进度同步（极简版）
 *
 * 接口：
 *   - pullByCode      用 8 位 code 拉取进度
 *   - pushProgress    用 8 位 code 写进度
 *   - pushNick        设置 / 更新昵称
 *   - fetchLeaderboard 拉排行榜
 *
 * 失败 fire-and-forget，不影响游戏体验。
 */

import type { SaveData, OverallRankItem, LevelRankItem } from '../../shared/types';
import { isValidCode, isValidNick } from '../../shared/types';

interface SyncResponse {
  progress: SaveData;
}

interface SaveResponse {
  progress: SaveData;
}

interface NickResponse {
  nick: string;
}

interface OverallLbResponse {
  type: 'overall';
  items: OverallRankItem[];
}

interface LevelLbResponse {
  type: 'level';
  levelId: number;
  items: LevelRankItem[];
}

/** 用 8 位 code 拉取进度 */
export async function pullByCode(code: string): Promise<SaveData | null> {
  if (!isValidCode(code)) return null;
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

/** push 接口可能返回的错误码（与后端 ratelimit.ts WriteRateError 对齐） */
export type PushError =
  | 'too_fast'
  | 'too_many_requests'
  | 'ip_abuse'
  | 'concurrent_play'
  | 'unlock_delta_too_large'
  | 'forbidden'
  | 'bad_code'
  | 'bad_progress'
  | 'network';

export interface PushResult {
  ok: boolean;
  /** 失败时的错误码，便于前端文案路由 */
  error?: PushError;
  /** 后端建议的重试间隔（秒），仅 too_fast 时返回 */
  retryAfterSec?: number;
  /** 写入成功后云端最终值 */
  progress?: SaveData;
}

/** 用 8 位 code 上行进度 */
export async function pushProgress(
  code: string,
  progress: SaveData
): Promise<PushResult> {
  if (!isValidCode(code)) return { ok: false, error: 'bad_code' };
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, progress }),
      cache: 'no-store',
    });
    if (res.status === 200) {
      const data = (await res.json()) as SaveResponse;
      return { ok: true, progress: data.progress };
    }
    // 解析后端 error 字段以路由前端文案
    let err: PushError = 'network';
    let retryAfterSec: number | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        retryAfterSec?: number;
      };
      if (body.error) err = body.error as PushError;
      if (typeof body.retryAfterSec === 'number') retryAfterSec = body.retryAfterSec;
    } catch {
      /* 非 JSON 响应 */
    }
    return { ok: false, error: err, retryAfterSec };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** 设置 / 更新昵称（成功返回 true） */
export async function pushNick(code: string, nick: string): Promise<boolean> {
  if (!isValidCode(code) || !isValidNick(nick)) return false;
  try {
    const res = await fetch('/api/nick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, nick }),
      cache: 'no-store',
    });
    if (res.status !== 200) return false;
    const data = (await res.json()) as NickResponse;
    return data.nick === nick;
  } catch {
    return false;
  }
}

/** 拉综合榜 top N */
export async function fetchOverallTop(
  limit = 50
): Promise<OverallRankItem[]> {
  try {
    const res = await fetch(
      `/api/leaderboard?type=overall&limit=${encodeURIComponent(String(limit))}`,
      { cache: 'no-store' }
    );
    if (res.status !== 200) return [];
    const data = (await res.json()) as OverallLbResponse;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** 拉单关速通榜 top N */
export async function fetchLevelTop(
  levelId: number,
  limit = 50
): Promise<LevelRankItem[]> {
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 100) return [];
  try {
    const res = await fetch(
      `/api/leaderboard?type=level&id=${levelId}&limit=${encodeURIComponent(String(limit))}`,
      { cache: 'no-store' }
    );
    if (res.status !== 200) return [];
    const data = (await res.json()) as LevelLbResponse;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

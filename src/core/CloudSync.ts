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
  /**
   * 云端进度。可能为 null，表示"该 code 在云端没有存档"
   * （新 code / 过期清理 / 刚切换的空白 code）。
   * 后端从 2026-09 起对"查不到"统一返回 200 + progress:null，
   * 而不是 404，避免 DevTools / 监控 SDK 把"空结果"当异常。
   */
  progress: SaveData | null;
  /** 云端昵称；可能为 null（玩家从未设置过）。后端字段缺失时统一回退为 null。 */
  nick?: string | null;
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

/**
 * 用 8 位 code 拉取进度 + 昵称。
 *
 * 返回值（对调用方的契约保持不变）：
 *   - 云端存在该 code → { progress, nick }；nick 未设置时为 null
 *   - 云端不存在 / 网络异常 / 限流 / 参数错 → null
 *
 * 后端响应约定（2026-09 调整）：
 *   - 200 + { progress: SaveData, nick } → 云端有存档
 *   - 200 + { progress: null, nick: null } → 云端无该 code 的存档（新 code / 已清理）
 *   - 4xx / 5xx / 网络异常 → 视为拉取失败
 *
 * 这里把"200 + progress:null"和"非 200"都收敛为对调用方的 null，
 * 让 adoptCode / pullFromCloud 只需判断 `remote == null` 即可，
 * 无需感知底层的 HTTP 状态码。
 *
 * 兼容历史响应：
 *   早期 /api/sync 仅返回 { progress }，未来若灰度发布也只用 progress 字段；
 *   此处通过 `data.nick ?? null` 收敛缺失为 null，调用方无需关心。
 */
export async function pullByCode(
  code: string
): Promise<{ progress: SaveData; nick: string | null } | null> {
  if (!isValidCode(code)) return null;
  try {
    const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (res.status === 200) {
      const data = (await res.json()) as SyncResponse;
      // 后端返回 200 + progress:null 表示"云端没这个 code 的存档"，
      // 对上层等价于"拉取无结果"，统一返回 null 让调用方走本地存档流程
      if (data.progress == null) return null;
      return {
        progress: data.progress,
        // 防御：后端理论上保证返回 string|null，但同时验证 isValidNick
        // 避免 KV 历史脏数据（如空串、超长值）污染前端 UI
        nick:
          typeof data.nick === 'string' && isValidNick(data.nick) ? data.nick : null,
      };
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

/** 昵称设置失败的错误码（与后端 /api/nick 返回的 error 字段对齐） */
export type NickError =
  | 'bad_code'
  | 'bad_nick'
  | 'too_many_requests' // 5 分钟限流
  | 'nick_too_frequent' // 7 天改名冷却
  | 'forbidden'
  | 'network';

export interface NickResult {
  ok: boolean;
  /** 失败时的错误码 */
  error?: NickError;
  /** 7 天冷却剩余秒数（仅 nick_too_frequent 时返回） */
  retryAfterSec?: number;
}

/**
 * 设置 / 更新昵称。
 *
 * 与之前 boolean 返回的 pushNick 区别：现在能区分多种失败原因，
 * 让 UI 给出精准提示（特别是 nick_too_frequent 需要展示剩余冷却时间）。
 */
export async function pushNick(code: string, nick: string): Promise<NickResult> {
  if (!isValidCode(code)) return { ok: false, error: 'bad_code' };
  if (!isValidNick(nick)) return { ok: false, error: 'bad_nick' };
  try {
    const res = await fetch('/api/nick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, nick }),
      cache: 'no-store',
    });
    if (res.status === 200) {
      const data = (await res.json()) as NickResponse;
      if (data.nick === nick) return { ok: true };
      return { ok: false, error: 'network' };
    }
    let err: NickError = 'network';
    let retryAfterSec: number | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        retryAfterSec?: number;
      };
      if (body.error) err = body.error as NickError;
      if (typeof body.retryAfterSec === 'number') retryAfterSec = body.retryAfterSec;
    } catch {
      /* 非 JSON 响应 */
    }
    return { ok: false, error: err, retryAfterSec };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * 拉综合榜 top N。
 *
 * @param limit  返回条目数（默认 50）
 * @param myCode 可选；玩家自己的 code，用于让后端在响应中标记 isMe。
 *               传与不传都安全：后端只用它做相等比对，不会回包给前端。
 */
export async function fetchOverallTop(
  limit = 50,
  myCode?: string
): Promise<OverallRankItem[]> {
  try {
    const params = new URLSearchParams({
      type: 'overall',
      limit: String(limit),
    });
    if (myCode && isValidCode(myCode)) params.set('me', myCode);
    const res = await fetch(`/api/leaderboard?${params.toString()}`, {
      cache: 'no-store',
    });
    if (res.status !== 200) return [];
    const data = (await res.json()) as OverallLbResponse;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** 拉单关速通榜 top N（同样支持 myCode 标记 isMe） */
export async function fetchLevelTop(
  levelId: number,
  limit = 50,
  myCode?: string
): Promise<LevelRankItem[]> {
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 100) return [];
  try {
    const params = new URLSearchParams({
      type: 'level',
      id: String(levelId),
      limit: String(limit),
    });
    if (myCode && isValidCode(myCode)) params.set('me', myCode);
    const res = await fetch(`/api/leaderboard?${params.toString()}`, {
      cache: 'no-store',
    });
    if (res.status !== 200) return [];
    const data = (await res.json()) as LevelLbResponse;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

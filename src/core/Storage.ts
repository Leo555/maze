/**
 * 本地存档：通关记录、最佳成绩、解锁状态
 *
 * 三层持久化（应对 iOS Safari ITP 清理 + 跨设备同步）：
 *   1. localStorage（主存储，优先读写）
 *   2. cookie（备份存储，max-age=400 天）
 *   3. 云端（Vercel KV，通过微信授权 / 8 位编号关联）
 *
 * 写入：本地双写 + 云端防抖上行（带 cookie 时才上行）
 * 读取：启动时本地双读取较优 + 云端追拉（仅当 cookie 已绑定）
 *
 * 数据较小（100 关 record + 1 unlocked 字段，预计 < 4KB），cookie 完全装得下。
 */

import * as cloud from './CloudSync';

export interface LevelRecord {
  bestTime: number; // 最快用时（秒）
  bestStars: number; // 最高星级
  cleared: boolean;
}

/** 存档数据结构 */
export interface SaveData {
  /** 数据格式版本，便于将来无痛迁移 */
  v: number;
  records: Record<number, LevelRecord>;
  unlocked: number; // 已解锁到第几关
}

const KEY = 'maze_save';
const COOKIE_KEY = 'maze_save';
const SAVE_VERSION = 1;
/** cookie 有效期：400 天（Chrome 上 cookie max-age 的硬上限是 400 天） */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const defaultSave: SaveData = {
  v: SAVE_VERSION,
  records: {},
  unlocked: 1,
};

/** 读 cookie 中的指定 key */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const c of cookies) {
    const trimmed = c.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** cookie 单条最大字节数（保守值；多数浏览器限 4096） */
const COOKIE_MAX_BYTES = 3800;

/** 写 cookie；Path=/ + SameSite=Lax + Secure（仅 https）让现代浏览器接受 */
function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  try {
    const isSecure = location.protocol === 'https:';
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
      'Path=/',
      'SameSite=Lax',
    ];
    if (isSecure) parts.push('Secure');
    document.cookie = parts.join('; ');
  } catch {
    /* 写 cookie 在某些隐私模式下会抛错，静默忽略 */
  }
}

/**
 * 把存档压缩到 cookie 安全大小内。
 * 100 关全通关时 records 接近 cookie 4KB 上限，
 * 超出时按 levelId 降序保留，unlocked 字段始终保留。
 */
function compactForCookie(save: SaveData): string {
  const full = JSON.stringify(save);
  if (encodeURIComponent(full).length <= COOKIE_MAX_BYTES) return full;

  const ids = Object.keys(save.records)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  const slim: SaveData = { v: save.v, records: {}, unlocked: save.unlocked };
  for (const id of ids) {
    slim.records[id] = save.records[id];
    if (encodeURIComponent(JSON.stringify(slim)).length > COOKIE_MAX_BYTES) {
      delete slim.records[id];
      break;
    }
  }
  return JSON.stringify(slim);
}

/** 把任意来源解析出的对象规范化为 SaveData（含字段兜底，向后兼容旧版本数据） */
export function normalizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<SaveData>;
  return {
    v: SAVE_VERSION,
    records:
      obj.records && typeof obj.records === 'object'
        ? (obj.records as Record<number, LevelRecord>)
        : {},
    unlocked:
      typeof obj.unlocked === 'number' && obj.unlocked >= 1
        ? Math.floor(obj.unlocked)
        : 1,
  };
}

/** 比较两份存档，返回"更进度"的那份（unlocked 大优先；相同则记录数多优先） */
export function pickRicher(a: SaveData, b: SaveData): SaveData {
  if (a.unlocked !== b.unlocked) return a.unlocked > b.unlocked ? a : b;
  const ar = Object.keys(a.records).length;
  const br = Object.keys(b.records).length;
  return ar >= br ? a : b;
}

export class Storage {
  private data: SaveData;
  /** 用户的 8 位同步编号（从云端拉到后填入；空表示尚未关联微信） */
  private cloudCode = '';
  /** 监听器：进度变更时调用（用于 UI 自动刷新） */
  private listeners = new Set<() => void>();

  constructor() {
    this.data = this.load();
    // 启动时同步两边：哪边缺就用另一边补回来（应对 ITP 单边清理）
    this.flushLocal();
    // 启动时异步拉云端进度（如果 cookie 已绑定），完成后合并并通知监听器
    void this.bootstrapCloud();
  }

  /** 启动时拉云端：cookie 有效时取「云端 vs 本地」更进度的一份 */
  private async bootstrapCloud(): Promise<void> {
    const me = await cloud.fetchMine();
    if (!me) return;
    this.cloudCode = me.code;
    const remote = normalizeSave(me.progress);
    if (remote) {
      const merged = pickRicher(this.data, remote);
      const changed =
        merged !== this.data ||
        JSON.stringify(merged) !== JSON.stringify(this.data);
      if (changed) {
        this.data = merged;
        this.flushLocal();
        this.notifyChange();
        // 反向：如果合并后比云端进度多，再回推一次（保持云本地一致）
        if (pickRicher(merged, remote) !== remote) {
          cloud.pushDebounced(this.data);
        }
      }
    }
    this.notifyChange();
  }

  /**
   * 加载策略：
   *   - 同时读 localStorage 与 cookie
   *   - 若两者都有：取"更有进度"的一份（避免老 cookie 把新进度覆盖）
   *   - 若只有一边：用那一边
   *   - 都没有：默认存档
   */
  private load(): SaveData {
    let fromLs: SaveData | null = null;
    let fromCookie: SaveData | null = null;

    try {
      const raw = localStorage.getItem(KEY);
      if (raw) fromLs = normalizeSave(JSON.parse(raw));
    } catch {
      /* localStorage 在某些场景下会抛 SecurityError，静默忽略 */
    }

    try {
      const raw = readCookie(COOKIE_KEY);
      if (raw) fromCookie = normalizeSave(JSON.parse(raw));
    } catch {
      /* cookie 解析失败也静默 */
    }

    if (fromLs && fromCookie) return pickRicher(fromLs, fromCookie);
    if (fromLs) return fromLs;
    if (fromCookie) return fromCookie;
    return { ...defaultSave };
  }

  /** 仅写本地（localStorage + cookie），不触发云端上行 */
  private flushLocal(): void {
    const json = JSON.stringify(this.data);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* localStorage 满 / 隐私模式禁用 */
    }
    writeCookie(COOKIE_KEY, compactForCookie(this.data));
  }

  /** 本地写完 + 云端防抖上行（如果已关联微信） */
  private flush(): void {
    this.flushLocal();
    if (this.cloudCode) cloud.pushDebounced(this.data);
  }

  isUnlocked(levelId: number): boolean {
    return levelId <= this.data.unlocked;
  }

  getRecord(levelId: number): LevelRecord | null {
    return this.data.records[levelId] ?? null;
  }

  /** 提交一次通关，返回是否刷新最佳 */
  submit(levelId: number, time: number, stars: number): boolean {
    const prev = this.data.records[levelId];
    let updated = false;
    if (!prev) {
      this.data.records[levelId] = { bestTime: time, bestStars: stars, cleared: true };
      updated = true;
    } else {
      const best = {
        bestTime: Math.min(prev.bestTime, time),
        bestStars: Math.max(prev.bestStars, stars),
        cleared: true,
      };
      if (best.bestTime !== prev.bestTime || best.bestStars !== prev.bestStars) {
        updated = true;
      }
      this.data.records[levelId] = best;
    }
    if (this.data.unlocked < levelId + 1) {
      this.data.unlocked = levelId + 1;
    }
    this.flush();
    this.notifyChange();
    return updated;
  }

  reset(): void {
    this.data = { ...defaultSave };
    this.flushLocal();
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
    if (this.cloudCode) cloud.pushDebounced(this.data);
    this.notifyChange();
  }

  /** 当前用户的 8 位编号（空字符串表示未关联微信） */
  getCloudCode(): string {
    return this.cloudCode;
  }

  /** 用一份外部存档（如 pullByCode 拿到的）合并进本地，取更进度 */
  mergeRemote(remote: SaveData): boolean {
    const merged = pickRicher(this.data, remote);
    const changed = JSON.stringify(merged) !== JSON.stringify(this.data);
    if (!changed) return false;
    this.data = merged;
    this.flush();
    this.notifyChange();
    return true;
  }

  /** 订阅数据变更（用于 UI 自动刷新） */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyChange(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        /* 监听器异常不影响其他订阅 */
      }
    }
  }
}

export const storage = new Storage();

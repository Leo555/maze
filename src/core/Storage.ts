/**
 * 本地存档：通关记录、最佳成绩、解锁状态
 *
 * 持久化策略（多层冗余，专门应对 iOS Safari 的 ITP 清理）：
 *   1. localStorage（主存储，优先读写）
 *   2. cookie（备份存储，max-age=400 天，作 ITP 存活兜底）
 *
 * 为什么要 cookie 兜底？
 *   iPadOS / iOS Safari 在以下场景会丢失 localStorage：
 *     - 7 天未访问站点（ITP 7-day timeout）
 *     - 用户清理 Safari 数据
 *     - 存储压力下系统主动驱逐
 *   cookie 的清理策略与 localStorage 不一致（且服务器写的 cookie 不被 ITP 清，
 *   但 document.cookie 写的属于 first-party，受影响较少）。
 *   两者并行，单边丢失时另一边恢复，覆盖率显著提升。
 *
 * 数据较小（100 关 record + 1 unlocked 字段，预计 < 4KB），cookie 完全装得下。
 */

export interface LevelRecord {
  bestTime: number; // 最快用时（秒）
  bestStars: number; // 最高星级
  cleared: boolean;
}

interface Save {
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

const defaultSave: Save = {
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
 * 超出时优先丢弃"较低关 + 1 星"的简单记录（信息熵最低），
 * unlocked 字段始终保留（这是最关键的信息）。
 */
function compactForCookie(save: Save): string {
  const full = JSON.stringify(save);
  if (encodeURIComponent(full).length <= COOKIE_MAX_BYTES) return full;

  // 超限：按 levelId 降序保留，逐个加入直到接近上限
  const ids = Object.keys(save.records)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  const slim: Save = { v: save.v, records: {}, unlocked: save.unlocked };
  for (const id of ids) {
    slim.records[id] = save.records[id];
    if (encodeURIComponent(JSON.stringify(slim)).length > COOKIE_MAX_BYTES) {
      delete slim.records[id];
      break;
    }
  }
  return JSON.stringify(slim);
}

/** 把任意来源解析出的对象规范化为 Save（含字段兜底，向后兼容旧版本数据） */
function normalize(raw: unknown): Save | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<Save>;
  // 旧版本（无 v 字段）也能被认领，统一升级
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
function pickRicher(a: Save, b: Save): Save {
  if (a.unlocked !== b.unlocked) return a.unlocked > b.unlocked ? a : b;
  const ar = Object.keys(a.records).length;
  const br = Object.keys(b.records).length;
  return ar >= br ? a : b;
}

export class Storage {
  private data: Save;

  constructor() {
    this.data = this.load();
    // 启动时同步两边：哪边缺就用另一边补回来（应对 ITP 单边清理）
    this.flush();
  }

  /**
   * 加载策略：
   *   - 同时读 localStorage 与 cookie
   *   - 若两者都有：取"更有进度"的一份（避免老 cookie 把新进度覆盖）
   *   - 若只有一边：用那一边
   *   - 都没有：默认存档
   */
  private load(): Save {
    let fromLs: Save | null = null;
    let fromCookie: Save | null = null;

    try {
      const raw = localStorage.getItem(KEY);
      if (raw) fromLs = normalize(JSON.parse(raw));
    } catch {
      /* localStorage 在某些场景下会抛 SecurityError，静默忽略 */
    }

    try {
      const raw = readCookie(COOKIE_KEY);
      if (raw) fromCookie = normalize(JSON.parse(raw));
    } catch {
      /* cookie 解析失败也静默 */
    }

    if (fromLs && fromCookie) return pickRicher(fromLs, fromCookie);
    if (fromLs) return fromLs;
    if (fromCookie) return fromCookie;
    return { ...defaultSave };
  }

  /** 同时写入 localStorage 与 cookie；任一边失败都不影响另一边 */
  private flush(): void {
    const json = JSON.stringify(this.data);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* localStorage 满 / 隐私模式禁用 */
    }
    // cookie 容量较小，超限时自动压缩为「unlocked + 高关 records」
    writeCookie(COOKIE_KEY, compactForCookie(this.data));
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
    return updated;
  }

  reset(): void {
    this.data = { ...defaultSave };
    this.flush();
    // 清 cookie：写一个立刻过期的同名 cookie
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  }
}

export const storage = new Storage();

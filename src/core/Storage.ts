/**
 * 本地存档：通关记录、最佳成绩、解锁状态
 *
 * 三层持久化（应对 iOS Safari ITP 清理 + 跨设备同步）：
 *   1. localStorage（主存储，优先读写）
 *   2. cookie（备份存储，max-age=400 天）
 *   3. 云端（Vercel KV，通过匿名账号 token + 8 位编号）
 *
 * 写入：本地双写 + 云端防抖上行（带账号 cookie 时上行）
 * 读取：启动时本地双读取较优 + 云端追拉（仅当账号 cookie 已存在）
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
/**
 * "已关联编号"持久化 key（独立于 maze_save，单独存）。
 * 这个值是用户在任何端"知道"的同步编号——
 * 本机注册账号后会写入；输入编号恢复进度后也会写入。
 * 与 cloudCode 不同：cloudCode 仅在带有合法 maze_auth cookie 时才有意义（能写云端）。
 */
const LINKED_CODE_KEY = 'maze_linked_code';
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
  /**
   * 用户的 8 位同步编号 - "可写"模式。
   * 仅当带有合法 maze_auth cookie（已创建本机账号）时才有值，
   * 此时通关会触发云端上行（push）。
   * 普通浏览器输入编号恢复进度时此值仍为空——因为只读恢复不会获得写权限。
   */
  private cloudCode = '';
  /**
   * 用户已知的 8 位同步编号 - "可见"模式。
   * 比 cloudCode 范围更大：
   *   - 本机创建账号后 → 同时写 cloudCode + linkedCode
   *   - 输入编号恢复进度 → 仅写 linkedCode（不写 cloudCode）
   * 用于 UI 在"任何端"都能展示用户的编号方便复制/再分享。
   * 持久化到 localStorage，关闭浏览器再打开仍可见。
   */
  private linkedCode = '';
  /** 监听器：进度变更时调用（用于 UI 自动刷新） */
  private listeners = new Set<() => void>();

  constructor() {
    this.data = this.load();
    this.linkedCode = this.loadLinkedCode();
    // 启动时同步两边：哪边缺就用另一边补回来（应对 ITP 单边清理）
    this.flushLocal();
    // 启动时异步拉云端进度（如果 cookie 已绑定），完成后合并并通知监听器
    void this.bootstrapCloud();
  }

  private loadLinkedCode(): string {
    try {
      return localStorage.getItem(LINKED_CODE_KEY) || '';
    } catch {
      return '';
    }
  }

  private saveLinkedCode(code: string): void {
    try {
      if (code) localStorage.setItem(LINKED_CODE_KEY, code);
      else localStorage.removeItem(LINKED_CODE_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * 启动时拉云端：云端是权威，直接用云端覆盖本地。
   *
   * 设计：last-write-wins 多设备共享语义
   *   - 云端代表用户最后一次通关后的真实进度
   *   - 本机本地存档可能是旧的（用户在另一台设备上又玩过），启动时应当被刷新
   *   - 不再做 pickRicher：避免本机老旧/缓存的 localStorage 把云端最新的覆盖回来
   *
   * 例外：
   *   - 如果本机本地进度严格"更进度"（玩家在离线时通关了几关），
   *     这里也会被云端版本覆盖。这是 last-write-wins 设计的必要代价。
   *     真正会丢失的极少：因为通关时已经触发过 pushDebounced，
   *     上一次离线通关一旦联网就会推上去。
   */
  private async bootstrapCloud(): Promise<void> {
    const me = await cloud.fetchMine();
    if (!me) return;
    this.cloudCode = me.code;
    // linkedCode 兜底：本机首次启动时用云端 code 填上，已经有值则保留用户视角
    if (!this.linkedCode) {
      this.linkedCode = me.code;
      this.saveLinkedCode(me.code);
    }
    const remote = normalizeSave(me.progress);
    if (remote) {
      const same = JSON.stringify(remote) === JSON.stringify(this.data);
      if (!same) {
        this.data = remote;
        this.flushLocal();
        this.notifyChange();
      }
    }
    this.notifyChange();
  }

  /**
   * 首次通关时调用：如果尚未有 cloudCode，则向后端调 init 创建匿名账号。
   * 仅在浏览器/微信内通关时被触发，避免没玩过游戏的过路用户也建账号污染 KV。
   *
   * 用 inflight Promise 防止 reentry：同一时间只发一次 init 请求。
   */
  private initInflight: Promise<void> | null = null;
  private async ensureCloudAccount(): Promise<void> {
    if (this.cloudCode || this.initInflight) return;
    this.initInflight = (async () => {
      try {
        const me = await cloud.initAccount(this.data);
        if (me) {
          this.cloudCode = me.code;
          if (this.linkedCode !== me.code) {
            this.linkedCode = me.code;
            this.saveLinkedCode(me.code);
          }
          this.notifyChange();
        }
      } finally {
        this.initInflight = null;
      }
    })();
    await this.initInflight;
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

  /** 本地写完 + 云端防抖上行（如果已注册账号） */
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
    // 首次通关后异步建账号（不阻塞通关结算 UI）。
    // 已有 cloudCode 时此调用是 no-op；首次会触发 init，
    // init 完成后 cloudCode 写入 → 后续 flush 自然会带云端上行。
    void this.ensureCloudAccount();
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

  /**
   * 当前用户的 8 位编号（仅当 cookie 已绑定，可写云端）。
   * 若仅 PC 输入编号恢复，此处仍是空——区别于 getLinkedCode()。
   */
  getCloudCode(): string {
    return this.cloudCode;
  }

  /**
   * 用户已知的 8 位编号（含 PC 端输入恢复后保存的）。
   * UI 凡是只想"展示编号给用户看/复制"的场景，都应该用这个。
   */
  getLinkedCode(): string {
    return this.linkedCode;
  }

  /**
   * 用一份外部存档（如 pullByCode 拿到的）合并进本地，取更进度。
   * @param code 可选；若提供则同时持久化到 linkedCode（PC 端输入恢复后调用）
   */
  mergeRemote(remote: SaveData, code?: string): boolean {
    const merged = pickRicher(this.data, remote);
    const changed = JSON.stringify(merged) !== JSON.stringify(this.data);
    if (changed) {
      this.data = merged;
      this.flush();
    }
    let codeChanged = false;
    if (code && /^\d{8}$/.test(code) && code !== this.linkedCode) {
      this.linkedCode = code;
      this.saveLinkedCode(code);
      codeChanged = true;
    }
    if (changed || codeChanged) this.notifyChange();
    return changed;
  }

  /**
   * 把指定编号对应的云端账号"领取"到本机（已通过 /api/account/adopt 完成 token 轮换）。
   *
   * 与 mergeRemote 的关键区别：
   *   - mergeRemote：只读拉别人的进度，仅合并；本机仍是自己的账号
   *   - adoptRemoteAccount：本机已经被切换为该账号，因此：
   *       1. 本地存档**直接替换**为云端版本（不再 pickRicher，
   *          否则用户期望的"恢复到二维码那个进度"可能被本机更进度的覆盖）
   *       2. cloudCode + linkedCode 都同步为新编号
   *       3. 后续 flush 会写到这个新账号的云端
   *
   * @param code 8 位编号（来自 adopt 响应）
   * @param remote 该账号的云端进度（来自 adopt 响应）
   */
  adoptRemoteAccount(code: string, remote: SaveData): void {
    this.data = remote;
    this.flushLocal();
    this.cloudCode = code;
    this.linkedCode = code;
    this.saveLinkedCode(code);
    this.notifyChange();
  }

  /** 解除编号关联（仅清理本地展示，不影响云端数据；登出时调用） */
  unlinkCode(): void {
    this.cloudCode = '';
    this.linkedCode = '';
    this.saveLinkedCode('');
    this.notifyChange();
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

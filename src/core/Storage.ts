/**
 * 本地存档 + 云端同步
 *
 * 设计：
 *   - 每个浏览器首次访问生成一个随机 8 位 code，存 localStorage
 *   - 通关后立即把 (code, progress) 推到云端
 *   - 启动时用 code 拉云端进度，覆盖本地（last-write-wins，云端为权威）
 *   - 扫码 / 输入别人的 code → 直接替换本机 code → 后续读写都到那个 code
 *
 * 持久化：
 *   - localStorage（本地）
 *   - 云端（last-write-wins，跨设备的真正兜底）
 *
 * 历史上还写过 cookie 兜底 ITP 7 天清理；现在云端就是最强兜底，
 * cookie 反而每次请求白浪费上行带宽，已移除。
 */

import { pullByCode, pushProgress, pushNick } from './CloudSync';
import type { PushError } from './CloudSync';
import {
  type SaveData,
  type LevelRecord,
  normalizeSave,
  isValidCode,
  isValidNick,
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_SAVE,
} from '../../shared/types';

const KEY = 'maze_save';
const CODE_KEY = 'maze_code';
/** 昵称本地缓存 key（云端为权威，本地仅用于离线/瞬时显示） */
const NICK_KEY = 'maze_nick';
/** localStorage key：是否已经引导用户保存过同步入口（首次通关后展示一次） */
const BACKUP_PROMPTED_KEY = 'maze_backup_prompted';
const SAVE_VERSION = 1;

/**
 * 生成随机 8 位字母数字 code（字符集去掉易混淆字符）。
 *
 * 安全注意：
 *   - 用 crypto.getRandomValues 而非 Math.random，保证不可预测
 *   - 用拒绝采样（rejection sampling）去除模偏（modulo bias），
 *     确保每个字符出现概率严格相等
 */
function generateCode(): string {
  const alphaLen = CODE_ALPHABET.length;
  // 256 是 Uint8Array 单字节的取值范围；找到不大于 256 的 alphaLen 的最大整数倍
  // 超过这个上限的随机字节直接丢弃，从而避免模偏
  const cutoff = Math.floor(256 / alphaLen) * alphaLen;
  const out: string[] = [];
  const buf = new Uint8Array(CODE_LENGTH * 2); // 多取一些减少二次填充概率
  while (out.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < CODE_LENGTH; i++) {
      const b = buf[i];
      if (b < cutoff) out.push(CODE_ALPHABET[b % alphaLen]);
    }
  }
  return out.join('');
}

const defaultSave: SaveData = { ...DEFAULT_SAVE, v: SAVE_VERSION };

export class Storage {
  /** 8 位 code：用户身份兼写权限 */
  private code: string;
  private data: SaveData;
  /** 昵称（可选）；null 表示未设置 */
  private nick: string | null;
  private listeners = new Set<() => void>();
  /** 写云端失败时的全局回调（结算页 / 设置页 UI 订阅，统一展示安全提示） */
  private pushErrListeners = new Set<(err: PushError, retryAfterSec?: number) => void>();

  /** 启动时云端拉取完成的 Promise，main.ts 入口 await 它 */
  private bootstrapResolve: (() => void) | null = null;
  readonly bootstrapPromise: Promise<void>;

  constructor() {
    this.code = this.loadOrCreateCode();
    this.data = this.loadLocal();
    this.nick = this.loadLocalNick();
    this.bootstrapPromise = new Promise<void>((r) => (this.bootstrapResolve = r));
    void this.pullFromCloud();
  }

  /** 读 / 创建本机 code（不接受老格式 8 位纯数字，发现就重新生成） */
  private loadOrCreateCode(): string {
    try {
      const saved = localStorage.getItem(CODE_KEY);
      if (saved && isValidCode(saved)) return saved;
    } catch {
      /* ignore */
    }
    const fresh = generateCode();
    try {
      localStorage.setItem(CODE_KEY, fresh);
    } catch {
      /* ignore */
    }
    return fresh;
  }

  /** 读取本地存档 */
  private loadLocal(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = normalizeSave(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch {
      /* ignore */
    }
    return { ...defaultSave };
  }

  private flushLocal(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  /** 读取本地昵称缓存（云端拉到权威值之前的占位显示用） */
  private loadLocalNick(): string | null {
    try {
      const raw = localStorage.getItem(NICK_KEY);
      return raw && isValidNick(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  private flushLocalNick(): void {
    try {
      if (this.nick === null) {
        localStorage.removeItem(NICK_KEY);
      } else {
        localStorage.setItem(NICK_KEY, this.nick);
      }
    } catch {
      /* ignore */
    }
  }

  /** 启动时拉云端，存在则覆盖本地（progress + nick 一并同步） */
  private async pullFromCloud(): Promise<void> {
    try {
      const remote = await pullByCode(this.code);
      if (remote) {
        let dirty = false;
        // progress：与本地不一致才覆盖（避免不必要的 notify / DOM 重渲染）
        const same = JSON.stringify(remote.progress) === JSON.stringify(this.data);
        if (!same) {
          this.data = remote.progress;
          this.flushLocal();
          dirty = true;
        }
        // nick：云端为权威。云端有值就同步本地缓存；
        // 若云端 null 而本地有，说明本地缓存陈旧（玩家在另一设备清空了昵称，
        // 或 code 在云端不存在昵称记录）→ 也覆盖为 null
        if (remote.nick !== this.nick) {
          this.nick = remote.nick;
          this.flushLocalNick();
          dirty = true;
        }
        if (dirty) this.notifyChange();
      }
    } finally {
      this.bootstrapResolve?.();
      this.bootstrapResolve = null;
    }
  }

  // ============ Public API ============

  /** 当前 8 位 code（既用于显示也用于写云端） */
  getCode(): string {
    return this.code;
  }

  /** 切换到指定 code（扫码 / 输入恢复）：替换本地 code + 拉一次云端（progress + nick） */
  async adoptCode(newCode: string): Promise<boolean> {
    if (!isValidCode(newCode)) return false;
    const remote = await pullByCode(newCode);
    if (!remote) return false;
    this.code = newCode;
    try {
      localStorage.setItem(CODE_KEY, newCode);
    } catch {
      /* ignore */
    }
    this.data = remote.progress;
    this.flushLocal();
    // 接管别人的 code = 接管别人的身份，本地缓存的旧昵称已不属于这个 code。
    // 直接采用云端值（无值则为 null），让欢迎语 / 排行榜 / 设置页都立刻反映新身份。
    this.nick = remote.nick;
    this.flushLocalNick();
    this.notifyChange();
    return true;
  }

  /** 当前昵称（云端权威值；本地缓存仅用于离线/启动占位） */
  getNick(): string | null {
    return this.nick;
  }

  /**
   * 设置 / 更新昵称。
   *
   * 写入语义：与 reset 一致——必须等云端写入成功才视为完成，
   * 避免本地写了但云端失败导致排行榜显示与本地不一致。
   *
   * @returns true = 云端写入成功；false = 校验失败 / 限流 / 网络异常
   */
  async setNick(nick: string): Promise<boolean> {
    if (!isValidNick(nick)) return false;
    const ok = await pushNick(this.code, nick);
    if (!ok) return false;
    this.nick = nick;
    this.flushLocalNick();
    this.notifyChange();
    return true;
  }

  /**
   * 关卡是否解锁。
   *
   * 开发模式（vite dev / vite preview --mode development）下：
   * 全部关卡解锁，方便联调任意关卡的迷宫生成 / 渲染 / 音效，
   * 不必先把前面所有关卡通关。
   *
   * 生产构建：`import.meta.env.DEV` 是编译期常量 false，整段 if 会被
   * esbuild DCE 掉，不会泄漏到线上产物中、对玩家行为无影响。
   */
  isUnlocked(levelId: number): boolean {
    // if (import.meta.env.DEV) return true;
    return levelId <= this.data.unlocked;
  }

  getRecord(levelId: number): LevelRecord | null {
    return this.data.records[levelId] ?? null;
  }

  /**
   * 提交一次通关。
   *
   * 流程：
   *   1. 本地数据更新（瞬时反馈，不阻塞 UI）
   *   2. 后台 push 到云端：
   *      - 成功：用云端返回的最终值（last-write-wins 后）覆盖本地，触发 onChange
   *      - 失败：通过 onPushError 通知 UI 层，本地保留写入（玩家通关感受不被打断）
   *
   * @returns 本地是否产生新最佳记录（用于结算页是否显示"刷新纪录"）
   */
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
    this.flushLocal();
    // 后台 push：失败通过 pushErr 回调让 UI 决定如何提示
    void pushProgress(this.code, this.data).then((r) => {
      if (!r.ok && r.error) this.notifyPushError(r.error, r.retryAfterSec);
    });
    this.notifyChange();
    return updated;
  }

  /**
   * 清除所有进度。
   *
   * 安全语义：必须等云端写入成功才视为"清除完成"，否则云端旧数据会在下次
   * 启动 bootstrap 时被拉回来覆盖刚清空的本地，等于功能失效。
   *
   * @returns ok=true 时本地与云端都已清除；失败时附带 error 供调用方文案路由
   */
  async reset(): Promise<{ ok: boolean; error?: PushError; retryAfterSec?: number }> {
    const cleared = { ...defaultSave };
    // 先尝试推云端：成功后再覆写本地，保证"两端一致"原子性
    // 失败时本地不动，调用方可提示用户重试
    const r = await pushProgress(this.code, cleared);
    if (!r.ok) return { ok: false, error: r.error, retryAfterSec: r.retryAfterSec };
    this.data = cleared;
    this.flushLocal();
    this.notifyChange();
    return { ok: true };
  }

  /**
   * 是否需要在首次通关后引导用户保存同步二维码 / 链接。
   *
   * 触发条件：
   *   - 用户已通关至少 1 关（unlocked >= 2）
   *   - 还没有展示过这个引导（localStorage 标记不存在）
   *
   * 调用方（结算页）拿到 true 后弹引导，弹完调用 markBackupPrompted() 写入标记，
   * 下次不再提示。
   */
  shouldPromptBackup(): boolean {
    if (this.data.unlocked < 2) return false;
    try {
      return localStorage.getItem(BACKUP_PROMPTED_KEY) !== '1';
    } catch {
      return false;
    }
  }

  /** 用户已被引导（或主动跳过）保存同步入口；下次不再提示 */
  markBackupPrompted(): void {
    try {
      localStorage.setItem(BACKUP_PROMPTED_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * 订阅"云端写入失败"事件。
   *
   * UI 层（main.ts / 结算页等）订阅后可统一展示安全 Toast：
   *   - too_fast            操作过于频繁，请稍后再试
   *   - too_many_requests   提交过于频繁，请稍作休息
   *   - ip_abuse            检测到异常访问，已临时限制
   *   - concurrent_play     编号正在另一台设备游玩，请勿同时多端使用
   *   - unlock_delta_too_large 进度异常，本次未保存
   *   - network/forbidden   网络异常，进度暂存本地
   */
  onPushError(cb: (err: PushError, retryAfterSec?: number) => void): () => void {
    this.pushErrListeners.add(cb);
    return () => this.pushErrListeners.delete(cb);
  }

  private notifyPushError(err: PushError, retryAfterSec?: number): void {
    for (const cb of this.pushErrListeners) {
      try {
        cb(err, retryAfterSec);
      } catch {
        /* ignore */
      }
    }
  }

  private notifyChange(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        /* ignore */
      }
    }
  }
}

export const storage = new Storage();

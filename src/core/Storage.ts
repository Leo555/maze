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

import { pullByCode, pushProgress } from './CloudSync';
import {
  type SaveData,
  type LevelRecord,
  normalizeSave,
  DEFAULT_SAVE,
} from '../../shared/types';

const KEY = 'maze_save';
const CODE_KEY = 'maze_code';
const SAVE_VERSION = 1;

/** 生成随机 8 位数字 code */
function generateCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  // [10000000, 99999999] 共 9e7 个值
  const v = (arr[0] % 90000000) + 10000000;
  return String(v);
}

const defaultSave: SaveData = { ...DEFAULT_SAVE, v: SAVE_VERSION };

export class Storage {
  /** 8 位 code：用户身份兼写权限 */
  private code: string;
  private data: SaveData;
  private listeners = new Set<() => void>();

  /** 启动时云端拉取完成的 Promise，main.ts 入口 await 它 */
  private bootstrapResolve: (() => void) | null = null;
  readonly bootstrapPromise: Promise<void>;

  constructor() {
    this.code = this.loadOrCreateCode();
    this.data = this.loadLocal();
    this.bootstrapPromise = new Promise<void>((r) => (this.bootstrapResolve = r));
    void this.pullFromCloud();
  }

  /** 读 / 创建本机 code */
  private loadOrCreateCode(): string {
    try {
      const saved = localStorage.getItem(CODE_KEY);
      if (saved && /^\d{8}$/.test(saved)) return saved;
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

  /** 启动时拉云端，存在则覆盖本地 */
  private async pullFromCloud(): Promise<void> {
    try {
      const remote = await pullByCode(this.code);
      if (remote) {
        const same = JSON.stringify(remote) === JSON.stringify(this.data);
        if (!same) {
          this.data = remote;
          this.flushLocal();
          this.notifyChange();
        }
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

  /** 切换到指定 code（扫码 / 输入恢复）：替换本地 code + 拉一次云端 */
  async adoptCode(newCode: string): Promise<boolean> {
    if (!/^\d{8}$/.test(newCode)) return false;
    const remote = await pullByCode(newCode);
    if (!remote) return false;
    this.code = newCode;
    try {
      localStorage.setItem(CODE_KEY, newCode);
    } catch {
      /* ignore */
    }
    this.data = remote;
    this.flushLocal();
    this.notifyChange();
    return true;
  }

  isUnlocked(levelId: number): boolean {
    return levelId <= this.data.unlocked;
  }

  getRecord(levelId: number): LevelRecord | null {
    return this.data.records[levelId] ?? null;
  }

  /** 提交一次通关；本地写完后立即推云端（fire-and-forget） */
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
    void pushProgress(this.code, this.data);
    this.notifyChange();
    return updated;
  }

  reset(): void {
    this.data = { ...defaultSave };
    this.flushLocal();
    void pushProgress(this.code, this.data);
    this.notifyChange();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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

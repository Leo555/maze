/**
 * 本地存档 + 云端同步（极简版）
 *
 * 设计：
 *   - 每个浏览器首次访问生成一个随机 8 位 code，存 localStorage
 *   - 通关后立即把 (code, progress) 推到云端
 *   - 启动时用 code 拉云端进度，覆盖本地（last-write-wins，云端为权威）
 *   - 扫码 / 输入别人的 code → 直接替换本机 code → 后续读写都到那个 code
 *
 * 持久化分层：
 *   1. localStorage（主）
 *   2. cookie（备份，应对 iOS Safari ITP 的 7 天 localStorage 清理）
 *   3. 云端（last-write-wins）
 */

import { pullByCode, pushProgress } from './CloudSync';
import {
  type SaveData,
  type LevelRecord,
  normalizeSave,
  DEFAULT_SAVE,
} from '../../shared/types';

const KEY = 'maze_save';
const COOKIE_KEY = 'maze_save';
const CODE_KEY = 'maze_code';
const SAVE_VERSION = 1;
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const COOKIE_MAX_BYTES = 3800;

/** 生成随机 8 位数字 code */
function generateCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  // [10000000, 99999999] 共 9e7 个值
  const v = (arr[0] % 90000000) + 10000000;
  return String(v);
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const c of document.cookie ? document.cookie.split(';') : []) {
    const t = c.trim();
    if (t.startsWith(prefix)) {
      try {
        return decodeURIComponent(t.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

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
    /* ignore */
  }
}

/** 把存档压缩到 cookie 安全大小内（100 关全通关时记录会接近上限） */
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
    this.flushLocal();
    this.bootstrapPromise = new Promise<void>((r) => (this.bootstrapResolve = r));
    void this.pullFromCloud();
  }

  /** 读 / 创建本机 code（localStorage 优先） */
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

  /** 读取本地存档（localStorage + cookie，取存在的那份） */
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
    try {
      const raw = readCookie(COOKIE_KEY);
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
    const json = JSON.stringify(this.data);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* ignore */
    }
    writeCookie(COOKIE_KEY, compactForCookie(this.data));
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

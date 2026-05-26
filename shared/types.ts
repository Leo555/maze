/**
 * 云端存档与本地存档共用的类型定义。
 *
 * 注意：本文件被前端（src/）和后端 API（api/）双向引用，
 * 所以不能依赖任何浏览器或 Node 专属 API。
 */

export interface LevelRecord {
  bestTime: number;
  bestStars: number;
  cleared: boolean;
}

/** 云端与本地共用的存档结构 */
export interface SaveData {
  /** 数据格式版本号 */
  v: number;
  records: Record<number, LevelRecord>;
  unlocked: number;
}

/** 云端用户记录（KV: user:{openid} 的值） */
export interface CloudUser {
  /** 微信 openid（用户唯一标识） */
  openid: string;
  /** 8 位数字编号（人类可读凭证） */
  code: string;
  /** 进度数据 */
  progress: SaveData;
  /** 创建时间（ms） */
  createdAt: number;
  /** 最近更新时间（ms） */
  updatedAt: number;
}

/** 云端编号反向索引（KV: code:{8位} 的值） */
export interface CloudCodeIndex {
  openid: string;
  createdAt: number;
}

/** 比较两份存档，返回"更进度"的那份 */
export function pickRicher(a: SaveData, b: SaveData): SaveData {
  if (a.unlocked !== b.unlocked) return a.unlocked > b.unlocked ? a : b;
  const ar = Object.keys(a.records).length;
  const br = Object.keys(b.records).length;
  return ar >= br ? a : b;
}

/** 把任意来源的对象规范化为 SaveData（兜底字段，向后兼容） */
export function normalizeSave(raw: unknown, currentVersion = 1): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<SaveData>;
  return {
    v: currentVersion,
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

/** 默认空存档 */
export const DEFAULT_SAVE: SaveData = {
  v: 1,
  records: {},
  unlocked: 1,
};

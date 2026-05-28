/**
 * 云端存档与本地存档共用的类型定义。
 *
 * 极简账号模型：
 *   - 8 位数字 code 由前端首次访问时生成，存 localStorage
 *   - 任何持有 code 的人都能读写该 code 的进度（限流防滥用）
 *   - 服务端只存 code → progress 的映射，无 user / token / openid
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

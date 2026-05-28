/**
 * 云端存档与本地存档共用的类型定义。
 *
 * 注意：本文件被前端（src/）和后端 API（api/）双向引用，
 * 所以不能依赖任何浏览器或 Node 专属 API。
 *
 * v2 账号模型（2025）：
 *   - 不再以 openid 为主键；改用内部生成的 userId（UUID）
 *   - 编号 code：公开凭证，可被他人输入只读拉取进度
 *   - token：私密凭证（仅本设备持有，cookie 形式），写云端必须凭它
 *   - openid：可选；微信授权后才有，用于跨设备通过微信再次拿到 token
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

/**
 * 云端用户记录（KV: user:{userId} 的值）
 *
 * userId 是内部主键（UUID v4 字符串），不暴露给前端。
 * 前端只看到 code（展示用）；写云端时凭 token cookie。
 */
export interface CloudUser {
  /** 内部主键（UUID）；不展示给用户 */
  userId: string;
  /** 8 位数字编号（公开凭证；可被他人只读引用） */
  code: string;
  /** 私密 token（写云端的鉴权凭证；存浏览器 cookie + localStorage） */
  token: string;
  /** 微信 openid（可选；仅在微信授权过后才有） */
  openid?: string;
  /** 进度数据 */
  progress: SaveData;
  /** 创建时间（ms） */
  createdAt: number;
  /** 最近更新时间（ms） */
  updatedAt: number;
}

/** 编号 → userId 反向索引（KV: code:{8位} 的值） */
export interface CloudCodeIndex {
  userId: string;
  createdAt: number;
}

/** openid → userId 反向索引（KV: openid:{openid} 的值，仅微信用户有） */
export interface CloudOpenidIndex {
  userId: string;
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

/** 前端可见的账号信息（GET /api/me 与 init 响应） */
export interface MeResponse {
  /** 8 位编号 */
  code: string;
  /** 当前进度 */
  progress: SaveData;
}

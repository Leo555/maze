/**
 * 云端存档与本地存档共用的类型定义。
 *
 * 极简账号模型：
 *   - 8 位字母数字 code 由前端首次访问时生成，存 localStorage
 *   - 任何持有 code 的人都能读写该 code 的进度（限流防滥用）
 *   - 服务端只存 code → progress 的映射，无 user / token / openid
 *
 * Code 设计：
 *   - 字符集去掉易混淆字符：0/O、1/I/l
 *   - 余下：数字 23456789 + 大写 ABCDEFGHJKLMNPQRSTUVWXYZ + 小写 abcdefghijkmnopqrstuvwxyz
 *   - 共 8 + 24 + 24 = 56 个字符，8 位长度 → 空间 56^8 ≈ 9.6 万亿
 *   - 远高于纯 8 位数字（9e7），暴力枚举 + 后端限流双重防护
 */

/** 可读字符集（去掉 0/O/1/I/l 易混淆字符） */
export const CODE_ALPHABET =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const CODE_LENGTH = 8;
/** Code 校验正则（前后端共用） */
export const CODE_REGEX = /^[2-9A-HJ-NP-Za-km-z]{8}$/;

/** 校验是否合法 code */
export function isValidCode(s: unknown): s is string {
  return typeof s === 'string' && CODE_REGEX.test(s);
}

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

/** 关卡总数（与 config/levels.ts 的 TOTAL_LEVELS 保持一致；shared 不依赖 src 因此独立常量） */
const MAX_LEVEL_ID = 100;
/** 单关合理时间上限：3 小时；超过视为脏数据（防止 NaN/Infinity/恶意大值污染速通榜） */
const MAX_BEST_TIME_SEC = 3 * 60 * 60;

/**
 * 把任意来源的对象规范化为 SaveData。
 *
 * 反作弊兜底（非常重要）：
 *   - records 内每条记录都做严格类型 + 范围校验，脏值整条丢弃
 *   - bestStars 钳制到 0..3
 *   - bestTime 必须是有限非负数且不超过 MAX_BEST_TIME_SEC
 *   - levelId 必须是 1..100 整数
 *   - unlocked 钳制到 1..MAX_LEVEL_ID + 1（最多解锁到"下一关 = 全通后状态"）
 *
 * 这是后端反作弊的最后一道防线（save 的 unlock_delta 检查只能挡住跨提交的"跳级"，
 * 挡不住单次提交里 records 字段被注入恶意数值——例如 bestStars: 999 会污染综合榜分数）。
 */
export function normalizeSave(raw: unknown, currentVersion = 1): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<SaveData>;

  // unlocked：必须是 1..MAX_LEVEL_ID+1 的整数
  let unlocked = 1;
  if (typeof obj.unlocked === 'number' && Number.isFinite(obj.unlocked)) {
    unlocked = Math.max(1, Math.min(MAX_LEVEL_ID + 1, Math.floor(obj.unlocked)));
  }

  // records：逐条严格校验，任何字段不合法则整条丢弃
  const cleanRecords: Record<number, LevelRecord> = {};
  if (obj.records && typeof obj.records === 'object') {
    const src = obj.records as Record<string, unknown>;
    for (const k of Object.keys(src)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 1 || id > MAX_LEVEL_ID) continue;
      const r = src[k];
      if (!r || typeof r !== 'object') continue;
      const rec = r as Partial<LevelRecord>;
      if (
        typeof rec.bestTime !== 'number' ||
        !Number.isFinite(rec.bestTime) ||
        rec.bestTime < 0 ||
        rec.bestTime > MAX_BEST_TIME_SEC
      ) {
        continue;
      }
      if (typeof rec.bestStars !== 'number' || !Number.isFinite(rec.bestStars)) {
        continue;
      }
      cleanRecords[id] = {
        bestTime: rec.bestTime,
        bestStars: Math.max(0, Math.min(3, Math.floor(rec.bestStars))),
        cleared: rec.cleared === true,
      };
    }
  }

  return {
    v: currentVersion,
    records: cleanRecords,
    unlocked,
  };
}

/** 默认空存档 */
export const DEFAULT_SAVE: SaveData = {
  v: 1,
  records: {},
  unlocked: 1,
};

// =====================================================================
// 昵称（排行榜显示用，可选）
// =====================================================================

/** 昵称长度限制（字符数；中文每个算 1 字） */
export const NICK_MIN_LENGTH = 1;
export const NICK_MAX_LENGTH = 12;

/**
 * 校验昵称合法性（前后端共用）。
 *
 * 规则：
 *   - 长度 1-12 字符
 *   - 不允许首尾空白（trim 后才校验）
 *   - 不允许控制字符（\u0000-\u001f \u007f）
 *   - 允许中英文 / 数字 / 标点 / emoji
 *
 * 不做敏感词过滤：项目准则反对过度设计；如发现滥用，由 admin 后台手动清理。
 */
export function isValidNick(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (s !== s.trim()) return false;
  const len = [...s].length; // 用展开计算 code point 数量，emoji 算 1
  if (len < NICK_MIN_LENGTH || len > NICK_MAX_LENGTH) return false;
  // 拒绝控制字符
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  return true;
}

/**
 * 把 8 位 code 脱敏为 3+3 形式（如 jeT***UvAs → jeT***vAs），
 * 排行榜在玩家未设置昵称时回退展示用。
 */
export function maskCode(code: string): string {
  if (!isValidCode(code)) return '????????';
  return `${code.slice(0, 3)}***${code.slice(-2)}`;
}

// =====================================================================
// 排行榜
// =====================================================================

/** 综合榜单条记录（前端展示用） */
export interface OverallRankItem {
  /** 排名（1-based） */
  rank: number;
  /** 8 位 code（仅 admin 后台或自己看自己时不脱敏） */
  code: string;
  /** 昵称；未设置则为 null，前端用 maskCode 兜底显示 */
  nick: string | null;
  /** 通关数（0-100） */
  cleared: number;
  /** 总星数（0-300） */
  stars: number;
}

/** 单关速通榜单条记录 */
export interface LevelRankItem {
  rank: number;
  code: string;
  nick: string | null;
  /** 最佳通关用时（秒） */
  bestTime: number;
  bestStars: number;
}

/**
 * 计算综合榜分数：
 *   score = (unlocked - 1) * 1000 + totalStars
 *
 * 设计：
 *   - (unlocked - 1) 是已通关数量（0-100），权重 1000，确保通关多的人永远在前
 *   - totalStars 范围 0-300，作为同通关数下的次序键
 *   - 最大值约 100 * 1000 + 300 = 100300，远低于 IEEE-754 双精度精确整数上限
 *     (2^53)，KV ZSET 存储无精度损失
 */
export function calcOverallScore(progress: SaveData): number {
  const cleared = Math.max(0, progress.unlocked - 1);
  let stars = 0;
  for (const k of Object.keys(progress.records)) {
    const r = progress.records[Number(k)];
    if (r) stars += r.bestStars;
  }
  return cleared * 1000 + stars;
}

/** 从 score 反解出 (cleared, stars) */
export function parseOverallScore(score: number): { cleared: number; stars: number } {
  const cleared = Math.floor(score / 1000);
  const stars = score - cleared * 1000;
  return { cleared, stars };
}

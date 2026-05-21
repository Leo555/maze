import type { ThemeName } from './theme';
import { clamp } from '../core/utils';

/**
 * 关卡配置
 *
 * 设计思路：
 *   - 100 关 / 10 章节 / 每章 10 关
 *   - 难度沿全局 idx (1..100) 平滑递增（迷宫尺寸、视野、钥匙、机关）
 *   - 每章固定 theme / bgm / 章节名，避免视听疲劳
 *   - 关卡数据通过 buildLevels() 程序化生成，保证曲线一致、易于调参
 */
export interface LevelConfig {
  id: number;
  name: string;
  subtitle: string;
  theme: ThemeName;
  size: number; // 迷宫尺寸（格）

  // 机制开关
  vision: 'full' | 'large' | 'medium' | 'small'; // 视野范围
  keys: number; // 钥匙数量（0 = 不需要钥匙）
  timeLimit: number; // 倒计时秒，0 = 无限
  hourglasses: number; // 沙漏数量
  mapShards: number; // 地图碎片数量

  bgm: string; // BGM 资源 id
}

/** 章节模板：每 10 关一组 */
interface Chapter {
  /** 1..10 */
  index: number;
  /** 章节名（中文） */
  name: string;
  /** 章节副标题（英文） */
  subtitle: string;
  /** 主题色 */
  theme: ThemeName;
  /** BGM */
  bgm: string;
  /** 视野等级 */
  vision: LevelConfig['vision'];
  /** 是否使用钥匙 */
  enableKeys: boolean;
  /** 是否使用倒计时 */
  enableTime: boolean;
  /** 是否使用地图碎片 */
  enableMap: boolean;
}

const CHAPTERS: Chapter[] = [
  // 序章：纯探索，让玩家熟悉操作
  {
    index: 1,
    name: '晨曦',
    subtitle: 'DAWN',
    theme: 'dawn',
    bgm: 'bgm_dawn',
    vision: 'full',
    enableKeys: false,
    enableTime: false,
    enableMap: false,
  },
  // 第二章：引入钥匙
  {
    index: 2,
    name: '薄荷',
    subtitle: 'MINT',
    theme: 'mint',
    bgm: 'bgm_mint',
    vision: 'large',
    enableKeys: true,
    enableTime: false,
    enableMap: false,
  },
  // 第三章：缩小视野，引入地图碎片
  {
    index: 3,
    name: '黄昏',
    subtitle: 'DUSK',
    theme: 'dusk',
    bgm: 'bgm_dusk',
    vision: 'medium',
    enableKeys: true,
    enableTime: false,
    enableMap: true,
  },
  // 第四章：引入倒计时
  {
    index: 4,
    name: '深海',
    subtitle: 'DEEP',
    theme: 'deep',
    bgm: 'bgm_deep',
    vision: 'medium',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
  // 第五章：极光（视野受限）
  {
    index: 5,
    name: '极光',
    subtitle: 'AURORA',
    theme: 'aurora',
    bgm: 'bgm_aurora',
    vision: 'small',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
  // 第六章：迷雾（dusk 复访）
  {
    index: 6,
    name: '雾境',
    subtitle: 'MIST',
    theme: 'dusk',
    bgm: 'bgm_dusk',
    vision: 'medium',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
  // 第七章：虹霓
  {
    index: 7,
    name: '虹霓',
    subtitle: 'PRISM',
    theme: 'aurora',
    bgm: 'bgm_aurora',
    vision: 'small',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
  // 第八章：深渊（deep 复访）
  {
    index: 8,
    name: '深渊',
    subtitle: 'ABYSS',
    theme: 'deep',
    bgm: 'bgm_deep',
    vision: 'small',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
  // 第九章：试炼
  {
    index: 9,
    name: '试炼',
    subtitle: 'TRIAL',
    theme: 'finale',
    bgm: 'bgm_finale',
    vision: 'small',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
  // 终章：终局
  {
    index: 10,
    name: '终局',
    subtitle: 'FINALE',
    theme: 'finale',
    bgm: 'bgm_finale',
    vision: 'small',
    enableKeys: true,
    enableTime: true,
    enableMap: true,
  },
];

/** 章节总数 */
export const CHAPTER_COUNT = CHAPTERS.length;
/** 每章关数 */
export const LEVELS_PER_CHAPTER = 10;
/** 总关数 */
export const TOTAL_LEVELS = CHAPTER_COUNT * LEVELS_PER_CHAPTER; // 100

/**
 * 程序化生成 100 关。
 *
 * 设计原则：
 *   - size 平滑增长：每 4 关 +1 格，从 11 → 35（保持可玩性，避免过度庞大）
 *   - keys 平滑增长：从 0 → 6
 *   - 机关数量按章节启用 + 全局 idx 双重平滑
 *   - 每章末关（chapterPos=10）作为「章节挑战」，size & 机关明显加强
 *   - star3/star2 时间用 size 与章节难度估算，给玩家合理的目标
 */
function buildLevels(): LevelConfig[] {
  const list: LevelConfig[] = [];

  for (let idx = 1; idx <= TOTAL_LEVELS; idx++) {
    const chapterIdx = Math.ceil(idx / LEVELS_PER_CHAPTER); // 1..10
    const chapter = CHAPTERS[chapterIdx - 1];
    const chapterPos = ((idx - 1) % LEVELS_PER_CHAPTER) + 1; // 1..10：本章节内的位置
    const isBoss = chapterPos === LEVELS_PER_CHAPTER; // 每章末关：boss

    // ===== 迷宫尺寸 =====
    // 全局慢速增长 + 章节末关 +2 加成
    const baseSize = 11 + Math.floor((idx - 1) / 4); // 11..35
    const size = clamp(baseSize + (isBoss ? 2 : 0), 11, 39) | 1; // 强制奇数（视觉对称更佳）

    // ===== 钥匙 =====
    // 第 1 章不开启；后面按全局 idx 慢慢加，最大 6
    const keys = chapter.enableKeys
      ? clamp(1 + Math.floor((idx - LEVELS_PER_CHAPTER - 1) / 12), 1, 6) +
        (isBoss ? 1 : 0)
      : 0;
    const finalKeys = clamp(keys, 0, 8);

    // ===== 倒计时 =====
    // 启用时：以 size² × 0.4 估算「悠然走完时间」上限，再乘以紧迫系数
    // boss 关卡更紧
    const cellCount = size * size;
    let timeLimit = 0;
    if (chapter.enableTime) {
      const baseTime = Math.round(cellCount * 0.45 + idx * 0.6);
      timeLimit = clamp(
        Math.round(baseTime * (isBoss ? 0.85 : 1.0)),
        45,
        420
      );
    }

    // ===== 沙漏 =====
    // 仅在倒计时关卡有意义
    const hourglasses = chapter.enableTime
      ? clamp(Math.floor(size / 8) + (isBoss ? 1 : 0), 0, 6)
      : 0;

    // ===== 地图碎片 =====
    // 仅在视野受限关卡有意义
    let mapShards = 0;
    if (chapter.enableMap && chapter.vision !== 'full') {
      mapShards = clamp(Math.floor(size / 12) + (chapter.vision === 'small' ? 1 : 0), 0, 4);
    }

    // ===== 名称 =====
    // 章节名 + 章内编号（1-1, 1-2, ..., 10-10）
    const name = `${chapter.name} ${chapterIdx}-${chapterPos}`;
    const subtitle = `${chapter.subtitle} ${chapterIdx}-${chapterPos}`;

    list.push({
      id: idx,
      name,
      subtitle,
      theme: chapter.theme,
      size,
      vision: chapter.vision,
      keys: finalKeys,
      timeLimit,
      hourglasses,
      mapShards,
      bgm: chapter.bgm,
    });
  }

  return list;
}

export const levels: LevelConfig[] = buildLevels();

/** 关卡 → 章节信息（供 UI 分组展示） */
export function getChapterOf(levelId: number): {
  index: number;
  name: string;
  subtitle: string;
  theme: ThemeName;
  range: [number, number];
} {
  const chapterIdx = clamp(Math.ceil(levelId / LEVELS_PER_CHAPTER), 1, CHAPTER_COUNT);
  const chapter = CHAPTERS[chapterIdx - 1];
  const start = (chapterIdx - 1) * LEVELS_PER_CHAPTER + 1;
  const end = chapterIdx * LEVELS_PER_CHAPTER;
  return {
    index: chapterIdx,
    name: chapter.name,
    subtitle: chapter.subtitle,
    theme: chapter.theme,
    range: [start, end],
  };
}

export function getLevel(id: number): LevelConfig {
  return levels.find((l) => l.id === id) ?? levels[0];
}

/** 视野半径（像素 → 格数转换由 Renderer 处理） */
export const VISION_RADIUS: Record<LevelConfig['vision'], number> = {
  full: 999,
  large: 9,
  medium: 6,
  small: 4,
};

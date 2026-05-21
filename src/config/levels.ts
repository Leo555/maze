import type { ThemeName } from './theme';

/**
 * 关卡配置
 * difficulty 用于自动平衡视野/钥匙数量等
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
  oneWayDoors: number; // 单向门数量
  portals: number; // 传送门对数
  movingWalls: number; // 周期开合墙数量
  chasers: number; // 追逐者数量

  // 评分阈值（秒）
  star3Time: number;
  star2Time: number;

  bgm: string; // BGM 资源 id
}

export const levels: LevelConfig[] = [
  {
    id: 1,
    name: '晨曦',
    subtitle: 'DAWN',
    theme: 'dawn',
    size: 11,
    vision: 'full',
    keys: 0,
    timeLimit: 0,
    hourglasses: 0,
    mapShards: 0,
    oneWayDoors: 0,
    portals: 0,
    movingWalls: 0,
    chasers: 0,
    star3Time: 30,
    star2Time: 60,
    bgm: 'bgm_dawn',
  },
  {
    id: 2,
    name: '薄荷',
    subtitle: 'MINT',
    theme: 'mint',
    size: 15,
    vision: 'large',
    keys: 3,
    timeLimit: 0,
    hourglasses: 0,
    mapShards: 0,
    oneWayDoors: 0,
    portals: 0,
    movingWalls: 0,
    chasers: 0,
    star3Time: 60,
    star2Time: 120,
    bgm: 'bgm_mint',
  },
  {
    id: 3,
    name: '黄昏',
    subtitle: 'DUSK',
    theme: 'dusk',
    size: 19,
    vision: 'medium',
    keys: 2,
    timeLimit: 0,
    hourglasses: 0,
    mapShards: 2,
    oneWayDoors: 0,
    portals: 0,
    movingWalls: 0,
    chasers: 0,
    star3Time: 90,
    star2Time: 180,
    bgm: 'bgm_dusk',
  },
  {
    id: 4,
    name: '深海',
    subtitle: 'DEEP',
    theme: 'deep',
    size: 23,
    vision: 'medium',
    keys: 2,
    timeLimit: 75,
    hourglasses: 3,
    mapShards: 1,
    oneWayDoors: 0,
    portals: 0,
    movingWalls: 0,
    chasers: 0,
    star3Time: 50,
    star2Time: 70,
    bgm: 'bgm_deep',
  },
  {
    id: 5,
    name: '极光',
    subtitle: 'AURORA',
    theme: 'aurora',
    size: 27,
    vision: 'small',
    keys: 3,
    timeLimit: 120,
    hourglasses: 4,
    mapShards: 2,
    oneWayDoors: 4,
    portals: 2,
    movingWalls: 3,
    chasers: 0,
    star3Time: 80,
    star2Time: 110,
    bgm: 'bgm_aurora',
  },
  {
    id: 6,
    name: '终局',
    subtitle: 'FINALE',
    theme: 'finale',
    size: 31,
    vision: 'small',
    keys: 4,
    timeLimit: 180,
    hourglasses: 5,
    mapShards: 2,
    oneWayDoors: 5,
    portals: 3,
    movingWalls: 4,
    chasers: 1,
    star3Time: 120,
    star2Time: 165,
    bgm: 'bgm_finale',
  },
];

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

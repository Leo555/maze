/**
 * 关卡主题配色
 * 每关一套，营造不同氛围
 */

export interface Theme {
  bg: string; // 背景色
  wall: string; // 墙体色
  wallShadow: string; // 墙体阴影色
  floor: string; // 地板（路径）色
  floorAccent: string; // 地板装饰色（已探索区域）
  player: string; // 玩家色
  playerGlow: string; // 玩家光晕色
  exit: string; // 出口色
  accent: string; // 强调色（道具、UI）
  fog: string; // 视野外暗色
  hudFg: string; // HUD 文字色
}

export const themes: Record<string, Theme> = {
  dawn: {
    bg: '#F5EFE6',
    wall: '#D4C5A9',
    wallShadow: '#B8A788',
    floor: '#EFE7D6',
    floorAccent: '#E5D9C0',
    player: '#7A8B6F',
    playerGlow: 'rgba(122, 139, 111, 0.35)',
    exit: '#E8A87C',
    accent: '#C38D9E',
    fog: 'rgba(60, 50, 40, 0.55)',
    hudFg: '#3a342b',
  },
  mint: {
    bg: '#E8F1F2',
    wall: '#A8DADC',
    wallShadow: '#7FB8BB',
    floor: '#DEEBED',
    floorAccent: '#C8DDE0',
    player: '#457B9D',
    playerGlow: 'rgba(69, 123, 157, 0.4)',
    exit: '#E63946',
    accent: '#1D3557',
    fog: 'rgba(20, 40, 60, 0.55)',
    hudFg: '#1D3557',
  },
  dusk: {
    bg: '#FFE5D9',
    wall: '#FFCAD4',
    wallShadow: '#E5A8B5',
    floor: '#FBDDD0',
    floorAccent: '#F2C4B4',
    player: '#9D8189',
    playerGlow: 'rgba(157, 129, 137, 0.4)',
    exit: '#D8829D',
    accent: '#6D6875',
    fog: 'rgba(80, 50, 60, 0.55)',
    hudFg: '#5a4750',
  },
  deep: {
    bg: '#1B263B',
    wall: '#415A77',
    wallShadow: '#2A3E5B',
    floor: '#243149',
    floorAccent: '#324867',
    player: '#E0E1DD',
    playerGlow: 'rgba(224, 225, 221, 0.45)',
    exit: '#FFB703',
    accent: '#778DA9',
    fog: 'rgba(0, 0, 0, 0.7)',
    hudFg: '#E0E1DD',
  },
  aurora: {
    bg: '#22223B',
    wall: '#4A4E69',
    wallShadow: '#33364D',
    floor: '#2C2E47',
    floorAccent: '#3D405B',
    player: '#F2E9E4',
    playerGlow: 'rgba(242, 233, 228, 0.5)',
    exit: '#C9ADA7',
    accent: '#9A8C98',
    fog: 'rgba(0, 0, 0, 0.72)',
    hudFg: '#F2E9E4',
  },
  finale: {
    bg: '#0D1117',
    wall: '#21262D',
    wallShadow: '#0a0d12',
    floor: '#161B22',
    floorAccent: '#21262D',
    player: '#F0F6FC',
    playerGlow: 'rgba(240, 246, 252, 0.5)',
    exit: '#FF6B6B',
    accent: '#FFD93D',
    fog: 'rgba(0, 0, 0, 0.85)',
    hudFg: '#F0F6FC',
  },
};

export type ThemeName = keyof typeof themes;

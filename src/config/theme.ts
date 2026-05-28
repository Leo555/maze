/**
 * 关卡主题配色
 *
 * 设计准则（v3，"晨雾迷径" IP 化）：
 *   1. 所有主题 bg 明度 88~96%，眼睛长时间游玩零负担
 *   2. 章节情绪差异由"色相 + 饱和度"承担，不靠明度
 *   3. 明度阶梯严格：bg ≥ floor ≥ floorAccent ≥ wallShadow ≥ wall ≥ player
 *      层间明度差 ≥ 12%，墙、地板、玩家三层视觉清晰可分
 *   4. 玩家固定深色（明度 < 25%），所有底色上都是"一眼定位的深点"
 *   5. 出口用与底色色相互补的暖色（赤陶/橙/正红），冷色底自然吸睛
 *   6. WCAG 对比度：玩家 vs 底色 ≥ 7:1（AAA），墙 vs 底色 ≥ 3:1
 *   7. fog 全主题统一 0.20~0.28，营造"晨雾"诗意而非"黑屏"压抑
 *      → 雾色 = bg 同色相的暗化版本，不用纯黑
 *      → 视野中心仍清晰，雾只在远端轻轻浮起，呼应游戏名"晨雾迷径"
 *   8. 10 章节均有专属配色，姐妹章节做色相微移，叙事递进感更强：
 *      第 1 章 dawn 晨黄 → 第 2 章 mint 薄荷青
 *      第 3 章 dusk 桃粉 → 第 6 章 mist 灰桃（暮色更深）
 *      第 4 章 deep 海蓝 → 第 8 章 abyss 青墨（深入海底）
 *      第 5 章 aurora 紫 → 第 7 章 prism 粉霞紫（紫渐渡桃霞）
 *      第 9 章 finale 月银 → 第 10 章 epilogue 银+金辉（加冕时刻）
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
  fog: string; // 视野外晨雾色（用主题色暗化版，非纯黑）
  hudFg: string; // HUD 文字色
}

export const themes: Record<string, Theme> = {
  // 第 1 章「晨曦」：温暖米黄，新手起点的安心感
  dawn: {
    bg: '#F5EFE6',
    wall: '#A89478',
    wallShadow: '#7E6B52',
    floor: '#EFE7D6',
    floorAccent: '#DCCFB4',
    player: '#3F4D38',
    playerGlow: 'rgba(63, 77, 56, 0.4)',
    exit: '#E07A5F',
    accent: '#81B29A',
    // 暖棕调晨雾（与米黄底同色相暗化）
    fog: 'rgba(110, 90, 65, 0.26)',
    hudFg: '#3F4D38',
  },

  // 第 2 章「薄荷」：清爽青绿，引入钥匙的新鲜感
  mint: {
    bg: '#E6F2F1',
    wall: '#5C9A9C',
    wallShadow: '#3F7779',
    floor: '#D8EAEA',
    floorAccent: '#B6D4D5',
    player: '#1D3557',
    playerGlow: 'rgba(29, 53, 87, 0.45)',
    exit: '#E63946',
    accent: '#2A9D8F',
    // 青绿晨雾
    fog: 'rgba(60, 110, 115, 0.24)',
    hudFg: '#1D3557',
  },

  // 第 3 章「黄昏」：柔和桃粉，引入地图碎片的朦胧感
  dusk: {
    bg: '#FBE4D8',
    wall: '#C97B86',
    wallShadow: '#A05865',
    floor: '#F5D5C5',
    floorAccent: '#E8B6A4',
    player: '#3D2A2E',
    playerGlow: 'rgba(61, 42, 46, 0.42)',
    exit: '#A23E48',
    accent: '#6D6875',
    // 玫瑰色晨雾
    fog: 'rgba(130, 80, 95, 0.26)',
    hudFg: '#3D2A2E',
  },

  // 第 6 章「雾境」：与黄昏同族，但向冷灰偏移——"暮色更深，雾意更重"的剧情递进
  mist: {
    bg: '#E8DCDC',
    wall: '#A07984',
    wallShadow: '#7C5A66',
    floor: '#DDD0D0',
    floorAccent: '#C5B5BA',
    player: '#2D2026',
    playerGlow: 'rgba(45, 32, 38, 0.44)',
    exit: '#A23E48',
    accent: '#5C4F58',
    // 偏冷的玫瑰雾
    fog: 'rgba(110, 80, 95, 0.27)',
    hudFg: '#2D2026',
  },

  // 第 4 章「深海」：晨曦海面，蓝色调沉静不压抑
  deep: {
    bg: '#D8E3EE',
    wall: '#4A6B8E',
    wallShadow: '#2F4A6B',
    floor: '#C7D5E4',
    floorAccent: '#A4B7CC',
    player: '#142036',
    playerGlow: 'rgba(20, 32, 54, 0.5)',
    exit: '#E76F51',
    accent: '#264653',
    // 深海雾蓝
    fog: 'rgba(50, 80, 120, 0.26)',
    hudFg: '#142036',
  },

  // 第 8 章「深渊」：与深海同族，但向青墨偏移——"光线更弱，水更深"的递进
  abyss: {
    bg: '#CFDDDF',
    wall: '#3D6873',
    wallShadow: '#244955',
    floor: '#BDD0D2',
    floorAccent: '#9AB3B7',
    player: '#0E1F26',
    playerGlow: 'rgba(14, 31, 38, 0.52)',
    exit: '#E76F51',
    accent: '#1F4A50',
    // 青墨深雾
    fog: 'rgba(40, 75, 90, 0.28)',
    hudFg: '#0E1F26',
  },

  // 第 5 章「极光」：晨雾紫，神秘色调但高可读
  aurora: {
    bg: '#E5DEEA',
    wall: '#7B6796',
    wallShadow: '#594778',
    floor: '#D6CDDD',
    floorAccent: '#BDB0CC',
    player: '#2C1F40',
    playerGlow: 'rgba(44, 31, 64, 0.48)',
    exit: '#E29578',
    accent: '#5E548E',
    // 紫晨雾
    fog: 'rgba(95, 75, 125, 0.24)',
    hudFg: '#2C1F40',
  },

  // 第 7 章「虹霓」：与极光同族，但向粉霞偏移——"紫渐过渡到桃霞"的递进
  prism: {
    bg: '#EBDDE5',
    wall: '#9A6B89',
    wallShadow: '#754D6A',
    floor: '#DECCD7',
    floorAccent: '#C5AEBC',
    player: '#2E1B33',
    playerGlow: 'rgba(46, 27, 51, 0.5)',
    exit: '#E5805A',
    accent: '#7D4F73',
    // 粉霞晨雾
    fog: 'rgba(120, 75, 105, 0.25)',
    hudFg: '#2E1B33',
  },

  // 第 9 章「试炼」：清冷月银，最高级感的冷灰底
  // 用强对比的深色玩家 + 正红出口承载"终极挑战"的紧张感
  finale: {
    bg: '#DDE2EA',
    wall: '#3F4A60',
    wallShadow: '#252C3C',
    floor: '#CBD2DD',
    floorAccent: '#A6AFBE',
    player: '#0E1320',
    playerGlow: 'rgba(14, 19, 32, 0.55)',
    exit: '#D62828',
    accent: '#F4A261',
    // 月银冷雾
    fog: 'rgba(60, 75, 100, 0.22)',
    hudFg: '#0E1320',
  },

  // 第 10 章「终局」：与试炼同族，但加入金色辉光——史诗感的最终章
  // bg 略偏暖，墙体保持深石板感，accent 改为正金色，强调"加冕时刻"
  epilogue: {
    bg: '#E5DFD2',
    wall: '#3D3A4A',
    wallShadow: '#23202B',
    floor: '#D5CFC0',
    floorAccent: '#B5AE9D',
    player: '#1A1620',
    playerGlow: 'rgba(26, 22, 32, 0.55)',
    exit: '#D62828',
    accent: '#D4A53A', // 正金色：终章加冕
    // 暖金冷雾
    fog: 'rgba(85, 75, 70, 0.24)',
    hudFg: '#1A1620',
  },
};

export type ThemeName = keyof typeof themes;

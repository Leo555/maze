/**
 * 主菜单：标题 + 进度概览 + 2 个按钮（开始/选关） + 右上角竖向 4 个图标。
 *
 * 设计原则：
 *   - 主按钮组只保留"开始游戏"和"选择关卡"两个最高频操作，视觉清爽
 *   - 其他功能（基础设置 / 同步数据 / 排行榜 / 分享）做成右上角竖向图标条，
 *     仿照 iOS 控制中心的"功能集合"形态，节省横向空间又给每个功能独立入口
 *   - 不做"更多 ⋯ 菜单"折叠：单层操作直达比两次点击体验好
 *
 * 订阅 storage 变更：云端 bootstrap 晚到时自动刷新菜单文案与进度数。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { levels } from '../../config/levels';
import { attachClickSfx, showOverlay } from './shared';
import { showShareDialog } from './ShareDialog';

/**
 * 计算当前进度，用于在主菜单显示「下一关」与总览
 * - nextLevelId: 「开始游戏」按钮要进入的目标关卡
 * - cleared / total: 已通关数 / 总关卡数
 * - stars / starsMax: 累计星数 / 最大星数
 * - allCleared: 全部通关
 * - nick: 玩家昵称（云端 / 本地缓存的同步值），无昵称为 null
 */
function computeProgress(): {
  nextLevelId: number;
  nextLevel: (typeof levels)[number];
  cleared: number;
  total: number;
  stars: number;
  starsMax: number;
  allCleared: boolean;
  fresh: boolean; // 完全没玩过（新存档）
  nick: string | null;
} {
  let cleared = 0;
  let stars = 0;
  for (const lv of levels) {
    const r = storage.getRecord(lv.id);
    if (r?.cleared) {
      cleared++;
      stars += r.bestStars;
    }
  }
  // 第一个未通关且已解锁的关卡
  let nextId = levels[0].id;
  const found = levels.find((lv) => {
    const r = storage.getRecord(lv.id);
    return storage.isUnlocked(lv.id) && (!r || !r.cleared);
  });
  if (found) nextId = found.id;
  const allCleared = cleared >= levels.length;
  return {
    nextLevelId: allCleared ? levels[0].id : nextId,
    nextLevel: levels.find((l) => l.id === (allCleared ? levels[0].id : nextId)) ?? levels[0],
    cleared,
    total: levels.length,
    stars,
    starsMax: levels.length * 3,
    allCleared,
    fresh: cleared === 0,
    nick: storage.getNick(),
  };
}

/**
 * 根据进度状态拼欢迎语。
 *
 * 设计：
 *   - 无昵称：返回 null（保持原 UI 不变，不强行打扰）
 *   - fresh + 有昵称：    "你好，{nick}"（首次见面）
 *   - 全通关 + 有昵称：   "欢迎回来，{nick}"（亲切；100 关成就由进度行展示，避免重复）
 *   - 已通关 + 有昵称：   "欢迎回来，{nick}"
 *
 * 文案保持简洁；昵称 12 字上限已避免撑破窄屏布局。
 * 注意：返回的字符串最终通过 textContent 渲染，无需 HTML 转义；不要在调用方用 innerHTML。
 */
function buildGreeting(p: ReturnType<typeof computeProgress>): string | null {
  if (!p.nick) return null;
  if (p.fresh) return `你 好 · ${p.nick}`;
  return `欢 迎 回 来 · ${p.nick}`;
}

/**
 * 创建一个右上角竖条图标按钮。
 *
 * 抽成函数避免 4 段重复 DOM 创建逻辑。SVG 用 currentColor 跟随主题；
 * aria-label / title 提供语义；无文字标签纯图标，依赖排列顺序提供功能预期。
 */
function makeIconBtn(
  label: string,
  svgInner: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'menu-icon-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${svgInner}
    </svg>
  `;
  attachClickSfx(btn);
  btn.onclick = onClick;
  return btn;
}

export function showMainMenu(handlers: {
  onPlay: (levelId: number) => void;
  onSelectLevel: () => void;
  onLeaderboard: () => void;
  onBasicSettings: () => void;
  onSyncData: () => void;
}): void {
  audio.playBgm('bgm_menu', 800);
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';

  const card = document.createElement('div');
  card.className = 'scene-card';
  scene.appendChild(card);

  /**
   * 渲染主菜单卡片内容（仅 card 子节点，不动 scene 自身）。
   *
   * 每次 storage 变更都重新计算 progress 并重绘按钮文案/进度行：
   *   - 启动后 storage.bootstrapPromise 已 await，正常情况下首次渲染已是最新进度
   *   - 但慢网络/超时兜底下，云端进度可能在主菜单显示后才到 → 通过 onChange 兜底刷新
   */
  const renderCard = (): void => {
    const progress = computeProgress();
    card.innerHTML = `
      <div class="scene-title">晨 雾 迷 径</div>
      <div class="scene-subtitle">MISTY · PATH · DAWN</div>
    `;

    // 欢迎语：仅在玩家设置过昵称时显示。
    // 紧贴在主标题下方、副标题之上，作为"这是你的迷径"的个人化归属感标签。
    // 用 textContent 写入，天然防止昵称中的特殊字符（如 <、&）破坏 DOM 或触发 XSS。
    const greeting = buildGreeting(progress);
    if (greeting) {
      const titleEl = card.querySelector('.scene-title');
      const g = document.createElement('div');
      g.className = 'scene-greeting';
      g.textContent = greeting;
      titleEl?.insertAdjacentElement('afterend', g);
    }

    // 进度行
    const progressEl = document.createElement('div');
    progressEl.className = 'scene-progress';
    if (progress.allCleared) {
      progressEl.innerHTML = `
        <div class="progress-line main">已 全 部 通 关</div>
        <div class="progress-line sub">★ ${progress.stars} / ${progress.starsMax}</div>
      `;
    } else if (progress.fresh) {
      progressEl.innerHTML = `
        <div class="progress-line main">即 将 开 始 · ${progress.nextLevel.name}</div>
        <div class="progress-line sub">共 ${progress.total} 关 等 你 探 索</div>
      `;
    } else {
      progressEl.innerHTML = `
        <div class="progress-line main">下 一 关 · ${progress.nextLevel.name}</div>
        <div class="progress-line sub">已 通 关 ${progress.cleared} / ${progress.total} &nbsp;·&nbsp; ★ ${progress.stars} / ${progress.starsMax}</div>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${(progress.cleared / progress.total) * 100}%"></div></div>
      `;
    }
    card.appendChild(progressEl);

    // 主按钮组：仅 2 个最高频操作（开始 / 选关）
    const btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';

    const playBtn = document.createElement('button');
    playBtn.className = 'btn primary';
    let playLabel: string;
    if (progress.allCleared) {
      playLabel = '重 新 挑 战';
    } else if (progress.fresh) {
      playLabel = '开 始 游 戏';
    } else {
      playLabel = `继 续 · ${progress.nextLevel.name}`;
    }
    playBtn.textContent = playLabel;
    attachClickSfx(playBtn);
    playBtn.onclick = () => handlers.onPlay(progress.nextLevelId);

    const selectBtn = document.createElement('button');
    selectBtn.className = 'btn';
    selectBtn.textContent = '选 择 关 卡';
    attachClickSfx(selectBtn);
    selectBtn.onclick = () => handlers.onSelectLevel();

    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(selectBtn);
    card.appendChild(btnGroup);

    // === 右上角竖向图标条：4 个次要功能入口 ===
    // 顺序遵循"个性化 → 数据 → 社交"递进，让最常用的"基础设置"在最上面
    //   1. 基础设置（齿轮）
    //   2. 同步数据（云）
    //   3. 排行榜（奖杯）
    //   4. 分享（节点连线）
    const stack = document.createElement('div');
    stack.className = 'menu-icon-stack';

    stack.appendChild(
      makeIconBtn(
        '基础设置',
        // Feather settings：齿轮
        `<circle cx="12" cy="12" r="3"></circle>
         <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>`,
        handlers.onBasicSettings
      )
    );

    stack.appendChild(
      makeIconBtn(
        '同步数据',
        // Feather cloud：云朵
        `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>`,
        handlers.onSyncData
      )
    );

    stack.appendChild(
      makeIconBtn(
        '排行榜',
        // Feather award 简化：奖杯
        `<circle cx="12" cy="8" r="6"></circle>
         <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"></path>`,
        handlers.onLeaderboard
      )
    );

    stack.appendChild(
      makeIconBtn(
        '分享游戏',
        // Feather share-2：三个圆 + 连线
        `<circle cx="18" cy="5" r="3"></circle>
         <circle cx="6" cy="12" r="3"></circle>
         <circle cx="18" cy="19" r="3"></circle>
         <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
         <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>`,
        () => showShareDialog()
      )
    );

    card.appendChild(stack);
  };

  renderCard();
  showOverlay(scene);

  // 订阅 storage 变更：云端 bootstrap 晚到时自动刷新菜单
  // scene 从 DOM 卸载时取消订阅，避免内存泄漏
  const unsub = storage.onChange(renderCard);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(scene)) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

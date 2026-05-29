/**
 * 主菜单：标题 + 2 个按钮（开始/选关） + 右上角竖向 4 个图标。
 *
 * 设计原则：
 *   - 主按钮组只保留"开始游戏"和"选择关卡"两个最高频操作，视觉清爽
 *   - 其他功能（基础设置 / 同步数据 / 排行榜 / 分享）做成右上角竖向图标条，
 *     仿照 iOS 控制中心的"功能集合"形态，节省横向空间又给每个功能独立入口
 *   - 不做"更多 ⋯ 菜单"折叠：单层操作直达比两次点击体验好
 *   - 欢迎语 + 进度提示统一由 .scene-header（顶部红框区域）展示，
 *     卡片内只放"标题 + 副标题 + 主操作 + 图标条"，主次分明
 *
 * 订阅 storage 变更：云端 bootstrap 晚到时自动刷新菜单文案。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { levels } from '../../config/levels';
import { attachClickSfx, showOverlay } from './shared';
import { showShareDialog } from './ShareDialog';
import { attachSceneHeader } from './SceneHeader';

/**
 * 计算"下一关"目标：
 * - nextLevelId: 「开始游戏」按钮要进入的目标关卡
 * - nextLevel:   对应的关卡配置（用于按钮文案"继续 · {名}"）
 * - allCleared:  全部通关（按钮文案改为"重新挑战"）
 * - fresh:       完全没玩过（按钮文案改为"开始游戏"）
 */
function computeNext(): {
  nextLevelId: number;
  nextLevel: (typeof levels)[number];
  allCleared: boolean;
  fresh: boolean;
} {
  let cleared = 0;
  for (const lv of levels) {
    if (storage.getRecord(lv.id)?.cleared) cleared++;
  }
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
    allCleared,
    fresh: cleared === 0,
  };
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

  // 顶部 header：仅显示欢迎语（进度行已全局下线）
  attachSceneHeader(scene, { greeting: { kind: 'menu' } });

  const card = document.createElement('div');
  card.className = 'scene-card';
  scene.appendChild(card);

  /**
   * 渲染主菜单卡片内容（仅 card 子节点，不动 scene 自身）。
   *
   * 每次 storage 变更都重新计算 next 目标并重绘按钮文案：
   *   - 启动后 storage.bootstrapPromise 已 await，正常情况下首次渲染已是最新进度
   *   - 但慢网络/超时兜底下，云端进度可能在主菜单显示后才到 → 通过 onChange 兜底刷新
   */
  const renderCard = (): void => {
    const next = computeNext();
    card.innerHTML = `
      <div class="scene-title">晨 雾 迷 径</div>
      <div class="scene-subtitle">MISTY · PATH · DAWN</div>
    `;

    // 主按钮组：仅 2 个最高频操作（开始 / 选关）
    const btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';

    const playBtn = document.createElement('button');
    playBtn.className = 'btn primary';
    let playLabel: string;
    if (next.allCleared) {
      playLabel = '重 新 挑 战';
    } else if (next.fresh) {
      playLabel = '开 始 游 戏';
    } else {
      playLabel = `继 续 · ${next.nextLevel.name}`;
    }
    playBtn.textContent = playLabel;
    attachClickSfx(playBtn);
    playBtn.onclick = () => handlers.onPlay(next.nextLevelId);

    const selectBtn = document.createElement('button');
    selectBtn.className = 'btn';
    selectBtn.textContent = '选 择 关 卡';
    attachClickSfx(selectBtn);
    selectBtn.onclick = () => handlers.onSelectLevel();

    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(selectBtn);
    card.appendChild(btnGroup);
  };

  // === 屏幕右上角竖向图标条：4 个次要功能入口 ===
  // 顺序遵循"个性化 → 数据 → 社交"递进，让最常用的"基础设置"在最上面
  //   1. 基础设置（齿轮）
  //   2. 同步数据（云）
  //   3. 排行榜（奖杯）
  //   4. 分享（节点连线）
  //
  // 挂在 scene 而非 card 内：
  //   - 视觉锚定到屏幕右上角（safe-area-inset 适配刘海屏），与卡片解耦
  //   - 卡片大小/位置变化不影响入口位置
  //   - 创建一次即可，不随 storage 变更重建（图标行为固定）
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

  scene.appendChild(stack);

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


/**
 * 主菜单：标题 + 进度概览 + 三个按钮（开始/选关/设置）。
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
  };
}

export function showMainMenu(handlers: {
  onPlay: (levelId: number) => void;
  onSelectLevel: () => void;
  onLeaderboard: () => void;
  onSettings: () => void;
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

    const lbBtn = document.createElement('button');
    lbBtn.className = 'btn';
    lbBtn.textContent = '排 行 榜';
    attachClickSfx(lbBtn);
    lbBtn.onclick = () => handlers.onLeaderboard();

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn';
    settingsBtn.textContent = '设  置';
    attachClickSfx(settingsBtn);
    settingsBtn.onclick = () => handlers.onSettings();

    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(selectBtn);
    btnGroup.appendChild(lbBtn);
    btnGroup.appendChild(settingsBtn);
    card.appendChild(btnGroup);

    // 分享按钮：卡片右上角图标（次要操作，不抢主按钮的视觉焦点）
    // 仅图标，aria-label / title 提供语义；SVG 用 currentColor 跟随主题色
    const shareBtn = document.createElement('button');
    shareBtn.className = 'menu-icon-btn menu-share-btn';
    shareBtn.type = 'button';
    shareBtn.setAttribute('aria-label', '分享游戏');
    shareBtn.title = '分享游戏';
    shareBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3"></circle>
        <circle cx="6" cy="12" r="3"></circle>
        <circle cx="18" cy="19" r="3"></circle>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
      </svg>
    `;
    attachClickSfx(shareBtn);
    shareBtn.onclick = () => showShareDialog();
    card.appendChild(shareBtn);
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

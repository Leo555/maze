/**
 * 通关结算 / 失败页。
 *
 * 共享：星星点亮动画样式、按钮组结构。
 * 通关页还会在首次通关后引导用户保存同步进度（防丢失）。
 *
 * 头部 .scene-header（顶部红框区域）由 SceneHeader 通用组件提供：
 *   - 通关：欢迎语按 stars 切换"太棒了"/"继续加油" + 全局进度提示
 *   - 失败：欢迎语为"别灰心" + 全局进度提示
 * 卡片内不再渲染 .result-greeting，避免与 header 重复。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { formatTimePrecise } from '../../core/utils';
import { attachClickSfx, showOverlay } from './shared';
import { showBackupReminder } from './sync/QrDialog';
import { attachSceneHeader } from './SceneHeader';

export interface ResultData {
  levelId: number;
  time: number;
  steps: number;
  optimal: number;
  stars: number;
  isNewBest: boolean;
  hasNext: boolean;
}

export function showResult(
  data: ResultData,
  handlers: {
    onNext: () => void;
    onRetry: () => void;
    onMenu: () => void;
    /**
     * 可选：「查看最佳路径」入口。
     * Game 端在 steps > optimal（路径非最优）时才传入此回调，本页据此决定按钮可见性。
     */
    onShowOptimal?: () => void;
  }
): void {
  audio.playSfx('level_complete');

  const scene = document.createElement('div');
  scene.className = 'scene';

  // 顶部 header：根据星星数生成称呼语 + 全局进度
  attachSceneHeader(scene, { greeting: { kind: 'result', stars: data.stars } });

  const card = document.createElement('div');
  card.className = 'scene-card';

  const efficiency =
    data.optimal > 0 ? Math.min(100, Math.round((data.optimal / data.steps) * 100)) : 100;

  card.innerHTML = `
    <div class="scene-title">通  关</div>
    <div class="scene-subtitle">LEVEL ${data.levelId} CLEARED</div>
    <div class="stars-row">
      <span class="star" data-i="0">★</span>
      <span class="star" data-i="1">★</span>
      <span class="star" data-i="2">★</span>
    </div>
    <div class="result-stats">
      <div class="row"><span>用 时</span><span class="v">${formatTimePrecise(data.time)}</span></div>
      <div class="row"><span>步 数</span><span class="v">${data.steps}</span></div>
      <div class="row"><span>最 短 路 径</span><span class="v">${data.optimal}</span></div>
      <div class="row"><span>路 径 效 率</span><span class="v">${efficiency}%</span></div>
      ${data.isNewBest ? '<div class="row" style="color:#ffcb47;border:none"><span>NEW BEST!</span><span></span></div>' : ''}
    </div>
  `;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';

  if (data.hasNext) {
    const next = document.createElement('button');
    next.className = 'btn primary';
    next.textContent = '下 一 关';
    attachClickSfx(next);
    next.onclick = () => handlers.onNext();
    btnGroup.appendChild(next);
  }

  // 「查看最佳路径」：仅当路径非最优且 Game 提供回调时显示
  if (handlers.onShowOptimal) {
    const showOpt = document.createElement('button');
    showOpt.className = 'btn';
    showOpt.textContent = '查 看 最 佳 路 径';
    attachClickSfx(showOpt);
    showOpt.onclick = () => handlers.onShowOptimal!();
    btnGroup.appendChild(showOpt);
  }

  const retry = document.createElement('button');
  retry.className = 'btn';
  retry.textContent = '重  来';
  attachClickSfx(retry);
  retry.onclick = () => handlers.onRetry();

  const menu = document.createElement('button');
  menu.className = 'btn';
  menu.textContent = '主 菜 单';
  attachClickSfx(menu);
  menu.onclick = () => handlers.onMenu();

  btnGroup.appendChild(retry);
  btnGroup.appendChild(menu);
  card.appendChild(btnGroup);
  scene.appendChild(card);
  showOverlay(scene);

  // 星星依次点亮
  const stars = card.querySelectorAll<HTMLElement>('.star');
  stars.forEach((s, i) => {
    if (i < data.stars) {
      setTimeout(() => {
        s.classList.add('lit');
        audio.playSfx('star_rating', { rate: 1 + i * 0.15 });
      }, 400 + i * 250);
    }
  });

  // 首次通关后引导用户保存同步入口（防止换设备/清缓存导致进度丢失）。
  // 只触发一次，标记写入 localStorage；用户关掉对话框等同于"已知晓"。
  if (storage.shouldPromptBackup()) {
    storage.markBackupPrompted();
    // 等结算页星星动画走完再弹，避免视觉抢焦点
    setTimeout(() => {
      showBackupReminder(storage.getCode());
    }, 1500);
  }
}

export function showFail(
  reason: string,
  handlers: {
    onRetry: () => void;
    onMenu: () => void;
    /** 可选：「查看最佳路径」入口（失败时常显示，让玩家了解最优解） */
    onShowOptimal?: () => void;
  }
): void {
  audio.playSfx('level_fail');

  const scene = document.createElement('div');
  scene.className = 'scene';

  // 顶部 header：失败安慰语 + 全局进度（失败时让玩家看到自己整体已走多远，软化打击）
  attachSceneHeader(scene, { greeting: { kind: 'fail' } });

  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">失  败</div>
    <div class="scene-subtitle">${reason}</div>
  `;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';

  const retry = document.createElement('button');
  retry.className = 'btn primary';
  retry.textContent = '重  来';
  attachClickSfx(retry);
  retry.onclick = () => handlers.onRetry();

  if (handlers.onShowOptimal) {
    const showOpt = document.createElement('button');
    showOpt.className = 'btn';
    showOpt.textContent = '查 看 最 佳 路 径';
    attachClickSfx(showOpt);
    showOpt.onclick = () => handlers.onShowOptimal!();
    btnGroup.appendChild(showOpt);
  }

  const menu = document.createElement('button');
  menu.className = 'btn';
  menu.textContent = '主 菜 单';
  attachClickSfx(menu);
  menu.onclick = () => handlers.onMenu();

  btnGroup.appendChild(retry);
  btnGroup.appendChild(menu);
  card.appendChild(btnGroup);
  scene.appendChild(card);
  showOverlay(scene);
}


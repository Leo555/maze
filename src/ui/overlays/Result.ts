/**
 * 通关结算 / 失败页。
 *
 * 共享：星星点亮动画样式、按钮组结构。
 * 通关页还会在首次通关后引导用户保存同步进度（防丢失）。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { formatTimePrecise } from '../../core/utils';
import { attachClickSfx, showOverlay } from './shared';
import { showBackupReminder } from './sync/QrDialog';

export interface ResultData {
  levelId: number;
  time: number;
  steps: number;
  optimal: number;
  stars: number;
  isNewBest: boolean;
  hasNext: boolean;
}

/**
 * 根据通关表现 + 昵称生成称呼语。
 *
 * 设计：
 *   - 无昵称：返回 null，结算页保持原样（不强行打扰）
 *   - 有昵称 + 3 星：表扬性称呼
 *   - 有昵称 + ≤2 星：温和鼓励性称呼
 *
 * 文案保持简短；后续若需 A/B 调整文案放在这里集中改。
 */
function buildResultGreeting(stars: number, nick: string | null): string | null {
  if (!nick) return null;
  if (stars >= 3) return `太 棒 了 · ${nick}`;
  return `继 续 加 油 · ${nick}`;
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

  // 昵称称呼：插入到副标题与星星行之间，用 textContent 防昵称中的特殊字符破坏 DOM。
  // 与主菜单欢迎语形成呼应——玩家从命名到通关全程被"看见"。
  const greeting = buildResultGreeting(data.stars, storage.getNick());
  if (greeting) {
    const subtitle = card.querySelector('.scene-subtitle');
    const g = document.createElement('div');
    g.className = 'result-greeting';
    g.textContent = greeting;
    subtitle?.insertAdjacentElement('afterend', g);
  }

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
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">失  败</div>
    <div class="scene-subtitle">${reason}</div>
  `;

  // 失败页也显示昵称鼓励：失败时玩家心理压力较高，加一句轻量称呼能软化打击。
  const nick = storage.getNick();
  if (nick) {
    const subtitle = card.querySelector('.scene-subtitle');
    const g = document.createElement('div');
    g.className = 'result-greeting';
    g.textContent = `别 灰 心 · ${nick}`;
    subtitle?.insertAdjacentElement('afterend', g);
  }
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

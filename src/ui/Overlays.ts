/**
 * 主菜单 / 关卡选择 / 暂停 / 通关结算 / 设置
 *
 * 全部基于 #overlay 这个浮层 div 渲染
 * 用一组 buildXxx 函数返回 HTMLElement
 */

import { audio } from '../core/Audio';
import { storage } from '../core/Storage';
import { adoptAccount } from '../core/CloudSync';
import { showToast } from './Toast';
import {
  levels,
  CHAPTER_COUNT,
  LEVELS_PER_CHAPTER,
  getChapterOf,
} from '../config/levels';
import { themes } from '../config/theme';
import { formatTimePrecise } from '../core/utils';

const overlay = document.getElementById('overlay') as HTMLElement;

// hideOverlay 的延迟清理 timer。任何 showOverlay/clearOverlay 都要先把它取消，
// 否则会把刚渲染好的下一屏 UI 又清掉（典型场景：暂停页 onMenu 先 hideOverlay 后立即 gotoMenu）
let pendingHideTimer: number | null = null;

function cancelPendingHide(): void {
  if (pendingHideTimer !== null) {
    clearTimeout(pendingHideTimer);
    pendingHideTimer = null;
  }
}

function clearOverlay(): void {
  cancelPendingHide();
  overlay.innerHTML = '';
  overlay.classList.remove('active');
}

function showOverlay(node: HTMLElement, instant = false): void {
  clearOverlay();
  overlay.appendChild(node);
  overlay.classList.add('active');
  if (instant) {
    node.classList.add('show');
  } else {
    requestAnimationFrame(() => node.classList.add('show'));
  }
}

function attachClickSfx(btn: HTMLElement): void {
  btn.addEventListener('mouseenter', () => audio.playSfx('ui_hover'));
  btn.addEventListener('click', () => audio.playSfx('ui_click'));
}

// ==================== 主菜单 ====================
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

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn';
    settingsBtn.textContent = '设  置';
    attachClickSfx(settingsBtn);
    settingsBtn.onclick = () => handlers.onSettings();

    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(selectBtn);
    btnGroup.appendChild(settingsBtn);
    card.appendChild(btnGroup);
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

// ==================== 关卡选择 ====================
export function showLevelSelect(handlers: {
  /** 是否从游戏内进入：true 时「返回」回到当前关卡而非主菜单 */
  inGame?: boolean;
  onSelect: (levelId: number) => void;
  onBack: () => void;
}): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';
  const card = document.createElement('div');
  card.className = 'scene-card scene-card-wide';
  card.innerHTML = `
    <div class="scene-title">关  卡</div>
    <div class="scene-subtitle">SELECT YOUR JOURNEY</div>
  `;

  // 章节滚动容器：顶部章节标签栏（点击快速跳转） + 章节分组列表
  const navBar = document.createElement('div');
  navBar.className = 'chapter-nav';

  const list = document.createElement('div');
  list.className = 'chapter-list';

  // 找到一个合适的「初始焦点章节」：第一个未通关的关卡所在章节
  let focusChapter = 1;
  const firstUnplayed = levels.find((lv) => {
    const r = storage.getRecord(lv.id);
    return storage.isUnlocked(lv.id) && (!r || !r.cleared);
  });
  if (firstUnplayed) focusChapter = getChapterOf(firstUnplayed.id).index;

  // 章节分组渲染
  for (let ci = 1; ci <= CHAPTER_COUNT; ci++) {
    const chapterStart = (ci - 1) * LEVELS_PER_CHAPTER + 1;
    const chapterEnd = ci * LEVELS_PER_CHAPTER;
    const chapter = getChapterOf(chapterStart);
    const theme = themes[chapter.theme];

    // 该章节通关数 / 星数
    let chCleared = 0;
    let chStars = 0;
    for (let id = chapterStart; id <= chapterEnd; id++) {
      const r = storage.getRecord(id);
      if (r?.cleared) {
        chCleared++;
        chStars += r.bestStars;
      }
    }
    const chapterUnlocked = storage.isUnlocked(chapterStart);

    // 章节标签（顶部 nav）
    const navItem = document.createElement('button');
    navItem.className = 'chapter-nav-item';
    if (!chapterUnlocked) navItem.classList.add('locked');
    navItem.style.setProperty('--chapter-color', theme.exit);
    navItem.innerHTML = `
      <span class="ci">${ci}</span>
      <span class="cn">${chapter.name}</span>
    `;
    navItem.dataset.chapter = String(ci);
    attachClickSfx(navItem);
    navItem.onclick = () => {
      const target = list.querySelector<HTMLElement>(
        `[data-chapter-section="${ci}"]`
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    navBar.appendChild(navItem);

    // 章节分区
    const section = document.createElement('div');
    section.className = 'chapter-section';
    section.dataset.chapterSection = String(ci);
    if (!chapterUnlocked) section.classList.add('locked');

    const header = document.createElement('div');
    header.className = 'chapter-header';
    header.style.setProperty('--chapter-color', theme.exit);
    header.innerHTML = `
      <div class="chapter-title-row">
        <span class="ci">第 ${ci} 章</span>
        <span class="cn">${chapter.name}</span>
        <span class="cs">${chapter.subtitle}</span>
      </div>
      <div class="chapter-meta">
        ${
          chapterUnlocked
            ? `已通关 ${chCleared} / ${LEVELS_PER_CHAPTER} · ★ ${chStars} / ${LEVELS_PER_CHAPTER * 3}`
            : '🔒 通关上一章节解锁'
        }
      </div>
    `;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (let id = chapterStart; id <= chapterEnd; id++) {
      const lv = levels[id - 1];
      const tile = document.createElement('div');
      tile.className = 'level-tile';
      const unlocked = storage.isUnlocked(lv.id);
      if (!unlocked) tile.classList.add('locked');

      tile.style.background = theme.bg;
      tile.style.color = theme.hudFg;

      const record = storage.getRecord(lv.id);
      const stars = record?.bestStars ?? 0;
      const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);

      // 显示章内编号 ci-pos，更易于辨识；锁定时显示锁
      const pos = ((lv.id - 1) % LEVELS_PER_CHAPTER) + 1;
      tile.innerHTML = `
        <div class="num">${unlocked ? `${ci}-${pos}` : '🔒'}</div>
        <div class="name">${unlocked ? `Lv.${lv.id}` : ''}</div>
        <div class="stars">${unlocked && record ? starStr : ''}</div>
      `;
      if (unlocked) {
        attachClickSfx(tile);
        tile.onclick = () => handlers.onSelect(lv.id);
      }
      grid.appendChild(tile);
    }
    section.appendChild(grid);
    list.appendChild(section);
  }

  card.appendChild(navBar);
  card.appendChild(list);

  const back = document.createElement('button');
  back.className = 'btn';
  // 游戏中进入选关页：按钮文案改为「返回游戏」，更直观
  back.textContent = handlers.inGame ? '返 回 游 戏' : '返  回';
  attachClickSfx(back);
  back.onclick = () => handlers.onBack();
  const wrap = document.createElement('div');
  wrap.className = 'btn-group';
  wrap.appendChild(back);
  card.appendChild(wrap);

  scene.appendChild(card);
  showOverlay(scene);

  // 渲染后滚动到当前章节，让玩家立刻看到「下一关」附近
  requestAnimationFrame(() => {
    const target = list.querySelector<HTMLElement>(
      `[data-chapter-section="${focusChapter}"]`
    );
    target?.scrollIntoView({ behavior: 'auto', block: 'start' });
    navBar
      .querySelector<HTMLElement>(`[data-chapter="${focusChapter}"]`)
      ?.classList.add('active');
  });
}

// ==================== 暂停菜单 ====================
export function showPauseMenu(handlers: {
  onResume: () => void;
  onRestart: () => void;
  onSelectLevel: () => void;
  onMenu: () => void;
}): void {
  audio.playSfx('ui_open');
  audio.duckBgm(0.4, 200);

  const scene = document.createElement('div');
  scene.className = 'scene';
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">暂  停</div>
    <div class="scene-subtitle">PAUSED</div>
  `;
  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';

  const resume = document.createElement('button');
  resume.className = 'btn primary';
  resume.textContent = '继  续';
  attachClickSfx(resume);
  resume.onclick = () => {
    audio.unduckBgm(300);
    handlers.onResume();
  };

  const restart = document.createElement('button');
  restart.className = 'btn';
  restart.textContent = '重  来';
  attachClickSfx(restart);
  restart.onclick = () => {
    audio.unduckBgm(300);
    handlers.onRestart();
  };

  const select = document.createElement('button');
  select.className = 'btn';
  select.textContent = '选 择 关 卡';
  attachClickSfx(select);
  select.onclick = () => {
    audio.unduckBgm(300);
    handlers.onSelectLevel();
  };

  const menu = document.createElement('button');
  menu.className = 'btn';
  menu.textContent = '主 菜 单';
  attachClickSfx(menu);
  menu.onclick = () => handlers.onMenu();

  btnGroup.appendChild(resume);
  btnGroup.appendChild(restart);
  btnGroup.appendChild(select);
  btnGroup.appendChild(menu);
  card.appendChild(btnGroup);
  scene.appendChild(card);
  showOverlay(scene);
}

// ==================== 通关结算 ====================
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
}

// ==================== 失败 ====================
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

// ==================== 最佳路径观察模式 ====================
/**
 * 通关 / 失败后的「查看最佳路径」浮窗。
 *
 * 与其它 scene 不同，这个浮窗刻意做得轻量：
 *   - 不遮挡迷宫主视图（只占顶部一小条）
 *   - 不阻断 canvas 渲染（迷宫和最佳路径线都仍可见）
 *   - 仅展示提示 + 关闭按钮
 *
 * 关闭按钮调用 onClose，由 Game 切回 transition 状态并重新展示结算/失败页。
 */
export function showOptimalReview(
  data: { steps: number; optimal: number; passed: boolean; hasPlayerPath: boolean },
  onClose: () => void
): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene scene-review';

  const card = document.createElement('div');
  card.className = 'scene-card review-card';

  const efficiency =
    data.optimal > 0 ? Math.min(100, Math.round((data.optimal / data.steps) * 100)) : 100;
  const tip = data.passed
    ? `你走了 ${data.steps} 步 · 最优 ${data.optimal} 步 · 效率 ${efficiency}%`
    : `本关最优解：${data.optimal} 步`;

  // 图例：仅当玩家轨迹存在时显示蓝色项；最优路径始终显示
  const legendHtml = `
    <div class="review-legend">
      <span class="legend-item">
        <span class="legend-dot legend-dot-best"></span>最 佳 路 径
      </span>
      ${
        data.hasPlayerPath
          ? `<span class="legend-item">
               <span class="legend-dot legend-dot-player"></span>你 的 轨 迹
             </span>`
          : ''
      }
    </div>
  `;

  card.innerHTML = `
    <div class="scene-title">最 佳 路 径</div>
    <div class="scene-subtitle">${tip}</div>
    ${legendHtml}
  `;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';
  const back = document.createElement('button');
  back.className = 'btn primary';
  back.textContent = '返 回 结 算';
  attachClickSfx(back);
  back.onclick = () => onClose();
  btnGroup.appendChild(back);
  card.appendChild(btnGroup);

  scene.appendChild(card);
  showOverlay(scene);
}

// ==================== 设置 ====================
export function showSettings(onBack: () => void): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">设  置</div>
    <div class="scene-subtitle">SETTINGS</div>
  `;

  const settings = audio.getSettings();
  const sliders: Array<{ key: 'master' | 'sfx' | 'bgm'; label: string }> = [
    { key: 'master', label: '主音量' },
    { key: 'sfx', label: '音效' },
    { key: 'bgm', label: '音乐' },
  ];

  for (const s of sliders) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <label>${s.label}</label>
      <input type="range" min="0" max="100" value="${Math.round(settings[s.key] * 100)}" />
      <span class="val">${Math.round(settings[s.key] * 100)}%</span>
    `;
    const input = row.querySelector('input') as HTMLInputElement;
    const val = row.querySelector('.val') as HTMLElement;
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10) / 100;
      val.textContent = `${input.value}%`;
      if (s.key === 'master') audio.setMaster(v);
      if (s.key === 'sfx') audio.setSfx(v);
      if (s.key === 'bgm') audio.setBgm(v);
    });
    input.addEventListener('change', () => audio.playSfx('ui_click'));
    card.appendChild(row);
  }

  // 重置存档
  const resetRow = document.createElement('div');
  resetRow.className = 'settings-row';
  resetRow.innerHTML = `<label>存档</label>`;
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.style.flex = '1';
  resetBtn.textContent = '清 除 通 关 记 录';
  attachClickSfx(resetBtn);
  resetBtn.onclick = () => {
    if (confirm('确定要清除所有通关记录吗？此操作不可恢复。')) {
      storage.reset();
      showToast('已清除通关记录', 'success');
    }
  };
  resetRow.appendChild(resetBtn);
  card.appendChild(resetRow);

  // === 同步进度面板（云端关联状态 + 编号显示 + 输入码恢复） ===
  card.appendChild(buildSyncPanel());

  const back = document.createElement('button');
  back.className = 'btn primary';
  back.textContent = '返  回';
  back.style.marginTop = '20px';
  attachClickSfx(back);
  back.onclick = () => onBack();
  card.appendChild(back);

  scene.appendChild(card);
  showOverlay(scene);
}

// ==================== 同步进度面板（嵌入设置页） ====================
/**
 * 构造「同步进度」面板，加在设置页里。
 *
 * 两个状态维度：
 *   - linkedCode：用户已知的编号（含输入恢复后保存）
 *   - cloudCode：本机可写云端的身份（首次通关后自动 init）
 *
 * 状态决策：
 *   1. linkedCode + cloudCode → 已注册账号（编号 + 二维码 + 退出当前账号）
 *   2. linkedCode + 没 cloudCode → 只读恢复模式（输入了别人的编号）
 *   3. 都没有 → 还没玩过 / 未通关（引导通关后自动生成编号）
 */
function buildSyncPanel(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-sync';

  const render = (): void => {
    wrap.innerHTML = '';
    const linkedCode = storage.getLinkedCode();
    const cloudCode = storage.getCloudCode();

    // 标题行
    const title = document.createElement('div');
    title.className = 'sync-title';
    title.textContent = '同步进度';
    wrap.appendChild(title);

    if (linkedCode && cloudCode) {
      // === 状态 1：已注册账号（本机能写云端）===
      const codeRow = document.createElement('div');
      codeRow.className = 'sync-code-row';
      codeRow.innerHTML = `
        <div class="sync-code-label">我的同步编号</div>
        <div class="sync-code-value">${linkedCode}</div>
      `;
      wrap.appendChild(codeRow);

      const tip = document.createElement('div');
      tip.className = 'sync-tip';
      tip.textContent = '通关进度自动同步到云端；其他设备输入此编号或扫码即可绑定到同一账号';
      wrap.appendChild(tip);

      const btnRow = document.createElement('div');
      btnRow.className = 'sync-btn-row';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn';
      copyBtn.textContent = '复 制 编 号';
      attachClickSfx(copyBtn);
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(linkedCode);
          copyBtn.textContent = '已 复 制 ✓';
          setTimeout(() => (copyBtn.textContent = '复 制 编 号'), 1500);
        } catch {
          showToast(`你的同步编号：${linkedCode}\n请手动长按复制`, 'info', 4000);
        }
      };
      btnRow.appendChild(copyBtn);

      const inputBtn = document.createElement('button');
      inputBtn.className = 'btn';
      inputBtn.textContent = '绑 定 其 他 编 号';
      attachClickSfx(inputBtn);
      inputBtn.onclick = () => promptCodeAndPull(render);
      btnRow.appendChild(inputBtn);

      wrap.appendChild(btnRow);

      // 二维码按钮（独占一行）
      const qrBtn = document.createElement('button');
      qrBtn.className = 'btn sync-qr';
      qrBtn.textContent = '生 成 同 步 二 维 码';
      attachClickSfx(qrBtn);
      qrBtn.onclick = () => showQrDialog(linkedCode);
      wrap.appendChild(qrBtn);

      const unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'btn sync-unlink';
      unlinkBtn.textContent = '退 出 当 前 账 号';
      attachClickSfx(unlinkBtn);
      unlinkBtn.onclick = async () => {
        const confirmMsg =
          '退出后，本机将不再自动同步到云端（云端数据保留 1 年）。下次输入编号可再次找回。是否继续？';
        if (!confirm(confirmMsg)) return;
        try {
          await fetch('/api/account/logout', { credentials: 'include' });
        } catch {
          /* ignore */
        }
        storage.unlinkCode();
      };
      wrap.appendChild(unlinkBtn);
    } else if (linkedCode) {
      // === 状态 2：只读恢复模式（用户输了别人的编号但没自己的账号）===
      const codeRow = document.createElement('div');
      codeRow.className = 'sync-code-row';
      codeRow.innerHTML = `
        <div class="sync-code-label">已恢复编号（只读）</div>
        <div class="sync-code-value">${linkedCode}</div>
      `;
      wrap.appendChild(codeRow);

      const tip = document.createElement('div');
      tip.className = 'sync-tip';
      tip.textContent = '本机进度不会上传到此编号；通关 1 关后会自动生成你自己的编号';
      wrap.appendChild(tip);

      const inputBtn = document.createElement('button');
      inputBtn.className = 'btn primary';
      inputBtn.textContent = '绑 定 其 他 编 号';
      inputBtn.style.width = '100%';
      attachClickSfx(inputBtn);
      inputBtn.onclick = () => promptCodeAndPull(render);
      wrap.appendChild(inputBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn sync-unlink';
      clearBtn.textContent = '清 除 已 恢 复 编 号';
      attachClickSfx(clearBtn);
      clearBtn.onclick = () => {
        if (!confirm('清除当前编号？本机进度仍保留。')) return;
        storage.unlinkCode();
      };
      wrap.appendChild(clearBtn);
    } else {
      // === 状态 3：还没账号 ===
      const tip = document.createElement('div');
      tip.className = 'sync-tip';
      tip.textContent = '通关第 1 关后会自动生成你的同步编号；或输入已有编号恢复进度';
      wrap.appendChild(tip);

      const recoverBtn = document.createElement('button');
      recoverBtn.className = 'btn primary';
      recoverBtn.textContent = '绑 定 已 有 编 号';
      recoverBtn.style.width = '100%';
      attachClickSfx(recoverBtn);
      recoverBtn.onclick = () => promptCodeAndPull(render);
      wrap.appendChild(recoverBtn);
    }
  };

  render();
  // 订阅 storage 变更：拉取/合并完成后自动刷新面板
  const unsub = storage.onChange(render);
  // 当面板从 DOM 卸载时取消订阅，避免内存泄漏
  const observer = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return wrap;
}

/**
 * 弹窗输入编号 → 把对应账号绑定到本机（adopt 语义）
 *   - 后端把该账号当前 token 通过 cookie 下发给本机
 *   - 本地存档直接替换为该账号云端版本
 *   - 后续通关写云端就是写到这个账号上，多端共享
 */
async function promptCodeAndPull(refresh: () => void): Promise<void> {
  // prompt 仍保留：toast 是单向提示，不能输入；输入仍需 prompt 阻塞调用
  const code = prompt('请输入 8 位同步编号：');
  if (!code) return;
  const trimmed = code.trim();
  if (!/^\d{8}$/.test(trimmed)) {
    showToast('编号格式错误，必须是 8 位数字', 'error');
    return;
  }
  const me = await adoptAccount(trimmed);
  if (!me) {
    showToast('未找到该编号或操作过于频繁', 'error', 2400);
    return;
  }
  storage.adoptRemoteAccount(me.code, me.progress);
  showToast(`已切换到编号 ${me.code} 的进度`, 'success', 2400);
  refresh();
}

/**
 * 弹出二维码对话框：手机扫码即可在另一设备自动恢复进度。
 *
 * 二维码内容设计：`https://maze.lz5z.com/?recover={code}`
 *   - 单一 URL，扫码后浏览器直接打开
 *   - main.ts 启动时检测 ?recover= 参数 → 自动调 sync 拉取并合并
 *   - 8 位数字 URL 短，QR 模块少，扫码识别成功率最高
 *
 * 离线生成：用 qrcode-generator 库本地算出 SVG，无任何网络请求。
 */
function showQrDialog(code: string): void {
  // 用独立 modal 层叠在设置页之上，关闭只移除自身，不影响背后的设置页。
  // 不调 showOverlay（那个会 clearOverlay 把设置页清空，关闭时就只剩白屏）。
  const url = `${location.origin}/?recover=${encodeURIComponent(code)}`;
  void import('./Qr').then(({ generateQrSvg }) => {
    const svg = generateQrSvg(url, 240);

    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    const card = document.createElement('div');
    card.className = 'scene-card scene-card-qr';
    card.innerHTML = `
      <div class="scene-title">同 步 二 维 码</div>
      <div class="scene-subtitle">SYNC QR CODE</div>
      <div class="qr-wrap">${svg}</div>
      <div class="qr-tip">
        在另一台设备的浏览器扫描此二维码，<br>
        即可自动恢复进度
      </div>
      <div class="qr-code-tag">编号：<strong>${code}</strong></div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn primary';
    closeBtn.textContent = '关 闭';
    closeBtn.style.width = '100%';
    closeBtn.style.marginTop = '14px';
    attachClickSfx(closeBtn);

    // 自定义关闭：移除 modal 自身，触发音效
    const closeModal = (): void => {
      audio.playSfx('ui_close');
      modal.classList.remove('show');
      // 等过渡动画结束后移除节点
      setTimeout(() => modal.remove(), 280);
    };
    closeBtn.onclick = closeModal;
    card.appendChild(closeBtn);

    // 点击 modal 蒙层（不是卡片）也关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.appendChild(card);
    overlay.appendChild(modal);
    // 触发入场动画（next frame 才能让浏览器先 paint 初始状态）
    requestAnimationFrame(() => modal.classList.add('show'));
  });
}

export function hideOverlay(): void {
  const child = overlay.querySelector('.scene');
  if (child) {
    audio.playSfx('ui_close');
    child.classList.remove('show');
    cancelPendingHide();
    pendingHideTimer = window.setTimeout(() => {
      pendingHideTimer = null;
      clearOverlay();
    }, 350);
  } else {
    clearOverlay();
  }
}

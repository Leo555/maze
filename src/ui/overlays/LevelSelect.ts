/**
 * 关卡选择页：章节导航 + 章节分组 + 关卡格子。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import {
  levels,
  CHAPTER_COUNT,
  LEVELS_PER_CHAPTER,
  getChapterOf,
} from '../../config/levels';
import { themes } from '../../config/theme';
import { attachClickSfx, showOverlay } from './shared';

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

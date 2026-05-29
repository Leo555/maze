/**
 * 排行榜面板
 *
 * 两个 tab：
 *   - 综合榜：按 (通关数, 总星数) 倒排
 *   - 关卡榜：选某一关，按 bestTime 升序
 *
 * 自己一行高亮，便于在长榜中快速定位。
 *
 * 动态加载（不进 main bundle）：仅在用户点"排行榜"按钮时按需 chunk。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { fetchOverallTop, fetchLevelTop } from '../../core/CloudSync';
import { levels } from '../../config/levels';
import { attachClickSfx, showOverlay } from './shared';
import { maskCode, type OverallRankItem, type LevelRankItem } from '../../../shared/types';
import { formatTime } from '../../core/utils';

type Tab = 'overall' | 'level';

const TOP_LIMIT = 50;

/** 渲染单条记录（综合 / 单关共用骨架，按 type 切换右侧字段） */
function renderRow(
  rank: number,
  code: string,
  nick: string | null,
  rightHtml: string,
  isMe: boolean
): HTMLElement {
  const li = document.createElement('div');
  li.className = 'lb-row' + (isMe ? ' me' : '');
  // 名次徽章：1/2/3 用金银铜，其他用淡灰
  const badgeCls =
    rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const display = nick && nick.length > 0 ? escapeHtml(nick) : maskCode(code);
  li.innerHTML = `
    <span class="lb-rank ${badgeCls}">${rank}</span>
    <span class="lb-name">${display}${isMe ? ' <em class="lb-me-tag">我</em>' : ''}</span>
    <span class="lb-right">${rightHtml}</span>
  `;
  return li;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmpty(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lb-empty';
  el.textContent = text;
  return el;
}

function renderLoading(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lb-empty lb-loading';
  el.textContent = '加载中...';
  return el;
}

export function showLeaderboard(onBack: () => void): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';

  const card = document.createElement('div');
  card.className = 'scene-card scene-card-wide scene-card-leaderboard';
  card.innerHTML = `
    <div class="scene-title">排 行 榜</div>
    <div class="scene-subtitle">LEADERBOARD</div>
  `;

  // tab 切换
  const tabs = document.createElement('div');
  tabs.className = 'lb-tabs';
  const tabOverall = document.createElement('button');
  tabOverall.className = 'lb-tab active';
  tabOverall.type = 'button';
  tabOverall.textContent = '综 合 榜';
  const tabLevel = document.createElement('button');
  tabLevel.className = 'lb-tab';
  tabLevel.type = 'button';
  tabLevel.textContent = '关 卡 榜';
  attachClickSfx(tabOverall);
  attachClickSfx(tabLevel);
  tabs.appendChild(tabOverall);
  tabs.appendChild(tabLevel);
  card.appendChild(tabs);

  // 关卡选择条（仅 level tab 下显示）：所有 100 关都可看（榜单是公共的）
  const levelPicker = document.createElement('select');
  levelPicker.className = 'lb-level-picker';
  for (const lv of levels) {
    const opt = document.createElement('option');
    opt.value = String(lv.id);
    opt.textContent = `第 ${lv.id} 关 · ${lv.name}`;
    levelPicker.appendChild(opt);
  }
  // 初始选中：玩家当前进度的下一关，没玩过则第一关
  const myUnlocked = (() => {
    // 用 storage 推断当前进度（不暴露 API，间接通过 records 数）
    let max = 1;
    for (const lv of levels) {
      const r = storage.getRecord(lv.id);
      if (r?.cleared) max = Math.max(max, lv.id);
    }
    return max;
  })();
  levelPicker.value = String(Math.min(myUnlocked, levels.length));
  levelPicker.style.display = 'none';
  card.appendChild(levelPicker);

  // 列表容器
  const list = document.createElement('div');
  list.className = 'lb-list';
  card.appendChild(list);

  // 自己 / 我的位置说明
  const meHint = document.createElement('div');
  meHint.className = 'lb-me-hint';
  card.appendChild(meHint);

  // 返回
  const backBtn = document.createElement('button');
  backBtn.className = 'btn primary lb-back';
  backBtn.textContent = '返  回';
  attachClickSfx(backBtn);
  backBtn.onclick = () => onBack();
  card.appendChild(backBtn);

  // ============ 数据加载 ============
  let currentTab: Tab = 'overall';
  // 简单缓存：key=`overall` 或 `lvl:{id}`，value 是已拉到的 items
  const cache = new Map<string, OverallRankItem[] | LevelRankItem[]>();

  const myCode = storage.getCode();

  /** 把 list 重渲染为指定的 items */
  const renderList = (kind: Tab, items: OverallRankItem[] | LevelRankItem[]): void => {
    list.innerHTML = '';
    if (items.length === 0) {
      list.appendChild(renderEmpty('暂无记录'));
      meHint.textContent = '';
      return;
    }
    let myRank: number | null = null;
    for (const it of items) {
      const isMe = it.code === myCode;
      if (isMe && myRank === null) myRank = it.rank;
      if (kind === 'overall') {
        const o = it as OverallRankItem;
        list.appendChild(
          renderRow(
            o.rank,
            o.code,
            o.nick,
            `<span class="lb-cleared">${o.cleared} 关</span><span class="lb-stars">★ ${o.stars}</span>`,
            isMe
          )
        );
      } else {
        const l = it as LevelRankItem;
        list.appendChild(
          renderRow(
            l.rank,
            l.code,
            l.nick,
            `<span class="lb-time">${formatTime(l.bestTime)}</span><span class="lb-stars">★ ${l.bestStars}</span>`,
            isMe
          )
        );
      }
    }
    meHint.textContent = myRank
      ? `你目前排名第 ${myRank} 位${myRank > 3 ? '，继续努力！' : ''}`
      : '你还未上榜，去通关解锁排名吧';
  };

  const loadOverall = async (): Promise<void> => {
    const key = 'overall';
    const cached = cache.get(key);
    if (cached) {
      renderList('overall', cached as OverallRankItem[]);
      return;
    }
    list.innerHTML = '';
    list.appendChild(renderLoading());
    const items = await fetchOverallTop(TOP_LIMIT);
    cache.set(key, items);
    if (currentTab === 'overall') renderList('overall', items);
  };

  const loadLevel = async (id: number): Promise<void> => {
    const key = `lvl:${id}`;
    const cached = cache.get(key);
    if (cached) {
      renderList('level', cached as LevelRankItem[]);
      return;
    }
    list.innerHTML = '';
    list.appendChild(renderLoading());
    const items = await fetchLevelTop(id, TOP_LIMIT);
    cache.set(key, items);
    if (currentTab === 'level' && String(id) === levelPicker.value) {
      renderList('level', items);
    }
  };

  const switchTab = (next: Tab): void => {
    if (next === currentTab) return;
    currentTab = next;
    tabOverall.classList.toggle('active', next === 'overall');
    tabLevel.classList.toggle('active', next === 'level');
    levelPicker.style.display = next === 'level' ? '' : 'none';
    if (next === 'overall') {
      void loadOverall();
    } else {
      void loadLevel(Number(levelPicker.value));
    }
  };

  tabOverall.onclick = () => switchTab('overall');
  tabLevel.onclick = () => switchTab('level');
  levelPicker.onchange = () => {
    if (currentTab === 'level') void loadLevel(Number(levelPicker.value));
  };

  // 初始加载综合榜
  void loadOverall();

  scene.appendChild(card);
  showOverlay(scene);
}

/**
 * 排行榜独立页入口（不进游戏 main bundle）。
 *
 * 与游戏内浮层版（已删除的 src/ui/overlays/Leaderboard.ts）的区别：
 *   - 独立 HTML 入口 /leaderboard.html，访问 /leaderboard 自动 rewrite
 *   - 不加载游戏 canvas / Audio / Game / Storage，零游戏运行时开销
 *   - 不依赖 storage 单例，仅从 localStorage 直读 maze_code 用于"高亮我"
 *   - 独立 SEO（title/og/canonical），可被搜索引擎收录、独立分享
 *
 * 复用模块：
 *   - shared/types：isValidCode / maskCode / 排行榜类型
 *   - core/CloudSync：fetchOverallTop / fetchLevelTop（仅依赖 shared/types，可独立）
 *   - config/levels：levels 数组（用于关卡选择下拉）
 */

import './leaderboard.css';
import { fetchOverallTop, fetchLevelTop } from '../core/CloudSync';
import { levels } from '../config/levels';
import {
  type OverallRankItem,
  type LevelRankItem,
  isValidCode,
  isValidNick,
} from '../../shared/types';
import { formatTime } from '../core/utils';

const CODE_KEY = 'maze_code';
const NICK_KEY = 'maze_nick';
const TOP_LIMIT = 50;

type Tab = 'overall' | 'level';

// =====================================================================
// 工具
// =====================================================================

function getMyCode(): string {
  try {
    const v = localStorage.getItem(CODE_KEY);
    return v && isValidCode(v) ? v : '';
  } catch {
    return '';
  }
}

/**
 * 从本地缓存读取昵称（兜底）。
 *
 * 此页有意不加载 storage 单例（保持独立 bundle 的瘦身设计），
 * 所以直接从 localStorage 读 maze_nick；用 isValidNick 防御历史脏数据。
 *
 * 优先级：榜单 API 返回的 nick > 本地缓存。前者用于已上榜玩家，后者用于未上榜玩家。
 */
function getMyLocalNick(): string | null {
  try {
    const v = localStorage.getItem(NICK_KEY);
    return v && isValidNick(v) ? v : null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =====================================================================
// 渲染
// =====================================================================

const root = document.getElementById('lb-root') as HTMLElement;
const myCode = getMyCode();

// 简单缓存：避免切换 tab 反复 fetch
const cache = new Map<string, OverallRankItem[] | LevelRankItem[]>();

let currentTab: Tab = 'overall';
let currentLevelId = 1;

function renderShell(): void {
  // 初始化关卡选项 HTML（一次性生成，避免每次 render 重建）
  const levelOptions = levels
    .map(
      (lv) =>
        `<option value="${lv.id}">第 ${lv.id} 关 · ${escapeHtml(lv.name)}</option>`
    )
    .join('');

  root.innerHTML = `
    <header class="lb-header">
      <a class="lb-back-link" href="/" aria-label="返回游戏">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>返回游戏</span>
      </a>
      <h1 class="lb-page-title">排 行 榜</h1>
      <div class="lb-page-sub">LEADERBOARD</div>
    </header>

    <main class="lb-main">
      <div class="lb-tabs">
        <button class="lb-tab active" data-tab="overall" type="button">综 合 榜</button>
        <button class="lb-tab" data-tab="level" type="button">关 卡 榜</button>
      </div>

      <select class="lb-level-picker" style="display:none;">
        ${levelOptions}
      </select>

      <div id="lb-list" class="lb-list"></div>

      <div id="lb-me-hint" class="lb-me-hint"></div>
    </main>

    <footer class="lb-footer">
      <p class="lb-footer-tip">
        想要上榜？<a href="/">立即开始游戏</a> 通关解锁排名
      </p>
    </footer>
  `;

  // tab 切换
  root.querySelectorAll<HTMLButtonElement>('.lb-tab').forEach((btn) => {
    btn.onclick = (): void => switchTab(btn.dataset.tab as Tab);
  });

  // 关卡选择
  const picker = root.querySelector<HTMLSelectElement>('.lb-level-picker');
  if (picker) {
    // 初始选中：玩家上次玩过的最大关卡 / 没有则第 1 关
    const myLastUnlocked = (() => {
      try {
        const raw = localStorage.getItem('maze_save');
        if (!raw) return 1;
        const obj = JSON.parse(raw) as { unlocked?: number };
        const u = obj.unlocked;
        if (typeof u === 'number' && u > 1) {
          // unlocked 是"下一个待玩关卡"，所以"刚刚通关的"是 u-1
          return Math.min(Math.max(1, u - 1), levels.length);
        }
        return 1;
      } catch {
        return 1;
      }
    })();
    picker.value = String(myLastUnlocked);
    currentLevelId = myLastUnlocked;
    picker.onchange = (): void => {
      currentLevelId = Number(picker.value) || 1;
      void loadLevel(currentLevelId);
    };
  }
}

function renderRow(
  rank: number,
  nick: string | null,
  rightHtml: string,
  isMe: boolean
): string {
  const badgeCls =
    rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  // 未设昵称的玩家：以排名做匿名标签（不再泄露 code 任何形态）
  const display = nick && nick.length > 0 ? escapeHtml(nick) : `匿 名 旅 人 #${rank}`;
  return `
    <div class="lb-row${isMe ? ' me' : ''}">
      <span class="lb-rank ${badgeCls}">${rank}</span>
      <span class="lb-name">${display}${isMe ? ' <em class="lb-me-tag">我</em>' : ''}</span>
      <span class="lb-right">${rightHtml}</span>
    </div>
  `;
}

function renderList(kind: Tab, items: OverallRankItem[] | LevelRankItem[]): void {
  const list = document.getElementById('lb-list') as HTMLElement;
  const meHint = document.getElementById('lb-me-hint') as HTMLElement;

  if (items.length === 0) {
    list.innerHTML = `<div class="lb-empty">暂无记录</div>`;
    meHint.textContent = '';
    return;
  }

  let myRank: number | null = null;
  // 已上榜玩家：榜单 API 返回的 nick 是云端权威值，优先采用
  let myNickFromList: string | null = null;
  const rows: string[] = [];
  for (const it of items) {
    // isMe 由后端比对 ?me=<myCode> 后下发，前端无 code 可比、零暴露
    if (it.isMe) {
      if (myRank === null) myRank = it.rank;
      if (it.nick && isValidNick(it.nick)) myNickFromList = it.nick;
    }
    if (kind === 'overall') {
      const o = it as OverallRankItem;
      rows.push(
        renderRow(
          o.rank,
          o.nick,
          `<span class="lb-cleared">${o.cleared} 关</span><span class="lb-stars">★ ${o.stars}</span>`,
          o.isMe
        )
      );
    } else {
      const l = it as LevelRankItem;
      rows.push(
        renderRow(
          l.rank,
          l.nick,
          `<span class="lb-time">${formatTime(l.bestTime)}</span><span class="lb-stars">★ ${l.bestStars}</span>`,
          l.isMe
        )
      );
    }
  }
  list.innerHTML = rows.join('');

  // me-hint 文案：根据"是否上榜 + 是否有昵称"四种组合给个性化提示
  // 用 textContent 渲染，防止昵称中的特殊字符触发 XSS
  if (myCode) {
    const myNick = myNickFromList ?? getMyLocalNick();
    const prefix = myNick ? `${myNick}，` : '';
    meHint.textContent = myRank
      ? `${prefix}你目前排名第 ${myRank} 位${myRank > 3 ? '，继续努力！' : ''}`
      : `${prefix}你还未上榜，去通关解锁排名吧`;
  } else {
    meHint.textContent = '';
  }
}

function renderLoading(): void {
  const list = document.getElementById('lb-list') as HTMLElement;
  list.innerHTML = `<div class="lb-empty lb-loading">加载中...</div>`;
}

async function loadOverall(): Promise<void> {
  const key = 'overall';
  const cached = cache.get(key);
  if (cached) {
    renderList('overall', cached as OverallRankItem[]);
    return;
  }
  renderLoading();
  // 把自己的 code 透传给后端用于打 isMe 标记；缺失时榜单仍然能拉但所有 isMe=false
  const items = await fetchOverallTop(TOP_LIMIT, myCode || undefined);
  cache.set(key, items);
  if (currentTab === 'overall') renderList('overall', items);
}

async function loadLevel(id: number): Promise<void> {
  const key = `lvl:${id}`;
  const cached = cache.get(key);
  if (cached) {
    renderList('level', cached as LevelRankItem[]);
    return;
  }
  renderLoading();
  const items = await fetchLevelTop(id, TOP_LIMIT, myCode || undefined);
  cache.set(key, items);
  // 异步返回时若用户已切换 tab/关卡，丢弃本次结果
  if (currentTab === 'level' && id === currentLevelId) {
    renderList('level', items);
  }
}

function switchTab(next: Tab): void {
  if (next === currentTab) return;
  currentTab = next;
  root.querySelectorAll<HTMLButtonElement>('.lb-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === next);
  });
  const picker = root.querySelector<HTMLSelectElement>('.lb-level-picker');
  if (picker) picker.style.display = next === 'level' ? '' : 'none';

  if (next === 'overall') {
    void loadOverall();
  } else {
    void loadLevel(currentLevelId);
  }
}

// =====================================================================
// 启动
// =====================================================================

renderShell();
void loadOverall();

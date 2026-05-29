/**
 * 后台管理入口（独立 bundle，不进游戏 main chunk）
 *
 * 功能：
 *   - 登录：输入 admin token，存 sessionStorage（关闭浏览器即失效）
 *   - tab 1 大盘：总用户 / 7 天 DAU / 各关通过人数
 *   - tab 2 用户列表：综合榜倒排分页，点击单行查看详情
 *
 * 鉴权：所有 /api/admin/* 请求都把 token 放 ?token= 上
 *      （后端 timing-safe 比较 ADMIN_CODE 环境变量）
 *
 * 设计原则：与游戏体验解耦——独立 HTML、独立 styles、最简 inline CSS，
 * 不引入主 bundle 的 styles.css，避免不相关样式污染后台。
 */

import './admin.css';
import { isValidCode, maskCode, type SaveData } from '../../shared/types';

const TOKEN_KEY = 'maze_admin_token';

// =====================================================================
// 类型
// =====================================================================

interface StatsResponse {
  totalUsers: number;
  dau: { day: string; count: number }[];
  levelClears: { levelId: number; cleared: number }[];
}

interface UserRow {
  rank: number;
  code: string;
  nick: string | null;
  cleared: number;
  stars: number;
  updatedAt: number | null;
  firstSeen: number | null;
}

interface UsersResponse {
  offset: number;
  limit: number;
  items: UserRow[];
}

interface UserDetailResponse {
  code: string;
  nick: string | null;
  progress: SaveData;
  updatedAt: number | null;
  firstSeen: number | null;
  rank: number | null;
}

// =====================================================================
// API 调用
// =====================================================================

function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(t: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function callApi<T>(path: string): Promise<T | { error: string; status: number }> {
  const token = getToken();
  if (!token) return { error: 'no_token', status: 401 };
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${path}${sep}token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    if (res.status !== 200) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: data.error || 'http_error', status: res.status };
    }
    return (await res.json()) as T;
  } catch {
    return { error: 'network', status: 0 };
  }
}

// =====================================================================
// 渲染
// =====================================================================

const root = document.getElementById('admin-root') as HTMLElement;

/** 时间戳格式化（本地时区 yyyy-mm-dd HH:MM）*/
function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- 登录页 ----------

function renderLogin(errorMsg?: string): void {
  root.innerHTML = `
    <div class="admin-login">
      <h1>后台管理</h1>
      <p class="admin-tip">请输入管理员 token（部署时配置在 ADMIN_CODE 环境变量）</p>
      <input type="password" id="admin-token-input" placeholder="ADMIN_CODE" autocomplete="off" />
      <button id="admin-login-btn" type="button">登 录</button>
      ${errorMsg ? `<p class="admin-error">${escapeHtml(errorMsg)}</p>` : ''}
    </div>
  `;
  const input = root.querySelector('#admin-token-input') as HTMLInputElement;
  const btn = root.querySelector('#admin-login-btn') as HTMLButtonElement;
  input.focus();
  const onSubmit = (): void => {
    const v = input.value.trim();
    if (v.length < 4) {
      renderLogin('token 太短');
      return;
    }
    setToken(v);
    void renderApp();
  };
  btn.onclick = onSubmit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmit();
  });
}

// ---------- 主框架 ----------

type Tab = 'stats' | 'users';

let currentTab: Tab = 'stats';

async function renderApp(): Promise<void> {
  root.innerHTML = `
    <div class="admin-app">
      <header class="admin-header">
        <h1>晨雾迷径 · 后台管理</h1>
        <nav class="admin-nav">
          <button class="admin-tab" data-tab="stats">大 盘</button>
          <button class="admin-tab" data-tab="users">用 户 列 表</button>
          <button class="admin-logout" type="button">退 出</button>
        </nav>
      </header>
      <main id="admin-main"></main>
    </div>
  `;
  // tab 点击
  root.querySelectorAll<HTMLButtonElement>('.admin-tab').forEach((btn) => {
    btn.onclick = (): void => {
      currentTab = btn.dataset.tab as Tab;
      void renderTab();
    };
  });
  (root.querySelector('.admin-logout') as HTMLButtonElement).onclick = (): void => {
    clearToken();
    renderLogin();
  };
  await renderTab();
}

async function renderTab(): Promise<void> {
  // 切换 active 样式
  root.querySelectorAll<HTMLButtonElement>('.admin-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
  if (currentTab === 'stats') {
    await renderStats();
  } else {
    await renderUsers(0);
  }
}

// ---------- 大盘 ----------

async function renderStats(): Promise<void> {
  const main = document.getElementById('admin-main') as HTMLElement;
  main.innerHTML = `<div class="admin-loading">加载中...</div>`;
  const data = await callApi<StatsResponse>('/api/admin/stats');
  if ('error' in data) {
    return handleApiError(data, () => renderStats());
  }

  // DAU 折线（用 SVG，零依赖）
  const dauMax = Math.max(1, ...data.dau.map((d) => d.count));
  const w = 600;
  const h = 140;
  const padX = 30;
  const padY = 16;
  const stepX = data.dau.length > 1 ? (w - 2 * padX) / (data.dau.length - 1) : 0;
  const dauPoints = data.dau
    .map((d, i) => {
      const x = padX + i * stepX;
      const y = h - padY - ((h - 2 * padY) * d.count) / dauMax;
      return `${x},${y}`;
    })
    .join(' ');

  // 关卡通过率柱状图
  const lvMax = Math.max(1, ...data.levelClears.map((d) => d.cleared));
  const lvBarW = 6;
  const lvBarGap = 2;
  const lvW = data.levelClears.length * (lvBarW + lvBarGap);
  const lvH = 120;
  const lvBars = data.levelClears
    .map((d, i) => {
      const barH = (lvH - 16) * (d.cleared / lvMax);
      return `<rect x="${i * (lvBarW + lvBarGap)}" y="${lvH - 8 - barH}" width="${lvBarW}" height="${barH}" rx="1" />`;
    })
    .join('');

  main.innerHTML = `
    <section class="admin-section">
      <h2>核心数据</h2>
      <div class="kpi-row">
        <div class="kpi"><label>累计用户</label><strong>${data.totalUsers.toLocaleString()}</strong></div>
        <div class="kpi"><label>今日活跃</label><strong>${data.dau[data.dau.length - 1]?.count ?? 0}</strong></div>
        <div class="kpi"><label>7 日均活跃</label><strong>${Math.round(
          data.dau.reduce((a, b) => a + b.count, 0) / Math.max(1, data.dau.length)
        )}</strong></div>
      </div>
    </section>

    <section class="admin-section">
      <h2>近 7 日活跃</h2>
      <div class="chart-wrap">
        <svg viewBox="0 0 ${w} ${h}" class="chart-line" preserveAspectRatio="none">
          <polyline fill="none" stroke="currentColor" stroke-width="2" points="${dauPoints}" />
          ${data.dau
            .map((d, i) => {
              const x = padX + i * stepX;
              const y = h - padY - ((h - 2 * padY) * d.count) / dauMax;
              return `<circle cx="${x}" cy="${y}" r="3" />
                      <text x="${x}" y="${h - 2}" font-size="10" text-anchor="middle">${d.day.slice(5)}</text>
                      <text x="${x}" y="${y - 6}" font-size="10" text-anchor="middle">${d.count}</text>`;
            })
            .join('')}
        </svg>
      </div>
    </section>

    <section class="admin-section">
      <h2>各关通过人数</h2>
      <div class="chart-wrap chart-bars-wrap">
        <svg viewBox="0 0 ${lvW} ${lvH}" class="chart-bars" preserveAspectRatio="none" width="100%" height="${lvH}">
          ${lvBars}
        </svg>
        <div class="chart-bars-axis">
          <span>1</span><span>50</span><span>100</span>
        </div>
      </div>
      <details class="lv-table-details">
        <summary>展开表格视图</summary>
        <div class="lv-table">
          ${data.levelClears
            .map(
              (d) =>
                `<div class="lv-row"><span>关 ${d.levelId}</span><span>${d.cleared}</span><span>${
                  data.totalUsers > 0
                    ? Math.round((d.cleared / data.totalUsers) * 100)
                    : 0
                }%</span></div>`
            )
            .join('')}
        </div>
      </details>
    </section>
  `;
}

// ---------- 用户列表 ----------

async function renderUsers(offset: number, limit = 50): Promise<void> {
  const main = document.getElementById('admin-main') as HTMLElement;
  main.innerHTML = `<div class="admin-loading">加载中...</div>`;
  const data = await callApi<UsersResponse>(
    `/api/admin/users?offset=${offset}&limit=${limit}`
  );
  if ('error' in data) {
    return handleApiError(data, () => renderUsers(offset, limit));
  }

  const rows = data.items
    .map((u) => {
      const display = u.nick ? escapeHtml(u.nick) : maskCode(u.code);
      return `
        <div class="u-row" data-code="${u.code}">
          <span class="u-rank">${u.rank}</span>
          <span class="u-name">${display}</span>
          <span class="u-code">${u.code}</span>
          <span class="u-cleared">${u.cleared}</span>
          <span class="u-stars">${u.stars}</span>
          <span class="u-active">${fmtDate(u.updatedAt)}</span>
        </div>
      `;
    })
    .join('');

  const hasPrev = offset > 0;
  const hasNext = data.items.length === limit;

  main.innerHTML = `
    <section class="admin-section">
      <h2>用户列表 <small class="muted">按综合榜倒排（${offset + 1}–${offset + data.items.length}）</small></h2>
      <div class="u-table">
        <div class="u-row u-head">
          <span>名次</span>
          <span>昵称 / 脱敏</span>
          <span>code</span>
          <span>通关</span>
          <span>★</span>
          <span>最后活跃</span>
        </div>
        ${rows || '<div class="admin-empty">暂无数据</div>'}
      </div>
      <div class="u-pagination">
        <button id="u-prev" ${hasPrev ? '' : 'disabled'}>上一页</button>
        <span>第 ${Math.floor(offset / limit) + 1} 页</span>
        <button id="u-next" ${hasNext ? '' : 'disabled'}>下一页</button>
      </div>
    </section>
    <div id="u-detail-modal"></div>
  `;

  (root.querySelector('#u-prev') as HTMLButtonElement).onclick = (): void => {
    void renderUsers(Math.max(0, offset - limit), limit);
  };
  (root.querySelector('#u-next') as HTMLButtonElement).onclick = (): void => {
    void renderUsers(offset + limit, limit);
  };
  // 点击行：弹详情
  root.querySelectorAll<HTMLElement>('.u-table .u-row[data-code]').forEach((row) => {
    row.onclick = (): void => {
      const code = row.dataset.code as string;
      void renderUserDetail(code);
    };
  });
}

async function renderUserDetail(code: string): Promise<void> {
  const modal = document.getElementById('u-detail-modal') as HTMLElement;
  if (!isValidCode(code)) return;
  modal.innerHTML = `<div class="u-modal"><div class="u-modal-card"><div class="admin-loading">加载中...</div></div></div>`;
  const data = await callApi<UserDetailResponse>(`/api/admin/user?target=${code}`);
  if ('error' in data) {
    return handleApiError(data, () => renderUserDetail(code));
  }

  // 把 records 渲染成 100 关网格（已通关高亮 + 显示 ★ 与 bestTime）
  const tiles: string[] = [];
  for (let i = 1; i <= 100; i++) {
    const r = data.progress.records[i];
    if (r?.cleared) {
      tiles.push(
        `<span class="ud-tile cleared" title="第 ${i} 关 · ${r.bestTime}s · ★${r.bestStars}">${i}</span>`
      );
    } else {
      tiles.push(`<span class="ud-tile">${i}</span>`);
    }
  }

  modal.innerHTML = `
    <div class="u-modal" id="u-modal-overlay">
      <div class="u-modal-card">
        <button class="u-modal-close" type="button" aria-label="关闭">✕</button>
        <h3>${data.nick ? escapeHtml(data.nick) : maskCode(data.code)}</h3>
        <p class="muted">code: <code>${data.code}</code> · 排名: ${data.rank ?? '—'}</p>
        <div class="ud-meta">
          <span>已通关 <strong>${Math.max(0, data.progress.unlocked - 1)}</strong></span>
          <span>首次创建 <strong>${fmtDate(data.firstSeen)}</strong></span>
          <span>最后活跃 <strong>${fmtDate(data.updatedAt)}</strong></span>
        </div>
        <h4>关卡进度</h4>
        <div class="ud-grid">${tiles.join('')}</div>
      </div>
    </div>
  `;
  const overlay = root.querySelector('#u-modal-overlay') as HTMLElement;
  const close = (): void => {
    modal.innerHTML = '';
  };
  overlay.onclick = (e): void => {
    if (e.target === overlay) close();
  };
  (root.querySelector('.u-modal-close') as HTMLButtonElement).onclick = close;
}

// ---------- 公共错误处理 ----------

function handleApiError(
  err: { error: string; status: number },
  retry: () => void
): void {
  if (err.status === 401 || err.status === 403) {
    clearToken();
    renderLogin('登录失效或 token 错误，请重新登录');
    return;
  }
  if (err.status === 503) {
    const main = document.getElementById('admin-main') as HTMLElement;
    main.innerHTML = `<div class="admin-error">后台未配置 ADMIN_CODE 环境变量。<br>请到 Vercel Dashboard → Settings → Environment Variables 中添加。</div>`;
    return;
  }
  const main = document.getElementById('admin-main') as HTMLElement;
  main.innerHTML = `<div class="admin-error">请求失败 (${err.error})。<button id="retry-btn" type="button">重试</button></div>`;
  (root.querySelector('#retry-btn') as HTMLButtonElement).onclick = retry;
}

// =====================================================================
// 启动
// =====================================================================

if (getToken()) {
  void renderApp();
} else {
  renderLogin();
}

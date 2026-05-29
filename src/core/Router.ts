/**
 * 极简 hash 路由
 *
 * 路由表：
 *   #/             → menu          主菜单
 *   #/levels       → levels        关卡选择
 *   #/leaderboard  → leaderboard   排行榜
 *   #/settings     → settings      设置
 *   #/play/:id     → play          进入指定关卡
 *
 * 设计：
 *   - 仅用 location.hash，零依赖、刷新可恢复、支持浏览器前进后退
 *   - 路由变化通过 onChange 回调下发到 Game 控制层
 *   - navigate() 内部判断目标是否与当前一致，避免重复触发
 */

export type Route =
  | { name: 'menu' }
  | { name: 'levels' }
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'play'; levelId: number };

export class Router {
  private listener: ((route: Route) => void) | null = null;
  private current: Route = { name: 'menu' };

  start(onChange: (route: Route) => void): void {
    this.listener = onChange;
    window.addEventListener('hashchange', this.handleHashChange);
    // 首次进入：根据当前 hash 决定首屏（默认主菜单）
    this.current = parseHash(location.hash);
    // 规范化 URL：把空 hash / 非法 hash 写成 "#/"，但不新增历史栈
    // 注意：replaceState **不会**触发 hashchange，所以这里不能设 suppressNext，
    // 否则会错误地把后续第一次真正的 hashchange（用户点「开始游戏」时 navigate 触发的）吞掉，
    // 表现为路由 URL 变了但页面停在主菜单。
    const expected = serializeHash(this.current);
    if (location.hash !== expected) {
      const url = `${location.pathname}${location.search}${expected}`;
      history.replaceState(null, '', url);
    }
    this.listener(this.current);
  }

  destroy(): void {
    window.removeEventListener('hashchange', this.handleHashChange);
    this.listener = null;
  }

  /** 编程式跳转：会写入 hash 并触发回调（去重） */
  navigate(route: Route, opts: { replace?: boolean } = {}): void {
    const next = serializeHash(route);
    const isSame =
      location.hash === next || (location.hash === '' && next === '#/');
    if (isSame && this.routeEquals(this.current, route)) return;

    if (opts.replace) {
      // replaceState 不触发 hashchange，需要手动派发回调
      const url = `${location.pathname}${location.search}${next}`;
      history.replaceState(null, '', url);
      this.current = route;
      this.listener?.(route);
    } else {
      // 修改 location.hash 会异步触发 hashchange，
      // 在 handleHashChange 里再统一回调，避免重复 / 抖动
      location.hash = next;
      // 当 next 与当前 hash 相同（仅 current 不同）时不会触发 hashchange，
      // 主动同步一次
      if (isSame) {
        this.current = route;
        this.listener?.(route);
      }
    }
  }

  private routeEquals(a: Route, b: Route): boolean {
    if (a.name !== b.name) return false;
    if (a.name === 'play' && b.name === 'play') return a.levelId === b.levelId;
    return true;
  }

  private handleHashChange = (): void => {
    const route = parseHash(location.hash);
    this.current = route;
    this.listener?.(route);
  };
}

/** "#/play/3" → { name: 'play', levelId: 3 } */
function parseHash(hash: string): Route {
  // 去掉前缀 # 与 /
  const raw = hash.replace(/^#\/?/, '').trim();
  if (raw === '' || raw === '/') return { name: 'menu' };
  const parts = raw.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'levels':
      return { name: 'levels' };
    case 'leaderboard':
      return { name: 'leaderboard' };
    case 'settings':
      return { name: 'settings' };
    case 'play': {
      const id = parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(id) && id > 0) return { name: 'play', levelId: id };
      return { name: 'menu' };
    }
    default:
      return { name: 'menu' };
  }
}

/** Route → "#/play/3" */
function serializeHash(route: Route): string {
  switch (route.name) {
    case 'menu':
      return '#/';
    case 'levels':
      return '#/levels';
    case 'leaderboard':
      return '#/leaderboard';
    case 'settings':
      return '#/settings';
    case 'play':
      return `#/play/${route.levelId}`;
  }
}

// 全局单例
export const router = new Router();

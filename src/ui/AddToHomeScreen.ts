/**
 * "添加到主屏" 引导横幅。
 *
 * 触发条件（全部满足）：
 *   - iOS / iPadOS Safari
 *   - 不在微信内置浏览器中（微信内"添加到主屏"行为不一致，避免误导）
 *   - 当前不是 standalone 模式（用户还未添加）
 *   - 不是首次访问（首次太打扰，从第 2 次起再提示）
 *   - 用户没有"永久关闭"过此提示（点 X 后记录到 localStorage）
 *
 * 设计：底部条状横幅，含图标 + 文案 + 关闭按钮，
 * 玩游戏时不会遮挡画面，点了关闭则永久不再出现。
 */

import { isIOS, isInWeChat, isStandalone } from '../core/Environment';

/** localStorage 键：用户主动关闭的标记 */
const DISMISS_KEY = 'maze_a2hs_dismissed';
/** localStorage 键：访问次数计数器 */
const VISIT_KEY = 'maze_visit_count';

export function maybeShowAddToHomeScreen(): void {
  // 资格检查：必须 iOS Safari + 非微信内 + 非主屏模式
  if (!isIOS() || isInWeChat() || isStandalone()) return;

  // 用户主动关过 → 永久不再提示
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
  } catch {
    return; // localStorage 都用不了，提示也没意义
  }

  // 访问次数 +1，第 1 次访问只计数不提示，避免首次打扰
  let visits = 0;
  try {
    visits = parseInt(localStorage.getItem(VISIT_KEY) ?? '0', 10) || 0;
  } catch {
    /* ignore */
  }
  visits += 1;
  try {
    localStorage.setItem(VISIT_KEY, String(visits));
  } catch {
    /* ignore */
  }
  if (visits < 2) return;

  // 延迟 2.5s 显示，避开首屏渲染高峰
  setTimeout(() => render(), 2500);
}

function render(): void {
  // 防止重复挂载
  if (document.getElementById('a2hs-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'a2hs-banner';
  banner.className = 'a2hs-banner';
  banner.innerHTML = `
    <div class="a2hs-text">
      <div class="a2hs-title">📱 添加到主屏，永久保存进度</div>
      <div class="a2hs-tip">点击 Safari 底部 <span class="a2hs-icon">⬆︎</span> 分享 → 「添加到主屏幕」</div>
    </div>
    <button class="a2hs-close" type="button" aria-label="关闭提示">×</button>
  `;
  const closeBtn = banner.querySelector<HTMLButtonElement>('.a2hs-close');
  closeBtn?.addEventListener('click', () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    banner.classList.add('a2hs-hide');
    setTimeout(() => banner.remove(), 250);
  });

  document.body.appendChild(banner);
  // 下一帧加 show 以触发 CSS transition
  requestAnimationFrame(() => banner.classList.add('a2hs-show'));
}

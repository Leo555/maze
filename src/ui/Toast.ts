/**
 * 全局 Toast：浮动顶部、居中、自动消失。
 *
 * 与 Hud 自带的 toast（src/ui/Hud.ts 内）的区别：
 *   - Hud.showToast：仅在游戏内（关卡进行中）可用，依赖 hud DOM
 *   - 此处的 toast：挂在 body 上，菜单 / 设置页 / 任何 overlay 上都能弹
 *
 * 用于替换原本散落在代码里的 alert()。alert 是阻塞调用（暂停 JS 主线程 + 等用户点确定），
 * 体验上比 toast 差很多，尤其是在游戏类应用里。
 *
 * 设计点：
 *   - 单例：同一时间只有一条 toast，新的会覆盖旧的（避免堆叠遮挡 UI）
 *   - 三种语义：'info' / 'success' / 'error'，分别对应中性、绿色提示、橙红警示
 *   - 不阻塞：Promise<void> 仅用于 await 显示完成的场景，正常调用不必 await
 */

type ToastKind = 'info' | 'success' | 'error';

let rootEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;

/** 懒创建挂载节点，避免对未使用 toast 的页面产生额外 DOM 成本 */
function ensureRoot(): HTMLDivElement {
  if (rootEl && document.body.contains(rootEl)) return rootEl;
  const el = document.createElement('div');
  el.className = 'global-toast';
  // 保留 ARIA live 属性，让屏幕阅读器能感知 toast 变化
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  rootEl = el;
  return el;
}

/**
 * 显示一条 toast。
 * @param text     提示文案；多行用 \n 分隔
 * @param kind     语义颜色，默认 info
 * @param duration 显示毫秒数，默认 1800
 */
export function showToast(
  text: string,
  kind: ToastKind = 'info',
  duration = 1800
): void {
  const el = ensureRoot();

  // 取消上一次定时关闭，避免新 toast 被提前隐藏
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  // 重置 className：去掉旧 kind 类，加上新的，并加 show 触发入场动画
  el.className = `global-toast global-toast-${kind} show`;
  // \n 转 <br>，但避免 XSS：先转义所有 HTML，再替换
  el.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

  hideTimer = window.setTimeout(() => {
    el.classList.remove('show');
    hideTimer = null;
  }, duration);
}

/** 简易 HTML 转义；toast 内容来自服务端/用户输入时必须转义 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

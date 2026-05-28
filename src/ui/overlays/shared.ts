/**
 * Overlay 公共工具：所有浮层 UI 共享的 #overlay 容器、show/clear、按钮音效封装。
 *
 * 这些是 overlays/ 子目录下其它文件的内部依赖，不暴露给业务代码。
 */

import { audio } from '../../core/Audio';

export const overlay = document.getElementById('overlay') as HTMLElement;

// hideOverlay 的延迟清理 timer。任何 showOverlay/clearOverlay 都要先把它取消，
// 否则会把刚渲染好的下一屏 UI 又清掉（典型场景：暂停页 onMenu 先 hideOverlay 后立即 gotoMenu）
let pendingHideTimer: number | null = null;

export function cancelPendingHide(): void {
  if (pendingHideTimer !== null) {
    clearTimeout(pendingHideTimer);
    pendingHideTimer = null;
  }
}

export function clearOverlay(): void {
  cancelPendingHide();
  overlay.innerHTML = '';
  overlay.classList.remove('active');
}

export function showOverlay(node: HTMLElement, instant = false): void {
  clearOverlay();
  overlay.appendChild(node);
  overlay.classList.add('active');
  if (instant) {
    node.classList.add('show');
  } else {
    requestAnimationFrame(() => node.classList.add('show'));
  }
}

export function attachClickSfx(btn: HTMLElement): void {
  btn.addEventListener('mouseenter', () => audio.playSfx('ui_hover'));
  btn.addEventListener('click', () => audio.playSfx('ui_click'));
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

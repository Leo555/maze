/**
 * 通用二次确认弹窗：替换浏览器原生 confirm()，与 qr-modal 共享视觉风格。
 *
 * 使用：
 *   const ok = await showConfirm({
 *     title: '清除通关记录',
 *     message: '此操作将清除所有进度，且不可恢复',
 *     confirmText: '确定清除',
 *     cancelText: '取消',
 *     danger: true, // 危险操作 → 确认按钮变红
 *   });
 *   if (ok) doDangerousThing();
 *
 * 交互：
 *   - Enter 确认（仅当 danger=false 时；危险操作必须显式点击避免误触）
 *   - Esc / 蒙层点击 / 取消按钮 → 取消
 */

import { audio } from '../../core/Audio';
import { attachClickSfx, overlay } from './shared';

export interface ConfirmOptions {
  title: string;
  /** 主体说明文字，可包含 \n 换行 */
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮使用红色警示样式 */
  danger?: boolean;
}

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmText = '确  定',
    cancelText = '取  消',
    danger = false,
  } = opts;

  return new Promise<boolean>((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    const card = document.createElement('div');
    card.className = 'scene-card scene-card-confirm';

    const titleEl = document.createElement('div');
    titleEl.className = 'confirm-title';
    titleEl.textContent = title;
    card.appendChild(titleEl);

    const msgEl = document.createElement('div');
    msgEl.className = 'confirm-message';
    // 支持 \n 换行
    msgEl.textContent = message;
    msgEl.style.whiteSpace = 'pre-line';
    card.appendChild(msgEl);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-group confirm-btn-group';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = cancelText;
    attachClickSfx(cancelBtn);
    btnRow.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = danger ? 'btn confirm-danger' : 'btn primary';
    okBtn.textContent = confirmText;
    attachClickSfx(okBtn);
    btnRow.appendChild(okBtn);

    card.appendChild(btnRow);
    modal.appendChild(card);
    overlay.appendChild(modal);

    let settled = false;
    const close = (value: boolean): void => {
      if (settled) return;
      settled = true;
      audio.playSfx('ui_close');
      modal.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => modal.remove(), 280);
      resolve(value);
    };

    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close(false);
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close(false);
      } else if (e.key === 'Enter' && !danger) {
        // 危险操作禁用 Enter 直接确认，避免误触
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => {
      modal.classList.add('show');
      // 默认聚焦取消按钮：危险操作下保护用户，意外点击 Enter/Space 也是取消
      setTimeout(() => cancelBtn.focus(), 120);
    });
  });
}

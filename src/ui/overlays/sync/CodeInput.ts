/**
 * 输入同步编号弹窗：替换浏览器原生 prompt，与 qr-modal 共享视觉风格。
 *
 *   - 输入框使用 monospace 字体显示更整齐
 *   - 不强制 maxlength=8，避免移动端粘贴时被截断；提交时再校验
 *   - Enter 提交、Esc / 蒙层 / 取消按钮都视为取消
 */

import { audio } from '../../../core/Audio';
import { storage } from '../../../core/Storage';
import { isValidCode } from '../../../../shared/types';
import { showToast } from '../../Toast';
import { attachClickSfx, overlay } from '../shared';

/** 弹窗输入编号 → 切换本机 code（同时拉取云端进度覆盖本地） */
export async function promptAdoptCode(refresh: () => void): Promise<void> {
  const trimmed = await showCodeInputModal();
  if (!trimmed) return;
  if (!isValidCode(trimmed)) {
    showToast('编号格式错误，必须是 8 位字母或数字', 'error');
    return;
  }
  const ok = await storage.adoptCode(trimmed);
  if (!ok) {
    showToast('未找到该编号或操作过于频繁', 'error', 2400);
    return;
  }
  showToast(`已恢复编号 ${trimmed} 的进度`, 'success', 2400);
  refresh();
}

/** 显示输入对话框；返回输入文本（已 trim），取消返回 null */
function showCodeInputModal(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    const card = document.createElement('div');
    card.className = 'scene-card scene-card-input';
    card.innerHTML = `
      <div class="scene-title">恢 复 进 度</div>
      <div class="scene-subtitle">RECOVER PROGRESS</div>
      <div class="input-tip">输入 8 位同步编号</div>
    `;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'code-input';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '例如 A3kPm7B5';
    input.maxLength = 16; // 允许多输再校验，给粘贴留余地
    card.appendChild(input);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-group';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '取  消';
    attachClickSfx(cancelBtn);
    btnRow.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = 'btn primary';
    okBtn.textContent = '确  定';
    attachClickSfx(okBtn);
    btnRow.appendChild(okBtn);

    card.appendChild(btnRow);
    modal.appendChild(card);
    overlay.appendChild(modal);

    let settled = false;
    const close = (value: string | null): void => {
      if (settled) return;
      settled = true;
      audio.playSfx('ui_close');
      modal.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => modal.remove(), 280);
      resolve(value);
    };

    const submit = (): void => {
      const v = input.value.trim();
      close(v || null);
    };

    okBtn.onclick = submit;
    cancelBtn.onclick = () => close(null);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close(null);
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        close(null);
      }
    };
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => {
      modal.classList.add('show');
      // 等入场动画展开后再聚焦，避免 iOS 因为元素还在 transform 中而拒绝唤起键盘
      setTimeout(() => input.focus(), 120);
    });
  });
}

/**
 * 二维码 + 同步链接对话框：用于在自己其它设备上恢复进度。
 *
 * 二维码 / 链接内容：`{origin}/?recover={code}`
 *   - main.ts 启动时检测 ?recover=xxxxxxxx → 自动切换到该 code
 *   - 链接形式适合发给自己的微信文件传输助手 / 收藏，便于后续在新设备打开
 *
 * 离线生成：用 qrcode-generator 库本地算出 SVG，无网络请求。
 */

import { audio } from '../../../core/Audio';
import { showToast } from '../../Toast';
import { attachClickSfx, overlay } from '../shared';

/**
 * @param mode 'normal' 设置页主动打开；'reminder' 首次通关后引导（标题/文案更强调）
 */
export function showQrDialog(
  code: string,
  mode: 'normal' | 'reminder' = 'normal'
): void {
  // 用独立 modal 层叠在设置页之上，关闭只移除自身，不影响背后的设置页。
  // 不调 showOverlay（那个会 clearOverlay 把设置页清空，关闭时就只剩白屏）。
  const url = `${location.origin}/?recover=${encodeURIComponent(code)}`;
  void import('../../Qr').then(({ generateQrSvg }) => {
    const svg = generateQrSvg(url, 240);

    const isReminder = mode === 'reminder';
    const title = isReminder ? '保 存 进 度' : '同 步 进 度';
    const subtitle = isReminder ? 'SAVE YOUR PROGRESS' : 'SYNC PROGRESS';
    // 注意：模板字符串中 <br> 后不能有真实换行 + 缩进，
    // 否则 HTML 会把这些空白当作行首空格，导致中文居中文本视觉左偏
    const tipHtml = isReminder
      ? `请截图保存二维码或复制下方链接<br><span class="qr-tip-warn">否则更换设备 / 清缓存后进度将丢失</span>`
      : `建议截图保存或将链接发到自己的设备，<br>在其他设备扫码或打开链接即可恢复进度`;
    // 安全提示：所有模式都展示。持有 code = 持有写权限，
    // 把二维码 / 链接发给别人 = 把存档拱手让人，必须明确告知。
    const securityTipHtml = `<span class="qr-tip-secure">⚠ 请勿将二维码或链接发给他人，否则对方可删除你的进度</span>`;

    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    const card = document.createElement('div');
    card.className = 'scene-card scene-card-qr';
    card.innerHTML = `
      <div class="scene-title">${title}</div>
      <div class="scene-subtitle">${subtitle}</div>
      <div class="qr-wrap">${svg}</div>
      <div class="qr-tip">${tipHtml}</div>
      <div class="qr-tip-security">${securityTipHtml}</div>
    `;

    // 自定义关闭：移除 modal 自身，触发音效
    const closeModal = (): void => {
      audio.playSfx('ui_close');
      modal.classList.remove('show');
      // 等过渡动画结束后移除节点
      setTimeout(() => modal.remove(), 280);
    };

    // 普通模式：右上角加 ✕ 图标关闭，节省底部按钮空间。
    // reminder 模式（首次通关引导）保留底部"我已保存"主按钮，
    // 强制玩家明确确认，避免没真截图就误关导致进度丢失。
    if (!isReminder) {
      const closeIcon = document.createElement('button');
      closeIcon.className = 'qr-close-icon';
      closeIcon.type = 'button';
      closeIcon.setAttribute('aria-label', '关闭');
      closeIcon.innerHTML = '✕';
      attachClickSfx(closeIcon);
      closeIcon.onclick = closeModal;
      card.appendChild(closeIcon);
    }

    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.className = 'btn';
    copyLinkBtn.textContent = '复 制 同 步 链 接';
    copyLinkBtn.style.width = '100%';
    copyLinkBtn.style.marginTop = '14px';
    attachClickSfx(copyLinkBtn);
    copyLinkBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyLinkBtn.textContent = '已 复 制 ✓';
        setTimeout(() => (copyLinkBtn.textContent = '复 制 同 步 链 接'), 1500);
      } catch {
        showToast(`链接：${url}\n请手动长按复制`, 'info', 5000);
      }
    };
    card.appendChild(copyLinkBtn);

    // reminder 模式保留底部主按钮（强确认）；normal 模式右上角 ✕ 已足够
    if (isReminder) {
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn primary';
      confirmBtn.textContent = '我 已 保 存';
      confirmBtn.style.width = '100%';
      confirmBtn.style.marginTop = '8px';
      attachClickSfx(confirmBtn);
      confirmBtn.onclick = closeModal;
      card.appendChild(confirmBtn);
    }

    // 点击 modal 蒙层（不是卡片）也关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.appendChild(card);
    overlay.appendChild(modal);
    // 触发入场动画（next frame 才能让浏览器先 paint 初始状态）
    requestAnimationFrame(() => modal.classList.add('show'));
  });
}

/** 首次通关后的"保存进度"引导（语义包装，复用 showQrDialog） */
export function showBackupReminder(code: string): void {
  showQrDialog(code, 'reminder');
}

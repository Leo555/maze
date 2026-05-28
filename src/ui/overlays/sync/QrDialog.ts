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

    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    const card = document.createElement('div');
    card.className = 'scene-card scene-card-qr';
    card.innerHTML = `
      <div class="scene-title">${title}</div>
      <div class="scene-subtitle">${subtitle}</div>
      <div class="qr-wrap">${svg}</div>
      <div class="qr-tip">${tipHtml}</div>
      <div class="qr-code-tag">编号：<strong>${code}</strong></div>
    `;

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

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn primary';
    closeBtn.textContent = isReminder ? '我 已 保 存' : '关 闭';
    closeBtn.style.width = '100%';
    closeBtn.style.marginTop = '8px';
    attachClickSfx(closeBtn);

    // 自定义关闭：移除 modal 自身，触发音效
    const closeModal = (): void => {
      audio.playSfx('ui_close');
      modal.classList.remove('show');
      // 等过渡动画结束后移除节点
      setTimeout(() => modal.remove(), 280);
    };
    closeBtn.onclick = closeModal;
    card.appendChild(closeBtn);

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

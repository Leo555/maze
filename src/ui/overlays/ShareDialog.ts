/**
 * 分享游戏对话框
 *
 * 内容：
 *   - 游戏首页二维码（仅 origin 链接，不含 ?recover=xxxxxxxx，保护用户存档）
 *   - 一键复制链接
 *   - 系统分享（Web Share API，移动端原生分享面板）
 *   - 微信内置浏览器：引导文案"点击右上角 ⋯ 转发给朋友"
 *
 * 与 QrDialog 区别：
 *   - QrDialog 是"个人同步"——二维码内容是 ?recover={code}，扫了别人会接管你的进度
 *   - ShareDialog 是"传播游戏"——二维码内容是干净的 origin，谁扫都是从头开始
 */

import { audio } from '../../core/Audio';
import { isInWeChat } from '../../core/Environment';
import { showToast } from '../Toast';
import { attachClickSfx, overlay } from './shared';

const SHARE_TITLE = '晨雾迷径';
const SHARE_DESC = '一款唯美的浏览器迷宫解谜游戏，10 章节 100 关，挑战最佳通关步数';

export function showShareDialog(): void {
  // 分享内容只用 origin 根路径，绝不带 ?recover=xxxxxxxx
  const shareUrl = `${location.origin}/`;

  void import('../Qr').then(({ generateQrSvg }) => {
    const svg = generateQrSvg(shareUrl, 220);

    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    const card = document.createElement('div');
    card.className = 'scene-card scene-card-qr scene-card-share';

    const inWeChat = isInWeChat();

    // 微信内：突出"右上角转发"引导；其他环境：常规分享引导
    const tipHtml = inWeChat
      ? `<span class="share-tip-wechat">点击右上角 <strong>⋯</strong> → 转发给朋友 / 分享到朋友圈</span>`
      : `扫描二维码或复制链接，邀请朋友一起来玩`;

    card.innerHTML = `
      <div class="scene-title">分 享 游 戏</div>
      <div class="scene-subtitle">SHARE</div>
      <div class="qr-wrap">${svg}</div>
      <div class="qr-tip">${tipHtml}</div>
      <div class="share-url-row">
        <code class="share-url">${shareUrl}</code>
      </div>
    `;

    // 自定义关闭：移除 modal 自身，触发音效
    const closeModal = (): void => {
      audio.playSfx('ui_close');
      modal.classList.remove('show');
      setTimeout(() => modal.remove(), 280);
    };

    // 右上角 ✕ 关闭
    const closeIcon = document.createElement('button');
    closeIcon.className = 'qr-close-icon';
    closeIcon.type = 'button';
    closeIcon.setAttribute('aria-label', '关闭');
    closeIcon.innerHTML = '✕';
    attachClickSfx(closeIcon);
    closeIcon.onclick = closeModal;
    card.appendChild(closeIcon);

    // 复制链接按钮（任何环境都有）
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = '复 制 游 戏 链 接';
    copyBtn.style.width = '100%';
    copyBtn.style.marginTop = '14px';
    attachClickSfx(copyBtn);
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyBtn.textContent = '已 复 制 ✓';
        setTimeout(() => (copyBtn.textContent = '复 制 游 戏 链 接'), 1500);
      } catch {
        showToast(`链接：${shareUrl}\n请手动长按复制`, 'info', 5000);
      }
    };
    card.appendChild(copyBtn);

    // 系统分享按钮（Web Share API）：浏览器支持时显示，能调出原生分享面板
    // 移动端 Safari / Chrome / Edge 普遍支持；微信内置浏览器不支持，这时不显示
    if (!inWeChat && typeof navigator.share === 'function') {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn primary';
      shareBtn.textContent = '系 统 分 享';
      shareBtn.style.width = '100%';
      shareBtn.style.marginTop = '8px';
      attachClickSfx(shareBtn);
      shareBtn.onclick = async () => {
        try {
          await navigator.share({
            title: SHARE_TITLE,
            text: SHARE_DESC,
            url: shareUrl,
          });
        } catch (err: unknown) {
          // 用户取消是正常行为（AbortError），不提示；其他失败兜底为复制
          if ((err as Error).name !== 'AbortError') {
            showToast('分享未成功，已复制链接', 'info', 2400);
            try {
              await navigator.clipboard.writeText(shareUrl);
            } catch {
              /* ignore */
            }
          }
        }
      };
      card.appendChild(shareBtn);
    }

    // 点击 modal 蒙层（不是卡片）也关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.appendChild(card);
    overlay.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));
  });
}

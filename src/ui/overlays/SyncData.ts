/**
 * 同步数据浮层：跨设备进度同步面板 + 清除通关记录。
 *
 * 与 BasicSettings 的边界：
 *   BasicSettings 管"个性化偏好"（昵称、音量），SyncData 管"账号/数据风险操作"
 *   （获取同步编号、扫码恢复、清除存档）。
 *
 * 设计：把"清除"放在最下面、用 confirm 二次确认 + danger 视觉，避免误触。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { showToast } from '../Toast';
import { attachClickSfx, showOverlay } from './shared';
import { showConfirm } from './Confirm';
import { buildSyncPanel } from './sync/SyncPanel';
import { pushErrorMessage } from '../../core/PushErrorMessage';

export function showSyncData(onBack: () => void): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">同 步 数 据</div>
    <div class="scene-subtitle">SYNC &amp; DATA</div>
  `;

  // === 同步进度面板（云端关联状态 + 编号显示 + 输入码恢复） ===
  card.appendChild(buildSyncPanel());

  // === 清除通关记录（数据销毁高危操作，放在面板下方） ===
  const resetRow = document.createElement('div');
  resetRow.className = 'settings-row';
  resetRow.innerHTML = `<label>存档</label>`;
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.style.flex = '1';
  resetBtn.textContent = '清 除 通 关 记 录';
  attachClickSfx(resetBtn);
  resetBtn.onclick = async () => {
    const confirmed = await showConfirm({
      title: '清除通关记录',
      message:
        '此操作将清除所有关卡通关进度与三星记录，且不可恢复。\n请确认是否继续？',
      confirmText: '确 定 清 除',
      cancelText: '取  消',
      danger: true,
    });
    if (!confirmed) return;

    // 进度清除：云端写入成功才视为完成，避免云端旧数据下次启动覆盖本地
    resetBtn.disabled = true;
    const original = resetBtn.textContent;
    resetBtn.textContent = '清 除 中...';
    try {
      const r = await storage.reset();
      if (r.ok) {
        showToast('已清除通关记录', 'success');
      } else {
        showToast(pushErrorMessage(r.error, r.retryAfterSec), 'error', 3000);
      }
    } catch {
      showToast('清除失败，请稍后重试', 'error', 3000);
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = original;
    }
  };
  resetRow.appendChild(resetBtn);
  card.appendChild(resetRow);

  const back = document.createElement('button');
  back.className = 'btn primary';
  back.textContent = '返  回';
  back.style.marginTop = '20px';
  attachClickSfx(back);
  back.onclick = () => onBack();
  card.appendChild(back);

  scene.appendChild(card);
  showOverlay(scene);
}

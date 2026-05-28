/**
 * 设置页：音量滑块 + 重置存档 + 同步进度面板。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { showToast } from '../Toast';
import { attachClickSfx, showOverlay } from './shared';
import { showConfirm } from './Confirm';
import { buildSyncPanel } from './sync/SyncPanel';

export function showSettings(onBack: () => void): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">设  置</div>
    <div class="scene-subtitle">SETTINGS</div>
  `;

  const settings = audio.getSettings();
  const sliders: Array<{ key: 'master' | 'sfx' | 'bgm'; label: string }> = [
    { key: 'master', label: '主音量' },
    { key: 'sfx', label: '音效' },
    { key: 'bgm', label: '音乐' },
  ];

  for (const s of sliders) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <label>${s.label}</label>
      <input type="range" min="0" max="100" value="${Math.round(settings[s.key] * 100)}" />
      <span class="val">${Math.round(settings[s.key] * 100)}%</span>
    `;
    const input = row.querySelector('input') as HTMLInputElement;
    const val = row.querySelector('.val') as HTMLElement;
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10) / 100;
      val.textContent = `${input.value}%`;
      if (s.key === 'master') audio.setMaster(v);
      if (s.key === 'sfx') audio.setSfx(v);
      if (s.key === 'bgm') audio.setBgm(v);
    });
    input.addEventListener('change', () => audio.playSfx('ui_click'));
    card.appendChild(row);
  }

  // 重置存档
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
      const ok = await storage.reset();
      if (ok) {
        showToast('已清除通关记录', 'success');
      } else {
        showToast('云端同步失败，请检查网络后重试', 'error', 3000);
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

  // === 同步进度面板（云端关联状态 + 编号显示 + 输入码恢复） ===
  card.appendChild(buildSyncPanel());

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

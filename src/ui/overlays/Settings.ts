/**
 * 设置页：昵称 + 音量滑块 + 重置存档 + 同步进度面板。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { showToast } from '../Toast';
import { attachClickSfx, showOverlay } from './shared';
import { showConfirm } from './Confirm';
import { buildSyncPanel } from './sync/SyncPanel';
import { isValidNick, NICK_MAX_LENGTH } from '../../../shared/types';
import { pushErrorMessage } from '../../core/PushErrorMessage';

/** 把一段 UI 抽成函数：渲染昵称设置行 */
function buildNicknameRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row settings-nick-row';

  const label = document.createElement('label');
  label.textContent = '昵称';
  row.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-nick-input';
  input.maxLength = NICK_MAX_LENGTH * 4; // 防 emoji 高码点截断（实际校验靠 isValidNick）
  input.placeholder = '排行榜显示用，1-12 字';
  input.value = storage.getNick() ?? '';
  row.appendChild(input);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn settings-nick-save';
  saveBtn.textContent = '保 存';
  saveBtn.disabled = true;
  attachClickSfx(saveBtn);
  row.appendChild(saveBtn);

  // 输入变化：仅当有效且与当前不同才允许保存
  const refreshBtnState = (): void => {
    const v = input.value.trim();
    saveBtn.disabled = !isValidNick(v) || v === (storage.getNick() ?? '');
  };
  input.addEventListener('input', refreshBtnState);
  refreshBtnState();

  // 点击保存：等云端确认成功才提示成功
  saveBtn.onclick = async () => {
    const v = input.value.trim();
    if (!isValidNick(v)) {
      showToast('昵称需 1-12 字、不含控制字符', 'error', 2400);
      return;
    }
    saveBtn.disabled = true;
    const original = saveBtn.textContent;
    saveBtn.textContent = '保 存 中...';
    try {
      const ok = await storage.setNick(v);
      if (ok) {
        showToast('昵称已更新', 'success');
        refreshBtnState();
      } else {
        showToast('昵称保存失败，请稍后重试', 'error', 2800);
      }
    } finally {
      if (saveBtn.textContent === '保 存 中...') saveBtn.textContent = original;
    }
  };

  return row;
}

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

  // 昵称（最重要的"自定义"，放最上面）
  card.appendChild(buildNicknameRow());

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

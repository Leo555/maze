/**
 * 基础设置浮层：昵称 + 音量。
 *
 * 与原 Settings.ts 的关系：
 *   原 settings 单页同时承载"昵称/音量/清存档/同步面板"，导致竖向尺寸过大、
 *   且功能性质混杂。现拆为 BasicSettings + SyncData 两个独立浮层，
 *   主菜单的"基础设置"和"同步数据"两个图标分别打开。
 *
 * 内容：
 *   - 昵称：1-12 字，立刻 push 云端，失败用 PushErrorMessage 文案路由
 *   - 主音量 / 音效 / 音乐：滑块，input 即时生效，change 时播放点击音
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { showToast } from '../Toast';
import { attachClickSfx, showOverlay } from './shared';
import { isValidNick, NICK_MAX_LENGTH } from '../../../shared/types';
import { nickErrorMessage } from '../../core/NickErrorMessage';

/** 渲染昵称设置行 */
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
      const r = await storage.setNick(v);
      if (r.ok) {
        showToast('昵称已更新', 'success');
        refreshBtnState();
      } else {
        // 用结构化错误码给精准文案（特别是 nick_too_frequent 会展示剩余时间）
        showToast(nickErrorMessage(r.error, r.retryAfterSec), 'error', 3200);
      }
    } finally {
      if (saveBtn.textContent === '保 存 中...') saveBtn.textContent = original;
    }
  };

  return row;
}

export function showBasicSettings(onBack: () => void): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';

  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">基 础 设 置</div>
    <div class="scene-subtitle">PREFERENCES</div>
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

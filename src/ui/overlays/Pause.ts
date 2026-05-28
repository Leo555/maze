/**
 * 暂停菜单：继续 / 重来 / 选关 / 主菜单。
 *
 * 显示时 BGM 自动 duck 到 0.4，恢复时由调用方负责 unduck。
 */

import { audio } from '../../core/Audio';
import { attachClickSfx, showOverlay } from './shared';

export function showPauseMenu(handlers: {
  onResume: () => void;
  onRestart: () => void;
  onSelectLevel: () => void;
  onMenu: () => void;
}): void {
  audio.playSfx('ui_open');
  audio.duckBgm(0.4, 200);

  const scene = document.createElement('div');
  scene.className = 'scene';
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.innerHTML = `
    <div class="scene-title">暂  停</div>
    <div class="scene-subtitle">PAUSED</div>
  `;
  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';

  const resume = document.createElement('button');
  resume.className = 'btn primary';
  resume.textContent = '继  续';
  attachClickSfx(resume);
  resume.onclick = () => {
    audio.unduckBgm(300);
    handlers.onResume();
  };

  const restart = document.createElement('button');
  restart.className = 'btn';
  restart.textContent = '重  来';
  attachClickSfx(restart);
  restart.onclick = () => {
    audio.unduckBgm(300);
    handlers.onRestart();
  };

  const select = document.createElement('button');
  select.className = 'btn';
  select.textContent = '选 择 关 卡';
  attachClickSfx(select);
  select.onclick = () => {
    audio.unduckBgm(300);
    handlers.onSelectLevel();
  };

  const menu = document.createElement('button');
  menu.className = 'btn';
  menu.textContent = '主 菜 单';
  attachClickSfx(menu);
  menu.onclick = () => handlers.onMenu();

  btnGroup.appendChild(resume);
  btnGroup.appendChild(restart);
  btnGroup.appendChild(select);
  btnGroup.appendChild(menu);
  card.appendChild(btnGroup);
  scene.appendChild(card);
  showOverlay(scene);
}

/**
 * 同步数据浮层：跨设备进度同步面板 + 清除通关记录。
 *
 * 与 BasicSettings 的边界：
 *   BasicSettings 管"个性化偏好"（昵称、音量），SyncData 管"账号/数据风险操作"
 *   （获取同步编号、扫码恢复、清除存档）。
 *
 * 布局原则：
 *   - 同一页内有两类语义完全不同的功能（同步 / 销毁），
 *     使用 section 卡片显式分组，每个 section 有标题 + 内容区，
 *     避免"settings-row + 自定义面板"两种风格混排造成的视觉断裂。
 *   - 危险操作（清除）放最下方独立 section，按钮使用 danger 视觉，
 *     再叠加 Confirm 二次确认，三重防误触。
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import { showToast } from '../Toast';
import { attachClickSfx, showOverlay } from './shared';
import { showConfirm } from './Confirm';
import { buildSyncPanel } from './sync/SyncPanel';
import { pushErrorMessage } from '../../core/PushErrorMessage';
import { attachSceneHeader } from './SceneHeader';

/** 创建一个带标题的分区容器 */
function buildSection(title: string, subtitle?: string): {
  section: HTMLElement;
  body: HTMLElement;
} {
  const section = document.createElement('section');
  section.className = 'sync-section';

  const head = document.createElement('div');
  head.className = 'sync-section-head';
  head.innerHTML = `
    <div class="sync-section-title">${title}</div>
    ${subtitle ? `<div class="sync-section-sub">${subtitle}</div>` : ''}
  `;
  section.appendChild(head);

  const body = document.createElement('div');
  body.className = 'sync-section-body';
  section.appendChild(body);

  return { section, body };
}

export function showSyncData(onBack: () => void): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene';

  // 顶部 header：欢迎语 + 全局进度
  attachSceneHeader(scene, { greeting: { kind: 'sub' } });

  const card = document.createElement('div');
  card.className = 'scene-card scene-card-sync';
  card.innerHTML = `
    <div class="scene-title">同 步 数 据</div>
    <div class="scene-subtitle">SYNC &amp; DATA</div>
  `;

  // === Section 1: 同步进度（云端关联状态 + 编号显示 + 输入码恢复） ===
  const sync = buildSection('同步进度', '在其他设备恢复你的通关进度');
  sync.body.appendChild(buildSyncPanel());
  card.appendChild(sync.section);

  // === Section 2: 数据管理（清除存档高危操作） ===
  const data = buildSection('数据管理', '高危操作，执行前会再次确认');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn sync-danger';
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
  data.body.appendChild(resetBtn);
  card.appendChild(data.section);

  // 返回按钮
  const back = document.createElement('button');
  back.className = 'btn primary sync-back';
  back.textContent = '返  回';
  attachClickSfx(back);
  back.onclick = () => onBack();
  card.appendChild(back);

  scene.appendChild(card);
  showOverlay(scene);
}
